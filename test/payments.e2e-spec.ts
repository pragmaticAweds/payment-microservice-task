import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'superagent';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import {
  type PaymentCreationAdmission,
  PaymentProcessor,
} from '../src/payments/processing/payment-processor';

interface PaymentResource {
  id: string;
  smallestUnitAmount: number;
  currency: 'USD';
  merchantReference: string;
  description?: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  createdAt: string;
  updatedAt: string;
}

interface PaymentResponseBody {
  status: 'success';
  data: PaymentResource;
}

interface ErrorResponseBody {
  status: 'error';
  statusCode: number;
  code: string;
  message: string;
  requestId: string;
  timestamp: string;
  path: string;
  details?: unknown;
}

interface OpenApiSchemaProperty {
  enum?: string[];
  example?: unknown;
  format?: string;
  maximum?: number;
  maxLength?: number;
  minimum?: number;
  minLength?: number;
  type?: string;
}

interface OpenApiSchema {
  properties?: Record<string, OpenApiSchemaProperty>;
  required?: string[];
}

interface OpenApiResponse {
  headers?: Record<string, unknown>;
}

interface OpenApiOperation {
  parameters?: Array<{
    in: string;
    name: string;
    required?: boolean;
  }>;
  requestBody?: {
    content: Record<string, { schema: unknown }>;
  };
  responses: Record<string, OpenApiResponse>;
  tags?: string[];
}

interface OpenApiDocument {
  openapi: string;
  info: {
    title: string;
    version: string;
  };
  paths: Record<
    string,
    {
      get?: OpenApiOperation;
      patch?: OpenApiOperation;
      post?: OpenApiOperation;
    }
  >;
  components: {
    schemas: Record<string, OpenApiSchema>;
  };
}

