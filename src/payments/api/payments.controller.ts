import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../../common/openapi/error-response.dto';
import { PaymentsService } from '../application/payments.service';
import type { Payment } from '../domain/payment';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { PaymentDataResponseDto } from './dto/payment-response.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';

interface PaymentDataResponse {
  data: Payment;
}

const REQUEST_ID_RESPONSE_HEADERS = {
  'x-request-id': {
    description: 'Effective request correlation identifier',
    schema: { type: 'string' },
  },
} as const;

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a pending payment' })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    description: 'Optional caller-provided correlation identifier',
  })
  @ApiCreatedResponse({
    description: 'Payment created in pending state',
    headers: REQUEST_ID_RESPONSE_HEADERS,
    type: PaymentDataResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid payment creation request',
    headers: REQUEST_ID_RESPONSE_HEADERS,
    type: ErrorResponseDto,
  })
  async create(@Body() input: CreatePaymentDto): Promise<PaymentDataResponse> {
    return {
      data: await this.paymentsService.create(input),
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Retrieve a payment' })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    description: 'Optional caller-provided correlation identifier',
  })
  @ApiParam({
    name: 'id',
    description: 'Payment UUID',
    format: 'uuid',
    type: String,
  })
  @ApiOkResponse({
    description: 'Payment found',
    headers: REQUEST_ID_RESPONSE_HEADERS,
    type: PaymentDataResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Malformed payment UUID',
    headers: REQUEST_ID_RESPONSE_HEADERS,
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Payment not found',
    headers: REQUEST_ID_RESPONSE_HEADERS,
    type: ErrorResponseDto,
  })
  async findById(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PaymentDataResponse> {
    return {
      data: await this.paymentsService.findById(id),
    };
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Transition a payment status' })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    description: 'Optional caller-provided correlation identifier',
  })
  @ApiParam({
    name: 'id',
    description: 'Payment UUID',
    format: 'uuid',
    type: String,
  })
  @ApiOkResponse({
    description: 'Payment status transitioned',
    headers: REQUEST_ID_RESPONSE_HEADERS,
    type: PaymentDataResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Malformed UUID or invalid status target',
    headers: REQUEST_ID_RESPONSE_HEADERS,
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({
    description: 'Payment not found',
    headers: REQUEST_ID_RESPONSE_HEADERS,
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Status transition violates the payment state machine',
    headers: REQUEST_ID_RESPONSE_HEADERS,
    type: ErrorResponseDto,
  })
  async transition(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdatePaymentStatusDto,
  ): Promise<PaymentDataResponse> {
    return {
      data: await this.paymentsService.transition(id, input.status),
    };
  }
}
