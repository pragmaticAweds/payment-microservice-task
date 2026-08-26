# Rate Limiting and Health Checks Design

## Scope

Checkpoint 8 adds two operational controls to the payment microservice:

- configuration-driven request throttling with a stricter payment-creation
  policy; and
- independent liveness and readiness probes that remain reachable even when
  the business API is rate limited.

The public business API remains versioned below `/api/v1`. Operational probes
are intentionally unversioned at `/health/live` and `/health/ready` so a
deployment platform does not depend on a business API version.

This checkpoint uses the in-memory throttler storage supplied by
`@nestjs/throttler`, matching the service's current single-process, in-memory
assessment boundary. A distributed store, authenticated client quotas, proxy
trust configuration, and load-balancer integration are production extensions,
not part of this checkpoint.

## Approaches considered

### Static route override

A global throttler plus `@Throttle()` on payment creation is the smallest code
change. However, decorator arguments are created before Nest dependency
injection is available. Reading `process.env` inside the decorator would bypass
the validated `ConfigService` boundary and duplicate configuration parsing.

### Custom rate limiter

A bespoke guard could inject configuration and implement exactly the required
policies. It would also duplicate tracking, expiry, response headers, and
concurrency behavior already provided by `@nestjs/throttler`, weakening the
explicit assessment requirement to use that library.

### Named throttlers with opt-in route metadata

The chosen design configures two named throttlers through
`ThrottlerModule.forRootAsync`: a general policy and a payment-creation policy.
A small metadata decorator marks the create route, and the stricter named
policy uses `skipIf` for every unmarked handler. This preserves dependency
injection, keeps all numeric values behind validated configuration, and leaves
storage and rate-limit header behavior with the maintained Nest integration.

## Rate-limit architecture

An operational rate-limit module owns the cross-cutting setup:

```text
validated ConfigService
  -> ThrottlerModule.forRootAsync
       -> default policy
       -> payment-create policy
  -> ApiThrottlerGuard registered as APP_GUARD
```

The policies share one time window:

- `default`: `THROTTLE_LIMIT` requests per `THROTTLE_TTL_MS` for each client IP
  and route;
- `payment-create`: `PAYMENT_CREATE_THROTTLE_LIMIT` requests per
  `THROTTLE_TTL_MS`, applied only to `POST /api/v1/payments`.

Payment creation is evaluated by both policies, so it can never bypass the
general API protection. The Zod environment schema enforces
`PAYMENT_CREATE_THROTTLE_LIMIT < THROTTLE_LIMIT`, making the documented
"stricter" relationship a startup invariant rather than an assumption.

The create handler is marked with a purpose-specific decorator instead of
embedding numeric values in controller metadata. The named policy's `skipIf`
function reads only this boolean marker from the execution context. Other
routes use only the default policy.

The built-in in-memory store and default IP tracker are appropriate for this
single-instance assessment. The application will not enable Express
`trust proxy` implicitly because trusting arbitrary forwarded headers would
allow clients to spoof their identity. A real proxy deployment must configure
trusted hops deliberately, and a horizontally scaled deployment must replace
the in-memory store with shared storage.

## Throttle errors and logging

`ApiThrottlerGuard` extends the library guard only at the exception boundary.
When a limit is exceeded it throws an HTTP `429` with the stable body fields:

```json
{
  "code": "TOO_MANY_REQUESTS",
  "message": "Rate limit exceeded"
}
```

The existing global exception filter adds `statusCode`, `requestId`,
`timestamp`, and `path`, producing the same error envelope used by the rest of
the API. Library-generated rate-limit and retry headers remain intact. The Pino
HTTP logger records the rejected request, response status, latency, method,
path, and request ID without exposing request bodies or idempotency keys.

## Health endpoint routing

`configureApplication` excludes the exact `GET health/live` and
`GET health/ready` routes from the global `api` prefix. The health controller
uses Nest's version-neutral routing, yielding these public paths:

```text
GET /health/live
GET /health/ready
```

All other routes retain the existing `/api/v1` contract. The health controller
is explicitly skipped for both named throttlers, so probes remain callable
after either API policy is exhausted. They still pass through request-ID
handling, structured logging, Helmet, and the global exception filter.

