/**
 * Deep-freeze support for the `immutableTemplates` option.
 *
 * Freezes: the parsed Template[] array, every Template/tag instance, and all
 * arrays and plain objects reachable from them (recursively).
 *
 * Intentionally NOT frozen: token objects (`token`, and anything reachable
 * only via tokens) and engine references (`liquid`, `parser`). The fork
 * caches `Filter` instances on filter tokens at render time (a non-enumerable
 * write), which would throw on a frozen token. Tokens are immutable in
 * practice (nothing mutates them after parsing except that render-time
 * cache), so this still guarantees parse-once semantics for the template
 * structure itself.
 */

const SKIP_KEYS = new Set(['token', 'liquid', 'parser'])

function isFreezableTarget (v: any): boolean {
  if (Array.isArray(v)) return true
  if (v === null || typeof v !== 'object') return false
  const proto = Object.getPrototypeOf(v)
  if (proto === Object.prototype || proto === null) return true
  // Template/tag instances: have a render or value method and a token
  return typeof v.render === 'function' || typeof v.value === 'function'
}

export function deepFreezeTemplates (templates: any[]): any[] {
  const seen = new Set<object>()
  const freeze = (v: any): void => {
    if (!isFreezableTarget(v) || seen.has(v)) return
    seen.add(v)
    if (typeof v === 'object') {
      for (const key of Object.keys(v)) {
        if (SKIP_KEYS.has(key)) continue
        freeze(v[key])
      }
    }
    Object.freeze(v)
  }
  freeze(templates)
  return templates
}
