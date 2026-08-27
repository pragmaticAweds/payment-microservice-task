# Node Payment Microservice

A production-minded payment-processing simulation built with NestJS, its Express
adapter, TypeScript, and Bun. It accepts USD payments, protects creation with an
idempotency key, processes payments asynchronously after returning the HTTP
response, and produces deterministic outcomes that are straightforward to test.

The service intentionally keeps data in memory. Its repository, scheduler, and
outcome resolver are behind injectable boundaries so durable infrastructure can
replace them without changing the HTTP or domain layers.

## Highlights

- Required, concurrency-safe `Idempotency-Key` handling for payment creation
- Configurable asynchronous processing delay and deterministic success/failure
- Explicit `pending -> processing -> succeeded | failed` state machine
- Atomic state transitions in the single-process repository adapter
- Global and payment-creation rate limits with standard response headers
- Separate versioned liveness and readiness probes
- Structured Pino logging, correlation IDs, and sensitive-field redaction
- Zod-validated environment configuration and consistent error envelopes
- Swagger UI plus a machine-readable OpenAPI JSON endpoint
- Jest unit and Supertest end-to-end suites with enforced coverage thresholds

## Architecture

```text
HTTP request
  -> Helmet / request correlation / Pino logging / rate limiting
  -> Nest controller and DTO validation
  -> idempotency coordinator
  -> payment service and domain state machine
  -> repository interface -> in-memory adapter
  -> asynchronous processor
       -> scheduler interface
       -> deterministic outcome resolver
       -> atomic repository transition
```

The main boundaries are:

- `common`: cross-cutting errors, filters, logging, and request metadata.
- `config`: Zod environment validation and typed runtime configuration.
- `payments/api`: versioned controllers and DTOs.
- `payments/application`: payment use cases and idempotency coordination.
- `payments/domain`: framework-independent payment rules and state transitions.
- `payments/processing`: asynchronous scheduling and deterministic outcomes.
- `payments/repositories`: interfaces and in-memory adapters.
- `health`: versioned process and dependency probes.
- `openapi`: Swagger configuration.

## Payment lifecycle

```text
pending -> processing -> succeeded
                      -> failed
```

`POST /api/v1/payments` returns the new `pending` payment immediately. A
zero-delay callback starts processing on a later event-loop turn, then a second
timer waits for `PROCESSING_DELAY_MS` before applying the deterministic terminal
outcome. Terminal payments cannot transition again.

The manual status endpoint follows the same transition rules as background
processing. The in-memory repository validates and persists a transition in one
synchronous operation, so concurrent terminal updates cannot overwrite one
another in this single-process implementation.

## Project structure

```text
/node-payment-microservice
├── src
│   ├── common
│   ├── config
│   ├── health
│   ├── openapi
│   └── payments
├── test
├── CHECKPOINTS.md
├── jest.config.cjs
├── package.json
└── bun.lock
```

### Source organization

Production definitions are grouped by the concern they describe. Behavior,
static values, and TypeScript-only shapes use matching filenames inside the
same concern-owned parent:

```text
common/api-response/
├── api-response.ts
├── api-response.constants.ts
└── api-response.types.ts

payments/domain/payment/
├── payment.ts
├── payment.constants.ts
├── payment.types.ts
└── payment.errors.ts
```

The project follows these source rules:

- Runtime behavior stays in the concern's primary file.
- Interfaces and type aliases live in `*.types.ts` companions.
- Static values, DI tokens, patterns, and fixed value sets live in
  `*.constants.ts` companions.
- Fixed value sets use `as const` objects and inferred union types; TypeScript
  enums are not used.
- NestJS DTO classes remain under `payments/api/dto/` because decorators need
  them at runtime.
- Imports point directly to the defining file; barrel files are not used.
- Generic `types/`, `interfaces/`, and `constants/` folders are avoided while a
  definition category remains at or below 250 lines.

`test/unit/architecture/source-structure.spec.ts` enforces these conventions so
new production code cannot silently regress to mixed definition boundaries.

## Requirements and setup

- Bun 1.3.8
- A POSIX-compatible shell for the examples below

```bash
cd /node-payment-microservice
cp .env.example .env
bun install --frozen-lockfile
bun run start:dev
```

The API listens on `http://localhost:4040` by default. Build and run the compiled
application with:

```bash
bun run build
bun run start:prod
```

After the listener binds, the structured startup log emits the
`service.started` event with the effective port and API URL. With the default
configuration, the URL is `http://localhost:4040/api/v1`.

## Configuration

Configuration is validated synchronously at startup. Invalid values stop the
service with a clear error instead of allowing a partially configured process.

