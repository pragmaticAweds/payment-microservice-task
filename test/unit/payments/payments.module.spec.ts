import { TestingModule, Test } from '@nestjs/testing';
import { CommonModule } from '../../../src/common/common.module';
import { RuntimeConfigModule } from '../../../src/config/runtime-config.module';
import { PaymentCreationIdempotencyService } from '../../../src/payments/application/payment-creation-idempotency.service';
import { Payment } from '../../../src/payments/domain/payment';
import { PaymentCurrency } from '../../../src/payments/domain/payment-status';
import { PaymentsModule } from '../../../src/payments/payments.module';
import { InMemoryPaymentIdempotencyRepository } from '../../../src/payments/repositories/in-memory-payment-idempotency.repository';
import { InMemoryPaymentRepository } from '../../../src/payments/repositories/in-memory-payment.repository';
import {
  PAYMENT_IDEMPOTENCY_REPOSITORY,
  type PaymentIdempotencyRepository,
} from '../../../src/payments/repositories/payment-idempotency.repository';
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
} from '../../../src/payments/repositories/payment.repository';

describe('PaymentsModule', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [RuntimeConfigModule, CommonModule, PaymentsModule],
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

  it('provides the idempotency coordinator and repository adapter', () => {
    const repository = moduleRef.get<PaymentIdempotencyRepository>(
      PAYMENT_IDEMPOTENCY_REPOSITORY,
    );

    expect(repository).toBeInstanceOf(InMemoryPaymentIdempotencyRepository);
    expect(moduleRef.get(PaymentCreationIdempotencyService)).toBeInstanceOf(
      PaymentCreationIdempotencyService,
    );
  });

  afterAll(async () => {
    await moduleRef.close();
  });
});
