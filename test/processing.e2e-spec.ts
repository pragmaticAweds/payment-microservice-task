import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import type { Payment } from '../src/payments/domain/payment/payment';
import { PAYMENT_STATUS } from '../src/payments/domain/payment/payment.constants';
import type { PaymentStatus } from '../src/payments/domain/payment/payment.types';
import { PROCESSING_SCHEDULER } from '../src/payments/processing/payment-processing.constants';
import type {
  ProcessingScheduler,
  ScheduledProcessingTask,
} from '../src/payments/processing/payment-processing.types';
import { InMemoryPaymentRepository } from '../src/payments/repositories/in-memory-payment.repository';
import { PAYMENT_REPOSITORY } from '../src/payments/repositories/payment-repository.constants';
import type { PaymentRepository } from '../src/payments/repositories/payment-repository.types';

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

interface DeferredSignal {
  promise: Promise<void>;
  resolve: () => void;
}

function createDeferredSignal(): DeferredSignal {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

class BlockingTransitionRepository implements PaymentRepository {
  private readonly delegate = new InMemoryPaymentRepository();
  private heldTransition:
    | {
        nextStatus: PaymentStatus;
        started: DeferredSignal;
        released: DeferredSignal;
      }
    | undefined;

  create(payment: Payment): Promise<void> {
    return this.delegate.create(payment);
  }

  findById(id: string): Promise<Payment | null> {
    return this.delegate.findById(id);
  }

  async transition(
    id: string,
    nextStatus: PaymentStatus,
  ): ReturnType<PaymentRepository['transition']> {
    const heldTransition = this.heldTransition;
    if (
      heldTransition !== undefined &&
      heldTransition.nextStatus === nextStatus
    ) {
      this.heldTransition = undefined;
      heldTransition.started.resolve();
      await heldTransition.released.promise;
    }

    return this.delegate.transition(id, nextStatus);
  }

  isReady(): Promise<boolean> {
    return this.delegate.isReady();
  }

  holdNextTransition(nextStatus: PaymentStatus): {
    started: Promise<void>;
    release: () => void;
  } {
    const started = createDeferredSignal();
    const released = createDeferredSignal();
    this.heldTransition = { nextStatus, started, released };

    return { started: started.promise, release: released.resolve };
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
  status: 'success';
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
    repository?: PaymentRepository;
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
    let moduleBuilder = Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(PROCESSING_SCHEDULER)
      .useValue(scheduler);
    if (options.repository !== undefined) {
      moduleBuilder = moduleBuilder
        .overrideProvider(PAYMENT_REPOSITORY)
        .useValue(options.repository);
    }
    const moduleFixture = await moduleBuilder.compile();
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

  it('returns 409 to a manual terminal patch when processor completion wins the race', async () => {
    const repository = new BlockingTransitionRepository();
    const { scheduler, testApp } = await createTestApp({
      delayMs: 25,
      repository,
      successRate: 1,
    });
    app = testApp;
    const created = await request(testApp.getHttpServer())
      .post('/api/v1/payments')
      .set('Idempotency-Key', 'processing-manual-race-key')
      .send(validRequest)
      .expect(201);
    const payment = (created.body as PaymentResponseBody).data;

    expect(scheduler.releaseNext()).toBe(0);
    await flushProcessorWork();
    expect(scheduler.pendingDelays()).toEqual([25]);

    const heldTransition = repository.holdNextTransition(PAYMENT_STATUS.FAILED);
    const manualResponse = request(testApp.getHttpServer())
      .patch(`/api/v1/payments/${payment.id}/status`)
      .send({ status: PAYMENT_STATUS.FAILED })
      .expect(409)
      .then((response) => response);
    await heldTransition.started;

    const terminalDelay = scheduler.releaseNext();
    await flushProcessorWork();
    heldTransition.release();
    expect(terminalDelay).toBe(25);
    const manual = await manualResponse;
    expect(manual.body).toMatchObject({
      status: 'error',
      code: 'INVALID_PAYMENT_TRANSITION',
      details: { from: 'succeeded', to: 'failed' },
      statusCode: 409,
    });

    const stored = await request(testApp.getHttpServer())
      .get(`/api/v1/payments/${payment.id}`)
      .expect(200);
    expect((stored.body as PaymentResponseBody).data.status).toBe('succeeded');
  });
});
