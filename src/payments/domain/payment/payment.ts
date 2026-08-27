import { randomUUID } from 'node:crypto';
import {
  InvalidPaymentError,
  InvalidPaymentTransitionError,
} from './payment.errors';
import {
  ALLOWED_PAYMENT_TRANSITIONS,
  MAX_DESCRIPTION_LENGTH,
  MAX_MERCHANT_REFERENCE_LENGTH,
  PAYMENT_CURRENCY,
  PAYMENT_STATUS,
} from './payment.constants';
import type {
  CreatePaymentInput,
  PaymentCurrency,
  PaymentProperties,
  PaymentStatus,
} from './payment.types';

function normalizeMerchantReference(merchantReference: string): string {
  const normalized = merchantReference.trim();

  if (
    normalized.length === 0 ||
    normalized.length > MAX_MERCHANT_REFERENCE_LENGTH
  ) {
    throw new InvalidPaymentError(
      `merchantReference must contain between 1 and ${MAX_MERCHANT_REFERENCE_LENGTH} characters`,
    );
  }

  return normalized;
}

function normalizeDescription(description?: string): string | undefined {
  if (description === undefined) {
    return undefined;
  }

  const normalized = description.trim();

  if (normalized.length > MAX_DESCRIPTION_LENGTH) {
    throw new InvalidPaymentError(
      `description must not exceed ${MAX_DESCRIPTION_LENGTH} characters`,
    );
  }

  return normalized.length === 0 ? undefined : normalized;
}

export class Payment {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly description?: string;
  readonly status: PaymentStatus;
  readonly merchantReference: string;
  readonly currency: PaymentCurrency;
  readonly smallestUnitAmount: number;

  private constructor(properties: PaymentProperties) {
    this.id = properties.id;
    this.status = properties.status;
    this.currency = properties.currency;
    this.createdAt = properties.createdAt;
    this.updatedAt = properties.updatedAt;
    this.description = properties.description;
    this.merchantReference = properties.merchantReference;
    this.smallestUnitAmount = properties.smallestUnitAmount;

    Object.freeze(this);
  }

  static create(input: CreatePaymentInput): Payment {
    if (
      !Number.isSafeInteger(input.smallestUnitAmount) ||
      input.smallestUnitAmount <= 0
    ) {
      throw new InvalidPaymentError(
        'smallestUnitAmount must be a positive safe integer',
      );
    }

    if (input.currency !== PAYMENT_CURRENCY.USD) {
      throw new InvalidPaymentError('currency must be USD');
    }

    const timestamp = new Date().toISOString();

    return new Payment({
      id: randomUUID(),
      createdAt: timestamp,
      updatedAt: timestamp,
      status: PAYMENT_STATUS.PENDING,
      currency: PAYMENT_CURRENCY.USD,
      smallestUnitAmount: input.smallestUnitAmount,
      description: normalizeDescription(input.description),
      merchantReference: normalizeMerchantReference(input.merchantReference),
    });
  }

  transitionTo(nextStatus: PaymentStatus): Payment {
    if (!ALLOWED_PAYMENT_TRANSITIONS[this.status].includes(nextStatus)) {
      throw new InvalidPaymentTransitionError(this.status, nextStatus);
    }

    return new Payment({
      id: this.id,
      smallestUnitAmount: this.smallestUnitAmount,
      currency: this.currency,
      merchantReference: this.merchantReference,
      description: this.description,
      status: nextStatus,
      createdAt: this.createdAt,
      updatedAt: new Date().toISOString(),
    });
  }
}
