import { PAYMENT_STATUS } from '../../domain/payment/payment.constants';

export const PAYMENT_TRANSITION_TARGETS = [
  PAYMENT_STATUS.PROCESSING,
  PAYMENT_STATUS.SUCCEEDED,
  PAYMENT_STATUS.FAILED,
] as const;
