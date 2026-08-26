import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  SERVICE_NAME: z.string().trim().min(1).default('node-payment-microservice'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  PROCESSING_DELAY_MS: z.coerce.number().int().nonnegative().default(1000),
  SIMULATED_SUCCESS_RATE: z.coerce.number().min(0).max(1).default(0.8),
  THROTTLE_TTL_MS: z.coerce.number().int().positive().default(60_000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
  PAYMENT_CREATE_THROTTLE_LIMIT: z.coerce.number().int().positive().default(10),
  IDEMPOTENCY_TTL_MS: z.coerce.number().int().positive().default(86_400_000),
});

export type Environment = z.infer<typeof environmentSchema>;

export function validateEnvironment(
  config: Record<string, unknown>,
): Environment {
  const result = environmentSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');

    throw new Error(`Invalid environment configuration: ${issues}`);
  }

  return result.data;
}
