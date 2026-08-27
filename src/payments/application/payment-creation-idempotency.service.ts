import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { Payment } from '../domain/payment/payment';
import type { CreatePaymentInput } from '../domain/payment/payment.types';
import {
  PAYMENT_IDEMPOTENCY_REPOSITORY,
  type PaymentIdempotencyRepository,
} from '../repositories/payment-idempotency.repository';
import {
  IdempotencyConflictError,
  InvalidIdempotencyKeyError,
} from './idempotency.errors';

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export interface IdempotentPaymentCreationResult {
  payment: Payment;
  replayed: boolean;
}

interface InFlightCreation {
  fingerprint: string;
  promise: Promise<IdempotentPaymentCreationResult>;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fingerprintPaymentInput(input: CreatePaymentInput): string {
  const normalizedDescription = input.description?.trim();
  const canonicalPayload = JSON.stringify({
    currency: input.currency,
    description:
      normalizedDescription === undefined || normalizedDescription.length === 0
        ? null
        : normalizedDescription,
    merchantReference: input.merchantReference.trim(),
    smallestUnitAmount: input.smallestUnitAmount,
  });

  return sha256(canonicalPayload);
}

function parseIdempotencyKey(value: string | undefined): string {
  if (value === undefined || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new InvalidIdempotencyKeyError();
  }

  return value;
}

@Injectable()
export class PaymentCreationIdempotencyService {
  private readonly inFlightCreations = new Map<string, InFlightCreation>();

  constructor(
    @Inject(PAYMENT_IDEMPOTENCY_REPOSITORY)
    private readonly repository: PaymentIdempotencyRepository,
    private readonly logger: PinoLogger,
  ) {}

  async execute(
    idempotencyKey: string | undefined,
    input: CreatePaymentInput,
    createPayment: (validatedIdempotencyKey: string) => Promise<Payment>,
  ): Promise<IdempotentPaymentCreationResult> {
    const key = parseIdempotencyKey(idempotencyKey);
    const fingerprint = fingerprintPaymentInput(input);
    const keyHash = sha256(key);
    const activeCreation = this.inFlightCreations.get(key);

    if (activeCreation !== undefined) {
      this.assertMatchingFingerprint(
        activeCreation.fingerprint,
        fingerprint,
        keyHash,
      );
      const result = await activeCreation.promise;
      this.logReplay(keyHash, result.payment.id);
      return { payment: result.payment, replayed: true };
    }

    const promise = this.resolveOrCreate(
      key,
      keyHash,
      fingerprint,
      createPayment,
    );
    this.inFlightCreations.set(key, { fingerprint, promise });

    try {
      return await promise;
    } finally {
      const current = this.inFlightCreations.get(key);
      if (current?.promise === promise) {
        this.inFlightCreations.delete(key);
      }
    }
  }

  private async resolveOrCreate(
    key: string,
    keyHash: string,
    fingerprint: string,
    createPayment: (validatedIdempotencyKey: string) => Promise<Payment>,
  ): Promise<IdempotentPaymentCreationResult> {
    const existingRecord = await this.repository.findByKey(key);

    if (existingRecord !== null) {
      this.assertMatchingFingerprint(
        existingRecord.fingerprint,
        fingerprint,
        keyHash,
      );
      this.logReplay(keyHash, existingRecord.paymentId);
      return { payment: existingRecord.response, replayed: true };
    }

    const payment = await createPayment(key);
    await this.repository.save({
      key,
      fingerprint,
      paymentId: payment.id,
      response: payment,
      createdAt: new Date().toISOString(),
    });
    this.logger.info(
      {
        event: 'idempotency.record_created',
        keyHash,
        paymentId: payment.id,
      },
      'Idempotency record created',
    );

    return { payment, replayed: false };
  }

  private assertMatchingFingerprint(
    expected: string,
    received: string,
    keyHash: string,
  ): void {
    if (expected === received) {
      return;
    }

    this.logger.warn(
      {
        event: 'idempotency.conflict',
        keyHash,
      },
      'Idempotency key reused with a different request',
    );
    throw new IdempotencyConflictError();
  }

  private logReplay(keyHash: string, paymentId: string): void {
    this.logger.info(
      {
        event: 'idempotency.replayed',
        keyHash,
        paymentId,
      },
      'Idempotent payment creation replayed',
    );
  }
}
