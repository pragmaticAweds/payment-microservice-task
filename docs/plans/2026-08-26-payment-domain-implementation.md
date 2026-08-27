# Payment Domain Implementation Plan

> **Execution note:** Use the executing-plans workflow to implement this plan task by task.

**Goal:** Build a framework-independent immutable Payment aggregate, explicit state machine, and injectable asynchronous in-memory repository.

**Architecture:** Business invariants and transitions live inside an immutable Payment aggregate with domain-specific errors. Persistence is hidden behind a TypeScript interface and NestJS injection token; the initial adapter uses a private in-memory Map.

**Tech Stack:** TypeScript, NestJS 11 dependency injection, Node.js `crypto.randomUUID()`, Jest 30, Bun 1.3.8.

---

### Task 1: Payment creation rules

**Files:**

- Create: `test/unit/payments/payment.spec.ts`
- Create: `src/payments/domain/payment-status.ts`
- Create: `src/payments/domain/payment.errors.ts`
- Create: `src/payments/domain/payment.ts`

**Step 1: Write the failing creation tests**

Write tests that call the desired `Payment.create()` API and assert:

- valid input starts as `pending`, receives a UUID and ISO timestamps, trims the
  merchant reference and description, and returns a frozen object;
- a whitespace-only description becomes absent;
- zero, negative, fractional, non-finite, and unsafe amounts throw
  `InvalidPaymentError`;
- non-USD currency throws `InvalidPaymentError`;
- blank or more-than-100-character merchant references throw;
- more-than-500-character descriptions throw.

Use Jest fake timers for deterministic timestamps. Import only domain files; do
not import NestJS or HTTP types.

**Step 2: Run the test to verify RED**

Run:

```bash
bun run test -- payment.spec.ts
```

Expected: FAIL because the payment domain files do not exist.

**Step 3: Implement the minimal creation model**

Create string enums:

```ts
export enum PaymentStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
}

export enum PaymentCurrency {
  USD = 'USD',
}
```

Create `InvalidPaymentError extends Error` with name `InvalidPaymentError` and
code `INVALID_PAYMENT`.

Create an immutable `Payment` class with readonly public properties and a
private constructor. `Payment.create(input)` must:

1. require `Number.isSafeInteger(smallestUnitAmount)` and a value greater than
   zero;
2. require currency `USD`;
3. trim and validate a 1–100 character merchant reference;
4. trim the optional description, treating blank text as absent, and enforce a
   500-character maximum;
5. generate the ID with `randomUUID()`;
6. assign one ISO timestamp to both timestamp fields;
7. start at `PaymentStatus.PENDING`;
8. freeze the constructed instance.

**Step 4: Run the focused test to verify GREEN**

Run `bun run test -- payment.spec.ts`.

Expected: all creation tests PASS.

### Task 2: Payment state machine

**Files:**

- Modify: `test/unit/payments/payment.spec.ts`
- Modify: `src/payments/domain/payment.errors.ts`
- Modify: `src/payments/domain/payment.ts`

**Step 1: Write the failing transition tests**

Add tests proving:

- `pending -> processing` returns a new immutable Payment;
- `processing -> succeeded` and `processing -> failed` work;
- identity, business fields, and `createdAt` remain unchanged;
- `updatedAt` advances using the current time;
- skipped, reverse, self, and terminal-state transitions throw
  `InvalidPaymentTransitionError` and preserve the original instance.

**Step 2: Run the test to verify RED**

Run `bun run test -- payment.spec.ts`.

Expected: FAIL because `transitionTo()` and
`InvalidPaymentTransitionError` do not exist.

**Step 3: Implement the minimal state machine**

Add `InvalidPaymentTransitionError extends Error` with code
`INVALID_PAYMENT_TRANSITION` plus readonly `from` and `to` status properties.

Add a private transition map:

```ts
const ALLOWED_TRANSITIONS = {
  [PaymentStatus.PENDING]: [PaymentStatus.PROCESSING],
  [PaymentStatus.PROCESSING]: [
    PaymentStatus.SUCCEEDED,
    PaymentStatus.FAILED,
  ],
  [PaymentStatus.SUCCEEDED]: [],
  [PaymentStatus.FAILED]: [],
} as const;
```

