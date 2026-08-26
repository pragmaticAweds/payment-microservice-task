import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { createLoggerOptions } from './logger.config';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createLoggerOptions({
          NODE_ENV: config.getOrThrow('NODE_ENV'),
          SERVICE_NAME: config.getOrThrow('SERVICE_NAME'),
          LOG_LEVEL: config.getOrThrow('LOG_LEVEL'),
        }),
    }),
  ],
})
export class CommonModule {}
