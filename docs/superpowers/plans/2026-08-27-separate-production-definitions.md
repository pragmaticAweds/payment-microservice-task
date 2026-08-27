# Separate Production Definitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate production behavior from types, interfaces, schemas, constants, and fixed value sets while grouping every multi-file concern beneath a matching parent folder.

**Architecture:** Preserve the existing NestJS module boundaries and observable API while moving declarations to concern-owned companion files. Existing focused parents are reused; broad parents receive a named concern folder when a concern has multiple files. Payment enums are replaced with `as const` objects plus inferred union types.

**Tech Stack:** Bun 1.3.8, NestJS 11 with Express, TypeScript 5, Zod, Swagger, Jest, and Supertest.

**Spec:** `docs/superpowers/specs/2026-08-27-separation-of-concerns-refactor-design.md`

## Global Constraints

- Production behavior and HTTP/Swagger output must not change.
- No TypeScript `enum` declarations may remain in `src/`.
- Fixed value sets use `as const`; their union types are inferred in `*.types.ts`.
- Interfaces and type aliases belong in `*.types.ts`.
- Static data, DI tokens, metadata keys, regex patterns, and transition maps belong in `*.constants.ts`.
- Executable validation schemas belong in `*.schema.ts`.
- A concern with multiple files uses a matching parent folder.
- Do not create generic `types/`, `interfaces/`, or `constants/` folders while the definition category is 250 lines or fewer.
- Existing focused parents such as `health/`, `config/`, `startup/`, `processing/`, `repositories/`, and `api/dto/` satisfy the parent-folder rule.
- DTO classes remain in `api/dto/` because Nest uses them at runtime.
- Test-only declarations remain local unless imports must change.
- Imports are direct; do not add barrel files.
- Use Bun for every project command.
- Keep commits atomic and use Conventional Commit messages.

---

### Task 1: Separate shared, configuration, and health definitions

**Files:**

- Create: `src/common/api-response/api-response.ts`
- Create: `src/common/api-response/api-response.constants.ts`
- Create: `src/common/api-response/api-response.types.ts`
- Delete: `src/common/http/api-response.ts`
- Create: `src/common/filters/error.types.ts`
- Move: `src/common/logger.config.ts` to `src/common/logger/logger.config.ts`
- Create: `src/common/logger/logger.constants.ts`
- Create: `src/common/logger/logger.types.ts`
- Create: `src/common/openapi/openapi.constants.ts`
- Create: `src/common/rate-limit/rate-limit.constants.ts`
- Create: `src/config/environment.schema.ts`
- Create: `src/config/environment.types.ts`
- Create: `src/health/health.types.ts`
- Modify: affected files under `src/common/`, `src/config/`, `src/health/`, `src/app.module.ts`, and their unit/E2E imports

**Interfaces:**

- Produces: `ApiSuccessResponse<T>`, `API_SUCCESS_STATUS`, `API_ERROR_STATUS`, `MappedApplicationError`, `ErrorEnvelope`, `HttpErrorBody`, `LoggerEnvironment`, `REQUEST_ID_HEADER`, `SENSITIVE_LOG_PATHS`, `REQUEST_ID_RESPONSE_HEADERS`, `DEFAULT_THROTTLER`, `PAYMENT_CREATE_THROTTLER`, `PAYMENT_CREATION_RATE_LIMIT_METADATA`, `environmentSchema`, `Environment`, `HealthDependencyStatus`, `HealthReadinessChecks`, and `HealthReadinessData`.
- Preserves: `successResponse`, `createLoggerOptions`, `validateEnvironment`, health response bodies, exception mapping, correlation IDs, redaction, and throttling behavior.

- [ ] **Step 1: Record the green shared-boundary baseline**

Run:

```bash
bun run test -- app.controller global-exception logger runtime-config health
```

Expected: all selected suites pass before files move.

- [ ] **Step 2: Create the API-response concern parent**

Create `api-response.constants.ts`:

```ts
export const API_SUCCESS_STATUS = 'success' as const;
export const API_ERROR_STATUS = 'error' as const;
```

Create `api-response.types.ts`:

```ts
import type { API_SUCCESS_STATUS } from './api-response.constants';

export interface ApiSuccessResponse<T> {
  status: typeof API_SUCCESS_STATUS;
  data: T;
}
```