describe('Payments API (e2e)', () => {
  const validRequest = {
    smallestUnitAmount: 1050,
    currency: 'USD',
    merchantReference: ' order-2026-0001 ',
    description: ' Invoice 0001 ',
  };

  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PaymentProcessor)
      .useValue({
        runWithAdmission: <T>(
          work: (admission: PaymentCreationAdmission) => Promise<T>,
        ): Promise<T> => work({ schedule: () => undefined }),
        isReady: () => true,
        beforeApplicationShutdown: () => undefined,
        onApplicationShutdown: () => Promise.resolve(),
      } satisfies Pick<
        PaymentProcessor,
        | 'runWithAdmission'
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
    await app.close();
  });

  async function createPayment(
    requestBody: Record<string, unknown> = validRequest,
    idempotencyKey: string = randomUUID(),
  ): Promise<Response> {
    return request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Idempotency-Key', idempotencyKey)
      .send(requestBody)
      .expect(201);
  }

  function expectErrorEnvelope(
    response: Response,
    expected: {
      statusCode: number;
      code: string;
      path: string;
      details?: unknown;
    },
  ): ErrorResponseBody {
    const body = response.body as ErrorResponseBody;

    expect(body).toMatchObject({
      status: 'error',
      statusCode: expected.statusCode,
      code: expected.code,
      requestId: response.headers['x-request-id'],
      path: expected.path,
      ...(expected.details === undefined ? {} : { details: expected.details }),
    });
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);

    return body;
  }

  async function createTerminalPayment(
    terminalStatus: 'succeeded' | 'failed',
  ): Promise<string> {
    const created = await createPayment();
    const id = (created.body as PaymentResponseBody).data.id;

    await request(app.getHttpServer())
      .patch(`/api/v1/payments/${id}/status`)
      .send({ status: 'processing' })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/v1/payments/${id}/status`)
      .send({ status: terminalStatus })
      .expect(200);

    return id;
  }

  it('creates and retrieves a payment through data envelopes', async () => {
    const created = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('x-request-id', 'create-payment-request')
      .set('Idempotency-Key', randomUUID())
      .send(validRequest)
      .expect(201);
    const createdBody = created.body as PaymentResponseBody;

    expect(created.headers['x-request-id']).toBe('create-payment-request');
    expect(typeof createdBody.data.id).toBe('string');
    expect(typeof createdBody.data.createdAt).toBe('string');
    expect(typeof createdBody.data.updatedAt).toBe('string');
    expect(createdBody).toEqual({
      status: 'success',
      data: {
        id: createdBody.data.id,
        smallestUnitAmount: 1050,
        currency: 'USD',
        merchantReference: 'order-2026-0001',
        description: 'Invoice 0001',
        status: 'pending',
        createdAt: createdBody.data.createdAt,
        updatedAt: createdBody.data.updatedAt,
      },
    });
    expect(Number.isNaN(Date.parse(createdBody.data.createdAt))).toBe(false);
    expect(createdBody.data.updatedAt).toBe(createdBody.data.createdAt);

    const retrieved = await request(app.getHttpServer())
      .get(`/api/v1/payments/${createdBody.data.id}`)
      .expect(200);

    expect(retrieved.body).toEqual(createdBody);
  });

  it('omits a blank optional description after normalization', async () => {
    const created = await createPayment({
      ...validRequest,
      description: '   ',
    });

    expect((created.body as PaymentResponseBody).data).not.toHaveProperty(
      'description',
    );
  });

  it('rejects payment creation without an idempotency key', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .send(validRequest)
      .expect(400);

    expectErrorEnvelope(response, {
      statusCode: 400,
      code: 'INVALID_IDEMPOTENCY_KEY',
      path: '/api/v1/payments',
    });
  });

  it.each(['contains spaces', 'contains/slash', 'x'.repeat(129)])(
    'rejects invalid idempotency key %s',
    async (idempotencyKey) => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/payments')
        .set('Idempotency-Key', idempotencyKey)
        .send(validRequest)
        .expect(400);

      expectErrorEnvelope(response, {
        statusCode: 400,
        code: 'INVALID_IDEMPOTENCY_KEY',
        path: '/api/v1/payments',
      });
    },
  );

  it('replays the original response for the same key and payload', async () => {
    const key = 'sequential-replay-key';
    const original = await createPayment(validRequest, key);
    const replay = await createPayment(
      {
        ...validRequest,
        merchantReference: 'order-2026-0001',
        description: 'Invoice 0001',
      },
      key,
    );

    expect(replay.body).toEqual(original.body);
    expect(original.headers['idempotency-replayed']).toBeUndefined();
    expect(replay.headers['idempotency-replayed']).toBe('true');
  });

  it('replays the creation response after the payment status changes', async () => {
    const key = 'original-response-key';
    const original = await createPayment(validRequest, key);
    const originalBody = original.body as PaymentResponseBody;

    await request(app.getHttpServer())
      .patch(`/api/v1/payments/${originalBody.data.id}/status`)
      .send({ status: 'processing' })
      .expect(200);
    const replay = await createPayment(validRequest, key);

    expect(replay.body).toEqual(original.body);
    expect((replay.body as PaymentResponseBody).data.status).toBe('pending');
    expect(replay.headers['idempotency-replayed']).toBe('true');
  });

  it('returns 409 when a key is reused with a different payload', async () => {
    const key = 'conflicting-payload-key';
    await createPayment(validRequest, key);

    const response = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Idempotency-Key', key)
      .send({ ...validRequest, smallestUnitAmount: 1051 })
      .expect(409);

    expectErrorEnvelope(response, {
      statusCode: 409,
      code: 'IDEMPOTENCY_CONFLICT',
      path: '/api/v1/payments',
    });
  });

  it('coalesces concurrent same-key requests into one response', async () => {
    const key = 'concurrent-replay-key';
    const sendCreation = (): Promise<Response> =>
      request(app.getHttpServer())
        .post('/api/v1/payments')
        .set('Idempotency-Key', key)
        .send(validRequest);

    const [first, second] = await Promise.all([sendCreation(), sendCreation()]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body).toEqual(first.body);
    expect(
      [first, second].filter(
        (response) => response.headers['idempotency-replayed'] === 'true',
      ),
    ).toHaveLength(1);
  });

  it.each([
    [{ smallestUnitAmount: 0 }, 'smallestUnitAmount'],
    [{ smallestUnitAmount: 10.5 }, 'smallestUnitAmount'],
    [{ smallestUnitAmount: Number.MAX_SAFE_INTEGER + 1 }, 'smallestUnitAmount'],
    [{ currency: 'EUR' }, 'currency'],
    [{ merchantReference: '   ' }, 'merchantReference'],
    [{ merchantReference: 'x'.repeat(101) }, 'merchantReference'],
    [{ description: null }, 'description'],
    [{ description: 'x'.repeat(501) }, 'description'],
    [{ unexpected: true }, 'unexpected'],
  ])(
    'rejects invalid creation input containing %s',
    async (override, expectedDetail) => {
      const response = await request(app.getHttpServer())
        .post('/api/v1/payments')
        .set('x-request-id', 'invalid-payment-request')
        .set('Idempotency-Key', randomUUID())
        .send({ ...validRequest, ...override })
        .expect(400);
      const body = expectErrorEnvelope(response, {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        path: '/api/v1/payments',
      });

      expect(body.requestId).toBe('invalid-payment-request');
      expect(body.message).toBe('Validation failed');
      expect(JSON.stringify(body.details)).toContain(expectedDetail);
    },
  );

  it('rejects missing required creation fields', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Idempotency-Key', randomUUID())
      .send({ currency: 'USD' })
      .expect(400);
    const body = expectErrorEnvelope(response, {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      path: '/api/v1/payments',
    });

    expect(JSON.stringify(body.details)).toContain('smallestUnitAmount');
    expect(JSON.stringify(body.details)).toContain('merchantReference');
  });

  it('returns 400 for malformed UUIDs on retrieval and transition', async () => {
    const retrievePath = '/api/v1/payments/not-a-uuid';
    const retrieve = await request(app.getHttpServer())
      .get(retrievePath)
      .expect(400);
    expectErrorEnvelope(retrieve, {
      statusCode: 400,
      code: 'BAD_REQUEST',
      path: retrievePath,
    });

    const transitionPath = '/api/v1/payments/not-a-uuid/status';
    const transition = await request(app.getHttpServer())
      .patch(transitionPath)
      .send({ status: 'processing' })
      .expect(400);
    expectErrorEnvelope(transition, {
      statusCode: 400,
      code: 'BAD_REQUEST',
      path: transitionPath,
    });
  });

  it('returns 404 for an unknown payment UUID', async () => {
    const path = `/api/v1/payments/${randomUUID()}`;
    const response = await request(app.getHttpServer()).get(path).expect(404);

    expectErrorEnvelope(response, {
      statusCode: 404,
      code: 'PAYMENT_NOT_FOUND',
      path,
    });
  });

  it('transitions a payment from pending through processing to succeeded', async () => {
    const created = await createPayment();
    const id = (created.body as PaymentResponseBody).data.id;
    const path = `/api/v1/payments/${id}/status`;

    const processing = await request(app.getHttpServer())
      .patch(path)
      .send({ status: 'processing' })
      .expect(200);
    const processingBody = processing.body as PaymentResponseBody;
    expect(processingBody.data).toMatchObject({
      id,
      status: 'processing',
    });

    const succeeded = await request(app.getHttpServer())
      .patch(path)
      .send({ status: 'succeeded' })
      .expect(200);
    const succeededBody = succeeded.body as PaymentResponseBody;
    expect(succeededBody.data).toMatchObject({
      id,
      status: 'succeeded',
    });
  });

  it('transitions a payment from pending through processing to failed', async () => {
    const created = await createPayment();
    const id = (created.body as PaymentResponseBody).data.id;
    const path = `/api/v1/payments/${id}/status`;

    await request(app.getHttpServer())
      .patch(path)
      .send({ status: 'processing' })
      .expect(200);
    const failed = await request(app.getHttpServer())
      .patch(path)
      .send({ status: 'failed' })
      .expect(200);

    const failedBody = failed.body as PaymentResponseBody;
    expect(failedBody.data).toMatchObject({
      id,
      status: 'failed',
    });
  });

  it('rejects pending as a transition target with 400', async () => {
    const created = await createPayment();
    const path = `/api/v1/payments/${
      (created.body as PaymentResponseBody).data.id
    }/status`;
    const response = await request(app.getHttpServer())
      .patch(path)
      .send({ status: 'pending' })
      .expect(400);

    expectErrorEnvelope(response, {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      path,
    });
  });

  it.each(['succeeded', 'failed'] as const)(
    'returns 409 when pending skips directly to %s',
    async (status) => {
      const created = await createPayment();
      const path = `/api/v1/payments/${
        (created.body as PaymentResponseBody).data.id
      }/status`;
      const response = await request(app.getHttpServer())
        .patch(path)
        .send({ status })
        .expect(409);

      expectErrorEnvelope(response, {
        statusCode: 409,
        code: 'INVALID_PAYMENT_TRANSITION',
        path,
        details: { from: 'pending', to: status },
      });
    },
  );

  it('returns 409 for a repeated processing transition', async () => {
    const created = await createPayment();
    const path = `/api/v1/payments/${
      (created.body as PaymentResponseBody).data.id
    }/status`;

    await request(app.getHttpServer())
      .patch(path)
      .send({ status: 'processing' })
      .expect(200);
    const response = await request(app.getHttpServer())
      .patch(path)
      .send({ status: 'processing' })
      .expect(409);

    expectErrorEnvelope(response, {
      statusCode: 409,
      code: 'INVALID_PAYMENT_TRANSITION',
      path,
      details: { from: 'processing', to: 'processing' },
    });
  });

  it.each([
    ['succeeded', 'processing'],
    ['succeeded', 'succeeded'],
    ['succeeded', 'failed'],
    ['failed', 'processing'],
    ['failed', 'succeeded'],
    ['failed', 'failed'],
  ] as const)(
    'returns 409 when terminal %s attempts to transition to %s',
    async (from, to) => {
      const id = await createTerminalPayment(from);
      const path = `/api/v1/payments/${id}/status`;
      const response = await request(app.getHttpServer())
        .patch(path)
        .send({ status: to })
        .expect(409);

      expectErrorEnvelope(response, {
        statusCode: 409,
        code: 'INVALID_PAYMENT_TRANSITION',
        path,
        details: { from, to },
      });
    },
  );

  it('returns 404 when transitioning an unknown payment', async () => {
    const path = `/api/v1/payments/${randomUUID()}/status`;
    const response = await request(app.getHttpServer())
      .patch(path)
      .send({ status: 'processing' })
      .expect(404);

    expectErrorEnvelope(response, {
      statusCode: 404,
      code: 'PAYMENT_NOT_FOUND',
      path,
    });
  });

  it('serves Swagger UI and a versioned OpenAPI document', async () => {
    const html = await request(app.getHttpServer())
      .get('/api/v1/docs')
      .expect(200);

    expect(html.headers['content-type']).toContain('text/html');
    expect(html.text).toContain('Swagger UI');

    const response = await request(app.getHttpServer())
      .get('/api/v1/docs-json')
      .expect(200);
    const document = response.body as OpenApiDocument;

    expect(document.openapi).toMatch(/^3\./);
    expect(document.info).toMatchObject({
      title: 'Node Payment Microservice',
      version: '1.0.0',
    });
    expect(document.paths['/api/v1/payments']?.post).toBeDefined();
    expect(document.paths['/api/v1/payments/{id}']?.get).toBeDefined();
    expect(document.paths['/api/v1/payments/{id}/status']?.patch).toBeDefined();
  });

  it('documents payment schemas, request IDs, and every response code', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/docs-json')
      .expect(200);
    const document = response.body as OpenApiDocument;
    const create = document.paths['/api/v1/payments']?.post;
    const retrieve = document.paths['/api/v1/payments/{id}']?.get;
    const transition = document.paths['/api/v1/payments/{id}/status']?.patch;

    expect(create).toBeDefined();
    expect(retrieve).toBeDefined();
    expect(transition).toBeDefined();

    for (const operation of [create!, retrieve!, transition!]) {
      expect(operation.tags).toContain('Payments');
      expect(operation.parameters).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            in: 'header',
            name: 'X-Request-Id',
            required: false,
          }),
        ]),
      );
      for (const documentedResponse of Object.values(operation.responses)) {
        expect(documentedResponse.headers).toHaveProperty('x-request-id');
      }
    }

    expect(create?.requestBody?.content['application/json']?.schema).toEqual({
      $ref: '#/components/schemas/CreatePaymentDto',
    });
    expect(create?.responses).toHaveProperty('201');
    expect(create?.responses).toHaveProperty('400');
    expect(create?.responses).toHaveProperty('409');
    expect(retrieve?.responses).toHaveProperty('200');
    expect(retrieve?.responses).toHaveProperty('400');
    expect(retrieve?.responses).toHaveProperty('404');
    expect(transition?.responses).toHaveProperty('200');
    expect(transition?.responses).toHaveProperty('400');
    expect(transition?.responses).toHaveProperty('404');
    expect(transition?.responses).toHaveProperty('409');
    expect(create?.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          in: 'header',
          name: 'Idempotency-Key',
          required: true,
        }),
      ]),
    );
    expect(create?.responses['201']?.headers).toHaveProperty(
      'Idempotency-Replayed',
    );

    const createSchema = document.components.schemas.CreatePaymentDto;
    expect(createSchema?.required).toEqual(
      expect.arrayContaining([
        'smallestUnitAmount',
        'currency',
        'merchantReference',
      ]),
    );
    expect(createSchema?.properties?.smallestUnitAmount).toMatchObject({
      example: 1050,
      minimum: 1,
      maximum: Number.MAX_SAFE_INTEGER,
    });
    expect(createSchema?.properties?.currency).toMatchObject({
      enum: ['USD'],
      example: 'USD',
    });
    expect(createSchema?.properties?.merchantReference).toMatchObject({
      example: 'order-2026-0001',
      minLength: 1,
      maxLength: 100,
    });
    expect(createSchema?.properties?.description).toMatchObject({
      example: 'Invoice 0001',
      maxLength: 500,
    });
    expect(
      document.components.schemas.UpdatePaymentStatusDto?.properties?.status
        ?.enum,
    ).toEqual(['processing', 'succeeded', 'failed']);
    expect(document.components.schemas).toHaveProperty(
      'PaymentDataResponseDto',
    );
    expect(document.components.schemas).toHaveProperty('PaymentResponseDto');
    expect(document.components.schemas).toHaveProperty('ErrorResponseDto');
    expect(
      document.components.schemas.PaymentDataResponseDto?.properties?.status
        ?.enum,
    ).toEqual(['success']);
    expect(
      document.components.schemas.PaymentResponseDto?.properties?.status?.enum,
    ).toEqual(['pending', 'processing', 'succeeded', 'failed']);
    expect(
      document.components.schemas.ErrorResponseDto?.properties?.status?.enum,
    ).toEqual(['error']);
    expect(document.components.schemas).toHaveProperty('AppResponseDto');
  });
});
