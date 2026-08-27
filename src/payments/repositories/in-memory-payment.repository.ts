import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { Payment } from '../domain/payment';
import { PaymentRepository } from './payment.repository';

@Injectable()
export class InMemoryPaymentRepository
  implements PaymentRepository, BeforeApplicationShutdown
{
  private readonly payments = new Map<string, Payment>();
  private acceptingWork = true;

  save(payment: Payment): Promise<void> {
    this.payments.set(payment.id, payment);
    return Promise.resolve();
  }

  findById(id: string): Promise<Payment | null> {
    return Promise.resolve(this.payments.get(id) ?? null);
  }

  isReady(): Promise<boolean> {
    return Promise.resolve(this.acceptingWork);
  }

  beforeApplicationShutdown(): void {
    this.acceptingWork = false;
  }
}
