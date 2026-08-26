import type { PaymentCurrency } from '../domain/payment-status';
import { PaymentStatus } from '../domain/payment-status';

export const PAYMENT_OUTCOME_RESOLVER = Symbol('PAYMENT_OUTCOME_RESOLVER');

export type TerminalPaymentStatus =
  PaymentStatus.SUCCEEDED | PaymentStatus.FAILED;

export interface PaymentOutcomeInput {
  idempotencyKey: string;
  smallestUnitAmount: number;
  currency: PaymentCurrency;
}

export interface PaymentOutcomeResolver {
  resolve(input: PaymentOutcomeInput): TerminalPaymentStatus;
}