Move `successResponse` into the parent's `api-response.ts`, import its constant
and type from the companion files, update every consumer, and remove the empty
`common/http/` directory.

- [ ] **Step 3: Extract error, logger, OpenAPI, and rate-limit definitions**

Create `filters/error.types.ts` with the existing `MappedApplicationError`,
`ErrorEnvelope`, and `HttpErrorBody` shapes. Create `logger/logger.types.ts` with
`LoggerEnvironment`. Create `logger/logger.constants.ts` with
`REQUEST_ID_HEADER` and `SENSITIVE_LOG_PATHS`. Move `logger.config.ts` into the
same parent.

Create `openapi/openapi.constants.ts`:

```ts
export const REQUEST_ID_RESPONSE_HEADERS = {
  'x-request-id': {
    description: 'Effective request correlation identifier',
    schema: { type: 'string' },
  },
} as const;
```

Move the three throttler/metadata names into
`rate-limit/rate-limit.constants.ts`. Update direct imports and remove the
duplicate request-ID header object from `health.controller.ts`.

- [ ] **Step 4: Extract environment schema/type and health types**

Export the unchanged Zod object as `environmentSchema` from
`environment.schema.ts`. Define:

```ts
import { z } from 'zod';
import { environmentSchema } from './environment.schema';

export type Environment = z.infer<typeof environmentSchema>;
```

Move `HealthDependencyStatus`, `HealthReadinessChecks`, and
`HealthReadinessData` to `health.types.ts`, using type-only imports where
appropriate. Keep `validateEnvironment` and all health behavior unchanged.

- [ ] **Step 5: Verify shared boundaries**

Run:

```bash
bun run format:check
bun run lint
bun run typecheck
bun run test -- app.controller global-exception logger runtime-config health throttler
bun run test:e2e -- app errors health rate-limit
git diff --check
```

Expected: every command passes and the E2E response bodies remain unchanged.

- [ ] **Step 6: Commit the shared refactor**

```bash
git add src/common src/config src/health src/app.module.ts test
git commit -m "refactor(common): separate shared definitions"
```

---

### Task 2: Group the payment domain and replace enums

**Files:**

- Create: `src/payments/domain/payment/payment.ts`
- Create: `src/payments/domain/payment/payment.errors.ts`
- Create: `src/payments/domain/payment/payment.constants.ts`
- Create: `src/payments/domain/payment/payment.types.ts`
- Delete: `src/payments/domain/payment.ts`
- Delete: `src/payments/domain/payment.errors.ts`
- Delete: `src/payments/domain/payment-status.ts`
- Modify: all production and test imports of payment domain values/types

**Interfaces:**

- Produces: `PAYMENT_STATUS`, `PAYMENT_CURRENCY`, `MAX_MERCHANT_REFERENCE_LENGTH`, `MAX_DESCRIPTION_LENGTH`, `ALLOWED_PAYMENT_TRANSITIONS`, `PaymentStatus`, `PaymentCurrency`, `CreatePaymentInput`, and `PaymentProperties`.
- Preserves: the `Payment` class API and wire values `pending`, `processing`, `succeeded`, `failed`, and `USD`.

- [ ] **Step 1: Record the green domain baseline**

Run:

```bash
bun run test -- payment.spec payments.service deterministic-payment-outcome
```

Expected: all selected payment suites pass.

- [ ] **Step 2: Create literal payment constants**

Create `payment.constants.ts`:

```ts
import type { PaymentStatus } from './payment.types';

export const PAYMENT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
} as const;

export const PAYMENT_CURRENCY = {
  USD: 'USD',
} as const;

export const MAX_MERCHANT_REFERENCE_LENGTH = 100;
export const MAX_DESCRIPTION_LENGTH = 500;

export const ALLOWED_PAYMENT_TRANSITIONS: Record<
  PaymentStatus,
  readonly PaymentStatus[]
> = {
  [PAYMENT_STATUS.PENDING]: [PAYMENT_STATUS.PROCESSING],
  [PAYMENT_STATUS.PROCESSING]: [
    PAYMENT_STATUS.SUCCEEDED,
    PAYMENT_STATUS.FAILED,
  ],
  [PAYMENT_STATUS.SUCCEEDED]: [],
  [PAYMENT_STATUS.FAILED]: [],
};
```

