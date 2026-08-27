import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [PaymentsModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
