# Versioned API Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put every public route beneath `/api/v1`, standardize controller and
error envelopes, make `4040` the default port, report the effective API URL at
startup, and add runnable request files beside every controller.

**Architecture:** Keep Nest's global prefix and URI versioning as the routing
source of truth. Controllers explicitly wrap successful data with a shared
`status: "success"` envelope, while the global exception filter adds
`status: "error"`; payment and health state remain inside `data`. Swagger,
startup logging, documentation, and controller-adjacent `.rest` files consume
the same route and port constants where executable code needs them.

**Tech Stack:** Bun 1.3.8, NestJS 11 with Express, TypeScript, Zod,
nestjs-pino/Pino, Swagger, Jest, and Supertest.

**Spec:**
`docs/superpowers/specs/2026-08-27-api-contract-rest-client-design.md`

## Global Constraints

- The committed default port is `4040`.
- Every public route, including health and Swagger, begins with `/api/v1`.
- Successful controller JSON uses top-level `status: "success"` and `data`.
- Payment lifecycle and health state remain as `data.status`.
- Every error envelope uses top-level `status: "error"` and preserves existing
  fields and safe-message behavior.
- Old health, Swagger, and Swagger JSON routes return `404`; no aliases remain.
- Health routes stay exempt from both throttling policies.
- The startup event is emitted only after the server binds successfully.
- The user's existing `src/config/environment.ts` port edit is authorized and
  must be preserved.
- No new dependency is required.
- Use Bun for every project command.
- Keep commits atomic and use Conventional Commit messages.

---

### Task 1: Commit port 4040 as the coherent default

**Files:**

- Modify: `src/config/environment.ts`
- Modify: `test/unit/runtime-config.module.spec.ts`
- Modify: `.env.example`
- Modify: `README.md`

**Interfaces:**

- Consumes: `validateEnvironment(config): Environment`.
- Produces: a default `Environment.PORT` value of `4040` while preserving
  explicit valid `PORT` overrides.

- [ ] **Step 1: Reproduce the existing mismatch**

Run:

```bash
bun run test -- runtime-config
```

Expected: FAIL because the authorized environment-schema edit returns `4040`
while the existing test still expects `3000`.

- [ ] **Step 2: Update the default-port contract**

Change the literal expectation and add an override assertion:

```ts
expect(validateEnvironment({})).toMatchObject({
  PORT: 4040,
});

expect(validateEnvironment({ PORT: '5050' })).toMatchObject({
  PORT: 5050,
});
```

Set `.env.example` to:

```dotenv
PORT=4040
```

Change every default-origin example and the configuration table in `README.md`
from `http://localhost:3000`/`3000` to `http://localhost:4040`/`4040`. Do not
change route paths in this task.

- [ ] **Step 3: Verify the port task**

Run:

```bash
bun run test -- runtime-config
bun run format:check
bun run lint
bun run typecheck
git diff --check
```

Expected: the focused suite and every static gate pass.

- [ ] **Step 4: Commit only the port-default files**

```bash
git add src/config/environment.ts test/unit/runtime-config.module.spec.ts .env.example README.md
git commit -m "feat(config): use port 4040 by default"
```

---

### Task 2: Version every public route

**Files:**

- Create: `src/api.constants.ts`
- Modify: `src/app.setup.ts`
- Modify: `src/health/health.controller.ts`
- Modify: `src/openapi/swagger.ts`
- Modify: `test/app.e2e-spec.ts`
- Modify: `test/health.e2e-spec.ts`
- Modify: `test/payments.e2e-spec.ts`
- Modify: `test/rate-limit.e2e-spec.ts`

**Interfaces:**

- Produces: `API_PREFIX = 'api'`, `API_VERSION = '1'`,
  `API_VERSION_PATH = 'v1'`, `API_BASE_PATH = 'api/v1'`.
- Produces: Swagger UI `/api/v1/docs` and JSON `/api/v1/docs-json`.
- Preserves: the health controller's skip metadata for both named throttlers.

