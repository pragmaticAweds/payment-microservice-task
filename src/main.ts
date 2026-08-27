import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger, PinoLogger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApplication } from './app.setup';
import { createStartupLogContext } from './startup/startup-log';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  const config = app.get(ConfigService);

  app.useLogger(app.get(Logger));
  configureApplication(app);
  const port = config.getOrThrow<number>('PORT');
  const pinoLogger = app.get(PinoLogger);

  await app.listen(port);
  pinoLogger.info(createStartupLogContext(port), 'Payment service listening');
}
void bootstrap();
