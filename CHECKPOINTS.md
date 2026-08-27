# Node.js Payment Microservice — Sequential Checkpoints

This checklist governs the implementation of the NestJS payment-processing assessment.

## Working agreement

- Work proceeds one checkpoint at a time.
- After completing a checkpoint, Codex stops and provides the evidence and verification commands.
- The user verifies the result and explicitly approves moving to the next checkpoint.
- A checkpoint is not marked complete until its acceptance criteria and verification commands pass.
- Each commit must contain one coherent, independently reviewable change and its relevant tests.
- Git history must remain buildable; failing tests are not committed as standalone checkpoints.
- Publishing to GitHub is reserved for Checkpoint 11 and requires explicit approval.

## Locked technical direction

- Runtime and package manager: Bun 1.3.8
- Framework: NestJS with its Express adapter
- Language: TypeScript
- API documentation: Swagger UI and OpenAPI JSON
- Configuration validation: Zod
- Logging: structured Pino logging with correlation IDs and redaction
- Tests: Jest and Supertest, executed through Bun
- Persistence: in-memory repositories behind explicit interfaces
- Required operational features: rate limiting, liveness/readiness, graceful shutdown, Docker, and CI

## Git workflow

### Branch convention

- Stable branch: `main`
- Working branch: `codex/feat/payment-microservice`
- General format: `codex/<type>/<short-kebab-case-description>`
- Allowed branch types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `ci`, and `build`
- All implementation commits are created on the working branch. `main` is not modified directly.

### Commit convention

Use Conventional Commit messages with this structure:

```text
<type>(<scope>): <imperative summary>
```

Examples:

```text
feat(idempotency): prevent duplicate payment creation
fix(processing): persist failed asynchronous outcomes
test(payments): cover invalid status transitions
docs(readme): document local payment processing flow
build(docker): add multi-stage Bun runtime image
ci(github): verify the service with Bun
```

Rules:

- Allowed commit types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `build`, `ci`, and `perf`.
- Use a focused lowercase scope when it adds meaning.
- Write the summary in the imperative mood, without a trailing period.
- Keep the summary concise and no longer than 72 characters.
- Explain the reason and important trade-offs in the body when the summary is insufficient.
- Use `BREAKING CHANGE:` in the footer only for an intentional incompatible change.
- Never mix unrelated implementation, formatting, documentation, or dependency updates.
- Review the staged diff and run the checkpoint's relevant verification before committing.
- Never commit secrets, `.env`, `node_modules`, `dist`, coverage output, logs, or editor files.

### Planned atomic commit map

| Checkpoint | Planned commit messages                                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1          | `chore(repo): initialize Bun payment service workspace`                                                                                                         |
| 2          | `chore(scaffold): create NestJS Express application`                                                                                                            |
| 3          | `feat(config): validate runtime configuration with Zod`; `feat(observability): add structured request logging`; `feat(errors): standardize API error responses` |
| 4          | `feat(payments): add payment domain and in-memory repository`                                                                                                   |
| 5          | `feat(api): expose versioned payment endpoints`; `docs(swagger): document the payment API`                                                                      |
| 6          | `feat(idempotency): make payment creation replay-safe`                                                                                                          |
| 7          | `feat(processing): simulate deterministic async outcomes`                                                                                                       |
| 8          | `feat(rate-limit): protect payment endpoints`; `feat(health): add readiness and liveness probes`                                                                |
| 9          | `test(e2e): cover payment service flows`; `test(coverage): enforce coverage thresholds`                                                                         |
| 10         | `build(docker): add multi-stage Bun image`; `ci(github): verify the service with Bun`; `docs(readme): document setup and architecture`                          |
| 11         | No commit unless final verification requires a tracked correction; remote configuration itself is repository-local metadata.                                    |

The exact number of commits may change when a checkpoint contains more than one independently reviewable change, but the atomicity rules do not change.

## Progress summary

