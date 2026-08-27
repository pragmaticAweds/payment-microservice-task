# Payment REST API and Swagger Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the existing payment aggregate through tested versioned REST endpoints with structured success/error contracts and complete Swagger/OpenAPI documentation.

**Architecture:** Keep HTTP handling in `PaymentsController`, orchestration in an asynchronous `PaymentsService`, invariants in the immutable `Payment` aggregate, and storage behind `PaymentRepository`. Extend the global exception boundary to translate framework-independent payment errors, then generate Swagger from explicit DTO and controller metadata.

**Tech Stack:** Bun 1.3.8, NestJS 11 with Express, TypeScript, class-validator/class-transformer, nestjs-pino/Pino, `@nestjs/swagger`, Jest, and Supertest.

**Spec:** `docs/plans/2026-08-26-payment-rest-api-design.md`

## Global Constraints

- Work only on `codex/feat/payment-microservice`; do not modify `main`.
- Use `bun` because Bun 1.3.8 is not on this shell's default `PATH`.
- Use Bun for dependency installation and every package script; do not use npm, pnpm, or yarn.
- Keep `Payment` and its domain errors free of NestJS and HTTP imports.
- Successful payment responses must be shaped as `{ "data": payment }`.
- Keep `Idempotency-Key` absent from the Checkpoint 5 contract; Checkpoint 6 introduces the header and replay behavior together.
- Accept only USD amounts expressed as positive safe-integer US cents in `smallestUnitAmount`.
- Preserve the existing global error envelope, request-ID propagation, Pino redaction, Helmet, URI versioning, and shutdown behavior.
- Create focused Conventional Commits and leave the working tree clean after each task.
- Do not add a remote or push the branch in this checkpoint.

---

## File structure

### Application boundary

- Create `src/payments/application/payment-not-found.error.ts`: framework-independent missing-payment error.
- Create `src/payments/application/payments.service.ts`: asynchronous create, retrieve, and transition use cases plus structured lifecycle logs.
- Create `test/unit/payments/payments.service.spec.ts`: service orchestration and logging tests with repository/logger doubles.
- Modify `test/unit/payments/payments.module.spec.ts`: load the global configured logger while verifying module wiring.
- Modify `src/payments/payments.module.ts`: register and export `PaymentsService`.

### REST and error boundary

- Create `src/payments/api/dto/create-payment.dto.ts`: normalized and validated creation input.
- Create `src/payments/api/dto/update-payment-status.dto.ts`: validated transition target.
- Create `src/payments/api/payments.controller.ts`: versioned HTTP operations and `data` envelopes.
- Create `src/common/filters/application-error.mapper.ts`: pure mapping from known payment/application errors to HTTP-safe values.
- Create `test/unit/application-error.mapper.spec.ts`: exact status/code/message/details mappings.
- Create `test/payments.e2e-spec.ts`: REST contract, state-machine, validation, error-envelope, and request-ID coverage.
- Modify `src/common/filters/global-exception.filter.ts`: consume the mapper and warn for expected business failures.
- Modify `src/payments/payments.module.ts`: register the controller.

### Swagger/OpenAPI boundary

- Create `src/common/openapi/error-response.dto.ts`: documented standard error envelope.
- Create `src/payments/api/dto/payment-response.dto.ts`: documented payment resource and `data` envelope.
- Create `src/openapi/swagger.ts`: service metadata, Swagger UI, and `/docs-json` setup.
- Modify `src/payments/api/dto/create-payment.dto.ts`: add exact OpenAPI constraints and examples.
- Modify `src/payments/api/dto/update-payment-status.dto.ts`: document allowed transition targets.
- Modify `src/payments/api/payments.controller.ts`: add operation, parameter, header, success, and error response metadata.
- Modify `src/app.setup.ts`: register Swagger after prefix/versioning configuration.
- Modify `test/payments.e2e-spec.ts`: verify Swagger UI and the generated OpenAPI contract.
- Modify `package.json` and `bun.lock`: install the NestJS Swagger integration through Bun.

### Checkpoint evidence

- Modify `CHECKPOINTS.md`: mark Checkpoint 4 completed, mark Checkpoint 5 awaiting user verification, and record the exact verification evidence.

---

### Task 1: Add the payment application service

**Files:**

- Create: `src/payments/application/payment-not-found.error.ts`
- Create: `src/payments/application/payments.service.ts`
- Create: `test/unit/payments/payments.service.spec.ts`
- Modify: `test/unit/payments/payments.module.spec.ts`
- Modify: `src/payments/payments.module.ts`

**Interfaces:**

- Consumes: `Payment.create(input: CreatePaymentInput): Payment`, `payment.transitionTo(nextStatus: PaymentStatus): Payment`, `PaymentRepository.findById(id): Promise<Payment | null>`, and `PaymentRepository.save(payment): Promise<void>`.
- Produces: `PaymentsService.create(input: CreatePaymentInput): Promise<Payment>`, `PaymentsService.findById(id: string): Promise<Payment>`, `PaymentsService.transition(id: string, nextStatus: PaymentStatus): Promise<Payment>`, and `PaymentNotFoundError` with code `PAYMENT_NOT_FOUND`.

