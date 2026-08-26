# Asynchronous Deterministic Payment Processing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Process each newly created payment asynchronously through `pending -> processing -> succeeded | failed` using a configurable delay and deterministic outcome while preserving idempotent creation semantics.

**Architecture:** `PaymentProcessor` owns cancellable background work and delegates legal state changes to the existing `PaymentsService`. Scheduling and outcome resolution live behind injection-token interfaces; the controller schedules only inside the idempotency coordinator's fresh-request callback, so replays never create another job.

**Tech Stack:** Bun 1.3.8, NestJS 11 with Express, TypeScript, Zod configuration, Node.js SHA-256 and timers, nestjs-pino/Pino, Jest fake timers, and Supertest.

**Spec:** `docs/plans/2026-08-26-asynchronous-payment-processing-design.md`

## Global Constraints

- Work only on `codex/feat/payment-microservice`; do not modify `main`.
- Use `/Users/abdulafeezpifapp/.bun/bin/bun` for every package script; do not use npm, pnpm, or yarn.
- Keep the default NestJS Express adapter and the existing `{ "data": payment }` success envelope.
- Preserve concurrency-safe `Idempotency-Key` behavior: only a fresh creation callback schedules work, while replays return the immutable original response.
- Keep the payment aggregate free of NestJS, timer, hashing, and HTTP concerns.
- Use `PROCESSING_DELAY_MS` as a nonnegative integer and `SIMULATED_SUCCESS_RATE` as a number from `0` through `1`.
- Derive outcomes only from `<idempotencyKey>:<smallestUnitAmount>:<currency>` using SHA-256 and a 32-bit unsigned score divided by `2^32`.
- Never log the raw idempotency key, payment description, or request body.
- Every background promise must have an attached rejection handler; recovery failures must be logged and consumed.
- Track and cancel owned timers during Nest shutdown.
- Keep all tests under `test/` and create focused Conventional Commits.
- Do not add a remote, merge, or push during this checkpoint.

---

## File structure

### Deterministic outcome boundary

- Create `src/payments/processing/payment-outcome-resolver.ts`: token, input, terminal-status type, and resolver interface.
- Create `src/payments/processing/deterministic-payment-outcome.resolver.ts`: configured SHA-256 implementation.
- Create `test/unit/payments/deterministic-payment-outcome.resolver.spec.ts`: literal deterministic fixtures and rate boundaries.
- Modify `test/unit/runtime-config.module.spec.ts`: validate success-rate and delay boundaries.

### Scheduling boundary

- Create `src/payments/processing/processing-scheduler.ts`: cancellable scheduler token and interfaces.
- Create `src/payments/processing/timeout-processing.scheduler.ts`: `setTimeout`/`clearTimeout` adapter.
- Create `test/unit/payments/timeout-processing.scheduler.spec.ts`: delay and cancellation behavior under Jest fake timers.

### Processor application service

- Create `src/payments/processing/payment-processor.ts`: asynchronous transition orchestration, logs, recovery, timer tracking, readiness, and shutdown.
- Create `test/unit/payments/payment-processor.spec.ts`: real payment service/repository tests with fake timers.

### Creation-flow integration

- Modify `src/payments/application/payment-creation-idempotency.service.ts`: pass the validated key into the fresh-request callback.
- Modify `src/payments/api/payments.controller.ts`: schedule a newly persisted payment inside that callback.
- Modify `src/payments/payments.module.ts`: register scheduler, resolver, and processor providers.
- Modify `test/unit/payments/payment-creation-idempotency.service.spec.ts`: prove the validated key reaches only the fresh callback.
- Modify `test/unit/payments/payments.module.spec.ts`: verify injection-token adapters and processor wiring.
- Modify `test/payments.e2e-spec.ts`: disable background processing in the explicit manual-transition suite.
- Create `test/processing.e2e-spec.ts`: exercise the real HTTP-to-background flow.

### Checkpoint evidence

- Modify `CHECKPOINTS.md`: mark Checkpoint 6 completed, mark Checkpoint 7 awaiting user verification, and record exact results.

---

### Task 1: Add deterministic outcome resolution

**Files:**

- Create: `src/payments/processing/payment-outcome-resolver.ts`
- Create: `src/payments/processing/deterministic-payment-outcome.resolver.ts`
- Create: `test/unit/payments/deterministic-payment-outcome.resolver.spec.ts`
- Modify: `test/unit/runtime-config.module.spec.ts`

**Interfaces:**

- Consumes: `ConfigService.getOrThrow<number>('SIMULATED_SUCCESS_RATE')`, `PaymentCurrency`, and terminal `PaymentStatus` values.
- Produces: `PAYMENT_OUTCOME_RESOLVER`, `PaymentOutcomeInput`, `TerminalPaymentStatus`, `PaymentOutcomeResolver.resolve(input): TerminalPaymentStatus`, and `DeterministicPaymentOutcomeResolver`.

- [ ] **Step 1: Write failing deterministic-outcome tests**