| Checkpoint | Description                                               | Status                     |
| ---------- | --------------------------------------------------------- | -------------------------- |
| 1          | Desktop workspace, Git, Bun, and `aweds-personal` binding | Completed                  |
| 2          | NestJS/Express scaffold and project boundaries            | Completed                  |
| 3          | Configuration, logging, validation, errors, and shutdown  | Completed                  |
| 4          | Payment domain, state machine, and persistence            | Completed                  |
| 5          | REST API and complete Swagger documentation               | Completed                  |
| 6          | Concurrency-safe idempotency                              | Completed                  |
| 7          | Asynchronous deterministic payment processing             | Completed                  |
| 8          | Rate limiting and health endpoints                        | Completed                  |
| 9          | Jest unit/e2e tests and coverage enforcement              | Awaiting user verification |
| 10         | Docker, CI, README, and final local verification          | Not started                |
| 11         | GitHub remote verification and approved publication       | Not started                |

---

## Checkpoint 1 — Workspace and repository identity

### Work

- Use `/Users/abdulafeezpifapp/Desktop/node-payment-microservice` as the project root.
- Initialize a Git repository with `main` as the initial branch.
- Create and switch to `codex/feat/payment-microservice` before implementation.
- Configure the repository locally to use Bun 1.3.8.
- Bind Git SSH operations to `/Users/abdulafeezpifapp/.dss/spaces/aweds-personal/id_rsa` through repository-local Git configuration.
- Confirm the public-key fingerprint without exposing private-key material.
- Do not create or push a GitHub repository yet.

### Acceptance criteria

- The project directory exists on the Desktop.
- `main` exists as the untouched stable branch.
- The active implementation branch is `codex/feat/payment-microservice`.
- `git config --local core.sshCommand` resolves to the `aweds-personal` key.
- `bun --version` returns `1.3.8`.
- No remote repository or external side effect has been created.

### Verification

```bash
pwd
git status --short --branch
git branch --show-current
git config --local --get core.sshCommand
bun --version
git remote -v
git log --oneline --decorate -5
```

---

## Checkpoint 2 — NestJS/Express foundation

### Work

- Scaffold a NestJS TypeScript application using Bun.
- Retain NestJS's default Express adapter.
- Pin `packageManager` to Bun 1.3.8 and commit `bun.lock`.
- Establish focused `payments`, `health`, `config`, and `common` boundaries.
- Add formatting, linting, type-checking, build, development, and test scripts.

### Acceptance criteria

- Dependencies install with `bun install --frozen-lockfile`.
- The application compiles and starts using Bun.
- `GET /` or a temporary bootstrap route responds successfully.
- Lint and type-check scripts exist and pass.
- No business logic is implemented prematurely.

### Verification

```bash
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run test:e2e
bun run build
```

---

## Checkpoint 3 — Configuration, logging, validation, and errors

### Work

- Add `@nestjs/config` with synchronous Zod environment validation.
- Configure the global API prefix and URI versioning.
- Add global DTO validation with transformation, whitelisting, and rejection of unknown properties.
- Add Pino structured request/application logging.
- Generate or propagate correlation IDs.
- Redact sensitive headers and fields.
- Add a global exception filter with a consistent error envelope.
- Add Helmet and enable graceful shutdown hooks.

### Acceptance criteria

- Missing or invalid required configuration prevents startup with a clear message.
- Every response carries a correlation/request ID.
- Expected and unexpected errors use the documented response shape.
- Unexpected errors log stack traces but return a safe client message.
- Logs are structured JSON outside local pretty-print mode.

### Verification

```bash
bun run lint
bun run typecheck
bun run build
bun run test
```

---

## Checkpoint 4 — Payment domain and persistence

### Work

- Define the payment entity, currency/amount rules, timestamps, and status enum.
- Store money as integer minor units.
- Implement the state machine: `pending -> processing -> succeeded | failed`.
- Reject invalid and terminal-state transitions.
- Define a repository interface and an injectable in-memory implementation.
- Use `crypto.randomUUID()` for payment identifiers.

