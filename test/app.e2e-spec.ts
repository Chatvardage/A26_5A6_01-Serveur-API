import { INestApplication } from '@nestjs/common';
import * as http from 'node:http';
import * as net from 'node:net';
import { AddressInfo } from 'node:net';
import { Duplex } from 'node:stream';
import { createApplication } from '../src/main';
import { WebSocketProxyService } from '../src/gateway/websocket-proxy.service';

interface MockUpstream {
  server: http.Server;
  url: string;
  close: () => Promise<void>;
}

type MockRequestHandler = (
  request: http.IncomingMessage,
  response: http.ServerResponse,
) => void | Promise<void>;

async function mockUpstream(
  handler: MockRequestHandler,
  upgrade?: (
    request: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => void,
): Promise<MockUpstream> {
  const server = http.createServer((request, response) => {
    const result = handler(request, response);
    if (result instanceof Promise) {
      void result.catch((error: unknown) => {
        response.destroy(
          error instanceof Error ? error : new Error('Mock upstream failure'),
        );
      });
    }
  });
  if (upgrade) {
    server.on('upgrade', upgrade);
  }
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections?.();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function rawUpgrade(port: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1');
    let data = '';

    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(
        'GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\n' +
          `Host: 127.0.0.1:${port}\r\n` +
          'Connection: Upgrade\r\n' +
          'Upgrade: websocket\r\n' +
          '\r\n',
      );
    });
    socket.on('data', (chunk) => {
      const textChunk =
        typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      data += textChunk;
      if (data.includes('\r\n\r\n')) {
        socket.destroy();
        resolve(data);
      }
    });
    socket.on('error', reject);
  });
}

describe('Serveur-API (e2e)', () => {
  let auth: MockUpstream;
  let room: MockUpstream;
  let message: MockUpstream;
  let userConfig: MockUpstream;
  let app: INestApplication;
  let gatewayUrl: string;
  const previousEnv = { ...process.env };

  beforeAll(async () => {
    auth = await mockUpstream(async (request, response) => {
      if (request.url === '/health') {
        response.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
        return;
      }

      if (request.url === '/api/auth/me') {
        if (request.headers.authorization !== 'Bearer demo-token') {
          response
            .writeHead(401, { 'content-type': 'application/json' })
            .end('{"message":"unauthorized"}');
          return;
        }
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end('{"id":"user-123","pseudo":"demo"}');
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        chunks.push(Buffer.from(chunk));
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          service: 'auth',
          method: request.method,
          url: request.url,
          authorization: request.headers.authorization,
          body: Buffer.concat(chunks).toString(),
        }),
      );
    });

    room = await mockUpstream((request, response) => {
      if (request.url === '/api/health') {
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end('{}');
        return;
      }
      response
        .writeHead(403, { 'content-type': 'application/json' })
        .end('{"message":"forbidden-by-room"}');
    });

    message = await mockUpstream(
      (request, response) => {
        if (request.url === '/api/health') {
          response
            .writeHead(200, { 'content-type': 'application/json' })
            .end('{}');
          return;
        }
        response.writeHead(200).end('message-ok');
      },
      (_request, socket) => {
        socket.end(
          'HTTP/1.1 101 Switching Protocols\r\n' +
            'Connection: Upgrade\r\n' +
            'Upgrade: websocket\r\n' +
            '\r\n',
        );
      },
    );

    userConfig = await mockUpstream((request, response) => {
      if (request.url === '/api/health') {
        response
          .writeHead(200, { 'content-type': 'application/json' })
          .end('{}');
        return;
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({
          service: 'user-config',
          method: request.method,
          url: request.url,
          userId: request.headers['x-user-id'],
          authorization: request.headers.authorization,
        }),
      );
    });

    process.env.AUTH_SERVICE_URL = auth.url;
    process.env.ROOM_SERVICE_URL = room.url;
    process.env.MESSAGE_SERVICE_URL = message.url;
    process.env.USER_CONFIG_SERVICE_URL = userConfig.url;
    process.env.AUTH_RATE_LIMIT_MAX = '50';
    process.env.CORS_ORIGINS = 'http://localhost:5173';

    app = await createApplication();
    app.get(WebSocketProxyService).attach(app.getHttpServer() as http.Server);
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as AddressInfo).port;
    gatewayUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await app.close();
    await Promise.all([
      auth.close(),
      room.close(),
      message.close(),
      userConfig.close(),
    ]);
    process.env = previousEnv;
  });

  it('exposes its own liveness and upstream readiness', async () => {
    const live = await fetch(`${gatewayUrl}/api/health`);
    expect(live.status).toBe(200);
    expect(await live.json()).toEqual(
      expect.objectContaining({ status: 'ok', service: 'serveur-api' }),
    );

    const dependencies = await fetch(`${gatewayUrl}/api/health/upstreams`);
    expect(dependencies.status).toBe(200);
    expect(await dependencies.json()).toEqual(
      expect.objectContaining({
        status: 'ok',
        upstreams: { auth: 'ok', room: 'ok', message: 'ok', userConfig: 'ok' },
      }),
    );
  });

  it('forwards Auth HTTP requests without changing the contract', async () => {
    const response = await fetch(`${gatewayUrl}/api/auth/login?demo=1`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer demo-token',
        'content-type': 'application/json',
      },
      body: '{"identifiant":"demo","mot_de_passe":"secret"}',
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: 'auth',
      method: 'POST',
      url: '/api/auth/login?demo=1',
      authorization: 'Bearer demo-token',
      body: '{"identifiant":"demo","mot_de_passe":"secret"}',
    });
  });

  it('authenticates and forwards User-Config with a trusted user id', async () => {
    const response = await fetch(`${gatewayUrl}/api/config-utilisateur`, {
      headers: {
        authorization: 'Bearer demo-token',
        'x-user-id': 'spoofed-user',
        'x-user-role': 'admin',
      },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      service: 'user-config',
      method: 'GET',
      url: '/api/config-utilisateur',
      userId: 'user-123',
      authorization: 'Bearer demo-token',
    });
  });

  it('relays Auth rejection before User-Config', async () => {
    const response = await fetch(`${gatewayUrl}/api/config-utilisateur`, {
      headers: { authorization: 'Bearer invalid-token' },
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ message: 'unauthorized' });
  });

  it('preserves an upstream functional error', async () => {
    const response = await fetch(`${gatewayUrl}/api/rooms/secret`);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ message: 'forbidden-by-room' });
  });

  it('relays the Socket.IO WebSocket upgrade path to Message-Service', async () => {
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const response = await rawUpgrade(port);
    expect(response).toContain('HTTP/1.1 101 Switching Protocols');
    expect(response.toLowerCase()).toContain('upgrade: websocket');
  });
});
