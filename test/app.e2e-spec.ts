import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApplication } from './../src/app.setup';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  it('GET /api/v1 identifies the running payment microservice', () => {
    return request(app.getHttpServer()).get('/api/v1').expect(200).expect({
      name: 'node-payment-microservice',
      status: 'ok',
    });
  });

  it('does not expose application routes outside the API boundary', () => {
    return request(app.getHttpServer()).get('/').expect(404);
  });

  it('propagates a caller-provided request ID', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1')
      .set('x-request-id', 'assessment-request-123')
      .expect(200);

    expect(response.headers['x-request-id']).toBe('assessment-request-123');
  });

  it('generates a request ID when the caller does not provide one', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1')
      .expect(200);

    expect(response.headers['x-request-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  afterEach(async () => {
    await app.close();
  });
});
