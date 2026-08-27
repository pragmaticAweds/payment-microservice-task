# Rate Limiting and Health Checks Implementation Plan

> **Execution note:** Use the executing-plans workflow to implement this plan task by task.

**Goal:** Protect the payment API with configuration-driven general and payment-creation rate limits while exposing unversioned, throttle-exempt liveness and readiness probes.

**Architecture:** A dedicated rate-limit module configures two named `@nestjs/throttler` policies through validated `ConfigService` values and registers a global guard with a stable error contract. A health service composes readiness from the payment repository and processor, while a version-neutral controller exposes process-only liveness and payment-work readiness outside the `/api/v1` boundary.

Shutdown uses a two-phase drain: the early lifecycle hook changes readiness
without disrupting already-admitted HTTP work. The controller wraps the entire
idempotent creation operation in a processor-owned admission lease. The final
hook closes new admissions, awaits live leases, recovers canceled completion
timers, and awaits tracked processing callbacks.

**Tech Stack:** Bun 1.3.8, NestJS 11 with Express, `@nestjs/throttler` 6.5.x, TypeScript, Zod, nestjs-pino/Pino, Swagger/OpenAPI, Jest, and Supertest.

**Spec:** `docs/plans/2026-08-26-rate-limiting-and-health-design.md`

## Global constraints

- Work only on `codex/feat/payment-microservice`; do not modify `main`.
- Use `bun`; never use npm, pnpm, or yarn.
- Preserve NestJS's Express adapter, URI-versioned business routes, request IDs,
  Helmet, Pino redaction, and the global error envelope.
- Keep operational routes exactly `/health/live` and `/health/ready`; do not
  place them below `/api/v1`.
- Configure all limits through validated `ConfigService` values. Do not read
  `process.env` inside guards or decorators.
- Apply the `default` throttler to business handlers and the stricter
  `payment-create` throttler only to `POST /api/v1/payments`.
- Require `PAYMENT_CREATE_THROTTLE_LIMIT < THROTTLE_LIMIT` at startup.
- Use the library's in-memory storage and default IP tracker for this
  single-process assessment. Do not enable `trust proxy` implicitly.
- Health routes must skip both named policies while retaining correlation IDs,
  structured HTTP logs, security headers, and exception handling.
- Keep every test under `test/`; use red-green-refactor and focused Conventional
  Commits.
- Do not add a remote, merge, or push during this checkpoint.

---

## File structure

### Rate-limit configuration

- Modify `package.json` and `bun.lock`: add `@nestjs/throttler` through Bun.
- Modify `src/config/environment.ts`: enforce the strict policy relationship.
- Modify `test/unit/runtime-config.module.spec.ts`: test valid and invalid rate
  configurations.
- Create `src/common/rate-limit/payment-creation-rate-limit.decorator.ts`:
  purpose-specific handler metadata.
- Create `src/common/rate-limit/throttler.config.ts`: two named policies from
  `ConfigService`.
- Create `src/common/rate-limit/api-throttler.guard.ts`: stable 429 body.
- Create `src/common/rate-limit/rate-limit.module.ts`: async module setup and
  global guard registration.
- Create `test/unit/rate-limit/throttler.config.spec.ts`: policy selection and
  exception contract.
- Modify `src/app.module.ts`: import the operational rate-limit module.

### Payment creation policy

- Modify `src/payments/api/payments.controller.ts`: mark creation, document 429,
  and document rate-limit headers.
- Create `test/rate-limit.e2e-spec.ts`: general and creation policy behavior.

### Readiness signals

- Modify `src/payments/repositories/payment.repository.ts`: add the readiness
  boundary.
- Modify `src/payments/repositories/in-memory-payment.repository.ts`: lifecycle
  readiness state.
- Modify repository/service/processor test doubles for the new interface.
- Modify `test/unit/payments/in-memory-payment.repository.spec.ts`: initial and
  shutdown readiness.

### Health API

- Create `src/health/dto/health-response.dto.ts`: Swagger response models.
- Create `src/health/health.service.ts`: liveness and composite readiness.
- Create `src/health/health.controller.ts`: unversioned, throttle-exempt probes.
- Modify `src/health/health.module.ts`: import payment dependencies and register
  health providers.
- Modify `src/app.setup.ts`: exclude exact health routes from the global prefix.
- Modify `src/openapi/swagger.ts`: add the Health tag.
- Create `test/unit/health/health.service.spec.ts`: health behavior and logging.
- Create `test/health.e2e-spec.ts`: public paths, success, 503, and Swagger.
- Modify `test/rate-limit.e2e-spec.ts`: prove health remains reachable after
  throttling.

### Checkpoint evidence

- Modify `CHECKPOINTS.md`: mark Checkpoint 7 completed, mark Checkpoint 8
  awaiting user verification, and record exact commands and counts.

---

### Task 1: Configure global throttling from validated settings

**Files:**

- Modify: `package.json`
- Modify: `bun.lock`
- Modify: `src/config/environment.ts`
- Modify: `test/unit/runtime-config.module.spec.ts`
- Create: `src/common/rate-limit/payment-creation-rate-limit.decorator.ts`
- Create: `src/common/rate-limit/throttler.config.ts`
- Create: `src/common/rate-limit/api-throttler.guard.ts`
- Create: `src/common/rate-limit/rate-limit.module.ts`
- Create: `test/unit/rate-limit/throttler.config.spec.ts`
- Modify: `src/app.module.ts`

