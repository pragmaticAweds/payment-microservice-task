import { Module } from '@nestjs/common';
import { PaymentsService } from './application/payments.service';
import { InMemoryPaymentRepository } from './repositories/in-memory-payment.repository';
import { PAYMENT_REPOSITORY } from './repositories/payment.repository';

@Module({
  providers: [
    PaymentsService,
    {
      provide: PAYMENT_REPOSITORY,
      useClass: InMemoryPaymentRepository,
    },
  ],
  exports: [PAYMENT_REPOSITORY, PaymentsService],
})
export class PaymentsModule {}
