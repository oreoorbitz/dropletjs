import { Liquid } from '../../../src/liquid'

describe('liquid#registerTag()', function () {
  it('should support render to simple string', async () => {
    const liquid = new Liquid()
    liquid.registerTag('simple-string', {
      render: () => 'B'
    })
    const html = await liquid.parseAndRender(`A{% simple-string %}C`)
    return expect(html).toBe('ABC')
  })
  // SYNC FORK: async tag render functions are rejected at registration time
  it('should reject async tag render at registration time', () => {
    const liquid = new Liquid()
    // NOTE: eval is used because ts-jest compiles `async () => ...` down to a
    // plain function at the ES6 target; eval'd code keeps the native AsyncFunction.
    expect(() => liquid.registerTag('async-string', {
      render: eval('(async () => "B")')
    })).toThrow(/async tag "async-string" is not supported in the sync-only build/)
    expect(() => liquid.registerTag('async-string', {
      render: function * () { return 'B' } as any
    })).toThrow(/async tag "async-string" is not supported in the sync-only build/)
  })
  it('should have access to ctx in render()', async () => {
    const liquid = new Liquid()
    liquid.registerTag('dynamic-string', {
      render: (ctx) => ctx.get(['c'])
    })
    const html = await liquid.parseAndRender(`A{% dynamic-string %}C`, {
      c: 'B'
    })
    return expect(html).toBe('ABC')
  })
  it('should have access to tag arguments', async () => {
    const liquid = new Liquid()
    liquid.registerTag('argument-reflector', {
      parse: function (token) { this.variable = token.args.split('=')[1] },
      render: function (ctx) { return ctx.get(this.variable) }
    })
    const html = await liquid.parseAndRender(`A{% argument-reflector variable=c %}C`, {
      c: 'B'
    })
    return expect(html).toBe('ABC')
  })

  it('should not treat Object.prototype names as registered tags', () => {
    const l = new Liquid()
    expect(Object.getPrototypeOf(l.tags)).toBeNull()
    expect(() => l.parse('{% constructor %}')).toThrow('tag "constructor" not found')
  })
})
