import { evalToken } from '../render'
import { Context } from '../context'
import { identify, isFunction, isPromise } from '../util/underscore'
import { FilterHandler, FilterImplOptions } from './filter-impl-options'
import { FilterArg, isKeyValuePair } from '../parser/filter-arg'
import { Liquid } from '../liquid'
import { FilterToken } from '../tokens'

/**
 * Reusable `this` object for filter handlers. One instance per Filter;
 * `context` is updated per render (context changes per render, token and
 * liquid are stable per Filter). Avoids allocating a fresh
 * `{ context, token, liquid }` object on every filter invocation.
 */
class FilterThis {
  public context: Context
  public token: FilterToken
  public liquid: Liquid
  public constructor (token: FilterToken, liquid: Liquid) {
    this.context = undefined as unknown as Context
    this.token = token
    this.liquid = liquid
  }
}

function isPrimitive (v: any): boolean {
  return v === null || v === undefined || (typeof v !== 'object' && typeof v !== 'function')
}

function memoKey (name: string, value: any, argv: any[]): string {
  let key = name + '' + typeof value + ':' + String(value)
  for (const a of argv) key += '' + typeof a + ':' + String(a)
  return key
}

export class Filter {
  public name: string
  public args: FilterArg[]
  public readonly raw: boolean
  /** declared pure (memoizable under `frozenContext`) */
  public readonly pure: boolean
  private handler: FilterHandler
  private liquid: Liquid
  private token: FilterToken
  private filterThis: FilterThis

  public constructor (token: FilterToken, options: FilterImplOptions | undefined, liquid: Liquid) {
    this.token = token
    this.name = token.name
    this.handler = isFunction(options)
      ? options
      : (isFunction(options?.handler) ? options!.handler : identify)
    this.raw = !isFunction(options) && !!options?.raw
    this.pure = !isFunction(options) && !!options?.pure
    this.args = token.args
    this.liquid = liquid
    this.filterThis = new FilterThis(token, liquid)
  }
  public render (value: any, context: Context): unknown {
    const filterThis = this.filterThis
    filterThis.context = context
    const args = this.args as FilterArg[]
    // Render-scoped memoization of declared-pure filters with all-primitive
    // inputs, enabled by the `frozenContext` render option. The memo Map is
    // created per render by Liquid._render and cleared afterwards.
    const memo = this.pure ? context.pureFilterMemo : undefined
    let result: unknown
    if (memo === undefined) {
      if (args.length === 0) {
        result = this.handler.call(filterThis, value)
      } else {
        const argv: any[] = []
        for (const arg of args) {
          if (isKeyValuePair(arg)) argv.push([arg[0], evalToken(arg[1], context)])
          else argv.push(evalToken(arg, context))
        }
        result = this.handler.apply(filterThis, [value, ...argv])
      }
    } else {
      const argv: any[] = []
      let memoizable = isPrimitive(value)
      if (memoizable) {
        for (const arg of args) {
          let v: any
          if (isKeyValuePair(arg)) v = [arg[0], evalToken(arg[1], context)]
          else v = evalToken(arg, context)
          if (isPrimitive(v) || (isKeyValuePair(arg) && isPrimitive(v[1]))) argv.push(v)
          else { memoizable = false; break }
        }
      }
      if (memoizable) {
        const key = memoKey(this.name, value, argv)
        if (memo.has(key)) return memo.get(key)
        result = this.handler.apply(filterThis, [value, ...argv])
        memo.set(key, result)
      } else {
        // non-primitive input: evaluate remaining args and call through
        for (let i = argv.length; i < args.length; i++) {
          const arg = args[i]
          if (isKeyValuePair(arg)) argv.push([arg[0], evalToken(arg[1], context)])
          else argv.push(evalToken(arg, context))
        }
        result = this.handler.apply(filterThis, [value, ...argv])
      }
    }
    if (isPromise(result)) {
      // suppress unhandled rejection of the abandoned async result
      result.then(undefined, () => undefined)
      throw new Error(`async filter "${this.name}" is not supported in the sync-only build of liquidjs`)
    }
    return result
  }
}
