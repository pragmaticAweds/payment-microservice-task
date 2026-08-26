import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { RuntimeConfigModule } from '../../config/runtime-config.module';
import { ApiThrottlerGuard } from './api-throttler.guard';
import { createThrottlerOptions } from './throttler.config';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [RuntimeConfigModule],
      inject: [ConfigService],
      useFactory: createThrottlerOptions,
    }),
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ApiThrottlerGuard,
    },
  ],
})
export class RateLimitModule {}
