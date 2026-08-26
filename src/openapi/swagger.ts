import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Node Payment Microservice')
    .setDescription(
      'Versioned API for creating, retrieving, and transitioning simulated payments.',
    )
    .setVersion('1.0.0')
    .addTag('Payments', 'Payment creation, retrieval, and state transitions')
    .build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
    raw: ['json'],
  });
}
