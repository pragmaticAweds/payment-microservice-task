import { HttpStatus } from '@nestjs/common';
import { mapApplicationError } from '../../src/common/filters/application-error.mapper';
import { PaymentNotFoundError } from '../../src/payments/application/payment-not-found.error';
import {
  InvalidPaymentError,
  InvalidPaymentTransitionError,
} from '../../src/payments/domain/payment.errors';
import { PaymentStatus } from '../../src/payments/domain/payment-status';

describe('mapApplicationError', () => {
  it('maps invalid payment input to a safe bad-request error', () => {
    expect(
      mapApplicationError(new InvalidPaymentError('currency must be USD')),
    ).toEqual({
      statusCode: HttpStatus.BAD_REQUEST,
      code: 'INVALID_PAYMENT',
      message: 'currency must be USD',
    });
  });

  it('maps a missing payment to a not-found error', () => {
    const error = new PaymentNotFoundError('payment-id');

    expect(mapApplicationError(error)).toEqual({
      statusCode: HttpStatus.NOT_FOUND,
      code: 'PAYMENT_NOT_FOUND',
      message: 'Payment payment-id was not found',
    });
  });

  it('maps an invalid transition to conflict with state details', () => {
    expect(
      mapApplicationError(
        new InvalidPaymentTransitionError(
          PaymentStatus.PENDING,
          PaymentStatus.SUCCEEDED,
        ),
      ),
    ).toEqual({
      statusCode: HttpStatus.CONFLICT,
      code: 'INVALID_PAYMENT_TRANSITION',
      message: 'Payment cannot transition from pending to succeeded',
      details: {
        from: PaymentStatus.PENDING,
        to: PaymentStatus.SUCCEEDED,
      },
    });
  });

  it('does not classify an unknown failure as an application error', () => {
    expect(mapApplicationError(new Error('unexpected'))).toBeNull();
  });
});
