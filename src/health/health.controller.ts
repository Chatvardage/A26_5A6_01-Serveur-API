import { Controller, Get, Res } from '@nestjs/common';
import { Response } from 'express';
import { HealthService } from './health.service';

@Controller('api/health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  liveness(): { status: 'ok'; service: 'serveur-api'; timestamp: string } {
    return {
      status: 'ok',
      service: 'serveur-api',
      timestamp: new Date().toISOString(),
    };
  }

  @Get('upstreams')
  async upstreams(@Res({ passthrough: true }) response: Response) {
    const report = await this.health.checkUpstreams();
    response.status(report.status === 'ok' ? 200 : 503);
    return report;
  }
}
