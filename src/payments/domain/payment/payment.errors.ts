import type { PaymentStatus } from './payment.types';

export class InvalidPaymentError extends Error {
  readonly code = 'INVALID_PAYMENT';

  constructor(message: string) {
    super(message);
    this.name = InvalidPaymentError.name;
  }
}

export class InvalidPaymentTransitionError extends Error {
  readonly code = 'INVALID_PAYMENT_TRANSITION';

  constructor(
    readonly from: PaymentStatus,
    readonly to: PaymentStatus,
  ) {
    super(`Payment cannot transition from ${from} to ${to}`);
    this.name = InvalidPaymentTransitionError.name;
  }
}
