import { ConfigService } from '@nestjs/config';
import { DeterministicPaymentOutcomeResolver } from '../../../src/payments/processing/deterministic-payment-outcome.resolver';
import {
  PAYMENT_CURRENCY,
  PAYMENT_STATUS,
} from '../../../src/payments/domain/payment/payment.constants';

function resolverWithRate(rate: number): DeterministicPaymentOutcomeResolver {
  return new DeterministicPaymentOutcomeResolver(
    new ConfigService({ SIMULATED_SUCCESS_RATE: rate }),
  );
}

describe('DeterministicPaymentOutcomeResolver', () => {
  const baseInput = {
    smallestUnitAmount: 1050,
    currency: PAYMENT_CURRENCY.USD,
  };

  it('succeeds when the hand-checked score is below the threshold', () => {
    expect(
      resolverWithRate(0.25).resolve({
        ...baseInput,
        idempotencyKey: 'success-key',
      }),
    ).toBe(PAYMENT_STATUS.SUCCEEDED);
  });

  it('fails when the hand-checked score is at or above the threshold', () => {
    expect(
      resolverWithRate(0.25).resolve({
        ...baseInput,
        idempotencyKey: 'failure-key',
      }),
    ).toBe(PAYMENT_STATUS.FAILED);
  });

  it('returns the same outcome for repeated identical input', () => {
    const resolver = resolverWithRate(0.5);
    const input = {
      idempotencyKey: 'stable-key',
      smallestUnitAmount: 2500,
      currency: PAYMENT_CURRENCY.USD,
    };

    expect(resolver.resolve(input)).toBe(PAYMENT_STATUS.FAILED);
    expect(resolver.resolve(input)).toBe(PAYMENT_STATUS.FAILED);
  });

  it('always fails at zero and always succeeds at one', () => {
    const input = { ...baseInput, idempotencyKey: 'any-key' };

    expect(resolverWithRate(0).resolve(input)).toBe(PAYMENT_STATUS.FAILED);
    expect(resolverWithRate(1).resolve(input)).toBe(PAYMENT_STATUS.SUCCEEDED);
  });
});
