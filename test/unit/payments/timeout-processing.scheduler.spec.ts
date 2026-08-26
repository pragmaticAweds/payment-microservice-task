import { TimeoutProcessingScheduler } from '../../../src/payments/processing/timeout-processing.scheduler';

describe('TimeoutProcessingScheduler', () => {
  beforeEach(() => jest.useFakeTimers());

  afterEach(() => {
    jest.useRealTimers();
  });

  it('runs a task only after the configured delay', () => {
    const scheduler = new TimeoutProcessingScheduler();
    let executions = 0;
    scheduler.schedule(50, () => {
      executions += 1;
    });

    jest.advanceTimersByTime(49);
    expect(executions).toBe(0);
    jest.advanceTimersByTime(1);
    expect(executions).toBe(1);
  });

  it('cancels a task before it runs', () => {
    const scheduler = new TimeoutProcessingScheduler();
    let executions = 0;
    const task = scheduler.schedule(50, () => {
      executions += 1;
    });

    task.cancel();
    jest.runAllTimers();
    expect(executions).toBe(0);
  });
});
