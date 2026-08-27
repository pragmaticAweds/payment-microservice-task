import { PinoLogger } from 'nestjs-pino';
import {
  createStartupLogContext,
  listenAndLogStartup,
} from '../../../src/startup/startup-log';

describe('createStartupLogContext', () => {
  it('reports the effective port and versioned API URL', () => {
    expect(createStartupLogContext(4040)).toEqual({
      event: 'service.started',
      port: 4040,
      apiUrl: 'http://localhost:4040/api/v1',
    });
  });

  it('uses an explicit port override in the URL', () => {
    expect(createStartupLogContext(5050).apiUrl).toBe(
      'http://localhost:5050/api/v1',
    );
  });

  it('resolves the scoped logger after the server binds', async () => {
    const events: string[] = [];
    const info = jest.fn(() => events.push('logged'));
    const logger = {
      info,
    } as unknown as PinoLogger;
    const app = {
      listen: jest.fn(() => {
        events.push('listened');
        return Promise.resolve();
      }),
      resolve: jest.fn((token: typeof PinoLogger) => {
        expect(token).toBe(PinoLogger);
        events.push('resolved');
        return Promise.resolve(logger);
      }),
    };

    await listenAndLogStartup(app, 4040);

    expect(events).toEqual(['listened', 'resolved', 'logged']);
    expect(info).toHaveBeenCalledWith(
      createStartupLogContext(4040),
      'Payment service listening',
    );
  });
});
