import { assert, isArray, isString, isFunction } from './util'
import { getDateTimeFormat } from './util/intl'
import { LiquidCache, CacheStore, LRUCacheStore, isCacheStore, adaptCacheStore } from './cache'
import { FS, LookupType } from './fs'
import * as fs from './fs/fs-impl'
import { defaultOperators, Operators } from './render'
import misc from './filters/misc'
import { escape } from './filters/html'
import { MapFS } from './fs/map-fs'

type OutputEscape = (value: any) => string
type OutputEscapeOption = 'escape' | 'json' | OutputEscape

export interface LiquidOptions {
  /** A directory or an array of directories from where to resolve layout and include templates, and the filename passed to `.renderFile()`. If it's an array, the files are looked up in the order they occur in the array. Defaults to `["."]` */
  root?: string | string[];
  /** A directory or an array of directories from where to resolve included templates. If it's an array, the files are looked up in the order they occur in the array. Defaults to `root` */
  partials?: string | string[];
  /** A directory or an array of directories from where to resolve layout templates. If it's an array, the files are looked up in the order they occur in the array. Defaults to `root` */
  layouts?: string | string[];
  /** Allow refer to layouts/partials by relative pathname. To avoid arbitrary filesystem read, paths been referenced also need to be within corresponding root, partials, layouts. Defaults to `true`. */
  relativeReference?: boolean;
  /** Use jekyll style include, pass parameters to `include` variable of current scope. Defaults to `false`. */
  jekyllInclude?: boolean;
  /** Use jekyll style where filter, enables array item match. Defaults to `false`. */
  jekyllWhere?: boolean;
  /** Add a extname (if filepath doesn't include one) before template file lookup. Eg: setting to `".html"` will allow including file by basename. Defaults to `""`. */
  extname?: string;
  /** Whether or not to cache resolved templates. Defaults to `false`.
   * Accepts:
   * - `true` — an `LRUCacheStore` with `maxEntries: 1024` (exposed as `engine.templateCache`)
   * - a number `N` — an `LRUCacheStore` with `maxEntries: N` (`<= 0` disables)
   * - a legacy `LiquidCache` (`{ read, write, remove }`)
   * - a `CacheStore` (`{ get, set, has?, delete?, clear? }`), e.g. `new LRUCacheStore({ maxEntries, ttl })`
   */
  cache?: boolean | number | LiquidCache | CacheStore;
  /**
   * Freeze parsed templates deeply (template arrays, tag instances and plain
   * objects/arrays reachable from them; tokens are intentionally NOT frozen so
   * render-time filter caching still works). Guarantees parse-once semantics
   * and protects against accidental template mutation. Defaults to `false`.
   */
  immutableTemplates?: boolean;
  /** Use JavaScript Truthiness. Defaults to `false`. */
  jsTruthy?: boolean;
  /** If set, treat the `filepath` parameter in `{%include filepath %}` and `{%layout filepath%}` as a variable, otherwise as a literal value. Defaults to `true`. */
  dynamicPartials?: boolean;
  /** Whether or not to assert filter existence. If set to `false`, undefined filters will be skipped. Otherwise, undefined filters will cause an exception. Defaults to `false`. */
  strictFilters?: boolean;
  /** Whether or not to assert variable existence.  If set to `false`, undefined variables will be rendered as empty string.  Otherwise, undefined variables will cause an exception. Defaults to `false`. */
  strictVariables?: boolean;
  /** Catch all errors instead of exit upon one. Please note that render errors won't be reached when parse fails. */
  catchAllErrors?: boolean;
  /**
   * Hide scope variables from prototypes, useful when you're passing a not sanitized object into LiquidJS or need to hide prototypes from templates.
   * This only applies to property/index access on scope objects. Filter transforms and iteration operate on the resolved value with standard JavaScript semantics, so prototype-inherited array indices may still be surfaced by them.
   */
  ownPropertyOnly?: boolean;
  /** Modifies the behavior of `strictVariables`. If set, a single undefined variable will *not* cause an exception in the context of the `if`/`elsif`/`unless` tag and the `default` filter. Instead, it will evaluate to `false` and `null`, respectively. Irrelevant if `strictVariables` is not set. Defaults to `false`. **/
  lenientIf?: boolean;
  /** JavaScript timezone name or timezoneOffset for `date` filter, default to local time. That means if you're in Australia (UTC+10), it'll default to `-600` or `Australia/Lindeman` */
  timezoneOffset?: number | string;
  /** Default date format to use if the date filter doesn't include a format. Defaults to `%A, %B %-e, %Y at %-l:%M %P %z`. */
  dateFormat?: string;
  /** Default locale, will be used by date filter. Defaults to system locale. */
  locale?: string;
  /** Strip blank characters (including ` `, `\t`, and `\r`) from the right of tags (`{% %}`) until `\n` (inclusive). Defaults to `false`. */
  trimTagRight?: boolean;
  /** Similar to `trimTagRight`, whereas the `\n` is exclusive. Defaults to `false`. See Whitespace Control for details. */
  trimTagLeft?: boolean;
  /** Strip blank characters (including ` `, `\t`, and `\r`) from the right of values (`{{ }}`) until `\n` (inclusive). Defaults to `false`. */
  trimOutputRight?: boolean;
  /** Similar to `trimOutputRight`, whereas the `\n` is exclusive. Defaults to `false`. See Whitespace Control for details. */
  trimOutputLeft?: boolean;
  /** The left delimiter for liquid tags. **/
  tagDelimiterLeft?: string;
  /** The right delimiter for liquid tags. **/
  tagDelimiterRight?: string;
  /** The left delimiter for liquid outputs. **/
  outputDelimiterLeft?: string;
  /** The right delimiter for liquid outputs. **/
  outputDelimiterRight?: string;
  /** Whether input strings to date filter preserve the given timezone **/
  preserveTimezones?: boolean;
  /** Whether `trim*Left`/`trim*Right` is greedy. When set to `true`, all consecutive blank characters including `\n` will be trimmed regardless of line breaks. Defaults to `true`. */
  greedy?: boolean;
  /** `fs` is used to override the default file-system module with a custom implementation. */
  fs?: FS;
  /** keyValue separator */
  keyValueSeparator?: string;
  /** Render from an in-memory `templates` mapping instead of the file system. When `templates` is set, Liquid uses the provided mapping for template lookup (including includes, layouts, and partials), and file-system options such as `fs`, `root`, `partials`, `layouts`, and `relativeReference` are effectively bypassed for those lookups. */
  templates?: {[key: string]: string};
  /** the global scope passed down to all partial and layout templates, i.e. templates included by `include`, `layout` and `render` tags. */
  globals?: object;
  /** Whether or not to keep value type when writing the Output, not working for streamed rendering. Defaults to `false`. */
  keepOutputType?: boolean;
  /** Default escape filter applied to output values, when set, you'll have to add `| raw` for values don't need to be escaped. Defaults to `undefined`. */
  outputEscape?: OutputEscapeOption;
  /** An object of operators for conditional statements. Defaults to the regular Liquid operators. */
  operators?: Operators;
  /** Respect parameter order when using filters like "for ... reversed limit", Defaults to `false`. */
  orderedFilterParameters?: boolean;
  /** Allow parenthesized expressions as operands in conditions and loops, e.g. `{% if (foo | upcase) == "BAR" %}`. This is a non-standard extension to Liquid. Defaults to `false`. */
  groupedExpressions?: boolean;
  /**
   * Use the optional native (C++ N-API) top-level tokenizer when available.
   * - `undefined` (default, "auto"): use the native tokenizer if the optional
   *   `dropletjs-native` package (or a local `native/tokenizer.node` build) can
   *   be loaded AND the delimiter/greedy options are the defaults; otherwise
   *   silently fall back to the JS tokenizer.
   * - `false`: always use the JS tokenizer.
   * - `true`: require the native tokenizer — `parse()` throws if the module
   *   cannot be loaded; if the delimiter/greedy options are incompatible with
   *   the native port, a one-time `console.warn` is emitted and the JS
   *   tokenizer is used instead.
   * Tokenization results are identical either way (differential-tested);
   * this is a pure performance option affecting parse time only.
   */
  useNativeTokenizer?: boolean;
  /** For DoS handling, limit total length of templates parsed in one `parse()` call. A typical PC can handle 1e8 (100M) characters without issues. */
  parseLimit?: number;
  /** For DoS handling, limit total time (in ms) for each `render()` call. */
  renderLimit?: number;
  /** For DoS handling, limit new objects creation, including array concat/join/strftime, etc. A typical PC can handle 1e9 (1G) memory without issue. */
  memoryLimit?: number;
}