### Acceptance criteria

- Domain rules do not depend on controllers or HTTP types.
- Repository consumers depend on an injection token/interface rather than the concrete implementation.
- State-transition tests cover allowed, invalid, and terminal transitions.
- Domain and repository unit tests pass.

### Verification

```bash
bun run test -- payments
bun run lint
bun run typecheck
```

---

## Checkpoint 5 — Payment REST API and Swagger

### Work

- Implement `POST /api/v1/payments`.
- Implement `GET /api/v1/payments/:id`.
- Implement `PATCH /api/v1/payments/:id/status` with explicit transition rules.
- Expose Swagger UI at `/docs`.
- Expose OpenAPI JSON at `/docs-json`.
- Document request headers, DTOs, examples, success responses, and all error responses.

### Acceptance criteria

- API behavior and status codes match the documented contract.
- Invalid UUIDs and payloads return `400`.
- Unknown payments return `404`.
- Invalid transitions return `409`.
- `/docs` renders and `/docs-json` returns a valid OpenAPI document.

### Verification

```bash
bun run test:e2e
bun run lint
bun run typecheck
bun run build
```

### Implementation evidence

- `POST /api/v1/payments` creates a pending USD payment and returns it in a `data` envelope.
- `GET /api/v1/payments/:id` retrieves a payment; `PATCH /api/v1/payments/:id/status` enforces the domain state machine.
- Validation and application errors map to the documented `400`, `404`, and `409` response envelopes.
- Swagger UI is available at `/docs`; the OpenAPI 3 JSON contract is available at `/docs-json`.
- Swagger documents DTO constraints, examples, `X-Request-Id`, response correlation headers, and every endpoint response code.
- Application actions are asynchronous and emit structured `payment.created` and `payment.status_transitioned` logs.
- Atomic commits: `9aefa8c`, `710eadd`, `0cd482b`, and `5a6729b` (with design and execution plans in `1789de3` and `3f155f7`).

### Verification evidence — 2026-08-26

- `bun install --frozen-lockfile`: 733 installs across 708 packages checked with no changes.
- `bun run format:check`, `bun run lint`, `bun run typecheck`, and `bun run build`: exited successfully.
- `bun run test -- payments`: 4 suites, 37 tests passed.
- `bun run test`: 8 suites, 45 tests passed.
- `bun run test:e2e -- payments`: 1 suite, 29 tests passed.
- `bun run test:e2e`: 3 suites, 37 tests passed.
- `/docs` rendered successfully in the in-app browser with all payment operations visible and no browser console warnings or errors.

---

## Checkpoint 6 — Concurrency-safe idempotency

### Work

- Require `Idempotency-Key` for payment creation.
- Store an idempotency record containing the key, canonical request fingerprint, payment ID, original response, and creation time.
- Replay the original response for the same key and payload.
- Return `409 IDEMPOTENCY_CONFLICT` for the same key with a different payload.
- Coalesce concurrent same-key/same-payload requests so only one payment is created.
- Log a key hash rather than the raw key.

### Acceptance criteria

- Missing or invalid keys return `400`.
- Sequential and concurrent replays produce one payment.
- Replayed responses include `Idempotency-Replayed: true`.
- Conflicting payload reuse returns the documented `409` error.
- Unit and e2e concurrency tests pass.

### Verification

```bash
bun run test -- idempotency
bun run test:e2e -- payments
bun run typecheck
```

### Implementation evidence