**Interfaces:**

- Consumes validated `THROTTLE_TTL_MS`, `THROTTLE_LIMIT`, and
  `PAYMENT_CREATE_THROTTLE_LIMIT` values.
- Produces two named throttlers, `PaymentCreationRateLimit()` metadata,
  `ApiThrottlerGuard`, and a global `RateLimitModule`.

- [ ] **Step 1: Install the NestJS throttler through Bun**

```bash
bun add @nestjs/throttler@^6.5.0
```

`6.5.0` is the latest version published to the npm registry as of 2026-08-27,
even though the upstream repository's `master` package metadata reports
`6.5.1`.

Expected: `package.json` and `bun.lock` change; no npm lockfile is created.

- [ ] **Step 2: Write failing configuration and policy tests**

Extend `test/unit/runtime-config.module.spec.ts`:

```ts
it.each([
  [
    { THROTTLE_LIMIT: '10', PAYMENT_CREATE_THROTTLE_LIMIT: '10' },
    'PAYMENT_CREATE_THROTTLE_LIMIT',
  ],
  [
    { THROTTLE_LIMIT: '10', PAYMENT_CREATE_THROTTLE_LIMIT: '11' },
    'PAYMENT_CREATE_THROTTLE_LIMIT',
  ],
])('rejects a payment limit that is not stricter: %o', (config, field) => {
  expect(() => validateEnvironment(config)).toThrow(field);
});

it('accepts a payment creation limit below the general limit', () => {
  expect(
    validateEnvironment({
      THROTTLE_TTL_MS: '5000',
      THROTTLE_LIMIT: '4',
      PAYMENT_CREATE_THROTTLE_LIMIT: '2',
    }),
  ).toMatchObject({
    THROTTLE_TTL_MS: 5000,
    THROTTLE_LIMIT: 4,
    PAYMENT_CREATE_THROTTLE_LIMIT: 2,
  });
});
```

Create `test/unit/rate-limit/throttler.config.spec.ts`:

```ts
import {
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type {
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
  ThrottlerOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { ApiThrottlerGuard } from '../../../src/common/rate-limit/api-throttler.guard';
import { PAYMENT_CREATION_RATE_LIMIT_KEY } from '../../../src/common/rate-limit/payment-creation-rate-limit.decorator';
import {
  createThrottlerOptions,
  DEFAULT_THROTTLER,
  PAYMENT_CREATE_THROTTLER,
} from '../../../src/common/rate-limit/throttler.config';

function policy(
  options: ThrottlerModuleOptions,
  name: string,
): ThrottlerOptions {
  if (Array.isArray(options)) {
    throw new Error('Expected object throttler options');
  }
  const result = options.throttlers.find((item) => item.name === name);
  if (result === undefined) {
    throw new Error(`Missing ${name} policy`);
  }
  return result;
}

class ExposedApiThrottlerGuard extends ApiThrottlerGuard {
  rejectForTest(): Promise<void> {
    return this.throwThrottlingException(
      {} as ExecutionContext,
      {} as ThrottlerLimitDetail,
    );
  }
}

describe('throttler configuration', () => {
  const options = createThrottlerOptions(
    new ConfigService({
      THROTTLE_TTL_MS: 5000,
      THROTTLE_LIMIT: 4,
      PAYMENT_CREATE_THROTTLE_LIMIT: 2,
    }),
  );

  it('builds general and stricter creation policies', () => {
    expect(policy(options, DEFAULT_THROTTLER)).toMatchObject({
      ttl: 5000,
      limit: 4,
    });
    expect(policy(options, PAYMENT_CREATE_THROTTLER)).toMatchObject({
      ttl: 5000,
      limit: 2,
    });
  });

  it('opts the creation policy into marked handlers only', () => {
    const marked = (): void => undefined;
    const unmarked = (): void => undefined;
    Reflect.defineMetadata(PAYMENT_CREATION_RATE_LIMIT_KEY, true, marked);
    const creationPolicy = policy(options, PAYMENT_CREATE_THROTTLER);

    expect(
      creationPolicy.skipIf?.({ getHandler: () => marked } as ExecutionContext),
    ).toBe(false);
    expect(
      creationPolicy.skipIf?.({ getHandler: () => unmarked } as ExecutionContext),
    ).toBe(true);
  });

  it('throws a stable HTTP 429 contract', async () => {
    const guard = new ExposedApiThrottlerGuard(
      [],
      {} as ThrottlerStorage,
      new Reflector(),
    );

    const error = await guard.rejectForTest().catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(
      HttpStatus.TOO_MANY_REQUESTS,
    );
    expect((error as HttpException).getResponse()).toEqual({
      code: 'TOO_MANY_REQUESTS',
      message: 'Rate limit exceeded',
    });
  });
});
```

- [ ] **Step 3: Run the focused tests and verify red**

```bash
bun run test -- runtime-config throttler
```

Expected: FAIL because the cross-field validation and rate-limit modules do not
exist.

- [ ] **Step 4: Enforce the Zod relationship**

Chain this validation onto the object schema in `src/config/environment.ts`:

```ts
const environmentSchema = z
  .object({
    // Retain every existing field unchanged.
  })
  .superRefine((environment, context) => {
    if (
      environment.PAYMENT_CREATE_THROTTLE_LIMIT >= environment.THROTTLE_LIMIT
    ) {
      context.addIssue({
        code: 'custom',
        path: ['PAYMENT_CREATE_THROTTLE_LIMIT'],
        message: 'must be lower than THROTTLE_LIMIT',
      });
    }
  });
```

