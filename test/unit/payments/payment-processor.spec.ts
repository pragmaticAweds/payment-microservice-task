import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { PinoLogger } from 'nestjs-pino';
import { PaymentsController } from '../../../src/payments/api/payments.controller';
import { PaymentCreationIdempotencyService } from '../../../src/payments/application/payment-creation-idempotency.service';
import { PaymentsService } from '../../../src/payments/application/payments.service';
import {
  PAYMENT_CURRENCY,
  PAYMENT_STATUS,
} from '../../../src/payments/domain/payment/payment.constants';
import type { PaymentOutcomeResolver } from '../../../src/payments/processing/payment-outcome-resolver';
import { PaymentProcessor } from '../../../src/payments/processing/payment-processor';
import { TimeoutProcessingScheduler } from '../../../src/payments/processing/timeout-processing.scheduler';
import { InMemoryPaymentRepository } from '../../../src/payments/repositories/in-memory-payment.repository';
import { InMemoryPaymentIdempotencyRepository } from '../../../src/payments/repositories/in-memory-payment-idempotency.repository';
import type { PaymentRepository } from '../../../src/payments/repositories/payment.repository';

interface TestLogMetadata {
  event?: unknown;
  paymentId?: unknown;
  delayMs?: unknown;
  keyHash?: unknown;
  outcome?: unknown;
  durationMs?: unknown;
  phase?: unknown;
  err?: unknown;
}

class ToggleFailureRepository implements PaymentRepository {
  private readonly delegate = new InMemoryPaymentRepository();
  failedSavesRemaining = 0;

  create(payment: Parameters<PaymentRepository['create']>[0]): Promise<void> {
    if (this.failedSavesRemaining > 0) {
      this.failedSavesRemaining -= 1;
      return Promise.reject(new Error('repository unavailable'));
    }

    return this.delegate.create(payment);
  }

  findById(id: string): ReturnType<PaymentRepository['findById']> {
    return this.delegate.findById(id);
  }

  transition(
    ...args: Parameters<PaymentRepository['transition']>
  ): ReturnType<PaymentRepository['transition']> {
    if (this.failedSavesRemaining > 0) {
      this.failedSavesRemaining -= 1;
      return Promise.reject(new Error('repository unavailable'));
    }

    return this.delegate.transition(...args);
  }