export interface RenderOptions {
  /**
   * This call is sync or async? It's used by Liquid internal methods, you'll not need this.
   */
  sync?: boolean;
  /**
   * Same as `globals` on LiquidOptions, but only for current render() call
   */
  globals?: object;
  /**
   * Same as `strictVariables` on LiquidOptions, but only for current render() call
   */
  strictVariables?: boolean;
  /**
   * Same as `ownPropertyOnly` on LiquidOptions, but only for current render() call
   */
  ownPropertyOnly?: boolean;
  /** For DoS handling, limit total renders of tag/HTML/output in one `render()` call. A typical PC can handle 1e5 renders of typical templates per second. */
  templateLimit?: number;
  /** For DoS handling, limit total time (in ms) for each `render()` call. */
  renderLimit?: number;
  /** For DoS handling, limit new objects creation, including array concat/join/strftime, etc. A typical PC can handle 1e9 (1G) memory without issue.. */
  memoryLimit?: number;
  /**
   * Declare the passed context object frozen for this render (the developer
   * promises not to mutate it during render and that pure filters are pure).
   * Enables render-scoped memoization of filters registered with
   * `{ pure: true }`. Defaults to `false`.
   */
  frozenContext?: boolean;
  /**
   * Shape hint for this render: a shape name registered via
   * `engine.registerShape(name, schema)` or an inline schema. Declared dotted
   * paths are read via precompiled direct property accessors instead of the
   * generic scope traversal, when the context matches the declared shape
   * (cheaply verified; silently falls back to generic lookup on mismatch).
   */
  shape?: string | ShapeSchema;
}

