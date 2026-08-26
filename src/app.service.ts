import { Injectable } from '@nestjs/common';

export interface ServiceInfo {
  name: string;
  status: 'ok';
}

@Injectable()
export class AppService {
  getServiceInfo(): ServiceInfo {
    return {
      name: 'node-payment-microservice',
      status: 'ok',
    };
  }
}
