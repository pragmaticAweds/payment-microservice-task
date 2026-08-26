import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { PaymentProcessor } from '../src/payments/processing/payment-processor';

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
  data: PaymentResource;
}

describe('Asynchronous payment processing (e2e)', () => {
  const validRequest = {
    smallestUnitAmount: 1050,
    currency: 'USD',
    merchantReference: 'processing-order-0001',
    description: 'Processing test payment',
  };
  let app: INestApplication<App> | undefined;

  async function createTestApp(options: {
    delayMs: number;
    successRate: number;
  }): Promise<INestApplication<App>> {
    const config = new ConfigService({
      NODE_ENV: 'test',
      SERVICE_NAME: 'node-payment-microservice',
      LOG_LEVEL: 'fatal',
      PROCESSING_DELAY_MS: options.delayMs,
      SIMULATED_SUCCESS_RATE: options.successRate,
    });
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfigService)
      .useValue(config)
      .compile();
    const testApp: INestApplication<App> =
      moduleFixture.createNestApplication();
    configureApplication(testApp);
    await testApp.init();

    return testApp;
  }

  async function waitForTerminalStatus(
    testApp: INestApplication<App>,
    paymentId: string,
  ): Promise<PaymentResource> {
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      const response = await request(testApp.getHttpServer())
        .get(`/api/v1/payments/${paymentId}`)
        .expect(200);
      const payment = (response.body as PaymentResponseBody).data;
      if (payment.status === 'succeeded' || payment.status === 'failed') {
        return payment;
      }

      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }

    throw new Error(`Payment ${paymentId} did not reach a terminal state`);
  }

  afterEach(async () => {
    if (app !== undefined) {
      await app.close();
      app = undefined;
    }
  });

  it('returns pending before completing asynchronously as succeeded', async () => {
    const testApp = await createTestApp({ delayMs: 25, successRate: 1 });
    app = testApp;
    const created = await request(testApp.getHttpServer())
      .post('/api/v1/payments')
      .set('Idempotency-Key', 'processing-success-key')
      .send(validRequest)
      .expect(201);
    const pending = (created.body as PaymentResponseBody).data;

    expect(pending.status).toBe('pending');
    await expect(
      waitForTerminalStatus(testApp, pending.id),
    ).resolves.toMatchObject({
      id: pending.id,
      status: 'succeeded',
    });
  });

  it('completes deterministically as failed at a zero success rate', async () => {
    const testApp = await createTestApp({ delayMs: 10, successRate: 0 });
    app = testApp;
    const created = await request(testApp.getHttpServer())
      .post('/api/v1/payments')
      .set('Idempotency-Key', 'processing-failure-key')
      .send(validRequest)
      .expect(201);
    const pending = (created.body as PaymentResponseBody).data;

    expect(pending.status).toBe('pending');
    await expect(
      waitForTerminalStatus(testApp, pending.id),
    ).resolves.toMatchObject({
      id: pending.id,
      status: 'failed',
    });
  });

  it('replays the original pending response without restarting processing', async () => {
    const testApp = await createTestApp({ delayMs: 10, successRate: 1 });
    app = testApp;
    const scheduleSpy = jest.spyOn(testApp.get(PaymentProcessor), 'schedule');
    const key = 'processing-replay-key';
    const original = await request(testApp.getHttpServer())
      .post('/api/v1/payments')
      .set('Idempotency-Key', key)
      .send(validRequest)
      .expect(201);
    const originalPayment = (original.body as PaymentResponseBody).data;

    expect(originalPayment.status).toBe('pending');
    await expect(
      waitForTerminalStatus(testApp, originalPayment.id),
    ).resolves.toMatchObject({
      id: originalPayment.id,
      status: 'succeeded',
    });

    const replay = await request(testApp.getHttpServer())
      .post('/api/v1/payments')
      .set('Idempotency-Key', key)
      .send(validRequest)
      .expect(201);

    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(original.body);
    expect(scheduleSpy).toHaveBeenCalledTimes(1);

    const current = await request(testApp.getHttpServer())
      .get(`/api/v1/payments/${originalPayment.id}`)
      .expect(200);
    expect((current.body as PaymentResponseBody).data.status).toBe('succeeded');
  });
});
