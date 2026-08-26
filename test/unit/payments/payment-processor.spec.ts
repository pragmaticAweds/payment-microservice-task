import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { PaymentsService } from '../../../src/payments/application/payments.service';
import {
  PaymentCurrency,
  PaymentStatus,
} from '../../../src/payments/domain/payment-status';
import type { PaymentOutcomeResolver } from '../../../src/payments/processing/payment-outcome-resolver';
import { PaymentProcessor } from '../../../src/payments/processing/payment-processor';
import { TimeoutProcessingScheduler } from '../../../src/payments/processing/timeout-processing.scheduler';
import { InMemoryPaymentRepository } from '../../../src/payments/repositories/in-memory-payment.repository';
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

  save(payment: Parameters<PaymentRepository['save']>[0]): Promise<void> {
    if (this.failedSavesRemaining > 0) {
      this.failedSavesRemaining -= 1;
      return Promise.reject(new Error('repository unavailable'));
    }

    return this.delegate.save(payment);
  }

  findById(id: string): ReturnType<PaymentRepository['findById']> {
    return this.delegate.findById(id);
  }
}

describe('PaymentProcessor', () => {
  const input = {
    smallestUnitAmount: 1050,
    currency: PaymentCurrency.USD,
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
    outcome?: PaymentStatus.SUCCEEDED | PaymentStatus.FAILED;
    repository?: PaymentRepository;
    resolver?: PaymentOutcomeResolver;
  }): { payments: PaymentsService; processor: PaymentProcessor } {
    const payments = new PaymentsService(
      options?.repository ?? new InMemoryPaymentRepository(),
      logger,
    );
    const resolver: PaymentOutcomeResolver = options?.resolver ?? {
      resolve: () => options?.outcome ?? PaymentStatus.SUCCEEDED,
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

  it('moves pending through processing after the configured delay', async () => {
    const { payments, processor } = createHarness();
    const payment = await payments.create(input);

    processor.schedule(payment, 'processor-key');

    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.PENDING,
    });
    await jest.advanceTimersByTimeAsync(0);
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.PROCESSING,
    });
    await jest.advanceTimersByTimeAsync(49);
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.PROCESSING,
    });
    await jest.advanceTimersByTimeAsync(1);
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.SUCCEEDED,
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
          outcome: PaymentStatus.SUCCEEDED,
          durationMs: 50,
        }),
      ]),
    );
    expect(JSON.stringify(infoLogs)).not.toContain('processor-key');
  });

  it('keeps a zero-delay job asynchronous', async () => {
    const { payments, processor } = createHarness({ delayMs: 0 });
    const payment = await payments.create(input);

    processor.schedule(payment, 'zero-delay-key');

    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.PENDING,
    });
    await jest.runAllTimersAsync();
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.SUCCEEDED,
    });
  });

  it('applies a failed outcome selected by the resolver', async () => {
    const { payments, processor } = createHarness({
      outcome: PaymentStatus.FAILED,
    });
    const payment = await payments.create(input);

    processor.schedule(payment, 'selected-failure-key');
    await jest.runAllTimersAsync();

    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.FAILED,
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

    processor.schedule(payment, 'resolver-failure-key');
    await jest.runAllTimersAsync();

    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.FAILED,
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

    processor.schedule(payment, 'transition-failure-key');
    await jest.runAllTimersAsync();

    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.FAILED,
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
    await payments.transition(payment.id, PaymentStatus.PROCESSING);

    processor.schedule(payment, 'already-processing-key');
    await jest.runAllTimersAsync();

    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.SUCCEEDED,
    });
  });

  it('stops without another transition when the payment is already terminal', async () => {
    const { payments, processor } = createHarness();
    const payment = await payments.create(input);
    await payments.transition(payment.id, PaymentStatus.PROCESSING);
    const succeeded = await payments.transition(
      payment.id,
      PaymentStatus.SUCCEEDED,
    );

    processor.schedule(payment, 'already-terminal-key');
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

    processor.schedule(payment, 'recovery-failure-key');
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

  it('cancels outstanding work and rejects new work during shutdown', async () => {
    const { payments, processor } = createHarness();
    const payment = await payments.create(input);
    processor.schedule(payment, 'shutdown-key');

    processor.onApplicationShutdown();

    expect(processor.isReady()).toBe(false);
    expect(() => processor.schedule(payment, 'late-key')).toThrow(
      'Payment processor is not accepting work',
    );
    await jest.runAllTimersAsync();
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.PENDING,
    });
  });
});
