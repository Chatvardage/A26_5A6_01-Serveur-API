import {
  GatewayConfigService,
  resolveGatewayConfig,
} from './gateway-config.service';

describe('resolveGatewayConfig', () => {
  it('constructs the injectable service from process.env', () => {
    const names = [
      'PORT',
      'AUTH_SERVICE_URL',
      'ROOM_SERVICE_URL',
      'MESSAGE_SERVICE_URL',
      'USER_CONFIG_SERVICE_URL',
      'PROXY_TIMEOUT_MS',
      'MAX_PROXY_BODY_BYTES',
      'AUTH_RATE_LIMIT_WINDOW_MS',
      'AUTH_RATE_LIMIT_MAX',
      'CORS_ORIGINS',
      'TRUST_PROXY',
    ];
    const saved = Object.fromEntries(
      names.map((name) => [name, process.env[name]]),
    );
    try {
      for (const name of names) delete process.env[name];
      const service = new GatewayConfigService();
      expect(service.port).toBe(3000);
      expect(service.authServiceUrl).toBe('http://localhost:3001');
      expect(service.userConfigServiceUrl).toBe('http://localhost:3005');
      expect(service.trustProxy).toBe(false);
    } finally {
      for (const name of names) {
        const value = saved[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });

  it('uses the documented defaults', () => {
    expect(resolveGatewayConfig({})).toEqual({
      port: 3000,
      authServiceUrl: 'http://localhost:3001',
      roomServiceUrl: 'http://localhost:3003',
      messageServiceUrl: 'http://localhost:3004',
      userConfigServiceUrl: 'http://localhost:3005',
      proxyTimeoutMs: 5000,
      maxProxyBodyBytes: 1024 * 1024,
      authRateLimitWindowMs: 60_000,
      authRateLimitMax: 10,
      corsOrigins: ['http://localhost:5173'],
      trustProxy: false,
    });
  });

  it('parses custom values', () => {
    expect(
      resolveGatewayConfig({
        PORT: '3100',
        AUTH_SERVICE_URL: 'https://auth.internal:4001',
        ROOM_SERVICE_URL: 'http://room.internal:4003/',
        MESSAGE_SERVICE_URL: 'http://message.internal:4004',
        USER_CONFIG_SERVICE_URL: 'http://config.internal:4005',
        PROXY_TIMEOUT_MS: '7500',
        MAX_PROXY_BODY_BYTES: '2048',
        AUTH_RATE_LIMIT_WINDOW_MS: '30000',
        AUTH_RATE_LIMIT_MAX: '4',
        CORS_ORIGINS: 'https://app.example.com, null,https://admin.example.com',
        TRUST_PROXY: 'true',
      }),
    ).toEqual({
      port: 3100,
      authServiceUrl: 'https://auth.internal:4001',
      roomServiceUrl: 'http://room.internal:4003',
      messageServiceUrl: 'http://message.internal:4004',
      userConfigServiceUrl: 'http://config.internal:4005',
      proxyTimeoutMs: 7500,
      maxProxyBodyBytes: 2048,
      authRateLimitWindowMs: 30000,
      authRateLimitMax: 4,
      corsOrigins: [
        'https://app.example.com',
        'null',
        'https://admin.example.com',
      ],
      trustProxy: true,
    });
  });

  it.each([
    ['PORT', 'abc'],
    ['PROXY_TIMEOUT_MS', '0'],
    ['MAX_PROXY_BODY_BYTES', '-1'],
    ['AUTH_RATE_LIMIT_WINDOW_MS', '1.5'],
    ['AUTH_RATE_LIMIT_MAX', '9007199254740992'],
  ])(
    'rejects invalid positive integer %s=%s',
    (name: string, value: string) => {
      expect(() => resolveGatewayConfig({ [name]: value })).toThrow(
        `${name} doit être un entier positif`,
      );
    },
  );

  it.each([
    ['AUTH_SERVICE_URL', 'not-a-url', 'URL HTTP(S) valide'],
    ['ROOM_SERVICE_URL', 'ftp://rooms.local', 'HTTP ou HTTPS'],
    [
      'MESSAGE_SERVICE_URL',
      'http://message.local/base',
      'ne doit pas contenir',
    ],
    [
      'MESSAGE_SERVICE_URL',
      'http://message.local/?x=1',
      'ne doit pas contenir',
    ],
    ['MESSAGE_SERVICE_URL', 'http://message.local/#x', 'ne doit pas contenir'],
    ['USER_CONFIG_SERVICE_URL', 'ftp://config.local', 'HTTP ou HTTPS'],
  ])(
    'rejects invalid service URL %s=%s',
    (name: string, value: string, expected: string) => {
      expect(() => resolveGatewayConfig({ [name]: value })).toThrow(expected);
    },
  );

  it.each(['yes', 'TRUE', '1'])(
    'rejects invalid TRUST_PROXY=%s',
    (value: string) => {
      expect(() => resolveGatewayConfig({ TRUST_PROXY: value })).toThrow(
        'TRUST_PROXY doit valoir true ou false',
      );
    },
  );

  it('accepts TRUST_PROXY=false explicitly', () => {
    expect(resolveGatewayConfig({ TRUST_PROXY: 'false' }).trustProxy).toBe(
      false,
    );
  });

  it.each(['not-an-origin', 'ftp://example.com', 'https://example.com/path'])(
    'rejects invalid CORS origin %s',
    (origin: string) => {
      expect(() => resolveGatewayConfig({ CORS_ORIGINS: origin })).toThrow(
        'CORS_ORIGINS contient une origine invalide',
      );
    },
  );

  it('allows an empty CORS list', () => {
    expect(resolveGatewayConfig({ CORS_ORIGINS: ', , ' }).corsOrigins).toEqual(
      [],
    );
  });
});
