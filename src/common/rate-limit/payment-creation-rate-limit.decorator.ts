import { SetMetadata } from '@nestjs/common';

export const PAYMENT_CREATION_RATE_LIMIT_METADATA =
  'rate-limit:payment-creation';

export function PaymentCreationRateLimit(): MethodDecorator {
  return SetMetadata(PAYMENT_CREATION_RATE_LIMIT_METADATA, true);
}