## Liveness contract

Liveness answers only whether the Nest process can serve an HTTP request. It
does not query repositories, the processor, or external resources. A served
request returns `200 OK`:

```json
{
  "data": {
    "status": "live"
  }
}
```

Keeping liveness dependency-free prevents a transient readiness failure from
causing an orchestrator to restart an otherwise functioning process.

## Readiness architecture and contract

Readiness answers whether the service can accept new payment work. It composes
two explicit signals:

- `PaymentRepository.isReady(): Promise<boolean>` reports whether persistence
  can accept work;
- `PaymentProcessor.isReady(): boolean` reports whether background processing
  accepts schedules.

The in-memory repository implements Nest's shutdown lifecycle and changes its
readiness signal to `false` when shutdown begins. The processor already stops
accepting work and returns `false` during shutdown. The health service evaluates
both checks and catches repository-check failures so infrastructure errors do
not escape as unhandled exceptions.

When both dependencies are ready, the endpoint returns `200 OK`:

```json
{
  "data": {
    "status": "ready",
    "checks": {
      "repository": "ready",
      "processor": "ready"
    }
  }
}
```

If either signal is false or throws, the endpoint returns `503 Service
Unavailable` through the global error envelope:

```json
{
  "statusCode": 503,
  "code": "SERVICE_NOT_READY",
  "message": "Service is not ready to accept payment work",
  "requestId": "request-id",
  "timestamp": "2026-08-26T00:00:00.000Z",
  "path": "/health/ready",
  "details": {
    "checks": {
      "repository": "not_ready",
      "processor": "ready"
    }
  }
}
```

Readiness failures emit a structured warning with the two check states and the
request correlation supplied by the HTTP logger. An exception raised by a
repository check is logged as an error with its stack before the safe
`not_ready` result is returned. No internal exception text is sent to clients.

## Swagger contract

The health controller documents both success schemas and the readiness `503`
schema. The payment creation operation adds a documented `429` response using
the shared error DTO. The OpenAPI JSON remains available at `/docs-json`, and
Swagger UI remains at `/docs`.

Rate-limit response headers are covered in endpoint metadata where applicable:

- `X-RateLimit-Limit`;
- `X-RateLimit-Remaining`;
- `X-RateLimit-Reset`; and
- `Retry-After` on blocked responses.

## Shutdown behavior

Nest shutdown hooks notify both the repository and processor. Once shutdown
begins:

1. the processor rejects new schedules and cancels timers;
2. the repository marks itself not ready;
3. a readiness evaluation returns `503 SERVICE_NOT_READY`;
4. liveness remains a process-only answer for as long as the HTTP server can
   still serve the probe.

The health check does not attempt to delay or reverse shutdown.

## Testing strategy

Implementation follows red-green-refactor cycles.

Rate-limit unit tests cover async configuration from `ConfigService`, metadata
selection of the payment-creation policy, health exclusions, and the stable
throttling exception body. Configuration tests cover the strict relationship
between the creation and general limits.

Health unit tests cover live success, ready success, each false dependency,
repository exceptions, safe logging, and shutdown state changes.

Focused Supertest suites use deliberately small limits and prove:

- normal requests below the configured limit succeed;
- exceeding the general policy returns the standard `429` envelope and retry
  headers;
- payment creation reaches its stricter limit before the general limit;
- health probes remain `200` after API limits are exhausted;
- liveness returns the documented process-only response;
- readiness returns `200` with both dependencies ready;
- readiness returns the documented `503` after shutdown readiness is signaled;
- `/docs-json` contains both unversioned health operations and the payment
  `429` response.

Checkpoint verification runs the focused unit and E2E suites, formatting,
linting, type checking, the production build, and the complete test suites.

## Atomic delivery

The checkpoint uses focused Conventional Commits for:

1. the approved design;
2. the implementation plan;
3. the throttler dependency and configuration;
4. the guarded API policy and error contract;
5. repository/processor health signals and endpoints; and
6. checkpoint verification evidence.

The branch remains local and unmerged. No remote is added or pushed before
Checkpoint 11.
