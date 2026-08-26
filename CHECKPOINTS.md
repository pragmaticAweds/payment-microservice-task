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

| Checkpoint | Planned commit messages |
| --- | --- |
| 1 | `chore(repo): initialize Bun payment service workspace` |
| 2 | `chore(scaffold): create NestJS Express application` |
| 3 | `feat(config): validate runtime configuration with Zod`; `feat(observability): add structured request logging`; `feat(errors): standardize API error responses` |
| 4 | `feat(payments): add payment domain and in-memory repository` |
| 5 | `feat(api): expose versioned payment endpoints`; `docs(swagger): document the payment API` |
| 6 | `feat(idempotency): make payment creation replay-safe` |
| 7 | `feat(processing): simulate deterministic async outcomes` |
| 8 | `feat(rate-limit): protect payment endpoints`; `feat(health): add readiness and liveness probes` |
| 9 | `test(e2e): cover payment service flows`; `test(coverage): enforce coverage thresholds` |
| 10 | `build(docker): add multi-stage Bun image`; `ci(github): verify the service with Bun`; `docs(readme): document setup and architecture` |
| 11 | No commit unless final verification requires a tracked correction; remote configuration itself is repository-local metadata. |

The exact number of commits may change when a checkpoint contains more than one independently reviewable change, but the atomicity rules do not change.

## Progress summary

| Checkpoint | Description | Status |
| --- | --- | --- |
| 1 | Desktop workspace, Git, Bun, and `aweds-personal` binding | Completed |
| 2 | NestJS/Express scaffold and project boundaries | Completed |
| 3 | Configuration, logging, validation, errors, and shutdown | Completed |
| 4 | Payment domain, state machine, and persistence | Awaiting user verification |
| 5 | REST API and complete Swagger documentation | Not started |
| 6 | Concurrency-safe idempotency | Not started |
| 7 | Asynchronous deterministic payment processing | Not started |
| 8 | Rate limiting and health endpoints | Not started |
| 9 | Jest unit/e2e tests and coverage enforcement | Not started |
| 10 | Docker, CI, README, and final local verification | Not started |
| 11 | GitHub remote verification and approved publication | Not started |

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
bun run test:e2e -- idempotency
bun run typecheck
```

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