Create `test/unit/payments/deterministic-payment-outcome.resolver.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { DeterministicPaymentOutcomeResolver } from '../../../src/payments/processing/deterministic-payment-outcome.resolver';
import {
  PaymentCurrency,
  PaymentStatus,
} from '../../../src/payments/domain/payment-status';

function resolverWithRate(rate: number): DeterministicPaymentOutcomeResolver {
  return new DeterministicPaymentOutcomeResolver(
    new ConfigService({ SIMULATED_SUCCESS_RATE: rate }),
  );
}

describe('DeterministicPaymentOutcomeResolver', () => {
  const baseInput = {
    smallestUnitAmount: 1050,
    currency: PaymentCurrency.USD,
  };

  it('succeeds when the hand-checked score is below the threshold', () => {
    expect(
      resolverWithRate(0.25).resolve({
        ...baseInput,
        idempotencyKey: 'success-key',
      }),
    ).toBe(PaymentStatus.SUCCEEDED);
  });

  it('fails when the hand-checked score is at or above the threshold', () => {
    expect(
      resolverWithRate(0.25).resolve({
        ...baseInput,
        idempotencyKey: 'failure-key',
      }),
    ).toBe(PaymentStatus.FAILED);
  });

  it('returns the same outcome for repeated identical input', () => {
    const resolver = resolverWithRate(0.5);
    const input = {
      idempotencyKey: 'stable-key',
      smallestUnitAmount: 2500,
      currency: PaymentCurrency.USD,
    };
    expect(resolver.resolve(input)).toBe(PaymentStatus.FAILED);
    expect(resolver.resolve(input)).toBe(PaymentStatus.FAILED);
  });

  it('always fails at zero and always succeeds at one', () => {
    const input = { ...baseInput, idempotencyKey: 'any-key' };
    expect(resolverWithRate(0).resolve(input)).toBe(PaymentStatus.FAILED);
    expect(resolverWithRate(1).resolve(input)).toBe(PaymentStatus.SUCCEEDED);
  });
});
```

The literal expectations come from independently checked scores:
`success-key:1050:USD = 0.08876773086376488`,
`failure-key:1050:USD = 0.4475272065028548`, and
`stable-key:2500:USD = 0.5299517509993166`.

Replace the existing single invalid-configuration test in
`test/unit/runtime-config.module.spec.ts` with the parameterized test below,
then add the boundary-value test:

```ts
it.each([
  [{ SIMULATED_SUCCESS_RATE: '-0.01' }, 'SIMULATED_SUCCESS_RATE'],
  [{ SIMULATED_SUCCESS_RATE: '1.01' }, 'SIMULATED_SUCCESS_RATE'],
  [{ PROCESSING_DELAY_MS: '-1' }, 'PROCESSING_DELAY_MS'],
])('rejects invalid processing config %o', (config, field) => {
  expect(() => validateEnvironment(config)).toThrow(field);
});

it('accepts processing configuration boundary values', () => {
  expect(
    validateEnvironment({
      PROCESSING_DELAY_MS: '0',
      SIMULATED_SUCCESS_RATE: '1',
    }),
  ).toMatchObject({
    PROCESSING_DELAY_MS: 0,
    SIMULATED_SUCCESS_RATE: 1,
  });
});
```

- [ ] **Step 2: Run the focused tests and verify red**

```bash
/Users/abdulafeezpifapp/.bun/bin/bun run test -- outcome runtime-config
```

Expected: FAIL because the resolver modules do not exist.

- [ ] **Step 3: Add the resolver interface**

Create `src/payments/processing/payment-outcome-resolver.ts`:

```ts
import type { PaymentCurrency } from '../domain/payment-status';
import { PaymentStatus } from '../domain/payment-status';

export const PAYMENT_OUTCOME_RESOLVER = Symbol('PAYMENT_OUTCOME_RESOLVER');

export type TerminalPaymentStatus =
  PaymentStatus.SUCCEEDED | PaymentStatus.FAILED;

export interface PaymentOutcomeInput {
  idempotencyKey: string;
  smallestUnitAmount: number;
  currency: PaymentCurrency;
}

export interface PaymentOutcomeResolver {
  resolve(input: PaymentOutcomeInput): TerminalPaymentStatus;
}
```

- [ ] **Step 4: Implement the SHA-256 resolver**

Create `src/payments/processing/deterministic-payment-outcome.resolver.ts`:

```ts
import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus } from '../domain/payment-status';
import {
  type PaymentOutcomeInput,
  type PaymentOutcomeResolver,
  type TerminalPaymentStatus,
} from './payment-outcome-resolver';

@Injectable()
export class DeterministicPaymentOutcomeResolver implements PaymentOutcomeResolver {
  private readonly successRate: number;

  constructor(config: ConfigService) {
    this.successRate = config.getOrThrow<number>('SIMULATED_SUCCESS_RATE');
  }

  resolve(input: PaymentOutcomeInput): TerminalPaymentStatus {
    const seed = `${input.idempotencyKey}:${input.smallestUnitAmount}:${input.currency}`;
    const digest = createHash('sha256').update(seed).digest();
    const score = digest.readUInt32BE(0) / 2 ** 32;

    return score < this.successRate
      ? PaymentStatus.SUCCEEDED
      : PaymentStatus.FAILED;
  }
}
```

- [ ] **Step 5: Run focused and static verification**

```bash
/Users/abdulafeezpifapp/.bun/bin/bun run test -- outcome runtime-config
/Users/abdulafeezpifapp/.bun/bin/bun run format
/Users/abdulafeezpifapp/.bun/bin/bun run lint
/Users/abdulafeezpifapp/.bun/bin/bun run typecheck
```

