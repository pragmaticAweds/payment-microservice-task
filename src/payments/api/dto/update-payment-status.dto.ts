import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaymentStatus } from '../../domain/payment-status';

export const PAYMENT_TRANSITION_TARGETS = [
  PaymentStatus.PROCESSING,
  PaymentStatus.SUCCEEDED,
  PaymentStatus.FAILED,
] as const;

export type PaymentTransitionTarget =
  (typeof PAYMENT_TRANSITION_TARGETS)[number];

export class UpdatePaymentStatusDto {
  @ApiProperty({
    enum: PAYMENT_TRANSITION_TARGETS,
    example: PaymentStatus.PROCESSING,
  })
  @IsIn(PAYMENT_TRANSITION_TARGETS)
  status!: PaymentTransitionTarget;
}
