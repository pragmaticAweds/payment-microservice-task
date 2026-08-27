import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PAYMENT_CURRENCY,
  PAYMENT_STATUS,
} from '../../domain/payment/payment.constants';
import type {
  PaymentCurrency,
  PaymentStatus,
} from '../../domain/payment/payment.types';

export class PaymentResponseDto {
  @ApiProperty({
    example: '48b25c83-efef-4ff9-b57a-ad280905a576',
    format: 'uuid',
  })
  id!: string;

  @ApiProperty({
    description: 'Payment amount in US cents',
    example: 1050,
    format: 'int64',
    maximum: Number.MAX_SAFE_INTEGER,
    minimum: 1,
    type: Number,
  })
  smallestUnitAmount!: number;

  @ApiProperty({
    enum: [PAYMENT_CURRENCY.USD],
    example: PAYMENT_CURRENCY.USD,
  })
  currency!: PaymentCurrency;

  @ApiProperty({
    example: 'order-2026-0001',
    maxLength: 100,
    minLength: 1,
  })
  merchantReference!: string;

  @ApiPropertyOptional({
    example: 'Invoice 0001',
    maxLength: 500,
  })
  description?: string;

  @ApiProperty({
    enum: Object.values(PAYMENT_STATUS),
    example: PAYMENT_STATUS.PENDING,
  })
  status!: PaymentStatus;

  @ApiProperty({
    example: '2026-08-26T12:00:00.000Z',
    format: 'date-time',
  })
  createdAt!: string;

  @ApiProperty({
    example: '2026-08-26T12:00:00.000Z',
    format: 'date-time',
  })
  updatedAt!: string;
}

export class PaymentDataResponseDto {
  @ApiProperty({ enum: ['success'], example: 'success' })
  status!: 'success';

  @ApiProperty({ type: PaymentResponseDto })
  data!: PaymentResponseDto;
}
