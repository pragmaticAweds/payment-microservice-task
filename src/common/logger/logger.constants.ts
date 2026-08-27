export const REQUEST_ID_HEADER = 'x-request-id';

export const SENSITIVE_LOG_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["idempotency-key"]',
  'req.body.*',
];