- [ ] **Step 5: Add the route marker and options factory**

Create `src/common/rate-limit/payment-creation-rate-limit.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';

export const PAYMENT_CREATION_RATE_LIMIT_KEY =
  'rate-limit:payment-creation';

export function PaymentCreationRateLimit(): MethodDecorator {
  return SetMetadata(PAYMENT_CREATION_RATE_LIMIT_KEY, true);
}
```

Create `src/common/rate-limit/throttler.config.ts`:

```ts
import type { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { PAYMENT_CREATION_RATE_LIMIT_KEY } from './payment-creation-rate-limit.decorator';

export const DEFAULT_THROTTLER = 'default';
export const PAYMENT_CREATE_THROTTLER = 'payment-create';

function isPaymentCreationHandler(context: ExecutionContext): boolean {
  return (
    Reflect.getMetadata(
      PAYMENT_CREATION_RATE_LIMIT_KEY,
      context.getHandler(),
    ) === true
  );
}

export function createThrottlerOptions(
  config: ConfigService,
): ThrottlerModuleOptions {
  const ttl = config.getOrThrow<number>('THROTTLE_TTL_MS');

  return {
    throttlers: [
      {
        name: DEFAULT_THROTTLER,
        ttl,
        limit: config.getOrThrow<number>('THROTTLE_LIMIT'),
      },
      {
        name: PAYMENT_CREATE_THROTTLER,
        ttl,
        limit: config.getOrThrow<number>('PAYMENT_CREATE_THROTTLE_LIMIT'),
        skipIf: (context) => !isPaymentCreationHandler(context),
      },
    ],
  };
}
```

- [ ] **Step 6: Add the stable guard and global module**

Create `src/common/rate-limit/api-throttler.guard.ts`:

```ts
import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import {
  ThrottlerGuard,
  type ThrottlerLimitDetail,
} from '@nestjs/throttler';

@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected throwThrottlingException(
    _context: ExecutionContext,
    _detail: ThrottlerLimitDetail,
  ): Promise<void> {
    return Promise.reject(
      new HttpException(
        {
          code: 'TOO_MANY_REQUESTS',
          message: 'Rate limit exceeded',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );
  }
}
```

Create `src/common/rate-limit/rate-limit.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { RuntimeConfigModule } from '../../config/runtime-config.module';
import { ApiThrottlerGuard } from './api-throttler.guard';
import { createThrottlerOptions } from './throttler.config';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [RuntimeConfigModule],
      inject: [ConfigService],
      useFactory: createThrottlerOptions,
    }),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ApiThrottlerGuard,
    },
  ],
})
export class RateLimitModule {}
```

Add `RateLimitModule` to `src/app.module.ts` after `RuntimeConfigModule`.

- [ ] **Step 7: Run focused and full verification**

```bash
bun run format
bun run test -- runtime-config throttler
bun run lint
bun run typecheck
bun run test
bun run test:e2e
```

Expected: focused tests and all existing suites PASS.

- [ ] **Step 8: Commit the configuration slice**

```bash
git add package.json bun.lock src/config/environment.ts src/app.module.ts src/common/rate-limit test/unit/runtime-config.module.spec.ts test/unit/rate-limit/throttler.config.spec.ts
git commit -m "feat(rate-limit): configure global request throttling"
```

---

### Task 2: Enforce and document the payment creation policy

**Files:**

- Modify: `src/payments/api/payments.controller.ts`
- Create: `test/rate-limit.e2e-spec.ts`

**Interfaces:**

- Consumes `PaymentCreationRateLimit()` and the global guard.
- Produces configuration-driven 429 behavior and documented limit headers for
  `POST /api/v1/payments`.

- [ ] **Step 1: Write the failing rate-limit E2E suite**

Create `test/rate-limit.e2e-spec.ts` with a fresh application per test. Build a
complete configuration object with `validateEnvironment`, then override
`ConfigService` so the suite uses `THROTTLE_LIMIT=3`,
`PAYMENT_CREATE_THROTTLE_LIMIT=1`, and a long TTL:

