import { PinoLogger } from 'nestjs-pino';
import {
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
} from '../../../src/payments/application/payment-idempotency/idempotency.errors';
import { PaymentCreationIdempotencyService } from '../../../src/payments/application/payment-idempotency/payment-creation-idempotency.service';
import { Payment } from '../../../src/payments/domain/payment/payment';
import { PAYMENT_CURRENCY } from '../../../src/payments/domain/payment/payment.constants';
import { InMemoryPaymentIdempotencyRepository } from '../../../src/payments/repositories/in-memory-payment-idempotency.repository';

interface TestLogMetadata {
  event?: unknown;
  keyHash?: unknown;
  paymentId?: unknown;
}

type TestLogMethod = jest.Mock<void, [TestLogMetadata, string]>;

describe('PaymentCreationIdempotencyService', () => {
  const input = {
    smallestUnitAmount: 1050,
    currency: PAYMENT_CURRENCY.USD,
    merchantReference: 'order-2026-0001',
    description: 'Invoice 0001',
  };

  let loggerInfo: TestLogMethod;
  let loggerWarn: TestLogMethod;
  let service: PaymentCreationIdempotencyService;

  beforeEach(() => {
    loggerInfo = jest.fn<void, [TestLogMetadata, string]>();
    loggerWarn = jest.fn<void, [TestLogMetadata, string]>();
    const logger = {
      info: loggerInfo,
      warn: loggerWarn,
    } as unknown as PinoLogger;

    service = new PaymentCreationIdempotencyService(
      new InMemoryPaymentIdempotencyRepository(),
      logger,
    );
  });

  it('stores and returns the original payment response', async () => {
    const result = await service.execute('checkout-key-001', input, () =>
      Promise.resolve(Payment.create(input)),
    );

    expect(result.replayed).toBe(false);
    expect(result.payment).toMatchObject({
      smallestUnitAmount: 1050,
      merchantReference: 'order-2026-0001',
    });
  });

  it('passes the validated key to the fresh creation callback only', async () => {
    const createPayment = jest.fn(() => Promise.resolve(Payment.create(input)));

    await service.execute('checkout-key-007', input, createPayment);
    await service.execute('checkout-key-007', input, createPayment);

    expect(createPayment).toHaveBeenCalledTimes(1);
    expect(createPayment).toHaveBeenCalledWith('checkout-key-007');
  });

  it('replays the original response for the same key and canonical payload', async () => {
    let creationCount = 0;
    const createPayment = (): Promise<Payment> => {
      creationCount += 1;
      return Promise.resolve(Payment.create(input));
    };

    const original = await service.execute(
      'checkout-key-002',
      {
        ...input,
        merchantReference: ' order-2026-0001 ',
        description: ' Invoice 0001 ',
      },
      createPayment,
    );
    const replay = await service.execute(
      'checkout-key-002',
      input,
      createPayment,
    );

    expect(creationCount).toBe(1);
    expect(replay).toEqual({ payment: original.payment, replayed: true });
  });

  it('treats blank and omitted descriptions as the same canonical payload', async () => {
    let creationCount = 0;
    const createPayment = (): Promise<Payment> => {
      creationCount += 1;
      return Promise.resolve(Payment.create({ ...input, description: '   ' }));
    };

    const original = await service.execute(
      'checkout-key-003',
      { ...input, description: '   ' },
      createPayment,
    );
    const replay = await service.execute(
      'checkout-key-003',
      {
        smallestUnitAmount: input.smallestUnitAmount,
        currency: input.currency,
        merchantReference: input.merchantReference,
      },
      createPayment,
    );

    expect(creationCount).toBe(1);
    expect(replay).toEqual({ payment: original.payment, replayed: true });
  });

  it('rejects reuse of a key with a different canonical payload', async () => {
    let creationCount = 0;
    const createPayment = (): Promise<Payment> => {
      creationCount += 1;
      return Promise.resolve(Payment.create(input));
    };

    await service.execute('checkout-key-004', input, createPayment);

    await expect(
      service.execute(
        'checkout-key-004',
        { ...input, smallestUnitAmount: 1051 },
        createPayment,
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    expect(creationCount).toBe(1);
  });

  it('coalesces concurrent same-key requests into one creation', async () => {
    let creationCount = 0;
    let resolveCreation!: (payment: Payment) => void;
    const pendingCreation = new Promise<Payment>((resolve) => {
      resolveCreation = resolve;
    });
    const createPayment = (): Promise<Payment> => {
      creationCount += 1;
      return pendingCreation;
    };

    const first = service.execute('checkout-key-005', input, createPayment);
    const concurrentReplay = service.execute(
      'checkout-key-005',
      input,
      createPayment,
    );
    await Promise.resolve();

    expect(creationCount).toBe(1);
    const payment = Payment.create(input);
    resolveCreation(payment);

    await expect(first).resolves.toEqual({ payment, replayed: false });
    await expect(concurrentReplay).resolves.toEqual({
      payment,
      replayed: true,
    });
  });

  it('rejects a concurrent conflicting payload without cancelling the original', async () => {
    let creationCount = 0;
    let resolveCreation!: (payment: Payment) => void;
    const pendingCreation = new Promise<Payment>((resolve) => {
      resolveCreation = resolve;
    });
    const createPayment = (): Promise<Payment> => {
      creationCount += 1;
      return pendingCreation;
    };

    const original = service.execute('checkout-key-006', input, createPayment);
    await expect(
      service.execute(
        'checkout-key-006',
        { ...input, smallestUnitAmount: 9999 },
        createPayment,
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
    await Promise.resolve();

    expect(creationCount).toBe(1);
    const payment = Payment.create(input);
    resolveCreation(payment);
    await expect(original).resolves.toEqual({ payment, replayed: false });
  });

  it.each([
    undefined,
    '',
    'contains spaces',
    'contains/slash',
    'x'.repeat(129),
  ])('rejects an invalid idempotency key: %s', async (key) => {
    await expect(
      service.execute(key, input, () => Promise.resolve(Payment.create(input))),
    ).rejects.toBeInstanceOf(InvalidIdempotencyKeyError);
  });

  it('logs a key hash without exposing the raw idempotency key', async () => {
    const rawKey = 'private-checkout-key';

    const original = await service.execute(rawKey, input, () =>
      Promise.resolve(Payment.create(input)),
    );
    await service.execute(rawKey, input, () =>
      Promise.resolve(Payment.create(input)),
    );

    const loggedValues = JSON.stringify([
      ...loggerInfo.mock.calls,
      ...loggerWarn.mock.calls,
    ]);
    expect(loggedValues).not.toContain(rawKey);
    const createdCall = loggerInfo.mock.calls.find(
      ([metadata]) => metadata.event === 'idempotency.record_created',
    );
    const replayedCall = loggerInfo.mock.calls.find(
      ([metadata]) => metadata.event === 'idempotency.replayed',
    );

    expect(createdCall?.[0].paymentId).toBe(original.payment.id);
    expect(createdCall?.[1]).toBe('Idempotency record created');
    expect(typeof createdCall?.[0].keyHash).toBe('string');
    expect(createdCall?.[0].keyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(replayedCall?.[0].paymentId).toBe(original.payment.id);
    expect(replayedCall?.[1]).toBe('Idempotent payment creation replayed');
    expect(typeof replayedCall?.[0].keyHash).toBe('string');
    expect(replayedCall?.[0].keyHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
