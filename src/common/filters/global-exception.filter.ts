import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';

interface ErrorEnvelope {
  statusCode: number;
  code: string;
  message: string;
  requestId: string;
  timestamp: string;
  path: string;
  details?: unknown;
}

interface HttpErrorBody {
  code?: unknown;
  details?: unknown;
  error?: unknown;
  message?: unknown;
}

function normalizeErrorCode(value: string): string {
  return value
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function getRequestId(request: Request): string {
  if (typeof request.id === 'string' || typeof request.id === 'number') {
    return String(request.id);
  }

  const header = request.headers['x-request-id'];
  return typeof header === 'string' ? header : 'unavailable';
}

function getHttpError(
  exception: HttpException,
): Pick<ErrorEnvelope, 'code' | 'details' | 'message'> {
  const statusCode = exception.getStatus();
  const response = exception.getResponse();

  if (typeof response === 'string') {
    return {
      code: HttpStatus[statusCode] ?? 'HTTP_ERROR',
      message: response,
    };
  }

  const body = response as HttpErrorBody;
  const isValidationError = Array.isArray(body.message);
  const fallbackCode =
    typeof body.error === 'string'
      ? normalizeErrorCode(body.error)
      : (HttpStatus[statusCode] ?? 'HTTP_ERROR');

  return {
    code:
      typeof body.code === 'string'
        ? normalizeErrorCode(body.code)
        : isValidationError
          ? 'VALIDATION_ERROR'
          : fallbackCode,
    message:
      typeof body.message === 'string'
        ? body.message
        : isValidationError
          ? 'Validation failed'
          : 'Request failed',
    ...(body.details !== undefined
      ? { details: body.details }
      : isValidationError
        ? { details: body.message }
        : {}),
  };
}

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(
    @InjectPinoLogger(GlobalExceptionFilter.name)
    private readonly logger: PinoLogger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const requestId = getRequestId(request);
    const isHttpException = exception instanceof HttpException;
    const statusCode = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;
    const error = isHttpException
      ? getHttpError(exception)
      : {
          code: 'INTERNAL_SERVER_ERROR',
          message: 'An unexpected error occurred',
        };

    if (!isHttpException) {
      this.logger.error(
        {
          err:
            exception instanceof Error
              ? exception
              : new Error('A non-Error value was thrown'),
          method: request.method,
          path: request.originalUrl,
          requestId,
        },
        'Unhandled request exception',
      );
    }

    const envelope: ErrorEnvelope = {
      statusCode,
      ...error,
      requestId,
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    };

    response.status(statusCode).json(envelope);
  }
}