| Variable                        | Default                     | Rules and purpose                                      |
| ------------------------------- | --------------------------- | ------------------------------------------------------ |
| `NODE_ENV`                      | `development`               | `development`, `test`, or `production`                 |
| `SERVICE_NAME`                  | `node-payment-microservice` | Service name attached to structured logs               |
| `PORT`                          | `4040`                      | Integer from 1 through 65535                           |
| `LOG_LEVEL`                     | `info`                      | `fatal`, `error`, `warn`, `info`, `debug`, or `trace`  |
| `PROCESSING_DELAY_MS`           | `1000`                      | Non-negative integer processing delay                  |
| `SIMULATED_SUCCESS_RATE`        | `0.8`                       | Number from 0 through 1                                |
| `THROTTLE_TTL_MS`               | `60000`                     | Positive global rate-limit window in milliseconds      |
| `THROTTLE_LIMIT`                | `100`                       | Positive global request limit                          |
| `PAYMENT_CREATE_THROTTLE_LIMIT` | `10`                        | Positive create limit, lower than `THROTTLE_LIMIT`     |
| `IDEMPOTENCY_TTL_MS`            | `86400000`                  | Validated positive duration reserved for record expiry |

`IDEMPOTENCY_TTL_MS` defines the intended retention window, but the current
in-memory adapter does not evict records. A production persistence adapter should
enforce expiry and shared uniqueness across service instances.

## API

All API responses use JSON. Every public route uses the global `/api` prefix and
URI version `v1`, including health and documentation endpoints.

| Method  | Route                         | Purpose                            |
| ------- | ----------------------------- | ---------------------------------- |
| `GET`   | `/api/v1`                     | Service welcome response           |
| `POST`  | `/api/v1/payments`            | Create and schedule a payment      |
| `GET`   | `/api/v1/payments/:id`        | Retrieve a payment                 |
| `PATCH` | `/api/v1/payments/:id/status` | Apply a valid status transition    |
| `GET`   | `/api/v1/health/live`         | Process liveness                   |
| `GET`   | `/api/v1/health/ready`        | Repository and processor readiness |
| `GET`   | `/api/v1/docs`                | Swagger UI                         |
| `GET`   | `/api/v1/docs-json`           | OpenAPI JSON                       |

### Response envelopes

Successful responses place the operation result in `data`. The outer `status`
describes the HTTP operation, while a nested `data.status` describes the payment
or health state:

```json
{
  "status": "success",
  "data": {
    "status": "pending"
  }
}
```

Failures use `status: "error"` and retain the HTTP status, stable error code,
request ID, timestamp, path, and optional details:

```json
{
  "status": "error",
  "statusCode": 409,
  "code": "IDEMPOTENCY_CONFLICT"
}
```

### Create a payment

`smallestUnitAmount` is the amount in the currency's smallest unit. For USD it
means cents, so `1050` represents `$10.50`.

```bash
curl --include --request POST http://localhost:4040/api/v1/payments \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: order-2026-0001-attempt-1' \
  --header 'X-Request-Id: docs-create-payment' \
  --data '{
    "smallestUnitAmount": 1050,
    "currency": "USD",
    "merchantReference": "order-2026-0001",
    "description": "Invoice 0001"
  }'
```

The request fields are:

| Field                | Requirements                                       |
| -------------------- | -------------------------------------------------- |
| `smallestUnitAmount` | Positive JavaScript-safe integer; US cents         |
| `currency`           | Exactly `USD`                                      |
| `merchantReference`  | Trimmed string containing 1 through 100 characters |
| `description`        | Optional trimmed string, at most 500 characters    |

A successful fresh request returns `201 Created`:

```json
{
  "status": "success",
  "data": {
    "id": "4fa85f64-5717-4562-b3fc-2c963f66afa6",
    "smallestUnitAmount": 1050,
    "currency": "USD",
    "merchantReference": "order-2026-0001",
    "description": "Invoice 0001",
    "status": "pending",
    "createdAt": "2026-08-27T08:00:00.000Z",
    "updatedAt": "2026-08-27T08:00:00.000Z"
  }
}
```

Blank descriptions are normalized away. Unknown body properties are rejected.

### Retrieve a payment

```bash
curl --include \
  http://localhost:4040/api/v1/payments/4fa85f64-5717-4562-b3fc-2c963f66afa6
```

An invalid UUID returns `400`; an unknown valid UUID returns `404`.

### Transition a payment

```bash
curl --include --request PATCH \
  http://localhost:4040/api/v1/payments/4fa85f64-5717-4562-b3fc-2c963f66afa6/status \
  --header 'Content-Type: application/json' \
  --data '{"status":"processing"}'
```

The accepted target values are `processing`, `succeeded`, and `failed`, but the
domain state machine decides whether the requested transition is legal from the
current state. An invalid or competing transition returns
`409 INVALID_PAYMENT_TRANSITION`.

## Idempotency

Every payment-creation request requires an `Idempotency-Key` header. Its value
must contain 1 through 128 characters from `A-Z`, `a-z`, `0-9`, `.`, `_`, `:`,
or `-`.

- The first key and payload combination creates one payment.
- The same key and canonical payload returns the original creation response and
  adds `Idempotency-Replayed: true`; it does not schedule another job.
- The same key with a different canonical payload returns
  `409 IDEMPOTENCY_CONFLICT`.
- Concurrent matching requests share one in-flight creation promise.
- Merchant references and descriptions are trimmed before fingerprinting; a
  blank description is equivalent to an omitted description.