```ts
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { validateEnvironment } from '../src/config/environment';
import { PaymentProcessor } from '../src/payments/processing/payment-processor';

interface RateLimitErrorBody {
  statusCode: number;
  code: string;
  message: string;
  requestId: string;
  timestamp: string;
  path: string;
}

describe('Rate limiting (e2e)', () => {
  const environment = validateEnvironment({
    NODE_ENV: 'test',
    THROTTLE_TTL_MS: '60000',
    THROTTLE_LIMIT: '3',
    PAYMENT_CREATE_THROTTLE_LIMIT: '1',
  });
  const validPayment = {
    smallestUnitAmount: 1050,
    currency: 'USD',
    merchantReference: 'rate-limit-order',
  };
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(environment))
      .overrideProvider(PaymentProcessor)
      .useValue({
        schedule: () => undefined,
        isReady: () => true,
        beforeApplicationShutdown: () => undefined,
        onApplicationShutdown: () => Promise.resolve(),
      } satisfies Pick<
        PaymentProcessor,
        | 'schedule'
        | 'isReady'
        | 'beforeApplicationShutdown'
        | 'onApplicationShutdown'
      >)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('allows normal traffic below the general limit', async () => {
    for (let count = 0; count < 3; count += 1) {
      const response = await request(app.getHttpServer())
        .get('/api/v1')
        .expect(200);
      expect(response.headers['x-ratelimit-limit']).toBe('3');
    }
  });

  it('returns the standard envelope after the general limit', async () => {
    for (let count = 0; count < 3; count += 1) {
      await request(app.getHttpServer()).get('/api/v1').expect(200);
    }
    const response = await request(app.getHttpServer())
      .get('/api/v1')
      .set('x-request-id', 'general-throttle-request')
      .expect(429);
    const body = response.body as RateLimitErrorBody;

    expect(body).toMatchObject({
      statusCode: 429,
      code: 'TOO_MANY_REQUESTS',
      message: 'Rate limit exceeded',
      requestId: 'general-throttle-request',
      path: '/api/v1',
    });
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(response.headers['retry-after']).toBeDefined();
  });

  it('applies the stricter policy to payment creation', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Idempotency-Key', randomUUID())
      .send(validPayment)
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Idempotency-Key', randomUUID())
      .send({ ...validPayment, merchantReference: 'rate-limit-order-2' })
      .expect(429);
    const body = response.body as RateLimitErrorBody;

    expect(body).toMatchObject({
      statusCode: 429,
      code: 'TOO_MANY_REQUESTS',
      path: '/api/v1/payments',
    });
    expect(response.headers['retry-after-payment-create']).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the suite and verify red**

```bash
bun run test:e2e -- rate-limit
```

Expected: the general tests pass, but the stricter creation-policy test FAILS
because the create handler is not marked.

- [ ] **Step 3: Mark creation and document 429**

In `src/payments/api/payments.controller.ts`:

1. import `ApiTooManyRequestsResponse`;
2. import `PaymentCreationRateLimit`;
3. add `@PaymentCreationRateLimit()` to `create`;
4. add the `429` response and response-header metadata.

Use these header objects:

```ts
const RATE_LIMIT_RESPONSE_HEADERS = {
  'X-RateLimit-Limit': {
    description: 'General request limit for this route and time window',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Remaining': {
    description: 'General requests remaining in the current window',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Reset': {
    description: 'Seconds until the general policy resets',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Limit-payment-create': {
    description: 'Payment creation request limit',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Remaining-payment-create': {
    description: 'Payment creation requests remaining',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Reset-payment-create': {
    description: 'Seconds until the payment creation policy resets',
    schema: { type: 'integer' },
  },
} as const;

const THROTTLED_RESPONSE_HEADERS = {
  ...REQUEST_ID_RESPONSE_HEADERS,
  'Retry-After': {
    description: 'Seconds until the general policy permits another request',
    schema: { type: 'integer' },
  },
  'Retry-After-payment-create': {
    description:
      'Seconds until the payment creation policy permits another request',
    schema: { type: 'integer' },
  },
} as const;
```

Merge `RATE_LIMIT_RESPONSE_HEADERS` into `CREATE_PAYMENT_RESPONSE_HEADERS`, then
decorate the create operation:

```ts
@PaymentCreationRateLimit()
@ApiTooManyRequestsResponse({
  description: 'The client exceeded a configured payment or API rate limit',
  headers: THROTTLED_RESPONSE_HEADERS,
  type: ErrorResponseDto,
})
```

- [ ] **Step 4: Run focused and regression verification**

```bash
bun run format
bun run test:e2e -- rate-limit
bun run test:e2e -- payments
bun run lint
bun run typecheck
```

Expected: focused E2E, payment regression, lint, and type checking PASS.

- [ ] **Step 5: Commit payment-route protection**

```bash
git add src/payments/api/payments.controller.ts test/rate-limit.e2e-spec.ts
git commit -m "feat(rate-limit): protect payment creation"
```

---

### Task 3: Add repository readiness lifecycle

**Files:**

- Modify: `src/payments/repositories/payment.repository.ts`
- Modify: `src/payments/repositories/in-memory-payment.repository.ts`
- Modify: `src/payments/processing/payment-processor.ts`
- Modify: `src/payments/api/payments.controller.ts`
- Modify: `test/unit/payments/in-memory-payment.repository.spec.ts`
- Modify: `test/unit/payments/payments.service.spec.ts`
- Modify: `test/unit/payments/payment-processor.spec.ts`
- Modify: `test/payments.e2e-spec.ts`
- Modify: `test/rate-limit.e2e-spec.ts`
- Modify: `test/processing.e2e-spec.ts`

**Interfaces:**

- Adds `PaymentRepository.isReady(): Promise<boolean>`.
- Makes the repository and processor report not ready during Nest's
  `beforeApplicationShutdown` phase, before the HTTP listener closes.
- Keeps repository operations and processor scheduling available during that
  early drain for requests already admitted by the listener.
- Admits the full controller/idempotency creation operation through a
  processor-owned lease and closes new admissions synchronously in the final
  hook.
- After admitted creation promises drain, stops scheduling, recovers canceled
  completion timers to `failed`, and awaits tracked asynchronous processing and
  recovery work.

- [ ] **Step 1: Write the failing repository lifecycle test**

Add to `test/unit/payments/in-memory-payment.repository.spec.ts`:

```ts
it('reports ready until application shutdown begins', async () => {
  await expect(repository.isReady()).resolves.toBe(true);

  repository.beforeApplicationShutdown();

  await expect(repository.isReady()).resolves.toBe(false);
});
```

- [ ] **Step 2: Run the repository test and verify red**

```bash
bun run test -- in-memory-payment.repository
```

Expected: FAIL because the readiness methods do not exist.

- [ ] **Step 3: Extend the repository contract and adapter**

Update `src/payments/repositories/payment.repository.ts`:

```ts
export interface PaymentRepository {
  save(payment: Payment): Promise<void>;
  findById(id: string): Promise<Payment | null>;
  isReady(): Promise<boolean>;
}
```

Update `src/payments/repositories/in-memory-payment.repository.ts`:

```ts
import { BeforeApplicationShutdown, Injectable } from '@nestjs/common';
import { Payment } from '../domain/payment';
import { PaymentRepository } from './payment.repository';

