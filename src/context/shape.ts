import type { ShapeSchema } from '../liquid-options'
import { isArray } from '../util/underscore'

/**
 * Shape hints — precompiled property-path accessors.
 *
 * A shape schema declares the dotted property paths a template reads from the
 * context (e.g. `product.title`, `product.meta.vendor`). At Context
 * construction the schema is verified cheaply against the passed context
 * object: every declared root key must exist (via `in`) on the environments
 * or globals object, and every declared root value must be an object when the
 * schema declares sub-paths. On mismatch the shape is silently ignored and
 * all lookups use the generic `Context._getFromScope` traversal.
 *
 * When active, `Context._get` with an all-string path that exactly matches a
 * declared path uses a precompiled direct accessor:
 * `o => o == null ? o : o.product == null ? undefined : o.product.title`.
 *
 * Semantics of the fast path (documented, intentional):
 * - plain JS property reads: no Drop handling, no method invocation, no
 *   `size`/`first`/`last` special properties, no `ownPropertyOnly` filtering,
 *   no strictVariables checks for declared paths.
 */

export type ShapeGetter = (environments: any, globals: any) => unknown;

export interface CompiledShape {
  /** root key -> true when the root value is declared with sub-paths */
  roots: Record<string, boolean>;
  /** joined dotted path -> getter */
  getters: Map<string, ShapeGetter>;
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

/** Flatten a schema into a list of segment arrays. */
export function flattenShapeSchema (schema: ShapeSchema): string[][] {
  const paths: string[][] = []
  if (isArray(schema)) {
    for (const p of schema as string[]) {
      if (typeof p === 'string' && p) paths.push(p.split('.'))
    }
    return paths
  }
  const walk = (obj: Record<string, any>, prefix: string[]) => {
    for (const key of Object.keys(obj)) {
      const v = obj[key]
      const path = [...prefix, key]
      paths.push(path)
      if (v && typeof v === 'object') walk(v, path)
    }
  }
  if (schema && typeof schema === 'object') walk(schema as Record<string, any>, [])
  return paths
}

function buildGetter (segments: string[]): ShapeGetter {
  // Compile a direct accessor when all segments are safe identifiers.
  // `o` = environments, `g` = globals; the root is resolved like findScope.
  if (segments.every(s => IDENT.test(s))) {
    let body = `if (!(${JSON.stringify(segments[0])} in o)) o = g;\n`
    for (const s of segments) body += `if (o == null) return undefined; o = o.${s};\n`
    // eslint-disable-next-line no-new-func
    return new Function('o', 'g', body + 'return o;') as ShapeGetter
  }
  return function (o: any, g: any) {
    if (o == null || !(segments[0] in o)) o = g
    for (const s of segments) {
      if (o == null) return undefined
      o = o[s]
    }
    return o
  }
}

export function compileShape (schema: ShapeSchema): CompiledShape {
  const paths = flattenShapeSchema(schema)
  const roots: Record<string, boolean> = Object.create(null)
  const getters = new Map<string, ShapeGetter>()
  for (const segments of paths) {
    if (!segments.length) continue
    roots[segments[0]] = segments.length > 1 || roots[segments[0]] === true
    if (segments.length > 1) getters.set(segments.join('.'), buildGetter(segments))
  }
  return { roots, getters }
}

const compiledCache = new WeakMap<object, CompiledShape>()

/**
 * Compile a schema once per schema object (schemas registered via
 * `registerShape` are stable, so this hits after the first render). Inline
 * per-render schema objects would recompile every render — prefer
 * `registerShape` for hot paths.
 */
export function getCompiledShape (schema: ShapeSchema): CompiledShape {
  const key = schema as object
  let compiled = compiledCache.get(key)
  if (!compiled) {
    compiled = compileShape(schema)
    compiledCache.set(key, compiled)
  }
  return compiled
}

/**
 * Cheap shape verification: every declared root key must resolve on the
 * environments or globals object, and roots declared with sub-paths must hold
 * an object value. Returns false on mismatch (caller falls back to generic).
 */
export function verifyShape (shape: CompiledShape, environments: any, globals: any): boolean {
  for (const root of Object.keys(shape.roots)) {
    let container: any
    if (environments !== null && environments !== undefined && root in Object(environments)) container = environments
    else if (globals !== null && globals !== undefined && root in Object(globals)) container = globals
    else return false
    if (shape.roots[root]) {
      const v = container[root]
      if (v === null || typeof v !== 'object') return false
    }
  }
  return true
}
