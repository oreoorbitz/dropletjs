import { Liquid, filters } from '../../../src'

describe('liquid#registerFilter()', function () {
  let liquid: Liquid
  beforeEach(() => { liquid = new Liquid() })

  describe('key-value arguments', function () {
    beforeEach(() => {
      liquid.registerFilter('obj_test', function (...args) {
        return JSON.stringify(args)
      })
    })
    it('should support key-value arguments', async () => {
      const src = `{{ "a" | obj_test: k1: "v1", k2: foo }}`
      const dst = '["a",["k1","v1"],["k2","bar"]]'
      const html = await liquid.parseAndRender(src, { foo: 'bar' })
      return expect(html).toBe(dst)
    })
    it('should support mixed arguments', async () => {
      const src = `{{ "a" | obj_test: "something", k1: "v1", k2: foo }}`
      const dst = '["a","something",["k1","v1"],["k2","bar"]]'
      const html = await liquid.parseAndRender(src, { foo: 'bar' })
      return expect(html).toBe(dst)
    })
  })

  describe('async filters', () => {
    // SYNC FORK: filters returning Promises are rejected with a clear error at render time
    it('should reject async filter', async () => {
      liquid.registerFilter('get_user_data', function (userId) {
        return Promise.resolve({ userId, userName: userId.toUpperCase() })
      })
      const src = `{{ userId | get_user_data | json }}`
      await expect(liquid.parseAndRender(src, { userId: 'alice' }))
        .rejects.toThrow(/async filter "get_user_data" is not supported in the sync-only build/)
    })
    // SYNC FORK: generator/async-function filters are rejected at registration time
    it('should reject async function filter at registration time', () => {
      // NOTE: eval is used because ts-jest compiles `async function` down to a
      // plain function at the ES6 target; eval'd code keeps the native AsyncFunction.
      const asyncFn = eval('(async function (v) { return v })')
      expect(() => liquid.registerFilter('async_fn', asyncFn))
        .toThrow(/async filter "async_fn" is not supported in the sync-only build/)
    })
    it('should reject generator filter at registration time', () => {
      expect(() => liquid.registerFilter('gen_fn', function * (v: any) { return v } as any))
        .toThrow(/async filter "gen_fn" is not supported in the sync-only build/)
    })
  })

  describe('raw filters', () => {
    beforeEach(() => {
      liquid = new Liquid({
        outputEscape: 'escape'
      })
    })
    it('should escape filter output when outputEscape set to true', async () => {
      liquid.registerFilter('break', (str) => str.replace(/\n/g, '<br/>'))
      const src = `{{ "a\nb" | break }}`
      const dst = 'a&lt;br/&gt;b'
      const html = await liquid.parseAndRender(src)
      return expect(html).toBe(dst)
    })
    it('should not escape filter output when registered as "raw"', async () => {
      liquid.registerFilter('break', {
        handler: (str) => str.replace(/\n/g, '<br/>'),
        raw: true
      })
      const src = `{{ "a\nb" | break }}`
      const dst = 'a<br/>b'
      const html = await liquid.parseAndRender(src)
      return expect(html).toBe(dst)
    })
  })

  it('should not treat Object.prototype names as registered filters', async () => {
    expect(Object.getPrototypeOf(liquid.filters)).toBeNull()
    await expect(liquid.parseAndRender('{{ x | constructor }}', { x: 42 })).resolves.toBe('42')
    await expect(new Liquid({ strictFilters: true }).parseAndRender('{{ 1 | constructor }}')).rejects.toThrow('undefined filter')
  })
})

describe('liquid#unregisterFilter()', function () {
  let liquid: Liquid
  beforeEach(() => { liquid = new Liquid() })

  it('should unregister a custom filter', async () => {
    liquid.registerFilter('greet', value => `hello ${value}`)
    liquid.unregisterFilter('greet')
    const html = await liquid.parseAndRender('{{ "world" | greet }}')
    return expect(html).toBe('world')
  })

  it('should unregister a built-in filter', () => {
    liquid = new Liquid({ strictFilters: true })
    liquid.unregisterFilter('upcase')
    return expect(liquid.parseAndRender('{{ "foo" | upcase }}')).rejects.toThrow('undefined filter: upcase')
  })

  it('should support re-registering a built-in filter', async () => {
    liquid.unregisterFilter('upcase')
    liquid.registerFilter('upcase', filters.upcase)
    const html = await liquid.parseAndRender('{{ "foo" | upcase }}')
    return expect(html).toBe('FOO')
  })

  it('should not throw for an unknown filter', () => {
    expect(() => liquid.unregisterFilter('unknown')).not.toThrow()
  })
})