Expected: focused tests, lint, and type checking PASS.

- [ ] **Step 6: Commit the resolver boundary**

```bash
git add src/payments/processing/payment-outcome-resolver.ts src/payments/processing/deterministic-payment-outcome.resolver.ts test/unit/payments/deterministic-payment-outcome.resolver.spec.ts test/unit/runtime-config.module.spec.ts
git commit -m "feat(processing): add deterministic outcome resolver"
```

---

### Task 2: Add a cancellable timeout scheduler

**Files:**

- Create: `src/payments/processing/processing-scheduler.ts`
- Create: `src/payments/processing/timeout-processing.scheduler.ts`
- Create: `test/unit/payments/timeout-processing.scheduler.spec.ts`

**Interfaces:**

- Consumes: Node.js `setTimeout` and `clearTimeout`.
- Produces: `PROCESSING_SCHEDULER`, `ScheduledProcessingTask.cancel(): void`, `ProcessingScheduler.schedule(delayMs, task): ScheduledProcessingTask`, and `TimeoutProcessingScheduler`.

- [ ] **Step 1: Write failing scheduler tests**

Create `test/unit/payments/timeout-processing.scheduler.spec.ts`:

```ts
import { TimeoutProcessingScheduler } from '../../../src/payments/processing/timeout-processing.scheduler';

describe('TimeoutProcessingScheduler', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs a task only after the configured delay', () => {
    const scheduler = new TimeoutProcessingScheduler();
    let executions = 0;
    scheduler.schedule(50, () => {
      executions += 1;
    });

    jest.advanceTimersByTime(49);
    expect(executions).toBe(0);
    jest.advanceTimersByTime(1);
    expect(executions).toBe(1);
  });

  it('cancels a task before it runs', () => {
    const scheduler = new TimeoutProcessingScheduler();
    let executions = 0;
    const task = scheduler.schedule(50, () => {
      executions += 1;
    });

    task.cancel();
    jest.runAllTimers();
    expect(executions).toBe(0);
  });
});
```

- [ ] **Step 2: Run the scheduler test and verify red**

```bash
/Users/abdulafeezpifapp/.bun/bin/bun run test -- timeout-processing
```

Expected: FAIL because the scheduler adapter does not exist.

- [ ] **Step 3: Add the scheduler interface and adapter**

Create `src/payments/processing/processing-scheduler.ts`:

```ts
export const PROCESSING_SCHEDULER = Symbol('PROCESSING_SCHEDULER');

export interface ScheduledProcessingTask {
  cancel(): void;
}

export interface ProcessingScheduler {
  schedule(delayMs: number, task: () => void): ScheduledProcessingTask;
}
```

Create `src/payments/processing/timeout-processing.scheduler.ts`:

```ts
import { Injectable } from '@nestjs/common';
import {
  type ProcessingScheduler,
  type ScheduledProcessingTask,
} from './processing-scheduler';

@Injectable()
export class TimeoutProcessingScheduler implements ProcessingScheduler {
  schedule(delayMs: number, task: () => void): ScheduledProcessingTask {
    const timeout = setTimeout(task, delayMs);
    return { cancel: () => clearTimeout(timeout) };
  }
}
```

- [ ] **Step 4: Run focused and static verification**

```bash
/Users/abdulafeezpifapp/.bun/bin/bun run test -- timeout-processing
/Users/abdulafeezpifapp/.bun/bin/bun run format
/Users/abdulafeezpifapp/.bun/bin/bun run lint
/Users/abdulafeezpifapp/.bun/bin/bun run typecheck
```

Expected: scheduler tests, lint, and type checking PASS.

- [ ] **Step 5: Commit the scheduler boundary**

```bash
git add src/payments/processing/processing-scheduler.ts src/payments/processing/timeout-processing.scheduler.ts test/unit/payments/timeout-processing.scheduler.spec.ts
git commit -m "feat(processing): add cancellable timeout scheduler"
```

---

### Task 3: Implement the background payment processor

**Files:**

- Create: `src/payments/processing/payment-processor.ts`
- Create: `test/unit/payments/payment-processor.spec.ts`

**Interfaces:**

- Consumes: `PaymentsService.findById`, `PaymentsService.transition`, `ProcessingScheduler`, `PaymentOutcomeResolver`, `PROCESSING_DELAY_MS`, the immutable `Payment`, and `PinoLogger`.
- Produces: `PaymentProcessor.schedule(payment, idempotencyKey): void`, `PaymentProcessor.isReady(): boolean`, and `PaymentProcessor.onApplicationShutdown(): void`.

- [ ] **Step 1: Write failing processor sequence tests**

Create `test/unit/payments/payment-processor.spec.ts`. Build a real
`PaymentsService` over `InMemoryPaymentRepository`, use
`TimeoutProcessingScheduler`, and capture structured logs in typed arrays:

