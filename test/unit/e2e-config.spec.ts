interface EndToEndConfig {
  maxWorkers?: number;
}

const config = jest.requireActual<EndToEndConfig>('../jest-e2e.json');

describe('end-to-end test configuration', () => {
  it('runs application suites serially to prevent shared host resource races', () => {
    expect(config.maxWorkers).toBe(1);
  });
});
