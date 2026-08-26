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
import { PaymentCurrency } from '../../domain/payment-status';

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
    enum: [PaymentCurrency.USD],
    example: PaymentCurrency.USD,
  })
  @Equals(PaymentCurrency.USD)
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
