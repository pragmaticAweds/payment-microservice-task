# Payment REST API and Swagger Design

## Scope

Checkpoint 5 exposes the payment domain from Checkpoint 4 through a versioned
NestJS REST API. It adds create, retrieve, and explicit status-transition
operations; consistent success and error responses; structured lifecycle
logging; Swagger UI; and a machine-readable OpenAPI document.

This checkpoint does not implement idempotency, automatic payment processing,
rate limiting, or persistence outside the existing in-memory repository. The
`Idempotency-Key` requirement and replay behavior will be introduced together
in Checkpoint 6 so the API never requires a header it does not enforce.

## Chosen architecture

Use the existing layered structure:

```text
HTTP request
  -> PaymentsController
  -> PaymentsService
  -> Payment aggregate
  -> PaymentRepository
```

`PaymentsController` owns HTTP concerns only: DTO validation, UUID parsing,
response status codes, success envelopes, and Swagger annotations.

`PaymentsService` exposes asynchronous create, retrieve, and transition
operations. It coordinates the framework-independent `Payment` aggregate and
the asynchronous `PaymentRepository` boundary. Keeping transition orchestration
in the service allows the explicit REST endpoint in this checkpoint and the
automatic processor in Checkpoint 7 to reuse the same behavior.

The `Payment` aggregate remains the sole authority for creation invariants and
state transitions. Neither the controller nor service duplicates its transition
rules.

## HTTP contract

All payment routes use the existing global prefix and URI versioning. Successful
responses wrap the resource in a top-level `data` property. Errors retain the
existing standard error envelope.

### Create a payment

`POST /api/v1/payments`

Request body:

```json
{
  "smallestUnitAmount": 1050,
  "currency": "USD",
  "merchantReference": "order-2026-0001",
  "description": "Invoice 0001"
}
```

Rules:

- `smallestUnitAmount` is a positive safe integer expressed in US cents.
- `currency` must be the literal `USD`.
- `merchantReference` is required, trimmed, and contains 1–100 characters. It
  is caller-owned and reusable.
- `description` is optional, trimmed, and contains at most 500 characters. A
  blank description is normalized to absent by the domain.
- Unknown body properties are rejected by the existing global validation
  policy.

The endpoint returns `201 Created` with `{ "data": payment }`. A new payment is
always `pending`.

### Retrieve a payment

`GET /api/v1/payments/:id`

The path parameter must be a UUID. A stored payment returns `200 OK` with
`{ "data": payment }`. A malformed UUID returns `400 Bad Request`; a valid but
unknown UUID returns `404 Not Found`.

### Transition a payment

`PATCH /api/v1/payments/:id/status`

Request body:

```json
{
  "status": "processing"
}
```

The request schema accepts the transition targets `processing`, `succeeded`,
and `failed`. `pending` is an initial state, not a transition target, so it is
rejected as an invalid payload with `400 Bad Request`.

The service asks the aggregate to apply the transition and saves the returned
immutable snapshot. A valid transition returns `200 OK` with
`{ "data": updatedPayment }`. The only valid sequence is:

```text
pending -> processing -> succeeded
                      -> failed
```

Skipped, repeated, reversed, and terminal-state transitions return
`409 Conflict`.

## Payment representation

The `data` object contains:

- `id`: UUID.
- `smallestUnitAmount`: positive integer US cents.
- `currency`: `USD`.
- `merchantReference`: caller-owned reference.
- `description`: optional description, omitted when absent.
- `status`: `pending`, `processing`, `succeeded`, or `failed`.
- `createdAt`: ISO-8601 creation timestamp.
- `updatedAt`: ISO-8601 last-update timestamp.

Dedicated response DTOs describe this representation and its `data` envelope
for OpenAPI. They do not become a second domain model and do not mutate the
aggregate.

## Request correlation

Every endpoint accepts an optional `X-Request-Id` header through the existing
request logging setup. The effective request ID is returned in the response
header and included in error envelopes and structured logs. Swagger documents
the request header without making it required.

## Error handling

The global exception filter remains the single error-response boundary. It is
extended to translate known framework-independent errors:

- invalid DTO input, malformed UUIDs, and `InvalidPaymentError` return
  `400 Bad Request`;
- `PaymentNotFoundError` returns `404 Not Found`;
- `InvalidPaymentTransitionError` returns `409 Conflict`;
- unknown failures return `500 Internal Server Error` without exposing internal
  exception details.

Every error response retains the existing fields: `statusCode`, `code`,
`message`, `requestId`, `timestamp`, `path`, and optional `details`.

`PaymentNotFoundError` is an application error rather than a NestJS exception.
This keeps the service reusable outside HTTP and keeps HTTP mapping centralized.

## Structured logging

`PaymentsService` writes structured lifecycle events for successful payment
creation and status transitions. Records include stable event names, payment
IDs, merchant references, prior and next statuses where applicable, and request
correlation supplied by the request logger.

Expected business failures are logged with useful identifiers at warning level.
Unexpected failures are logged at error level with stack information by the
global filter. Full DTOs, descriptions, and sensitive headers are not included
in lifecycle log fields; existing logger redaction remains in force.

Repository calls remain asynchronous even though the active adapter uses a
`Map`. This demonstrates realistic async orchestration and allows a database
adapter to replace the in-memory implementation without changing the public API.

## Swagger and OpenAPI

`@nestjs/swagger` generates the documentation from explicit controller and DTO
metadata:

- Swagger UI is served at `/docs`.
- The OpenAPI JSON document is served at `/docs-json`.
- The document includes a service title, description, semantic API version,
  and a `Payments` tag.
- Each operation documents its body or path parameters, optional
  `X-Request-Id`, realistic examples, success response, and all applicable
  error responses.
- Component schemas describe payment fields, create and transition requests,
  the success envelope, and the standard error envelope.

The documentation routes stay outside `/api/v1`; they describe the versioned
payment paths but are service-level operational documentation endpoints.

## Testing strategy

Implementation follows red-green-refactor cycles.

Unit tests cover `PaymentsService` with a controlled repository double:

- creation saves and returns a pending payment;
- retrieval returns an existing payment;
- retrieval and transition of an unknown payment raise
  `PaymentNotFoundError`;
- valid transitions save the new immutable snapshot;
- aggregate transition failures pass through unchanged;
- successful lifecycle events use structured log fields.

End-to-end tests use an isolated Nest application and in-memory repository for
each test suite. They cover:

- create, retrieve, and the complete success and failure transition paths;
- `data` envelopes for every successful response;
- validation of amount, currency, merchant reference, description, status, and
  unknown properties;
- malformed UUIDs (`400`), unknown payments (`404`), and illegal transitions
  (`409`);
- request-ID propagation and the existing standard error envelope;
- Swagger HTML availability at `/docs`;
- valid OpenAPI JSON at `/docs-json`, including all paths, schemas, headers,
  examples, success codes, and error codes.

The existing configuration, logging, error, domain, repository, and application
tests remain regression coverage. Checkpoint verification runs formatting,
linting, type checking, the production build, unit tests, end-to-end tests, and
the complete test suite before the checkpoint is offered for user review.

## Atomic delivery

The implementation is split into focused Conventional Commits: design and plan
documentation, the tested REST/application layer, Swagger/OpenAPI setup and
contract tests, and the checkpoint ledger update. No remote is added and no
branch is pushed during this checkpoint.
