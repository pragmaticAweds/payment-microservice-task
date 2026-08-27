import { INestApplication, VersioningType } from '@nestjs/common';
import helmet from 'helmet';
import { API_PREFIX, API_VERSION } from './api.constants';
import { configureSwagger } from './openapi/swagger';

export function configureApplication(app: INestApplication): void {
  app.use(helmet());
  app.setGlobalPrefix(API_PREFIX);
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: API_VERSION,
  });
  configureSwagger(app);
  app.enableShutdownHooks();
}
