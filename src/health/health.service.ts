import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import { PaymentProcessor } from '../payments/processing/payment-processor';
import {
  PAYMENT_REPOSITORY,
  type PaymentRepository,
} from '../payments/repositories/payment.repository';

export type HealthDependencyStatus = 'ready' | 'not_ready';

export interface HealthReadinessChecks {
  repository: HealthDependencyStatus;
  processor: HealthDependencyStatus;
}

export interface HealthReadinessData {
  status: 'ready';
  checks: HealthReadinessChecks;
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(PAYMENT_REPOSITORY)
    private readonly repository: Pick<PaymentRepository, 'isReady'>,
    @Inject(PaymentProcessor)
    private readonly processor: Pick<PaymentProcessor, 'isReady'>,
    private readonly logger: PinoLogger,
  ) {}

  async readiness(): Promise<HealthReadinessData> {
    const [repository, processor] = await Promise.all([
      this.checkRepository(),
      this.checkProcessor(),
    ]);
    const checks: HealthReadinessChecks = { repository, processor };

    if (repository === 'not_ready' || processor === 'not_ready') {
      this.logger.warn(
        {
          event: 'health.not_ready',
          checks,
        },
        'Service is not ready',
      );
      throw new ServiceUnavailableException({
        code: 'SERVICE_NOT_READY',
        message: 'Service is not ready to accept payment work',
        details: { checks },
      });
    }

    return {
      status: 'ready',
      checks,
    };
  }

  private async checkRepository(): Promise<HealthDependencyStatus> {
    try {
      return (await this.repository.isReady()) ? 'ready' : 'not_ready';
    } catch (error) {
      this.logDependencyFailure('repository', error);
      return 'not_ready';
    }
  }

  private checkProcessor(): Promise<HealthDependencyStatus> {
    try {
      return Promise.resolve(this.processor.isReady() ? 'ready' : 'not_ready');
    } catch (error) {
      this.logDependencyFailure('processor', error);
      return Promise.resolve('not_ready');
    }
  }

  private logDependencyFailure(
    dependency: 'repository' | 'processor',
    error: unknown,
  ): void {
    this.logger.error(
      {
        event: 'health.readiness_dependency_failed',
        dependency,
        err:
          error instanceof Error
            ? error
            : new Error('Non-Error readiness dependency failure'),
      },
      'Readiness dependency check failed',
    );
  }
}
