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
import { InvalidPaymentTransitionError } from '../../src/payments/domain/payment/payment.errors';
import { PAYMENT_STATUS } from '../../src/payments/domain/payment/payment.constants';

interface ErrorEnvelope {
  status: 'error';
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
  const warn = jest.fn<void, [unknown, string]>();
  const error = jest.fn<void, [unknown, string]>();
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
  expect(envelope.status).toBe('error');
  expect(Number.isNaN(Date.parse(envelope.timestamp))).toBe(false);
  return envelope;
}

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
        PAYMENT_STATUS.PENDING,
        PAYMENT_STATUS.SUCCEEDED,
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
