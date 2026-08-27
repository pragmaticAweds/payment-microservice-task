import { Payment } from '../../../src/payments/domain/payment/payment';
import { PAYMENT_CURRENCY } from '../../../src/payments/domain/payment/payment.constants';
import { InMemoryPaymentIdempotencyRepository } from '../../../src/payments/repositories/in-memory-payment-idempotency.repository';
import { PaymentIdempotencyRecord } from '../../../src/payments/repositories/payment-idempotency.repository';

describe('InMemoryPaymentIdempotencyRepository', () => {
  const payment = Payment.create({
    smallestUnitAmount: 1050,
    currency: PAYMENT_CURRENCY.USD,
    merchantReference: 'order-2026-0001',
  });
  const record: PaymentIdempotencyRecord = {
    key: 'checkout-key-001',
    fingerprint: 'request-fingerprint',
    paymentId: payment.id,
    response: payment,
    createdAt: '2026-08-26T12:00:00.000Z',
  };

  it('returns null when a key has no record', async () => {
    const repository = new InMemoryPaymentIdempotencyRepository();

    await expect(repository.findByKey('missing-key')).resolves.toBeNull();
  });

  it('stores and retrieves the original idempotency record', async () => {
    const repository = new InMemoryPaymentIdempotencyRepository();

    await repository.save(record);

    await expect(repository.findByKey(record.key)).resolves.toBe(record);
  });
});