The type-only cycle is safe because `payment.types.ts` imports only runtime
constant objects for literal inference and emits no runtime import back to the
types file.

- [ ] **Step 3: Create inferred payment types**

Create `payment.types.ts` with:

```ts
import {
  PAYMENT_CURRENCY,
  PAYMENT_STATUS,
} from './payment.constants';

export type PaymentStatus =
  (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];
export type PaymentCurrency =
  (typeof PAYMENT_CURRENCY)[keyof typeof PAYMENT_CURRENCY];

export interface CreatePaymentInput {
  smallestUnitAmount: number;
  currency: PaymentCurrency;
  merchantReference: string;
  description?: string;
}

export interface PaymentProperties extends CreatePaymentInput {
  id: string;
  status: PaymentStatus;
  createdAt: string;
  updatedAt: string;
}
```

- [ ] **Step 4: Move domain behavior into its concern parent**

Move the `Payment` class and domain errors without changing logic. Replace value
references such as `PaymentStatus.PENDING` with `PAYMENT_STATUS.PENDING` and
`PaymentCurrency.USD` with `PAYMENT_CURRENCY.USD`. Update DTO decorators to use
the same literal arrays/objects and update every direct import in `src/` and
`test/`. Remove `payment-status.ts` after `rg` shows no remaining imports.

- [ ] **Step 5: Verify domain and API compatibility**

Run:

```bash
rg -n "\benum\b|payment-status" src test --glob '*.ts'
bun run format:check
bun run lint
bun run typecheck
bun run test -- payment payments.service payment-processor deterministic-payment-outcome
bun run test:e2e -- payments processing
git diff --check
```

Expected: the search exits `1` with no enum/import matches; all other commands
pass.

- [ ] **Step 6: Commit the payment domain refactor**

```bash
git add src/payments test
git commit -m "refactor(payments): replace enums with literal definitions"
```

---

### Task 3: Group payment idempotency and repository definitions

**Files:**

- Create: `src/payments/application/payment-idempotency/payment-creation-idempotency.service.ts`
- Create: `src/payments/application/payment-idempotency/payment-idempotency.constants.ts`
- Create: `src/payments/application/payment-idempotency/payment-idempotency.types.ts`
- Create: `src/payments/application/payment-idempotency/idempotency.errors.ts`
- Delete: the corresponding flat files from `src/payments/application/`
- Create: `src/payments/repositories/payment-repository.constants.ts`
- Create: `src/payments/repositories/payment-repository.types.ts`
- Delete: `src/payments/repositories/payment.repository.ts`
- Delete: `src/payments/repositories/payment-idempotency.repository.ts`
- Modify: application, module, repository implementation, filter, and test imports

**Interfaces:**

- Produces: `IDEMPOTENCY_KEY_PATTERN`, `IdempotentPaymentCreationResult`, `InFlightCreation`, `PAYMENT_REPOSITORY`, `PAYMENT_IDEMPOTENCY_REPOSITORY`, `PaymentTransition`, `PaymentRepository`, `PaymentIdempotencyRecord`, and `PaymentIdempotencyRepository`.
- Preserves: idempotency fingerprints, conflicts, replay headers, concurrent coalescing, repository contracts, and DI tokens.

- [ ] **Step 1: Record the green idempotency/repository baseline**

Run:

```bash
bun run test -- idempotency repository payments.module
```

Expected: all selected suites pass.

- [ ] **Step 2: Group idempotency definitions and behavior**

Create the parent folder, move the service/errors into it, put
`IDEMPOTENCY_KEY_PATTERN` in the constants file, and put these exact shapes in
the types file:

```ts
import type { Payment } from '../../domain/payment/payment';

export interface IdempotentPaymentCreationResult {
  payment: Payment;
  replayed: boolean;
}

export interface InFlightCreation {
  fingerprint: string;
  promise: Promise<IdempotentPaymentCreationResult>;
}
```

Update application-error mapping, controllers, the payments module, and tests to
use the new direct paths.

- [ ] **Step 3: Consolidate repository contracts**

