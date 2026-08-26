import { ConfigService } from '@nestjs/config';
import { DeterministicPaymentOutcomeResolver } from '../../../src/payments/processing/deterministic-payment-outcome.resolver';
import {
  PaymentCurrency,
  PaymentStatus,
} from '../../../src/payments/domain/payment-status';

function resolverWithRate(rate: number): DeterministicPaymentOutcomeResolver {
  return new DeterministicPaymentOutcomeResolver(
    new ConfigService({ SIMULATED_SUCCESS_RATE: rate }),
  );
}

describe('DeterministicPaymentOutcomeResolver', () => {
  const baseInput = {
    smallestUnitAmount: 1050,
    currency: PaymentCurrency.USD,
  };

  it('succeeds when the hand-checked score is below the threshold', () => {
    expect(
      resolverWithRate(0.25).resolve({
        ...baseInput,
        idempotencyKey: 'success-key',
      }),
    ).toBe(PaymentStatus.SUCCEEDED);
  });

  it('fails when the hand-checked score is at or above the threshold', () => {
    expect(
      resolverWithRate(0.25).resolve({
        ...baseInput,
        idempotencyKey: 'failure-key',
      }),
    ).toBe(PaymentStatus.FAILED);
  });

  it('returns the same outcome for repeated identical input', () => {
    const resolver = resolverWithRate(0.5);
    const input = {
      idempotencyKey: 'stable-key',
      smallestUnitAmount: 2500,
      currency: PaymentCurrency.USD,
    };

    expect(resolver.resolve(input)).toBe(PaymentStatus.FAILED);
    expect(resolver.resolve(input)).toBe(PaymentStatus.FAILED);
  });

  it('always fails at zero and always succeeds at one', () => {
    const input = { ...baseInput, idempotencyKey: 'any-key' };

    expect(resolverWithRate(0).resolve(input)).toBe(PaymentStatus.FAILED);
    expect(resolverWithRate(1).resolve(input)).toBe(PaymentStatus.SUCCEEDED);
  });
});
