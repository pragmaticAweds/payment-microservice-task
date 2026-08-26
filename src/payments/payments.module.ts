import { Module } from '@nestjs/common';
import { PaymentsController } from './api/payments.controller';
import { PaymentCreationIdempotencyService } from './application/payment-creation-idempotency.service';
import { PaymentsService } from './application/payments.service';
import { InMemoryPaymentIdempotencyRepository } from './repositories/in-memory-payment-idempotency.repository';
import { InMemoryPaymentRepository } from './repositories/in-memory-payment.repository';
import { PAYMENT_IDEMPOTENCY_REPOSITORY } from './repositories/payment-idempotency.repository';
import { PAYMENT_REPOSITORY } from './repositories/payment.repository';

@Module({
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentCreationIdempotencyService,
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
  ],
})
export class PaymentsModule {}
