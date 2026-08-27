import { IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PAYMENT_STATUS } from '../../domain/payment/payment.constants';
import type { PaymentTransitionTarget } from '../payment-api.types';
import { PAYMENT_TRANSITION_TARGETS } from './payment-dto.constants';

export class UpdatePaymentStatusDto {
  @ApiProperty({
    enum: PAYMENT_TRANSITION_TARGETS,
    example: PAYMENT_STATUS.PROCESSING,
  })
  @IsIn(PAYMENT_TRANSITION_TARGETS)
  status!: PaymentTransitionTarget;
}
