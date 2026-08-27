import type { IncomingMessage, ServerResponse } from 'node:http';
import { RequestMethod } from '@nestjs/common';
import { createLoggerOptions } from '../../src/common/logger/logger.config';
import { REQUEST_ID_HEADER } from '../../src/common/logger/logger.constants';

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
});
