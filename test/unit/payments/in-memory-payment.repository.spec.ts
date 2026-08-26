import { Payment } from '../../../src/payments/domain/payment';
import {
  PaymentCurrency,
  PaymentStatus,
} from '../../../src/payments/domain/payment-status';
import { InMemoryPaymentRepository } from '../../../src/payments/repositories/in-memory-payment.repository';

function createPayment(merchantReference: string): Payment {
  return Payment.create({
    smallestUnitAmount: 1050,
    currency: PaymentCurrency.USD,
    merchantReference,
  });
}

describe('InMemoryPaymentRepository', () => {
  let repository: InMemoryPaymentRepository;

  beforeEach(() => {
    repository = new InMemoryPaymentRepository();
  });

  it('saves and retrieves a payment by ID', async () => {
    const payment = createPayment('order-1');

    await repository.save(payment);

    await expect(repository.findById(payment.id)).resolves.toBe(payment);
  });

  it('returns null for an unknown payment ID', async () => {
    await expect(repository.findById('unknown-id')).resolves.toBeNull();
  });

  it('replaces the stored snapshot when the same payment ID is saved', async () => {
    const pending = createPayment('order-2');
    const processing = pending.transitionTo(PaymentStatus.PROCESSING);
    await repository.save(pending);

    await repository.save(processing);

    await expect(repository.findById(pending.id)).resolves.toBe(processing);
  });

  it('stores different payment IDs independently', async () => {
    const first = createPayment('order-3');
    const second = createPayment('order-4');

    await repository.save(first);
    await repository.save(second);

    await expect(repository.findById(first.id)).resolves.toBe(first);
    await expect(repository.findById(second.id)).resolves.toBe(second);
  });
});
