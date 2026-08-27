import { PAYMENT_STATUS } from '../domain/payment/payment.constants';
import type { PaymentCurrency } from '../domain/payment/payment.types';

export const PAYMENT_OUTCOME_RESOLVER = Symbol('PAYMENT_OUTCOME_RESOLVER');

export type TerminalPaymentStatus =
  typeof PAYMENT_STATUS.SUCCEEDED | typeof PAYMENT_STATUS.FAILED;

export interface PaymentOutcomeInput {
  idempotencyKey: string;
  smallestUnitAmount: number;
  currency: PaymentCurrency;
}

export interface PaymentOutcomeResolver {
  resolve(input: PaymentOutcomeInput): TerminalPaymentStatus;
}
