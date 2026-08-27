# Test Suite and Coverage Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the remaining high-value unit and E2E coverage, remove real
processing-delay waits, and enforce the agreed Jest coverage thresholds with
text, LCOV, and HTML reports.

**Architecture:** Unit coverage measures executable application behavior and
excludes only Nest/Swagger composition and DTO metadata. Supertest E2E remains
a separate required gate, with an injected controlled scheduler replacing real
processing timers. Coverage configuration is added only after the behavior
tests provide sufficient headroom.

**Tech Stack:** Bun 1.3.8, NestJS 11 with Express, TypeScript, Jest 30,
ts-jest, Supertest, Pino, Istanbul coverage reporters.

**Spec:** `docs/plans/2026-08-27-test-suite-and-coverage-design.md`

## Global Constraints

- Work only on `codex/feat/payment-microservice`; do not modify `main`.
- Use `/Users/abdulafeezpifapp/.bun/bin/bun` for Bun commands.
- Do not add or update runtime or development dependencies.
- Unit coverage thresholds are global: statements 85%, lines 85%, functions
  85%, and branches 80%.
- Coverage reporters are exactly `text`, `lcov`, and `html`.
- E2E results remain separate from unit coverage and must pass independently.
- Coverage may exclude only `src/main.ts`, `src/**/*.module.ts`,
  `src/app.setup.ts`, `src/openapi/swagger.ts`, and `src/**/*.dto.ts`.
- Do not exclude controllers, services, repositories, processors, logger
  configuration, filters, mappers, throttling, or health logic.
- Do not change production behavior merely to improve coverage.
- No test may depend on a random payment outcome or a real processing delay.
- Await every Promise/Supertest operation and leave no timer, server, or
  background-work handle open.
- Keep generated `coverage/` output ignored and untracked.
- Keep changes atomic with Conventional Commit subjects and do not configure a
  remote or push.

---

### Task 1: Cover logging, exception filtering, and thin controllers

**Files:**

- Modify: `test/unit/logger.config.spec.ts`
- Create: `test/unit/global-exception.filter.spec.ts`
- Create: `test/unit/app.controller.spec.ts`
- Modify: `test/unit/health/health.controller.spec.ts`

**Interfaces:**

- Consumes: `createLoggerOptions(environment): Params`
- Consumes: `GlobalExceptionFilter.catch(exception, host): void`
- Consumes: `AppController.getServiceInfo(): ServiceInfo`
- Consumes: `HealthController.readiness(): Promise<HealthReadinessResponse>`
- Produces: characterization coverage for executable infrastructure behavior;
  no production interface changes.

- [ ] **Step 1: Extend the logger tests through returned callbacks**

Add a local callback type and helper to `test/unit/logger.config.spec.ts`:

```ts
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RequestMethod } from '@nestjs/common';
import {
  createLoggerOptions,
  REQUEST_ID_HEADER,
} from '../../src/common/logger.config';

interface LoggerCallbacks {
  autoLogging: boolean;
  customLogLevel: (
    request: IncomingMessage,
    response: ServerResponse,
    error?: Error,
  ) => 'error' | 'info' | 'warn';
  formatters: {
    level: (label: string) => { level: string };
  };
  genReqId: (request: IncomingMessage, response: ServerResponse) => string;
  redact: { censor: string; paths: string[] };
  transport?: {
    target: string;
    options: Record<string, unknown>;
  };
}

function callbacksFor(
  nodeEnv: 'development' | 'production' | 'test',
): LoggerCallbacks {
  return createLoggerOptions({
    NODE_ENV: nodeEnv,
    SERVICE_NAME: 'test-payment-service',
    LOG_LEVEL: 'debug',
  }).pinoHttp as LoggerCallbacks;
}
```

Keep the existing production/redaction assertion and add these behaviors:

