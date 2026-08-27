import { randomUUID } from 'node:crypto';
import { PinoLogger } from 'nestjs-pino';
import { PaymentsService } from '../../../src/payments/application/payments.service';
import { Payment } from '../../../src/payments/domain/payment';
import {
  PaymentCurrency,
  PaymentStatus,
} from '../../../src/payments/domain/payment-status';
import { InvalidPaymentTransitionError } from '../../../src/payments/domain/payment.errors';
import { InMemoryPaymentRepository } from '../../../src/payments/repositories/in-memory-payment.repository';
import { PaymentRepository } from '../../../src/payments/repositories/payment.repository';

describe('PaymentsService', () => {
  const input = {
    smallestUnitAmount: 1050,
    currency: PaymentCurrency.USD,
    merchantReference: 'order-2026-0001',
    description: 'Invoice 0001',
  };

  let repository: jest.Mocked<PaymentRepository>;
  let repositoryCreate: jest.MockedFunction<PaymentRepository['create']>;
  let repositoryTransition: jest.MockedFunction<
    PaymentRepository['transition']
  >;
  let logger: PinoLogger;
  let loggerInfo: jest.Mock;
  let service: PaymentsService;

  beforeEach(() => {
    repositoryCreate = jest.fn().mockResolvedValue(undefined);
    repositoryTransition = jest.fn();
    repository = {
      create: repositoryCreate,
      findById: jest.fn(),
      isReady: jest.fn().mockResolvedValue(true),
      transition: repositoryTransition,
    };
    loggerInfo = jest.fn();
    logger = { info: loggerInfo } as unknown as PinoLogger;
    service = new PaymentsService(repository, logger);
  });

  it('creates and persists a pending payment', async () => {
    const payment = await service.create(input);

    expect(payment).toMatchObject({
      smallestUnitAmount: 1050,
      currency: PaymentCurrency.USD,
      merchantReference: 'order-2026-0001',
      description: 'Invoice 0001',
      status: PaymentStatus.PENDING,
    });
    expect(repositoryCreate).toHaveBeenCalledWith(payment);
  });

  it('logs a structured payment-created event without the description', async () => {
    const payment = await service.create(input);

    expect(loggerInfo).toHaveBeenCalledWith(
      {
        event: 'payment.created',
        paymentId: payment.id,
        merchantReference: 'order-2026-0001',
      },
      'Payment created',
    );
  });

  it('retrieves an existing payment', async () => {
    const payment = Payment.create(input);
    repository.findById.mockResolvedValue(payment);

    await expect(service.findById(payment.id)).resolves.toBe(payment);
  });

  it('throws PaymentNotFoundError when a payment is missing', async () => {
    const id = randomUUID();
    repository.findById.mockResolvedValue(null);

    await expect(service.findById(id)).rejects.toEqual(
      expect.objectContaining({
        name: 'PaymentNotFoundError',
        code: 'PAYMENT_NOT_FOUND',
        paymentId: id,
      }),
    );
  });

  it('transitions and persists a new immutable payment snapshot', async () => {
    const pending = Payment.create(input);
    const processing = pending.transitionTo(PaymentStatus.PROCESSING);
    repositoryTransition.mockResolvedValue({
      previous: pending,
      current: processing,
    });

    const result = await service.transition(
      pending.id,
      PaymentStatus.PROCESSING,
    );

    expect(pending.status).toBe(PaymentStatus.PENDING);
    expect(result).toBe(processing);
    expect(result.status).toBe(PaymentStatus.PROCESSING);
    expect(repositoryTransition).toHaveBeenCalledWith(
      pending.id,
      PaymentStatus.PROCESSING,
    );
  });

  it('logs a structured status-transition event', async () => {
    const pending = Payment.create(input);
    const processing = pending.transitionTo(PaymentStatus.PROCESSING);
    repositoryTransition.mockResolvedValue({
      previous: pending,
      current: processing,
    });

    await service.transition(pending.id, PaymentStatus.PROCESSING);

    expect(loggerInfo).toHaveBeenCalledWith(
      {
        event: 'payment.status_transitioned',
        paymentId: pending.id,
        fromStatus: PaymentStatus.PENDING,
        toStatus: PaymentStatus.PROCESSING,
      },
      'Payment status transitioned',
    );
  });

  it('throws PaymentNotFoundError when an atomic transition finds no payment', async () => {
    const id = randomUUID();
    repositoryTransition.mockResolvedValue(null);

    await expect(
      service.transition(id, PaymentStatus.PROCESSING),
    ).rejects.toEqual(
      expect.objectContaining({
        name: 'PaymentNotFoundError',
        code: 'PAYMENT_NOT_FOUND',
        paymentId: id,
      }),
    );
    expect(loggerInfo).not.toHaveBeenCalled();
  });

  it('does not persist a transition rejected by the aggregate', async () => {
    const pending = Payment.create(input);
    repositoryTransition.mockRejectedValue(
      new InvalidPaymentTransitionError(
        PaymentStatus.PENDING,
        PaymentStatus.SUCCEEDED,
      ),
    );

    await expect(
      service.transition(pending.id, PaymentStatus.SUCCEEDED),
    ).rejects.toBeInstanceOf(InvalidPaymentTransitionError);
    expect(repositoryCreate).not.toHaveBeenCalled();
  });

  it('does not log a status transition rejected by the aggregate', async () => {
    const pending = Payment.create(input);
    repositoryTransition.mockRejectedValue(
      new InvalidPaymentTransitionError(
        PaymentStatus.PENDING,
        PaymentStatus.SUCCEEDED,
      ),
    );

    await expect(
      service.transition(pending.id, PaymentStatus.SUCCEEDED),
    ).rejects.toBeInstanceOf(InvalidPaymentTransitionError);
    expect(loggerInfo).not.toHaveBeenCalled();
  });

  it('allows exactly one competing terminal transition and preserves its result', async () => {
    const realRepository = new InMemoryPaymentRepository();
    const realService = new PaymentsService(realRepository, logger);
    const pending = await realService.create(input);
    await realService.transition(pending.id, PaymentStatus.PROCESSING);

    const results = await Promise.allSettled([
      realService.transition(pending.id, PaymentStatus.SUCCEEDED),
      realService.transition(pending.id, PaymentStatus.FAILED),
    ]);
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Payment> =>
        result.status === 'fulfilled',
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toBeInstanceOf(InvalidPaymentTransitionError);

    const winningStatus = fulfilled[0]?.value.status;
    await expect(realService.findById(pending.id)).resolves.toMatchObject({
      status: winningStatus,
    });
    await expect(
      realService.transition(
        pending.id,
        winningStatus === PaymentStatus.SUCCEEDED
          ? PaymentStatus.FAILED
          : PaymentStatus.SUCCEEDED,
      ),
    ).rejects.toBeInstanceOf(InvalidPaymentTransitionError);
    await expect(realService.findById(pending.id)).resolves.toMatchObject({
      status: winningStatus,
    });
  });
});
