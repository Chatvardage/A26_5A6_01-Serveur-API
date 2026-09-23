import { GatewayConfigService } from '../gateway/gateway-config.service';
import { HealthService } from './health.service';

function requestTargetToString(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

describe('HealthService', () => {
  const config = {
    authServiceUrl: 'http://auth:3001',
    roomServiceUrl: 'http://room:3003',
    messageServiceUrl: 'http://message:3004',
    userConfigServiceUrl: 'http://config:3005',
    proxyTimeoutMs: 50,
  } as GatewayConfigService;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reports ok when every upstream is healthy', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('ok', { status: 200 }));

    const report = await new HealthService(config).checkUpstreams();

    expect(report.status).toBe('ok');
    expect(report.service).toBe('serveur-api');
    expect(report.upstreams).toEqual({
      auth: 'ok',
      room: 'ok',
      message: 'ok',
      userConfig: 'ok',
    });
    expect(new Date(report.timestamp).toString()).not.toBe('Invalid Date');
    expect(
      fetchMock.mock.calls.map((call: [RequestInfo | URL, RequestInit?]) =>
        requestTargetToString(call[0]),
      ),
    ).toEqual([
      'http://auth:3001/health',
      'http://room:3003/api/health',
      'http://message:3004/api/health',
      'http://config:3005/api/health',
    ]);
  });

  it('releases each upstream connection by cancelling the response body', async () => {
    const responses = [200, 503, 200, 500].map(
      (status) => new Response('body', { status }),
    );
    const cancels = responses.map((response) =>
      jest.spyOn(response.body as ReadableStream, 'cancel'),
    );
    const fetchMock = jest.spyOn(global, 'fetch');
    for (const response of responses) {
      fetchMock.mockResolvedValueOnce(response);
    }

    await new HealthService(config).checkUpstreams();

    for (const cancel of cancels) {
      expect(cancel.mock.calls).toHaveLength(1);
    }
  });

  it('handles an upstream response without a body', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockImplementation(() =>
        Promise.resolve(new Response(null, { status: 204 })),
      );

    const report = await new HealthService(config).checkUpstreams();

    expect(report.status).toBe('ok');
  });

  it('reports degraded for non-2xx and network errors', async () => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(new Response('bad', { status: 503 }))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }))
      .mockResolvedValueOnce(new Response('bad', { status: 500 }));

    const report = await new HealthService(config).checkUpstreams();

    expect(report.status).toBe('degraded');
    expect(report.upstreams).toEqual({
      auth: 'unavailable',
      room: 'unavailable',
      message: 'ok',
      userConfig: 'unavailable',
    });
  });
});