```ts
it('preserves and echoes a valid caller request ID', () => {
  const callbacks = callbacksFor('test');
  const setHeader = jest.fn();
  const request = {
    headers: { [REQUEST_ID_HEADER]: 'caller-request-01' },
  } as unknown as IncomingMessage;
  const response = { setHeader } as unknown as ServerResponse;

  expect(callbacks.genReqId(request, response)).toBe('caller-request-01');
  expect(setHeader).toHaveBeenCalledWith(
    REQUEST_ID_HEADER,
    'caller-request-01',
  );
});

it.each([
  { header: 'invalid request id!', scenario: 'invalid string' },
  { header: ['first', 'second'], scenario: 'multi-value header' },
] as const)('generates a UUID for a $scenario', ({ header }) => {
  const callbacks = callbacksFor('test');
  const setHeader = jest.fn();
  const request = {
    headers: { [REQUEST_ID_HEADER]: header },
  } as unknown as IncomingMessage;
  const response = { setHeader } as unknown as ServerResponse;

  const requestId = callbacks.genReqId(request, response);

  expect(requestId).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
  );
  expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, requestId);
});

it.each([
  { statusCode: 200, error: undefined, expectedLevel: 'info' },
  { statusCode: 404, error: undefined, expectedLevel: 'warn' },
  { statusCode: 500, error: undefined, expectedLevel: 'error' },
  {
    statusCode: 200,
    error: new Error('socket failed'),
    expectedLevel: 'error',
  },
] as const)(
  'selects $expectedLevel logging for the response/error state',
  ({ statusCode, error, expectedLevel }) => {
    const callbacks = callbacksFor('test');
    const request = { headers: {} } as IncomingMessage;
    const response = { statusCode } as ServerResponse;

    expect(callbacks.customLogLevel(request, response, error)).toBe(
      expectedLevel,
    );
  },
);

it('uses pretty transport only in development and formats level labels', () => {
  const development = callbacksFor('development');
  const test = callbacksFor('test');

  expect(development.transport).toEqual({
    target: 'pino-pretty',
    options: {
      colorize: true,
      singleLine: true,
      translateTime: 'SYS:standard',
    },
  });
  expect(test.transport).toBeUndefined();
  expect(test.autoLogging).toBe(false);
  expect(test.formatters.level('warn')).toEqual({ level: 'warn' });
});
```

- [ ] **Step 2: Add a typed global exception-filter fixture**

Create `test/unit/global-exception.filter.spec.ts` with this reusable harness:

```ts
import {
  ArgumentsHost,
  BadRequestException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { PinoLogger } from 'nestjs-pino';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { PaymentNotFoundError } from '../../src/payments/application/payment-not-found.error';
import { InvalidPaymentTransitionError } from '../../src/payments/domain/payment.errors';
import { PaymentStatus } from '../../src/payments/domain/payment-status';

interface ErrorEnvelope {
  statusCode: number;
  code: string;
  message: string;
  requestId: string;
  timestamp: string;
  path: string;
  details?: unknown;
}

function createHarness(requestOverrides: Partial<Request> = {}) {
  const request = {
    headers: {},
    method: 'GET',
    originalUrl: '/api/v1/test',
    ...requestOverrides,
  } as Request;
  const response = {
    status: jest.fn(),
    json: jest.fn(),
  } as unknown as jest.Mocked<Pick<Response, 'json' | 'status'>>;
  response.status.mockReturnValue(response as unknown as Response);
  response.json.mockReturnValue(response as unknown as Response);
  const warn = jest.fn();
  const error = jest.fn();
  const logger = { warn, error } as unknown as PinoLogger;
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;

  return {
    error,
    filter: new GlobalExceptionFilter(logger),
    host,
    response,
    warn,
  };
}

function getEnvelope(
  response: jest.Mocked<Pick<Response, 'json' | 'status'>>,
): ErrorEnvelope {
  const envelope = response.json.mock.calls[0]?.[0] as ErrorEnvelope;
  expect(Number.isNaN(Date.parse(envelope.timestamp))).toBe(false);
  return envelope;
}
```

- [ ] **Step 3: Specify every exception branch through observable envelopes and logs**

Add these tests below the harness:

```ts
describe('GlobalExceptionFilter', () => {
  it('maps a string HTTP response with the status-derived code', () => {
    const { filter, host, response, warn, error } = createHarness({
      id: 'http-request',
    } as Partial<Request>);

    filter.catch(
      new HttpException('Short and stout', HttpStatus.I_AM_A_TEAPOT),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(HttpStatus.I_AM_A_TEAPOT);
    expect(getEnvelope(response)).toMatchObject({
      statusCode: 418,
      code: 'I_AM_A_TEAPOT',
      message: 'Short and stout',
      requestId: 'http-request',
      path: '/api/v1/test',
    });
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('maps validation arrays to safe summary and original details', () => {
    const { filter, host, response } = createHarness({
      headers: { 'x-request-id': 'validation-request' },
    });
    const messages = ['smallestUnitAmount must be an integer'];

    filter.catch(
      new BadRequestException({
        error: 'Bad Request',
        message: messages,
        statusCode: 400,
      }),
      host,
    );

    expect(getEnvelope(response)).toMatchObject({
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: messages,
      requestId: 'validation-request',
    });
  });

  it('normalizes an explicit HTTP code and preserves safe details', () => {
    const { filter, host, response } = createHarness();

    filter.catch(
      new HttpException(
        {
          code: 'service not ready',
          message: 'Not ready',
          details: { checks: { repository: 'not_ready' } },
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      ),
      host,
    );

    expect(getEnvelope(response)).toMatchObject({
      statusCode: 503,
      code: 'SERVICE_NOT_READY',
      message: 'Not ready',
      details: { checks: { repository: 'not_ready' } },
      requestId: 'unavailable',
    });
  });

  it('uses a normalized HTTP error fallback when message is not a string', () => {
    const { filter, host, response } = createHarness();

    filter.catch(
      new HttpException(
        { error: 'Unprocessable Entity', message: { field: 'invalid' } },
        HttpStatus.UNPROCESSABLE_ENTITY,
      ),
      host,
    );

    expect(getEnvelope(response)).toMatchObject({
      code: 'UNPROCESSABLE_ENTITY',
      message: 'Request failed',
    });
  });

  it('maps application errors with details and emits a structured warning', () => {
    const { filter, host, response, warn } = createHarness({
      id: 42,
      method: 'PATCH',
    } as Partial<Request>);

    filter.catch(
      new InvalidPaymentTransitionError(
        PaymentStatus.PENDING,
        PaymentStatus.SUCCEEDED,
      ),
      host,
    );

    expect(getEnvelope(response)).toMatchObject({
      statusCode: 409,
      code: 'INVALID_PAYMENT_TRANSITION',
      requestId: '42',
      details: { from: 'pending', to: 'succeeded' },
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'INVALID_PAYMENT_TRANSITION',
        method: 'PATCH',
        requestId: '42',
        statusCode: 409,
      }),
      'Request rejected by application rules',
    );
  });

  it('omits details when a mapped application error has none', () => {
    const { filter, host, response } = createHarness();

    filter.catch(new PaymentNotFoundError('missing-payment'), host);

    const envelope = getEnvelope(response);
    expect(envelope).not.toHaveProperty('details');
    expect(envelope).toMatchObject({
      statusCode: 404,
      code: 'PAYMENT_NOT_FOUND',
    });
  });

  it('logs an unexpected Error but returns a safe 500 envelope', () => {
    const { filter, host, response, error } = createHarness({
      id: 'unexpected-request',
    } as Partial<Request>);
    const exception = new Error('database password must stay internal');

    filter.catch(exception, host);

    const envelope = getEnvelope(response);
    expect(envelope).toMatchObject({
      statusCode: 500,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      requestId: 'unexpected-request',
    });
    expect(JSON.stringify(envelope)).not.toContain('database password');
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ err: exception }),
      'Unhandled request exception',
    );
  });

  it('normalizes a non-Error thrown value before logging it', () => {
    const { filter, host, response, error } = createHarness();

    filter.catch('unsafe thrown value', host);

    expect(getEnvelope(response).requestId).toBe('unavailable');
    const metadata = error.mock.calls[0]?.[0] as { err?: unknown };
    expect(metadata.err).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 4: Add direct controller delegation tests**

Create `test/unit/app.controller.spec.ts`:

```ts
import { AppController } from '../../src/app.controller';
import { AppService, type ServiceInfo } from '../../src/app.service';

