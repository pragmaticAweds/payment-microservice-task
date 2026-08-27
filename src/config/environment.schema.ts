import { z } from 'zod';

export const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    SERVICE_NAME: z.string().trim().min(1).default('node-payment-microservice'),
    PORT: z.coerce.number().int().min(1).max(65_535).default(4040),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
      .default('info'),
    PROCESSING_DELAY_MS: z.coerce.number().int().nonnegative().default(1000),
    SIMULATED_SUCCESS_RATE: z.coerce.number().min(0).max(1).default(0.8),
    THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
    THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
    PAYMENT_CREATE_THROTTLE_LIMIT: z.coerce
      .number()
      .int()
      .positive()
      .default(10),
    IDEMPOTENCY_TTL_MS: z.coerce.number().int().positive().default(86_400_000),
  })
  .superRefine((config, context) => {
    if (config.PAYMENT_CREATE_THROTTLE_LIMIT >= config.THROTTLE_LIMIT) {
      context.addIssue({
        code: 'custom',
        message: 'must be lower than THROTTLE_LIMIT',
        path: ['PAYMENT_CREATE_THROTTLE_LIMIT'],
      });
    }
  });
