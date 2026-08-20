import type { Context } from '../context'
import type { Liquid } from '../liquid'
import type { FilterToken } from '../tokens'

export interface FilterImpl {
  context: Context;
  token: FilterToken;
  liquid: Liquid;
}

export type FilterHandler = (this: FilterImpl, value: any, ...args: any[]) => any;

export interface FilterOptions {
  handler: FilterHandler;
  raw: boolean;
  /**
   * Declare the filter pure (output depends only on `value` and primitive
   * arguments, never on context state). With the `frozenContext` render
   * option, pure-filter results are memoized per (filterName, value, args)
   * within a single render.
   */
  pure?: boolean;
}

export type FilterImplOptions = FilterHandler | FilterOptions
