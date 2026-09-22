import { Readable } from 'node:stream';
import { NextFunction, Request, Response as ExpressResponse } from 'express';
import {
  AuthRateLimitService,
  RateLimitResult,
} from './auth-rate-limit.service';
import { GatewayConfigService } from './gateway-config.service';
import { HttpProxyService } from './http-proxy.service';

function requestTargetToString(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

interface MockResponseState {
  statusCode: number;
  headersSent: boolean;
  headers: Map<string, string | string[]>;
  jsonBody?: unknown;
  ended: boolean;
  body?: Buffer;
}

function config(
  overrides: Partial<GatewayConfigService> = {},
): GatewayConfigService {
  return {
    port: 3000,
    authServiceUrl: 'http://auth:3001',
    roomServiceUrl: 'http://room:3003',
    messageServiceUrl: 'http://message:3004',
    userConfigServiceUrl: 'http://config:3005',
    proxyTimeoutMs: 5000,
    maxProxyBodyBytes: 1024,
    authRateLimitWindowMs: 60_000,
    authRateLimitMax: 10,
    corsOrigins: ['http://localhost:5173'],
    trustProxy: false,
    ...overrides,
  };
}

function request(options: {
  method?: string;
  url: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: string | Buffer;
  remoteAddress?: string | null;
  protocol?: string;
}): Request {
  const stream = Readable.from(
    options.body === undefined ? [] : [Buffer.from(options.body)],
  );
  const headers = options.headers ?? {};

  Object.assign(stream, {
    method: options.method ?? 'GET',
    originalUrl: options.url,
    url: options.url,
    headers,
    protocol: options.protocol ?? 'http',
    get(name: string) {
      const value = headers[name.toLowerCase()];
      return Array.isArray(value) ? value[0] : value;
    },
  });
  Object.defineProperty(stream, 'socket', {
    value: {
      remoteAddress:
        options.remoteAddress === null
          ? undefined
          : (options.remoteAddress ?? '127.0.0.1'),
    },
  });

  return stream as unknown as Request;
}

function response(initialHeadersSent = false): {
  response: ExpressResponse;
  state: MockResponseState;
} {
  const state: MockResponseState = {
    statusCode: 200,
    headersSent: initialHeadersSent,
    headers: new Map(),
    ended: false,
  };

  const mock = {
    get headersSent() {
      return state.headersSent;
    },
    status(code: number) {
      state.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string | string[]) {
      state.headers.set(name.toLowerCase(), value);
      return this;
    },
    getHeader(name: string) {
      return state.headers.get(name.toLowerCase());
    },
    json(value: unknown) {
      state.jsonBody = value;
      state.headersSent = true;
      state.ended = true;
      return this;
    },
    end(value?: Buffer | string) {
      if (value !== undefined) {
        state.body = Buffer.isBuffer(value) ? value : Buffer.from(value);
      }
      state.headersSent = true;
      state.ended = true;
      return this;
    },
  };

  return { response: mock as unknown as ExpressResponse, state };
}

function allowedResult(
  overrides: Partial<RateLimitResult> = {},
): RateLimitResult {
  return {
    allowed: true,
    limit: 10,
    remaining: 9,
    resetAt: 2_000_000_000_000,
    retryAfterSeconds: 60,
    ...overrides,
  };
}

describe('HttpProxyService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('passes unknown routes to Nest while applying Gateway CORS', async () => {
    const rateLimit = { consume: jest.fn() } as unknown as AuthRateLimitService;
    const service = new HttpProxyService(config(), rateLimit);
    const req = request({
      url: '/api/health',
      headers: { origin: 'http://localhost:5173' },
    });
    const { response: res, state } = response();
    const next = jest.fn() as NextFunction;

    await service.handle(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(state.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:5173',
    );
    expect(state.headers.get('vary')).toBe('Origin');
    expect(state.headers.get('access-control-allow-methods')).toContain(
      'PATCH',
    );
    expect(state.headers.get('access-control-allow-headers')).toBe(
      'Authorization,Content-Type',
    );
    expect(state.headers.get('access-control-max-age')).toBe('600');
  });

  it('does not reflect a disallowed or missing origin', async () => {
    const service = new HttpProxyService(config(), {
      consume: jest.fn(),
    } as unknown as AuthRateLimitService);

    for (const headers of [{ origin: 'https://evil.example' }, {}]) {
      const { response: res, state } = response();
      await service.handle(
        request({ url: '/unknown', headers }),
        res,
        jest.fn(),
      );
      expect(state.headers.has('access-control-allow-origin')).toBe(false);
    }
  });

  it('answers upstream CORS preflight locally', async () => {
    const service = new HttpProxyService(config(), {
      consume: jest.fn(),
    } as unknown as AuthRateLimitService);
    const { response: res, state } = response();
    const next = jest.fn();

    await service.handle(
      request({ method: 'OPTIONS', url: '/api/messages' }),
      res,
      next,
    );

    expect(state.statusCode).toBe(204);
    expect(state.ended).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it('lets Nest handle OPTIONS for a non-proxied route', async () => {
    const service = new HttpProxyService(config(), {
      consume: jest.fn(),
    } as unknown as AuthRateLimitService);
    const { response: res } = response();
    const next = jest.fn();

    await service.handle(
      request({ method: 'OPTIONS', url: '/api/health' }),
      res,
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('rate limits login by client IP and route before forwarding', async () => {
    const consume = jest.fn().mockReturnValue(
      allowedResult({
        allowed: false,
        limit: 2,
        remaining: 0,
        resetAt: 1_700_000_000_000,
        retryAfterSeconds: 42,
      }),
    );
    const service = new HttpProxyService(config(), {
      consume,
    } as unknown as AuthRateLimitService);
    const fetchSpy = jest.spyOn(global, 'fetch');
    const { response: res, state } = response();

    await service.handle(
      request({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: '10.0.0.8',
      }),
      res,
      jest.fn(),
    );

    expect(consume).toHaveBeenCalledWith('10.0.0.8:/api/auth/login');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(429);
    expect(state.headers.get('retry-after')).toBe('42');
    expect(state.headers.get('x-ratelimit-limit')).toBe('2');
    expect(state.headers.get('x-ratelimit-remaining')).toBe('0');
    expect(state.headers.get('x-ratelimit-reset')).toBe('1700000000');
    expect(state.jsonBody).toEqual({
      statusCode: 429,
      message: 'Trop de tentatives. Réessayez plus tard.',
      error: 'Too Many Requests',
    });
  });

  it('forwards an allowed Auth POST body, JWT, query and response status', async () => {
    const consume = jest.fn().mockReturnValue(allowedResult());
    const upstreamHeaders = new Headers({
      'content-type': 'application/json',
      'x-upstream': 'auth',
      'access-control-allow-origin': 'https://should-be-stripped.example',
      'content-encoding': 'gzip',
      'content-length': '999',
      connection: 'close',
      vary: 'Accept-Encoding',
      'set-cookie': 'sid=abc; HttpOnly',
    });
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
      status: 201,
      headers: upstreamHeaders,
      arrayBuffer: jest
        .fn()
        .mockResolvedValue(
          Uint8Array.from(Buffer.from('{"jeton":"jwt"}')).buffer,
        ),
    } as unknown as globalThis.Response);
    const service = new HttpProxyService(config(), {
      consume,
    } as unknown as AuthRateLimitService);
    const { response: res, state } = response();

    await service.handle(
      request({
        method: 'POST',
        url: '/api/auth/register?source=test',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:5173',
          authorization: 'Bearer token',
          'content-type': 'application/json',
          connection: 'keep-alive',
          'content-length': '123',
          'x-array': ['a', 'b'],
          'x-undefined': undefined,
        },
        body: '{"pseudo":"abc"}',
        remoteAddress: '127.0.0.9',
      }),
      res,
      jest.fn(),
    );

    expect(consume).toHaveBeenCalledWith('127.0.0.9:/api/auth/register');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, options] = fetchSpy.mock.calls[0];
    expect(requestTargetToString(url)).toBe(
      'http://auth:3001/api/auth/register?source=test',
    );
    expect(options?.method).toBe('POST');
    expect(Buffer.from(options?.body as Buffer).toString()).toBe(
      '{"pseudo":"abc"}',
    );
    const forwarded = options?.headers as Headers;
    expect(forwarded.get('authorization')).toBe('Bearer token');
    expect(forwarded.get('connection')).toBeNull();
    expect(forwarded.get('host')).toBeNull();
    expect(forwarded.get('content-length')).toBeNull();
    expect(forwarded.get('x-array')).toBe('a, b');
    expect(forwarded.get('x-forwarded-for')).toBe('127.0.0.9');
    expect(forwarded.get('x-forwarded-proto')).toBe('http');
    expect(forwarded.get('x-forwarded-host')).toBe('localhost:3000');
    expect(options?.redirect).toBe('manual');
    expect(options?.signal).toBeDefined();

    expect(state.statusCode).toBe(201);
    expect(state.headers.get('x-upstream')).toBe('auth');
    expect(state.headers.get('access-control-allow-origin')).toBe(
      'http://localhost:5173',
    );
    expect(state.headers.has('content-encoding')).toBe(false);
    expect(state.headers.has('content-length')).toBe(false);
    expect(state.headers.get('vary')).toBe('Origin');
    expect(state.headers.get('set-cookie')).toBeDefined();
    expect(state.body?.toString()).toBe('{"jeton":"jwt"}');
  });

  it.each([
    ['/api/users/1', 'http://auth:3001/api/users/1'],
    ['/api/rooms/1', 'http://room:3003/api/rooms/1'],
    ['/api/admin/rooms', 'http://room:3003/api/admin/rooms'],
    ['/api/messages/1', 'http://message:3004/api/messages/1'],
    [
      '/socket.io/?EIO=4&transport=polling',
      'http://message:3004/socket.io/?EIO=4&transport=polling',
    ],
  ])(
    'routes %s to the correct internal service',
    async (path: string, expectedUrl: string) => {
      const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response('ok', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );
      const service = new HttpProxyService(config(), {
        consume: jest.fn(),
      } as unknown as AuthRateLimitService);
      const { response: res } = response();

      await service.handle(request({ url: path }), res, jest.fn());

      expect(requestTargetToString(fetchSpy.mock.calls[0][0])).toBe(
        expectedUrl,
      );
      expect(fetchSpy.mock.calls[0][1]?.body).toBeUndefined();
    },
  );

  it('authenticates User-Config through Auth and replaces client identity headers', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'user-123', pseudo: 'demo' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ type: 'configUtilisateur' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    const service = new HttpProxyService(config(), {
      consume: jest.fn(),
    } as unknown as AuthRateLimitService);
    const { response: res, state } = response();

    await service.handle(
      request({
        url: '/api/config-utilisateur',
        headers: {
          authorization: 'Bearer jwt-valid',
          'x-user-id': 'spoofed-user',
          'x-user-role': 'admin',
        },
      }),
      res,
      jest.fn(),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(requestTargetToString(fetchSpy.mock.calls[0][0])).toBe(
      'http://auth:3001/api/auth/me',
    );
    const authHeaders = fetchSpy.mock.calls[0][1]?.headers as Headers;
    expect(authHeaders.get('authorization')).toBe('Bearer jwt-valid');

    expect(requestTargetToString(fetchSpy.mock.calls[1][0])).toBe(
      'http://config:3005/api/config-utilisateur',
    );
    const configHeaders = fetchSpy.mock.calls[1][1]?.headers as Headers;
    expect(configHeaders.get('authorization')).toBe('Bearer jwt-valid');
    expect(configHeaders.get('x-user-id')).toBe('user-123');
    expect(configHeaders.get('x-user-role')).toBeNull();
    expect(state.statusCode).toBe(200);
  });

  it('relays an Auth rejection without contacting User-Config', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
      new Response('{"message":"non autorisé"}', {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const service = new HttpProxyService(config(), {
      consume: jest.fn(),
    } as unknown as AuthRateLimitService);
    const { response: res, state } = response();

    await service.handle(
      request({ url: '/api/config-utilisateur' }),
      res,
      jest.fn(),
    );

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(requestTargetToString(fetchSpy.mock.calls[0][0])).toBe(
      'http://auth:3001/api/auth/me',
    );
    const authHeaders = fetchSpy.mock.calls[0][1]?.headers as Headers;
    expect(authHeaders.get('authorization')).toBeNull();
    expect(state.statusCode).toBe(401);
    expect(state.body?.toString()).toBe('{"message":"non autorisé"}');
  });

  it.each([
    ['primitive', 'invalid'],
    ['null', null],
    ['missing id', {}],
    ['non-string id', { id: 42 }],
    ['blank id', { id: '   ' }],
    ['oversized id', { id: 'a'.repeat(256) }],
  ])(
    'returns 503 when Auth returns an invalid identity payload: %s',
    async (_caseName, payload) => {
      jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
      const service = new HttpProxyService(config(), {
        consume: jest.fn(),
      } as unknown as AuthRateLimitService);
      const { response: res, state } = response();

      await service.handle(
        request({
          url: '/api/config-utilisateur',
          headers: { authorization: 'Bearer jwt-valid' },
        }),
        res,
        jest.fn(),
      );

      expect(state.statusCode).toBe(503);
      expect(state.jsonBody).toEqual({
        statusCode: 503,
        message: 'Service interne indisponible',
        error: 'Service Unavailable',
      });
    },
  );

  it('uses trusted X-Forwarded headers only when configured', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('ok'));
    const consume = jest.fn().mockReturnValue(allowedResult());
    const service = new HttpProxyService(config({ trustProxy: true }), {
      consume,
    } as unknown as AuthRateLimitService);
    const { response: res } = response();

    await service.handle(
      request({
        method: 'POST',
        url: '/api/auth/login',
        protocol: 'http',
        remoteAddress: '10.0.0.10',
        headers: {
          host: 'gateway.example',
          'x-forwarded-for': ['203.0.113.1, 203.0.113.2', 'ignored'],
          'x-forwarded-proto': ['https', 'http'],
        },
        body: '{}',
      }),
      res,
      jest.fn(),
    );

    expect(consume).toHaveBeenCalledWith('203.0.113.1:/api/auth/login');
    const headers = fetchSpy.mock.calls[0][1]?.headers as Headers;
    expect(headers.get('x-forwarded-for')).toBe(
      '203.0.113.1, 203.0.113.2, 10.0.0.10',
    );
    expect(headers.get('x-forwarded-proto')).toBe('https');
  });

  it('uses unknown when the socket has no remote address', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('ok'));
    const consume = jest.fn().mockReturnValue(allowedResult());
    const service = new HttpProxyService(config(), {
      consume,
    } as unknown as AuthRateLimitService);
    const { response: res } = response();

    await service.handle(
      request({
        method: 'POST',
        url: '/api/auth/login',
        remoteAddress: null,
        body: '{}',
      }),
      res,
      jest.fn(),
    );

    expect(consume).toHaveBeenCalledWith('unknown:/api/auth/login');
    const headers = fetchSpy.mock.calls[0][1]?.headers as Headers;
    expect(headers.get('x-forwarded-for')).toBe('unknown');
  });

  it('falls back to the socket address when trustProxy has no forwarded IP', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response('ok'));
    const consume = jest.fn().mockReturnValue(allowedResult());
    const service = new HttpProxyService(config({ trustProxy: true }), {
      consume,
    } as unknown as AuthRateLimitService);
    const { response: res } = response();

    await service.handle(
      request({ method: 'POST', url: '/api/auth/login', body: '{}' }),
      res,
      jest.fn(),
    );

    expect(consume).toHaveBeenCalledWith('127.0.0.1:/api/auth/login');
  });

  it('rejects oversized bodies before contacting the upstream', async () => {
    const fetchSpy = jest.spyOn(global, 'fetch');
    const service = new HttpProxyService(config({ maxProxyBodyBytes: 2 }), {
      consume: jest.fn(),
    } as unknown as AuthRateLimitService);
    const { response: res, state } = response();

    await service.handle(
      request({ method: 'POST', url: '/api/messages', body: 'abc' }),
      res,
      jest.fn(),
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.statusCode).toBe(413);
    expect(state.jsonBody).toEqual({
      statusCode: 413,
      message: 'Corps de requête trop volumineux',
      error: 'Payload Too Large',
    });
  });

  it.each([
    ['TimeoutError', 504, 'Gateway Timeout'],
    ['AbortError', 504, 'Gateway Timeout'],
    ['TypeError', 503, 'Service Unavailable'],
  ])(
    'maps %s proxy failures to %s',
    async (name: string, expectedStatus: number, expectedError: string) => {
      const error = new Error('boom');
      error.name = name;
      jest.spyOn(global, 'fetch').mockRejectedValue(error);
      const service = new HttpProxyService(config(), {
        consume: jest.fn(),
      } as unknown as AuthRateLimitService);
      const { response: res, state } = response();

      await service.handle(request({ url: '/api/rooms' }), res, jest.fn());

      expect(state.statusCode).toBe(expectedStatus);
      expect((state.jsonBody as { error: string }).error).toBe(expectedError);
    },
  );

  it('maps a non-Error rejection to 503', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue('offline');
    const service = new HttpProxyService(config(), {
      consume: jest.fn(),
    } as unknown as AuthRateLimitService);
    const { response: res, state } = response();

    await service.handle(request({ url: '/api/rooms' }), res, jest.fn());

    expect(state.statusCode).toBe(503);
  });

  it('ends an already-started response if forwarding later fails', async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('offline'));
    const service = new HttpProxyService(config(), {
      consume: jest.fn(),
    } as unknown as AuthRateLimitService);
    const { response: res, state } = response(true);

    await service.handle(request({ url: '/api/rooms' }), res, jest.fn());

    expect(state.ended).toBe(true);
    expect(state.jsonBody).toBeUndefined();
  });

  it.each([
    ['HEAD', 200],
    ['POST', 204],
    ['POST', 304],
  ])(
    'does not write an upstream body for %s / status %s',
    async (method: string, status: number) => {
      jest.spyOn(global, 'fetch').mockResolvedValue({
        status,
        headers: new Headers(),
        arrayBuffer: jest.fn().mockRejectedValue(new Error('must not be read')),
      } as unknown as globalThis.Response);
      const service = new HttpProxyService(config(), {
        consume: jest.fn(),
      } as unknown as AuthRateLimitService);
      const { response: res, state } = response();

      await service.handle(
        request({
          method,
          url: '/api/messages',
          body: method === 'POST' ? '{}' : undefined,
        }),
        res,
        jest.fn(),
      );

      expect(state.statusCode).toBe(status);
      expect(state.ended).toBe(true);
      expect(state.body).toBeUndefined();
    },
  );
});
