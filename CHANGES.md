# liquid-sync — sync-only, performance-optimized LiquidJS fork

Based on liquidjs v10.29.0 (`/mnt/agents/output/liquidjs-src`). All rendering and
parsing is now performed by **plain synchronous function calls**; the generator
machinery (`toValueSync`/`toPromise` iterator drivers, per-yield `{value, done}`
boxes, per-node generator allocations) is eliminated from every render hot path.

## Results

- Tests: **1564 passing baseline → 1566 passing** (85 suites; 4 dist-artifact
  specs excluded, see below; net +2 tests from added sync-only rejection tests).
- Micro-benchmark (`renderSync`, 20 products × if/filters, 20k renders, Node 20):
  **original ≈ 5486 ms → fork ≈ 1235 ms (~4.4× faster)**.

## Removed / changed per module

### Core de-generatorization
- `render/render.ts` — `Render.renderTemplates` is a plain sync loop;
  `tpl.render(ctx, emitter)` is called directly. `renderLimit` clock sampling:
  `performance.now()` is now called once per 16 nodes (plus once up front)
  instead of twice per node. Added a fail-fast guard: a template returning a
  thenable throws a clear "async tag not supported" error (with the abandoned
  promise's rejection suppressed to avoid unhandled-rejection crashes).
  `renderTemplatesToNodeStream` kept (Node stream API preserved) but renders via
  the sync core on a `setImmediate` tick.
- `render/expression.ts` — `Expression.evaluate`, `evalToken`,
  `evalPropertyAccessToken`, `evalFilteredValueToken`, `evalRangeToken`,
  `toPostfix` are plain sync functions; `toPostfix` returns `Token[]`.
  Hot-path: `evalPropertyAccessToken` fast-paths all-static property segments
  (no per-segment `evalToken` calls) and pre-sizes the props array;
  `evalFilteredValueToken` caches `Filter` instances per filter token
  (non-enumerable property on the token) instead of allocating a new `Filter`
  per evaluation.
- `template/value.ts`, `template/output.ts`, `template/html.ts` — sync `value()`
  / `render()`. `HTML.render` is a single `emitter.write(this.str)`.
- `template/filter.ts` — sync `render()`. The `{ context, token, liquid }`
  `this`-object is no longer allocated per call: each `Filter` owns one reusable
  `FilterThis` instance (all fields initialized in its constructor for a stable
  hidden class; only `context` is reassigned per render). A filter handler
  returning a thenable throws `async filter "<name>" is not supported in the
  sync-only build` (rejection suppressed).
- `template/hash.ts` — sync `render()`; empty hashes return a shared frozen
  object (no per-render allocation).
- `template/tag-options-adapter.ts` — sync; tag render returning a thenable or
  iterator throws the sync-only error.
- `tags/*` — every tag `render` is now a plain sync method (`if`, `unless`,
  `case`, `for`, `tablerow`, `assign`, `echo`, `capture`, `cycle`, `liquid`,
  `include`, `render`, `layout`, `block`; `break`/`continue`/`comment`/`raw`/
  `increment`/`decrement` were already sync). Inner `yield r.renderTemplates(...)`
  calls in `for`/`tablerow`/`include`/`render`/`layout` are direct calls.
  Analysis-only generators (`arguments()`, `children()`, `localScope()`,
  `partialScope()`) are intentionally kept as generators — they never run during
  rendering; `yield` of `_parsePartialFile` inside them replaced by direct calls.
- `filters/array.ts` — all 21 generator filters (`sort`, `sort_natural`, `map`,
  `sum`, `where`, `reject`, `*_exp`, `group_by*`, `has*`, `find*`) are plain
  sync functions; `yield*`/`yield` replaced by direct calls.
- `context/context.ts` — `_get`/`_getFromScope` are sync (the hottest path);
  `getSync`/`getFromScope` call them directly with no `toValueSync` wrapper.
  Hot-path: single-segment string paths skip the `split('.')` allocation.
- `parser/parser.ts` — `_parseFile`/`_parseFileCached` sync-only:
  `loader.lookup` + `fs.readFileSync` + sync cache read/write; `toLiquidAsync`
  removed. A `cache.read` returning a Promise throws a clear error instead of
  caching garbage.
- `parser/tokenizer.ts` — `readExpressionTokens`/`readFileNameTemplate` return
  arrays instead of generators (parse-time only).
- `fs/loader.ts` — `lookup` sync-only (`containsSync`/`existsSync`);
  `toLiquidAsync` removed. `fs.existsSync` is now required (asserted in the
  `Loader` constructor). `candidates()` kept as a generator (cold path).
- `drop/block-drop.ts` — `BlockDrop.super()` is sync.
- `util/underscore.ts` — `strictUniq` returns an array (was a generator).
- `liquid.ts` — all `toPromise`/`toValueSync` drivers removed from entry points.
  `renderSync`/`parseAndRenderSync`/`renderFileSync`/`evalValueSync`/
  `parseFileSync` are truly synchronous. The async entry points (`render`,
  `parseAndRender`, `renderFile`, `parseFile`, `evalValue`, …) are kept as thin
  `async` wrappers over the sync core so existing promise-based call sites and
  `.rejects` semantics still work — but they no longer await anything inside a
  render. `registerFilter`/`registerTag` now **reject generator/async-function
  implementations at registration time** with a `SyncOnlyError`-named error.

### Kept intentionally
- `util/async.ts` (`toPromise`/`toValueSync`/`toLiquidAsync`) is still exported
  via `src/index.ts` (public API compatibility) and still used by the isolated
  static-analysis generators (`template/analysis.ts`).
- `emitters/simple-emitter.ts` keeps `buffer += stringify(html)` string building
  (V8 cons-string friendly; array+join was measured neutral-or-worse upstream).
- `StreamedEmitter` kept for `renderToNodeStream`.

## Test suite changes (all other assertions untouched)

- Excluded from the fork's jest config (they `require()` built `dist/` bundles,
  which the source-only fork does not build): `test/e2e/browser.spec.ts`,
  `test/e2e/xhr.spec.ts`, `test/e2e/issues.spec.ts`,
  `test/e2e/render-to-node-stream.spec.ts`.
