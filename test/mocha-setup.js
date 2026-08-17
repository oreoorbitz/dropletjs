// Provide jest-compatible globals for mocha runs.
const { expect } = require('expect')
global.expect = expect
// Minimal jest.fn() mock shim (only usage in the suite).
global.jest = {
  fn (impl) {
    const f = function (...args) {
      f.mock.calls.push(args)
      f.mock.results.push({ type: 'return', value: impl ? impl.apply(this, args) : undefined })
      return f.mock.results[f.mock.results.length - 1].value
    }
    f.mock = { calls: [], results: [] }
    return f
  }
}
