# FEATURES.md — developer-declared performance feature sets

Three opt-in, backwards-compatible feature sets on top of the sync-only fork.
Nothing here changes default behavior: every feature is off unless explicitly
enabled, and all 1570 pre-existing tests still pass unchanged (1600 total with
the 30 new feature tests; the 2 excluded browser-build spec suites are a
pre-existing environment artifact, unchanged from baseline).

Benchmark rigor: `--expose-gc`, warmup, 5 reps/median (40 alternating trials
for the cold-start case), alternating variant order, 2 full runs merged,
>10% run-to-run disagreement flags (none triggered), and byte-identical output
checks for every on/off pair (all passed). Numbers below are merged medians
from `bench/results.json` (Node v20.20.2, linux-x64).

---

## Feature 1 — Pluggable template cache (`src/cache/`)

### API

```ts
import { Liquid, LRUCacheStore } from 'liquidjs'

// cache now accepts: boolean | number | legacy LiquidCache | CacheStore
const store = new LRUCacheStore({ maxEntries: 512, ttl: 60_000 })
const engine = new Liquid({ cache: store, root: 'views', extname: '.liquid' })

engine.templateCache === store   // manual control handle
store.stats                      // { hits, misses, evictions, size }
store.delete('Partials:header')  // per-key invalidate (keys: "<LookupType>:<file>")
store.clear()
store.set(key, templates)        // warm manually
```

`CacheStore` is `{ get(key), set(key, value), has?(key), delete?(key), clear?() }`.
Any object with at least `get`/`set` is adapted to the internal legacy
`{ read, write, remove }` interface; legacy caches and `cache: <number>` keep
working exactly as before. `cache: true` now creates an
`LRUCacheStore({ maxEntries: 1024 })` (previously the upstream `LRU(1024)`), so
`engine.templateCache` is always available when caching is on. It is
`undefined` when caching is disabled or a legacy cache object was passed.

`LRUCacheStore` is Map-based LRU (refresh-on-get), with per-entry TTL
(expired entries count as evictions) and cumulative `stats`
(`resetStats()` zeroes the counters).

### Why

The T3 profile showed ~88.5% of cold-start time in fs syscalls
(lookup/exists/readFile) with no cache. A persistent, inspectable store
eliminates repeat syscalls and gives developers warm/invalidate/inspect control.

### Bench (T3-heavy `renderFileSync`, 150 iters/rep)

| variant | merged median/render |
|---|---|
| legacy `LRU` (no stats) | 2.5835 ms |
| `LRUCacheStore` (stats + TTL bookkeeping) | 2.5532 ms |

**Verdict: performance-neutral** (stats/TTL bookkeeping is free). Keep for
observability + operational control (TTL eviction, targeted invalidation).

---

## Feature 2 — Predictive preload (`src/preload.ts`)

Setup-time only; the engine stays fully synchronous. All entry points batch
parsing and yield to the event loop between chunks.

### API

```ts
// batch parse+compile into the template cache
await engine.preload('page')                        // single root
await engine.preload(['page', 'cart'], { concurrency: 16 })
await engine.preload('**/*.liquid')                 // globs expand against `root`
                                                    // (default Node fs only)

// dependency closure (default deep: true): statically discovered
// {% include %}/{% render %}/{% layout %} targets are preloaded too
await engine.preload('page', { deep: true })

// inspect the static dependency tree (parses as needed; sync)
engine.preloadGraph('page')
// => [{ file: 'page', lookupType: 3, dependencies: [{ file: 'header', ... }, ...] }]
//    cycles are marked { circular: true }

// non-critical templates on idle (setImmediate scheduling)
const handle = engine.preloadOnIdle('recommendations')
handle.cancel()                  // before the idle tick -> resolves null
await handle.promise             // PreloadResult | null
```

`preload()` resolves `{ files, templates }` (load order, top-level node count).
Concurrency = batch size between `setImmediate` yields (default 8); parsing
itself is synchronous — the limiter controls event-loop responsiveness during
setup, not parallel I/O.

Static analysis semantics match `template/analysis.ts`: only **static**
(string-literal) include/render/layout file names are discovered; dynamic
names (`{% include name %}`) are skipped. Requires a configured `cache` to be
useful — without one, parsed templates are discarded.

### Bench (cold-start first render, 200-partial page, fresh engine, 40 alternating trials)

| variant | merged median first-render latency |
|---|---|
| cold (no preload) | 67.32 ms |
| after `await engine.preload('page')` | 2.25 ms |

**Verdict: ~30× faster cold-start first render.** Real win — the entire
dependency closure (page + 200 partials + shared badge) is parsed off the
critical path. Output byte-identical with/without preload.

---

## Feature 3 — Shape & immutability declarations

### 3a. `immutableTemplates: true`

```ts
const engine = new Liquid({ immutableTemplates: true })
const tpl = engine.parse('...')   // Template[] deeply frozen
```

Deep `Object.freeze` over the parsed Template array, tag/output instances, and
all arrays/plain objects reachable from them. **Tokens are intentionally not
frozen**: the fork caches `Filter` instances (and shape cells) on tokens at
render time via non-enumerable writes. Tokens are never structurally mutated
after parsing, so parse-once semantics and accidental-mutation protection hold
for the template structure itself.

| case | off | on |
|---|---|---|
| T2 parse+render (freeze cost per parse) | 0.0702 ms | 0.1072 ms |
| T2 render-only, pre-parsed (V8 frozen-array effects) | 0.1435 ms | 0.1416 ms |