- [ ] **Step 1: Write the failing service tests**

Create `test/unit/payments/payments.service.spec.ts` with direct service tests. Use a typed repository double and a minimal Pino logger double:

```ts
import { randomUUID } from 'node:crypto';
import { PinoLogger } from 'nestjs-pino';
import { PaymentNotFoundError } from '../../../src/payments/application/payment-not-found.error';
import { PaymentsService } from '../../../src/payments/application/payments.service';
import { Payment } from '../../../src/payments/domain/payment';
import {
  PaymentCurrency,
  PaymentStatus,
} from '../../../src/payments/domain/payment-status';
import { PaymentRepository } from '../../../src/payments/repositories/payment.repository';

describe('PaymentsService', () => {
  const input = {
    smallestUnitAmount: 1050,
    currency: PaymentCurrency.USD,
    merchantReference: 'order-2026-0001',
    description: 'Invoice 0001',
  };

  let repository: jest.Mocked<PaymentRepository>;
  let logger: PinoLogger;
  let loggerInfo: jest.Mock;
  let service: PaymentsService;

  beforeEach(() => {
    repository = {
      findById: jest.fn(),
      save: jest.fn().mockResolvedValue(undefined),
    };
    loggerInfo = jest.fn();
    logger = { info: loggerInfo } as unknown as PinoLogger;
    service = new PaymentsService(repository, logger);
  });

  it('creates, saves, and logs a pending payment', async () => {
    const payment = await service.create(input);
    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(repository.save).toHaveBeenCalledWith(payment);
    expect(loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'payment.created',
        paymentId: payment.id,
        merchantReference: input.merchantReference,
      }),
      'Payment created',
    );
  });

  it('retrieves an existing payment', async () => {
    const payment = Payment.create(input);
    repository.findById.mockResolvedValue(payment);
    await expect(service.findById(payment.id)).resolves.toBe(payment);
  });

  it('throws PaymentNotFoundError when a payment is missing', async () => {
    repository.findById.mockResolvedValue(null);
    await expect(service.findById(randomUUID())).rejects.toBeInstanceOf(
      PaymentNotFoundError,
    );
  });

  it('transitions, saves, and logs a new immutable snapshot', async () => {
    const pending = Payment.create(input);
    repository.findById.mockResolvedValue(pending);
    const processing = await service.transition(
      pending.id,
      PaymentStatus.PROCESSING,
    );
    expect(processing).not.toBe(pending);
    expect(processing.status).toBe(PaymentStatus.PROCESSING);
    expect(repository.save).toHaveBeenCalledWith(processing);
    expect(loggerInfo).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'payment.status_transitioned',
        paymentId: pending.id,
        fromStatus: PaymentStatus.PENDING,
        toStatus: PaymentStatus.PROCESSING,
      }),
      'Payment status transitioned',
    );
  });

  it('does not save when the aggregate rejects a transition', async () => {
    const pending = Payment.create(input);
    repository.findById.mockResolvedValue(pending);
    await expect(
      service.transition(pending.id, PaymentStatus.SUCCEEDED),
    ).rejects.toMatchObject({ code: 'INVALID_PAYMENT_TRANSITION' });
    expect(repository.save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run:

```bash
bun run test -- payments.service
```

Expected: FAIL because the application error and service files do not exist.

- [ ] **Step 3: Implement the missing-payment error**

Create `src/payments/application/payment-not-found.error.ts`:

```ts
export class PaymentNotFoundError extends Error {
  readonly code = 'PAYMENT_NOT_FOUND';

