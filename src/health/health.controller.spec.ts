import { Response } from 'express';
import { HealthController } from './health.controller';
import { GatewayHealthReport, HealthService } from './health.service';

describe('HealthController', () => {
  it('returns Gateway liveness', () => {
    const controller = new HealthController({} as HealthService);
    const result = controller.liveness();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('serveur-api');
    expect(new Date(result.timestamp).toString()).not.toBe('Invalid Date');
  });

  it.each([
    ['ok', 200],
    ['degraded', 503],
  ] as const)(
    'maps upstream status %s to HTTP %s',
    async (status: 'ok' | 'degraded', expectedCode: number) => {
      const report: GatewayHealthReport = {
        status,
        service: 'serveur-api',
        upstreams: { auth: 'ok', room: 'ok', message: 'ok', userConfig: 'ok' },
        timestamp: '2026-09-18T10:00:00.000Z',
      };
      const health = {
        checkUpstreams: jest.fn().mockResolvedValue(report),
      } as unknown as HealthService;
      const statusMock = jest.fn().mockReturnThis();
      const response = { status: statusMock } as unknown as Response;

      await expect(
        new HealthController(health).upstreams(response),
      ).resolves.toBe(report);
      expect(statusMock).toHaveBeenCalledWith(expectedCode);
    },
  );
});