@Injectable()
export class InMemoryPaymentRepository
  implements PaymentRepository, BeforeApplicationShutdown
{
  private readonly payments = new Map<string, Payment>();
  private acceptingWork = true;

  save(payment: Payment): Promise<void> {
    this.payments.set(payment.id, payment);
    return Promise.resolve();
  }

  findById(id: string): Promise<Payment | null> {
    return Promise.resolve(this.payments.get(id) ?? null);
  }

  isReady(): Promise<boolean> {
    return Promise.resolve(this.acceptingWork);
  }

  beforeApplicationShutdown(): void {
    this.acceptingWork = false;
  }
}
```

- [ ] **Step 4: Drain processor work across both shutdown phases**

In `src/payments/processing/payment-processor.ts`, add
`BeforeApplicationShutdown` to the Nest imports and implemented interfaces.
Use separate readiness, admission, and final-stop state. The early hook changes
only the readiness signal. A creation admission remains live through payment
persistence, scheduling, and idempotency-record persistence. The final hook
closes new admissions synchronously, shares one promise across repeated calls,
and enters stopped cancellation only after admitted work drains:

```ts
export interface PaymentCreationAdmission {
  schedule(payment: Payment, idempotencyKey: string): void;
}

export class PaymentProcessor
  implements BeforeApplicationShutdown, OnApplicationShutdown
{
  private ready = true;
  private acceptingAdmissions = true;
  private stopped = false;
  private shutdownPromise: Promise<void> | undefined;
  private readonly admittedCreations = new Set<Promise<void>>();
  private readonly inFlightWork = new Set<Promise<void>>();

  runWithAdmission<T>(
    work: (admission: PaymentCreationAdmission) => Promise<T>,
  ): Promise<T> {
    // Reject new admission synchronously after final shutdown starts, then
    // track a live lease until the complete creation promise settles.
  }

  beforeApplicationShutdown(): void {
    this.ready = false;
  }

  onApplicationShutdown(): Promise<void> {
    this.ready = false;
    this.acceptingAdmissions = false;
    this.shutdownPromise ??= this.drainAdmissionsAndStop();
    return this.shutdownPromise;
  }

  private async drainAdmissionsAndStop(): Promise<void> {
    await Promise.all([...this.admittedCreations]);
    this.stopped = true;
    for (const [task, context] of this.scheduledTasks) {
      if (!this.scheduledTasks.delete(task)) continue;
      task.cancel();
      if (context.phase === 'completing') {
        // Track and await rejection-safe transition to FAILED.
      }
    }
    await Promise.all([...this.inFlightWork]);
  }
}
```

`scheduledTasks` stores each handle with its `ProcessingContext`. Timer
callbacks must atomically remove that ownership before starting a tracked
promise that remains registered through normal work and failure recovery. The
final cancellation path removes the same entry before canceling it, preventing
callback and cancellation paths from double-handling a task. Canceling a
queued `completing` context launches an awaited recovery that transitions an
active payment to `failed` and logs/consumes persistence failures. Canceling a
queued `starting` context leaves the payment `pending`.

Internal timer registration reports whether it succeeded. If final shutdown
starts while the starting phase is already in flight, a failed terminal-timer
registration transitions the current `processing` payment to `failed` inside
that same tracked execution.

Wrap the complete controller create path, outside
`PaymentCreationIdempotencyService.execute`, in `runWithAdmission`. Use only the
lease's schedule method inside the idempotency callback. This makes the
processor-owned admission promise cover payment save, schedule registration,
and the idempotency repository save without relying on Nest HTTP teardown.

Add regressions proving:

- early draining reports not ready but allows an already-admitted payment to
  schedule and complete;
- final shutdown waits for a held background read before resolving;
- that race cannot leave a payment in `processing`;
- canceling a queued completion timer transitions `processing` to `failed` and
  consumes/logs recovery persistence failure;
- an admitted creation held during persistence can schedule and save its
  idempotency record before shutdown resolves;
- new admission after final shutdown starts throws the existing processor
  error; and
- repeated final hooks share one idempotent shutdown promise.

- [ ] **Step 5: Update typed repository doubles**

Add `isReady: jest.fn().mockResolvedValue(true)` to the repository literal in
`test/unit/payments/payments.service.spec.ts`.

Add this method to `ToggleFailureRepository` in
`test/unit/payments/payment-processor.spec.ts`:

```ts
isReady(): ReturnType<PaymentRepository['isReady']> {
  return this.delegate.isReady();
}
```

In `test/payments.e2e-spec.ts` and `test/rate-limit.e2e-spec.ts`, make processor
doubles include the admission method and both lifecycle hooks, return a promise
from the final hook, and use `satisfies Pick<PaymentProcessor, ...>` so future
lifecycle changes fail at compile time instead of drifting silently. Update
processing E2E setup and direct processor tests to enter the same production
admission boundary before scheduling.

- [ ] **Step 6: Run focused and full unit verification**

```bash
bun run format
bun run test -- repository payments.service processor
bun run lint
bun run typecheck
bun run test
bun run test:e2e -- payments rate-limit processing
bun run test:e2e
bun run build
```

Expected: focused processor and E2E regressions plus complete unit, E2E, and
build verification PASS.

- [ ] **Step 7: Commit the readiness boundary**

```bash
git add src/payments/repositories/payment.repository.ts src/payments/repositories/in-memory-payment.repository.ts src/payments/processing/payment-processor.ts test/unit/payments/in-memory-payment.repository.spec.ts test/unit/payments/payments.service.spec.ts test/unit/payments/payment-processor.spec.ts
git commit -m "feat(health): expose payment readiness signals"
```

After review of shutdown ordering, deliver the two-phase drain correction
separately:

```bash
git add src/payments/processing/payment-processor.ts test/unit/payments/payment-processor.spec.ts test/payments.e2e-spec.ts test/rate-limit.e2e-spec.ts
git commit -m "fix(processing): drain work during shutdown"
```

Complete the reviewed timer and admission ownership model in focused commits:

```bash
git add src/payments/processing/payment-processor.ts test/unit/payments/payment-processor.spec.ts
git commit -m "fix(processing): finalize canceled completions"

