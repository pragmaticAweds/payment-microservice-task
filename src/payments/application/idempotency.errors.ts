export class InvalidIdempotencyKeyError extends Error {
  readonly code = 'INVALID_IDEMPOTENCY_KEY';

  constructor() {
    super(
      'Idempotency-Key must contain 1 to 128 letters, numbers, dots, underscores, colons, or hyphens',
    );
    this.name = InvalidIdempotencyKeyError.name;
  }
}

export class IdempotencyConflictError extends Error {
  readonly code = 'IDEMPOTENCY_CONFLICT';

  constructor() {
    super('Idempotency-Key has already been used with a different request');
    this.name = IdempotencyConflictError.name;
  }
}
