# dropletjs

A high-performance, **synchronous-only** fork of [LiquidJS](https://github.com/harttle/liquidjs)
(v10.29.0) — the Shopify/Liquid template engine for Node.js and the browser.

dropletjs eliminates the async generator machinery from every parsing and
rendering hot path. All rendering is performed by plain synchronous function
calls, delivering **2–4× faster rendering** with **zero async overhead**, while
producing **byte-identical output** to upstream LiquidJS on every benchmarked
template.

> **Note:** this is a performance fork for workloads that are already
> synchronous. If you rely on asynchronous filters, tags, or file-system
> loaders, upstream [LiquidJS](https://github.com/harttle/liquidjs) is the
> right choice.

## Install

```bash
npm install @oreoorbitz/dropletjs
```

Requires Node.js >= 14.

## Quick start

The API is the same as LiquidJS's **synchronous** methods (`parseSync`,
`renderSync`, `renderFileSync`, `parseAndRenderSync`, …):

```js
const { Liquid } = require('@oreoorbitz/dropletjs')

const engine = new Liquid()
const tpl = engine.parse('Hello, {{ name | upcase }}!')
console.log(engine.renderSync(tpl, { name: 'world' }))
// → "Hello, WORLD!"
```

With the file system loader (synchronous `fs` is built in, as in upstream):

```js
const engine = new Liquid({ root: './views', extname: '.liquid' })
const html = engine.renderFileSync('page', { products })
```

ES modules / TypeScript:

```ts
import { Liquid } from '@oreoorbitz/dropletjs'
```

## Benchmarks

Measured against the official `liquidjs@10.29.0` npm dist bundle, Node.js
v20.20.2, linux x64. Per case: warmup, 5 reps with alternating engine order,
median of reps, two independent runs merged. The fork was compiled with tsc +
esbuild into a flat bundle — **no ts-node at runtime**, same as the original.
Outputs verified **byte-identical** for every case.

| case | orig ops/s | fork ops/s | speedup |
|---|---:|---:|---:|
| T1 tiny (parse+render, 1 variable) | 103 627 | 232 558 | **2.26×** |
| T2 typical page (~50 nodes, 20-item loop) | 1 300 | 4 697 | **3.61×** |
| T3 heavy (10×20 nested loop + 200 `{% include %}`) | 11.0 | 13.1 | **1.19×** |
| T4 filter-chain (500 outputs × 10 filters) | 61.8 | 91.8 | **1.48×** |
| T5 parse-only (T3 template) | 8 234 | 8 478 | **1.03×** |

See [CHANGES.md](CHANGES.md) for the full list of optimizations (de-generatorized
render/expression cores, fast-path property access, reduced `performance.now()`
sampling, allocation reductions, and more).

## What's different from LiquidJS

dropletjs is **sync-only by design**:

- **No async filters or tags.** Registering a filter/tag implementation that
  returns a Promise throws a `SyncOnlyError` at registration time, so mistakes
  fail fast instead of corrupting output.
- **Synchronous fs/cache required.** Template resolution (`{% include %}`,
  `{% render %}`, `renderFile`) uses the synchronous file-system and cache
  implementations. Async loaders are not supported.
- **Promises in scope are not awaited.** If your context data contains
  Promises, they render as their string value rather than being resolved —
  resolve them *before* calling `renderSync`.
- **Async top-level API methods are removed/not supported** — use the `*Sync`
  variants (`parseSync`, `renderSync`, `renderFileSync`, `parseAndRenderSync`).

### Migrating from LiquidJS

1. Replace `require('liquidjs')` with `require('@oreoorbitz/dropletjs')`.
2. Replace `await engine.render(...)` with `engine.renderSync(...)` (and the
   equivalent `*Sync` variants elsewhere).
3. Remove/replace any async custom filters or tags, or pre-resolve their data.
4. If you use a custom async file system or cache, switch to the sync
   equivalents (`fs` based) or preload templates.

If your application fundamentally needs async behavior in templates, stay on
upstream LiquidJS — the projects are complementary.

## Compatibility

- Forked from **liquidjs v10.29.0**; the full upstream test suite passes in
  this repository: **1566 tests, 85 suites** (jest + ts-jest; 4 specs requiring
  built dist artifacts are excluded).
- Rendering output is **byte-identical** to upstream on all benchmarked
  templates, including `{% include %}` via the sync fs loader.
- Same template syntax, filters, tags, and options as LiquidJS.

## Building

```bash
npm install
npm run build   # esbuild CJS + ESM bundles, then tsc declarations
npm test        # jest + ts-jest
```

`dist/` is git-ignored and produced by `prepublishOnly` (`npm run build && npm
test`); the npm payload is controlled by the `files` field in `package.json`.

## Credits

dropletjs is a derivative work of **[LiquidJS](https://github.com/harttle/liquidjs)**,
originally authored by **Jun Yang (harttle)** and contributors, and released
under the MIT License. All credit for the template language implementation,
test suite, and API design goes to the LiquidJS project. This fork only
re-implements the evaluation machinery for synchronous performance. See
[LICENSE](LICENSE) for the retained copyright notice.

## Links

- Repository: https://github.com/YOUR_USERNAME/dropletjs *(placeholder — update before publishing)*
- Issues: https://github.com/YOUR_USERNAME/dropletjs/issues *(placeholder)*
- Upstream: https://github.com/harttle/liquidjs
- Liquid language reference: https://shopify.github.io/liquid/

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2016 Jun Yang; (c) 2025 the
dropletjs contributors.
