import { Controller, Get, Inject } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import {
  successResponse,
  type ApiSuccessResponse,
} from '../common/http/api-response';
import {
  HealthLivenessResponseDto,
  HealthNotReadyResponseDto,
  HealthReadinessResponseDto,
} from './dto/health-response.dto';
import { HealthService, type HealthReadinessData } from './health.service';

const REQUEST_ID_RESPONSE_HEADERS = {
  'x-request-id': {
    description: 'Effective request correlation identifier',
    schema: { type: 'string' },
  },
} as const;

@ApiTags('Health')
@Controller('health')
@SkipThrottle({ default: true, 'payment-create': true })
export class HealthController {
  constructor(
    @Inject(HealthService)
    private readonly healthService: Pick<HealthService, 'readiness'>,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Report process liveness' })
  @ApiOkResponse({
    description: 'The service process is live',
    headers: REQUEST_ID_RESPONSE_HEADERS,
    type: HealthLivenessResponseDto,
  })
  liveness(): ApiSuccessResponse<{ status: 'live' }> {
    return successResponse({ status: 'live' });
  }

  @Get('ready')
  @ApiOperation({ summary: 'Report payment-work readiness' })
  @ApiOkResponse({
    description: 'The service is ready to accept payment work',
    headers: REQUEST_ID_RESPONSE_HEADERS,
    type: HealthReadinessResponseDto,
  })
  @ApiServiceUnavailableResponse({
    description: 'The service is not ready to accept payment work',
    headers: REQUEST_ID_RESPONSE_HEADERS,
    type: HealthNotReadyResponseDto,
  })
  async readiness(): Promise<ApiSuccessResponse<HealthReadinessData>> {
    return successResponse(await this.healthService.readiness());
  }
}
