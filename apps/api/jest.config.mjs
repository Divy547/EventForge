/** @type {import('jest').Config} */
const config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: '<rootDir>/tsconfig.json',
        diagnostics: {
          ignoreCodes: [151002],
        },
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@eventforge/common$': '<rootDir>/../../packages/common/dist/index.js',
    '^@eventforge/config$': '<rootDir>/../../packages/config/dist/index.js',
    '^@eventforge/database$': '<rootDir>/../../packages/database/dist/index.js',
  },
  testEnvironment: 'node',
};

export default config;
