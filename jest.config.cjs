/** @type {import('jest').Config} */
module.exports = {
  collectCoverageFrom: [
    'src/**/*.{ts,js}',
    '!src/main.ts',
    '!src/**/*.module.ts',
  ],
  coverageDirectory: 'coverage',
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: 'test/unit/.*\\.spec\\.ts$',
  watchman: false,
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
};