- `test/integration/liquid/register-filters.spec.ts` — async-filter test now
  asserts render-time rejection for promise-returning filters, plus new
  registration-time rejection tests (generator fn, native async fn via `eval`,
  since ts-jest downlevels `async function` at the ES6 target).
- `test/integration/liquid/register-tags.spec.ts` — `render: async …` tests
  changed: one asserts registration-time rejection; two were converted to sync
  render functions, preserving their original intent (ctx access, tag args).
- `test/integration/misc/error.spec.ts` — `rejectingTag` registration moved out
  of the shared `beforeEach`; "tag rejects" test now asserts registration-time
  rejection; "stack in err.stack" now uses the synchronous `throwingTag` (same
  stack assertion preserved).
- `test/integration/liquid/cache.spec.ts` — async-cache test now asserts the
  fail-fast "async cache is not supported" error.
- `test/integration/liquid/liquid.spec.ts`, `tags/if.spec.ts`,
  `tags/for.spec.ts`, `tags/tablerow.spec.ts`, `drop/drop.spec.ts` — tests that
  put `Promise`s in scope data / Drops are re-asserted against the documented
  sync-only behavior (promises are not awaited; they render as their default
  string representation and are non-enumerable).
- `src/render/render.spec.ts` — the async-tag stream test now asserts the stream
  errors with the sync-only message.
- `src/render/expression.spec.ts` — "context not defined" asserts a direct sync
  throw.

## Parity caveats (sync-only build)

1. Promise values anywhere in scope data, Drop properties/methods, or
   `liquidMethodMissing` results are **not awaited** — they render as
   `[object Promise]` (or lowercase variant through filters).
2. Custom filters/tags that are generator functions or native async functions
   throw at registration; handlers that merely *return* a Promise throw at
   render time. Custom operators must be sync (unchecked).
3. `fs` options must provide the sync methods (`existsSync`, `readFileSync`,
   `containsSync` optional); async fs methods are dead.
4. The `cache` option must be synchronous.
5. `Filter` instances are cached per filter token: re-registering a filter
   under the same name after a template was rendered won't take effect for
   already-cached tokens of that template (register before rendering).
6. `renderLimit` is now enforced with clock sampling every 16 template nodes
   (still time-based; DoS tests pass unchanged).
7. Static analysis (`analyze`/`variables*`/…) is unchanged and still uses the
   legacy generator drivers internally.

## Tooling

- `package.json` (name kept `liquidjs` — a render-file test asserts on it) with
  mocha/ts-node replaced by **jest + ts-jest** (the checked-in tests are
  jest-style: global `expect`, `it.each`, `.rejects`; the `.mocharc.js` from the
  snapshot cannot run them). Config: `jest.config.js`, `tsconfig.json`
  (ES6/CommonJS/strict, matching `test/tsconfig.json` plus `importHelpers`).
- Run: `jest` (needs `tslib`, `@types/*` resolvable; in this workspace deps live
  in `/tmp/fdeps/node_modules` because the fuse-mounted `/mnt/agents` does not
  support the symlinks npm requires for `node_modules/.bin`).
