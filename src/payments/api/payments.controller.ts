import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { PaymentsService } from '../application/payments.service';
import type { Payment } from '../domain/payment';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { UpdatePaymentStatusDto } from './dto/update-payment-status.dto';

interface PaymentDataResponse {
  data: Payment;
}

@Controller('payments')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post()
  async create(@Body() input: CreatePaymentDto): Promise<PaymentDataResponse> {
    return {
      data: await this.paymentsService.create(input),
    };
  }

  @Get(':id')
  async findById(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<PaymentDataResponse> {
    return {
      data: await this.paymentsService.findById(id),
    };
  }

  @Patch(':id/status')
  async transition(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() input: UpdatePaymentStatusDto,
  ): Promise<PaymentDataResponse> {
    return {
      data: await this.paymentsService.transition(id, input.status),
    };
  }
}
