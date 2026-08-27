import { Injectable } from '@nestjs/common';
import type {
  PaymentIdempotencyRecord,
  PaymentIdempotencyRepository,
} from './payment-repository.types';

@Injectable()
export class InMemoryPaymentIdempotencyRepository implements PaymentIdempotencyRepository {
  private readonly records = new Map<string, PaymentIdempotencyRecord>();

  save(record: PaymentIdempotencyRecord): Promise<void> {
    this.records.set(record.key, record);
    return Promise.resolve();
  }

  findByKey(key: string): Promise<PaymentIdempotencyRecord | null> {
    return Promise.resolve(this.records.get(key) ?? null);
  }
}
