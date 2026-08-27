import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PAYMENT_STATUS } from '../../domain/payment/payment.constants';

export const PAYMENT_TRANSITION_TARGETS = [
  PAYMENT_STATUS.PROCESSING,
  PAYMENT_STATUS.SUCCEEDED,
  PAYMENT_STATUS.FAILED,
] as const;

export type PaymentTransitionTarget =
  (typeof PAYMENT_TRANSITION_TARGETS)[number];

export class UpdatePaymentStatusDto {
  @ApiProperty({
    enum: PAYMENT_TRANSITION_TARGETS,
    example: PAYMENT_STATUS.PROCESSING,
  })
  @IsIn(PAYMENT_TRANSITION_TARGETS)
  status!: PaymentTransitionTarget;
}
