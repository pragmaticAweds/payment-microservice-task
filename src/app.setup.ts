import {
  INestApplication,
  RequestMethod,
  VersioningType,
} from '@nestjs/common';
import helmet from 'helmet';
import { configureSwagger } from './openapi/swagger';

export function configureApplication(app: INestApplication): void {
  app.use(helmet());
  app.setGlobalPrefix('api', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
  configureSwagger(app);
  app.enableShutdownHooks();
}