- `POST /api/v1/payments` requires an `Idempotency-Key` containing 1 to 128 safe token characters.
- Missing or invalid keys map to `400 INVALID_IDEMPOTENCY_KEY`; conflicting payload reuse maps to `409 IDEMPOTENCY_CONFLICT`.
- Canonical SHA-256 request fingerprints normalize merchant references and optional descriptions before comparison.
- Each in-memory record stores the key, fingerprint, payment ID, immutable original response, and creation time behind an injection-token repository interface.
- A synchronously registered in-flight promise coalesces concurrent same-key/same-payload requests into one payment creation.
- Sequential and concurrent replays return the original response with `Idempotency-Replayed: true`, including after the current payment status changes.
- Structured logs contain only a SHA-256 key hash; the existing Pino request logger also redacts the raw `idempotency-key` header.
- Swagger documents the required request header, replay response header, and `400`/`409` errors.
- Atomic commits: `dbbf494` and `6a1cb79`.

### Verification evidence — 2026-08-26

- `bun install --frozen-lockfile`: 733 installs across 708 packages checked with no changes.
- `bun run format:check`, `bun run lint`, `bun run typecheck`, and `bun run build`: exited successfully.
- `bun run test -- idempotency`: 2 suites, 14 tests passed.
- `bun run test`: 10 suites, 62 tests passed.
- `bun run test:e2e -- payments`: 1 suite, 37 tests passed.
- `bun run test:e2e`: 3 suites, 45 tests passed.

---

## Checkpoint 7 — Asynchronous deterministic processing

### Work

- Return a newly created payment immediately with `pending` status.
- Schedule processing asynchronously without blocking the HTTP response.
- Transition through `processing` before reaching a terminal status.
- Read the delay from validated `PROCESSING_DELAY_MS` configuration.
- Resolve outcomes deterministically from a stable hash of the idempotency key, amount, and currency.
- Make the success threshold configurable.
- Isolate scheduling and outcome resolution behind injectable interfaces.
- Catch background failures, log them, and move the payment to a safe failed state.

### Acceptance criteria

- The create response returns before the configured delay elapses.
- Identical inputs and configuration always produce the same outcome.
- Jest fake-timer tests exercise the entire transition sequence without real waiting.
- Background exceptions do not become unhandled rejections.
- Logs record each transition and processing duration.

### Verification

```bash
bun run test -- processor
bun run test:e2e -- processing
bun run typecheck
```

### Implementation evidence

- Fresh `POST /api/v1/payments` requests return the immutable original `pending` response before automatic processing runs.
- The controller schedules work only inside the idempotency coordinator's fresh-request callback; sequential and concurrent replays do not create another job.
- `PaymentProcessor` owns cancellable timer handles and moves the latest stored payment through `pending -> processing -> succeeded | failed` without blocking the request.
- A zero-delay kickoff preserves asynchronous response behavior, while the terminal timer reads the validated `PROCESSING_DELAY_MS` value.
- `DeterministicPaymentOutcomeResolver` hashes `<idempotencyKey>:<smallestUnitAmount>:<currency>`, reads the first unsigned 32-bit big-endian value, and compares its `[0, 1)` score with `SIMULATED_SUCCESS_RATE`.
- Scheduling and outcome resolution use explicit Nest injection tokens, keeping timers, hashing, and framework concerns outside the payment aggregate.
- The processor re-reads current state before each phase, continues an existing `processing` payment, and safely stops when another caller already made the payment terminal.
- Background failures are caught, logged, and recovered through legal transitions to `failed`; recovery persistence failures are also logged and consumed.
- Structured processing logs include stable event names, payment IDs, duration, terminal outcome, and a SHA-256 key hash without exposing the raw idempotency key.
- Nest shutdown stops new work, cancels outstanding timers, and makes `PaymentProcessor.isReady()` return `false` for the upcoming readiness endpoint.
- Atomic commits: `eae2cbf`, `306ad5c`, `5c3eb95`, and `9a3330e` (with design and execution plans in `e351d5e` and `9eda59f`).

### Verification evidence — 2026-08-26