git add src/payments/processing/payment-processor.ts src/payments/api/payments.controller.ts test/unit/payments/payment-processor.spec.ts test/payments.e2e-spec.ts test/rate-limit.e2e-spec.ts test/processing.e2e-spec.ts
git commit -m "fix(processing): drain admitted creations"
```

---

### Task 4: Expose liveness and readiness endpoints

**Files:**

- Create: `src/health/dto/health-response.dto.ts`
- Create: `src/health/health.service.ts`
- Create: `src/health/health.controller.ts`
- Modify: `src/health/health.module.ts`
- Modify: `src/app.setup.ts`
- Modify: `src/openapi/swagger.ts`
- Create: `test/unit/health/health.service.spec.ts`
- Create: `test/health.e2e-spec.ts`
- Modify: `test/rate-limit.e2e-spec.ts`

**Interfaces:**

- Produces `GET /health/live` with `{ data: { status: 'live' } }`.
- Produces `GET /health/ready` with dependency states or standardized
  `503 SERVICE_NOT_READY`.

- [ ] **Step 1: Write failing health service tests**

Create `test/unit/health/health.service.spec.ts`:

```ts
import { ServiceUnavailableException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { HealthService } from '../../../src/health/health.service';
import { PaymentProcessor } from '../../../src/payments/processing/payment-processor';
import type { PaymentRepository } from '../../../src/payments/repositories/payment.repository';

describe('HealthService', () => {
  let repository: jest.Mocked<PaymentRepository>;
  let processorReady: jest.Mock;
  let loggerError: jest.Mock;
  let loggerWarn: jest.Mock;
  let service: HealthService;

  beforeEach(() => {
    repository = {
      save: jest.fn(),
      findById: jest.fn(),
      isReady: jest.fn().mockResolvedValue(true),
    };
    processorReady = jest.fn().mockReturnValue(true);
    loggerError = jest.fn();
    loggerWarn = jest.fn();
    service = new HealthService(
      repository,
      { isReady: processorReady } as unknown as PaymentProcessor,
      {
        error: loggerError,
        warn: loggerWarn,
      } as unknown as PinoLogger,
    );
  });

  it('reports process-only liveness', () => {
    expect(service.liveness()).toEqual({ data: { status: 'live' } });
    expect(repository.isReady).not.toHaveBeenCalled();
    expect(processorReady).not.toHaveBeenCalled();
  });

  it('reports ready when repository and processor accept work', async () => {
    await expect(service.readiness()).resolves.toEqual({
      data: {
        status: 'ready',
        checks: { repository: 'ready', processor: 'ready' },
      },
    });
  });

  it.each([
    ['repository', false, true],
    ['processor', true, false],
  ])(
    'returns 503 when %s is not ready',
    async (_dependency, repositoryReady, paymentProcessorReady) => {
      repository.isReady.mockResolvedValue(repositoryReady);
      processorReady.mockReturnValue(paymentProcessorReady);

      const error = await service
        .readiness()
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getResponse()).toEqual({
        code: 'SERVICE_NOT_READY',
        message: 'Service is not ready to accept payment work',
        details: {
          checks: {
            repository: repositoryReady ? 'ready' : 'not_ready',
            processor: paymentProcessorReady ? 'ready' : 'not_ready',
          },
        },
      });
      expect(loggerWarn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'health.not_ready' }),
        'Service is not ready',
      );
    },
  );

  it('logs a repository exception and returns a safe 503', async () => {
    repository.isReady.mockRejectedValue(new Error('database secret detail'));

    const error = await service.readiness().catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    expect(JSON.stringify((error as ServiceUnavailableException).getResponse()))
      .not.toContain('database secret detail');
    expect(loggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'health.readiness_dependency_failed',
        dependency: 'repository',
        err: expect.any(Error),
      }),
      'Readiness dependency check failed',
    );
  });
});
```

- [ ] **Step 2: Write failing health E2E tests**

Create `test/health.e2e-spec.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { PaymentProcessor } from '../src/payments/processing/payment-processor';