  constructor(readonly paymentId: string) {
    super(`Payment ${paymentId} was not found`);
    this.name = PaymentNotFoundError.name;
  }
}
```

- [ ] **Step 4: Implement the asynchronous application service**

Create `src/payments/application/payments.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { CreatePaymentInput, Payment } from '../domain/payment';
import { PaymentStatus } from '../domain/payment-status';
import {
  PAYMENT_REPOSITORY,
  PaymentRepository,
} from '../repositories/payment.repository';
import { PaymentNotFoundError } from './payment-not-found.error';

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PAYMENT_REPOSITORY)
    private readonly repository: PaymentRepository,
    @InjectPinoLogger(PaymentsService.name)
    private readonly logger: PinoLogger,
  ) {}

  async create(input: CreatePaymentInput): Promise<Payment> {
    const payment = Payment.create(input);
    await this.repository.save(payment);
    this.logger.info(
      {
        event: 'payment.created',
        paymentId: payment.id,
        merchantReference: payment.merchantReference,
      },
      'Payment created',
    );
    return payment;
  }

  async findById(id: string): Promise<Payment> {
    const payment = await this.repository.findById(id);
    if (payment === null) {
      throw new PaymentNotFoundError(id);
    }
    return payment;
  }

  async transition(id: string, nextStatus: PaymentStatus): Promise<Payment> {
    const current = await this.findById(id);
    const updated = current.transitionTo(nextStatus);
    await this.repository.save(updated);
    this.logger.info(
      {
        event: 'payment.status_transitioned',
        paymentId: updated.id,
        fromStatus: current.status,
        toStatus: updated.status,
      },
      'Payment status transitioned',
    );
    return updated;
  }
}
```

- [ ] **Step 5: Register and export the service**

Modify `src/payments/payments.module.ts` so `PaymentsService` is a provider and export alongside `PAYMENT_REPOSITORY`:

```ts
@Module({
  providers: [
    PaymentsService,
    {
      provide: PAYMENT_REPOSITORY,
      useClass: InMemoryPaymentRepository,
    },
  ],
  exports: [PAYMENT_REPOSITORY, PaymentsService],
})
export class PaymentsModule {}
```

Because the existing module-wiring unit test imports `PaymentsModule` outside `AppModule`, modify `test/unit/payments/payments.module.spec.ts` to import the configured global logger before the feature module:

```ts
import { CommonModule } from '../../../src/common/common.module';
import { RuntimeConfigModule } from '../../../src/config/runtime-config.module';

moduleRef = await Test.createTestingModule({
  imports: [RuntimeConfigModule, CommonModule, PaymentsModule],
}).compile();
```

- [ ] **Step 6: Run focused and regression checks**

```bash
bun run test -- payments.service
bun run test -- payments
bun run typecheck
```

Expected: all focused payment tests and type checking PASS.

- [ ] **Step 7: Commit the application boundary**

```bash
git add src/payments/application src/payments/payments.module.ts test/unit/payments/payments.module.spec.ts test/unit/payments/payments.service.spec.ts
git commit -m "feat(payments): add payment application service"
```

---

### Task 2: Expose the versioned payment REST API

**Files:**

- Create: `src/payments/api/dto/create-payment.dto.ts`
- Create: `src/payments/api/dto/update-payment-status.dto.ts`
- Create: `src/payments/api/payments.controller.ts`
- Create: `src/common/filters/application-error.mapper.ts`
- Create: `test/unit/application-error.mapper.spec.ts`
- Create: `test/payments.e2e-spec.ts`
- Modify: `src/common/filters/global-exception.filter.ts`
- Modify: `src/payments/payments.module.ts`

**Interfaces:**

- Consumes: all `PaymentsService` methods from Task 1, `InvalidPaymentError`, `InvalidPaymentTransitionError`, and the existing global `ValidationPipe` and request-ID middleware.
- Produces: `POST /api/v1/payments`, `GET /api/v1/payments/:id`, `PATCH /api/v1/payments/:id/status`, `CreatePaymentDto`, `UpdatePaymentStatusDto`, and `mapApplicationError(exception): MappedApplicationError | null`.

- [ ] **Step 1: Write failing error-mapping tests**

Create `test/unit/application-error.mapper.spec.ts`:

```ts
import { HttpStatus } from '@nestjs/common';
import { mapApplicationError } from '../../src/common/filters/application-error.mapper';
import { PaymentNotFoundError } from '../../src/payments/application/payment-not-found.error';
import {
  InvalidPaymentError,
  InvalidPaymentTransitionError,
} from '../../src/payments/domain/payment.errors';
import { PaymentStatus } from '../../src/payments/domain/payment-status';

describe('mapApplicationError', () => {
  it('maps invalid payment input to 400', () => {
    expect(mapApplicationError(new InvalidPaymentError('currency must be USD')))
      .toEqual({
        statusCode: HttpStatus.BAD_REQUEST,
        code: 'INVALID_PAYMENT',
        message: 'currency must be USD',
      });
  });

  it('maps missing payments to 404', () => {
    const error = new PaymentNotFoundError('payment-id');
    expect(mapApplicationError(error)).toEqual({
      statusCode: HttpStatus.NOT_FOUND,
      code: 'PAYMENT_NOT_FOUND',
      message: error.message,
    });
  });

  it('maps invalid transitions to 409 with state details', () => {
    expect(
      mapApplicationError(
        new InvalidPaymentTransitionError(
          PaymentStatus.PENDING,
          PaymentStatus.SUCCEEDED,
        ),
      ),
    ).toEqual({
      statusCode: HttpStatus.CONFLICT,
      code: 'INVALID_PAYMENT_TRANSITION',
      message: 'Payment cannot transition from pending to succeeded',
      details: { from: 'pending', to: 'succeeded' },
    });
  });

  it('does not classify unknown failures as application errors', () => {
    expect(mapApplicationError(new Error('unexpected'))).toBeNull();
  });
});
```

- [ ] **Step 2: Write the failing REST contract tests**

Create `test/payments.e2e-spec.ts` with this isolated setup and HTTP helper before adding the contract cases:

```ts
import { randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'superagent';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApplication } from '../src/app.setup';

