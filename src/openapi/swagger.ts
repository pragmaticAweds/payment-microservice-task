import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_BASE_PATH } from '../api.constants';

export function configureSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Node Payment Microservice')
    .setDescription(
      'Versioned API for creating, retrieving, and transitioning simulated payments.',
    )
    .setVersion('1.0.0')
    .addTag('Payments', 'Payment creation, retrieval, and state transitions')
    .addTag('Health', 'Service liveness and payment-work readiness probes')
    .build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup(`${API_BASE_PATH}/docs`, app, document, {
    jsonDocumentUrl: `${API_BASE_PATH}/docs-json`,
    raw: ['json'],
  });
}