- [ ] **Step 1: Write failing route-contract tests**

Update health E2E success requests to:

```ts
await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);

await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
```

Replace the old versioned-health rejection test with:

```ts
it.each(['/health/live', '/health/ready'])('%s is not exposed', (path) =>
  request(app.getHttpServer()).get(path).expect(404),
);
```

Update Swagger requests in all E2E files to
`/api/v1/docs-json`. Add assertions that `/docs`, `/docs-json`,
`/health/live`, and `/health/ready` return `404`.

- [ ] **Step 2: Run the route tests and verify RED**

Run:

```bash
bun run test:e2e -- health payments rate-limit app
```

Expected: FAIL with `404` for new health/Swagger routes and mismatched old-route
expectations.

- [ ] **Step 3: Add shared route constants**

Create `src/api.constants.ts`:

```ts
export const API_PREFIX = 'api';
export const API_VERSION = '1';
export const API_VERSION_PATH = `v${API_VERSION}`;
export const API_BASE_PATH = `${API_PREFIX}/${API_VERSION_PATH}`;
```

- [ ] **Step 4: Apply prefix and version uniformly**

In `src/app.setup.ts`, remove `RequestMethod` and the health exclusions:

```ts
app.setGlobalPrefix(API_PREFIX);
app.enableVersioning({
  type: VersioningType.URI,
  defaultVersion: API_VERSION,
});
```

In `src/health/health.controller.ts`, remove `VERSION_NEUTRAL` and use:

```ts
@Controller('health')
@SkipThrottle({ default: true, 'payment-create': true })
export class HealthController {}
```

Configure Swagger with the shared base path:

```ts
SwaggerModule.setup(`${API_BASE_PATH}/docs`, app, document, {
  jsonDocumentUrl: `${API_BASE_PATH}/docs-json`,
  raw: ['json'],
});
```

- [ ] **Step 5: Verify GREEN and regression behavior**

Run:

```bash
bun run test:e2e -- health payments rate-limit app
bun run test -- health throttler
bun run lint
bun run typecheck
bun run build
git diff --check
```

Expected: all commands pass; health remains exempt from rate limiting; only the
new documentation and health paths are exposed.

- [ ] **Step 6: Commit the route contract**

```bash
git add src/api.constants.ts src/app.setup.ts src/health/health.controller.ts src/openapi/swagger.ts test/app.e2e-spec.ts test/health.e2e-spec.ts test/payments.e2e-spec.ts test/rate-limit.e2e-spec.ts
git commit -m "feat(api): version all public routes"
```

---

### Task 3: Standardize success and error envelopes

**Files:**

- Create: `src/common/http/api-response.ts`
- Create: `src/app-response.dto.ts`
- Modify: `src/app.controller.ts`
- Modify: `src/health/health.controller.ts`
- Modify: `src/health/health.service.ts`
- Modify: `src/health/dto/health-response.dto.ts`
- Modify: `src/payments/api/payments.controller.ts`
- Modify: `src/payments/api/dto/payment-response.dto.ts`
- Modify: `src/common/filters/global-exception.filter.ts`
- Modify: `src/common/openapi/error-response.dto.ts`
- Modify: `test/unit/app.controller.spec.ts`
- Modify: `test/unit/health/health.service.spec.ts`
- Modify: `test/unit/global-exception.filter.spec.ts`
- Modify: `test/app.e2e-spec.ts`
- Modify: `test/errors.e2e-spec.ts`
- Modify: `test/health.e2e-spec.ts`
- Modify: `test/payments.e2e-spec.ts`
- Modify: `test/processing.e2e-spec.ts`
- Modify: `test/rate-limit.e2e-spec.ts`

**Interfaces:**

- Produces: `ApiSuccessResponse<T> = { status: 'success'; data: T }`.
- Produces: `successResponse<T>(data: T): ApiSuccessResponse<T>`.
- Extends: every exception-filter envelope with `status: 'error'`.
- Preserves: `Payment.status` and health `data.status` as domain/operational
  states.