describe('Payments API (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApplication(app);
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

const validRequest = {
  smallestUnitAmount: 1050,
  currency: 'USD',
  merchantReference: ' order-2026-0001 ',
  description: ' Invoice 0001 ',
};

function createPayment() {
  return request(app.getHttpServer())
    .post('/api/v1/payments')
    .send(validRequest);
}

it('creates and retrieves a payment through data envelopes', async () => {
  const created = await request(app.getHttpServer())
    .post('/api/v1/payments')
    .set('x-request-id', 'create-payment-request')
    .send(validRequest)
    .expect(201);

  expect(created.headers['x-request-id']).toBe('create-payment-request');
  expect(created.body).toEqual({
    data: expect.objectContaining({
      id: expect.any(String),
      smallestUnitAmount: 1050,
      currency: 'USD',
      merchantReference: 'order-2026-0001',
      description: 'Invoice 0001',
      status: 'pending',
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    }),
  });

  const retrieved = await request(app.getHttpServer())
    .get(`/api/v1/payments/${created.body.data.id}`)
    .expect(200);
  expect(retrieved.body).toEqual(created.body);
});

it('applies only the valid transition sequence', async () => {
  const created = await createPayment();
  const id = created.body.data.id as string;

  await request(app.getHttpServer())
    .patch(`/api/v1/payments/${id}/status`)
    .send({ status: 'processing' })
    .expect(200)
    .expect(({ body }) => expect(body.data.status).toBe('processing'));

  await request(app.getHttpServer())
    .patch(`/api/v1/payments/${id}/status`)
    .send({ status: 'succeeded' })
    .expect(200)
    .expect(({ body }) => expect(body.data.status).toBe('succeeded'));
});

it.each([
  [{ smallestUnitAmount: 0 }, 'smallestUnitAmount'],
  [{ smallestUnitAmount: 10.5 }, 'smallestUnitAmount'],
  [{ currency: 'EUR' }, 'currency'],
  [{ merchantReference: '   ' }, 'merchantReference'],
  [{ description: 'x'.repeat(501) }, 'description'],
  [{ unexpected: true }, 'unexpected'],
])('rejects an invalid create body', async (override, expectedDetail) => {
  const response = await request(app.getHttpServer())
    .post('/api/v1/payments')
    .send({ ...validRequest, ...override })
    .expect(400);
  expect(response.body).toMatchObject({
    statusCode: 400,
    code: 'VALIDATION_ERROR',
    message: 'Validation failed',
    path: '/api/v1/payments',
  });
  expect(JSON.stringify(response.body.details)).toContain(expectedDetail);
});

it('returns 400 for malformed UUIDs and transition targets', async () => {
  await request(app.getHttpServer())
    .get('/api/v1/payments/not-a-uuid')
    .expect(400);
  const created = await createPayment();
  await request(app.getHttpServer())
    .patch(`/api/v1/payments/${created.body.data.id}/status`)
    .send({ status: 'pending' })
    .expect(400);
});

it('returns 404 for an unknown UUID', async () => {
  const id = randomUUID();
  const response = await request(app.getHttpServer())
    .get(`/api/v1/payments/${id}`)
    .expect(404);
  expect(response.body).toMatchObject({
    code: 'PAYMENT_NOT_FOUND',
    path: `/api/v1/payments/${id}`,
  });
});

it.each(['succeeded', 'failed'])(
  'returns 409 when pending skips directly to %s',
  async (status) => {
    const created = await createPayment();
    const response = await request(app.getHttpServer())
      .patch(`/api/v1/payments/${created.body.data.id}/status`)
      .send({ status })
      .expect(409);
    expect(response.body).toMatchObject({
      code: 'INVALID_PAYMENT_TRANSITION',
      details: { from: 'pending', to: status },
    });
  },
);
```

Add these helpers and cases so repeated, reversed, terminal, and missing-payment transitions are explicit rather than implied:

```ts
function expectErrorEnvelope(
  response: Response,
  path: string,
  code: string,
): void {
  expect(response.body).toMatchObject({
    code,
    path,
    requestId: response.headers['x-request-id'],
  });
  expect(Number.isNaN(Date.parse(response.body.timestamp))).toBe(false);
}

async function createTerminalPayment(
  terminalStatus: 'succeeded' | 'failed',
): Promise<string> {
  const created = await createPayment();
  const id = created.body.data.id as string;
  await request(app.getHttpServer())
    .patch(`/api/v1/payments/${id}/status`)
    .send({ status: 'processing' })
    .expect(200);
  await request(app.getHttpServer())
    .patch(`/api/v1/payments/${id}/status`)
    .send({ status: terminalStatus })
    .expect(200);
  return id;
}

it('returns 409 for a repeated processing transition', async () => {
  const created = await createPayment();
  const path = `/api/v1/payments/${created.body.data.id}/status`;
  await request(app.getHttpServer())
    .patch(path)
    .send({ status: 'processing' })
    .expect(200);
  const response = await request(app.getHttpServer())
    .patch(path)
    .send({ status: 'processing' })
    .expect(409);
  expectErrorEnvelope(response, path, 'INVALID_PAYMENT_TRANSITION');
});

it.each([
  ['succeeded', 'processing'],
  ['succeeded', 'failed'],
  ['failed', 'processing'],
  ['failed', 'succeeded'],
] as const)(
  'returns 409 when terminal %s attempts %s',
  async (from, to) => {
    const id = await createTerminalPayment(from);
    const path = `/api/v1/payments/${id}/status`;
    const response = await request(app.getHttpServer())
      .patch(path)
      .send({ status: to })
      .expect(409);
    expectErrorEnvelope(response, path, 'INVALID_PAYMENT_TRANSITION');
    expect(response.body.details).toEqual({ from, to });
  },
);

it('returns 404 when transitioning an unknown payment', async () => {
  const path = `/api/v1/payments/${randomUUID()}/status`;
  const response = await request(app.getHttpServer())
    .patch(path)
    .send({ status: 'processing' })
    .expect(404);
  expectErrorEnvelope(response, path, 'PAYMENT_NOT_FOUND');
});

// Close describe('Payments API (e2e)', ...).
});
```

- [ ] **Step 3: Run both focused suites and confirm the red state**

```bash
bun run test -- application-error.mapper
bun run test:e2e -- payments
```

Expected: FAIL because the mapper, DTOs, controller, and routes do not exist.

- [ ] **Step 4: Implement normalized input DTOs**

Create `src/payments/api/dto/create-payment.dto.ts`:

```ts
import { Transform, TransformFnParams } from 'class-transformer';
import {
  Equals,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaymentCurrency } from '../../domain/payment-status';

