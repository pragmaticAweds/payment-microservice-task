import { Module } from '@nestjs/common';
import { CommonModule } from './common/common.module';
import { RuntimeConfigModule } from './config/runtime-config.module';
import { HealthModule } from './health/health.module';
import { PaymentsModule } from './payments/payments.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [CommonModule, RuntimeConfigModule, HealthModule, PaymentsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
