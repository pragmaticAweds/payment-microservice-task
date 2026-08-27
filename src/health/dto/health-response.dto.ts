import { ApiProperty } from '@nestjs/swagger';

export class HealthLivenessDataDto {
  @ApiProperty({ enum: ['live'], example: 'live' })
  status!: 'live';
}

export class HealthLivenessResponseDto {
  @ApiProperty({ enum: ['success'], example: 'success' })
  status!: 'success';

  @ApiProperty({ type: HealthLivenessDataDto })
  data!: HealthLivenessDataDto;
}

export class HealthReadinessChecksDto {
  @ApiProperty({ enum: ['ready', 'not_ready'], example: 'ready' })
  repository!: 'ready' | 'not_ready';

  @ApiProperty({ enum: ['ready', 'not_ready'], example: 'ready' })
  processor!: 'ready' | 'not_ready';
}

export class HealthReadinessDataDto {
  @ApiProperty({ enum: ['ready'], example: 'ready' })
  status!: 'ready';

  @ApiProperty({ type: HealthReadinessChecksDto })
  checks!: HealthReadinessChecksDto;
}

export class HealthReadinessResponseDto {
  @ApiProperty({ enum: ['success'], example: 'success' })
  status!: 'success';

  @ApiProperty({ type: HealthReadinessDataDto })
  data!: HealthReadinessDataDto;
}

export class HealthNotReadyDetailsDto {
  @ApiProperty({ type: HealthReadinessChecksDto })
  checks!: HealthReadinessChecksDto;
}

export class HealthNotReadyResponseDto {
  @ApiProperty({ enum: ['error'], example: 'error' })
  status!: 'error';

  @ApiProperty({ example: 503 })
  statusCode!: number;

  @ApiProperty({ enum: ['SERVICE_NOT_READY'], example: 'SERVICE_NOT_READY' })
  code!: 'SERVICE_NOT_READY';

  @ApiProperty({ example: 'Service is not ready to accept payment work' })
  message!: string;

  @ApiProperty({ example: 'assessment-request-123' })
  requestId!: string;

  @ApiProperty({
    example: '2026-08-26T12:00:00.000Z',
    format: 'date-time',
  })
  timestamp!: string;

  @ApiProperty({ example: '/api/v1/health/ready' })
  path!: string;

  @ApiProperty({ type: HealthNotReadyDetailsDto })
  details!: HealthNotReadyDetailsDto;
}