const trimString = ({ value }: TransformFnParams): unknown =>
  typeof value === 'string' ? value.trim() : value;

export class CreatePaymentDto {
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  smallestUnitAmount!: number;

  @Equals(PaymentCurrency.USD)
  currency!: PaymentCurrency;

  @Transform(trimString)
  @IsString()
  @Length(1, 100)
  merchantReference!: string;

  @Transform(trimString)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
```

Use the `Response` type imported from `superagent` in the suite setup above.

Create `src/payments/api/dto/update-payment-status.dto.ts`:

```ts
import { IsIn } from 'class-validator';
import { PaymentStatus } from '../../domain/payment-status';

export const PAYMENT_TRANSITION_TARGETS = [
  PaymentStatus.PROCESSING,
  PaymentStatus.SUCCEEDED,
  PaymentStatus.FAILED,
] as const;

export type PaymentTransitionTarget =
  (typeof PAYMENT_TRANSITION_TARGETS)[number];

export class UpdatePaymentStatusDto {
  @IsIn(PAYMENT_TRANSITION_TARGETS)
  status!: PaymentTransitionTarget;
}
```

- [ ] **Step 5: Implement the pure application-error mapper**

Create `src/common/filters/application-error.mapper.ts`:

```ts
import { HttpStatus } from '@nestjs/common';
import { PaymentNotFoundError } from '../../payments/application/payment-not-found.error';
import {
  InvalidPaymentError,
  InvalidPaymentTransitionError,
} from '../../payments/domain/payment.errors';

export interface MappedApplicationError {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

export function mapApplicationError(
  exception: unknown,
): MappedApplicationError | null {
  if (exception instanceof InvalidPaymentError) {
    return {
      statusCode: HttpStatus.BAD_REQUEST,
      code: exception.code,
      message: exception.message,
    };
  }
  if (exception instanceof PaymentNotFoundError) {
    return {
      statusCode: HttpStatus.NOT_FOUND,
      code: exception.code,
      message: exception.message,
    };
  }
  if (exception instanceof InvalidPaymentTransitionError) {
    return {
      statusCode: HttpStatus.CONFLICT,
      code: exception.code,
      message: exception.message,
      details: { from: exception.from, to: exception.to },
    };
  }
  return null;
}
```

- [ ] **Step 6: Extend the global filter without leaking unexpected errors**

In `src/common/filters/global-exception.filter.ts`, import the mapper and replace the status/error/logging selection inside `catch` with this complete branch:

```ts
const applicationError = mapApplicationError(exception);
let statusCode: number;
let error: Pick<ErrorEnvelope, 'code' | 'details' | 'message'>;

if (isHttpException) {
  statusCode = exception.getStatus();
  error = getHttpError(exception);
} else if (applicationError !== null) {
  statusCode = applicationError.statusCode;
  error = {
    code: applicationError.code,
    message: applicationError.message,
    ...(applicationError.details === undefined
      ? {}
      : { details: applicationError.details }),
  };
  this.logger.warn(
    {
      code: applicationError.code,
      method: request.method,
      path: request.originalUrl,
      requestId,
      statusCode,
    },
    'Request rejected by application rules',
  );
} else {
  statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
  error = {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
  };
  this.logger.error(
    {
      err:
        exception instanceof Error
          ? exception
          : new Error('A non-Error value was thrown'),
      method: request.method,
      path: request.originalUrl,
      requestId,
    },
    'Unhandled request exception',
  );
}
```

Keep the existing envelope construction and `HttpException` normalization unchanged.

- [ ] **Step 7: Implement and register the controller**

Create `src/payments/api/payments.controller.ts`:

```ts
import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { PaymentsService } from '../application/payments.service';
import { Payment } from '../domain/payment';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';

interface PaymentDataResponse {
  data: Payment;
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  async create(@Body() input: CreatePaymentDto): Promise<PaymentDataResponse> {
    return { data: await this.paymentsService.create(input) };
  }

