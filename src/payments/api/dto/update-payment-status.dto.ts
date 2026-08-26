import { IsIn } from 'class-validator';
import { PaymentStatus } from '../../domain/payment-status';

export const PAYMENT_TRANSITION_TARGETS = [
  PaymentStatus.PROCESSING,
  PaymentStatus.SUCCEEDED,
  PaymentStatus.FAILED,
] as const;

export type PaymentTransitionTarget =
  (typeof PAYMENT_TRANSITION_TARGETS)[number];

export class UpdatePaymentStatusDto {
  @IsIn(PAYMENT_TRANSITION_TARGETS)
  status!: PaymentTransitionTarget;
}