/**
 * A shape schema: either an array of dotted paths (`['product.title',
 * 'product.meta.vendor']`) or a nested object whose keys enumerate allowed
 * properties (`{ product: { title: true, meta: { vendor: true } } }`).
 */
export type ShapeSchema = string[] | Record<string, any>;

export interface RenderFileOptions extends RenderOptions {
  lookupType?: LookupType;
}

interface NormalizedOptions extends LiquidOptions {
  root?: string[];
  partials?: string[];
  layouts?: string[];
  cache?: LiquidCache;
  /** The developer-facing CacheStore behind `cache`, when one is in use. */
  cacheStore?: CacheStore;
  outputEscape?: OutputEscape;
}

export interface NormalizedFullOptions extends NormalizedOptions {
  root: string[];
  partials: string[];
  layouts: string[];
  relativeReference: boolean;
  jekyllInclude: boolean;
  extname: string;
  cache?: LiquidCache;
  jsTruthy: boolean;
  dynamicPartials: boolean;
  fs: FS;
  strictFilters: boolean;
  strictVariables: boolean;
  ownPropertyOnly: boolean;
  lenientIf: boolean;
  dateFormat: string;
  locale: string;
  trimTagRight: boolean;
  trimTagLeft: boolean;
  trimOutputRight: boolean;
  trimOutputLeft: boolean;
  tagDelimiterLeft: string;
  tagDelimiterRight: string;
  outputDelimiterLeft: string;
  outputDelimiterRight: string;
  preserveTimezones: boolean;
  greedy: boolean;
  globals: object;
  keepOutputType: boolean;
  operators: Operators;
  groupedExpressions: boolean;
  parseLimit: number;
  renderLimit: number;
  memoryLimit: number;
  immutableTemplates: boolean;
}

