import { createStartupLogContext } from '../../../src/startup/startup-log';

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
});
