import type { Payment } from '../domain/payment/payment';
import { PAYMENT_STATUS } from '../domain/payment/payment.constants';
import type { PaymentCurrency } from '../domain/payment/payment.types';

export interface ScheduledProcessingTask {
  cancel(): void;
}

export interface ProcessingScheduler {
  schedule(delayMs: number, task: () => void): ScheduledProcessingTask;
}

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

export type ProcessingPhase = 'starting' | 'completing';

export interface ProcessingContext {
  paymentId: string;
  idempotencyKey: string;
  keyHash: string;
  smallestUnitAmount: number;
  currency: Payment['currency'];
  startedAt: number;
  phase: ProcessingPhase;
}

export interface PaymentCreationAdmission {
  schedule(payment: Payment, idempotencyKey: string): void;
}
