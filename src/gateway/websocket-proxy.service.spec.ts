import { EventEmitter } from 'node:events';
import * as http from 'node:http';
import { Duplex } from 'node:stream';
import { GatewayConfigService } from './gateway-config.service';
import { WebSocketProxyService } from './websocket-proxy.service';

interface FakeRequest extends EventEmitter {
  end: jest.Mock;
  destroy: jest.Mock;
}

function config(
  overrides: Partial<GatewayConfigService> = {},
): GatewayConfigService {
  return {
    messageServiceUrl: 'http://message-service:3004',
    proxyTimeoutMs: 5000,
    trustProxy: false,
    ...overrides,
  } as GatewayConfigService;
}

function upstreamRequest(): FakeRequest {
  return Object.assign(new EventEmitter(), {
    end: jest.fn(),
    destroy: jest.fn(),
  });
}

function socket(destroyed = false): Duplex & {
  write: jest.Mock;
  end: jest.Mock;
  pipe: jest.Mock;
} {
  return {
    destroyed,
    write: jest.fn().mockReturnValue(true),
    end: jest.fn(),
    pipe: jest.fn().mockReturnValue(undefined),
  } as unknown as Duplex & {
    write: jest.Mock;
    end: jest.Mock;
    pipe: jest.Mock;
  };
}