**Verdict: no V8 win (render-only is neutral, ±1%), and freezing costs
~37µs per parse (T2-size).** Kept purely for safety/ergonomics: guaranteed
parse-once semantics and hard failures on accidental template mutation. Enable
when templates are parsed once and reused (with `cache`) so the freeze cost is
paid once; avoid in parse-per-render flows.

### 3b. `frozenContext` + pure filters

```ts
engine.registerFilter('slugify', v => expensiveSlug(v), { pure: true })
// or: engine.registerFilter('slugify', { handler, raw: false, pure: true })

engine.parseAndRenderSync(tpl, ctx, { frozenContext: true })
```

Semantics — read carefully:

- `{ pure: true }` is a **developer declaration**: the filter's output must
  depend only on `value` and primitive arguments (no context/register/time/IO
  reads). Misdeclaring an impure filter returns stale results.
- With `frozenContext: true`, pure-filter calls whose value and all arguments
  are primitives are memoized on `(name, value, args)` in a **render-scoped
  Map** created at render start and **cleared in a `finally` after the render**
  (nested renders via include/render share the same map). Nothing persists
  across renders; no cross-render staleness is possible.
- Calls with non-primitive inputs are never memoized (fall through to a normal
  call). Memoization skips the filter call entirely, including its `this`
  object access.
- `frozenContext` also propagates to spawned contexts (include/render).

Bench (300 identical calls of an expensive pure-filter chain — 8 rounds of
split/reverse/join + wrap — per render):

| variant | merged median/render |
|---|---|
| `frozenContext` off | 1.8434 ms |
| `frozenContext` on | 0.4245 ms |

**Verdict: 4.3× faster when repeated identical pure-filter calls dominate and
the filter is non-trivial.** Honest caveat: for trivial filters (a single
`toUpperCase`), memoization key-building is a net *loss* (~0.5µs/call) — an
earlier version of this benchmark with trivial filters measured 0.26ms off vs
0.43ms on. Use only for genuinely expensive pure filters. Output is
byte-identical on/off.

### 3c. Shape hints

```ts
engine.registerShape('product', ['product.title', 'product.meta.vendor.name'])
// nested-object schema also accepted:
engine.registerShape('p2', { product: { title: true, meta: { vendor: { name: true } } } })

engine.renderFileSync('page', ctx, { shape: 'product' })
// or inline: { shape: ['product.title'] } — but prefer registerShape:
// compiled accessors are cached per schema object (WeakMap), and inline
// per-call schema objects would recompile every render.
```

How it works: declared dotted paths get precompiled direct accessors
(`(env, globals) => env.product.meta.vendor.name` with nil guards and the same
env-then-globals root resolution as `findScope`). The compiled getter is
cached on the property-access token, keyed by the shape Map identity, so the
steady-state overhead per non-declared property access is one property read +
one identity compare.

**Shape verification** (per render, cheap): every declared root key must
resolve (`in`) on the environments or globals object, and roots declared with
sub-paths must hold an object. **On any mismatch the shape is silently ignored**
— all lookups fall back to the generic traversal. No error is raised.

Semantics of the fast path for declared paths (intentional, documented):
plain JS property reads only — no Drop handling, no method invocation, no
`size`/`first`/`last` special properties, no `ownPropertyOnly` filtering, no
`strictVariables` errors. Undeclared paths are completely unaffected.

| case | off | on |
|---|---|---|
| T2-page (shallow paths, loop-dominated) | 0.1425 ms | 0.1423 ms |
| deep-path page (180× 5-level declared paths/render) | 0.1177 ms | 0.0513 ms |

**Verdict: neutral on typical T2 pages (loop-body accesses use loop scopes,
not the declared roots); 2.3× faster when the template reads deep dotted
paths repeatedly.** Keep: real win for deep-path workloads, zero measurable
cost otherwise, silent fallback keeps it safe.

---

## Test counts

- Baseline: 1570 passing.
- After features: **1600 passing** (+8 cache store, +7 preload, +15
  declarations suites), 0 regressions; the 2 pre-existing excluded
  browser-build spec suites still fail to load (unchanged environment issue,
  not a regression).

## Bench summary (merged 2 runs, 0 disagreement flags, all byte-identical)

| feature | off/baseline | on | delta | verdict |
|---|---|---|---|---|
| F1 LRUCacheStore vs legacy LRU | 2.5835 ms | 2.5532 ms | ~0% | neutral; kept for stats/TTL/control |
| F2 preload cold-start (200 partials) | 67.32 ms | 2.25 ms | **~30×** | real cold-start win |
| F3a immutableTemplates parse+render | 0.0702 ms | 0.1072 ms | −53% | costs per-parse; safety feature |
| F3a2 immutableTemplates render-only | 0.1435 ms | 0.1416 ms | ~0% | no V8 win (honest: neutral) |
| F3b frozenContext pure-filter memo | 1.8434 ms | 0.4245 ms | **4.3×** | real win for expensive pure filters; loss for trivial ones |
| F3c shape hints (T2) | 0.1425 ms | 0.1423 ms | ~0% | neutral on shallow/loop-heavy pages |
| F3c2 shape hints (deep paths) | 0.1177 ms | 0.0513 ms | **2.3×** | real win for deep-path pages |

Existing T1–T7 orig-vs-fork cases untouched and re-verified byte-identical;
no watchdog trips in either run. Note: the fork bundle
(`bench/fork.bundle.js`) is now built with a single
`esbuild src/index.ts --bundle --platform=node --format=cjs --target=es2017`
step (the previous tsc-then-esbuild pipeline breaks on type-only re-exports
added by these features; esbuild handles them correctly and produces the same
flat, getter-free CJS shape).