  @Get(':id')
  async findById(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PaymentDataResponse> {
    return { data: await this.paymentsService.findById(id) };
  }

  @Patch(':id/status')
  async transition(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdatePaymentStatusDto,
  ): Promise<PaymentDataResponse> {
    return { data: await this.paymentsService.transition(id, input.status) };
  }
}
```

Register `PaymentsController` in the `controllers` array of `src/payments/payments.module.ts`.

- [ ] **Step 8: Run formatting and focused verification**

```bash
bun run format
bun run test -- application-error.mapper
bun run test:e2e -- payments
bun run lint
bun run typecheck
```

Expected: mapper tests, all payment REST flows, lint, and type checking PASS.

- [ ] **Step 9: Commit the public REST interface**

```bash
git add src/common/filters src/payments/api src/payments/payments.module.ts test/unit/application-error.mapper.spec.ts test/payments.e2e-spec.ts
git commit -m "feat(api): expose versioned payment endpoints"
```

---

### Task 3: Publish and verify the Swagger/OpenAPI contract

**Files:**

- Create: `src/common/openapi/error-response.dto.ts`
- Create: `src/payments/api/dto/payment-response.dto.ts`
- Create: `src/openapi/swagger.ts`
- Modify: `src/payments/api/dto/create-payment.dto.ts`
- Modify: `src/payments/api/dto/update-payment-status.dto.ts`
- Modify: `src/payments/api/payments.controller.ts`
- Modify: `src/app.setup.ts`
- Modify: `test/payments.e2e-spec.ts`
- Modify: `package.json`
- Modify: `bun.lock`

**Interfaces:**

- Consumes: all REST endpoints and DTO constraints from Task 2 plus the existing `configureApplication(app)` bootstrap function.
- Produces: Swagger UI at `/docs`, OpenAPI JSON at `/docs-json`, `configureSwagger(app: INestApplication): void`, and complete component/operation metadata for the three payment routes.

- [ ] **Step 1: Install the NestJS Swagger integration with Bun**

```bash
bun add @nestjs/swagger
```

Verify that `package.json` records `@nestjs/swagger` under dependencies and that `bun.lock` is updated. Keep both changes uncommitted until the documented endpoints pass.

- [ ] **Step 2: Write failing documentation endpoint and schema tests**

Extend `test/payments.e2e-spec.ts`:

```ts
it('serves Swagger UI and a valid OpenAPI document', async () => {
  const html = await request(app.getHttpServer()).get('/docs').expect(200);
  expect(html.headers['content-type']).toContain('text/html');
  expect(html.text).toContain('Swagger UI');

  const response = await request(app.getHttpServer())
    .get('/docs-json')
    .expect(200);
  expect(response.body).toMatchObject({
    openapi: expect.stringMatching(/^3\./),
    info: {
      title: 'Node Payment Microservice',
      version: '1.0.0',
    },
  });
  expect(response.body.paths).toEqual(
    expect.objectContaining({
      '/api/v1/payments': expect.objectContaining({
        post: expect.any(Object),
      }),
      '/api/v1/payments/{id}': expect.objectContaining({
        get: expect.any(Object),
      }),
      '/api/v1/payments/{id}/status': expect.objectContaining({
        patch: expect.any(Object),
      }),
    }),
  );
});

it('documents request IDs, schemas, examples, and every response code', async () => {
  const { body } = await request(app.getHttpServer())
    .get('/docs-json')
    .expect(200);
  const create = body.paths['/api/v1/payments'].post;
  const retrieve = body.paths['/api/v1/payments/{id}'].get;
  const transition = body.paths['/api/v1/payments/{id}/status'].patch;

  expect(create.parameters).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ in: 'header', name: 'X-Request-Id' }),
    ]),
  );
  expect(create.requestBody.content['application/json'].schema).toBeDefined();
  expect(create.responses).toEqual(
    expect.objectContaining({
      '201': expect.any(Object),
      '400': expect.any(Object),
    }),
  );
  expect(retrieve.responses).toEqual(
    expect.objectContaining({
      '200': expect.any(Object),
      '400': expect.any(Object),
      '404': expect.any(Object),
    }),
  );
  expect(transition.responses).toEqual(
    expect.objectContaining({
      '200': expect.any(Object),
      '400': expect.any(Object),
      '404': expect.any(Object),
      '409': expect.any(Object),
    }),
  );
  expect(body.components.schemas).toEqual(
    expect.objectContaining({
      CreatePaymentDto: expect.any(Object),
      UpdatePaymentStatusDto: expect.any(Object),
      PaymentDataResponseDto: expect.any(Object),
      ErrorResponseDto: expect.any(Object),
    }),
  );
});
```

Append these assertions in the same test:

```ts
for (const operation of [create, retrieve, transition]) {
  for (const documentedResponse of Object.values(operation.responses)) {
    expect(documentedResponse).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          'x-request-id': expect.any(Object),
        }),
      }),
    );
  }
}

