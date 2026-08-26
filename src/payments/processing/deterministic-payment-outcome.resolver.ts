import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentStatus } from '../domain/payment-status';
import {
  type PaymentOutcomeInput,
  type PaymentOutcomeResolver,
  type TerminalPaymentStatus,
} from './payment-outcome-resolver';

@Injectable()
export class DeterministicPaymentOutcomeResolver implements PaymentOutcomeResolver {
  private readonly successRate: number;

  constructor(config: ConfigService) {
    this.successRate = config.getOrThrow<number>('SIMULATED_SUCCESS_RATE');
  }

  resolve(input: PaymentOutcomeInput): TerminalPaymentStatus {
    const seed = `${input.idempotencyKey}:${input.smallestUnitAmount}:${input.currency}`;
    const digest = createHash('sha256').update(seed).digest();
    const score = digest.readUInt32BE(0) / 2 ** 32;

    return score < this.successRate
      ? PaymentStatus.SUCCEEDED
      : PaymentStatus.FAILED;
  }
}
