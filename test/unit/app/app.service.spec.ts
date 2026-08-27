import { AppService } from '../../../src/app/app.service';

describe('AppService', () => {
  it('identifies the running payment microservice', () => {
    const service = new AppService();

    expect(service.getServiceInfo()).toEqual({
      name: 'node-payment-microservice',
      status: 'ok',
    });
  });
});
