import { Module } from '@nestjs/common';
import { AuthRateLimitService } from './gateway/auth-rate-limit.service';
import { GatewayConfigService } from './gateway/gateway-config.service';
import { HttpProxyService } from './gateway/http-proxy.service';
import { WebSocketProxyService } from './gateway/websocket-proxy.service';
import { HealthController } from './health/health.controller';
import { HealthService } from './health/health.service';

@Module({
  controllers: [HealthController],
  providers: [
    GatewayConfigService,
    AuthRateLimitService,
    HttpProxyService,
    WebSocketProxyService,
    HealthService,
  ],
})
export class AppModule {}