```ts
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import { PaymentsService } from '../../../src/payments/application/payments.service';
import {
  PaymentCurrency,
  PaymentStatus,
} from '../../../src/payments/domain/payment-status';
import { PaymentProcessor } from '../../../src/payments/processing/payment-processor';
import type { PaymentOutcomeResolver } from '../../../src/payments/processing/payment-outcome-resolver';
import { TimeoutProcessingScheduler } from '../../../src/payments/processing/timeout-processing.scheduler';
import { InMemoryPaymentRepository } from '../../../src/payments/repositories/in-memory-payment.repository';
import type { PaymentRepository } from '../../../src/payments/repositories/payment.repository';

interface TestLogMetadata {
  event?: unknown;
  outcome?: unknown;
  durationMs?: unknown;
  err?: unknown;
}

class ToggleFailureRepository implements PaymentRepository {
  private readonly delegate = new InMemoryPaymentRepository();
  failedSavesRemaining = 0;

  save(payment: Parameters<PaymentRepository['save']>[0]): Promise<void> {
    if (this.failedSavesRemaining > 0) {
      this.failedSavesRemaining -= 1;
      return Promise.reject(new Error('repository unavailable'));
    }
    return this.delegate.save(payment);
  }

  findById(id: string): ReturnType<PaymentRepository['findById']> {
    return this.delegate.findById(id);
  }
}

describe('PaymentProcessor', () => {
  const input = {
    smallestUnitAmount: 1050,
    currency: PaymentCurrency.USD,
    merchantReference: 'processor-order',
  };
  let infoLogs: TestLogMetadata[];
  let errorLogs: TestLogMetadata[];
  let logger: PinoLogger;

  beforeEach(() => {
    jest.useFakeTimers();
    infoLogs = [];
    errorLogs = [];
    logger = {
      info: (metadata: TestLogMetadata) => infoLogs.push(metadata),
      error: (metadata: TestLogMetadata) => errorLogs.push(metadata),
    } as unknown as PinoLogger;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function createHarness(options?: {
    delayMs?: number;
    outcome?: PaymentStatus.SUCCEEDED | PaymentStatus.FAILED;
    repository?: PaymentRepository;
    resolver?: PaymentOutcomeResolver;
  }) {
    const payments = new PaymentsService(
      options?.repository ?? new InMemoryPaymentRepository(),
      logger,
    );
    const resolver: PaymentOutcomeResolver = options?.resolver ?? {
      resolve: () => options?.outcome ?? PaymentStatus.SUCCEEDED,
    };
    const processor = new PaymentProcessor(
      payments,
      new TimeoutProcessingScheduler(),
      resolver,
      new ConfigService({ PROCESSING_DELAY_MS: options?.delayMs ?? 50 }),
      logger,
    );
    return { payments, processor };
  }

  it('moves pending through processing after the configured delay', async () => {
    const { payments, processor } = createHarness();
    const payment = await payments.create(input);
    processor.schedule(payment, 'processor-key');

    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.PENDING,
    });
    await jest.advanceTimersByTimeAsync(0);
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.PROCESSING,
    });
    await jest.advanceTimersByTimeAsync(49);
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.PROCESSING,
    });
    await jest.advanceTimersByTimeAsync(1);
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.SUCCEEDED,
    });
    expect(infoLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'payment.processing_scheduled',
        }),
        expect.objectContaining({
          event: 'payment.processing_completed',
          outcome: PaymentStatus.SUCCEEDED,
          durationMs: 50,
        }),
      ]),
    );
    expect(JSON.stringify(infoLogs)).not.toContain('processor-key');
  });

  it('keeps a zero-delay job asynchronous', async () => {
    const { payments, processor } = createHarness({ delayMs: 0 });
    const payment = await payments.create(input);
    processor.schedule(payment, 'zero-delay-key');
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.PENDING,
    });
    await jest.runAllTimersAsync();
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.SUCCEEDED,
    });
  });

  it('applies a failed outcome selected by the resolver', async () => {
    const { payments, processor } = createHarness({
      outcome: PaymentStatus.FAILED,
    });
    const payment = await payments.create(input);
    processor.schedule(payment, 'selected-failure-key');
    await jest.runAllTimersAsync();
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.FAILED,
    });
  });

  it('recovers a resolver failure to failed without an unhandled rejection', async () => {
    const resolver: PaymentOutcomeResolver = {
      resolve: () => {
        throw new Error('resolver unavailable');
      },
    };
    const { payments, processor } = createHarness({ resolver });
    const payment = await payments.create(input);
    processor.schedule(payment, 'resolver-failure-key');
    await jest.runAllTimersAsync();
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.FAILED,
    });
    expect(errorLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'payment.processing_failed' }),
      ]),
    );
  });

  it('recovers a transition persistence failure when storage becomes available', async () => {
    const repository = new ToggleFailureRepository();
    const { payments, processor } = createHarness({ repository });
    const payment = await payments.create(input);
    repository.failedSavesRemaining = 1;
    processor.schedule(payment, 'transition-failure-key');
    await jest.runAllTimersAsync();
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.FAILED,
    });
    expect(errorLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'payment.processing_failed' }),
      ]),
    );
  });

  it('continues from processing when another caller already made that transition', async () => {
    const { payments, processor } = createHarness();
    const payment = await payments.create(input);
    await payments.transition(payment.id, PaymentStatus.PROCESSING);
    processor.schedule(payment, 'already-processing-key');
    await jest.runAllTimersAsync();
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.SUCCEEDED,
    });
  });

  it('stops without another transition when the payment is already terminal', async () => {
    const { payments, processor } = createHarness();
    const payment = await payments.create(input);
    await payments.transition(payment.id, PaymentStatus.PROCESSING);
    await payments.transition(payment.id, PaymentStatus.SUCCEEDED);
    processor.schedule(payment, 'already-terminal-key');
    await jest.runAllTimersAsync();
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.SUCCEEDED,
    });
    expect(infoLogs).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'payment.processing_completed' }),
      ]),
    );
  });

  it('logs and consumes a recovery persistence failure', async () => {
    const repository = new ToggleFailureRepository();
    const { payments, processor } = createHarness({ repository });
    const payment = await payments.create(input);
    repository.failedSavesRemaining = Number.POSITIVE_INFINITY;
    processor.schedule(payment, 'recovery-failure-key');
    await jest.runAllTimersAsync();
    await Promise.resolve();
    expect(errorLogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ event: 'payment.processing_failed' }),
        expect.objectContaining({
          event: 'payment.processing_recovery_failed',
        }),
      ]),
    );
  });

  it('cancels outstanding work during shutdown', async () => {
    const { payments, processor } = createHarness();
    const payment = await payments.create(input);
    processor.schedule(payment, 'shutdown-key');
    processor.onApplicationShutdown();
    expect(processor.isReady()).toBe(false);
    await jest.runAllTimersAsync();
    await expect(payments.findById(payment.id)).resolves.toMatchObject({
      status: PaymentStatus.PENDING,
    });
  });
});
```

