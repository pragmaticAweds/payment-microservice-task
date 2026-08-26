import {
  InvalidPaymentError,
  InvalidPaymentTransitionError,
} from '../../../src/payments/domain/payment.errors';
import {
  Payment,
  type CreatePaymentInput,
} from '../../../src/payments/domain/payment';
import {
  PaymentCurrency,
  PaymentStatus,
} from '../../../src/payments/domain/payment-status';

const CURRENT_TIME = new Date('2026-08-26T12:00:00.000Z');

const validInput: CreatePaymentInput = {
  smallestUnitAmount: 1050,
  currency: PaymentCurrency.USD,
  merchantReference: 'order-482',
  description: 'Payment for order 482',
};

describe('Payment creation', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(CURRENT_TIME);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('creates an immutable pending USD payment with normalized fields', () => {
    const payment = Payment.create({
      ...validInput,
      merchantReference: '  order-482  ',
      description: '  Payment for order 482  ',
    });

    expect(payment).toMatchObject({
      smallestUnitAmount: 1050,
      currency: PaymentCurrency.USD,
      merchantReference: 'order-482',
      description: 'Payment for order 482',
      status: PaymentStatus.PENDING,
      createdAt: CURRENT_TIME.toISOString(),
      updatedAt: CURRENT_TIME.toISOString(),
    });
    expect(payment.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(Object.isFrozen(payment)).toBe(true);
  });

  it('stores a blank optional description as absent', () => {
    const payment = Payment.create({
      ...validInput,
      description: '   ',
    });

    expect(payment.description).toBeUndefined();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53])(
    'rejects invalid smallestUnitAmount %s',
    (smallestUnitAmount) => {
      expect(() =>
        Payment.create({ ...validInput, smallestUnitAmount }),
      ).toThrow(InvalidPaymentError);
    },
  );

  it('rejects currencies other than USD', () => {
    expect(() =>
      Payment.create({
        ...validInput,
        currency: 'EUR' as PaymentCurrency,
      }),
    ).toThrow(InvalidPaymentError);
  });

  it.each(['', '   ', 'x'.repeat(101)])(
    'rejects invalid merchant reference %p',
    (merchantReference) => {
      expect(() =>
        Payment.create({ ...validInput, merchantReference }),
      ).toThrow(InvalidPaymentError);
    },
  );

  it('rejects descriptions longer than 500 characters', () => {
    expect(() =>
      Payment.create({ ...validInput, description: 'x'.repeat(501) }),
    ).toThrow(InvalidPaymentError);
  });
});

describe('Payment status transitions', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(CURRENT_TIME);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('transitions from pending to processing without mutating the original', () => {
    const pending = Payment.create(validInput);
    jest.advanceTimersByTime(1000);

    const processing = pending.transitionTo(PaymentStatus.PROCESSING);

    expect(pending.status).toBe(PaymentStatus.PENDING);
    expect(processing).not.toBe(pending);
    expect(processing).toMatchObject({
      id: pending.id,
      smallestUnitAmount: pending.smallestUnitAmount,
      currency: pending.currency,
      merchantReference: pending.merchantReference,
      description: pending.description,
      status: PaymentStatus.PROCESSING,
      createdAt: pending.createdAt,
      updatedAt: '2026-08-26T12:00:01.000Z',
    });
    expect(Object.isFrozen(processing)).toBe(true);
  });

  it.each([PaymentStatus.SUCCEEDED, PaymentStatus.FAILED])(
    'transitions from processing to %s',
    (terminalStatus) => {
      const processing = Payment.create(validInput).transitionTo(
        PaymentStatus.PROCESSING,
      );

      const terminal = processing.transitionTo(terminalStatus);

      expect(terminal.status).toBe(terminalStatus);
      expect(processing.status).toBe(PaymentStatus.PROCESSING);
    },
  );

  it.each([
    PaymentStatus.PENDING,
    PaymentStatus.SUCCEEDED,
    PaymentStatus.FAILED,
  ])('rejects pending to %s', (nextStatus) => {
    const pending = Payment.create(validInput);

    expect(() => pending.transitionTo(nextStatus)).toThrow(
      InvalidPaymentTransitionError,
    );
    expect(pending.status).toBe(PaymentStatus.PENDING);
  });

  it.each([PaymentStatus.PENDING, PaymentStatus.PROCESSING])(
    'rejects processing to %s',
    (nextStatus) => {
      const processing = Payment.create(validInput).transitionTo(
        PaymentStatus.PROCESSING,
      );

      expect(() => processing.transitionTo(nextStatus)).toThrow(
        InvalidPaymentTransitionError,
      );
      expect(processing.status).toBe(PaymentStatus.PROCESSING);
    },
  );

  it.each([PaymentStatus.SUCCEEDED, PaymentStatus.FAILED])(
    'rejects every transition from terminal status %s',
    (terminalStatus) => {
      const terminal = Payment.create(validInput)
        .transitionTo(PaymentStatus.PROCESSING)
        .transitionTo(terminalStatus);

      for (const nextStatus of Object.values(PaymentStatus)) {
        expect(() => terminal.transitionTo(nextStatus)).toThrow(
          InvalidPaymentTransitionError,
        );
      }
      expect(terminal.status).toBe(terminalStatus);
    },
  );

  it('reports the rejected source and target statuses', () => {
    const pending = Payment.create(validInput);

    try {
      pending.transitionTo(PaymentStatus.SUCCEEDED);
      throw new Error('Expected transition to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidPaymentTransitionError);
      expect(error).toMatchObject({
        code: 'INVALID_PAYMENT_TRANSITION',
        from: PaymentStatus.PENDING,
        to: PaymentStatus.SUCCEEDED,
      });
    }
  });
});