- [ ] **Step 1: Write failing success-envelope tests**

Change the application E2E expectation to:

```ts
expect(response.body).toEqual({
  status: 'success',
  data: {
    name: 'node-payment-microservice',
    status: 'ok',
  },
});
```

Change liveness to:

```ts
expect(response.body).toEqual({
  status: 'success',
  data: { status: 'live' },
});
```

Add `status: 'success'` to payment response expectations while retaining:

```ts
expect(response.body.data.status).toBe('pending');
```

- [ ] **Step 2: Write failing error-envelope tests**

In the global exception-filter unit suite and each E2E error helper, require:

```ts
expect(body).toMatchObject({
  status: 'error',
  statusCode: expectedStatusCode,
  code: expectedCode,
});
```

Update exact `400`, `404`, `409`, `429`, `500`, and `503` body fixtures with
`status: 'error'`.

- [ ] **Step 3: Run envelope tests and verify RED**

Run:

```bash
bun run test -- app.controller health.service global-exception
bun run test:e2e -- app errors health payments processing rate-limit
```

Expected: FAIL because top-level success/error statuses are absent.

- [ ] **Step 4: Add the shared success envelope**

Create `src/common/http/api-response.ts`:

```ts
export const API_SUCCESS_STATUS = 'success' as const;
export const API_ERROR_STATUS = 'error' as const;

export interface ApiSuccessResponse<T> {
  status: typeof API_SUCCESS_STATUS;
  data: T;
}

export function successResponse<T>(data: T): ApiSuccessResponse<T> {
  return { status: API_SUCCESS_STATUS, data };
}
```

Wrap service results explicitly in all three controllers. For example:

```ts
async findById(id: string): Promise<ApiSuccessResponse<Payment>> {
  return successResponse(await this.paymentsService.findById(id));
}
```

Change `HealthService.readiness()` to return readiness data rather than an HTTP
envelope, and let `HealthController` call `successResponse(data)`.

- [ ] **Step 5: Add error status in one filter boundary**

Extend the internal error type and final envelope:

```ts
interface ErrorEnvelope {
  status: typeof API_ERROR_STATUS;
  statusCode: number;
  code: string;
  message: string;
  requestId: string;
  timestamp: string;
  path: string;
  details?: unknown;
}

const envelope: ErrorEnvelope = {
  status: API_ERROR_STATUS,
  statusCode,
  ...error,
  requestId,
  timestamp: new Date().toISOString(),
  path: request.originalUrl,
};
```

Add matching `@ApiProperty({ enum: ['success'] })` or
`@ApiProperty({ enum: ['error'] })` fields to payment, health, readiness-error,
and shared error Swagger DTOs. Create `AppResponseDto` with this contract and add
it to an `@ApiOkResponse` on `AppController`:

```ts
export class ServiceInfoDto {
  @ApiProperty({ example: 'node-payment-microservice' })
  name!: string;

  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status!: 'ok';
}

export class AppResponseDto {
  @ApiProperty({ enum: ['success'], example: 'success' })
  status!: 'success';

  @ApiProperty({ type: ServiceInfoDto })
  data!: ServiceInfoDto;
}
```

- [ ] **Step 6: Verify GREEN and OpenAPI schemas**

Run:

```bash
bun run test -- app.controller health.service global-exception
bun run test:e2e -- app errors health payments processing rate-limit
bun run lint
bun run typecheck
bun run build
git diff --check
```

Expected: all commands pass; Swagger schemas expose the outer success/error
status while payment and health schemas retain their inner `data.status`.

- [ ] **Step 7: Commit the envelope contract**

