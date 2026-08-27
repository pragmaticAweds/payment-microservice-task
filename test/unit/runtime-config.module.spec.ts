import { validateEnvironment } from '../../src/config/environment';

describe('validateEnvironment', () => {
  it('applies safe local defaults', () => {
    expect(validateEnvironment({})).toMatchObject({
      NODE_ENV: 'development',
      SERVICE_NAME: 'node-payment-microservice',
      PORT: 4040,
      LOG_LEVEL: 'info',
      PROCESSING_DELAY_MS: 60_000,
      SIMULATED_SUCCESS_RATE: 0.8,
      THROTTLE_TTL_MS: 60_000,
      THROTTLE_LIMIT: 100,
      PAYMENT_CREATE_THROTTLE_LIMIT: 10,
      IDEMPOTENCY_TTL_MS: 86_400_000,
    });
  });

  it('accepts an explicit port override', () => {
    expect(validateEnvironment({ PORT: '5050' })).toMatchObject({
      PORT: 5050,
    });
  });

  it.each([
    [{ SIMULATED_SUCCESS_RATE: '-0.01' }, 'SIMULATED_SUCCESS_RATE'],
    [{ SIMULATED_SUCCESS_RATE: '1.01' }, 'SIMULATED_SUCCESS_RATE'],
    [{ PROCESSING_DELAY_MS: '-1' }, 'PROCESSING_DELAY_MS'],
  ])('rejects invalid processing config %o', (config, field) => {
    expect(() => validateEnvironment(config)).toThrow(field);
  });

  it('accepts processing configuration boundary values', () => {
    expect(
      validateEnvironment({
        PROCESSING_DELAY_MS: '0',
        SIMULATED_SUCCESS_RATE: '1',
      }),
    ).toMatchObject({
      PROCESSING_DELAY_MS: 0,
      SIMULATED_SUCCESS_RATE: 1,
    });
  });

  it.each([
    ['10', '10'],
    ['11', '10'],
  ])(
    'rejects payment creation limit %s when the general limit is %s',
    (paymentCreateLimit, generalLimit) => {
      expect(() =>
        validateEnvironment({
          PAYMENT_CREATE_THROTTLE_LIMIT: paymentCreateLimit,
          THROTTLE_LIMIT: generalLimit,
        }),
      ).toThrow(
        'PAYMENT_CREATE_THROTTLE_LIMIT: must be lower than THROTTLE_LIMIT',
      );
    },
  );

  it('accepts a payment creation limit lower than the general limit', () => {
    expect(
      validateEnvironment({
        THROTTLE_TTL_MS: '5000',
        THROTTLE_LIMIT: '4',
        PAYMENT_CREATE_THROTTLE_LIMIT: '2',
      }),
    ).toMatchObject({
      THROTTLE_TTL_MS: 5000,
      THROTTLE_LIMIT: 4,
      PAYMENT_CREATE_THROTTLE_LIMIT: 2,
    });
  });
});
