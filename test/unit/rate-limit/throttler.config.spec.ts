import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ThrottlerLimitDetail,
  ThrottlerModuleOptions,
  ThrottlerOptions,
} from '@nestjs/throttler';
import { PaymentCreationRateLimit } from '../../../src/common/rate-limit/payment-creation-rate-limit.decorator';
import { ApiThrottlerGuard } from '../../../src/common/rate-limit/api-throttler.guard';
import {
  DEFAULT_THROTTLER,
  PAYMENT_CREATE_THROTTLER,
  PAYMENT_CREATION_RATE_LIMIT_METADATA,
} from '../../../src/common/rate-limit/rate-limit.constants';
import { createThrottlerOptions } from '../../../src/common/rate-limit/throttler.config';

class TestHandlers {
  @PaymentCreationRateLimit()
  marked(this: void): void {}

  unmarked(this: void): void {}
}

class TestApiThrottlerGuard extends ApiThrottlerGuard {
  throwForTest(
    context = defaultHttpExecutionContext(),
    throttlerLimitDetail = defaultThrottlerLimitDetail(),
  ): Promise<void> {
    return this.throwThrottlingException(context, throttlerLimitDetail);
  }
}

function defaultHttpExecutionContext(): ExecutionContext {
  return {
    switchToHttp: () => ({
      getResponse: () => ({ header: () => undefined }),
    }),
  } as unknown as ExecutionContext;
}

function defaultThrottlerLimitDetail(): ThrottlerLimitDetail {
  return {
    isBlocked: true,
    key: 'default-key',
    limit: 1,
    timeToBlockExpire: 1,
    timeToExpire: 1,
    totalHits: 2,
    tracker: '127.0.0.1',
    ttl: 1000,
  };
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
  it('sets standard headers for the policy that exceeded its limit', async () => {
    const guard = Object.create(
      TestApiThrottlerGuard.prototype,
    ) as TestApiThrottlerGuard;
    const header = jest.fn();
    const context = {
      switchToHttp: () => ({
        getResponse: () => ({ header }),
      }),
    } as unknown as ExecutionContext;
    const throttlerLimitDetail: ThrottlerLimitDetail = {
      isBlocked: true,
      key: 'payment-create-key',
      limit: 2,
      timeToBlockExpire: 7,
      timeToExpire: 9,
      totalHits: 5,
      tracker: '127.0.0.1',
      ttl: 5000,
    };

    await expect(
      guard.throwForTest(context, throttlerLimitDetail),
    ).rejects.toBeInstanceOf(HttpException);

    expect(header).toHaveBeenCalledTimes(4);
    expect(header).toHaveBeenNthCalledWith(1, 'Retry-After', 7);
    expect(header).toHaveBeenNthCalledWith(2, 'X-RateLimit-Limit', 2);
    expect(header).toHaveBeenNthCalledWith(3, 'X-RateLimit-Remaining', 0);
    expect(header).toHaveBeenNthCalledWith(4, 'X-RateLimit-Reset', 9);
  });

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
