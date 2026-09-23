import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as http from 'node:http';
import * as https from 'node:https';
import { Duplex } from 'node:stream';
import { GatewayConfigService } from './gateway-config.service';
import { HOP_BY_HOP_HEADERS } from './proxy-headers';
import { isSocketIoPath } from './proxy-routing';

@Injectable()
export class WebSocketProxyService implements OnModuleDestroy {
  private readonly logger = new Logger(WebSocketProxyService.name);
  private readonly httpRequest = http.request;
  private readonly httpsRequest = https.request;
  private server?: http.Server;
  private upgradeListener?: (
    request: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => void;

  constructor(private readonly config: GatewayConfigService) {}

  attach(server: http.Server): void {
    if (this.server === server) {
      return;
    }

    this.detach();
    this.server = server;
    this.upgradeListener = (request, socket, head) => {
      const pathname = new URL(request.url ?? '/', 'http://gateway.local')
        .pathname;
      if (!isSocketIoPath(pathname)) {
        return;
      }

      this.proxyUpgrade(request, socket, head);
    };
    server.on('upgrade', this.upgradeListener);
  }

  detach(): void {
    if (this.server && this.upgradeListener) {
      this.server.off('upgrade', this.upgradeListener);
    }
    this.server = undefined;
    this.upgradeListener = undefined;
  }

  onModuleDestroy(): void {
    this.detach();
  }

  private proxyUpgrade(
    request: http.IncomingMessage,
    clientSocket: Duplex,
    clientHead: Buffer,
  ): void {
    const target = new URL(this.config.messageServiceUrl);
    const headers = this.forwardedHeaders(request, target.host);
    const requestOptions: http.RequestOptions = {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      method: request.method ?? 'GET',
      path: request.url ?? '/socket.io/',
      headers,
      timeout: this.config.proxyTimeoutMs,
    };
    const upstreamRequest =
      target.protocol === 'https:'
        ? this.httpsRequest(requestOptions)
        : this.httpRequest(requestOptions);

    // Node retire ses propres écouteurs d'erreur des sockets lors d'un upgrade :
    // sans ceux-ci, un simple ECONNRESET ferait tomber le processus.
    const onClientErrorBeforeUpgrade = () => {
      upstreamRequest.destroy();
    };
    clientSocket.on('error', onClientErrorBeforeUpgrade);

    upstreamRequest.on(
      'upgrade',
      (upstreamResponse, upstreamSocket, upstreamHead) => {
        upstreamSocket.on('error', () => {
          clientSocket.destroy();
        });

        if (clientSocket.destroyed) {
          upstreamSocket.destroy();
          return;
        }

        // Une fois le tunnel établi, seul le socket amont doit être fermé.
        clientSocket.off('error', onClientErrorBeforeUpgrade);
        clientSocket.on('error', () => {
          upstreamSocket.destroy();
        });
        clientSocket.write(this.serializeUpgradeResponse(upstreamResponse));

        if (upstreamHead.length > 0) {
          clientSocket.write(upstreamHead);
        }
        if (clientHead.length > 0) {
          upstreamSocket.write(clientHead);
        }

        upstreamSocket.pipe(clientSocket);
        clientSocket.pipe(upstreamSocket);
      },
    );

    upstreamRequest.on('response', (upstreamResponse) => {
      if (clientSocket.destroyed) {
        upstreamResponse.resume();
        return;
      }

      clientSocket.write(this.serializeHttpResponse(upstreamResponse));
      upstreamResponse.pipe(clientSocket);
    });

    upstreamRequest.on('timeout', () => {
      upstreamRequest.destroy(new Error('WebSocket upstream timeout'));
    });

    upstreamRequest.on('error', (error) => {
      this.logger.warn(`Erreur proxy WebSocket: ${error.message}`);
      if (!clientSocket.destroyed) {
        clientSocket.end(
          'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n',
        );
      }
    });

    upstreamRequest.end();
  }

  private forwardedHeaders(
    request: http.IncomingMessage,
    targetHost: string,
  ): http.OutgoingHttpHeaders {
    const headers: http.OutgoingHttpHeaders = {};

    for (const [name, value] of Object.entries(request.headers)) {
      const lowerName = name.toLowerCase();
      if (
        value === undefined ||
        // Connection/Upgrade portent la poignée de main WebSocket elle-même.
        (HOP_BY_HOP_HEADERS.has(lowerName) &&
          lowerName !== 'connection' &&
          lowerName !== 'upgrade') ||
        lowerName === 'host' ||
        lowerName === 'x-user-id' ||
        lowerName === 'x-user-role' ||
        lowerName === 'x-forwarded-for' ||
        lowerName === 'x-forwarded-proto' ||
        lowerName === 'x-forwarded-host'
      ) {
        continue;
      }

      headers[name] = value;
    }

    const remoteAddress = request.socket?.remoteAddress ?? 'unknown';
    const existingForwardedFor = this.config.trustProxy
      ? this.firstHeader(request.headers['x-forwarded-for'])
      : undefined;
    const socketWithTls = request.socket as
      (typeof request.socket & { encrypted?: boolean }) | undefined;
    const localProtocol = socketWithTls?.encrypted === true ? 'https' : 'http';
    const forwardedProtocol = this.config.trustProxy
      ? (this.firstHeader(request.headers['x-forwarded-proto']) ??
        localProtocol)
      : localProtocol;

    headers.host = targetHost;
    headers['x-forwarded-for'] = existingForwardedFor
      ? `${existingForwardedFor}, ${remoteAddress}`
      : remoteAddress;
    headers['x-forwarded-proto'] = forwardedProtocol;
    headers['x-forwarded-host'] = this.firstHeader(request.headers.host) ?? '';
    return headers;
  }

  private firstHeader(
    value: string | string[] | undefined,
  ): string | undefined {
    return Array.isArray(value) ? value[0] : value;
  }

  private serializeUpgradeResponse(response: http.IncomingMessage): string {
    const statusCode = response.statusCode ?? 101;
    const statusMessage = response.statusMessage ?? 'Switching Protocols';
    return this.serializeHeaders(
      `HTTP/1.1 ${statusCode} ${statusMessage}`,
      response.headers,
    );
  }

  // Refus d'upgrade relayé en HTTP classique. Le corps est déjà décodé par
  // Node (plus de chunks) : les en-têtes hop-by-hop amont seraient faux, et la
  // fin du corps est signalée par la fermeture du socket. La réponse 101, elle,
  // doit garder Connection/Upgrade et n'est donc pas filtrée.
  private serializeHttpResponse(response: http.IncomingMessage): string {
    const statusCode = response.statusCode ?? 502;
    const statusMessage = response.statusMessage ?? 'Bad Gateway';
    const headers: http.IncomingHttpHeaders = {};
    for (const [name, value] of Object.entries(response.headers)) {
      if (!HOP_BY_HOP_HEADERS.has(name.toLowerCase())) {
        headers[name] = value;
      }
    }
    headers.connection = 'close';

    return this.serializeHeaders(
      `HTTP/1.1 ${statusCode} ${statusMessage}`,
      headers,
    );
  }

  private serializeHeaders(
    statusLine: string,
    headers: http.IncomingHttpHeaders,
  ): string {
    const lines = [statusLine];

    for (const [name, value] of Object.entries(headers)) {
      if (value === undefined) {
        continue;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          lines.push(`${name}: ${item}`);
        }
      } else {
        lines.push(`${name}: ${value}`);
      }
    }

    return `${lines.join('\r\n')}\r\n\r\n`;
  }
}
