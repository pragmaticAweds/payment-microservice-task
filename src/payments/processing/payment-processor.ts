import { createHash } from 'node:crypto';
import {
  BeforeApplicationShutdown,
  Inject,
  Injectable,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { PaymentsService } from '../application/payments.service';
import type { Payment } from '../domain/payment/payment';
import { PAYMENT_STATUS } from '../domain/payment/payment.constants';
import {
  PAYMENT_OUTCOME_RESOLVER,
  PROCESSING_SCHEDULER,
} from './payment-processing.constants';
import type {
  PaymentCreationAdmission,
  PaymentOutcomeResolver,
  ProcessingContext,
  ProcessingScheduler,
  ScheduledProcessingTask,
} from './payment-processing.types';

@Injectable()
export class PaymentProcessor
  implements BeforeApplicationShutdown, OnApplicationShutdown
{
  private readonly delayMs: number;
  private readonly scheduledTasks = new Map<
    ScheduledProcessingTask,
    ProcessingContext
  >();
  private readonly activeAdmissionTokens = new WeakSet<object>();
  private readonly admittedCreations = new Set<Promise<void>>();
  private readonly inFlightWork = new Set<Promise<void>>();
  private ready = true;
  private acceptingAdmissions = true;
  private stopped = false;
  private shutdownPromise: Promise<void> | undefined;

  constructor(
    private readonly payments: PaymentsService,
    @Inject(PROCESSING_SCHEDULER)
    private readonly scheduler: ProcessingScheduler,
    @Inject(PAYMENT_OUTCOME_RESOLVER)
    private readonly outcomeResolver: PaymentOutcomeResolver,
    config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.delayMs = config.getOrThrow<number>('PROCESSING_DELAY_MS');
  }

  runWithAdmission<T>(
    work: (admission: PaymentCreationAdmission) => Promise<T>,
  ): Promise<T> {
    if (!this.acceptingAdmissions) {
      throw new Error('Payment processor is not accepting work');
    }

    const token = {};
    this.activeAdmissionTokens.add(token);
    const operation = Promise.resolve().then(() =>
      work({
        schedule: (payment, idempotencyKey) =>
          this.schedule(payment, idempotencyKey, token),
      }),
    );
    const tracked = operation.then(
      () => {
        this.activeAdmissionTokens.delete(token);
      },
      () => {
        this.activeAdmissionTokens.delete(token);
      },
    );
    this.admittedCreations.add(tracked);
    void tracked.then(() => this.admittedCreations.delete(tracked));

    return operation;
  }

  schedule(
    payment: Payment,
    idempotencyKey: string,
    admissionToken: object,
  ): void {
    if (this.stopped || !this.activeAdmissionTokens.has(admissionToken)) {
      throw new Error('Payment processor is not accepting work');
    }

    const context: ProcessingContext = {
      paymentId: payment.id,
      idempotencyKey,
      keyHash: createHash('sha256').update(idempotencyKey).digest('hex'),
      smallestUnitAmount: payment.smallestUnitAmount,
      currency: payment.currency,
      startedAt: Date.now(),
      phase: 'starting',
    };

    this.logger.info(
      {
        event: 'payment.processing_scheduled',
        paymentId: payment.id,
        delayMs: this.delayMs,
        keyHash: context.keyHash,
      },
      'Payment processing scheduled',
    );
    this.register(0, context, () => this.startProcessing(context));
  }

  isReady(): boolean {
    return this.ready;
  }

  beforeApplicationShutdown(): void {
    this.ready = false;
  }

  onApplicationShutdown(): Promise<void> {
    this.ready = false;
    this.acceptingAdmissions = false;
    this.shutdownPromise ??= this.drainAdmissionsAndStop();
    return this.shutdownPromise;
  }

  private async drainAdmissionsAndStop(): Promise<void> {
    await Promise.all([...this.admittedCreations]);
    this.stopped = true;
    const recoveries: Promise<void>[] = [];
    for (const [task, context] of this.scheduledTasks) {
      if (!this.scheduledTasks.delete(task)) {
        continue;
      }
      task.cancel();
      if (context.phase === 'completing') {
        recoveries.push(this.recoverCanceledCompletion(context));
      }
    }
    await Promise.all(recoveries);
    await Promise.all([...this.inFlightWork]);
  }

  private register(
    delayMs: number,
    context: ProcessingContext,
    work: () => Promise<void>,
  ): boolean {
    if (this.stopped) {
      return false;
    }

    let scheduled: ScheduledProcessingTask | undefined = undefined;
    scheduled = this.scheduler.schedule(delayMs, () => {
      if (scheduled === undefined || !this.scheduledTasks.delete(scheduled)) {
        return;
      }
      const processing = Promise.resolve()
        .then(work)
        .catch((error: unknown) => this.handleFailure(context, error));
      this.inFlightWork.add(processing);
      void processing.then(
        () => this.inFlightWork.delete(processing),
        () => this.inFlightWork.delete(processing),
      );
    });
    this.scheduledTasks.set(scheduled, context);
    return true;
  }

  private async startProcessing(context: ProcessingContext): Promise<void> {
    let current = await this.payments.findById(context.paymentId);
    if (
      current.status === PAYMENT_STATUS.SUCCEEDED ||
      current.status === PAYMENT_STATUS.FAILED
    ) {
      return;
    }
    if (current.status === PAYMENT_STATUS.PENDING) {
      current = await this.payments.transition(
        context.paymentId,
        PAYMENT_STATUS.PROCESSING,
      );
    }
    if (current.status !== PAYMENT_STATUS.PROCESSING) {
      return;
    }

    const terminalContext: ProcessingContext = {
      ...context,
      phase: 'completing',
      startedAt: Date.now(),
    };
    const registered = this.register(this.delayMs, terminalContext, () =>
      this.completeProcessing(terminalContext),
    );
    if (!registered) {
      await this.transitionActivePaymentToFailed(context.paymentId);
    }
  }

  private async completeProcessing(context: ProcessingContext): Promise<void> {
    const current = await this.payments.findById(context.paymentId);
    if (current.status !== PAYMENT_STATUS.PROCESSING) {
      return;
    }

    const outcome = this.outcomeResolver.resolve({
      idempotencyKey: context.idempotencyKey,
      smallestUnitAmount: context.smallestUnitAmount,
      currency: context.currency,
    });
    await this.payments.transition(context.paymentId, outcome);
    this.logger.info(
      {
        event: 'payment.processing_completed',
        paymentId: context.paymentId,
        outcome,
        durationMs: Date.now() - context.startedAt,
      },
      'Payment processing completed',
    );
  }

  private async handleFailure(
    context: ProcessingContext,
    error: unknown,
  ): Promise<void> {
    this.logger.error(
      {
        event: 'payment.processing_failed',
        paymentId: context.paymentId,
        phase: context.phase,
        durationMs: Date.now() - context.startedAt,
        err:
          error instanceof Error
            ? error
            : new Error('Unknown processing failure'),
      },
      'Payment processing failed',
    );

    try {
      await this.transitionActivePaymentToFailed(context.paymentId);
    } catch (recoveryError) {
      this.logger.error(
        {
          event: 'payment.processing_recovery_failed',
          paymentId: context.paymentId,
          err:
            recoveryError instanceof Error
              ? recoveryError
              : new Error('Unknown processing recovery failure'),
        },
        'Payment processing recovery failed',
      );
    }
  }

  private async transitionActivePaymentToFailed(
    paymentId: string,
  ): Promise<void> {
    let current = await this.payments.findById(paymentId);
    if (current.status === PAYMENT_STATUS.PENDING) {
      current = await this.payments.transition(
        paymentId,
        PAYMENT_STATUS.PROCESSING,
      );
    }
    if (current.status === PAYMENT_STATUS.PROCESSING) {
      await this.payments.transition(paymentId, PAYMENT_STATUS.FAILED);
    }
  }

  private async recoverCanceledCompletion(
    context: ProcessingContext,
  ): Promise<void> {
    try {
      await this.transitionActivePaymentToFailed(context.paymentId);
    } catch (recoveryError) {
      this.logger.error(
        {
          event: 'payment.processing_shutdown_recovery_failed',
          paymentId: context.paymentId,
          phase: context.phase,
          err:
            recoveryError instanceof Error
              ? recoveryError
              : new Error('Unknown shutdown recovery failure'),
        },
        'Payment processing shutdown recovery failed',
      );
    }
  }
}
