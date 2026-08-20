import { NormalizedFullOptions } from '../liquid-options'

/**
 * Optional native tokenizer support (N-API addon).
 *
 * The addon is loaded lazily at first use, at runtime, from (in order):
 *   1. the `dropletjs-native` package (separate optional package),
 *   2. `process.env.DROPLETJS_NATIVE_PATH` (explicit .node path),
 *   3. `<packageRoot>/native/native-tokenizer.js` (local build; resolved
 *      relative to this source file and to process.cwd()).
 *
 * Loading never throws: any failure results in `getNativeTokenizer()`
 * returning `undefined` and the engine silently using the JS tokenizer.
 */

export interface FlatTokenization {
  count: number;
  kinds: Int32Array;
  begins: Int32Array;
  ends: Int32Array;
  contentStarts: Int32Array;
  contentBegins: Int32Array;
  contentEnds: Int32Array;
  contents: string;
}

export interface NativeTokenizerModule {
  available: boolean;
  loadError?: Error | null;
  source?: string | null;
  tokenizeFlat?: (input: string) => FlatTokenization;
  tokenizeCount?: (input: string) => number;
}

const NOT_AVAILABLE: null = null
let loaded: NativeTokenizerModule | null | undefined

function runtimeRequire (): NodeRequire | undefined {
  // Indirection so static bundlers (esbuild/rollup) leave this alone:
  // the native addon must stay a runtime, optional dependency.
  try {
    // eslint-disable-next-line no-eval
    return eval('require') // tslint:disable-line
  } catch (e) {
    return undefined
  }
}

export function getNativeTokenizer (): NativeTokenizerModule | null {
  if (loaded !== undefined) return loaded
  loaded = NOT_AVAILABLE
  const req = runtimeRequire()
  if (!req) return loaded
  const candidates: string[] = ['dropletjs-native']
  if (typeof process !== 'undefined' && process.env && process.env.DROPLETJS_NATIVE_PATH) {
    candidates.push(process.env.DROPLETJS_NATIVE_PATH)
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = req('path')
    // src/parser -> <root>/native (ts-jest / plain tsc layouts)
    candidates.push(path.join(__dirname, '..', '..', 'native', 'native-tokenizer.js'))
    if (typeof process !== 'undefined' && process.cwd) {
      candidates.push(path.join(process.cwd(), 'native', 'native-tokenizer.js'))
    }
  } catch (e) { /* no path module: only bare candidates */ }

  for (const c of candidates) {
    try {
      const mod: NativeTokenizerModule = req(c)
      const flat = mod && (typeof mod.tokenizeFlat === 'function'
        ? mod.tokenizeFlat
        : (mod as any).available && typeof (mod as any).tokenizeFlat === 'function' ? (mod as any).tokenizeFlat : undefined)
      if (mod && flat) {
        loaded = mod.available === false ? NOT_AVAILABLE : mod
        if (loaded && typeof loaded.tokenizeFlat !== 'function') loaded.tokenizeFlat = flat
        return loaded
      }
    } catch (e) { /* try next */ }
  }
  return loaded
}

/**
 * The C++ port hardcodes the default delimiters and greedy whitespace trim,
 * and implements `-`-marker whitespace control only — the `trimTag*` /
 * `trimOutput*` options are applied in JS constructors/whiteSpaceCtrl, so
 * native mode requires them all to be false (the defaults).
 */
export function nativeTokenizerCompatible (options: NormalizedFullOptions): boolean {
  return options.tagDelimiterLeft === '{%' &&
    options.tagDelimiterRight === '%}' &&
    options.outputDelimiterLeft === '{{' &&
    options.outputDelimiterRight === '}}' &&
    options.greedy === true &&
    !options.trimTagLeft && !options.trimTagRight &&
    !options.trimOutputLeft && !options.trimOutputRight
}

/** Test hook: reset the cached load result. */
export function resetNativeTokenizerForTests () {
  loaded = undefined
}