- [ ] **Step 2: Run the processor test and verify red**

```bash
/Users/abdulafeezpifapp/.bun/bin/bun run test -- payment-processor
```

Expected: FAIL because `PaymentProcessor` does not exist.

- [ ] **Step 3: Implement the processor**

Create `src/payments/processing/payment-processor.ts` with the following concrete structure:

```ts
import { createHash } from 'node:crypto';
import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
import type { Payment } from '../domain/payment';
import { PaymentStatus } from '../domain/payment-status';
import { PaymentsService } from '../application/payments.service';
import {
  PAYMENT_OUTCOME_RESOLVER,
  type PaymentOutcomeResolver,
} from './payment-outcome-resolver';
import {
  PROCESSING_SCHEDULER,
  type ProcessingScheduler,
  type ScheduledProcessingTask,
} from './processing-scheduler';

type ProcessingPhase = 'starting' | 'completing';

interface ProcessingContext {
  paymentId: string;
  idempotencyKey: string;
  keyHash: string;
  smallestUnitAmount: number;
  currency: Payment['currency'];
  startedAt: number;
  phase: ProcessingPhase;
}

@Injectable()
export class PaymentProcessor implements OnApplicationShutdown {
  private readonly delayMs: number;
  private readonly scheduledTasks = new Set<ScheduledProcessingTask>();
  private acceptingWork = true;

  constructor(
    private readonly payments: PaymentsService,
    @Inject(PROCESSING_SCHEDULER)
    private readonly scheduler: ProcessingScheduler,
    @Inject(PAYMENT_OUTCOME_RESOLVER)
    private readonly outcomeResolver: PaymentOutcomeResolver,
    config: ConfigService,
    private readonly logger: PinoLogger,
  ) {
    this.delayMs = config.getOrThrow<number>('PROCESSING_DELAY_MS');
  }

  schedule(payment: Payment, idempotencyKey: string): void {
    if (!this.acceptingWork) {
      throw new Error('Payment processor is not accepting work');
    }

    const context: ProcessingContext = {
      paymentId: payment.id,
      idempotencyKey,
      keyHash: createHash('sha256').update(idempotencyKey).digest('hex'),
      smallestUnitAmount: payment.smallestUnitAmount,
      currency: payment.currency,
      startedAt: Date.now(),
      phase: 'starting',
    };

    this.logger.info(
      {
        event: 'payment.processing_scheduled',
        paymentId: payment.id,
        delayMs: this.delayMs,
        keyHash: context.keyHash,
      },
      'Payment processing scheduled',
    );
    this.register(0, context, () => this.startProcessing(context));
  }

  isReady(): boolean {
    return this.acceptingWork;
  }

  onApplicationShutdown(): void {
    this.acceptingWork = false;
    for (const task of this.scheduledTasks) task.cancel();
    this.scheduledTasks.clear();
  }

  private register(
    delayMs: number,
    context: ProcessingContext,
    work: () => Promise<void>,
  ): void {
    if (!this.acceptingWork) return;

    let scheduled: ScheduledProcessingTask | undefined;
    scheduled = this.scheduler.schedule(delayMs, () => {
      if (scheduled !== undefined) this.scheduledTasks.delete(scheduled);
      void work().catch((error: unknown) => this.handleFailure(context, error));
    });
    this.scheduledTasks.add(scheduled);
  }

  private async startProcessing(context: ProcessingContext): Promise<void> {
    let current = await this.payments.findById(context.paymentId);
    if (
      current.status === PaymentStatus.SUCCEEDED ||
      current.status === PaymentStatus.FAILED
    ) {
      return;
    }
    if (current.status === PaymentStatus.PENDING) {
      current = await this.payments.transition(
        context.paymentId,
        PaymentStatus.PROCESSING,
      );
    }
    if (current.status !== PaymentStatus.PROCESSING) return;

    const terminalContext: ProcessingContext = {
      ...context,
      phase: 'completing',
      startedAt: Date.now(),
    };
    this.register(this.delayMs, terminalContext, () =>
      this.completeProcessing(terminalContext),
    );
  }

  private async completeProcessing(context: ProcessingContext): Promise<void> {
    const current = await this.payments.findById(context.paymentId);
    if (current.status !== PaymentStatus.PROCESSING) return;

    const outcome = this.outcomeResolver.resolve({
      idempotencyKey: context.idempotencyKey,
      smallestUnitAmount: context.smallestUnitAmount,
      currency: context.currency,
    });
    await this.payments.transition(context.paymentId, outcome);
    this.logger.info(
      {
        event: 'payment.processing_completed',
        paymentId: context.paymentId,
        outcome,
        durationMs: Date.now() - context.startedAt,
      },
      'Payment processing completed',
    );
  }

  private async handleFailure(
    context: ProcessingContext,
    error: unknown,
  ): Promise<void> {
    this.logger.error(
      {
        event: 'payment.processing_failed',
        paymentId: context.paymentId,
        phase: context.phase,
        durationMs: Date.now() - context.startedAt,
        err:
          error instanceof Error
            ? error
            : new Error('Unknown processing failure'),
      },
      'Payment processing failed',
    );

    try {
      let current = await this.payments.findById(context.paymentId);
      if (current.status === PaymentStatus.PENDING) {
        current = await this.payments.transition(
          context.paymentId,
          PaymentStatus.PROCESSING,
        );
      }
      if (current.status === PaymentStatus.PROCESSING) {
        await this.payments.transition(context.paymentId, PaymentStatus.FAILED);
      }
    } catch (recoveryError) {
      this.logger.error(
        {
          event: 'payment.processing_recovery_failed',
          paymentId: context.paymentId,
          err:
            recoveryError instanceof Error
              ? recoveryError
              : new Error('Unknown processing recovery failure'),
        },
        'Payment processing recovery failed',
      );
    }
  }
}
```

