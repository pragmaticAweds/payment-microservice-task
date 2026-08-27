import { REQUEST_ID_RESPONSE_HEADERS } from '../../common/openapi/openapi.constants';

export const CREATE_PAYMENT_RESPONSE_HEADERS = {
  ...REQUEST_ID_RESPONSE_HEADERS,
  'X-RateLimit-Limit': {
    description: 'Maximum requests allowed by the general policy window',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Remaining': {
    description: 'General-policy requests remaining in the current window',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Reset': {
    description: 'Seconds until the general policy window resets',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Limit-payment-create': {
    description:
      'Maximum payment creations allowed by the payment-create policy window',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Remaining-payment-create': {
    description:
      'Payment creations remaining in the current payment-create window',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Reset-payment-create': {
    description: 'Seconds until the payment-create policy window resets',
    schema: { type: 'integer' },
  },
  'Idempotency-Replayed': {
    description:
      'Present with value true when the original response is replayed',
    schema: { type: 'string', enum: ['true'] },
  },
};

export const CREATE_PAYMENT_RATE_LIMIT_ERROR_HEADERS = {
  ...REQUEST_ID_RESPONSE_HEADERS,
  'X-RateLimit-Limit': {
    description: 'Maximum requests allowed by the policy that was exceeded',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Remaining': {
    description: 'Requests remaining for the policy that was exceeded',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Reset': {
    description: 'Seconds until the policy that was exceeded resets',
    schema: { type: 'integer' },
  },
  'Retry-After': {
    description: 'Seconds until the exceeded policy accepts another request',
    schema: { type: 'integer' },
  },
  'Retry-After-payment-create': {
    description:
      'Seconds until the payment-create policy accepts another request',
    schema: { type: 'integer' },
  },
} as const;
