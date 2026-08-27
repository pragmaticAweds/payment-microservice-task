import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PAYMENT_STATUS } from '../domain/payment/payment.constants';
import type {
  PaymentOutcomeInput,
  PaymentOutcomeResolver,
  TerminalPaymentStatus,
} from './payment-processing.types';

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
      ? PAYMENT_STATUS.SUCCEEDED
      : PAYMENT_STATUS.FAILED;
  }
}
