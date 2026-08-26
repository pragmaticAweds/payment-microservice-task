import { randomUUID } from 'node:crypto';
import { PinoLogger } from 'nestjs-pino';
import { PaymentNotFoundError } from '../../../src/payments/application/payment-not-found.error';
import { PaymentsService } from '../../../src/payments/application/payments.service';
import { Payment } from '../../../src/payments/domain/payment';
import {
  PaymentCurrency,
  PaymentStatus,
} from '../../../src/payments/domain/payment-status';
import { InvalidPaymentTransitionError } from '../../../src/payments/domain/payment.errors';
import { PaymentRepository } from '../../../src/payments/repositories/payment.repository';

describe('PaymentsService', () => {
  const input = {
    smallestUnitAmount: 1050,
    currency: PaymentCurrency.USD,
    merchantReference: 'order-2026-0001',
    description: 'Invoice 0001',
  };

  let repository: jest.Mocked<PaymentRepository>;
  let logger: PinoLogger;
  let loggerInfo: jest.Mock;
  let service: PaymentsService;

  beforeEach(() => {
    repository = {
      findById: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
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
    expect(repository.save).toHaveBeenCalledWith(payment);
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
    repository.findById.mockResolvedValue(pending);

    const processing = await service.transition(
      pending.id,
      PaymentStatus.PROCESSING,
    );

    expect(pending.status).toBe(PaymentStatus.PENDING);
    expect(processing).not.toBe(pending);
    expect(processing.status).toBe(PaymentStatus.PROCESSING);
    expect(repository.save).toHaveBeenCalledWith(processing);
  });

  it('logs a structured status-transition event', async () => {
    const pending = Payment.create(input);
    repository.findById.mockResolvedValue(pending);

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

  it('does not persist a transition rejected by the aggregate', async () => {
    const pending = Payment.create(input);
    repository.findById.mockResolvedValue(pending);

    await expect(
      service.transition(pending.id, PaymentStatus.SUCCEEDED),
    ).rejects.toBeInstanceOf(InvalidPaymentTransitionError);
    expect(repository.save).not.toHaveBeenCalled();
  });

  it('does not log a status transition rejected by the aggregate', async () => {
    const pending = Payment.create(input);
    repository.findById.mockResolvedValue(pending);

    await expect(
      service.transition(pending.id, PaymentStatus.SUCCEEDED),
    ).rejects.toBeInstanceOf(InvalidPaymentTransitionError);
    expect(loggerInfo).not.toHaveBeenCalled();
  });
});
