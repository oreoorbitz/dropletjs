# Changelog

## 1.0.0

Initial release. Forked from [LiquidJS](https://github.com/harttle/liquidjs)
v10.29.0 and re-engineered as a synchronous-only, performance-optimized engine.

- **De-generatorized core**: all parse/eval/render hot paths are plain
  synchronous function calls; the async generator drivers
  (`toValueSync`/`toPromise` iterator machinery, per-yield `{value, done}`
  boxes, per-node generator allocations) are eliminated.
- **Fast-path property access** for all-static property segments and pre-sized
  arrays; reduced `performance.now()` sampling in `renderLimit` (once per 16
  nodes instead of twice per node).
- **Sync-only enforcement**: registering async filters/tags throws
  `SyncOnlyError` at registration time; sync fs/cache implementations are
  required for template resolution.
- **Performance**: 2.26×–3.61× faster on typical parse+render workloads vs
  the official liquidjs@10.29.0 dist bundle (see README benchmark table),
  with byte-identical output.
- **Compatibility**: full upstream test suite green — 1566 tests passing
  (jest + ts-jest, 85 suites).
- Distribution: flat esbuild CJS (`dist/droplet.cjs.js`) and ESM
  (`dist/droplet.mjs`) bundles plus TypeScript declarations
  (`dist/index.d.ts`).

See [CHANGES.md](CHANGES.md) for the complete, module-by-module list of
modifications relative to liquidjs v10.29.0.
