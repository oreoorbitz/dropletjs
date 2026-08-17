import { getPerformance } from '../util/performance'
import { RenderError, LiquidErrors, LiquidError } from '../util'
import { Context } from '../context'
import { Template } from '../template'
import { Emitter, KeepingTypeEmitter, StreamedEmitter, SimpleEmitter } from '../emitters'

export class Render {
  public renderTemplatesToNodeStream (templates: Template[], ctx: Context): NodeJS.ReadableStream {
    const emitter = new StreamedEmitter()
    // sync core: render on the next macrotask so consumers can attach
    // 'error'/'data' listeners first, then close the stream
    setImmediate(() => {
      try {
        this.renderTemplates(templates, ctx, emitter)
        emitter.end()
      } catch (err) {
        emitter.error(err as Error)
      }
    })
    return emitter.stream
  }
  public renderTemplates (templates: Template[], ctx: Context, emitter?: Emitter): any {
    if (!emitter) {
      emitter = ctx.opts.keepOutputType ? new KeepingTypeEmitter() : new SimpleEmitter()
    }
    ctx.renderLimit.check(getPerformance().now())
    const errors = []
    let i = 0
    for (const tpl of templates) {
      // sample the clock every 16 nodes instead of on every node
      if ((i++ & 15) === 0) ctx.renderLimit.check(getPerformance().now())
      try {
        // if tpl.render supports emitter, it'll return empty `html`
        const html = tpl.render(ctx, emitter)
        if (html) {
          if (typeof html.then === 'function') {
            // a tag returned a Promise: not supported in the sync-only build
            html.then(undefined, () => undefined) // suppress unhandled rejection
            throw new Error(`async tag "${(tpl as any).name ?? tpl.token?.getText?.()}" is not supported in the sync-only build of liquidjs`)
          }
          // if not, it'll return an `html`, write to the emitter for it
          emitter.write(html)
        }
        if (ctx.breakCalled || ctx.continueCalled) break
      } catch (e) {
        const err = LiquidError.is(e) ? e : new RenderError(e as Error, tpl)
        if (ctx.opts.catchAllErrors) errors.push(err)
        else throw err
      }
    }
    if (errors.length) {
      throw new LiquidErrors(errors)
    }
    return emitter.buffer
  }
}