const createSchema = body.components.schemas.CreatePaymentDto;
expect(createSchema.properties.smallestUnitAmount).toMatchObject({
  example: 1050,
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
});
expect(createSchema.properties.currency).toMatchObject({
  enum: ['USD'],
  example: 'USD',
});
expect(createSchema.properties.merchantReference).toMatchObject({
  example: 'order-2026-0001',
  minLength: 1,
  maxLength: 100,
});
expect(createSchema.properties.description).toMatchObject({
  example: 'Invoice 0001',
  maxLength: 500,
});
expect(
  body.components.schemas.UpdatePaymentStatusDto.properties.status.enum,
).toEqual(['processing', 'succeeded', 'failed']);
```

- [ ] **Step 3: Run the Swagger-focused e2e tests and confirm the red state**

```bash
bun run test:e2e -- payments
```

Expected: FAIL with `404` for `/docs` and `/docs-json`.

- [ ] **Step 4: Add explicit OpenAPI response DTOs**

Create `src/common/openapi/error-response.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({ example: 'VALIDATION_ERROR' })
  code!: string;

  @ApiProperty({ example: 'Validation failed' })
  message!: string;

  @ApiProperty({ example: 'assessment-request-123' })
  requestId!: string;

  @ApiProperty({ example: '2026-08-26T12:00:00.000Z', format: 'date-time' })
  timestamp!: string;

  @ApiProperty({ example: '/api/v1/payments' })
  path!: string;

  @ApiPropertyOptional({
    description: 'Validation messages or structured business-error context',
  })
  details?: unknown;
}
```

Create `src/payments/api/dto/payment-response.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentCurrency, PaymentStatus } from '../../domain/payment-status';

export class PaymentResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 1050, minimum: 1, type: Number })
  smallestUnitAmount!: number;

  @ApiProperty({ enum: PaymentCurrency, example: PaymentCurrency.USD })
  currency!: PaymentCurrency;

  @ApiProperty({ example: 'order-2026-0001', maxLength: 100 })
  merchantReference!: string;

  @ApiPropertyOptional({ example: 'Invoice 0001', maxLength: 500 })
  description?: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.PENDING })
  status!: PaymentStatus;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class PaymentDataResponseDto {
  @ApiProperty({ type: PaymentResponseDto })
  data!: PaymentResponseDto;
}
```

- [ ] **Step 5: Annotate request DTOs and controller operations**

Add these decorators to `CreatePaymentDto` above the corresponding existing validation decorators:

```ts
@ApiProperty({
  description: 'Payment amount in US cents',
  example: 1050,
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
  type: Number,
})
smallestUnitAmount!: number;

@ApiProperty({ enum: PaymentCurrency, example: PaymentCurrency.USD })
currency!: PaymentCurrency;

@ApiProperty({ example: 'order-2026-0001', minLength: 1, maxLength: 100 })
merchantReference!: string;

@ApiPropertyOptional({ example: 'Invoice 0001', maxLength: 500 })
description?: string;
```

Retain the validation and transform decorators on each field; the OpenAPI decorator is added above them. Import `ApiProperty` and `ApiPropertyOptional` from `@nestjs/swagger`.

Add this metadata to `UpdatePaymentStatusDto` while retaining `@IsIn(PAYMENT_TRANSITION_TARGETS)`:

```ts
@ApiProperty({
  enum: PAYMENT_TRANSITION_TARGETS,
  example: PaymentStatus.PROCESSING,
})
status!: PaymentTransitionTarget;
```

In `PaymentsController`, import `ErrorResponseDto`, `PaymentDataResponseDto`, and these Swagger decorators:

```ts
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
```

Apply `@ApiTags('Payments')` above `@Controller('payments')`, then use these exact stacks above the existing methods:

```ts
@Post()
@ApiOperation({ summary: 'Create a pending payment' })
@ApiHeader({
  name: 'X-Request-Id',
  required: false,
  description: 'Optional caller-provided correlation identifier',
})
@ApiCreatedResponse({
  description: 'Payment created in pending state',
  headers: REQUEST_ID_RESPONSE_HEADERS,
  type: PaymentDataResponseDto,
})
@ApiBadRequestResponse({
  description: 'Invalid creation request',
  headers: REQUEST_ID_RESPONSE_HEADERS,
  type: ErrorResponseDto,
})

