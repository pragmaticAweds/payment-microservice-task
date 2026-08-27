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
import type { Payment } from '../domain/payment';
import { PaymentStatus } from '../domain/payment-status';
import {
  PAYMENT_OUTCOME_RESOLVER,
  type PaymentOutcomeResolver,
} from './payment-outcome-resolver';
import {
  PROCESSING_SCHEDULER,
  type ProcessingScheduler,
  type ScheduledProcessingTask,
} from './processing-scheduler';

type ProcessingPhase = 'starting' | 'completing';

interface ProcessingContext {
  paymentId: string;
  idempotencyKey: string;
  keyHash: string;
  smallestUnitAmount: number;
  currency: Payment['currency'];
  startedAt: number;
  phase: ProcessingPhase;
}

@Injectable()
export class PaymentProcessor
  implements BeforeApplicationShutdown, OnApplicationShutdown
{
  private readonly delayMs: number;
  private readonly scheduledTasks = new Map<
    ScheduledProcessingTask,
    ProcessingContext
  >();
  private readonly inFlightWork = new Set<Promise<void>>();
  private ready = true;
  private stopped = false;

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

  schedule(payment: Payment, idempotencyKey: string): void {
    if (this.stopped) {
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

  async onApplicationShutdown(): Promise<void> {
    this.ready = false;
    if (!this.stopped) {
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
    }

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
      current.status === PaymentStatus.SUCCEEDED ||
      current.status === PaymentStatus.FAILED
    ) {
      return;
    }
    if (current.status === PaymentStatus.PENDING) {
      current = await this.payments.transition(
        context.paymentId,
        PaymentStatus.PROCESSING,
      );
    }
    if (current.status !== PaymentStatus.PROCESSING) {
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
    if (current.status !== PaymentStatus.PROCESSING) {
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
    if (current.status === PaymentStatus.PENDING) {
      current = await this.payments.transition(
        paymentId,
        PaymentStatus.PROCESSING,
      );
    }
    if (current.status === PaymentStatus.PROCESSING) {
      await this.payments.transition(paymentId, PaymentStatus.FAILED);
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
