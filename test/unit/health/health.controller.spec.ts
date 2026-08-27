import 'reflect-metadata';
import { HealthController } from '../../../src/health/health.controller';

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
