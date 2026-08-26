# Asynchronous Deterministic Payment Processing Design

## Scope

Checkpoint 7 automatically processes each newly created payment after the API
has returned its initial `pending` response. Processing moves the existing
immutable payment aggregate through `pending -> processing -> succeeded | failed`
using the application service and in-memory repository already implemented.

The delay and success threshold use the existing validated
`PROCESSING_DELAY_MS` and `SIMULATED_SUCCESS_RATE` environment settings. The
outcome is deterministic for the same idempotency key, smallest-unit amount,
currency, and configuration.

This checkpoint does not add an external queue, durable jobs, retry policies,
distributed workers, rate limiting, or health endpoints. Those would require
infrastructure beyond the assessment's in-memory microservice boundary.

## Chosen architecture

The processing flow extends the current creation path without putting timing or
simulation rules into the payment aggregate:

```text
POST /api/v1/payments
  -> PaymentCreationIdempotencyService
       -> fresh-request callback only
            -> PaymentsService.create
            -> PaymentProcessor.schedule
       -> persist original idempotency response
  -> 201 { data: pendingPayment }

PaymentProcessor background work
  -> ProcessingScheduler (next timer turn)
  -> PaymentsService.transition(paymentId, processing)
  -> ProcessingScheduler (PROCESSING_DELAY_MS)
  -> PaymentOutcomeResolver
  -> PaymentsService.transition(paymentId, succeeded | failed)
```

Idempotent replays do not invoke the fresh-request callback, so they cannot
schedule duplicate processing. The idempotency record continues to retain the
original immutable `pending` response even after the current payment snapshot
reaches a later state.

The controller remains responsible for composing HTTP creation with the
application operations. `PaymentsService` remains responsible only for payment
persistence and legal domain transitions, avoiding a circular dependency
between creation and processing.

## Components and interfaces

### PaymentProcessor

`PaymentProcessor` is an injectable application service with this public
boundary:

```ts
schedule(payment: Payment, idempotencyKey: string): void
isReady(): boolean
```

`schedule` registers background work and returns immediately. It never returns
the processing promise to the controller and always attaches an error handler,
so a background rejection cannot become an unhandled rejection.

The processor tracks every scheduled handle it owns. On Nest application
shutdown it stops accepting work, cancels outstanding handles, and clears the
set. `isReady()` exposes whether it still accepts work so Checkpoint 8 can use
the processor in readiness checks without changing its public contract.

### ProcessingScheduler

Scheduling is isolated behind an injection token and framework-independent
interface:

```ts
interface ScheduledProcessingTask {
  cancel(): void;
}

interface ProcessingScheduler {
  schedule(delayMs: number, task: () => void): ScheduledProcessingTask;
}
```

The production adapter uses `setTimeout` and `clearTimeout`. The processor first
schedules a zero-delay task, ensuring the HTTP call can finish while the payment
is still `pending`. That task transitions the payment to `processing` and
schedules the terminal transition after `PROCESSING_DELAY_MS`.

This callback-based, cancellable boundary is preferred over an awaited sleep:
it gives the application explicit ownership of timers and prevents Jest or
shutdown from being held open by orphaned work.

### PaymentOutcomeResolver

Outcome resolution is isolated behind a second injection token:

```ts
interface PaymentOutcomeInput {
  idempotencyKey: string;
  smallestUnitAmount: number;
  currency: PaymentCurrency;
}

interface PaymentOutcomeResolver {
  resolve(input: PaymentOutcomeInput):
    | PaymentStatus.SUCCEEDED
    | PaymentStatus.FAILED;
}
```

The deterministic adapter builds the exact UTF-8 seed:

```text
<idempotencyKey>:<smallestUnitAmount>:<currency>
```

It calculates SHA-256, reads the first unsigned 32-bit big-endian integer, and
divides it by `2^32` to obtain a stable score in `[0, 1)`. A score strictly less
than `SIMULATED_SUCCESS_RATE` succeeds; otherwise it fails. A configured rate of
`0` therefore always fails and a rate of `1` always succeeds.

The raw idempotency key is used only as deterministic input. It is never added
to application logs.

## Processing sequence

For a fresh valid creation request:

1. The existing payment service persists and returns an immutable `pending`
   payment.
2. The processor registers a zero-delay callback and returns synchronously.
3. The idempotency coordinator stores the original pending response.
4. The controller returns `201 Created` without awaiting either processing
   transition.
