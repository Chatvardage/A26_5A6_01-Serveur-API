import { Injectable, Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { GatewayConfigService } from './gateway-config.service';
import {
  isRateLimitedAuthRoute,
  resolveUpstream,
  UpstreamService,
} from './proxy-routing';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

const UPSTREAM_CORS_HEADERS = new Set([
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-allow-credentials',
  'access-control-expose-headers',
  'access-control-max-age',
]);

class PayloadTooLargeError extends Error {}
class InvalidAuthContractError extends Error {}

@Injectable()
export class HttpProxyService {
  private readonly logger = new Logger(HttpProxyService.name);
  private readonly allowedOrigins: Set<string>;

  constructor(
    private readonly config: GatewayConfigService,
    private readonly rateLimit: AuthRateLimitService,
  ) {
    this.allowedOrigins = new Set(config.corsOrigins);
  }

  readonly handle = async (
    request: Request,
    response: Response,
    next: NextFunction,
  ): Promise<void> => {
    const requestUrl = new URL(request.originalUrl, 'http://gateway.local');
    const upstream = resolveUpstream(requestUrl.pathname);

    this.applyCors(request, response);

    if (request.method === 'OPTIONS' && upstream !== null) {
      response.status(204).end();
      return;
    }

    if (upstream === null) {
      next();
      return;
    }

    if (isRateLimitedAuthRoute(request.method, requestUrl.pathname)) {
      const result = this.rateLimit.consume(
        `${this.clientKey(request)}|${requestUrl.pathname}`,
      );
      response.setHeader('X-RateLimit-Limit', String(result.limit));
      response.setHeader('X-RateLimit-Remaining', String(result.remaining));
      response.setHeader(
        'X-RateLimit-Reset',
        String(Math.ceil(result.resetAt / 1000)),
      );

      if (!result.allowed) {
        response.setHeader('Retry-After', String(result.retryAfterSeconds));
        response.status(429).json({
          statusCode: 429,
          message: 'Trop de tentatives. Réessayez plus tard.',
          error: 'Too Many Requests',
        });
        return;
      }
    }

    try {
      await this.forward(request, response, requestUrl, upstream);
    } catch (error: unknown) {
      if (response.headersSent) {
        response.end();
        return;
      }

      if (error instanceof PayloadTooLargeError) {
        response.status(413).json({
          statusCode: 413,
          message: 'Corps de requête trop volumineux',
          error: 'Payload Too Large',
        });
        return;
      }

      if (error instanceof InvalidAuthContractError) {
        this.logger.error(
          `Contrat Auth invalide pour ${upstream}: ${error.message}`,
        );
        response.status(502).json({
          statusCode: 502,
          message: "Réponse invalide du service d'authentification",
          error: 'Bad Gateway',
        });
        return;
      }

      const isTimeout =
        error instanceof Error &&
        (error.name === 'TimeoutError' || error.name === 'AbortError');

      if (isTimeout) {
        this.logger.warn(`Délai dépassé vers ${upstream}`);
        response.status(504).json({
          statusCode: 504,
          message: 'Délai dépassé vers le service interne',
          error: 'Gateway Timeout',
        });
        return;
      }

      this.logger.error(`Service interne ${upstream} indisponible`);
      response.status(503).json({
        statusCode: 503,
        message: 'Service interne indisponible',
        error: 'Service Unavailable',
      });
    }
  };

  private async forward(
    request: Request,
    response: Response,
    requestUrl: URL,
    upstream: UpstreamService,
  ): Promise<void> {
    const body = await this.readBody(request);
    const authenticatedUserId =
      upstream === 'userConfig'
        ? await this.resolveAuthenticatedUserId(request, response)
        : undefined;

    if (upstream === 'userConfig' && authenticatedUserId === null) {
      return;
    }

    const target = new URL(
      `${requestUrl.pathname}${requestUrl.search}`,
      this.baseUrl(upstream),
    );

    // Node 22/undici accepte Buffer à l'exécution comme BodyInit. Les types
    // @types/node actuels le généralisent toutefois en Buffer<ArrayBufferLike>,
    // d'où ce cast explicite sans seconde allocation mémoire.
    const forwardedBody: BodyInit | undefined =
      this.hasRequestBody(request.method) && body !== undefined
        ? (body as unknown as BodyInit)
        : undefined;

    const upstreamResponse = await fetch(target, {
      method: request.method,
      headers: this.forwardedHeaders(request, authenticatedUserId ?? undefined),
      body: forwardedBody,
      redirect: 'manual',
      signal: AbortSignal.timeout(this.config.proxyTimeoutMs),
    });

    response.status(upstreamResponse.status);
    this.copyResponseHeaders(upstreamResponse, response);

    if (
      request.method === 'HEAD' ||
      upstreamResponse.status === 204 ||
      upstreamResponse.status === 304
    ) {
      response.end();
      return;
    }

    const payload = Buffer.from(await upstreamResponse.arrayBuffer());
    response.end(payload);
  }

  private baseUrl(upstream: UpstreamService): string {
    switch (upstream) {
      case 'auth':
        return this.config.authServiceUrl;
      case 'room':
        return this.config.roomServiceUrl;
      case 'message':
        return this.config.messageServiceUrl;
      case 'userConfig':
        return this.config.userConfigServiceUrl;
    }
  }

  private async resolveAuthenticatedUserId(
    request: Request,
    response: Response,
  ): Promise<string | null> {
    const authorization = this.firstHeader(request.headers.authorization);
    const headers = new Headers();
    if (authorization) {
      headers.set('Authorization', authorization);
    }

    const authResponse = await fetch(
      new URL('/api/auth/me', this.config.authServiceUrl),
      {
        method: 'GET',
        headers,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.config.proxyTimeoutMs),
      },
    );

    if (!authResponse.ok) {
      response.status(authResponse.status);
      this.copyResponseHeaders(authResponse, response);
      response.end(Buffer.from(await authResponse.arrayBuffer()));
      return null;
    }

    let payload: unknown;
    try {
      payload = await authResponse.json();
    } catch {
      throw new InvalidAuthContractError('JSON invalide');
    }

    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('id' in payload) ||
      typeof payload.id !== 'string' ||
      payload.id.trim() === '' ||
      payload.id.length > 255
    ) {
      throw new InvalidAuthContractError('champ id absent ou invalide');
    }

    return payload.id;
  }

  private forwardedHeaders(
    request: Request,
    authenticatedUserId?: string,
  ): Headers {
    const headers = new Headers();

    for (const [name, rawValue] of Object.entries(request.headers)) {
      const lowerName = name.toLowerCase();
      if (
        rawValue === undefined ||
        HOP_BY_HOP_HEADERS.has(lowerName) ||
        lowerName === 'host' ||
        lowerName === 'content-length' ||
        lowerName === 'x-user-id' ||
        lowerName === 'x-user-role' ||
        lowerName === 'x-forwarded-for' ||
        lowerName === 'x-forwarded-proto' ||
        lowerName === 'x-forwarded-host'
      ) {
        continue;
      }

      headers.set(
        name,
        Array.isArray(rawValue) ? rawValue.join(', ') : rawValue,
      );
    }

    const remoteAddress = request.socket.remoteAddress ?? 'unknown';
    const existingForwardedFor = this.config.trustProxy
      ? this.firstHeader(request.headers['x-forwarded-for'])
      : undefined;
    headers.set(
      'x-forwarded-for',
      existingForwardedFor
        ? `${existingForwardedFor}, ${remoteAddress}`
        : remoteAddress,
    );
    headers.set(
      'x-forwarded-proto',
      this.config.trustProxy
        ? (this.firstHeader(request.headers['x-forwarded-proto']) ??
            request.protocol)
        : request.protocol,
    );
    headers.set('x-forwarded-host', request.get('host') ?? '');

    if (authenticatedUserId) {
      headers.set('x-user-id', authenticatedUserId);
    }

    return headers;
  }

  private copyResponseHeaders(
    upstream: globalThis.Response,
    response: Response,
  ): void {
    upstream.headers.forEach((value, name) => {
      const lowerName = name.toLowerCase();
      if (
        HOP_BY_HOP_HEADERS.has(lowerName) ||
        UPSTREAM_CORS_HEADERS.has(lowerName) ||
        lowerName === 'content-length' ||
        lowerName === 'content-encoding' ||
        lowerName === 'set-cookie'
      ) {
        return;
      }

      if (lowerName === 'vary') {
        this.mergeVaryHeader(response, value);
        return;
      }

      response.setHeader(name, value);
    });

    // Node >= 22 est imposé par package.json et par l'image Docker.
    const cookies = (
      upstream.headers as Headers & { getSetCookie: () => string[] }
    ).getSetCookie();
    if (cookies.length > 0) {
      response.setHeader('set-cookie', cookies);
    }
  }

  private async readBody(request: Request): Promise<Buffer | undefined> {
    if (!this.hasRequestBody(request.method)) {
      return undefined;
    }

    const chunks: Buffer[] = [];
    let total = 0;

    for await (const chunk of request) {
      const buffer = Buffer.from(chunk as Uint8Array);
      total += buffer.length;
      if (total > this.config.maxProxyBodyBytes) {
        request.resume();
        throw new PayloadTooLargeError();
      }
      chunks.push(buffer);
    }

    return Buffer.concat(chunks);
  }

  private hasRequestBody(method: string): boolean {
    return method !== 'GET' && method !== 'HEAD';
  }

  private applyCors(request: Request, response: Response): void {
    const origin = request.get('origin');
    if (!origin) {
      return;
    }

    this.mergeVaryHeader(response, 'Origin');
    if (!this.allowedOrigins.has(origin)) {
      return;
    }

    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader(
      'Access-Control-Allow-Methods',
      'GET,POST,PATCH,DELETE,OPTIONS',
    );
    response.setHeader(
      'Access-Control-Allow-Headers',
      'Authorization,Content-Type',
    );
    response.setHeader('Access-Control-Max-Age', '600');
  }

  private mergeVaryHeader(response: Response, value: string): void {
    const current = String(response.getHeader('Vary') ?? '');
    const values = `${current},${value}`
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
    const unique = new Map(values.map((entry) => [entry.toLowerCase(), entry]));
    response.setHeader('Vary', [...unique.values()].join(', '));
  }

  private clientKey(request: Request): string {
    if (this.config.trustProxy) {
      const forwardedFor = this.firstHeader(request.headers['x-forwarded-for']);
      if (forwardedFor) {
        return forwardedFor.split(',')[0].trim();
      }
    }

    return request.socket.remoteAddress ?? 'unknown';
  }

  private firstHeader(
    value: string | string[] | undefined,
  ): string | undefined {
    if (Array.isArray(value)) {
      return value[0];
    }
    return value;
  }
}
