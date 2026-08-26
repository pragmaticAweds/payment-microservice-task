# Node Payment Microservice

A NestJS and Express payment-processing microservice simulation, managed with Bun.

Implementation is proceeding through the sequential gates documented in
[`CHECKPOINTS.md`](./CHECKPOINTS.md).

## Local toolchain

- Bun 1.3.8
- NestJS 11
- TypeScript
- Jest and Supertest

## Commands

```bash
bun install --frozen-lockfile
bun run start:dev
bun run lint
bun run typecheck
bun run test
bun run test:e2e
bun run build
```

The complete setup, API, configuration, testing, and deployment documentation
will be delivered in Checkpoint 10.
