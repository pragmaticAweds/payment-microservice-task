import { Module } from '@nestjs/common';
import { PaymentsController } from './api/payments.controller';
import { PaymentCreationIdempotencyService } from './application/payment-creation-idempotency.service';
import { PaymentsService } from './application/payments.service';
import { DeterministicPaymentOutcomeResolver } from './processing/deterministic-payment-outcome.resolver';
import { PAYMENT_OUTCOME_RESOLVER } from './processing/payment-outcome-resolver';
import { PaymentProcessor } from './processing/payment-processor';
import { PROCESSING_SCHEDULER } from './processing/processing-scheduler';
import { TimeoutProcessingScheduler } from './processing/timeout-processing.scheduler';
import { InMemoryPaymentIdempotencyRepository } from './repositories/in-memory-payment-idempotency.repository';
import { InMemoryPaymentRepository } from './repositories/in-memory-payment.repository';
import { PAYMENT_IDEMPOTENCY_REPOSITORY } from './repositories/payment-idempotency.repository';
import { PAYMENT_REPOSITORY } from './repositories/payment.repository';

@Module({
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentCreationIdempotencyService,
    PaymentProcessor,
    {
      provide: PROCESSING_SCHEDULER,
      useClass: TimeoutProcessingScheduler,
    },
    {
      provide: PAYMENT_OUTCOME_RESOLVER,
      useClass: DeterministicPaymentOutcomeResolver,
    },
    {
      provide: PAYMENT_REPOSITORY,
      useClass: InMemoryPaymentRepository,
    },
    {
      provide: PAYMENT_IDEMPOTENCY_REPOSITORY,
      useClass: InMemoryPaymentIdempotencyRepository,
    },
  ],
  exports: [
    PAYMENT_REPOSITORY,
    PAYMENT_IDEMPOTENCY_REPOSITORY,
    PaymentsService,
    PaymentCreationIdempotencyService,
    PaymentProcessor,
    PROCESSING_SCHEDULER,
    PAYMENT_OUTCOME_RESOLVER,
  ],
})
export class PaymentsModule {}