@Get(':id')
@ApiOperation({ summary: 'Retrieve a payment' })
@ApiHeader({ name: 'X-Request-Id', required: false })
@ApiParam({ name: 'id', format: 'uuid', type: String })
@ApiOkResponse({ headers: REQUEST_ID_RESPONSE_HEADERS, type: PaymentDataResponseDto })
@ApiBadRequestResponse({ headers: REQUEST_ID_RESPONSE_HEADERS, type: ErrorResponseDto })
@ApiNotFoundResponse({ headers: REQUEST_ID_RESPONSE_HEADERS, type: ErrorResponseDto })

@Patch(':id/status')
@ApiOperation({ summary: 'Transition a payment status' })
@ApiHeader({ name: 'X-Request-Id', required: false })
@ApiParam({ name: 'id', format: 'uuid', type: String })
@ApiOkResponse({ headers: REQUEST_ID_RESPONSE_HEADERS, type: PaymentDataResponseDto })
@ApiBadRequestResponse({ headers: REQUEST_ID_RESPONSE_HEADERS, type: ErrorResponseDto })
@ApiNotFoundResponse({ headers: REQUEST_ID_RESPONSE_HEADERS, type: ErrorResponseDto })
@ApiConflictResponse({ headers: REQUEST_ID_RESPONSE_HEADERS, type: ErrorResponseDto })
```

Use this response-header definition in all success and error response metadata:

```ts
const REQUEST_ID_RESPONSE_HEADERS = {
  'x-request-id': {
    description: 'Effective request correlation identifier',
    schema: { type: 'string' },
  },
};
```

The documented response codes are `201/400` for POST, `200/400/404` for GET, and `200/400/404/409` for PATCH.

- [ ] **Step 6: Configure Swagger UI and the JSON endpoint**

Create `src/openapi/swagger.ts`:

```ts
import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export function configureSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Node Payment Microservice')
    .setDescription(
      'Versioned API for creating, retrieving, and transitioning simulated payments.',
    )
    .setVersion('1.0.0')
    .addTag('Payments', 'Payment creation, retrieval, and state transitions')
    .build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs-json',
  });
}
```

Modify `configureApplication` in `src/app.setup.ts` so the order is Helmet, global prefix, URI versioning, Swagger configuration, and shutdown hooks. This ensures generated paths include `/api/v1` while the documentation endpoints remain `/docs` and `/docs-json`.

- [ ] **Step 7: Run the documentation tests and inspect the generated contract**

```bash
bun run format
bun run test:e2e -- payments
bun run typecheck
bun run build
```

Expected: Swagger HTML and JSON tests PASS, documented paths include the global prefix and URI version, and the production build succeeds.

- [ ] **Step 8: Commit the Swagger contract**

```bash
git add package.json bun.lock src/app.setup.ts src/openapi src/common/openapi src/payments/api test/payments.e2e-spec.ts
git commit -m "docs(swagger): document the payment API"
```

---

### Task 4: Run checkpoint verification and record evidence

**Files:**

- Modify: `CHECKPOINTS.md`

**Interfaces:**

- Consumes: the complete Checkpoint 5 implementation from Tasks 1–3.
- Produces: a clean, verified branch and a checkpoint ledger that marks Checkpoint 4 `Completed` and Checkpoint 5 `Awaiting user verification`.

- [ ] **Step 1: Verify the lockfile and formatting**

```bash
bun install --frozen-lockfile
bun run format:check
```

Expected: the frozen install makes no dependency changes and formatting passes.

- [ ] **Step 2: Run static and production-build checks**

```bash
bun run lint
bun run typecheck
bun run build
```

Expected: all three commands exit `0`.

- [ ] **Step 3: Run every test layer**

```bash
bun run test -- payments
bun run test
bun run test:e2e
```

Expected: payment-focused unit tests, the full unit suite, and all e2e suites pass with no open-handle warnings or unhandled rejections.

- [ ] **Step 4: Check repository integrity**

```bash
git diff --check
git status --short --branch
git log --oneline --decorate -8
```

Expected: no whitespace errors, only the intended checkpoint ledger is uncommitted, and the recent history contains focused Conventional Commits.

- [ ] **Step 5: Record checkpoint evidence**

Update the `CHECKPOINTS.md` progress table:

```text
Checkpoint 4: Completed
Checkpoint 5: Awaiting user verification
```

Under Checkpoint 5, add a concise implementation/evidence note containing the actual commit hashes and exact passing suite/test counts observed in Steps 1–3. Do not invent counts before reading command output.

- [ ] **Step 6: Commit the checkpoint ledger**

```bash
git add CHECKPOINTS.md
git commit -m "docs(checkpoints): record checkpoint 5 verification"
```

- [ ] **Step 7: Reconfirm the final clean state**

```bash
git status --short --branch
git log --oneline --decorate -10
```

Expected: clean `codex/feat/payment-microservice`; do not proceed to Checkpoint 6 until the user explicitly approves Checkpoint 5.
