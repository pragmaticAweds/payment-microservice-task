import { SetMetadata } from '@nestjs/common';
import { PAYMENT_CREATION_RATE_LIMIT_METADATA } from './rate-limit.constants';

export function PaymentCreationRateLimit(): MethodDecorator {
  return SetMetadata(PAYMENT_CREATION_RATE_LIMIT_METADATA, true);
}
