# Versioned API Contract and Controller Request Files Design

- Date: 2026-08-27
- Status: Approved for planning
- Scope: Public route consistency, response envelopes, startup visibility, and
  controller-adjacent REST requests

## Context

The service currently applies `/api/v1` to application and payment controllers,
while health and Swagger routes are outside the prefix and version. Successful
responses also use different shapes, and the terminal does not explicitly report
the effective port after the server starts.

The revised contract must make every public route discoverable beneath
`/api/v1`, distinguish transport success from domain state, and provide runnable
`.rest` examples beside each controller.

## Goals

- Apply `/api/v1` to application, health, payment, Swagger UI, and OpenAPI JSON
  routes.
- Use a top-level `status` to indicate request success or failure.
- Preserve domain-specific statuses inside `data`.
- Make port `4040` the validated and documented default.
- Emit a structured startup log containing the effective port and API URL.
- Add one `.rest` file beside each controller.
- Update Swagger, tests, README, and checkpoint evidence with the new contract.

## Non-goals

- Authentication or authorization.
- A new API version or backward-compatible aliases for the old routes.
- Changes to payment lifecycle rules, deterministic outcomes, idempotency, rate
  limits, persistence, or processing behavior.
- Deployment, container, or workflow changes.

## Chosen approach

Retain Nest's global prefix and URI versioning as the single source of truth.
Remove the health-controller exclusions and its version-neutral marker so default
version `1` applies naturally. Configure Swagger beneath the same prefix and
version. Controllers and the global exception filter will produce explicit,
typed envelopes; the payment domain entity remains unchanged.

This is preferred over embedding `api/v1` in every controller path because it
avoids duplication, and over a global success interceptor because controller DTOs
can describe the two different meanings of `status` without runtime inference.

## Route contract

The committed default origin is `http://localhost:4040`.

| Method  | Route                         | Purpose                          |
| ------- | ----------------------------- | -------------------------------- |
| `GET`   | `/api/v1`                     | Service information              |
| `GET`   | `/api/v1/health/live`         | Process liveness                 |
| `GET`   | `/api/v1/health/ready`        | Payment-work readiness           |
| `POST`  | `/api/v1/payments`            | Create and schedule a payment    |
| `GET`   | `/api/v1/payments/:id`        | Retrieve a payment               |
| `PATCH` | `/api/v1/payments/:id/status` | Apply a valid payment transition |
| `GET`   | `/api/v1/docs`                | Swagger UI                       |
| `GET`   | `/api/v1/docs-json`           | OpenAPI JSON                     |

Old unprefixed health and documentation routes intentionally return `404`. No
compatibility aliases will be introduced.

## Response envelope

### Successful operations

Every `2xx` controller response has the following shape:

```json
{
  "status": "success",
  "data": {}
}
```

The top-level `status` describes whether the HTTP operation succeeded. It is
always the literal `success` for successful responses.

Swagger UI serves HTML and the OpenAPI endpoint serves the specification itself;
these documentation assets are not wrapped in the controller JSON envelope.

Domain or operational state remains inside `data`. A payment response therefore
keeps its lifecycle status:

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

Liveness uses the same distinction:

```json
{
  "status": "success",
  "data": {
    "status": "live"
  }
}
```

The service-information route becomes:

```json
{
  "status": "success",
  "data": {
    "name": "node-payment-microservice",
    "status": "ok"
  }
}
```

### Error operations

Every mapped HTTP, validation, domain, throttling, readiness, and unexpected
error gains the literal top-level `status: "error"` while preserving its current
fields:

```json
{
  "status": "error",
  "statusCode": 404,
  "code": "PAYMENT_NOT_FOUND",
  "message": "Payment was not found",
  "requestId": "assessment-request-123",
  "timestamp": "2026-08-27T08:00:01.000Z",
  "path": "/api/v1/payments/4fa85f64-5717-4562-b3fc-2c963f66afa6"
}
```

Validation and selected domain errors may continue to include `details`. HTTP
status codes, application error codes, safe client messages, correlation IDs,
logging levels, and internal-error redaction remain unchanged.

## Application changes

### Routing and Swagger

- `configureApplication` keeps global prefix `api` and default URI version `1`.
- Health paths are no longer excluded from the global prefix.
- `HealthController` is no longer version-neutral.
- Swagger UI and JSON are configured at `/api/v1/docs` and
  `/api/v1/docs-json`.
- OpenAPI path entries and examples reflect only the new routes.

### Response types

- Introduce a shared success-status type or constant to prevent spelling drift.
- Application, health, and payment response interfaces and Swagger DTOs add the
  top-level `status: "success"` property.
- Existing payment and health statuses remain inside `data`.
- The global error response interface and Swagger error DTO add
  `status: "error"`.
- The exception filter adds the field in one place so all error sources remain
  consistent.

### Default port and startup event

- Change the Zod default, `.env.example`, README, examples, tests, and `.rest`
  base URLs from `3000` to `4040`.
- After `app.listen(port)` resolves, emit one structured log with event
  `service.started`, effective `port`, and API URL derived as
  `http://localhost:<effective-port>/api/v1`.
- The log is emitted only after a successful bind, so it never announces an
  unavailable service.

## Controller-adjacent REST requests

Add:

- `src/app.controller.rest`
- `src/health/health.controller.rest`
- `src/payments/api/payments.controller.rest`

Each file owns only its matching controller's requests. The payment file uses a
named creation response to supply the UUID for retrieval and transition requests.
It also includes idempotency replay/conflict and representative validation/not-
found cases. Expected status codes and important response fields are documented
as comments.

The health file uses `/api/v1/health/live` and `/api/v1/health/ready`. The
application file uses `/api/v1`. All use port `4040`.

For a reliable manual status transition, the request-file comment instructs the
tester to start the service with a longer `PROCESSING_DELAY_MS`, create a payment,
and transition it while its domain status is `processing`. A processor race may
legitimately return the documented `409`.

## Testing strategy

Implementation follows test-driven development:

1. Update E2E expectations first and observe failures for the new route and
   envelope contracts.
2. Add unit coverage for error envelopes and startup-log context and observe the
   expected failures.
3. Make the minimum routing, DTO, filter, and bootstrap changes required to pass.
4. Update Swagger assertions to require versioned documentation paths and both
   top-level/domain statuses.
5. Run format, lint, type-check, unit, E2E, open-handle, coverage, and build gates.
6. Start the built service on the default port, verify all routes and envelopes,
   execute the core REST scenarios, and stop the process.

Regression coverage must prove:

- All new routes succeed and old unversioned routes return `404`.
- Every successful controller response has top-level `status: "success"`.
- Payment and health domain statuses remain inside `data`.
- Every error path has top-level `status: "error"`.
- `/api/v1/docs-json` exposes the new paths and schemas.
- The effective port and API URL are represented in the startup log context.
- Existing idempotency, processing, transition, throttling, readiness, logging,
  and correlation behavior remains intact.

## Migration and compatibility

This is an intentional breaking contract change before publication. Consumers
must update health and documentation URLs and account for the new top-level
status field. No deprecation period is required because the service has not yet
been published.

The payment domain, repositories, and processing interfaces do not change. This
keeps the migration limited to HTTP presentation, documentation, and startup
observability.
