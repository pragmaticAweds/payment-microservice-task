import { Injectable } from '@nestjs/common';
import { Payment } from '../domain/payment';
import { PaymentRepository } from './payment.repository';

@Injectable()
export class InMemoryPaymentRepository implements PaymentRepository {
  private readonly payments = new Map<string, Payment>();

  save(payment: Payment): Promise<void> {
    this.payments.set(payment.id, payment);
    return Promise.resolve();
  }

  findById(id: string): Promise<Payment | null> {
    return Promise.resolve(this.payments.get(id) ?? null);
  }
}
