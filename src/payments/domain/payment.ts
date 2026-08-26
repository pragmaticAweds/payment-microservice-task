import { randomUUID } from 'node:crypto';
import {
  InvalidPaymentError,
  InvalidPaymentTransitionError,
} from './payment.errors';
import { PaymentCurrency, PaymentStatus } from './payment-status';

const MAX_MERCHANT_REFERENCE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 500;

const ALLOWED_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  [PaymentStatus.PENDING]: [PaymentStatus.PROCESSING],
  [PaymentStatus.PROCESSING]: [PaymentStatus.SUCCEEDED, PaymentStatus.FAILED],
  [PaymentStatus.SUCCEEDED]: [],
  [PaymentStatus.FAILED]: [],
};

export interface CreatePaymentInput {
  smallestUnitAmount: number;
  currency: PaymentCurrency;
  merchantReference: string;
  description?: string;
}

interface PaymentProperties {
  id: string;
  smallestUnitAmount: number;
  currency: PaymentCurrency;
  merchantReference: string;
  description?: string;
  status: PaymentStatus;
  createdAt: string;
  updatedAt: string;
}

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
  readonly smallestUnitAmount: number;
  readonly currency: PaymentCurrency;
  readonly merchantReference: string;
  readonly description?: string;
  readonly status: PaymentStatus;
  readonly createdAt: string;
  readonly updatedAt: string;

  private constructor(properties: PaymentProperties) {
    this.id = properties.id;
    this.smallestUnitAmount = properties.smallestUnitAmount;
    this.currency = properties.currency;
    this.merchantReference = properties.merchantReference;
    this.description = properties.description;
    this.status = properties.status;
    this.createdAt = properties.createdAt;
    this.updatedAt = properties.updatedAt;

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

    if (input.currency !== PaymentCurrency.USD) {
      throw new InvalidPaymentError('currency must be USD');
    }

    const timestamp = new Date().toISOString();

    return new Payment({
      id: randomUUID(),
      smallestUnitAmount: input.smallestUnitAmount,
      currency: PaymentCurrency.USD,
      merchantReference: normalizeMerchantReference(input.merchantReference),
      description: normalizeDescription(input.description),
      status: PaymentStatus.PENDING,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  transitionTo(nextStatus: PaymentStatus): Payment {
    if (!ALLOWED_TRANSITIONS[this.status].includes(nextStatus)) {
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