- `bun install --frozen-lockfile`: 733 installs across 708 packages checked with no changes.
- `bun run format:check`, `bun run lint`, `bun run typecheck`, `bun run build`, and `git diff --check`: exited successfully.
- `bun run test -- processor outcome`: 2 suites, 13 tests passed.
- `bun run test`: 13 suites, 82 tests passed.
- `bun run test:e2e -- processing`: 1 suite, 3 tests passed.
- `bun run test:e2e`: 4 suites, 48 tests passed.

---

## Checkpoint 8 — Rate limiting and health checks

### Work

- Configure `@nestjs/throttler` globally through validated environment variables.
- Apply a stricter policy to payment creation.
- Return the standard error envelope for `429` responses.
- Exempt health endpoints from throttling.
- Implement `GET /health/live`.
- Implement `GET /health/ready` using repository and processor readiness.
- Make readiness return `503` while the application is shutting down.

### Acceptance criteria

- Requests exceeding the configured limit return `429`.
- Normal traffic remains unaffected.
- Liveness indicates whether the process is serving requests.
- Readiness reflects whether the service can accept payment work.
- Health endpoints remain available when normal API throttles are exhausted.

### Verification

```bash
bun run test -- health throttler
bun run test:e2e -- health rate-limit
bun run typecheck
```

### Implementation evidence

- Zod validates the named `default` and `payment-create` throttling policies, including the rule that payment creation must use the stricter limit.
- The global throttler guard returns the standard `429 TOO_MANY_REQUESTS` error envelope and accurate standard limit, remaining, reset, and retry headers for the policy that was exhausted while retaining named-policy headers.
- A controller metadata marker applies `payment-create` only to `POST /api/v1/payments`; retrieval and other handlers remain on the default policy.
- Both liveness and readiness explicitly skip the `default` and `payment-create` policies, so probes remain available after normal API limits are exhausted.
- `GET /health/live` is an unversioned process-only probe. `GET /health/ready` composes the repository and processor readiness signals and returns a safe structured `503 SERVICE_NOT_READY` response when either signal is unavailable, false, or throws.
- Readiness failures emit structured warning/error logs without exposing internal exception details in the client response.
- Shutdown is two-phase and race-safe: the early hook makes readiness false while allowing already-admitted creations to finish scheduling; final shutdown rejects new schedules, cancels queued timers, drains tracked asynchronous callbacks, and prevents canceled work from being stranded in `processing`.
- Swagger includes the `Health` tag, unversioned liveness/readiness success contracts, the readiness `503` contract, payment-create rate-limit headers and `429` response, and the same contracts in `/docs-json`.
- Design and plan commits: `1f1f71a docs(operations): define rate limiting and health checks`; `7d4b33c docs(operations): add rate limiting and health plan`; `b7a76d0 docs(operations): use published throttler release`.
- Rate-limit implementation and corrections: `44414f0 feat(rate-limit): configure global request throttling`; `45da20e fix(rate-limit): expose standard limit headers`; `725ce70 feat(rate-limit): protect payment creation`; `351680b fix(swagger): document throttled limit headers`.
- Readiness and shutdown implementation, design corrections, and race fixes: `81de7db feat(health): expose payment readiness signals`; `6b02402 docs(operations): clarify shutdown draining`; `92e123a fix(processing): drain work during shutdown`; `fbfdb1d docs(operations): define shutdown admission draining`; `8a63ef9 fix(processing): finalize canceled completions`; `929e930 fix(processing): drain admitted creations`.
- Health implementation and exemption regression coverage: `41b2fa1 feat(health): add readiness and liveness probes`; `e857957 test(health): verify named throttle exemptions`.

### Verification evidence — 2026-08-27

