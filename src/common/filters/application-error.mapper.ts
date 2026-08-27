import { HttpStatus } from '@nestjs/common';
import {
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
} from '../../payments/application/payment-idempotency/idempotency.errors';
import { PaymentNotFoundError } from '../../payments/application/payment-not-found.error';
import {
  InvalidPaymentError,
  InvalidPaymentTransitionError,
} from '../../payments/domain/payment/payment.errors';
import type { MappedApplicationError } from './error.types';

export function mapApplicationError(
  exception: unknown,
): MappedApplicationError | null {
  if (exception instanceof InvalidIdempotencyKeyError) {
    return {
      statusCode: HttpStatus.BAD_REQUEST,
      code: exception.code,
      message: exception.message,
    };
  }

  if (exception instanceof IdempotencyConflictError) {
    return {
      statusCode: HttpStatus.CONFLICT,
      code: exception.code,
      message: exception.message,
    };
  }

  if (exception instanceof InvalidPaymentError) {
    return {
      statusCode: HttpStatus.BAD_REQUEST,
      code: exception.code,
      message: exception.message,
    };
  }

  if (exception instanceof PaymentNotFoundError) {
    return {
      statusCode: HttpStatus.NOT_FOUND,
      code: exception.code,
      message: exception.message,
    };
  }

  if (exception instanceof InvalidPaymentTransitionError) {
    return {
      statusCode: HttpStatus.CONFLICT,
      code: exception.code,
      message: exception.message,
      details: {
        from: exception.from,
        to: exception.to,
      },
    };
  }

  return null;
}
