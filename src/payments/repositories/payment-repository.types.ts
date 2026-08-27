import type { Payment } from '../domain/payment/payment';
import type { PaymentStatus } from '../domain/payment/payment.types';

export interface PaymentTransition {
  previous: Payment;
  current: Payment;
}

export interface PaymentRepository {
  create(payment: Payment): Promise<void>;
  findById(id: string): Promise<Payment | null>;
  /** Loads, validates, and persists one status transition atomically. */
  transition(
    id: string,
    nextStatus: PaymentStatus,
  ): Promise<PaymentTransition | null>;
  isReady(): Promise<boolean>;
}

export interface PaymentIdempotencyRecord {
  readonly key: string;
  readonly fingerprint: string;
  readonly paymentId: string;
  readonly response: Payment;
  readonly createdAt: string;
}

export interface PaymentIdempotencyRepository {
  save(record: PaymentIdempotencyRecord): Promise<void>;
  findByKey(key: string): Promise<PaymentIdempotencyRecord | null>;
}
