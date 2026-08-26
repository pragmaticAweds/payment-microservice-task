import type { Payment } from '../domain/payment';

export const PAYMENT_IDEMPOTENCY_REPOSITORY = Symbol(
  'PAYMENT_IDEMPOTENCY_REPOSITORY',
);

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
