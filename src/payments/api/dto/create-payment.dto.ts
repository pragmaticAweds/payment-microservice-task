import { Transform } from 'class-transformer';
import type { TransformFnParams } from 'class-transformer';
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
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  smallestUnitAmount!: number;

  @Equals(PaymentCurrency.USD)
  currency!: PaymentCurrency;

  @Transform(trimString)
  @IsString()
  @Length(1, 100)
  merchantReference!: string;

  @Transform(trimString)
  @ValidateIf((_object, value) => value !== undefined)
  @IsString()
  @MaxLength(500)
  description?: string;
}