```bash
git add src/common/http/api-response.ts src/app-response.dto.ts src/app.controller.ts src/health/health.controller.ts src/health/health.service.ts src/health/dto/health-response.dto.ts src/payments/api/payments.controller.ts src/payments/api/dto/payment-response.dto.ts src/common/filters/global-exception.filter.ts src/common/openapi/error-response.dto.ts test/unit/app.controller.spec.ts test/unit/health/health.service.spec.ts test/unit/global-exception.filter.spec.ts test/app.e2e-spec.ts test/errors.e2e-spec.ts test/health.e2e-spec.ts test/payments.e2e-spec.ts test/processing.e2e-spec.ts test/rate-limit.e2e-spec.ts
git commit -m "feat(api): standardize response envelopes"
```

---

### Task 4: Report the effective API URL after startup

**Files:**

- Create: `src/startup/startup-log.ts`
- Create: `test/unit/startup/startup-log.spec.ts`
- Modify: `src/main.ts`

**Interfaces:**

- Consumes: `API_BASE_PATH` from `src/api.constants.ts`.
- Produces:
  `createStartupLogContext(port: number): { event: 'service.started'; port: number; apiUrl: string }`.

- [ ] **Step 1: Write the failing startup-context test**

Create `test/unit/startup/startup-log.spec.ts`:

```ts
import { createStartupLogContext } from '../../../src/startup/startup-log';

describe('createStartupLogContext', () => {
  it('reports the effective port and versioned API URL', () => {
    expect(createStartupLogContext(4040)).toEqual({
      event: 'service.started',
      port: 4040,
      apiUrl: 'http://localhost:4040/api/v1',
    });
  });

  it('uses an explicit port override in the URL', () => {
    expect(createStartupLogContext(5050).apiUrl).toBe(
      'http://localhost:5050/api/v1',
    );
  });
});
```

- [ ] **Step 2: Run the startup test and verify RED**

Run:

```bash
bun run test -- startup-log
```

Expected: FAIL because `src/startup/startup-log.ts` does not exist.

- [ ] **Step 3: Implement the startup context and post-bind log**

Create:

```ts
import { API_BASE_PATH } from '../api.constants';

export interface StartupLogContext {
  event: 'service.started';
  port: number;
  apiUrl: string;
}

export function createStartupLogContext(port: number): StartupLogContext {
  return {
    event: 'service.started',
    port,
    apiUrl: `http://localhost:${port}/${API_BASE_PATH}`,
  };
}
```

In `main.ts`, obtain the configured port once and log only after binding:

```ts
const port = config.getOrThrow<number>('PORT');
const pinoLogger = app.get(PinoLogger);

await app.listen(port);
pinoLogger.info(createStartupLogContext(port), 'Payment service listening');
```

Continue using the existing Nest `Logger` adapter for framework logging.

- [ ] **Step 4: Verify the startup change**

Run:

```bash
bun run test -- startup-log logger
bun run lint
bun run typecheck
bun run build
git diff --check
```

Expected: all commands pass.

- [ ] **Step 5: Commit startup observability**

```bash
git add src/startup/startup-log.ts test/unit/startup/startup-log.spec.ts src/main.ts
git commit -m "feat(observability): log effective API endpoint"
```

---

### Task 5: Add controller-adjacent REST requests and update documentation

**Files:**

- Create: `src/app.controller.rest`
- Create: `src/health/health.controller.rest`
- Create: `src/payments/api/payments.controller.rest`
- Modify: `README.md`

**Interfaces:**

- Consumes: default origin `http://localhost:4040`, versioned routes, and the
  success/error response contract.
- Produces: editor-runnable HTTP requests colocated with each controller.

- [ ] **Step 1: Add the application request file**

Create `src/app.controller.rest`:

```http
@baseUrl = http://localhost:4040

### Get service information
# @name getServiceInfo
# Expected: 200 with status = "success" and data.status = "ok"
GET {{baseUrl}}/api/v1
X-Request-Id: rest-app-service-info
```

- [ ] **Step 2: Add the health request file**

Create `src/health/health.controller.rest`:

```http
@baseUrl = http://localhost:4040

### Check process liveness
# @name getLiveness
# Expected: 200 with status = "success" and data.status = "live"
GET {{baseUrl}}/api/v1/health/live
X-Request-Id: rest-health-live

### Check payment-work readiness
# @name getReadiness
# Expected: 200 with status = "success" and data.status = "ready"
GET {{baseUrl}}/api/v1/health/ready
X-Request-Id: rest-health-ready
```

Each request includes a valid `X-Request-Id` and comments distinguishing the
top-level success status from `data.status`.

- [ ] **Step 3: Add the payment request file**

Create `src/payments/api/payments.controller.rest` with the following executable
contract:

```http
@baseUrl = http://localhost:4040
@idempotencyKey = rest-order-0001

### Create a payment
# @name createPayment
# Expected: 201 with status = "success" and data.status = "pending"
POST {{baseUrl}}/api/v1/payments
Content-Type: application/json
Idempotency-Key: {{idempotencyKey}}
X-Request-Id: rest-payment-create

{
  "smallestUnitAmount": 1050,
  "currency": "USD",
  "merchantReference": "rest-order-0001",
  "description": "Controller REST request"
}

### Replay the original creation
# @name replayPaymentCreation
# Expected: 201 with Idempotency-Replayed: true
POST {{baseUrl}}/api/v1/payments
Content-Type: application/json
Idempotency-Key: {{idempotencyKey}}
X-Request-Id: rest-payment-replay

{
  "smallestUnitAmount": 1050,
  "currency": "USD",
  "merchantReference": "rest-order-0001",
  "description": "Controller REST request"
}

### Reject conflicting idempotency-key reuse
# @name rejectIdempotencyConflict
# Expected: 409 with status = "error" and code = "IDEMPOTENCY_CONFLICT"
POST {{baseUrl}}/api/v1/payments
Content-Type: application/json
Idempotency-Key: {{idempotencyKey}}
X-Request-Id: rest-payment-conflict

{
  "smallestUnitAmount": 1051,
  "currency": "USD",
  "merchantReference": "rest-order-0001",
  "description": "Controller REST request"
}

### Retrieve the created payment
# @name getPayment
# Expected: 200 with status = "success"
GET {{baseUrl}}/api/v1/payments/{{createPayment.response.body.$.data.id}}
X-Request-Id: rest-payment-get

### Transition the payment to succeeded
# @name transitionPayment
# Start with PROCESSING_DELAY_MS=60000 and run createPayment first.
# Expected: 200 with data.status = "succeeded" when the payment is currently
# "processing"; otherwise the processor may win with 409.
PATCH {{baseUrl}}/api/v1/payments/{{createPayment.response.body.$.data.id}}/status
Content-Type: application/json
X-Request-Id: rest-payment-transition

{
  "status": "succeeded"
}

### Reject creation without an idempotency key
# @name rejectMissingIdempotencyKey
# Expected: 400 with status = "error" and code = "INVALID_IDEMPOTENCY_KEY"
POST {{baseUrl}}/api/v1/payments
Content-Type: application/json
X-Request-Id: rest-payment-missing-key

{
  "smallestUnitAmount": 1050,
  "currency": "USD",
  "merchantReference": "rest-order-missing-key"
}

### Reject an invalid payment payload
# @name rejectInvalidPayment
# Expected: 400 with status = "error" and validation details
POST {{baseUrl}}/api/v1/payments
Content-Type: application/json
Idempotency-Key: rest-invalid-payment-0001
X-Request-Id: rest-payment-invalid

{
  "smallestUnitAmount": 10.5,
  "currency": "EUR",
  "merchantReference": ""
}

### Reject a malformed payment UUID
# @name rejectMalformedPaymentId
# Expected: 400 with status = "error"
GET {{baseUrl}}/api/v1/payments/not-a-uuid
X-Request-Id: rest-payment-malformed-id

### Return not found for an unknown payment UUID
# @name getUnknownPayment
# Expected: 404 with status = "error" and code = "PAYMENT_NOT_FOUND"
GET {{baseUrl}}/api/v1/payments/00000000-0000-4000-8000-000000000000
X-Request-Id: rest-payment-not-found
```

