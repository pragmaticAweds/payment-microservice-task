import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { validateEnvironment } from '../src/config/environment';
import { PaymentProcessor } from '../src/payments/processing/payment-processor';
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
} from '../src/payments/repositories/payment.repository';

interface ErrorResponseBody {
  statusCode: number;
  code: string;
  message: string;
  requestId: string;
  timestamp: string;
  path: string;
  details: {
    checks: {
      repository: 'ready' | 'not_ready';
      processor: 'ready' | 'not_ready';
    };
  };
}

interface OpenApiResponse {
  content?: Record<
    string,
    {
      schema?: {
        $ref?: string;
      };
    }
  >;
  headers?: Record<string, unknown>;
}

interface OpenApiOperation {
  responses: Record<string, OpenApiResponse>;
  tags?: string[];
}

interface OpenApiDocument {
  paths: Record<
    string,
    {
      get?: OpenApiOperation;
    }
  >;
  tags?: Array<{ name: string }>;
}

describe('Health probes (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const environment = validateEnvironment({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
    });
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(environment))
      .compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('exposes an exact versioned liveness response', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200);

    expect(response.body).toEqual({ data: { status: 'live' } });
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('exposes an exact versioned readiness response', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(200);

    expect(response.body).toEqual({
      data: {
        status: 'ready',
        checks: { repository: 'ready', processor: 'ready' },
      },
    });
    expect(response.headers['x-request-id']).toBeDefined();
  });

  it.each(['/health/live', '/health/ready'])(
    'does not expose an unversioned health probe at %s',
    async (path) => {
      await request(app.getHttpServer()).get(path).expect(404);
    },
  );

  it('returns the standard 503 envelope after the early processor readiness signal', async () => {
    const processor = app.get(PaymentProcessor);
    processor.beforeApplicationShutdown();

    const requestId = 'health-shutdown-request';
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .set('X-Request-Id', requestId)
      .expect(503);
    const body = response.body as ErrorResponseBody;

    expect(body).toEqual({
      statusCode: 503,
      code: 'SERVICE_NOT_READY',
      message: 'Service is not ready to accept payment work',
      requestId,
      timestamp: body.timestamp,
      path: '/api/v1/health/ready',
      details: {
        checks: { repository: 'ready', processor: 'not_ready' },
      },
    });
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(response.headers['x-request-id']).toBe(requestId);
    expect(JSON.stringify(body)).not.toContain('Payment processor');
  });

  it('returns a safe 503 when the repository readiness check throws', async () => {
    const repository = app.get<PaymentRepository>(PAYMENT_REPOSITORY);
    const readiness = jest
      .spyOn(repository, 'isReady')
      .mockRejectedValueOnce(new Error('database password must stay internal'));
    const requestId = 'health-repository-failure';

    try {
      const response = await request(app.getHttpServer())
        .get('/api/v1/health/ready')
        .set('X-Request-Id', requestId)
        .expect(503);
      const body = response.body as ErrorResponseBody;

      expect(body).toEqual({
        statusCode: 503,
        code: 'SERVICE_NOT_READY',
        message: 'Service is not ready to accept payment work',
        requestId,
        timestamp: body.timestamp,
        path: '/api/v1/health/ready',
        details: {
          checks: { repository: 'not_ready', processor: 'ready' },
        },
      });
      expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
      expect(JSON.stringify(body)).not.toContain('database password');
    } finally {
      readiness.mockRestore();
    }
  });

  it('documents only the versioned health paths and their response DTOs', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/docs-json')
      .expect(200);
    const document = response.body as OpenApiDocument;
    const live = document.paths['/api/v1/health/live']?.get;
    const ready = document.paths['/api/v1/health/ready']?.get;

    expect(document.tags).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'Health' })]),
    );
    expect(live?.tags).toContain('Health');
    expect(ready?.tags).toContain('Health');
    expect(
      live?.responses['200']?.content?.['application/json']?.schema,
    ).toEqual({ $ref: '#/components/schemas/HealthLivenessResponseDto' });
    expect(
      ready?.responses['200']?.content?.['application/json']?.schema,
    ).toEqual({ $ref: '#/components/schemas/HealthReadinessResponseDto' });
    expect(
      ready?.responses['503']?.content?.['application/json']?.schema,
    ).toEqual({ $ref: '#/components/schemas/HealthNotReadyResponseDto' });
    for (const documentedResponse of [
      live?.responses['200'],
      ready?.responses['200'],
      ready?.responses['503'],
    ]) {
      expect(documentedResponse?.headers).toHaveProperty('x-request-id');
    }
    expect(document.paths).not.toHaveProperty('/health/live');
    expect(document.paths).not.toHaveProperty('/health/ready');
  });

  it.each(['/docs', '/docs-json'])(
    'does not expose unversioned documentation at %s',
    (path) => request(app.getHttpServer()).get(path).expect(404),
  );
});
