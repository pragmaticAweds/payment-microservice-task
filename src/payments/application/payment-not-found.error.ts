export class PaymentNotFoundError extends Error {
  readonly code = 'PAYMENT_NOT_FOUND';

  constructor(readonly paymentId: string) {
    super(`Payment ${paymentId} was not found`);
    this.name = PaymentNotFoundError.name;
  }
}
