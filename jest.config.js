/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper: {
    // @nestjs/jwt v12 es ESM puro; Jest no puede require() ese módulo en Node 22.
    '^@nestjs/jwt$': '<rootDir>/test/stubs/nestjs-jwt.ts',
  },
  collectCoverageFrom: ['**/*.(t|j)s', '!**/*.spec.ts', '!main.ts'],
  coverageDirectory: '../coverage',
};
