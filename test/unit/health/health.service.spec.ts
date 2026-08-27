import { ServiceUnavailableException } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { HealthController } from '../../../src/health/health.controller';
import { HealthService } from '../../../src/health/health.service';
import { PaymentProcessor } from '../../../src/payments/processing/payment-processor';
import type { PaymentRepository } from '../../../src/payments/repositories/payment.repository';

interface HealthLogMetadata {
  event?: unknown;
  dependency?: unknown;
  checks?: unknown;
  err?: unknown;
}

type HealthLog = (metadata: HealthLogMetadata, message: string) => void;

describe('HealthService', () => {
  let repositoryReady: jest.MockedFunction<PaymentRepository['isReady']>;
  let processorReady: jest.MockedFunction<PaymentProcessor['isReady']>;
  let warn: jest.MockedFunction<HealthLog>;
  let error: jest.MockedFunction<HealthLog>;
  let logger: PinoLogger;
  let service: HealthService;

  beforeEach(() => {
    repositoryReady = jest.fn().mockResolvedValue(true);
    processorReady = jest.fn().mockReturnValue(true);
    warn = jest.fn();
    error = jest.fn();
    logger = { warn, error } as unknown as PinoLogger;
    service = new HealthService(
      { isReady: repositoryReady } satisfies Pick<PaymentRepository, 'isReady'>,
      { isReady: processorReady } satisfies Pick<PaymentProcessor, 'isReady'>,
      logger,
    );
  });

  function expectNotReadyException(
    exception: unknown,
    checks: {
      repository: 'ready' | 'not_ready';
      processor: 'ready' | 'not_ready';
    },
  ): void {
    expect(exception).toBeInstanceOf(ServiceUnavailableException);
    if (!(exception instanceof ServiceUnavailableException)) {
      throw new Error('Expected ServiceUnavailableException');
    }

    expect(exception.getResponse()).toEqual({
      code: 'SERVICE_NOT_READY',
      message: 'Service is not ready to accept payment work',
      details: { checks },
    });
  }

  async function captureReadinessException(): Promise<unknown> {
    try {
      await service.readiness();
    } catch (exception) {
      return exception;
    }

    throw new Error('Expected readiness to reject');
  }

  it('returns ready when both dependencies report ready', async () => {
    await expect(service.readiness()).resolves.toEqual({
      data: {
        status: 'ready',
        checks: { repository: 'ready', processor: 'ready' },
      },
    });
    expect(repositoryReady).toHaveBeenCalledTimes(1);
    expect(processorReady).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('reports the repository as not ready when it returns false', async () => {
    repositoryReady.mockResolvedValue(false);

    expectNotReadyException(await captureReadinessException(), {
      repository: 'not_ready',
      processor: 'ready',
    });
    expect(warn).toHaveBeenCalledWith(
      {
        event: 'health.not_ready',
        checks: { repository: 'not_ready', processor: 'ready' },
      },
      'Service is not ready',
    );
  });

  it('reports the processor as not ready when it returns false', async () => {
    processorReady.mockReturnValue(false);

    expectNotReadyException(await captureReadinessException(), {
      repository: 'ready',
      processor: 'not_ready',
    });
    expect(warn).toHaveBeenCalledWith(
      {
        event: 'health.not_ready',
        checks: { repository: 'ready', processor: 'not_ready' },
      },
      'Service is not ready',
    );
  });

  it('reports both dependencies as not ready when both return false', async () => {
    repositoryReady.mockResolvedValue(false);
    processorReady.mockReturnValue(false);

    expectNotReadyException(await captureReadinessException(), {
      repository: 'not_ready',
      processor: 'not_ready',
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('catches a repository failure while still evaluating the processor', async () => {
    const repositoryError = new Error('repository credentials leaked');
    repositoryReady.mockRejectedValue(repositoryError);
    processorReady.mockReturnValue(false);

    const exception = await captureReadinessException();

    expectNotReadyException(exception, {
      repository: 'not_ready',
      processor: 'not_ready',
    });
    expect(processorReady).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      {
        event: 'health.readiness_dependency_failed',
        dependency: 'repository',
        err: repositoryError,
      },
      'Readiness dependency check failed',
    );
    expect(
      JSON.stringify((exception as ServiceUnavailableException).getResponse()),
    ).not.toContain('repository credentials leaked');
  });

  it('catches a processor failure while retaining the repository result', async () => {
    const processorError = new Error('processor implementation detail');
    processorReady.mockImplementation(() => {
      throw processorError;
    });

    const exception = await captureReadinessException();

    expectNotReadyException(exception, {
      repository: 'ready',
      processor: 'not_ready',
    });
    expect(repositoryReady).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      {
        event: 'health.readiness_dependency_failed',
        dependency: 'processor',
        err: processorError,
      },
      'Readiness dependency check failed',
    );
  });

  it('normalizes a non-Error dependency failure before logging it', async () => {
    repositoryReady.mockRejectedValue('unsafe thrown value');

    await captureReadinessException();

    const metadata = error.mock.calls[0]?.[0];
    expect(metadata).toMatchObject({
      event: 'health.readiness_dependency_failed',
      dependency: 'repository',
    });
    expect(metadata.err).toBeInstanceOf(Error);
  });
});

describe('HealthController', () => {
  it('reports liveness without evaluating readiness dependencies', () => {
    const healthService = {
      readiness: jest.fn(),
    } satisfies Pick<HealthService, 'readiness'>;
    const controller = new HealthController(healthService);

    expect(controller.liveness()).toEqual({ data: { status: 'live' } });
    expect(healthService.readiness).not.toHaveBeenCalled();
  });
});
