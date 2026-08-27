import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Response } from 'superagent';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { validateEnvironment } from '../src/config/environment';
import { PaymentProcessor } from '../src/payments/processing/payment-processor';

interface ErrorResponseBody {
  statusCode: number;
  code: string;
  message: string;
  requestId: string;
  timestamp: string;
  path: string;
}

interface PaymentResponseBody {
  data: {
    id: string;
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
}

interface OpenApiDocument {
  paths: Record<
    string,
    {
      post?: OpenApiOperation;
    }
  >;
}

describe('Rate limiting (e2e)', () => {
  const validRequest = {
    smallestUnitAmount: 1050,
    currency: 'USD',
    merchantReference: 'rate-limit-order-0001',
    description: 'Rate limit test payment',
  };

  let app: INestApplication<App> | undefined;

  beforeEach(async () => {
    const environment = validateEnvironment({
      NODE_ENV: 'test',
      LOG_LEVEL: 'fatal',
      THROTTLE_TTL_MS: 60_000,
      THROTTLE_LIMIT: 3,
      PAYMENT_CREATE_THROTTLE_LIMIT: 1,
    });
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(environment))
      .overrideProvider(PaymentProcessor)
      .useValue({
        schedule: () => undefined,
        isReady: () => true,
        beforeApplicationShutdown: () => undefined,
        onApplicationShutdown: () => Promise.resolve(),
      } satisfies Pick<
        PaymentProcessor,
        | 'schedule'
        | 'isReady'
        | 'beforeApplicationShutdown'
        | 'onApplicationShutdown'
      >)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterEach(async () => {
    if (app !== undefined) {
      await app.close();
      app = undefined;
    }
  });

  function expectRateLimitEnvelope(
    response: Response,
    expectedRequestId: string,
    expectedPath: string,
  ): void {
    const body = response.body as ErrorResponseBody;

    expect(body).toEqual({
      statusCode: 429,
      code: 'TOO_MANY_REQUESTS',
      message: 'Rate limit exceeded',
      requestId: expectedRequestId,
      timestamp: body.timestamp,
      path: expectedPath,
    });
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(response.headers['x-request-id']).toBe(expectedRequestId);
  }

  function expectBoundedSecondsHeader(
    response: Response,
    headerName: string,
  ): number {
    const rawValue = response.headers[headerName] as unknown;

    expect(typeof rawValue).toBe('string');
    if (typeof rawValue !== 'string') {
      throw new Error(`Expected ${headerName} to be a string response header`);
    }

    const durationSeconds = Number(rawValue);
    expect(Number.isInteger(durationSeconds)).toBe(true);
    expect(durationSeconds).toBeGreaterThan(0);
    expect(durationSeconds).toBeLessThanOrEqual(60);

    return durationSeconds;
  }

  it('allows normal traffic through the general limit before returning a standard 429 response', async () => {
    for (let requestNumber = 1; requestNumber <= 3; requestNumber += 1) {
      const response = await request(app!.getHttpServer())
        .get('/api/v1')
        .expect(200);

      expect(response.headers['x-ratelimit-limit']).toBe('3');
    }

    const requestId = 'general-rate-limit-request';
    const response = await request(app!.getHttpServer())
      .get('/api/v1')
      .set('X-Request-Id', requestId)
      .expect(429);

    expectRateLimitEnvelope(response, requestId, '/api/v1');
    expect(response.headers['retry-after']).toBeDefined();
    expect(response.headers['x-ratelimit-limit']).toBe('3');
    expect(response.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('applies the stricter payment creation policy only to the create handler', async () => {
    const created = await request(app!.getHttpServer())
      .post('/api/v1/payments')
      .set('Idempotency-Key', 'rate-limit-create-key-1')
      .send(validRequest)
      .expect(201);
    const createdBody = created.body as PaymentResponseBody;

    expect(typeof createdBody.data.id).toBe('string');
    expect(created.headers['x-ratelimit-limit-payment-create']).toBe('1');
    expect(created.headers['x-ratelimit-remaining-payment-create']).toBe('0');
    expectBoundedSecondsHeader(created, 'x-ratelimit-reset-payment-create');

    const requestId = 'payment-create-rate-limit-request';
    const path = '/api/v1/payments';
    const response = await request(app!.getHttpServer())
      .post(path)
      .set('X-Request-Id', requestId)
      .set('Idempotency-Key', 'rate-limit-create-key-2')
      .send({
        ...validRequest,
        merchantReference: 'rate-limit-order-0002',
      })
      .expect(429);

    expectRateLimitEnvelope(response, requestId, path);
    expect(response.headers['x-ratelimit-limit']).toBe('1');
    expect(response.headers['x-ratelimit-remaining']).toBe('0');
    const retryAfterSeconds = expectBoundedSecondsHeader(
      response,
      'retry-after',
    );
    const namedRetryAfterSeconds = expectBoundedSecondsHeader(
      response,
      'retry-after-payment-create',
    );
    expect(retryAfterSeconds).toBe(namedRetryAfterSeconds);

    const retrieved = await request(app!.getHttpServer())
      .get(`/api/v1/payments/${createdBody.data.id}`)
      .expect(200);

    expect(retrieved.headers['x-ratelimit-limit']).toBe('3');
    expect(
      retrieved.headers['x-ratelimit-limit-payment-create'],
    ).toBeUndefined();
  });

  it('documents payment creation rate limits and the standard 429 schema', async () => {
    const response = await request(app!.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const document = response.body as OpenApiDocument;
    const create = document.paths['/api/v1/payments']?.post;

    expect(create).toBeDefined();
    expect(
      create?.responses['429']?.content?.['application/json']?.schema,
    ).toEqual({
      $ref: '#/components/schemas/ErrorResponseDto',
    });

    const createdHeaders = create?.responses['201']?.headers;
    expect(createdHeaders).toBeDefined();
    for (const header of [
      'x-request-id',
      'Idempotency-Replayed',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'X-RateLimit-Limit-payment-create',
      'X-RateLimit-Remaining-payment-create',
      'X-RateLimit-Reset-payment-create',
    ]) {
      expect(createdHeaders).toHaveProperty(header);
    }

    const throttledHeaders = create?.responses['429']?.headers;
    expect(throttledHeaders).toBeDefined();
    for (const header of [
      'x-request-id',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
      'Retry-After-payment-create',
    ]) {
      expect(throttledHeaders).toHaveProperty(header);
    }
  });
});
