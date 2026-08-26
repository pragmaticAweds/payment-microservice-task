import { INestApplication, VersioningType } from '@nestjs/common';
import helmet from 'helmet';

export function configureApplication(app: INestApplication): void {
  app.use(helmet());
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
  app.enableShutdownHooks();
}