`Payment.transitionTo(nextStatus)` checks this map and either throws the domain
error or returns a new frozen Payment carrying forward all fields except status
and `updatedAt`.

**Step 4: Run tests and refactor while green**

Run `bun run test -- payment.spec.ts`.

Expected: all creation and transition tests PASS.

**Step 5: Verify and commit the aggregate**

Run:

```bash
bun run format:check
bun run lint
bun run typecheck
bun run test -- payment.spec.ts
git diff --check
```

Commit:

```bash
git add src/payments/domain test/unit/payments/payment.spec.ts
git commit -m "feat(payments): add payment aggregate and state machine"
```

### Task 3: Asynchronous repository boundary

**Files:**

- Create: `src/payments/repositories/payment.repository.ts`
- Create: `src/payments/repositories/in-memory-payment.repository.ts`
- Create: `test/unit/payments/in-memory-payment.repository.spec.ts`

**Step 1: Write the failing repository tests**

Use the desired real repository API to prove:

- a saved Payment can be found by ID;
- an unknown ID resolves to `null`;
- saving a transitioned Payment with the same ID replaces the prior snapshot;
- two different IDs remain independently retrievable.

**Step 2: Run the test to verify RED**

Run `bun run test -- in-memory-payment.repository.spec.ts`.

Expected: FAIL because the repository files do not exist.

**Step 3: Implement the interface and adapter**

Define:

```ts
export const PAYMENT_REPOSITORY = Symbol('PAYMENT_REPOSITORY');

export interface PaymentRepository {
  save(payment: Payment): Promise<void>;
  findById(id: string): Promise<Payment | null>;
}
```

Implement an injectable `InMemoryPaymentRepository` backed by a private
`Map<string, Payment>`. Both methods return Promises; `save` replaces an existing
value for the same ID and `findById` returns `null` when absent.

**Step 4: Run the focused test to verify GREEN**

Run `bun run test -- in-memory-payment.repository.spec.ts`.

Expected: all repository tests PASS.

### Task 4: NestJS repository wiring

**Files:**

- Modify: `src/payments/payments.module.ts`
- Create: `test/unit/payments/payments.module.spec.ts`

**Step 1: Write the failing module test**

Compile `PaymentsModule`, resolve `PAYMENT_REPOSITORY` as `PaymentRepository`,
and assert it is an `InMemoryPaymentRepository` that can save and retrieve a real
Payment.

**Step 2: Run the test to verify RED**

Run `bun run test -- payments.module.spec.ts`.

Expected: FAIL because the token is not registered.

**Step 3: Register and export the repository token**

Configure `PaymentsModule` with:

```ts
providers: [
  {
    provide: PAYMENT_REPOSITORY,
    useClass: InMemoryPaymentRepository,
  },
],
exports: [PAYMENT_REPOSITORY],
```

**Step 4: Run the focused and payment unit tests**

Run `bun run test -- payments`.

Expected: aggregate, repository, and module suites PASS.

**Step 5: Verify and commit the repository**

Run:

```bash
bun run format:check
bun run lint
bun run typecheck
bun run test -- payments
git diff --check
```

Commit:

```bash
git add src/payments test/unit/payments
git commit -m "feat(payments): add in-memory payment repository"
```

### Task 5: Checkpoint verification and ledger

**Files:**

- Modify: `CHECKPOINTS.md`

**Step 1: Run complete verification**

Run:

```bash
bun install --frozen-lockfile
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run test:e2e -- --runInBand
bun run build
git diff --check
```

Expected: all commands PASS with no dependency or lockfile changes.

**Step 2: Update checkpoint status**

Mark Checkpoint 3 `Completed` and Checkpoint 4 `Awaiting user verification`.
Do not mark Checkpoint 4 complete until the user approves it.

**Step 3: Commit the ledger update**

```bash
git add CHECKPOINTS.md
git commit -m "docs(checkpoints): record checkpoint 4 verification"
```

**Step 4: Confirm handoff state**

Run `git status --short --branch` and `git log --oneline --decorate -10`.

Expected: clean `codex/feat/payment-microservice` working tree with no remote
push.