interface HealthErrorBody {
  statusCode: number;
  code: string;
  message: string;
  requestId: string;
  timestamp: string;
  path: string;
  details: {
    checks: {
      repository: 'ready' | 'not_ready';
      processor: 'ready' | 'not_ready';
    };
  };
}

interface HealthOpenApiDocument {
  paths: Record<
    string,
    {
      get?: { responses: Record<string, unknown> };
    }
  >;
}

describe('Health API (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('serves unversioned liveness and readiness', async () => {
    await request(app.getHttpServer()).get('/health/live').expect(200).expect({
      data: { status: 'live' },
    });
    await request(app.getHttpServer()).get('/health/ready').expect(200).expect({
      data: {
        status: 'ready',
        checks: { repository: 'ready', processor: 'ready' },
      },
    });
    await request(app.getHttpServer()).get('/api/v1/health/live').expect(404);
  });

  it('returns the standard 503 envelope after shutdown readiness is signaled', async () => {
    app.get(PaymentProcessor).beforeApplicationShutdown();
    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .set('x-request-id', 'shutdown-readiness-request')
      .expect(503);
    const body = response.body as HealthErrorBody;

    expect(body).toMatchObject({
      statusCode: 503,
      code: 'SERVICE_NOT_READY',
      message: 'Service is not ready to accept payment work',
      requestId: 'shutdown-readiness-request',
      path: '/health/ready',
      details: {
        checks: { repository: 'ready', processor: 'not_ready' },
      },
    });
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
  });

  it('documents both health probes in OpenAPI', async () => {
    const response = await request(app.getHttpServer())
      .get('/docs-json')
      .expect(200);
    const document = response.body as HealthOpenApiDocument;

    expect(document.paths['/health/live']?.get?.responses).toHaveProperty(
      '200',
    );
    expect(document.paths['/health/ready']?.get?.responses).toHaveProperty(
      '200',
    );
    expect(document.paths['/health/ready']?.get?.responses).toHaveProperty(
      '503',
    );
  });
});
```

Extend `test/rate-limit.e2e-spec.ts`:

```ts
it('keeps health probes available after the API limit is exhausted', async () => {
  for (let count = 0; count < 3; count += 1) {
    await request(app.getHttpServer()).get('/api/v1').expect(200);
  }
  await request(app.getHttpServer()).get('/api/v1').expect(429);

  await request(app.getHttpServer()).get('/health/live').expect(200);
  await request(app.getHttpServer()).get('/health/ready').expect(200);
});
```

- [ ] **Step 3: Run the health tests and verify red**

```bash
bun run test -- health
bun run test:e2e -- health
```

Expected: FAIL because the health service, controller, and routes do not exist.

- [ ] **Step 4: Add Swagger health response DTOs**

Create `src/health/dto/health-response.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';

export class LivenessDataDto {
  @ApiProperty({ example: 'live', enum: ['live'] })
  status!: 'live';
}

export class LivenessResponseDto {
  @ApiProperty({ type: LivenessDataDto })
  data!: LivenessDataDto;
}

export class ReadinessChecksDto {
  @ApiProperty({ example: 'ready', enum: ['ready', 'not_ready'] })
  repository!: 'ready' | 'not_ready';

  @ApiProperty({ example: 'ready', enum: ['ready', 'not_ready'] })
  processor!: 'ready' | 'not_ready';
}

export class ReadinessDataDto {
  @ApiProperty({ example: 'ready', enum: ['ready'] })
  status!: 'ready';

  @ApiProperty({ type: ReadinessChecksDto })
  checks!: ReadinessChecksDto;
}

export class ReadinessResponseDto {
  @ApiProperty({ type: ReadinessDataDto })
  data!: ReadinessDataDto;
}
```

- [ ] **Step 5: Implement composite health behavior**

Create `src/health/health.service.ts`:

```ts
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { PaymentProcessor } from '../payments/processing/payment-processor';
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
} from '../payments/repositories/payment.repository';
import type {
  LivenessResponseDto,
  ReadinessChecksDto,
  ReadinessResponseDto,
} from './dto/health-response.dto';

@Injectable()
export class HealthService {
  constructor(
    @Inject(PAYMENT_REPOSITORY)
    private readonly repository: PaymentRepository,
    private readonly processor: PaymentProcessor,
    @InjectPinoLogger(HealthService.name)
    private readonly logger: PinoLogger,
  ) {}

  liveness(): LivenessResponseDto {
    return { data: { status: 'live' } };
  }

  async readiness(): Promise<ReadinessResponseDto> {
    const repositoryReady = await this.checkRepository();
    const processorReady = this.checkProcessor();
    const checks: ReadinessChecksDto = {
      repository: repositoryReady ? 'ready' : 'not_ready',
      processor: processorReady ? 'ready' : 'not_ready',
    };

    if (!repositoryReady || !processorReady) {
      this.logger.warn(
        { event: 'health.not_ready', checks },
        'Service is not ready',
      );
      throw new ServiceUnavailableException({
        code: 'SERVICE_NOT_READY',
        message: 'Service is not ready to accept payment work',
        details: { checks },
      });
    }

    return { data: { status: 'ready', checks } };
  }

  private async checkRepository(): Promise<boolean> {
    try {
      return await this.repository.isReady();
    } catch (error) {
      this.logDependencyFailure('repository', error);
      return false;
    }
  }