describe('WebSocketProxyService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('attaches only one listener per server and can detach/destroy', () => {
    const service = new WebSocketProxyService(config());
    const server1 = new EventEmitter() as unknown as http.Server;
    const server2 = new EventEmitter() as unknown as http.Server;
    const on1 = jest.spyOn(server1, 'on');
    const off1 = jest.spyOn(server1, 'off');

    service.attach(server1);
    service.attach(server1);
    expect(on1).toHaveBeenCalledTimes(1);

    service.attach(server2);
    expect(off1).toHaveBeenCalledWith('upgrade', expect.any(Function));

    const off2 = jest.spyOn(server2, 'off');
    service.onModuleDestroy();
    expect(off2).toHaveBeenCalledWith('upgrade', expect.any(Function));

    service.detach();
  });

  it('handles a partially attached state when detaching', () => {
    const service = new WebSocketProxyService(config());
    (service as any).server = new EventEmitter();
    (service as any).upgradeListener = undefined;

    expect(() => service.detach()).not.toThrow();
  });

  it('ignores non-Socket.IO upgrades and proxies Socket.IO upgrades', () => {
    const service = new WebSocketProxyService(config());
    const server = new EventEmitter() as unknown as http.Server;
    const proxyUpgrade = jest
      .spyOn(service as any, 'proxyUpgrade')
      .mockImplementation(() => undefined);
    service.attach(server);
    const client = socket();

    server.emit('upgrade', { url: undefined }, client, Buffer.alloc(0));
    server.emit('upgrade', { url: '/other' }, client, Buffer.alloc(0));
    expect(proxyUpgrade).not.toHaveBeenCalled();

    const request = { url: '/socket.io/?EIO=4&transport=websocket' };
    server.emit('upgrade', request, client, Buffer.from('head'));
    expect(proxyUpgrade).toHaveBeenCalledWith(
      request,
      client,
      Buffer.from('head'),
    );
  });

  it('proxies an HTTP WebSocket upgrade and preserves handshake headers', () => {
    const req = upstreamRequest();
    const service = new WebSocketProxyService(config());
    const requestSpy = jest.fn().mockReturnValue(req);
    (service as any).httpRequest = requestSpy;
    const client = socket();
    const upstream = socket();
    const incoming = {
      method: 'GET',
      url: '/socket.io/?EIO=4&transport=websocket',
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:5173',
        'x-user-id': 'forged-user',
        'x-user-role': 'admin',
        'x-forwarded-for': '1.2.3.4',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'evil.example',
        'x-optional': undefined,
      },
      socket: { remoteAddress: '10.0.0.5' },
    } as unknown as http.IncomingMessage;

    (service as any).proxyUpgrade(incoming, client, Buffer.from('client-head'));

    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'http:',
        hostname: 'message-service',
        port: '3004',
        method: 'GET',
        path: '/socket.io/?EIO=4&transport=websocket',
        timeout: 5000,
        headers: expect.objectContaining({
          host: 'message-service:3004',
          origin: 'http://localhost:5173',
        }),
      }),
    );
    const requestOptions = requestSpy.mock.calls[0][0] as http.RequestOptions;
    expect(requestOptions.headers).not.toHaveProperty('x-user-id');
    expect(requestOptions.headers).not.toHaveProperty('x-user-role');
    expect(requestOptions.headers).toHaveProperty(
      'x-forwarded-for',
      '10.0.0.5',
    );
    expect(requestOptions.headers).toHaveProperty('x-forwarded-proto', 'http');
    expect(requestOptions.headers).toHaveProperty(
      'x-forwarded-host',
      'localhost:3000',
    );
    expect(requestOptions.headers).not.toHaveProperty('x-optional');
    expect(req.end).toHaveBeenCalledTimes(1);

    const upstreamResponse = {
      statusCode: 101,
      statusMessage: 'Switching Protocols',
      headers: {
        upgrade: 'websocket',
        connection: 'Upgrade',
        'set-cookie': ['a=1', 'b=2'],
        'x-empty': undefined,
      },
    } as unknown as http.IncomingMessage;

    req.emit(
      'upgrade',
      upstreamResponse,
      upstream,
      Buffer.from('upstream-head'),
    );

    expect(String(client.write.mock.calls[0][0])).toContain(
      'HTTP/1.1 101 Switching Protocols',
    );
    expect(String(client.write.mock.calls[0][0])).toContain('set-cookie: a=1');
    expect(client.write.mock.calls).toContainEqual([
      Buffer.from('upstream-head'),
    ]);
    expect(upstream.write.mock.calls).toContainEqual([
      Buffer.from('client-head'),
    ]);
    expect(upstream.pipe.mock.calls).toEqual([[client]]);
    expect(client.pipe.mock.calls).toEqual([[upstream]]);
  });

  it('honors an existing X-Forwarded-For chain only when trustProxy is enabled', () => {
    const req = upstreamRequest();
    const service = new WebSocketProxyService(config({ trustProxy: true }));
    const requestSpy = jest.fn().mockReturnValue(req);
    (service as any).httpRequest = requestSpy;

    (service as any).proxyUpgrade(
      {
        method: 'GET',
        url: '/socket.io/',
        headers: {
          host: 'gateway.example',
          'x-forwarded-for': ['203.0.113.1, 203.0.113.2'],
          'x-forwarded-proto': 'https',
        },
        socket: { remoteAddress: '10.0.0.8' },
      },
      socket(),
      Buffer.alloc(0),
    );

    const requestOptions = requestSpy.mock.calls[0][0] as http.RequestOptions;
    expect(requestOptions.headers).toHaveProperty(
      'x-forwarded-for',
      '203.0.113.1, 203.0.113.2, 10.0.0.8',
    );
    expect(requestOptions.headers).toHaveProperty('x-forwarded-proto', 'https');
    expect(requestOptions.headers).toHaveProperty(
      'x-forwarded-host',
      'gateway.example',
    );
    expect((service as any).firstHeader('single')).toBe('single');
  });

  it('uses HTTPS defaults and GET/default Socket.IO path when values are absent', () => {
    const req = upstreamRequest();
    const service = new WebSocketProxyService(
      config({
        messageServiceUrl: 'https://message.example',
        trustProxy: true,
      }),
    );
    const requestSpy = jest.fn().mockReturnValue(req);
    (service as any).httpsRequest = requestSpy;

    (service as any).proxyUpgrade(
      {
        headers: {},
        socket: { encrypted: true },
      },
      socket(),
      Buffer.alloc(0),
    );

    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        protocol: 'https:',
        hostname: 'message.example',
        port: 443,
        method: 'GET',
        path: '/socket.io/',
        headers: expect.objectContaining({ 'x-forwarded-proto': 'https' }),
      }),
    );
  });

  it('uses port 80 for an HTTP target without an explicit port', () => {
    const req = upstreamRequest();
    const service = new WebSocketProxyService(
      config({ messageServiceUrl: 'http://message.example' }),
    );
    const requestSpy = jest.fn().mockReturnValue(req);
    (service as any).httpRequest = requestSpy;

    (service as any).proxyUpgrade({ headers: {} }, socket(), Buffer.alloc(0));

    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({ port: 80 }),
    );
  });

  it('handles an upgrade without buffered head bytes', () => {
    const req = upstreamRequest();
    const service = new WebSocketProxyService(config());
    (service as any).httpRequest = jest.fn().mockReturnValue(req);
    const client = socket();
    const upstream = socket();

    (service as any).proxyUpgrade(
      {
        method: 'GET',
        url: '/socket.io/',
        headers: {},
      },
      client,
      Buffer.alloc(0),
    );
    req.emit(
      'upgrade',
      { statusCode: 101, statusMessage: 'Switching Protocols', headers: {} },
      upstream,
      Buffer.alloc(0),
    );

    expect(client.write.mock.calls).toHaveLength(1);
    expect(upstream.write.mock.calls).toHaveLength(0);
  });

  it('relays a non-upgrade upstream HTTP response to the client', () => {
    const req = upstreamRequest();
    const service = new WebSocketProxyService(config());
    (service as any).httpRequest = jest.fn().mockReturnValue(req);
    const client = socket();
    const upstreamResponse = Object.assign(new EventEmitter(), {
      statusCode: undefined,
      statusMessage: undefined,
      headers: { 'content-type': 'text/plain' },
      pipe: jest.fn(),
    });

    (service as any).proxyUpgrade(
      {
        method: 'GET',
        url: '/socket.io/',
        headers: {},
      },
      client,
      Buffer.alloc(0),
    );
    req.emit('response', upstreamResponse);

    expect(String(client.write.mock.calls[0][0])).toContain(
      'HTTP/1.1 502 Bad Gateway',
    );
    expect(upstreamResponse.pipe).toHaveBeenCalledWith(client);
  });

  it('destroys an upstream request on timeout', () => {
    const req = upstreamRequest();
    const service = new WebSocketProxyService(config());
    (service as any).httpRequest = jest.fn().mockReturnValue(req);

    (service as any).proxyUpgrade(
      {
        method: 'GET',
        url: '/socket.io/',
        headers: {},
      },
      socket(),
      Buffer.alloc(0),
    );
    req.emit('timeout');

    expect(req.destroy).toHaveBeenCalledWith(expect.any(Error));
  });

  it.each([false, true])(
    'handles upstream errors when client destroyed=%s',
    (destroyed: boolean) => {
      const req = upstreamRequest();
      const service = new WebSocketProxyService(config());
      (service as any).httpRequest = jest.fn().mockReturnValue(req);
      const client = socket(destroyed);

      (service as any).proxyUpgrade(
        {
          method: 'GET',
          url: '/socket.io/',
          headers: {},
        },
        client,
        Buffer.alloc(0),
      );
      req.emit('error', new Error('offline'));

      if (destroyed) {
        expect(client.end.mock.calls).toHaveLength(0);
      } else {
        expect(client.end.mock.calls).toContainEqual([
          'HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n',
        ]);
      }
    },
  );

  it('serializes an explicit non-upgrade HTTP status', () => {
    const service = new WebSocketProxyService(config());
    const serialized = (service as any).serializeHttpResponse({
      statusCode: 400,
      statusMessage: 'Bad Request',
      headers: {},
    });
    expect(serialized).toBe('HTTP/1.1 400 Bad Request\r\n\r\n');
  });

  it('uses fallback 101 status text when upgrade response omits it', () => {
    const service = new WebSocketProxyService(config());
    const serialized = (service as any).serializeUpgradeResponse({
      statusCode: undefined,
      statusMessage: undefined,
      headers: {},
    });
    expect(serialized).toBe('HTTP/1.1 101 Switching Protocols\r\n\r\n');
  });
});
