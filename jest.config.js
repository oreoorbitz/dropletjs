module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.spec.ts', '<rootDir>/test/**/*.spec.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    // require built dist/ artifacts; excluded in the sync fork (no build step)
    'test/e2e/browser.spec.ts',
    'test/e2e/xhr.spec.ts',
    'test/e2e/issues.spec.ts',
    'test/e2e/render-to-node-stream.spec.ts'
  ]
}
