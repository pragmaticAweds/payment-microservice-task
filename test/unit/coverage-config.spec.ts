interface CoverageConfig {
  collectCoverageFrom?: string[];
  coverageReporters?: string[];
  coverageThreshold?: {
    global?: {
      branches?: number;
      functions?: number;
      lines?: number;
      statements?: number;
    };
  };
}

const config = jest.requireActual<CoverageConfig>('../../jest.config.cjs');

describe('unit coverage configuration', () => {
  it('collects executable source while excluding framework metadata', () => {
    expect(config.collectCoverageFrom).toEqual([
      'src/**/*.{ts,js}',
      '!src/main.ts',
      '!src/**/*.module.ts',
      '!src/app.setup.ts',
      '!src/openapi/swagger.ts',
      '!src/**/*.dto.ts',
    ]);
  });

  it('generates every required report and enforces global thresholds', () => {
    expect(config.coverageReporters).toEqual(['text', 'lcov', 'html']);
    expect(config.coverageThreshold).toEqual({
      global: {
        branches: 80,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    });
  });
});
