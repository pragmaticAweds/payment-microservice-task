# Test Suite and Coverage Enforcement Design

**Date:** 2026-08-27

**Checkpoint:** 9 — Test suite and coverage enforcement

## Goal

Complete the remaining high-value behavioral tests and make coverage a
repeatable Bun/Jest quality gate without allowing coverage percentages to
replace the separate end-to-end contract suite.

## Confirmed decisions

- Coverage thresholds apply to the unit-test Jest configuration only.
- Supertest end-to-end tests remain a separate mandatory command and are not
  merged into the unit coverage metric.
- Jest must generate text, LCOV, and HTML coverage reports.
- Global minimums are 85% statements, 85% lines, 85% functions, and 80%
  branches.
- Coverage excludes framework composition and schema metadata, not executable
  business or error-handling logic.
- No new runtime or development dependency is required.
- Tests must not depend on random payment outcomes or real processing delays.

## Current state

The pre-design diagnostic run of `bun run test:cov` passes 16 suites and 106
tests but does not yet enforce thresholds. Its baseline is:

| Metric     | Baseline | Required |
| ---------- | -------: | -------: |
| Statements |   85.79% |      85% |
| Branches   |   65.11% |      80% |
| Functions  |   81.44% |      85% |
| Lines      |   85.32% |      85% |

Domain entities, repositories, idempotency, rate limiting, configuration, and
most asynchronous processor behavior already have strong unit coverage. The
largest meaningful gaps are the request logger and global exception filter.
The current unit collector also counts Nest/Swagger composition files and DTO
decorator metadata even though their contracts are exercised through E2E and
OpenAPI assertions.

The E2E suite already covers every public endpoint, payment validation and
state transitions, idempotency concurrency and conflicts, deterministic async
processing, rate limiting, health success and shutdown readiness, Swagger,
request IDs, security headers, and safe unexpected-error responses. Two gaps
remain: the processing E2E suite currently polls across real 10–25 ms timers,
and a readiness dependency exception has not flowed through the real health
service and global exception filter.

## Coverage boundary

`jest.config.cjs` continues to collect `src/**/*.{ts,js}` and excludes only:

- `src/main.ts`, because it is the process bootstrap;
- `src/**/*.module.ts`, because these files contain Nest dependency metadata;
- `src/app.setup.ts`, because it composes global framework behavior already
  verified by E2E route, validation, Helmet, Swagger, and shutdown tests;
- `src/openapi/swagger.ts`, because it is Swagger bootstrap composition already
  verified through `/docs` and `/docs-json` E2E tests; and
- `src/**/*.dto.ts`, because these classes are validation/OpenAPI decorator
  schemas whose observable behavior is verified through HTTP and OpenAPI E2E
  assertions.

Controllers, services, repositories, processing code, logger configuration,
the global exception filter, application-error mapping, throttling, and health
logic remain inside the coverage boundary. If the required percentages are
not reached, the remedy is additional behavior-focused tests, not broader
exclusions.

The generated `coverage/` directory remains ignored by Git. Jest explicitly
uses the `text`, `lcov`, and `html` reporters and applies these global gates:

| Metric     | Minimum |
| ---------- | ------: |
| Statements |     85% |
| Lines      |     85% |
| Functions  |     85% |
| Branches   |     80% |

`bun run test:cov` is the enforced coverage command. A sensitivity check must
temporarily raise one configured threshold above the measured result, prove
that the command exits non-zero, restore the required value, and prove the
command passes. The temporary mutation is never committed.

## Unit-test additions

### Request logger behavior

Extend the logger configuration suite through the public callbacks returned by
`createLoggerOptions`:

- preserve a valid caller-provided `x-request-id` and echo it on the response;
- reject invalid or multi-value request-ID headers and generate a UUID instead;
- classify normal responses as `info`, 4xx responses as `warn`, and 5xx or
  errored responses as `error`;
- keep test auto-logging disabled;
- add `pino-pretty` transport only in development; and
- retain level formatting and the existing sensitive-field redaction list.

Tests use real `IncomingMessage`/`ServerResponse`-compatible objects where
practical and minimal typed fakes for callback-only state. They assert returned
behavior rather than duplicating implementation logic.

### Global exception filter behavior

Add a focused `GlobalExceptionFilter` suite using a typed HTTP arguments-host,
request, response, and Pino logger fixture. It verifies:

