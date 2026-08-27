import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { Payment } from '../domain/payment';
import { PaymentStatus } from '../domain/payment-status';
import { PaymentRepository, PaymentTransition } from './payment.repository';

@Injectable()
export class InMemoryPaymentRepository
  implements PaymentRepository, BeforeApplicationShutdown
{
  private readonly payments = new Map<string, Payment>();
  private acceptingWork = true;

  create(payment: Payment): Promise<void> {
    this.payments.set(payment.id, payment);
    return Promise.resolve();
  }

  findById(id: string): Promise<Payment | null> {
    return Promise.resolve(this.payments.get(id) ?? null);
  }

  transition(
    id: string,
    nextStatus: PaymentStatus,
  ): Promise<PaymentTransition | null> {
    const previous = this.payments.get(id);
    if (previous === undefined) {
      return Promise.resolve(null);
    }

    const current = previous.transitionTo(nextStatus);
    this.payments.set(id, current);

    return Promise.resolve({ previous, current });
  }

  isReady(): Promise<boolean> {
    return Promise.resolve(this.acceptingWork);
  }

  beforeApplicationShutdown(): void {
    this.acceptingWork = false;
  }
}
