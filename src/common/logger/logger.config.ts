import { randomUUID } from 'node:crypto';
import { IncomingMessage, ServerResponse } from 'node:http';
import { RequestMethod } from '@nestjs/common';
import { Params } from 'nestjs-pino';
import { REQUEST_ID_HEADER, SENSITIVE_LOG_PATHS } from './logger.constants';
import type { LoggerEnvironment } from './logger.types';

function getRequestId(request: IncomingMessage): string {
  const header = request.headers[REQUEST_ID_HEADER];

  if (typeof header === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(header)) {
    return header;
  }

  return randomUUID();
}

export function createLoggerOptions(environment: LoggerEnvironment): Params {
  return {
    forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
    pinoHttp: {
      name: environment.SERVICE_NAME,
      level: environment.LOG_LEVEL,
      base: {
        environment: environment.NODE_ENV,
        service: environment.SERVICE_NAME,
      },
      autoLogging: environment.NODE_ENV !== 'test',
      formatters: {
        level: (label) => ({ level: label }),
      },
      genReqId: (request: IncomingMessage, response: ServerResponse) => {
        const requestId = getRequestId(request);
        response.setHeader(REQUEST_ID_HEADER, requestId);

        return requestId;
      },
      customLogLevel: (_request, response, error) => {
        if (response.statusCode >= 500 || error) {
          return 'error';
        }

        if (response.statusCode >= 400) {
          return 'warn';
        }

        return 'info';
      },
      redact: {
        paths: SENSITIVE_LOG_PATHS,
        censor: '[REDACTED]',
      },
      transport:
        environment.NODE_ENV === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                singleLine: true,
                translateTime: 'SYS:standard',
              },
            }
          : undefined,
    },
  };
}
