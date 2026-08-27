import { PAYMENT_CURRENCY, PAYMENT_STATUS } from './payment.constants';

export type PaymentStatus =
  (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export type PaymentCurrency =
  (typeof PAYMENT_CURRENCY)[keyof typeof PAYMENT_CURRENCY];

export interface CreatePaymentInput {
  smallestUnitAmount: number;
  currency: PaymentCurrency;
  merchantReference: string;
  description?: string;
}

export interface PaymentProperties extends CreatePaymentInput {
  id: string;
  status: PaymentStatus;
  createdAt: string;
  updatedAt: string;
}
