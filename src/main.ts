import { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as http from 'node:http';
import { AppModule } from './app.module';
import { GatewayConfigService } from './gateway/gateway-config.service';
import { HttpProxyService } from './gateway/http-proxy.service';
import { WebSocketProxyService } from './gateway/websocket-proxy.service';

export async function createApplication(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const proxy = app.get(HttpProxyService);
  app.use(proxy.handle);
  return app;
}

export async function bootstrap(): Promise<void> {
  const app = await createApplication();
  const config = app.get(GatewayConfigService);
  const webSocketProxy = app.get(WebSocketProxyService);

  app.enableShutdownHooks();
  webSocketProxy.attach(app.getHttpServer() as http.Server);
  await app.listen(config.port, '0.0.0.0');
}

if (require.main === module) {
  void bootstrap();
}