The raw key is never written to application logs. Events contain only its SHA-256
hash.

## Deterministic processing

The simulated outcome is stable for the same creation inputs and configuration:

1. Build the seed
   `<idempotencyKey>:<smallestUnitAmount>:<currency>`.
2. Hash it with SHA-256.
3. Read the first unsigned 32-bit value and map it into `[0, 1)`.
4. Compare the score with `SIMULATED_SUCCESS_RATE`.

A score below the configured rate succeeds; otherwise it fails. This provides
real asynchronous control flow without flaky random tests.

## Rate limiting

`@nestjs/throttler` applies a named global policy and a stricter named policy to
`POST /api/v1/payments`. Successful responses expose limit, remaining, and reset
headers. The creation route also exposes its named-policy headers.

When a policy is exhausted, the service returns `429 Too Many Requests`, the
standard error envelope, and a `Retry-After` header. Both health endpoints are
exempt so platform probes remain available under API load.

The bundled throttler storage is process-local. A horizontally scaled production
deployment should use shared, atomic storage.

## Health endpoints

Liveness confirms that the process is serving requests:

```bash
curl http://localhost:4040/api/v1/health/live
```

```json
{ "status": "success", "data": { "status": "live" } }
```

Readiness checks both the repository and asynchronous processor:

```bash
curl http://localhost:4040/api/v1/health/ready
```

```json
{
  "status": "success",
  "data": {
    "status": "ready",
    "checks": {
      "repository": "ready",
      "processor": "ready"
    }
  }
}
```

Readiness returns `503 SERVICE_NOT_READY` with safe per-component statuses when
the service cannot accept payment work, including during shutdown.

## Swagger and OpenAPI

With the service running:

- Swagger UI: `http://localhost:4040/api/v1/docs`
- OpenAPI JSON: `http://localhost:4040/api/v1/docs-json`

The specification documents DTO constraints, examples, the required idempotency
header, the optional correlation header, response headers, rate limits, and error
responses.

## Errors and request correlation

Expected and unexpected failures use one envelope:

```json
{
  "status": "error",
  "statusCode": 409,
  "code": "IDEMPOTENCY_CONFLICT",
  "message": "Idempotency-Key has already been used with a different request",
  "requestId": "docs-create-payment",
  "timestamp": "2026-08-27T08:00:01.000Z",
  "path": "/api/v1/payments"
}
```

Validation and selected domain failures may also include a `details` property.
Unexpected failures are logged with internal context but return a safe generic
message.

Clients may send `X-Request-Id` using the same safe-character rule as the
idempotency header. Invalid or missing values are replaced with a UUID. The
effective ID is echoed in the response and attached to structured logs and error
responses.

## Logging

Pino emits readable pretty logs in development and JSON in production. Request
completion levels are `info` for 2xx/3xx, `warn` for 4xx, and `error` for 5xx or
request failures.

Authorization, cookies, idempotency keys, and sensitive body fields are redacted.
Domain events include stable event names such as `payment.created` and
`payment.status_transitioned`, identifiers, timing, and safe status context.

The post-bind startup event is `service.started`; it includes the effective
`port` and versioned `apiUrl` so the terminal shows the exact address to test.

## Controller request files

Runnable HTTP requests are stored beside their controllers:

- [`src/app.controller.rest`](./src/app.controller.rest)
- [`src/health/health.controller.rest`](./src/health/health.controller.rest)
- [`src/payments/api/payments.controller.rest`](./src/payments/api/payments.controller.rest)

Use an editor REST client to run individual requests. In the payments file, run
`createPayment` before requests that read
`createPayment.response.body.$.data.id`. The replay and conflict examples share
the same idempotency key intentionally.

## Quality checks

Run all committed verification commands with Bun:

```bash
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run test:e2e
bun run test:e2e -- --runInBand --detectOpenHandles
bun run test:cov
bun run build
```

The unit suite emits text, LCOV, and HTML coverage reports. Global thresholds are:

| Metric     | Minimum |
| ---------- | ------- |
| Statements | 85%     |
| Branches   | 80%     |
| Functions  | 85%     |
| Lines      | 85%     |

End-to-end tests are a separate mandatory gate. They exercise the application
through HTTP while controlled scheduler implementations avoid real waits and
random outcomes.

## Assumptions and production trade-offs

- Only USD is supported; amounts are stored as integer cents to avoid
  floating-point money errors.
- Payments and idempotency records are memory-resident and disappear on restart.
- Idempotency ownership and rate limits are local to one process.
- Scheduled timers are local to the application process; durable queues, retry
  policies, dead-letter handling, and recovery after restart are outside scope.
- Manual status transitions are exposed to demonstrate and test state-machine
  conflicts. A real payment provider would normally restrict this operation.
- Authentication, authorization, external payment-provider calls, databases,
  telemetry exporters, and deployment infrastructure are outside this
  assessment's scope.

See [`CHECKPOINTS.md`](./CHECKPOINTS.md) for the sequential implementation and
verification record.