- [ ] **Step 4: Run processor and regression tests**

```bash
/Users/abdulafeezpifapp/.bun/bin/bun run test -- payment-processor payments
/Users/abdulafeezpifapp/.bun/bin/bun run format
/Users/abdulafeezpifapp/.bun/bin/bun run lint
/Users/abdulafeezpifapp/.bun/bin/bun run typecheck
```

Expected: processor tests, existing payment tests, lint, and type checking PASS.

- [ ] **Step 5: Commit the processor**

```bash
git add src/payments/processing/payment-processor.ts test/unit/payments/payment-processor.spec.ts
git commit -m "feat(processing): implement asynchronous payment processor"
```

---

### Task 4: Integrate processing with fresh payment creation

**Files:**

- Create: `test/processing.e2e-spec.ts`
- Modify: `src/payments/application/payment-creation-idempotency.service.ts`
- Modify: `src/payments/api/payments.controller.ts`
- Modify: `src/payments/payments.module.ts`
- Modify: `test/unit/payments/payment-creation-idempotency.service.spec.ts`
- Modify: `test/unit/payments/payments.module.spec.ts`
- Modify: `test/payments.e2e-spec.ts`

**Interfaces:**

- Consumes: `PaymentProcessor.schedule(payment, validatedIdempotencyKey)`, all processing tokens/adapters from Tasks 1–3, and `PaymentCreationIdempotencyService.execute`.
- Produces: a fresh-request callback `(validatedIdempotencyKey: string) => Promise<Payment>`, automatic processing from `POST /api/v1/payments`, and a focused `processing` E2E suite.

- [ ] **Step 1: Write the failing processing E2E tests**

Create `test/processing.e2e-spec.ts`:

