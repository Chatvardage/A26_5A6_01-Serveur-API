import { Injectable } from '@nestjs/common';
import { GatewayConfigService } from '../gateway/gateway-config.service';

export type UpstreamHealth = 'ok' | 'unavailable';

export interface GatewayHealthReport {
  status: 'ok' | 'degraded';
  service: 'serveur-api';
  upstreams: {
    auth: UpstreamHealth;
    room: UpstreamHealth;
    message: UpstreamHealth;
    userConfig: UpstreamHealth;
  };
  timestamp: string;
}

@Injectable()
export class HealthService {
  constructor(private readonly config: GatewayConfigService) {}

  async checkUpstreams(): Promise<GatewayHealthReport> {
    const [auth, room, message, userConfig] = await Promise.all([
      this.check(`${this.config.authServiceUrl}/health`),
      this.check(`${this.config.roomServiceUrl}/api/health`),
      this.check(`${this.config.messageServiceUrl}/api/health`),
      this.check(`${this.config.userConfigServiceUrl}/api/health`),
    ]);

    const upstreams = { auth, room, message, userConfig };

    return {
      status: Object.values(upstreams).includes('unavailable')
        ? 'degraded'
        : 'ok',
      service: 'serveur-api',
      upstreams,
      timestamp: new Date().toISOString(),
    };
  }

  private async check(url: string): Promise<UpstreamHealth> {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(this.config.proxyTimeoutMs),
      });
      return response.ok ? 'ok' : 'unavailable';
    } catch {
      return 'unavailable';
    }
  }
}