  isReady(): Promise<boolean> {
    return this.delegate.isReady();
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

class BlockingReadRepository implements PaymentRepository {
  private readonly delegate = new InMemoryPaymentRepository();
  private heldRead:
    { started: DeferredSignal; released: DeferredSignal } | undefined;

  create(payment: Parameters<PaymentRepository['create']>[0]): Promise<void> {
    return this.delegate.create(payment);
  }

  async findById(id: string): ReturnType<PaymentRepository['findById']> {
    const heldRead = this.heldRead;
    if (heldRead !== undefined) {
      this.heldRead = undefined;
      heldRead.started.resolve();
      await heldRead.released.promise;
    }

    return this.delegate.findById(id);
  }

  transition(
    ...args: Parameters<PaymentRepository['transition']>
  ): ReturnType<PaymentRepository['transition']> {
    return this.delegate.transition(...args);
  }

  isReady(): Promise<boolean> {
    return this.delegate.isReady();
  }

  holdNextRead(): { started: Promise<void>; release: () => void } {
    const started = createDeferredSignal();
    const released = createDeferredSignal();
    this.heldRead = { started, released };

    return { started: started.promise, release: released.resolve };
  }
}

class BlockingSaveRepository implements PaymentRepository {
  private readonly delegate = new InMemoryPaymentRepository();
  private heldSave:
    { started: DeferredSignal; released: DeferredSignal } | undefined;

  async create(
    payment: Parameters<PaymentRepository['create']>[0],
  ): Promise<void> {
    const heldSave = this.heldSave;
    if (heldSave !== undefined) {
      this.heldSave = undefined;
      heldSave.started.resolve();
      await heldSave.released.promise;
    }

    return this.delegate.create(payment);
  }

  findById(id: string): ReturnType<PaymentRepository['findById']> {
    return this.delegate.findById(id);
  }

  transition(
    ...args: Parameters<PaymentRepository['transition']>
  ): ReturnType<PaymentRepository['transition']> {
    return this.delegate.transition(...args);
  }

  isReady(): Promise<boolean> {
    return this.delegate.isReady();
  }

  holdNextSave(): { started: Promise<void>; release: () => void } {
    const started = createDeferredSignal();
    const released = createDeferredSignal();
    this.heldSave = { started, released };

    return { started: started.promise, release: released.resolve };
  }
}

describe('PaymentProcessor', () => {
  const input = {
    smallestUnitAmount: 1050,
    currency: PAYMENT_CURRENCY.USD,
    merchantReference: 'processor-order',
  };
  let infoLogs: TestLogMetadata[];
  let errorLogs: TestLogMetadata[];
  let logger: PinoLogger;

  beforeEach(() => {
    jest.useFakeTimers();
    infoLogs = [];
    errorLogs = [];
    logger = {
      info: (metadata: TestLogMetadata): void => {
        infoLogs.push(metadata);
      },
      error: (metadata: TestLogMetadata): void => {
        errorLogs.push(metadata);
      },
    } as unknown as PinoLogger;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createHarness(options?: {
    delayMs?: number;
    outcome?: typeof PAYMENT_STATUS.SUCCEEDED | typeof PAYMENT_STATUS.FAILED;
    repository?: PaymentRepository;
    resolver?: PaymentOutcomeResolver;
  }): { payments: PaymentsService; processor: PaymentProcessor } {
    const payments = new PaymentsService(
      options?.repository ?? new InMemoryPaymentRepository(),
      logger,
    );
    const resolver: PaymentOutcomeResolver = options?.resolver ?? {
      resolve: () => options?.outcome ?? PAYMENT_STATUS.SUCCEEDED,
    };
    const processor = new PaymentProcessor(
      payments,
      new TimeoutProcessingScheduler(),
      resolver,
      new ConfigService({ PROCESSING_DELAY_MS: options?.delayMs ?? 50 }),
      logger,
    );

    return { payments, processor };
  }

  async function schedulePayment(
    processor: PaymentProcessor,
    payment: Parameters<PaymentProcessor['schedule']>[0],
    idempotencyKey: string,
  ): Promise<void> {
    await processor.runWithAdmission((admission) => {
      admission.schedule(payment, idempotencyKey);
      return Promise.resolve();
    });
  }

  it('moves pending through processing after the configured delay', async () => {
    const { payments, processor } = createHarness();
    const payment = await payments.create(input);

    await schedulePayment(processor, payment, 'processor-key');

    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PAYMENT_STATUS.PENDING,
    });
    await jest.advanceTimersByTimeAsync(0);
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PAYMENT_STATUS.PROCESSING,
    });
    await jest.advanceTimersByTimeAsync(49);
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PAYMENT_STATUS.PROCESSING,
    });
    await jest.advanceTimersByTimeAsync(1);
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PAYMENT_STATUS.SUCCEEDED,
    });

    const scheduledLog = infoLogs.find(
      (metadata) => metadata.event === 'payment.processing_scheduled',
    );
    expect(scheduledLog).toMatchObject({
      event: 'payment.processing_scheduled',
      paymentId: payment.id,
      delayMs: 50,
    });
    expect(scheduledLog?.keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(infoLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'payment.processing_completed',
          paymentId: payment.id,
          outcome: PAYMENT_STATUS.SUCCEEDED,
          durationMs: 50,
        }),
      ]),
    );
    expect(JSON.stringify(infoLogs)).not.toContain('processor-key');
  });

  it('keeps a zero-delay job asynchronous', async () => {
    const { payments, processor } = createHarness({ delayMs: 0 });
    const payment = await payments.create(input);

    await schedulePayment(processor, payment, 'zero-delay-key');

    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PAYMENT_STATUS.PENDING,
    });
    await jest.runAllTimersAsync();
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PAYMENT_STATUS.SUCCEEDED,
    });
  });

  it('applies a failed outcome selected by the resolver', async () => {
    const { payments, processor } = createHarness({
      outcome: PAYMENT_STATUS.FAILED,
    });
    const payment = await payments.create(input);

    await schedulePayment(processor, payment, 'selected-failure-key');
    await jest.runAllTimersAsync();

    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PAYMENT_STATUS.FAILED,
    });
  });

  it('recovers a resolver failure to failed without an unhandled rejection', async () => {
    const resolver: PaymentOutcomeResolver = {
      resolve: () => {
        throw new Error('resolver unavailable');
      },
    };
    const { payments, processor } = createHarness({ resolver });
    const payment = await payments.create(input);

    await schedulePayment(processor, payment, 'resolver-failure-key');
    await jest.runAllTimersAsync();

    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PAYMENT_STATUS.FAILED,
    });
    const failureLog = errorLogs.find(
      (metadata) => metadata.event === 'payment.processing_failed',
    );
    expect(failureLog).toMatchObject({
      event: 'payment.processing_failed',
      phase: 'completing',
    });
    expect(failureLog?.err).toBeInstanceOf(Error);
  });

  it('recovers a transition persistence failure when storage becomes available', async () => {
    const repository = new ToggleFailureRepository();
    const { payments, processor } = createHarness({ repository });
    const payment = await payments.create(input);
    repository.failedSavesRemaining = 1;

    await schedulePayment(processor, payment, 'transition-failure-key');
    await jest.runAllTimersAsync();

    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PAYMENT_STATUS.FAILED,
    });
    expect(errorLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'payment.processing_failed',
          phase: 'starting',
        }),
      ]),
    );
  });

  it('continues from processing when another caller already made that transition', async () => {
    const { payments, processor } = createHarness();
    const payment = await payments.create(input);
    await payments.transition(payment.id, PAYMENT_STATUS.PROCESSING);

    await schedulePayment(processor, payment, 'already-processing-key');
    await jest.runAllTimersAsync();

    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PAYMENT_STATUS.SUCCEEDED,
    });
  });

  it('stops without another transition when the payment is already terminal', async () => {
    const { payments, processor } = createHarness();
    const payment = await payments.create(input);
    await payments.transition(payment.id, PAYMENT_STATUS.PROCESSING);
    const succeeded = await payments.transition(
      payment.id,
      PAYMENT_STATUS.SUCCEEDED,
    );

    await schedulePayment(processor, payment, 'already-terminal-key');
    await jest.runAllTimersAsync();

    await expect(payments.findById(payment.id)).resolves.toEqual(succeeded);
    expect(errorLogs).toHaveLength(0);
    expect(infoLogs).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'payment.processing_completed' }),
      ]),
    );
  });

  it('logs and consumes a recovery persistence failure', async () => {
    const repository = new ToggleFailureRepository();
    const { payments, processor } = createHarness({ repository });
    const payment = await payments.create(input);
    repository.failedSavesRemaining = Number.POSITIVE_INFINITY;

    await schedulePayment(processor, payment, 'recovery-failure-key');
    await jest.runAllTimersAsync();
    await Promise.resolve();

    const failureLog = errorLogs.find(
      (metadata) => metadata.event === 'payment.processing_failed',
    );
    const recoveryFailureLog = errorLogs.find(
      (metadata) => metadata.event === 'payment.processing_recovery_failed',
    );
    expect(failureLog).toMatchObject({ event: 'payment.processing_failed' });
    expect(recoveryFailureLog).toMatchObject({
      event: 'payment.processing_recovery_failed',
    });
    expect(recoveryFailureLog?.err).toBeInstanceOf(Error);
  });

  it('reports an early drain while allowing admitted work to complete', async () => {
    const { payments, processor } = createHarness();
    const payment = await payments.create(input);

    processor.beforeApplicationShutdown();

    expect(processor.isReady()).toBe(false);
    await expect(
      schedulePayment(processor, payment, 'draining-key'),
    ).resolves.toBeUndefined();
    await jest.runAllTimersAsync();
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PAYMENT_STATUS.SUCCEEDED,
    });
  });

  it('drains an admitted controller creation through scheduling and idempotency persistence', async () => {
    const repository = new BlockingSaveRepository();
    const { payments, processor } = createHarness({ repository });
    const idempotencyRepository = new InMemoryPaymentIdempotencyRepository();
    const idempotency = new PaymentCreationIdempotencyService(
      idempotencyRepository,
      logger,
    );
    const controller = new PaymentsController(payments, idempotency, processor);
    const heldSave = repository.holdNextSave();
    const key = 'admitted-controller-shutdown-key';
    const creation = controller.create(key, input, {
      setHeader: jest.fn(),
    } as unknown as Response);
    await heldSave.started;

    let shutdownSettled = false;
    const firstShutdown = processor.onApplicationShutdown();
    const secondShutdown = processor.onApplicationShutdown();
    void firstShutdown.then(() => {
      shutdownSettled = true;
    });
    await jest.runAllTimersAsync();
    const settledBeforeRelease = shutdownSettled;
    const sharedShutdownPromise = firstShutdown === secondShutdown;

    heldSave.release();
    const creationOutcome = await creation.then(
      (result) => ({ result }),
      (error: unknown) => ({ error }),
    );
    await firstShutdown;
    const idempotencyRecord = await idempotencyRepository.findByKey(key);

    expect({
      creationCompleted: 'result' in creationOutcome,
      idempotencyRecordSaved: idempotencyRecord !== null,
      settledBeforeRelease,
      sharedShutdownPromise,
    }).toEqual({
      creationCompleted: true,
      idempotencyRecordSaved: true,
      settledBeforeRelease: false,
      sharedShutdownPromise: true,
    });
    expect(creationOutcome).toMatchObject({
      result: { data: { status: PAYMENT_STATUS.PENDING } },
    });
    expect(idempotencyRecord).toMatchObject({
      key,
      response: { status: PAYMENT_STATUS.PENDING },
    });
  });

  it('rejects a new creation admission after final shutdown starts', async () => {
    const { processor } = createHarness();
    const shutdown = processor.onApplicationShutdown();

    expect(() => processor.runWithAdmission(() => Promise.resolve())).toThrow(
      'Payment processor is not accepting work',
    );
    await shutdown;
  });

  it('awaits in-flight work and fails processing when final shutdown blocks its terminal timer', async () => {
    const repository = new BlockingReadRepository();
    const { payments, processor } = createHarness({ repository });
    const payment = await payments.create(input);
    const heldRead = repository.holdNextRead();
    await schedulePayment(processor, payment, 'in-flight-shutdown-key');
    await jest.advanceTimersByTimeAsync(0);
    await heldRead.started;

    let shutdownSettled = false;
    const shutdown = Promise.resolve(processor.onApplicationShutdown()).then(
      () => {
        shutdownSettled = true;
      },
    );
    await Promise.resolve();
    const settledBeforeRelease = shutdownSettled;

    heldRead.release();
    await shutdown;
    await jest.runAllTimersAsync();

    expect(settledBeforeRelease).toBe(false);
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PAYMENT_STATUS.FAILED,
    });
  });

  it('fails a processing payment when final shutdown cancels its completion timer', async () => {
    const { payments, processor } = createHarness();
    const payment = await payments.create(input);
    await schedulePayment(processor, payment, 'queued-completion-key');
    await jest.advanceTimersByTimeAsync(0);
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PAYMENT_STATUS.PROCESSING,
    });

    await processor.onApplicationShutdown();

    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PAYMENT_STATUS.FAILED,
    });
  });

  it('logs and consumes a canceled-completion recovery failure', async () => {
    const repository = new ToggleFailureRepository();
    const { payments, processor } = createHarness({ repository });
    const payment = await payments.create(input);
    await schedulePayment(processor, payment, 'queued-recovery-failure-key');
    await jest.advanceTimersByTimeAsync(0);
    repository.failedSavesRemaining = Number.POSITIVE_INFINITY;

    await expect(processor.onApplicationShutdown()).resolves.toBeUndefined();

    const recoveryFailureLog = errorLogs.find(
      (metadata) =>
        metadata.event === 'payment.processing_shutdown_recovery_failed',
    );
    expect(recoveryFailureLog).toMatchObject({
      event: 'payment.processing_shutdown_recovery_failed',
      paymentId: payment.id,
      phase: 'completing',
    });
    expect(recoveryFailureLog?.err).toBeInstanceOf(Error);
  });

  it('cancels queued work and rejects new schedules during final shutdown', async () => {
    const { payments, processor } = createHarness();
    const payment = await payments.create(input);
    await schedulePayment(processor, payment, 'shutdown-key');

    processor.beforeApplicationShutdown();
    await processor.onApplicationShutdown();
    await processor.onApplicationShutdown();

    expect(processor.isReady()).toBe(false);
    expect(() => processor.runWithAdmission(() => Promise.resolve())).toThrow(
      'Payment processor is not accepting work',
    );
    await jest.runAllTimersAsync();
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PAYMENT_STATUS.PENDING,
    });
  });
});
