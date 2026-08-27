import type { API_ERROR_STATUS } from '../api-response/api-response.constants';

export interface MappedApplicationError {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
}

export interface ErrorEnvelope {
  status: typeof API_ERROR_STATUS;
  statusCode: number;
  code: string;
  message: string;
  requestId: string;
  timestamp: string;
  path: string;
  details?: unknown;
}

export interface HttpErrorBody {
  code?: unknown;
  details?: unknown;
  error?: unknown;
  message?: unknown;
}
