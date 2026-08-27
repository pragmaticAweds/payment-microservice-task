import { API_SUCCESS_STATUS } from './api-response.constants';
import type { ApiSuccessResponse } from './api-response.types';

export function successResponse<T>(data: T): ApiSuccessResponse<T> {
  return {
    status: API_SUCCESS_STATUS,
    data,
  };
}
