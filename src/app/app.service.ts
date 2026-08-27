import { Injectable } from '@nestjs/common';
import type { ServiceInfo } from './app.types';

@Injectable()
export class AppService {
  getServiceInfo(): ServiceInfo {
    return {
      name: 'node-payment-microservice',
      status: 'ok',
    };
  }
}