Put both DI tokens in `payment-repository.constants.ts`. Put payment transition,
payment repository, idempotency record, and idempotency repository interfaces in
`payment-repository.types.ts`. Update in-memory implementations, health,
services, the payments module, and tests. Remove the two obsolete repository
contract files only after `rg` finds no imports.

- [ ] **Step 4: Verify idempotency and persistence**

Run:

```bash
bun run format:check
bun run lint
bun run typecheck
bun run test -- idempotency repository payments.module payments.service
bun run test:e2e -- payments
git diff --check
```

Expected: every command passes.

- [ ] **Step 5: Commit the grouped application/repository refactor**

```bash
git add src/payments/application src/payments/repositories src/payments/payments.module.ts src/common/filters test
git commit -m "refactor(payments): group idempotency and repository contracts"
```

---

### Task 4: Separate payment API and processing definitions

**Files:**

- Create: `src/payments/api/payment-api.constants.ts`
- Create: `src/payments/api/payment-api.types.ts`
- Create: `src/payments/api/dto/payment-dto.constants.ts`
- Create: `src/payments/processing/payment-processing.constants.ts`
- Create: `src/payments/processing/payment-processing.types.ts`
- Delete: `src/payments/processing/payment-outcome-resolver.ts`
- Delete: `src/payments/processing/processing-scheduler.ts`
- Modify: payment controller, DTOs, processor, scheduler/resolver implementations, module, and tests

**Interfaces:**

- Produces: controller response types, `PAYMENT_TRANSITION_TARGETS`, `PaymentTransitionTarget`, and Swagger header constants; processing DI tokens; `ScheduledProcessingTask`, `ProcessingScheduler`, `TerminalPaymentStatus`, `PaymentOutcomeInput`, `PaymentOutcomeResolver`, `ProcessingPhase`, `ProcessingContext`, and `PaymentCreationAdmission`.
- Preserves: Swagger schemas/headers, processing admission, deterministic outcomes, timers, shutdown draining, and controller responses.

- [ ] **Step 1: Record the green API/processing baseline**

Run:

```bash
bun run test -- payment-processor timeout-processing deterministic-payment-outcome
bun run test:e2e -- payments processing
```

Expected: all selected suites pass.

- [ ] **Step 2: Extract payment API definitions**

Move `PaymentDataResponse` to `payment-api.types.ts`. Move creation-specific
Swagger headers to `payment-api.constants.ts`, importing the shared request-ID
headers from `common/openapi/openapi.constants.ts`. Define the DTO-facing tuple
in `dto/payment-dto.constants.ts`:

```ts
import { PAYMENT_STATUS } from '../../domain/payment/payment.constants';

export const PAYMENT_TRANSITION_TARGETS = [
  PAYMENT_STATUS.PROCESSING,
  PAYMENT_STATUS.SUCCEEDED,
  PAYMENT_STATUS.FAILED,
] as const;
```

Infer `PaymentTransitionTarget` from this tuple in `payment-api.types.ts`. DTO
classes remain in `api/dto/`.

- [ ] **Step 3: Consolidate processing definitions**

Put `PROCESSING_SCHEDULER` and `PAYMENT_OUTCOME_RESOLVER` in
`payment-processing.constants.ts`. Put all scheduler, resolver, processor
context, phase, and admission types in `payment-processing.types.ts`, including:

```ts
export type TerminalPaymentStatus =
  | typeof PAYMENT_STATUS.SUCCEEDED
  | typeof PAYMENT_STATUS.FAILED;
```

Update the processor, deterministic resolver, timeout scheduler, payments
module, and tests. Remove the old mixed token/interface files.

- [ ] **Step 4: Verify API, processing, and Swagger**

Run:

```bash
bun run format:check
bun run lint
bun run typecheck
bun run test -- payment-processor timeout-processing deterministic-payment-outcome
bun run test:e2e -- payments processing health
git diff --check
```

Expected: every command passes; Swagger assertions still expose the same enums,
schemas, paths, response headers, and response envelopes.

- [ ] **Step 5: Commit the API/processing refactor**

```bash
git add src/payments/api src/payments/processing src/payments/payments.module.ts test
git commit -m "refactor(payments): separate API and processing definitions"
```

---

### Task 5: Enforce the architecture and finish root/startup separation

**Files:**

