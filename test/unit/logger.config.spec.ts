import { RequestMethod } from '@nestjs/common';
import { createLoggerOptions } from '../../src/common/logger.config';

describe('createLoggerOptions', () => {
  it('keeps production logs structured and redacts sensitive data', () => {
    const options = createLoggerOptions({
      NODE_ENV: 'production',
      SERVICE_NAME: 'test-payment-service',
      LOG_LEVEL: 'debug',
    });

    expect(options.pinoHttp).toMatchObject({
      level: 'debug',
      transport: undefined,
      redact: {
        censor: '[REDACTED]',
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.headers["idempotency-key"]',
          'req.body.*',
        ],
      },
    });
    expect(options.forRoutes).toEqual([
      { path: '{*path}', method: RequestMethod.ALL },
    ]);
  });
});
