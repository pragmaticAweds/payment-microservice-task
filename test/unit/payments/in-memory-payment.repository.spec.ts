import { Payment } from '../../../src/payments/domain/payment/payment';
import {
  PAYMENT_CURRENCY,
  PAYMENT_STATUS,
} from '../../../src/payments/domain/payment/payment.constants';
import { InMemoryPaymentRepository } from '../../../src/payments/repositories/in-memory-payment.repository';

function createPayment(merchantReference: string): Payment {
  return Payment.create({
    smallestUnitAmount: 1050,
    currency: PAYMENT_CURRENCY.USD,
    merchantReference,
  });
}

describe('InMemoryPaymentRepository', () => {
  let repository: InMemoryPaymentRepository;

  beforeEach(() => {
    repository = new InMemoryPaymentRepository();
  });

  it('creates and retrieves a payment by ID', async () => {
    const payment = createPayment('order-1');

    await repository.create(payment);

    await expect(repository.findById(payment.id)).resolves.toBe(payment);
  });

  it('returns null for an unknown payment ID', async () => {
    await expect(repository.findById('unknown-id')).resolves.toBeNull();
  });

  it('atomically transitions and replaces the stored snapshot', async () => {
    const pending = createPayment('order-2');
    const processing = pending.transitionTo(PAYMENT_STATUS.PROCESSING);
    await repository.create(pending);

    const transition = await repository.transition(
      pending.id,
      PAYMENT_STATUS.PROCESSING,
    );

    expect(transition).toEqual({ previous: pending, current: processing });
    await expect(repository.findById(pending.id)).resolves.toEqual(processing);
  });

  it('returns null when transitioning an unknown payment ID', async () => {
    await expect(
      repository.transition('unknown-id', PAYMENT_STATUS.PROCESSING),
    ).resolves.toBeNull();
  });

  it('stores different payment IDs independently', async () => {
    const first = createPayment('order-3');
    const second = createPayment('order-4');

    await repository.create(first);
    await repository.create(second);

    await expect(repository.findById(first.id)).resolves.toBe(first);
    await expect(repository.findById(second.id)).resolves.toBe(second);
  });

  it('reports ready until application shutdown begins', async () => {
    await expect(repository.isReady()).resolves.toBe(true);

    repository.beforeApplicationShutdown();

    await expect(repository.isReady()).resolves.toBe(false);
  });
});
