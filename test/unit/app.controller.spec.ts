import { AppController } from '../../src/app.controller';
import type { ServiceInfo } from '../../src/app.service';

describe('AppController', () => {
  it('returns service information from AppService', () => {
    const serviceInfo: ServiceInfo = {
      name: 'node-payment-microservice',
      status: 'ok',
    };
    const getServiceInfo = jest.fn().mockReturnValue(serviceInfo);
    const controller = new AppController({ getServiceInfo });

    expect(controller.getServiceInfo()).toBe(serviceInfo);
    expect(getServiceInfo).toHaveBeenCalledTimes(1);
  });
});
