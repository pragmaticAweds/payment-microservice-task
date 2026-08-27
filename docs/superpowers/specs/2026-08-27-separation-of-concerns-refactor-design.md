# Production Definition Separation Design

**Date:** 2026-08-27

## Goal

Refactor the NestJS payment microservice so production behavior files contain
behavior, while reusable types, interfaces, fixed value sets, constants,
dependency-injection tokens, and schemas live in explicitly named companion
files owned by the same architectural boundary.

The refactor must preserve the HTTP API, Swagger document, logs, runtime
configuration, payment behavior, and test behavior.

## Approved conventions

### Flat boundary-local files

Definitions stay next to the boundary that owns them. Do not create generic
`types/`, `interfaces/`, or `constants/` directories while the definition area
is 250 lines or fewer.

Examples:

```text
src/payments/domain/payment.types.ts
src/payments/domain/payment.constants.ts
src/payments/processing/payment-processing.types.ts
src/payments/processing/payment-processing.constants.ts
src/health/health.types.ts
src/health/health.constants.ts
```

If a single boundary's definition files grow beyond 250 lines, a future
refactor may introduce a dedicated subdirectory. This change does not create
such directories pre-emptively.

### File suffixes

- `*.types.ts`: interfaces and type aliases.
- `*.constants.ts`: runtime constants, fixed value objects, regex patterns,
  transition maps, dependency-injection tokens, metadata keys, and reusable
  Swagger header definitions.
- `*.schema.ts`: executable validation schemas such as the Zod environment
  schema.
- Existing `*.dto.ts`, `*.service.ts`, `*.controller.ts`, `*.repository.ts`,
  `*.filter.ts`, and similar files retain executable behavior only.

Imports remain direct. No barrel files are introduced.

### No enums

TypeScript `enum` declarations are prohibited. Fixed value sets use frozen
literal inference with `as const`, and their union types are inferred in the
owning `*.types.ts` file.

```ts
// payment.constants.ts
export const PAYMENT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
} as const;
```

```ts
// payment.types.ts
import { PAYMENT_STATUS } from './payment.constants';

export type PaymentStatus =
  (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];
```

`PAYMENT_CURRENCY` follows the same pattern. Runtime consumers use names such as
`PAYMENT_STATUS.PENDING`; type positions continue to use `PaymentStatus`.

## Approaches considered

### 1. Flat files within each boundary — selected

Each domain, API, application, processing, repository, health, configuration,
common, and startup boundary owns a small companion types/constants file. This
keeps ownership explicit, avoids broad shared registries, and satisfies the
250-line folder rule.

### 2. One pair of files per top-level feature

A single `payments/payment.types.ts` and `payments/payment.constants.ts` would
be initially simple, but it would couple API, domain, persistence, and
background-processing concerns and would become a dumping ground.

### 3. Global types and constants directories

Central `src/types` and `src/constants` directories would make files easy to
find by syntax but obscure which module owns each definition and increase
cross-feature coupling. This approach is rejected.

## Definition ownership

### Application root

- Keep route/version values in `src/api.constants.ts`.
- Move `ServiceInfo` from `app.service.ts` to `src/app.types.ts`.

### Common boundary

- Flatten the response helper from `common/http/api-response.ts` to
  `common/api-response.ts`.
- Move success/error status literals to `common/api-response.constants.ts`.
- Move `ApiSuccessResponse` to `common/api-response.types.ts`.
- Move exception-filter and application-error mapper shapes to
  `common/error.types.ts`.
- Move logger configuration data to `common/logger.constants.ts` and logger
  environment typing to `common/logger.types.ts`.
- Move reusable Swagger request-ID headers to `common/openapi.constants.ts`.
- Move throttler names and decorator metadata keys to
  `common/rate-limit/rate-limit.constants.ts`.

Executable helpers, decorators, guards, mappers, and configuration factories
remain in their existing behavior files.

### Configuration boundary

- Move the executable Zod schema to `config/environment.schema.ts`.
- Move the inferred `Environment` type to `config/environment.types.ts`.
- Keep `validateEnvironment` in `config/environment.ts`.

### Health boundary

- Move readiness status and response interfaces to `health/health.types.ts`.
- Move health-specific OpenAPI constants to `health/health.constants.ts` only
  when they are not already shared from `common/openapi.constants.ts`.