```ts
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';
import { PaymentProcessor } from '../src/payments/processing/payment-processor';

interface PaymentResource {
  id: string;
  smallestUnitAmount: number;
  currency: 'USD';
  merchantReference: string;
  description?: string;
  status: 'pending' | 'processing' | 'succeeded' | 'failed';
  createdAt: string;
  updatedAt: string;
}

interface PaymentResponseBody {
  data: PaymentResource;
}

describe('Asynchronous payment processing (e2e)', () => {
  const validRequest = {
    smallestUnitAmount: 1050,
    currency: 'USD',
    merchantReference: 'processing-order-0001',
    description: 'Processing test payment',
  };
  const originalDelay = process.env.PROCESSING_DELAY_MS;
  const originalSuccessRate = process.env.SIMULATED_SUCCESS_RATE;
  let app: INestApplication<App> | undefined;

  function restoreEnvironment(
    name: 'PROCESSING_DELAY_MS' | 'SIMULATED_SUCCESS_RATE',
    value: string | undefined,
  ): void {
    if (value === undefined) {
      delete process.env[name];
      return;
    }
    process.env[name] = value;
  }

  async function createTestApp(options: {
    delayMs: number;
    successRate: number;
  }): Promise<INestApplication<App>> {
    process.env.PROCESSING_DELAY_MS = String(options.delayMs);
    process.env.SIMULATED_SUCCESS_RATE = String(options.successRate);
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const testApp: INestApplication<App> =
      moduleFixture.createNestApplication();
    configureApplication(testApp);
    await testApp.init();
    return testApp;
  }

  async function waitForTerminalStatus(
    testApp: INestApplication<App>,
    paymentId: string,
  ): Promise<PaymentResource> {
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) {
      const response = await request(testApp.getHttpServer())
        .get(`/api/v1/payments/${paymentId}`)
        .expect(200);
      const payment = (response.body as PaymentResponseBody).data;
      if (payment.status === 'succeeded' || payment.status === 'failed') {
        return payment;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    throw new Error(`Payment ${paymentId} did not reach a terminal state`);
  }

  afterEach(async () => {
    if (app !== undefined) {
      await app.close();
      app = undefined;
    }
    restoreEnvironment('PROCESSING_DELAY_MS', originalDelay);
    restoreEnvironment('SIMULATED_SUCCESS_RATE', originalSuccessRate);
  });

  it('returns pending before completing asynchronously as succeeded', async () => {
    const testApp = await createTestApp({ delayMs: 25, successRate: 1 });
    app = testApp;
    const created = await request(testApp.getHttpServer())
      .post('/api/v1/payments')
      .set('Idempotency-Key', 'processing-success-key')
      .send(validRequest)
      .expect(201);
    const pending = (created.body as PaymentResponseBody).data;

    expect(pending.status).toBe('pending');
    await expect(
      waitForTerminalStatus(testApp, pending.id),
    ).resolves.toMatchObject({
      id: pending.id,
      status: 'succeeded',
    });
  });

  it('completes deterministically as failed at a zero success rate', async () => {
    const testApp = await createTestApp({ delayMs: 10, successRate: 0 });
    app = testApp;
    const created = await request(testApp.getHttpServer())
      .post('/api/v1/payments')
      .set('Idempotency-Key', 'processing-failure-key')
      .send(validRequest)
      .expect(201);
    const pending = (created.body as PaymentResponseBody).data;

    expect(pending.status).toBe('pending');
    await expect(
      waitForTerminalStatus(testApp, pending.id),
    ).resolves.toMatchObject({
      id: pending.id,
      status: 'failed',
    });
  });

  it('replays the original pending response without restarting processing', async () => {
    const testApp = await createTestApp({ delayMs: 10, successRate: 1 });
    app = testApp;
    const scheduleSpy = jest.spyOn(testApp.get(PaymentProcessor), 'schedule');
    const key = 'processing-replay-key';
    const original = await request(testApp.getHttpServer())
      .post('/api/v1/payments')
      .set('Idempotency-Key', key)
      .send(validRequest)
      .expect(201);
    const originalPayment = (original.body as PaymentResponseBody).data;

    expect(originalPayment.status).toBe('pending');
    await expect(
      waitForTerminalStatus(testApp, originalPayment.id),
    ).resolves.toMatchObject({
      id: originalPayment.id,
      status: 'succeeded',
    });

    const replay = await request(testApp.getHttpServer())
      .post('/api/v1/payments')
      .set('Idempotency-Key', key)
      .send(validRequest)
      .expect(201);

    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(replay.body).toEqual(original.body);
    expect(scheduleSpy).toHaveBeenCalledTimes(1);

    const current = await request(testApp.getHttpServer())
      .get(`/api/v1/payments/${originalPayment.id}`)
      .expect(200);
    expect((current.body as PaymentResponseBody).data.status).toBe('succeeded');
  });
});
```

- [ ] **Step 2: Update existing tests for module wiring and isolation**

In `test/unit/payments/payment-creation-idempotency.service.spec.ts`, add:

```ts
it('passes the validated key to the fresh creation callback only', async () => {
  const createPayment = jest.fn(() => Promise.resolve(Payment.create(input)));

  await service.execute('checkout-key-007', input, createPayment);
  await service.execute('checkout-key-007', input, createPayment);

  expect(createPayment).toHaveBeenCalledTimes(1);
  expect(createPayment).toHaveBeenCalledWith('checkout-key-007');
});
```

In `test/unit/payments/payments.module.spec.ts`, add assertions that:

```ts
expect(moduleRef.get(PROCESSING_SCHEDULER)).toBeInstanceOf(
  TimeoutProcessingScheduler,
);
expect(moduleRef.get(PAYMENT_OUTCOME_RESOLVER)).toBeInstanceOf(
  DeterministicPaymentOutcomeResolver,
);
expect(moduleRef.get(PaymentProcessor)).toBeInstanceOf(PaymentProcessor);
```

In `test/payments.e2e-spec.ts`, import `PaymentProcessor` and change module
creation to:

```ts
const moduleFixture = await Test.createTestingModule({
  imports: [AppModule],
})
  .overrideProvider(PaymentProcessor)
  .useValue({
    schedule: () => undefined,
    isReady: () => true,
    onApplicationShutdown: () => undefined,
  })
  .compile();
```

This suite continues to verify explicit manual transitions; the new processing
suite verifies the real background provider.

- [ ] **Step 3: Run the integration tests and verify red**

```bash
/Users/abdulafeezpifapp/.bun/bin/bun run test -- payment-creation-idempotency payments.module
LOG_LEVEL=fatal /Users/abdulafeezpifapp/.bun/bin/bun run test:e2e -- processing payments
```

Expected: FAIL because the module and fresh-creation callback do not yet wire
the processor.

- [ ] **Step 4: Pass the validated idempotency key to fresh creation**

Modify `PaymentCreationIdempotencyService.execute` and its private method so the
callback type becomes:

```ts
createPayment: (validatedIdempotencyKey: string) => Promise<Payment>;
```

After validation and only when no stored or in-flight replay applies, call:

```ts
const payment = await createPayment(key);
```

Existing zero-argument callbacks remain assignable, so the current unit tests
continue to verify replay and conflict behavior.