- Create: `src/app.types.ts`
- Create: `src/startup/startup.types.ts`
- Create: `src/startup/startup.constants.ts`
- Modify: `src/app.service.ts`
- Modify: `src/app.controller.ts`
- Modify: `src/startup/startup-log.ts`
- Create: `test/unit/architecture/source-structure.spec.ts`

**Interfaces:**

- Produces: `ServiceInfo`, `StartupApplication`, `StartupLogContext`, `STARTUP_EVENT`, `STARTUP_LOG_MESSAGE`, and a regression test enforcing the approved production structure.
- Preserves: service-info response and bind-then-log startup ordering.

- [ ] **Step 1: Write the failing architecture test**

Create a Jest test that recursively reads `src/**/*.ts` with the TypeScript
compiler API. For every top-level statement:

```ts
if (ts.isEnumDeclaration(statement)) {
  violations.push(`${relativePath}: enum ${statement.name.text}`);
}

if (
  (ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement)) &&
  !relativePath.endsWith('.types.ts')
) {
  violations.push(`${relativePath}: type declaration outside *.types.ts`);
}
```

Also inspect `const` variable declarations whose identifiers match
`/^[A-Z][A-Z0-9_]+$/`. If the initializer is static data rather than an arrow or
function expression, require the file to end in `.constants.ts`. Assert that no
path segment equals `types`, `interfaces`, or `constants`, and assert each
`*.types.ts`/`*.constants.ts` file has at most 250 lines.

- [ ] **Step 2: Run the architecture test and verify RED**

Run:

```bash
bun run test -- source-structure
```

Expected: FAIL because `ServiceInfo`, `StartupApplication`, and
`StartupLogContext` still live in behavior files.

- [ ] **Step 3: Extract the remaining root/startup definitions**

Create `app.types.ts`:

```ts
export interface ServiceInfo {
  name: string;
  status: 'ok';
}
```

Move the two startup interfaces into `startup.types.ts`. Define the event and
message in `startup.constants.ts`:

```ts
export const STARTUP_EVENT = 'service.started' as const;
export const STARTUP_LOG_MESSAGE = 'Payment service listening';
```

Update direct imports and keep startup ordering unchanged.

- [ ] **Step 4: Verify the architecture test is GREEN**

Run:

```bash
bun run test -- source-structure startup-log app.controller
bun run format:check
bun run lint
bun run typecheck
git diff --check
```

Expected: every command passes; no structure violations remain.

- [ ] **Step 5: Commit architecture enforcement**

```bash
git add src/app.types.ts src/app.service.ts src/app.controller.ts src/startup test/unit/architecture/source-structure.spec.ts
git commit -m "test(architecture): enforce production definition separation"
```

---

### Task 6: Document and fully verify the refactor

**Files:**

- Modify: `README.md`

**Interfaces:**

- Consumes: the final concern-owned source tree.
- Produces: a concise source-organization section documenting the folder and naming convention.

- [ ] **Step 1: Update the README structure guidance**

Document these rules with examples:

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

State that DTOs remain under `payments/api/dto/`, TypeScript enums are not used,
and generic definition-category folders are avoided below the 250-line
threshold.

- [ ] **Step 2: Run all static and clean-install gates**

Run:

```bash
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun run build
git diff --check
```

Expected: every command exits `0` and the lockfile does not change.

- [ ] **Step 3: Run all automated test gates**

Run:

```bash
bun run test
bun run test:e2e
bun run test:e2e -- --runInBand --detectOpenHandles
bun run test:cov
```

Expected: all suites pass, no open handles are reported, and coverage remains
above 85% statements/lines/functions and 80% branches.

- [ ] **Step 4: Verify structural and repository hygiene**

Run:

```bash
rg -n "\benum\b" src --glob '*.ts'
find src -type d \( -name types -o -name interfaces -o -name constants \)
git status --short --branch
git diff --check
```

Expected: both structure searches produce no output, only the intended README
change is pending, and diff checking succeeds. Move generated coverage output
out of the repository after confirming it is ignored.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md
git commit -m "docs(readme): document definition boundaries"
```

- [ ] **Step 6: Confirm final branch state**

Run:

```bash
git status --short --branch
git log --oneline --decorate -8
```

Expected: the branch is clean and the refactor commits are present. Do not push
or merge without explicit user approval.