- string `HttpException` bodies use a stable status-derived code;
- validation arrays map to `VALIDATION_ERROR`, the safe summary message, and
  the original validation details;
- structured HTTP bodies normalize explicit or fallback codes and preserve
  safe details;
- mapped application errors produce their documented status/code/message and
  structured warning log;
- unexpected `Error` instances produce a safe `500 INTERNAL_SERVER_ERROR`
  response while the original error is logged;
- non-`Error` thrown values are converted into an `Error` for logging;
- request IDs prefer the Pino request ID, support numeric IDs, fall back to the
  request header, and finally use `unavailable`; and
- all envelopes contain an ISO timestamp and the original request path.

The tests must never require internal exception text to appear in a client
response.

### Thin controller behavior

Add focused controller tests that prove `AppController` delegates to
`AppService` and `HealthController.readiness()` returns the health service's
asynchronous result. The existing process-only liveness and named throttle
metadata tests remain authoritative for those contracts.

Because these are characterization tests for existing behavior, sensitivity
is demonstrated with temporary local mutations that make the new assertions
fail, followed by restoration and a green focused run. No mutation is
committed.

## End-to-end addition

### Controlled asynchronous processing

Replace real timeout polling in `test/processing.e2e-spec.ts` with a
test-owned `ProcessingScheduler` supplied through the existing
`PROCESSING_SCHEDULER` injection token. The scheduler records the requested
delay and queued callback, returns a cancellable handle, and exposes a test
method that releases the next queued callback explicitly. Tests then:

- issue the real HTTP creation request and assert the immediate response is
  `pending` before releasing any work;
- release the zero-delay starting callback and await an event-loop turn;
- assert a terminal callback was queued with the configured delay;
- release that callback and await an event-loop turn; and
- retrieve the payment over HTTP and assert the deterministic terminal state.

The replay test performs the same controlled drain and proves the idempotent
replay does not enqueue another callback. The scheduler test double remains in
the E2E file because it is test infrastructure, not a production abstraction.
Cancellation marks a queued entry inert so application shutdown cannot execute
it later.

### Readiness dependency failure

Extend the health E2E suite by making the real injected payment repository's
`isReady()` reject once with a secret-bearing internal error. The request to
`GET /health/ready` must return the standard `503 SERVICE_NOT_READY` envelope
with:

- `repository: "not_ready"`;
- `processor: "ready"`;
- the effective request ID, ISO timestamp, and `/health/ready` path; and
- no internal exception text.

The spy is restored after the test so application shutdown and later tests use
the real repository. This test exercises the real HealthService, global
exception filter, request logging context, and HTTP serialization.

## Determinism and asynchronous testing

- Payment outcome tests continue to use fixed inputs and explicit success-rate
  configuration.
- Processor unit tests continue to use Jest fake timers or injected schedulers.
- E2E processing tests release an injected deterministic scheduler manually;
  no processing E2E test polls or waits for a real timer.
- Promise-returning and Supertest operations are awaited.
- Full E2E verification runs with `--detectOpenHandles` to expose leaked
  servers, timers, or background work.

## Verification gates

Checkpoint 9 is ready for user verification only when all of these pass from a
clean worktree:

1. `bun install --frozen-lockfile`
2. `bun run format:check`
3. `bun run lint`
4. `bun run typecheck`
5. `bun run test`
6. `bun run test:e2e`
7. `bun run test:e2e -- --runInBand --detectOpenHandles`
8. `bun run test:cov`
9. `bun run build`
10. `git diff --check`

The coverage output must show all four global thresholds satisfied and create
text output, `coverage/lcov.info`, and an HTML report without tracking any
generated file.

## Atomic change boundaries

The intended implementation history is:

1. `test(errors): cover logging and exception behavior`
2. `test(e2e): cover deterministic service flows`
3. `test(coverage): enforce coverage thresholds`
4. `docs(checkpoints): record checkpoint 9 verification`

The exact number of commits may increase only when review feedback identifies
an independently reviewable correction. Production behavior is not changed
merely to improve a metric; any defect found by the new tests requires its own
failing regression and atomic fix.

## Out of scope

- Combining unit and E2E coverage data
- Raising the agreed coverage thresholds
- Adding mutation-testing dependencies or services
- Docker, CI workflow, README, or deployment work from Checkpoint 10
- GitHub remote configuration or publication from Checkpoint 11
