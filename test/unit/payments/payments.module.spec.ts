import { TestingModule, Test } from '@nestjs/testing';
import { Payment } from '../../../src/payments/domain/payment';
import { PaymentCurrency } from '../../../src/payments/domain/payment-status';
import { PaymentsModule } from '../../../src/payments/payments.module';
import { InMemoryPaymentRepository } from '../../../src/payments/repositories/in-memory-payment.repository';
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
} from '../../../src/payments/repositories/payment.repository';

describe('PaymentsModule', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [PaymentsModule],
    }).compile();
  });

  it('provides the in-memory adapter through the repository token', async () => {
    const repository = moduleRef.get<PaymentRepository>(PAYMENT_REPOSITORY);
    const payment = Payment.create({
      smallestUnitAmount: 2500,
      currency: PaymentCurrency.USD,
      merchantReference: 'module-wiring-check',
    });

    expect(repository).toBeInstanceOf(InMemoryPaymentRepository);
    await repository.save(payment);
    await expect(repository.findById(payment.id)).resolves.toBe(payment);
  });

  afterAll(async () => {
    await moduleRef.close();
  });
});