5. On the next timer turn, the processor transitions the current payment to
   `processing`.
6. The processor records the processing start time and registers the configured
   terminal-delay callback.
7. The outcome resolver selects `succeeded` or `failed` deterministically.
8. The payment service applies and persists the terminal transition.
9. The processor logs the terminal outcome and measured processing duration.

`PROCESSING_DELAY_MS=0` remains asynchronous: both transitions occur from timer
callbacks rather than in the request call stack.

## State-race behavior

The explicit status-transition endpoint remains available from Checkpoint 5.
Before each automatic phase, the processor reads the latest payment snapshot:

- a `pending` payment can enter automatic processing;
- a payment already in `processing` can continue to automatic resolution;
- a terminal payment causes the job to stop without another transition.

This makes background processing tolerant of legitimate manual transitions and
prevents repeated or terminal transitions from surfacing as unhandled failures.
It does not weaken the aggregate: every state change still passes through the
existing transition rules.

The payment API E2E suite will replace `PaymentProcessor` with a no-op scheduler
because that suite verifies explicit REST transition behavior. A dedicated
processing E2E suite will use the real processor and verify the integrated
automatic flow. Application shutdown cancels timers in both production and
tests.

## Configuration

The existing Zod schema remains the startup gate:

- `PROCESSING_DELAY_MS`: integer greater than or equal to zero, default `1000`;
- `SIMULATED_SUCCESS_RATE`: number from `0` through `1`, default `0.8`.

`PaymentProcessor` reads the delay through `ConfigService.getOrThrow`.
`DeterministicPaymentOutcomeResolver` reads the success rate through the same
typed configuration boundary. Unit tests cover valid boundary values and
rejection of values below or above the accepted ranges.

## Error handling and recovery

All background work is invoked through a wrapper that catches rejected
promises. A processing error produces a structured `payment.processing_failed`
error log with the payment ID, elapsed duration, current phase, and error stack.

The processor then reads the latest payment state and attempts a safe recovery:

- `pending` is first transitioned to `processing`, then to `failed`;
- `processing` is transitioned to `failed`;
- `succeeded` or `failed` is already safe and needs no transition.

Recovery itself is guarded. If reading or persisting the recovery state fails,
the processor logs `payment.processing_recovery_failed` and consumes that
failure. No background branch is permitted to reject without an attached
handler.

The processor logs the raw `Error` object through Pino's `err` field but never
logs request bodies, descriptions, or raw idempotency keys.

## Structured logging

The processor adds these stable events:

- `payment.processing_scheduled`: payment ID, configured delay, and SHA-256 key
  hash;
- `payment.processing_completed`: payment ID, terminal outcome, and duration in
  milliseconds;
- `payment.processing_failed`: payment ID, phase, duration, and error;
- `payment.processing_recovery_failed`: payment ID and recovery error.

The existing `payment.status_transitioned` events continue to record each
successful `pending -> processing` and `processing -> terminal` transition.

## Testing strategy

Implementation follows red-green-refactor cycles.

Unit tests for the deterministic resolver use hand-checked seeds to prove stable
success and failure results, repeatability, and the `0`/`1` rate boundaries.

Processor unit tests use Jest fake timers with the real timeout scheduler and
real payment service/repository behavior. They prove:

- scheduling returns while the stored payment is still `pending`;
- the next timer turn moves the payment to `processing`;
- advancing by `PROCESSING_DELAY_MS` produces the selected terminal status;
- configured delays, including zero, remain asynchronous;
- identical deterministic inputs produce identical outcomes;
- resolver and transition failures are caught and recovered to `failed` where
  persistence remains available;
- recovery failures are logged and do not produce unhandled rejections;
- completion logs contain transitions and duration;
- shutdown cancels outstanding timers and makes the processor not ready.

End-to-end processing tests create payments through the real HTTP and
idempotency path, assert the immediate `pending` response, poll the retrieval
endpoint with a bounded timeout, and assert the deterministic terminal state.
They also prove replaying a key does not start another processing sequence.

Checkpoint verification runs the focused processor unit tests, focused
processing E2E tests, formatting, linting, type checking, the production build,
and the complete unit and E2E suites.

## Atomic delivery

The checkpoint uses focused Conventional Commits for the design, implementation
plan, tested scheduler/outcome components, tested processor integration, and
checkpoint evidence. The branch remains local and unmerged; no remote is added
or pushed before Checkpoint 11.