export const defaultOptions: NormalizedFullOptions = {
  root: ['.'],
  layouts: ['.'],
  partials: ['.'],
  relativeReference: true,
  jekyllInclude: false,
  keyValueSeparator: ':',
  cache: undefined,
  extname: '',
  fs: fs,
  dynamicPartials: true,
  jsTruthy: false,
  dateFormat: '%A, %B %-e, %Y at %-l:%M %P %z',
  locale: '',
  trimTagRight: false,
  trimTagLeft: false,
  trimOutputRight: false,
  trimOutputLeft: false,
  greedy: true,
  tagDelimiterLeft: '{%',
  tagDelimiterRight: '%}',
  outputDelimiterLeft: '{{',
  outputDelimiterRight: '}}',
  preserveTimezones: false,
  strictFilters: false,
  strictVariables: false,
  ownPropertyOnly: true,
  lenientIf: false,
  globals: {},
  keepOutputType: false,
  operators: defaultOperators,
  groupedExpressions: false,
  memoryLimit: Infinity,
  parseLimit: Infinity,
  renderLimit: Infinity,
  immutableTemplates: false
}

export function normalize (options: LiquidOptions): NormalizedFullOptions {
  if (options.hasOwnProperty('root')) {
    if (!options.hasOwnProperty('partials')) options.partials = options.root
    if (!options.hasOwnProperty('layouts')) options.layouts = options.root
  }
  if (options.hasOwnProperty('cache')) {
    let cache: LiquidCache | undefined
    let store: CacheStore | undefined
    const opt = options.cache
    if (typeof opt === 'number') {
      store = opt > 0 ? new LRUCacheStore({ maxEntries: opt }) : undefined
      cache = store ? adaptCacheStore(store) : undefined
    } else if (isCacheStore(opt)) {
      store = opt
      cache = adaptCacheStore(store)
    } else if (typeof opt === 'object' && opt) {
      // legacy LiquidCache { read, write, remove }
      cache = opt as LiquidCache
    } else if (opt) {
      store = new LRUCacheStore({ maxEntries: 1024 })
      cache = adaptCacheStore(store)
    }
    options.cache = cache
    ;(options as NormalizedOptions).cacheStore = store
  }
  options = { ...defaultOptions, ...(options.jekyllInclude ? { dynamicPartials: false } : {}), ...options }
  if ((!options.fs!.dirname || !options.fs!.sep) && options.relativeReference) {
    console.warn('[LiquidJS] `fs.dirname` and `fs.sep` are required for relativeReference, set relativeReference to `false` to suppress this warning')
    options.relativeReference = false
  }
  options.root = normalizeDirectoryList(options.root)
  options.partials = normalizeDirectoryList(options.partials)
  options.layouts = normalizeDirectoryList(options.layouts)
  options.outputEscape = options.outputEscape && getOutputEscapeFunction(options.outputEscape)
  if (!options.locale) {
    options.locale = getDateTimeFormat()?.().resolvedOptions().locale ?? 'en-US'
  }
  if (options.templates) {
    options.fs = new MapFS(options.templates)
    options.relativeReference = true
    options.root = options.partials = options.layouts = '.'
  }
  return options as NormalizedFullOptions
}

function getOutputEscapeFunction (nameOrFunction: OutputEscapeOption): OutputEscape {
  if (nameOrFunction === 'escape') return escape
  if (nameOrFunction === 'json') return misc.json
  assert(isFunction(nameOrFunction), '`outputEscape` need to be of type string or function')
  return nameOrFunction
}

export function normalizeDirectoryList (value: any): string[] {
  let list: string[] = []
  if (isArray(value)) list = value
  if (isString(value)) list = [value]
  return list
}
