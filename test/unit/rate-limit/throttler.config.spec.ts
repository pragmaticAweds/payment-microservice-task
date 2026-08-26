import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
  ThrottlerOptions,
} from '@nestjs/throttler';
import {
  PAYMENT_CREATION_RATE_LIMIT_METADATA,
  PaymentCreationRateLimit,
} from '../../../src/common/rate-limit/payment-creation-rate-limit.decorator';
import { ApiThrottlerGuard } from '../../../src/common/rate-limit/api-throttler.guard';
import {
  createThrottlerOptions,
  DEFAULT_THROTTLER,
  PAYMENT_CREATE_THROTTLER,
} from '../../../src/common/rate-limit/throttler.config';

class TestHandlers {
  @PaymentCreationRateLimit()
  marked(this: void): void {}

  unmarked(this: void): void {}
}

class TestApiThrottlerGuard extends ApiThrottlerGuard {
  throwForTest(): Promise<void> {
    return this.throwThrottlingException(
      {} as ExecutionContext,
      {} as ThrottlerLimitDetail,
    );
  }
}

function getHandler(name: 'marked' | 'unmarked'): () => void {
  return TestHandlers.prototype[name];
}

function executionContextFor(handler: () => void): ExecutionContext {
  return {
    getHandler: () => handler,
  } as unknown as ExecutionContext;
}

function getPolicies(options: ThrottlerModuleOptions): ThrottlerOptions[] {
  return Array.isArray(options) ? options : options.throttlers;
}

describe('createThrottlerOptions', () => {
  it('builds named policies from validated runtime configuration', () => {
    const config = new ConfigService({
      THROTTLE_TTL_MS: 5000,
      THROTTLE_LIMIT: 4,
      PAYMENT_CREATE_THROTTLE_LIMIT: 2,
    });

    const options = getPolicies(createThrottlerOptions(config));

    expect(options).toHaveLength(2);
    expect(options[0]).toMatchObject({
      name: DEFAULT_THROTTLER,
      ttl: 5000,
      limit: 4,
    });
    expect(options[1]).toMatchObject({
      name: PAYMENT_CREATE_THROTTLER,
      ttl: 5000,
      limit: 2,
    });
  });

  it('opts marked handlers into the payment creation policy only', () => {
    const config = new ConfigService({
      THROTTLE_TTL_MS: 5000,
      THROTTLE_LIMIT: 4,
      PAYMENT_CREATE_THROTTLE_LIMIT: 2,
    });
    const options = getPolicies(createThrottlerOptions(config));
    const paymentPolicy = options[1];

    expect(paymentPolicy.skipIf).toBeDefined();
    expect(
      paymentPolicy.skipIf?.(executionContextFor(getHandler('marked'))),
    ).toBe(false);
    expect(
      paymentPolicy.skipIf?.(executionContextFor(getHandler('unmarked'))),
    ).toBe(true);
    expect(
      Reflect.getMetadata(
        PAYMENT_CREATION_RATE_LIMIT_METADATA,
        getHandler('marked'),
      ),
    ).toBe(true);
  });
});

describe('ApiThrottlerGuard', () => {
  it('throws a stable 429 HTTP exception', async () => {
    const guard = Object.create(
      TestApiThrottlerGuard.prototype,
    ) as TestApiThrottlerGuard;

    let thrown: unknown;

    try {
      await guard.throwForTest();
    } catch (exception) {
      thrown = exception;
    }

    expect(thrown).toBeInstanceOf(HttpException);
    const httpException = thrown as HttpException;
    expect(httpException.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(httpException.getResponse()).toEqual({
      code: 'TOO_MANY_REQUESTS',
      message: 'Rate limit exceeded',
    });
  });
});
