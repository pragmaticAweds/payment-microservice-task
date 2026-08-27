import { TestingModule, Test } from '@nestjs/testing';
import { CommonModule } from '../../../src/common/common.module';
import { RuntimeConfigModule } from '../../../src/config/runtime-config.module';
import { PaymentCreationIdempotencyService } from '../../../src/payments/application/payment-creation-idempotency.service';
import { Payment } from '../../../src/payments/domain/payment';
import { PaymentCurrency } from '../../../src/payments/domain/payment-status';
import { PaymentsModule } from '../../../src/payments/payments.module';
import { DeterministicPaymentOutcomeResolver } from '../../../src/payments/processing/deterministic-payment-outcome.resolver';
import { PAYMENT_OUTCOME_RESOLVER } from '../../../src/payments/processing/payment-outcome-resolver';
import { PaymentProcessor } from '../../../src/payments/processing/payment-processor';
import { PROCESSING_SCHEDULER } from '../../../src/payments/processing/processing-scheduler';
import { TimeoutProcessingScheduler } from '../../../src/payments/processing/timeout-processing.scheduler';
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
    await repository.create(payment);
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

  it('provides the processing adapters and coordinator', () => {
    expect(moduleRef.get(PROCESSING_SCHEDULER)).toBeInstanceOf(
      TimeoutProcessingScheduler,
    );
    expect(moduleRef.get(PAYMENT_OUTCOME_RESOLVER)).toBeInstanceOf(
      DeterministicPaymentOutcomeResolver,
    );
    expect(moduleRef.get(PaymentProcessor)).toBeInstanceOf(PaymentProcessor);
  });

  afterAll(async () => {
    await moduleRef.close();
  });
});
