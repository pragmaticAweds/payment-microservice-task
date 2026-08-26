# Payment Domain Design

## Scope

Checkpoint 4 establishes a framework-independent payment domain and an
asynchronous persistence boundary. It does not expose HTTP endpoints, implement
idempotency, or start background processing; those remain in later checkpoints.

## Payment aggregate

`Payment` is an immutable aggregate. It is the only production API allowed to
create payment state or apply a status transition.

Each payment contains:

- `id`: a UUID generated with `crypto.randomUUID()`.
- `smallestUnitAmount`: a positive integer number of US cents. For example,
  `1050` represents USD 10.50.
- `currency`: the literal `USD`. Other currencies are outside this assessment.
- `merchantReference`: a required, trimmed string of 1–100 characters. It is a
  caller-owned reference and is intentionally reusable.
- `description`: an optional, trimmed string of at most 500 characters. An
  omitted or whitespace-only description is stored as absent.
- `status`: `pending`, `processing`, `succeeded`, or `failed`.
- `createdAt` and `updatedAt`: ISO-8601 timestamps.

New payments always start in `pending` state. Construction rejects fractional,
zero, or negative amounts; unsupported currencies; blank or overlong merchant
references; and overlong descriptions.

## State machine

The only valid transitions are:

```text
pending -> processing -> succeeded
                      -> failed
```

The aggregate rejects skipped transitions, reverse transitions, self
transitions, and all transitions from terminal states. A valid transition
returns a new immutable Payment with the same identity and creation timestamp,
plus a refreshed update timestamp.

## Idempotency boundary

`Idempotency-Key` is part of the eventual `POST /api/v1/payments` request as an
HTTP header, but it is not a public Payment property. Checkpoint 6 will store a
separate idempotency record containing the key, canonical request fingerprint,
payment ID, original response, and creation time. This keeps transport/replay
metadata out of the business aggregate and payment retrieval response.

## Errors

The domain throws explicit framework-independent errors:

- `InvalidPaymentError` for invalid creation data.
- `InvalidPaymentTransitionError` for invalid state changes.

Neither error imports NestJS or HTTP types. Checkpoint 5 will translate these
errors into the standard API error envelope and appropriate status codes.

## Persistence boundary

`PaymentRepository` exposes asynchronous `save(payment)` and `findById(id)`
operations. Consumers inject the `PAYMENT_REPOSITORY` symbol instead of the
in-memory implementation.

`InMemoryPaymentRepository` stores immutable Payment instances in a private
`Map`. Saving the same ID replaces its snapshot, which supports explicit status
updates without shared mutable state. Missing identifiers resolve to `null`.

## Testing

Jest unit tests cover:

- valid creation, normalization, UUIDs, timestamps, and initial status;
- every field validation rule;
- each allowed transition;
- skipped, reverse, self, and terminal-state transitions;
- repository save, lookup, replacement, and missing identifiers;
- NestJS provider-token wiring.

Every production behavior follows a red-green-refactor cycle. Tests exercise
real domain and repository objects without HTTP controllers or mocked business
logic.
