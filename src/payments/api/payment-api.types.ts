import type { ApiSuccessResponse } from '../../common/api-response/api-response.types';
import type { Payment } from '../domain/payment/payment';
import { PAYMENT_TRANSITION_TARGETS } from './dto/payment-dto.constants';

export type PaymentDataResponse = ApiSuccessResponse<Payment>;

export type PaymentTransitionTarget =
  (typeof PAYMENT_TRANSITION_TARGETS)[number];
