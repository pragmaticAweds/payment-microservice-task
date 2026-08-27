import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app/app.module';
import { configureApplication } from './app/app.setup';
import { listenAndLogStartup } from './startup/startup-log';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.useLogger(app.get(Logger));
  configureApplication(app);
  const port = config.getOrThrow<number>('PORT');

  await listenAndLogStartup(app, port);
}
void bootstrap();
