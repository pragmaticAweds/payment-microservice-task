import type { API_SUCCESS_STATUS } from './api-response.constants';

export interface ApiSuccessResponse<T> {
  status: typeof API_SUCCESS_STATUS;
  data: T;
}