  private checkProcessor(): boolean {
    try {
      return this.processor.isReady();
    } catch (error) {
      this.logDependencyFailure('processor', error);
      return false;
    }
  }

  private logDependencyFailure(dependency: string, error: unknown): void {
    this.logger.error(
      {
        event: 'health.readiness_dependency_failed',
        dependency,
        err:
          error instanceof Error
            ? error
            : new Error('Unknown readiness dependency failure'),
      },
      'Readiness dependency check failed',
    );
  }
}
```

- [ ] **Step 6: Add the throttle-exempt controller and module**

Create `src/health/health.controller.ts`:

```ts
import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { ErrorResponseDto } from '../common/openapi/error-response.dto';
import {
  LivenessResponseDto,
  ReadinessResponseDto,
} from './dto/health-response.dto';
import { HealthService } from './health.service';

const HEALTH_RESPONSE_HEADERS = {
  'x-request-id': {
    description: 'Effective request correlation identifier',
    schema: { type: 'string' },
  },
} as const;

@ApiTags('Health')
@SkipThrottle({ default: true, 'payment-create': true })
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('live')
  @ApiOperation({ summary: 'Check whether the process can serve requests' })
  @ApiOkResponse({
    description: 'The process is live',
    headers: HEALTH_RESPONSE_HEADERS,
    type: LivenessResponseDto,
  })
  live(): LivenessResponseDto {
    return this.health.liveness();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Check whether payment work can be accepted' })
  @ApiOkResponse({
    description: 'Repository and processor are ready',
    headers: HEALTH_RESPONSE_HEADERS,
    type: ReadinessResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'At least one payment-work dependency is not ready',
    headers: HEALTH_RESPONSE_HEADERS,
    type: ErrorResponseDto,
  })
  ready(): Promise<ReadinessResponseDto> {
    return this.health.readiness();
  }
}
```

Replace `src/health/health.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [PaymentsModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
```

- [ ] **Step 7: Exclude health from the API prefix and add Swagger tag**

Update `src/app.setup.ts`:

```ts
import {
  INestApplication,
  RequestMethod,
  VersioningType,
} from '@nestjs/common';

// Keep Helmet and the remaining setup unchanged.
app.setGlobalPrefix('api', {
  exclude: [
    { path: 'health/live', method: RequestMethod.GET },
    { path: 'health/ready', method: RequestMethod.GET },
  ],
});
```

Add to the `DocumentBuilder` chain in `src/openapi/swagger.ts`:

```ts
.addTag('Health', 'Liveness and payment-work readiness probes')
```

- [ ] **Step 8: Run health, throttle, Swagger, and regression checks**

```bash
bun run format
bun run test -- health repository
bun run test:e2e -- health rate-limit payments
bun run lint
bun run typecheck
bun run build
```

Expected: all focused tests, lint, type checking, and build PASS.

- [ ] **Step 9: Commit the health endpoints**

```bash
git add src/health src/app.setup.ts src/openapi/swagger.ts test/unit/health/health.service.spec.ts test/health.e2e-spec.ts test/rate-limit.e2e-spec.ts
git commit -m "feat(health): add readiness and liveness probes"
```

---

### Task 5: Verify and record Checkpoint 8

**Files:**

- Modify: `CHECKPOINTS.md`

- [ ] **Step 1: Run the clean dependency check**

```bash
bun install --frozen-lockfile
```

Expected: install succeeds without changing `package.json` or `bun.lock`.

- [ ] **Step 2: Run all static verification**

```bash
bun run format:check
bun run lint
bun run typecheck
bun run build
git diff --check
```

Expected: every command exits zero.

- [ ] **Step 3: Run focused tests**

```bash
bun run test -- health throttler repository
bun run test:e2e -- health rate-limit
```

Expected: all focused unit and E2E suites PASS.

- [ ] **Step 4: Run complete regression suites**

```bash
bun run test
bun run test:e2e
```

Expected: all unit and E2E suites PASS with no open handles or unhandled
rejections.

- [ ] **Step 5: Inspect the generated OpenAPI contract manually**

Start the service on an unused port:

```bash
PORT=3108 bun run start
```

Verify `/docs-json` contains `/health/live`, `/health/ready`, and the payment
creation `429`, then stop the process. Expected: both probes are unversioned and
the existing payment routes remain below `/api/v1`.

- [ ] **Step 6: Record exact evidence**

Update `CHECKPOINTS.md`:

- change Checkpoint 7 from `Awaiting user verification` to `Completed`;
- change Checkpoint 8 from `Not started` to `Awaiting user verification`;
- add implementation evidence for named policies, stable 429 handling,
  throttle-exempt probes, composite readiness, shutdown behavior, Swagger, and
  structured logs;
- add the exact dependency count, test suite/test counts, and static command
  outcomes from this run;
- list the Checkpoint 8 implementation commit hashes.

- [ ] **Step 7: Commit checkpoint evidence**

```bash
git add CHECKPOINTS.md
git commit -m "docs(checkpoints): record checkpoint 8 verification"
```

- [ ] **Step 8: Confirm the checkpoint handoff state**

```bash
git status --short --branch
git log --oneline --decorate -12
git remote -v
```

Expected: branch `codex/feat/payment-microservice`, clean working tree, all
Checkpoint 8 commits visible, and no remote configured. Stop for user
verification before Checkpoint 9.
