import { Module } from '@nestjs/common';
import { InMemoryPaymentRepository } from './repositories/in-memory-payment.repository';
import { PAYMENT_REPOSITORY } from './repositories/payment.repository';

@Module({
  providers: [
    {
      provide: PAYMENT_REPOSITORY,
      useClass: InMemoryPaymentRepository,
    },
  ],
  exports: [PAYMENT_REPOSITORY],
})
export class PaymentsModule {}
