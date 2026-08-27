export const API_SUCCESS_STATUS = 'success' as const;
export const API_ERROR_STATUS = 'error' as const;

export interface ApiSuccessResponse<T> {
  status: typeof API_SUCCESS_STATUS;
  data: T;
}

export function successResponse<T>(data: T): ApiSuccessResponse<T> {
  return {
    status: API_SUCCESS_STATUS,
    data,
  };
}
