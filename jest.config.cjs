/** @type {import('jest').Config} */
module.exports = {
  collectCoverageFrom: [
    'src/**/*.{ts,js}',
    '!src/main.ts',
    '!src/**/*.module.ts',
    '!src/app/app.setup.ts',
    '!src/openapi/swagger.ts',
    '!src/**/*.dto.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 85,
      lines: 85,
      statements: 85,
    },
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'test/unit/.*\\.spec\\.ts$',
  watchman: false,
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
};
