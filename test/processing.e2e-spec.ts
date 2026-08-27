import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import {
  PROCESSING_SCHEDULER,
  type ProcessingScheduler,
  type ScheduledProcessingTask,
} from '../src/payments/processing/processing-scheduler';

interface ControlledTask {
  canceled: boolean;
  delayMs: number;
  run: () => void;
}

class ControlledProcessingScheduler implements ProcessingScheduler {
  private readonly tasks: ControlledTask[] = [];
  private scheduledCount = 0;

  schedule(delayMs: number, run: () => void): ScheduledProcessingTask {
    const task: ControlledTask = { canceled: false, delayMs, run };
    this.tasks.push(task);
    this.scheduledCount += 1;
    return {
      cancel: () => {
        task.canceled = true;
      },
    };
  }

  get totalScheduled(): number {
    return this.scheduledCount;
  }

  pendingDelays(): number[] {
    return this.tasks
      .filter((task) => !task.canceled)
      .map((task) => task.delayMs);
  }

  releaseNext(): number {
    while (this.tasks.length > 0) {
      const task = this.tasks.shift();
      if (task !== undefined && !task.canceled) {
        task.run();
        return task.delayMs;
      }
    }
    throw new Error('No controlled processing task is pending');
  }
}

async function flushProcessorWork(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function releaseProcessing(
  scheduler: ControlledProcessingScheduler,
  terminalDelayMs: number,
): Promise<void> {
  expect(scheduler.pendingDelays()).toEqual([0]);
  expect(scheduler.releaseNext()).toBe(0);
  await flushProcessorWork();
  expect(scheduler.pendingDelays()).toEqual([terminalDelayMs]);
  expect(scheduler.releaseNext()).toBe(terminalDelayMs);
  await flushProcessorWork();
}

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
  }): Promise<{
    scheduler: ControlledProcessingScheduler;
    testApp: INestApplication<App>;
  }> {
    const scheduler = new ControlledProcessingScheduler();
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
      .overrideProvider(PROCESSING_SCHEDULER)
      .useValue(scheduler)
      .compile();
    const testApp: INestApplication<App> =
      moduleFixture.createNestApplication();
    configureApplication(testApp);
    await testApp.init();

    return { scheduler, testApp };
  }

  afterEach(async () => {
    if (app !== undefined) {
      await app.close();
      app = undefined;
    }
  });

  it('returns pending before completing asynchronously as succeeded', async () => {
    const { scheduler, testApp } = await createTestApp({
      delayMs: 25,
      successRate: 1,
    });
    app = testApp;
    const created = await request(testApp.getHttpServer())
      .post('/api/v1/payments')
      .set('Idempotency-Key', 'processing-success-key')
      .send(validRequest)
      .expect(201);
    const pending = (created.body as PaymentResponseBody).data;

    expect(pending.status).toBe('pending');
    await releaseProcessing(scheduler, 25);

    const terminal = await request(testApp.getHttpServer())
      .get(`/api/v1/payments/${pending.id}`)
      .expect(200);
    expect((terminal.body as PaymentResponseBody).data).toMatchObject({
      id: pending.id,
      status: 'succeeded',
    });
  });

  it('completes deterministically as failed at a zero success rate', async () => {
    const { scheduler, testApp } = await createTestApp({
      delayMs: 10,
      successRate: 0,
    });
    app = testApp;
    const created = await request(testApp.getHttpServer())
      .post('/api/v1/payments')
      .set('Idempotency-Key', 'processing-failure-key')
      .send(validRequest)
      .expect(201);
    const pending = (created.body as PaymentResponseBody).data;

    expect(pending.status).toBe('pending');
    await releaseProcessing(scheduler, 10);

    const terminal = await request(testApp.getHttpServer())
      .get(`/api/v1/payments/${pending.id}`)
      .expect(200);
    expect((terminal.body as PaymentResponseBody).data).toMatchObject({
      id: pending.id,
      status: 'failed',
    });
  });

  it('replays the original pending response without restarting processing', async () => {
    const { scheduler, testApp } = await createTestApp({
      delayMs: 10,
      successRate: 1,
    });
    app = testApp;
    const key = 'processing-replay-key';
    const original = await request(testApp.getHttpServer())
      .post('/api/v1/payments')
      .set('Idempotency-Key', key)
      .send(validRequest)
      .expect(201);
    const originalPayment = (original.body as PaymentResponseBody).data;

    expect(originalPayment.status).toBe('pending');
    await releaseProcessing(scheduler, 10);
    expect(scheduler.totalScheduled).toBe(2);

    const replay = await request(testApp.getHttpServer())
      .post('/api/v1/payments')
      .set('Idempotency-Key', key)
      .send(validRequest)
      .expect(201);

    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(original.body);
    expect(scheduler.totalScheduled).toBe(2);

    const current = await request(testApp.getHttpServer())
      .get(`/api/v1/payments/${originalPayment.id}`)
      .expect(200);
    expect((current.body as PaymentResponseBody).data.status).toBe('succeeded');
  });
});
