import type { PaymentStatus } from './payment.types';

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
} as const;

export const PAYMENT_CURRENCY = {
  USD: 'USD',
} as const;

export const MAX_MERCHANT_REFERENCE_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 500;

export const ALLOWED_PAYMENT_TRANSITIONS: Record<
  PaymentStatus,
  readonly PaymentStatus[]
> = {
  [PAYMENT_STATUS.PENDING]: [PAYMENT_STATUS.PROCESSING],
  [PAYMENT_STATUS.PROCESSING]: [
    PAYMENT_STATUS.SUCCEEDED,
    PAYMENT_STATUS.FAILED,
  ],
  [PAYMENT_STATUS.SUCCEEDED]: [],
  [PAYMENT_STATUS.FAILED]: [],
};
