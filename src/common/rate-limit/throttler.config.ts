import { ConfigService } from '@nestjs/config';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import {
  DEFAULT_THROTTLER,
  PAYMENT_CREATE_THROTTLER,
  PAYMENT_CREATION_RATE_LIMIT_METADATA,
} from './rate-limit.constants';

export function createThrottlerOptions(
  config: ConfigService,
): ThrottlerModuleOptions {
  const ttl = config.getOrThrow<number>('THROTTLE_TTL_MS');

  return [
    {
      name: DEFAULT_THROTTLER,
      ttl,
      limit: config.getOrThrow<number>('THROTTLE_LIMIT'),
    },
    {
      name: PAYMENT_CREATE_THROTTLER,
      ttl,
      limit: config.getOrThrow<number>('PAYMENT_CREATE_THROTTLE_LIMIT'),
      skipIf: (context) =>
        Reflect.getMetadata(
          PAYMENT_CREATION_RATE_LIMIT_METADATA,
          context.getHandler(),
        ) !== true,
    },
  ];
}
