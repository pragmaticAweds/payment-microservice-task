import { Controller, Get, Inject } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { successResponse } from '../common/api-response/api-response';
import type { ApiSuccessResponse } from '../common/api-response/api-response.types';
import { REQUEST_ID_RESPONSE_HEADERS } from '../common/openapi/openapi.constants';
import {
  HealthLivenessResponseDto,
  HealthNotReadyResponseDto,
  HealthReadinessResponseDto,
} from './dto/health-response.dto';
import { HealthService } from './health.service';
import type { HealthReadinessData } from './health.types';

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
