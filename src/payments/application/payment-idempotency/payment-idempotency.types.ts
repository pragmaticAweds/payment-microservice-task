import type { Payment } from '../../domain/payment/payment';

export interface IdempotentPaymentCreationResult {
  payment: Payment;
  replayed: boolean;
}

export interface InFlightCreation {
  fingerprint: string;
  promise: Promise<IdempotentPaymentCreationResult>;
}
