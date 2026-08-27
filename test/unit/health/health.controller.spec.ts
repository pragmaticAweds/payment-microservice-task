import 'reflect-metadata';
import { HealthController } from '../../../src/health/health.controller';
import type { HealthReadinessResponse } from '../../../src/health/health.service';
import { HealthService } from '../../../src/health/health.service';

const THROTTLER_SKIP_METADATA = 'THROTTLER:SKIP';

describe('HealthController throttle exemptions', () => {
  it.each(['default', 'payment-create'])(
    'explicitly opts the controller out of the %s policy',
    (policyName) => {
      expect(
        Reflect.getOwnMetadata(
          `${THROTTLER_SKIP_METADATA}${policyName}`,
          HealthController,
        ),
      ).toBe(true);
    },
  );
});

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
