import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { successResponse } from './common/api-response/api-response';
import type { ApiSuccessResponse } from './common/api-response/api-response.types';
import { AppResponseDto } from './app-response.dto';
import { AppService } from './app.service';
import type { ServiceInfo } from './app.types';

@ApiTags('Application')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'Describe the payment service' })
  @ApiOkResponse({
    description: 'Payment service information',
    type: AppResponseDto,
  })
  getServiceInfo(): ApiSuccessResponse<ServiceInfo> {
    return successResponse(this.appService.getServiceInfo());
  }
}
