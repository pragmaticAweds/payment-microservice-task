import { INestApplication, VersioningType } from '@nestjs/common';
import helmet from 'helmet';
import { configureSwagger } from './openapi/swagger';

export function configureApplication(app: INestApplication): void {
  app.use(helmet());
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
  configureSwagger(app);
  app.enableShutdownHooks();
}