- [ ] **Step 5: Schedule only inside the fresh controller callback**

Inject `PaymentProcessor` into `PaymentsController`. Replace the current fresh
callback with:

```ts
async (validatedIdempotencyKey) => {
  const payment = await this.paymentsService.create(input);
  this.paymentProcessor.schedule(payment, validatedIdempotencyKey);
  return payment;
};
```

Do not schedule after `idempotencyService.execute` returns because that would
also schedule sequential and concurrent replays.

- [ ] **Step 6: Register the processing providers**

Add direct imports for `PaymentProcessor`, the two processing tokens, and their
concrete adapters. Set the complete `PaymentsModule` provider/export arrays to:

```ts
providers: [
  PaymentsService,
  PaymentCreationIdempotencyService,
  PaymentProcessor,
  {
    provide: PROCESSING_SCHEDULER,
    useClass: TimeoutProcessingScheduler,
  },
  {
    provide: PAYMENT_OUTCOME_RESOLVER,
    useClass: DeterministicPaymentOutcomeResolver,
  },
  {
    provide: PAYMENT_REPOSITORY,
    useClass: InMemoryPaymentRepository,
  },
  {
    provide: PAYMENT_IDEMPOTENCY_REPOSITORY,
    useClass: InMemoryPaymentIdempotencyRepository,
  },
],
exports: [
  PAYMENT_REPOSITORY,
  PAYMENT_IDEMPOTENCY_REPOSITORY,
  PaymentsService,
  PaymentCreationIdempotencyService,
  PaymentProcessor,
  PROCESSING_SCHEDULER,
  PAYMENT_OUTCOME_RESOLVER,
],
```

- [ ] **Step 7: Run focused and full verification**

```bash
/Users/abdulafeezpifapp/.bun/bin/bun run test -- processor outcome payments
LOG_LEVEL=fatal /Users/abdulafeezpifapp/.bun/bin/bun run test:e2e -- processing payments
/Users/abdulafeezpifapp/.bun/bin/bun run format
/Users/abdulafeezpifapp/.bun/bin/bun run lint
/Users/abdulafeezpifapp/.bun/bin/bun run typecheck
/Users/abdulafeezpifapp/.bun/bin/bun run build
```

Expected: processor/outcome/payment unit tests, processing/payment E2E tests,
lint, type checking, and the build PASS.

- [ ] **Step 8: Commit the creation-flow integration**

```bash
git add src/payments/application/payment-creation-idempotency.service.ts src/payments/api/payments.controller.ts src/payments/payments.module.ts test/processing.e2e-spec.ts test/payments.e2e-spec.ts test/unit/payments/payment-creation-idempotency.service.spec.ts test/unit/payments/payments.module.spec.ts
git commit -m "feat(processing): schedule new payment processing"
```

---

### Task 5: Run final verification and record Checkpoint 7

**Files:**

- Modify: `CHECKPOINTS.md`

**Interfaces:**

- Consumes: all Checkpoint 7 implementation and tests.
- Produces: a clean, locally verified branch with Checkpoint 7 marked `Awaiting user verification`.

- [ ] **Step 1: Verify the exact dependency state**

```bash
/Users/abdulafeezpifapp/.bun/bin/bun install --frozen-lockfile
```

Expected: Bun reports no lockfile or dependency changes.

- [ ] **Step 2: Run every static and build gate**

```bash
/Users/abdulafeezpifapp/.bun/bin/bun run format:check
/Users/abdulafeezpifapp/.bun/bin/bun run lint
/Users/abdulafeezpifapp/.bun/bin/bun run typecheck
/Users/abdulafeezpifapp/.bun/bin/bun run build
git diff --check
```

Expected: every command exits successfully with no formatting or whitespace
errors.

- [ ] **Step 3: Run focused and complete Jest suites**

```bash
LOG_LEVEL=fatal /Users/abdulafeezpifapp/.bun/bin/bun run test -- processor outcome
LOG_LEVEL=fatal /Users/abdulafeezpifapp/.bun/bin/bun run test
LOG_LEVEL=fatal /Users/abdulafeezpifapp/.bun/bin/bun run test:e2e -- processing
LOG_LEVEL=fatal /Users/abdulafeezpifapp/.bun/bin/bun run test:e2e
```

Expected: all focused and complete suites pass with zero failures and no
unhandled-rejection or open-handle warnings.

- [ ] **Step 4: Record exact checkpoint evidence**

Modify `CHECKPOINTS.md`:

- change Checkpoint 6 from `Awaiting user verification` to `Completed`;
- change Checkpoint 7 from `Not started` to `Awaiting user verification`;
- record the exact commit hashes and test-suite/test counts from Steps 1–3;
- state that creation returns `pending`, work is timer-driven and cancellable,
  outcomes are deterministic, replay does not reschedule, and recovery errors
  are consumed and logged.

- [ ] **Step 5: Commit the checkpoint record**

```bash
git add CHECKPOINTS.md
git commit -m "docs(checkpoints): record checkpoint 7 verification"
```

- [ ] **Step 6: Confirm the local handoff state**

```bash
git status --short --branch
git log --oneline --decorate -8
git remote -v
```

Expected: clean `codex/feat/payment-microservice`, atomic Checkpoint 7 commits,
and no configured remote. Stop for user approval before Checkpoint 8.
