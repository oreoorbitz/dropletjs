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

export class Filter {
  public name: string
  public args: FilterArg[]
  public readonly raw: boolean
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
    this.args = token.args
    this.liquid = liquid
    this.filterThis = new FilterThis(token, liquid)
  }
  public render (value: any, context: Context): unknown {
    const filterThis = this.filterThis
    filterThis.context = context
    const args = this.args as FilterArg[]
    let result: unknown
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
    if (isPromise(result)) {
      // suppress unhandled rejection of the abandoned async result
      result.then(undefined, () => undefined)
      throw new Error(`async filter "${this.name}" is not supported in the sync-only build of liquidjs`)
    }
    return result
  }
}
