import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ErrorResponseDto {
  @ApiProperty({ enum: ['error'], example: 'error' })
  status!: 'error';

  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({ example: 'VALIDATION_ERROR' })
  code!: string;

  @ApiProperty({ example: 'Validation failed' })
  message!: string;

  @ApiProperty({ example: 'assessment-request-123' })
  requestId!: string;

  @ApiProperty({
    example: '2026-08-26T12:00:00.000Z',
    format: 'date-time',
  })
  timestamp!: string;

  @ApiProperty({ example: '/api/v1/payments' })
  path!: string;

  @ApiPropertyOptional({
    description: 'Validation messages or structured business-error context',
    oneOf: [
      {
        type: 'array',
        items: { type: 'string' },
      },
      {
        type: 'object',
        additionalProperties: true,
      },
    ],
  })
  details?: unknown;
}