- `bun install --frozen-lockfile`: Bun 1.3.8 checked 734 installs across 709 packages with no changes; `package.json` and `bun.lock` hashes remained unchanged.
- `bun run format:check`, `bun run lint`, `bun run typecheck`, `bun run build`, and `git diff --check`: exited successfully.
- `bun run test -- health throttler repository`: 5 suites, 21 tests passed.
- `bun run test:e2e -- health rate-limit`: 2 suites, 11 tests passed.
- `bun run test`: 16 suites, 106 tests passed.
- `bun run test:e2e`: 6 suites, 59 tests passed.
- `bun run test:e2e -- --detectOpenHandles`: 6 suites, 59 tests passed with no open-handle or unhandled-rejection warnings.
- A built service started through Bun on `PORT=3108`: `/health/live` returned `200 {"data":{"status":"live"}}`; `/health/ready` returned `200 {"data":{"status":"ready","checks":{"repository":"ready","processor":"ready"}}}`; `/api/v1/health/live` returned the standard `404 NOT_FOUND` envelope; `/docs-json` returned `200`.
- The downloaded document parsed as OpenAPI 3.0.0, contained `/health/live` and `/health/ready` but no `/api/v1/health/*` path, documented `429` on `POST /api/v1/payments`, documented liveness `200` and readiness `200`/`503`, and included the `Health` tag.
- The runtime process was stopped after verification and left no listener on port 3108.
- Verification ran on `codex/feat/payment-microservice` with a clean worktree, no Git remote, and the repository-local SSH command still bound to `aweds-personal`; no private-key contents were read or displayed.

---

## Checkpoint 9 — Test suite and coverage enforcement

### Work

- Complete unit tests for domain logic, repositories, idempotency, scheduling, outcome resolution, logging/error behavior, and health indicators.
- Complete Supertest e2e tests for every endpoint and meaningful error path.
- Add Jest coverage reporting in text, LCOV, and HTML formats.
- Enforce minimum global coverage thresholds.

### Coverage thresholds

- Statements: 85%
- Lines: 85%
- Functions: 85%
- Branches: 80%

### Acceptance criteria

- Unit and e2e suites pass through Bun.
- Coverage collection includes production source files and excludes bootstrap/module metadata where appropriate.
- The test command fails when a configured threshold is missed.
- No test relies on random outcomes or real processing delays.

### Verification

```bash
bun run test
bun run test:e2e
bun run test:cov
```

### Implementation evidence

- Logger characterization tests cover structured production output, sensitive-field redaction, valid request-ID preservation and response echoing, UUID fallback for invalid scalar and array headers, status/error-based log levels, disabled test auto-logging, development-only pretty transport, and level-label formatting.
- `GlobalExceptionFilter` unit tests cover string and object HTTP exceptions, validation detail preservation, normalized error codes, mapped application errors with and without details, safe `500` envelopes for unexpected `Error` and non-`Error` values, structured warning/error logging, request IDs, timestamps, and paths without leaking internal failures to clients.
- Thin controller tests verify that the application and readiness controllers delegate to their services without adding behavior.
- Processing E2E tests inject a controlled implementation through `PROCESSING_SCHEDULER`, explicitly release the zero-delay start and configured `25` ms or `10` ms terminal callbacks, and prove deterministic success, deterministic failure, and replay without a third scheduled callback; no test waits for real processing time or random outcomes.
- Readiness E2E coverage makes the real repository dependency reject once, verifies the exact `503 SERVICE_NOT_READY` envelope with repository `not_ready` and processor `ready`, checks request-ID/path/timestamp behavior and secret non-disclosure, and restores the dependency spy.
- Unit coverage collects `src/**/*.{ts,js}` and excludes only `src/main.ts`, module metadata, `src/app.setup.ts`, `src/openapi/swagger.ts`, and DTO files; E2E remains a separate mandatory gate.
- Jest emits `text`, `lcov`, and `html` reports and enforces global minimums of 85% statements, 80% branches, 85% functions, and 85% lines. A temporary 100% branch threshold made `test:cov` fail while all 126 tests passed, proving threshold enforcement before the approved 80% value was restored.
- Design and plan commits: `2b1dea22b2bd1dfb34da55291eb8b90be5643963 docs(testing): define coverage enforcement`; `41c81a129b10efe0a5d67e0d1a5d444fb7a36f13 docs(testing): add coverage implementation plan`.
- Test implementation commits: `0ffda1cd4a1165bd938288b8875ca98276a172b2 test(errors): cover logging and exception behavior`; `9760e9807ed86d01a9a5057d8e6d41da340c9267 test(e2e): cover deterministic service flows`; `5563a10ec342b59967a36c4e2af6c67a52d7e26f test(coverage): enforce coverage thresholds`.

