import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { CreatePaymentInput, Payment } from '../domain/payment';
import { PaymentStatus } from '../domain/payment-status';
import { PAYMENT_REPOSITORY } from '../repositories/payment.repository';
import type { PaymentRepository } from '../repositories/payment.repository';
import { PaymentNotFoundError } from './payment-not-found.error';

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PAYMENT_REPOSITORY)
    private readonly repository: PaymentRepository,
    private readonly logger: PinoLogger,
  ) {}

  async create(input: CreatePaymentInput): Promise<Payment> {
    const payment = Payment.create(input);

    await this.repository.save(payment);
    this.logger.info(
      {
        event: 'payment.created',
        paymentId: payment.id,
        merchantReference: payment.merchantReference,
      },
      'Payment created',
    );

    return payment;
  }

  async findById(id: string): Promise<Payment> {
    const payment = await this.repository.findById(id);

    if (payment === null) {
      throw new PaymentNotFoundError(id);
    }

    return payment;
  }

  async transition(id: string, nextStatus: PaymentStatus): Promise<Payment> {
    const current = await this.findById(id);
    const updated = current.transitionTo(nextStatus);

    await this.repository.save(updated);
    this.logger.info(
      {
        event: 'payment.status_transitioned',
        paymentId: updated.id,
        fromStatus: current.status,
        toStatus: updated.status,
      },
      'Payment status transitioned',
    );

    return updated;
  }
}
