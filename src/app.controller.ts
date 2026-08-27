import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  successResponse,
  type ApiSuccessResponse,
} from './common/http/api-response';
import { AppResponseDto } from './app-response.dto';
import { AppService, type ServiceInfo } from './app.service';

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