### Verification evidence — 2026-08-27

- `bun install --frozen-lockfile`: Bun 1.3.8 checked 734 installs across 709 packages with no changes; `package.json` and `bun.lock` retained SHA-256 hashes `c2846fe47cd54b6171e523d2010f50108be0903ee44d63498782b2fc977030ae` and `904672b8df3f699880cec05798d52c3c923a85e64ccd7ff75e1c4f7eb925e389` respectively.
- `bun run format:check`, `bun run lint`, `bun run typecheck`, `bun run build`, and `git diff --check`: exited successfully.
- `bun run test`: 19 suites, 126 tests passed.
- `bun run test:e2e`: 6 suites, 60 tests passed. The sandbox-only `listen EPERM` result was discarded and the identical command passed with temporary loopback-socket permission.
- `bun run test:e2e -- --runInBand --detectOpenHandles`: 6 suites, 60 tests passed with no open-handle or unhandled-rejection warnings.
- `bun run test:cov`: 19 suites, 126 tests passed at 97.88% statements, 84.58% branches, 95.69% functions, and 97.73% lines. The sandbox-only report-write `EPERM` result was discarded and the identical command passed while creating the required ignored artifacts.
- `coverage/lcov.info` and `coverage/index.html` exist and `git check-ignore` identifies both as ignored; neither appears in Git status.
- `rg -n "waitForTerminalStatus|Date\\.now\\(\\) \\+|setTimeout" test/processing.e2e-spec.ts` exited `1` with no output, confirming the prohibited real-time polling patterns are absent.
- Verification ran on `codex/feat/payment-microservice` from clean implementation commit `5563a10`, with no Git remote and the repository-local SSH command still identifying `aweds-personal`; no private-key contents were read or displayed.

---

## Checkpoint 10 — Docker, CI, documentation, and final local verification

### Work

- Add a Bun-based multi-stage Dockerfile.
- Install/build in the builder stage and copy only runtime requirements into the final stage.
- Run the service as a non-root user.
- Add `.dockerignore` and a container health check.
- Add Bun-powered CI for install, lint, type-check, tests, coverage, and build.
- Write a complete README with architecture, setup, configuration, API examples, test commands, Docker usage, assumptions, and production trade-offs.
- Perform a clean-install verification from the committed files.

### Acceptance criteria

- The Docker image builds successfully.
- The container starts and passes its health check.
- All documented commands work exactly as written.
- CI configuration uses the pinned Bun version.
- Lint, type-check, tests, coverage, and build all pass from a clean installation.

### Verification

```bash
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run test:e2e
bun run test:cov
bun run build
docker build -t node-payment-microservice .
```

---

## Checkpoint 11 — GitHub binding and publication

### Work

- Reconfirm that repository SSH operations use the `aweds-personal` private key.
- Determine and verify the intended personal GitHub account and repository name.
- Configure the SSH remote using the verified account/repository.
- Verify authentication and remote visibility without exposing credentials.
- Push only after explicit user approval at this checkpoint.

### Acceptance criteria

- Commit authorship and SSH identity are correct.
- The remote points to the intended personal GitHub repository.
- The default branch is `main`.
- The repository contains no secrets, generated coverage output, or build artifacts.
- The pushed commit matches the fully verified local commit.

### Verification

```bash
git config --local --get core.sshCommand
git status --short --branch
git remote -v
git log -1 --show-signature --format=fuller
```
