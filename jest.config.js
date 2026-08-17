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
    'test/e2e/render-to-node-stream.spec.ts',
    // browser-only impl tests (jsdom btoa/atob, fail on Node 24)
    'src/build/base64-impl-browser.spec.ts',
    'src/build/fs-impl-browser.spec.ts',
    'src/build/crypto-impl-browser.spec.ts',
    'src/build/streamed-emitter-browser.spec.ts'
  ]
}