describe('AppController', () => {
  it('returns service information from AppService', () => {
    const serviceInfo: ServiceInfo = {
      name: 'node-payment-microservice',
      status: 'ok',
    };
    const getServiceInfo = jest.fn().mockReturnValue(serviceInfo);
    const controller = new AppController({
      getServiceInfo,
    } as unknown as AppService);

    expect(controller.getServiceInfo()).toBe(serviceInfo);
    expect(getServiceInfo).toHaveBeenCalledTimes(1);
  });
});
```

Extend `test/unit/health/health.controller.spec.ts` without changing its
metadata tests:

```ts
import type { HealthReadinessResponse } from '../../../src/health/health.service';
import { HealthService } from '../../../src/health/health.service';

describe('HealthController behavior', () => {
  it('returns the readiness service result', async () => {
    const result: HealthReadinessResponse = {
      data: {
        status: 'ready',
        checks: { repository: 'ready', processor: 'ready' },
      },
    };
    const readiness = jest.fn().mockResolvedValue(result);
    const controller = new HealthController({
      readiness,
    } satisfies Pick<HealthService, 'readiness'>);

    await expect(controller.readiness()).resolves.toBe(result);
    expect(readiness).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 5: Prove characterization-test sensitivity**

Run the new focused tests once and confirm they pass against the current
behavior:

```bash
/Users/abdulafeezpifapp/.bun/bin/bun run test -- logger.config global-exception.filter app.controller health.controller
```

Temporarily change one asserted production branch at a time—for example return
`warn` for a 200 response and omit `details` from the validation envelope—then
rerun the corresponding focused test and capture the expected assertion
failure. Restore both production files exactly and rerun the focused command.
No temporary mutation may remain in `git diff`.

- [ ] **Step 6: Run Task 1 verification**

```bash
/Users/abdulafeezpifapp/.bun/bin/bun run format
/Users/abdulafeezpifapp/.bun/bin/bun run test -- logger.config global-exception.filter app.controller health.controller
/Users/abdulafeezpifapp/.bun/bin/bun run test
/Users/abdulafeezpifapp/.bun/bin/bun run lint
/Users/abdulafeezpifapp/.bun/bin/bun run typecheck
git diff --check
```

Expected: every command exits zero; production files have no diff; generated
coverage output remains ignored.

- [ ] **Step 7: Commit the unit coverage slice**

```bash
git add test/unit/logger.config.spec.ts test/unit/global-exception.filter.spec.ts test/unit/app.controller.spec.ts test/unit/health/health.controller.spec.ts
git commit -m "test(errors): cover logging and exception behavior"
```

---

### Task 2: Make E2E processing deterministic and cover readiness failure

**Files:**

- Modify: `test/processing.e2e-spec.ts`
- Modify: `test/health.e2e-spec.ts`

**Interfaces:**

- Consumes: `PROCESSING_SCHEDULER` and `ProcessingScheduler.schedule()`
- Consumes: `PAYMENT_REPOSITORY` and `PaymentRepository.isReady()`
- Produces: deterministic E2E control over processor callbacks and a real HTTP
  regression for dependency-failure readiness.

- [ ] **Step 1: Add a controlled scheduler to the processing E2E suite**

Import the scheduler contract and replace real-time polling with this local
test double in `test/processing.e2e-spec.ts`:

```ts
import {
  PROCESSING_SCHEDULER,
  type ProcessingScheduler,
  type ScheduledProcessingTask,
} from '../src/payments/processing/processing-scheduler';

interface ControlledTask {
  canceled: boolean;
  delayMs: number;
  run: () => void;
}

class ControlledProcessingScheduler implements ProcessingScheduler {
  private readonly tasks: ControlledTask[] = [];
  private scheduledCount = 0;

  schedule(delayMs: number, run: () => void): ScheduledProcessingTask {
    const task: ControlledTask = { canceled: false, delayMs, run };
    this.tasks.push(task);
    this.scheduledCount += 1;
    return {
      cancel: () => {
        task.canceled = true;
      },
    };
  }

  get totalScheduled(): number {
    return this.scheduledCount;
  }

  pendingDelays(): number[] {
    return this.tasks
      .filter((task) => !task.canceled)
      .map((task) => task.delayMs);
  }

  releaseNext(): number {
    while (this.tasks.length > 0) {
      const task = this.tasks.shift();
      if (task !== undefined && !task.canceled) {
        task.run();
        return task.delayMs;
      }
    }
    throw new Error('No controlled processing task is pending');
  }
}

async function flushProcessorWork(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function releaseProcessing(
  scheduler: ControlledProcessingScheduler,
  terminalDelayMs: number,
): Promise<void> {
  expect(scheduler.pendingDelays()).toEqual([0]);
  expect(scheduler.releaseNext()).toBe(0);
  await flushProcessorWork();
  expect(scheduler.pendingDelays()).toEqual([terminalDelayMs]);
  expect(scheduler.releaseNext()).toBe(terminalDelayMs);
  await flushProcessorWork();
}
```

- [ ] **Step 2: Inject the controlled scheduler into every processing E2E app**

Change `createTestApp` to return both objects and override the existing token:

```ts
async function createTestApp(options: {
  delayMs: number;
  successRate: number;
}): Promise<{
  scheduler: ControlledProcessingScheduler;
  testApp: INestApplication<App>;
}> {
  const scheduler = new ControlledProcessingScheduler();
  const config = new ConfigService({
    NODE_ENV: 'test',
    SERVICE_NAME: 'node-payment-microservice',
    LOG_LEVEL: 'fatal',
    PROCESSING_DELAY_MS: options.delayMs,
    SIMULATED_SUCCESS_RATE: options.successRate,
  });
  const moduleFixture = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(ConfigService)
    .useValue(config)
    .overrideProvider(PROCESSING_SCHEDULER)
    .useValue(scheduler)
    .compile();
  const testApp = moduleFixture.createNestApplication();
  configureApplication(testApp);
  await testApp.init();

  return { scheduler, testApp };
}
```

Delete `waitForTerminalStatus`, its `Date.now()` deadline, and its real
`setTimeout` polling.

- [ ] **Step 3: Drive success, failure, and replay callbacks explicitly**

For each test, destructure `{ scheduler, testApp }`, assign `app = testApp`,
and call the helper with the test's configured delay after the `201` pending
response. The success test uses:

```ts
await releaseProcessing(scheduler, 25);

const terminal = await request(testApp.getHttpServer())
  .get(`/api/v1/payments/${pending.id}`)
  .expect(200);
expect((terminal.body as PaymentResponseBody).data).toMatchObject({
  id: pending.id,
  status: 'succeeded',
});
```

The failure test calls `await releaseProcessing(scheduler, 10)` and asserts
`status: 'failed'`. The replay test also calls it with `10`, asserts
`scheduler.totalScheduled` is `2` after completion, and proves it remains `2`
after the replayed POST. Remove the `PaymentProcessor.schedule` spy and its
import.

- [ ] **Step 4: Add the readiness dependency-failure E2E regression**

Add these imports to `test/health.e2e-spec.ts`:

```ts
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
} from '../src/payments/repositories/payment.repository';
```

Add the test:

```ts
it('returns a safe 503 when the repository readiness check throws', async () => {
  const repository = app.get<PaymentRepository>(PAYMENT_REPOSITORY);
  const readiness = jest
    .spyOn(repository, 'isReady')
    .mockRejectedValueOnce(new Error('database password must stay internal'));
  const requestId = 'health-repository-failure';

  try {
    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .set('X-Request-Id', requestId)
      .expect(503);
    const body = response.body as ErrorResponseBody;

    expect(body).toEqual({
      statusCode: 503,
      code: 'SERVICE_NOT_READY',
      message: 'Service is not ready to accept payment work',
      requestId,
      timestamp: body.timestamp,
      path: '/health/ready',
      details: {
        checks: { repository: 'not_ready', processor: 'ready' },
      },
    });
    expect(Number.isNaN(Date.parse(body.timestamp))).toBe(false);
    expect(JSON.stringify(body)).not.toContain('database password');
  } finally {
    readiness.mockRestore();
  }
});
```

- [ ] **Step 5: Prove the new E2E assertions detect regressions**

Temporarily make `ControlledProcessingScheduler.releaseNext()` skip invoking
`task.run()`. Run the processing E2E suite and capture the expected failure
that no terminal task/state appears. Restore the callback. Then temporarily
make the readiness spy resolve `true`, run the health E2E test, and capture the
expected `200` versus `503` failure. Restore the rejection.

- [ ] **Step 6: Verify no real processing-delay wait remains**

```bash
rg -n "waitForTerminalStatus|Date\.now\(\) \+|setTimeout" test/processing.e2e-spec.ts
```

Expected: no matches.

- [ ] **Step 7: Run Task 2 verification**

```bash
/Users/abdulafeezpifapp/.bun/bin/bun run format
/Users/abdulafeezpifapp/.bun/bin/bun run test:e2e -- processing health
/Users/abdulafeezpifapp/.bun/bin/bun run test:e2e -- --runInBand --detectOpenHandles
/Users/abdulafeezpifapp/.bun/bin/bun run lint
/Users/abdulafeezpifapp/.bun/bin/bun run typecheck
git diff --check
```

Expected: focused and full E2E pass with no open-handle warning; static checks
exit zero.

- [ ] **Step 8: Commit deterministic E2E coverage**

```bash
git add test/processing.e2e-spec.ts test/health.e2e-spec.ts
git commit -m "test(e2e): cover deterministic service flows"
```

---

### Task 3: Enforce coverage scope, reporters, and thresholds

**Files:**

- Modify: `jest.config.cjs`
- Create: `test/unit/coverage-config.spec.ts`

**Interfaces:**

- Consumes: the unit tests completed in Task 1.
- Produces: `bun run test:cov` with explicit source exclusions, reporters, and
  global thresholds.

- [ ] **Step 1: Write the failing coverage-configuration contract**

Create `test/unit/coverage-config.spec.ts`:

```ts
interface CoverageConfig {
  collectCoverageFrom?: string[];
  coverageReporters?: string[];
  coverageThreshold?: {
    global?: {
      branches?: number;
      functions?: number;
      lines?: number;
      statements?: number;
    };
  };
}

const config = jest.requireActual<CoverageConfig>('../../jest.config.cjs');

describe('unit coverage configuration', () => {
  it('collects executable source while excluding framework metadata', () => {
    expect(config.collectCoverageFrom).toEqual([
      'src/**/*.{ts,js}',
      '!src/main.ts',
      '!src/**/*.module.ts',
      '!src/app.setup.ts',
      '!src/openapi/swagger.ts',
      '!src/**/*.dto.ts',
    ]);
  });

  it('generates every required report and enforces global thresholds', () => {
    expect(config.coverageReporters).toEqual(['text', 'lcov', 'html']);
    expect(config.coverageThreshold).toEqual({
      global: {
        branches: 80,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    });
  });
});
```

- [ ] **Step 2: Run the contract and verify RED**

```bash
/Users/abdulafeezpifapp/.bun/bin/bun run test -- coverage-config
```

Expected: FAIL because the three new exclusions, explicit reporters, and
threshold object are absent.

- [ ] **Step 3: Add the exact Jest coverage contract**

Update `jest.config.cjs`:

```js
/** @type {import('jest').Config} */
module.exports = {
  collectCoverageFrom: [
    'src/**/*.{ts,js}',
    '!src/main.ts',
    '!src/**/*.module.ts',
    '!src/app.setup.ts',
    '!src/openapi/swagger.ts',
    '!src/**/*.dto.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85,
    },
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'test/unit/.*\\.spec\\.ts$',
  watchman: false,
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
};
```

- [ ] **Step 4: Run the contract and coverage gate GREEN**

```bash
/Users/abdulafeezpifapp/.bun/bin/bun run test -- coverage-config
/Users/abdulafeezpifapp/.bun/bin/bun run test:cov
```

Expected: the contract passes and all four coverage percentages meet or exceed
their configured global thresholds.

- [ ] **Step 5: Prove the threshold gate fails below a configured minimum**

Temporarily change `branches: 80` to `branches: 100` in both
`jest.config.cjs` and the coverage-config test, then run:

```bash
/Users/abdulafeezpifapp/.bun/bin/bun run test:cov
```

Expected: unit tests pass, but Jest exits non-zero with a global branch
coverage-threshold failure. Restore both values to `80`, rerun
`bun run test:cov`, and confirm it passes. Verify `git diff` contains only the
intended final configuration and test.

- [ ] **Step 6: Verify all three report artifacts and Git exclusion**

```bash
test -f coverage/lcov.info
test -f coverage/index.html
git check-ignore coverage/lcov.info coverage/index.html
git status --short
```

Expected: both files exist, both resolve to the ignored `coverage/` path, and
no generated coverage file appears in normal Git status.

- [ ] **Step 7: Run Task 3 verification**

```bash
/Users/abdulafeezpifapp/.bun/bin/bun run format:check
/Users/abdulafeezpifapp/.bun/bin/bun run lint
/Users/abdulafeezpifapp/.bun/bin/bun run typecheck
/Users/abdulafeezpifapp/.bun/bin/bun run test
/Users/abdulafeezpifapp/.bun/bin/bun run test:e2e
/Users/abdulafeezpifapp/.bun/bin/bun run test:cov
/Users/abdulafeezpifapp/.bun/bin/bun run build
git diff --check
```

Expected: every command exits zero and coverage output satisfies every global
threshold.

- [ ] **Step 8: Commit coverage enforcement**

```bash
git add jest.config.cjs test/unit/coverage-config.spec.ts
git commit -m "test(coverage): enforce coverage thresholds"
```

---

### Task 4: Verify and record Checkpoint 9

**Files:**

- Modify: `CHECKPOINTS.md`

**Interfaces:**

- Consumes: the unit, E2E, and coverage gates from Tasks 1–3.
- Produces: a factual Checkpoint 9 handoff marked `Awaiting user verification`.

- [ ] **Step 1: Run frozen dependency and static verification**

```bash
/Users/abdulafeezpifapp/.bun/bin/bun install --frozen-lockfile
/Users/abdulafeezpifapp/.bun/bin/bun run format:check
/Users/abdulafeezpifapp/.bun/bin/bun run lint
/Users/abdulafeezpifapp/.bun/bin/bun run typecheck
/Users/abdulafeezpifapp/.bun/bin/bun run build
git diff --check
```

Record the exact Bun install/package counts and verify `package.json` and
`bun.lock` remain unchanged.

- [ ] **Step 2: Run all test gates with exact counts**

```bash
/Users/abdulafeezpifapp/.bun/bin/bun run test
/Users/abdulafeezpifapp/.bun/bin/bun run test:e2e
/Users/abdulafeezpifapp/.bun/bin/bun run test:e2e -- --runInBand --detectOpenHandles
/Users/abdulafeezpifapp/.bun/bin/bun run test:cov
```

Record exact suite/test totals, all four coverage percentages, and the absence
of open-handle or unhandled-rejection warnings.

- [ ] **Step 3: Verify deterministic-test and report artifacts**

```bash
rg -n "waitForTerminalStatus|Date\.now\(\) \+|setTimeout" test/processing.e2e-spec.ts
test -f coverage/lcov.info
test -f coverage/index.html
git check-ignore coverage/lcov.info coverage/index.html
git status --short --branch
```

Expected: the search has no matches; LCOV and HTML exist and are ignored; the
working tree is clean before editing checkpoint evidence.

- [ ] **Step 4: Record implementation and verification evidence**

Update only `CHECKPOINTS.md`:

- change Checkpoint 9 from `Not started` to `Awaiting user verification`;
- add implementation evidence for logger/request-ID behavior, global error
  envelopes/logging, deterministic controlled processing E2E, readiness
  dependency failure, the unit-only coverage boundary, all three reporters,
  and all four thresholds;
- add verification evidence dated `2026-08-27` with the exact dependency,
  static, test, coverage, artifact, and open-handle results from Steps 1–3;
- list the design, plan, and Task 1–3 commit hashes and subjects; and
- leave Checkpoints 10 and 11 as `Not started`.

- [ ] **Step 5: Review and commit checkpoint evidence**

```bash
./node_modules/.bin/prettier --write CHECKPOINTS.md
git diff --check
git diff -- CHECKPOINTS.md
git add CHECKPOINTS.md
git diff --cached --check
git commit -m "docs(checkpoints): record checkpoint 9 verification"
```

- [ ] **Step 6: Confirm the handoff state**

```bash
git status --short --branch
git log --oneline --decorate -12
git remote -v
git config --local --get core.sshCommand
```

Expected: branch `codex/feat/payment-microservice`, clean worktree, no remote,
the local SSH command still identifies `aweds-personal`, Checkpoint 9 remains
`Awaiting user verification`, and no Checkpoint 10 work exists. Stop for user
verification.