- [ ] **Step 4: Update README contract and usage**

Update every route and example to `/api/v1`, including health and Swagger. Add a
response-envelope section that explains:

```json
{
  "status": "success",
  "data": {
    "status": "pending"
  }
}
```

and:

```json
{
  "status": "error",
  "statusCode": 409,
  "code": "IDEMPOTENCY_CONFLICT"
}
```

Add a “Controller request files” section linking each `.rest` file and explaining
that `createPayment` must be executed before requests that consume its response.
Document the startup event and port `4040`.

- [ ] **Step 5: Verify request-file syntax and documentation consistency**

Run:

```bash
bun x prettier --check README.md
git diff --check
rg -n 'localhost:3000|http://localhost:4040/(health|docs)' README.md src --glob '*.rest'
```

Expected: Prettier and diff checks pass; the final search exits `1` with no stale
route or port matches.

- [ ] **Step 6: Commit the developer request artifacts**

```bash
git add src/app.controller.rest src/health/health.controller.rest src/payments/api/payments.controller.rest README.md
git commit -m "docs(api): add controller REST requests"
```

---

### Task 6: Run final verification and record the revised checkpoint

**Files:**

- Modify: `CHECKPOINTS.md`

**Interfaces:**

- Consumes: every implementation and documentation commit from Tasks 1-5.
- Produces: reproducible Checkpoint 10 evidence and status
  `Awaiting user verification`.

- [ ] **Step 1: Run all clean-install and static gates**

```bash
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun run build
git diff --check
```

Expected: every command exits `0`; the lockfile does not change.

- [ ] **Step 2: Run every automated test gate**

```bash
bun run test
bun run test:e2e
bun run test:e2e -- --runInBand --detectOpenHandles
bun run test:cov
```

Expected: unit and E2E suites pass without open handles, coverage exceeds 85%
statements/lines/functions and 80% branches, and text/LCOV/HTML reports are
generated as ignored artifacts.

- [ ] **Step 3: Verify the live default-port contract**

Start the compiled service with no `PORT` override:

```bash
LOG_LEVEL=info bun run start:prod
```

Verify the terminal emits a `service.started` event with port `4040` and
`http://localhost:4040/api/v1`. Exercise:

```bash
curl -i http://localhost:4040/api/v1
curl -i http://localhost:4040/api/v1/health/live
curl -i http://localhost:4040/api/v1/health/ready
curl -i http://localhost:4040/api/v1/docs-json
```

Expected: each new route returns `200`, outer statuses are `success` where the
response is a controller envelope, and the OpenAPI document parses as 3.0.0.

Verify old routes:

```bash
curl -i http://localhost:4040/health/live
curl -i http://localhost:4040/docs-json
```

Expected: both return `404` with top-level `status: "error"`. Stop the service
and confirm port `4040` has no verification listener. If a user-owned process is
already using `4040`, do not terminate it; use a temporary explicit port for the
runtime check and separately validate the `4040` startup context through tests.

- [ ] **Step 4: Verify repository hygiene**

```bash
git status --short --branch
git remote -v
git diff --check
```

Confirm no secrets, generated coverage output, compiled output, machine-specific
workspace path, or account binding is tracked.

- [ ] **Step 5: Record the final evidence**

Update `CHECKPOINTS.md` with exact suite counts, coverage percentages, runtime
responses, OpenAPI results, commit hashes, and cleanup confirmation. Keep
Checkpoint 10 at `Awaiting user verification` until the user approves it.

- [ ] **Step 6: Commit checkpoint evidence**

```bash
git add CHECKPOINTS.md
git commit -m "docs(checkpoints): record revised API verification"
```
