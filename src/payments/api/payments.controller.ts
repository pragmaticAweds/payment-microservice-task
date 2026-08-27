import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
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
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ErrorResponseDto } from '../../common/openapi/error-response.dto';
import { PaymentCreationRateLimit } from '../../common/rate-limit/payment-creation-rate-limit.decorator';
import { PaymentCreationIdempotencyService } from '../application/payment-creation-idempotency.service';
import { PaymentsService } from '../application/payments.service';
import type { Payment } from '../domain/payment';
import { PaymentProcessor } from '../processing/payment-processor';
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

const CREATE_PAYMENT_RESPONSE_HEADERS = {
  ...REQUEST_ID_RESPONSE_HEADERS,
  'X-RateLimit-Limit': {
    description: 'Maximum requests allowed by the general policy window',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Remaining': {
    description: 'General-policy requests remaining in the current window',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Reset': {
    description: 'Seconds until the general policy window resets',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Limit-payment-create': {
    description:
      'Maximum payment creations allowed by the payment-create policy window',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Remaining-payment-create': {
    description:
      'Payment creations remaining in the current payment-create window',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Reset-payment-create': {
    description: 'Seconds until the payment-create policy window resets',
    schema: { type: 'integer' },
  },
  'Idempotency-Replayed': {
    description:
      'Present with value true when the original response is replayed',
    schema: { type: 'string', enum: ['true'] },
  },
};

const CREATE_PAYMENT_RATE_LIMIT_ERROR_HEADERS = {
  ...REQUEST_ID_RESPONSE_HEADERS,
  'X-RateLimit-Limit': {
    description: 'Maximum requests allowed by the policy that was exceeded',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Remaining': {
    description: 'Requests remaining for the policy that was exceeded',
    schema: { type: 'integer' },
  },
  'X-RateLimit-Reset': {
    description: 'Seconds until the policy that was exceeded resets',
    schema: { type: 'integer' },
  },
  'Retry-After': {
    description: 'Seconds until the exceeded policy accepts another request',
    schema: { type: 'integer' },
  },
  'Retry-After-payment-create': {
    description:
      'Seconds until the payment-create policy accepts another request',
    schema: { type: 'integer' },
  },
} as const;

@ApiTags('Payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly idempotencyService: PaymentCreationIdempotencyService,
    private readonly paymentProcessor: PaymentProcessor,
  ) {}

  @Post()
  @PaymentCreationRateLimit()
  @ApiOperation({ summary: 'Create a pending payment' })
  @ApiHeader({
    name: 'X-Request-Id',
    required: false,
    description: 'Optional caller-provided correlation identifier',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description:
      'Unique payment-creation key using 1 to 128 letters, numbers, dots, underscores, colons, or hyphens',
  })
  @ApiCreatedResponse({
    description: 'Payment created in pending state',
    headers: CREATE_PAYMENT_RESPONSE_HEADERS,
    type: PaymentDataResponseDto,
  })
  @ApiBadRequestResponse({
    description: 'Invalid payment creation request',
    headers: REQUEST_ID_RESPONSE_HEADERS,
    type: ErrorResponseDto,
  })
  @ApiConflictResponse({
    description: 'Idempotency key was previously used with a different request',
    headers: REQUEST_ID_RESPONSE_HEADERS,
    type: ErrorResponseDto,
  })
  @ApiTooManyRequestsResponse({
    description: 'Payment creation rate limit exceeded',
    headers: CREATE_PAYMENT_RATE_LIMIT_ERROR_HEADERS,
    type: ErrorResponseDto,
  })
  async create(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() input: CreatePaymentDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PaymentDataResponse> {
    const result = await this.paymentProcessor.runWithAdmission((admission) =>
      this.idempotencyService.execute(
        idempotencyKey,
        input,
        async (validatedIdempotencyKey) => {
          const payment = await this.paymentsService.create(input);
          admission.schedule(payment, validatedIdempotencyKey);
          return payment;
        },
      ),
    );

    if (result.replayed) {
      response.setHeader('Idempotency-Replayed', 'true');
    }

    return {
      data: result.payment,
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
