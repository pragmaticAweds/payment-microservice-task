import { Transform } from 'class-transformer';
import type { TransformFnParams } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Equals,
  IsInt,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { PAYMENT_CURRENCY } from '../../domain/payment/payment.constants';
import type { PaymentCurrency } from '../../domain/payment/payment.types';

function trimString({ value }: TransformFnParams): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class CreatePaymentDto {
  @ApiProperty({
    description: 'Payment amount in US cents',
    example: 1050,
    format: 'int64',
    maximum: Number.MAX_SAFE_INTEGER,
    minimum: 1,
    type: Number,
  })
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  smallestUnitAmount!: number;

  @ApiProperty({
    enum: [PAYMENT_CURRENCY.USD],
    example: PAYMENT_CURRENCY.USD,
  })
  @Equals(PAYMENT_CURRENCY.USD)
  currency!: PaymentCurrency;

  @ApiProperty({
    example: 'order-2026-0001',
    maxLength: 100,
    minLength: 1,
  })
  @Transform(trimString)
  @IsString()
  @Length(1, 100)
  merchantReference!: string;

  @ApiPropertyOptional({
    example: 'Invoice 0001',
    maxLength: 500,
  })
  @Transform(trimString)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(500)
  description?: string;
}