### Payment domain boundary

- Replace `payment-status.ts` enums with `PAYMENT_STATUS` and
  `PAYMENT_CURRENCY` constant objects in `domain/payment.constants.ts`.
- Move amount/reference limits and the allowed transition map to the same
  constants file.
- Move `PaymentStatus`, `PaymentCurrency`, `CreatePaymentInput`, and internal
  payment property shapes to `domain/payment.types.ts`.
- Keep the `Payment` entity and its validation/transition behavior in
  `domain/payment.ts`.

### Payment API boundary

- Move controller response aliases to `api/payment-api.types.ts`.
- Move payment-specific Swagger response headers and allowed transition target
  values to `api/payment-api.constants.ts`.
- DTO classes and controller methods remain executable behavior files.

### Payment application boundary

- Move the idempotency-key pattern to
  `application/payment-idempotency.constants.ts`.
- Move idempotency result and in-flight coordination shapes to
  `application/payment-idempotency.types.ts`.

### Payment processing boundary

- Move scheduler/outcome resolver injection tokens to
  `processing/payment-processing.constants.ts`.
- Move scheduler, task, outcome, phase, context, resolver, and creation
  admission definitions to `processing/payment-processing.types.ts`.
- Processor, scheduler, and deterministic resolver files retain behavior only.

### Payment repository boundary

- Move payment and idempotency repository injection tokens to
  `repositories/payment-repository.constants.ts`.
- Move repository contracts, transition shapes, and idempotency records to
  `repositories/payment-repository.types.ts`.
- Concrete in-memory repository files retain implementation behavior only.

### Startup boundary

- Move startup application/context interfaces to `startup/startup.types.ts`.
- Move the startup event and log message to `startup/startup.constants.ts`.
- Keep context creation and bind-then-log orchestration in `startup/startup-log.ts`.

## What remains local

- Method-local variables and values computed as part of an operation remain in
  the behavior that uses them.
- One-off callback functions remain local.
- DTO classes remain in DTO files because they are executable decorator-backed
  schemas, not plain type declarations.
- Test-only fixtures, interfaces, and constants remain within the test that owns
  them unless production imports require an update. The production architecture
  rule applies to `src/`.

## Dependency and cycle rules

- Constant files must not import behavior files.
- Type-only dependencies use `import type`.
- `payment.types.ts` may import the payment constant objects solely to infer
  literal unions.
- Behavior files import their types and constants directly from the owning
  companion file.
- Common files must not import payment or health feature definitions.
- No new barrel exports are added.

## Behavioral compatibility

The following remain unchanged:

- All routes stay beneath `/api/v1`.
- Success and error response envelopes keep their current JSON shape.
- Payment status and currency wire values remain lowercase lifecycle values and
  uppercase `USD` respectively.
- DTO validation and Swagger enum values remain identical.
- Idempotency, asynchronous processing, rate limiting, readiness, liveness,
  logging, and startup behavior remain identical.
- No dependency or environment variable changes are introduced.

## Architecture enforcement

Add a focused Jest architecture test for `src/` that verifies:

- no `enum` declaration exists;
- interfaces and type aliases are declared only in `*.types.ts` files;
- uppercase module-level data constants are declared only in
  `*.constants.ts` files, with explicit exceptions for executable factory or
  decorator exports where syntax does not represent static data;
- no production `types`, `interfaces`, or `constants` directory is introduced;
- every new types/constants file remains within the 250-line threshold.

The test is intentionally scoped to production source files, not test fixtures.

## Migration and verification strategy

1. Record a green baseline.
2. Add the architecture test and confirm it fails against the current inline
   declarations and enums.
3. Move common, configuration, health, startup, and application-root
   definitions.
4. Replace payment enums with constant objects and inferred types.
5. Move payment API, application, processing, and repository definitions.
6. Update imports directly without compatibility barrels.
7. Remove obsolete definition files once no imports remain.
8. Run formatting, linting, type-checking, unit tests, E2E tests, coverage, and
   the production build.
9. Confirm Swagger still exposes the same paths and literal values.

The implementation will use atomic Conventional Commits so the structural
refactor and its architecture enforcement remain reviewable.
