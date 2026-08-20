# NATIVE.md — optional native tokenizer + native-offload evaluation

This fork can optionally offload **top-level template tokenization** to a C++
N-API addon. Everything else was profiled and evaluated for offloading; the
verdicts and measurements are below. Decision rule reference:
`/mnt/agents/output/native-bench/VERDICT.md` — *native pays when the JS compute
per handed-off unit is > ~150–300ns AND results marshal flat (typed arrays /
one string); object-per-item marshalling (~1.2µs/item) always loses.*

---

## 1. Native tokenizer integration

### Layout

```
native/
  package.json          # "dropletjs-native" — models the endgame separate package
  native-tokenizer.js   # wrapper: loads the addon, reports availability
  tokenizer.cpp         # N-API addon source (raw N-API, no node-gyp)
  build.sh              # g++ -shared -fPIC -O3 -std=c++17 -I/usr/include/node tokenizer.cpp -o tokenizer.node
  tokenizer.node        # locally built binary (linux-x64, ABI-stable N-API)
```

### Load order (both `native/native-tokenizer.js` and the in-engine loader
`src/parser/native.ts` use the same order)

1. `require('dropletjs-native')` — the endgame: a separate optional package
   with prebuilds per platform/arch. Declared as an `optionalDependencies`
   entry in `package.json` (npm tolerates its absence).
2. `process.env.DROPLETJS_NATIVE_PATH` — explicit path to a `.node` file.
3. `<packageRoot>/native/tokenizer.node` — a local build (`npm run build:native`).

Loading **never throws**; any failure → unavailable → JS tokenizer.

### Option: `useNativeTokenizer`

| value | semantics |
|---|---|
| `undefined` (default, "auto") | use native if the module loads AND options are compatible; otherwise **silently** use the JS tokenizer |
| `false` | always JS tokenizer (native loader is never consulted) |
| `true` | **require** native: `parse()` throws `useNativeTokenizer: native tokenizer module is not available …` if it cannot be loaded. If options are incompatible (see below), emits a one-time `console.warn` and falls back to JS. |

The C++ port hardcodes the default delimiters (`{% %}` / `{{ }}`),
`greedy: true`, and `-`-marker whitespace control. Therefore native mode is
used only when options are: default delimiters, `greedy === true`, and
`trimTagLeft/Right`/`trimOutputLeft/Right` all false (the defaults). Anything
else → JS tokenizer (warn once if the flag is `true`).

### How it works

`Tokenizer.readTopLevelTokens` (`src/parser/tokenizer.ts`) takes the native
path when the flag/availability/compatibility checks pass. The addon scans the
whole input in C++ and returns flat arrays
(`{count, kinds, begins, ends, contentStarts, contentBegins, contentEnds,
contents}` — Int32Arrays + one string; kinds: 16=HTML, 8=Output, 4=Tag).
**Token object construction stays in JS**: real `HTMLToken` / `OutputToken` /
`TagToken` instances are built from the flat arrays. Whitespace control
(incl. `raw`/`endraw`) is applied natively, so `whiteSpaceCtrl` is skipped on
this path. On a native-side tokenization error (e.g. unclosed tag), the scan
is redone in JS, which rethrows the canonical JS `TokenizationError` — error
semantics are identical by construction.

### Correctness

`src/parser/native-tokenizer.spec.ts` (34 tests):

- **(a) differential**: native vs JS token snapshots (kind, begin/end, text,
  trimLeft/trimRight, content, tag name/args) over all `test/stub` templates
  plus synthetic edge cases: whitespace control (`{%- -%}`), nested
  `raw`/`endraw`, quoted delimiters inside output, unicode, inline `#`
  comments, adjacency, a 200-construct page, empty template, and error
  equality for unclosed tag/raw. Plus end-to-end render equality.
- **(b) fallback**: loader returning `null` → auto mode silently parses with
  JS; incompatible options (custom delimiters, trim options) → JS with native
  loader never consulted.
- **(c) flag semantics**: auto consults the loader; `false` never does; `true`
  throws when unavailable; `true` + incompatible options warns exactly once
  and falls back.

The differential tests caught and fixed one real port bug: the original C++
clamped over-trimmed HTML content ranges (`cend = cbegin`), losing the
`trimRight` count vs JS (functionally identical output, different token
fields). Fixed in `native/tokenizer.cpp` (raw trim counts are preserved;
clamping happens only at string-extraction sites).

**Full suite: 1570 passed / 0 failed** (85 suites; 1536 pre-existing + 34 new),
jest + ts-jest, Node v20.20.2. Baseline before this change: 1536/1536 —
no regressions. (Note: CHANGES.md's "1566" was the mocha count; under the
jest runner used here the same suite yields 1536 — 4 dist-artifact e2e suites
excluded either way.)

### Bench (end-to-end delta)

`bench/bench.js` (2 runs merged, alternating engine order, **0 run-disagreement
flags >10%**). `forkNative` = `useNativeTokenizer: true`, `forkJS` = `false`.
ops/sec, merged medians:

| case | forkJS | forkNative | native vs JS | note |
|---|---|---|---|---|
| T1-tiny (13B) | 208,333 | — | — | not benchmarked (tokenize share ≈ 0) |
| T2-page (~0.6KB parse+render) | 4,986 | 5,259 | **1.055×** | small template: tokenize ≈ 15% of pipeline |
| T3-heavy (includes, uncached fs) | 14.7 | 14.4 | 0.977× | **fs-syscall-bound** (see §3); tokenizer noise |
| T5-parse-only (0.6KB) | 14,903 | 14,859 | 0.997× | too small — at/below break-even |
| T6-page10KB (parse+render) | 646 | 812 | **1.257×** | the native-bench suite-D shape (measured 1.31× there) |
| T7-parse100KB (parse only) | 73.8 | 100.3 | **1.358×** | pure tokenize+parse; grows with size |

Sanity: byte-identical render output vs official liquidjs on every case,
including `forkNative`.

Takeaway: native tokenization pays exactly where the VERDICT rule predicts —
once the template is big enough that JS token scanning ≫ ~300ns × tokens and
parse is a meaningful pipeline share. At 10KB parse+render it's **+26%**;
parse-only at 100KB **+36%**. At ~0.6KB it's a wash (±5%, within noise after
the per-parse compatibility check).

---

## 2. What else is worth offloading? (profiling + verdicts)

### Method

`node --cpu-prof` on `bench/profile-t2t3.js` (the T2/T3 render workloads on
the fork bundle), self-time aggregated from the V8 CPU profile and bucketed by
subsystem.

### Hotspot table

T2 (compute-bound parse+render, 0.6KB template, 20 products):

| subsystem (self-time share) | share |
|---|---|
| JS parse/tokenize (incl. TagToken/expr token ctors) | **~31%** ← now optionally native |
| context property lookup (`_get`/`_getFromScope`/`readProperty`/`readJSProperty`) | ~14–15% |
| filters (incl. `escape` ~4.4–6.7% alone, `stringify`/toValue ~2%) | ~9–10% |
| expression evaluation (`evaluate`/postfix/`value`) | ~8–9% |
| GC | ~6–8% |
| emitter/output write | ~1–2% |
| `performance.now` (renderLimit clock), misc | ~2% |

T3 (200 `{% include %}`s per render, no cache): **88.5% of self time is fs
syscalls** (`readFileUtf8` 51%, `lstat` 34% via `containsSync`/`realpathSync`).
No native compute offload matters here; the fix for this workload is template
caching (`cache: true`), not C++.

### Offload verdicts (decision rule: JS compute > ~300ns/call AND flat marshalling; Amdahl share)

| candidate | JS time share (T2) | per-call compute (measured) | marshalling shape | verdict |
|---|---|---|---|---|
| top-level tokenizer | ~15–31% of parse+render | ~1µs/token at 10KB | flat (Int32Arrays + 1 string) — proven | **OFFLOADED** (this integration; +26–36% where it matters) |
| `escape` filter | ~5–7% | **~70ns/call** (measured: 100-output escape template 94.3µs vs 23.0µs plain → 71µs/1000 calls) | string in + string out ≈ 400ns boundary | **NOT WORTH** — compute is ~5× below the boundary cost; native escape would run ~0.2× JS speed. Even at infinite speedup, Amdahl cap is ~1.07× |
| context property lookup | ~14–15% | **~0.3µs per 3-deep lookup** (measured: 29µs/1000 lookups incl. emit) | needs arbitrary JS scope objects in, arbitrary values out — object-per-item, ~140ns/property | **NOT WORTH** — marshalling is the exact "rich" shape the VERDICT rules out; per-call compute at/below the 300ns floor |
| expression evaluation | ~8–9% | **~60ns per `if` comparison** (measured: 62.6µs/1000 evals) | operands are arbitrary JS values (rich) | **NOT WORTH** — too small per call + rich marshalling |
| emitter string handling | ~1–2% | string concat, V8-optimized | would copy every output string across the boundary (~180ns each) | **NOT WORTH** — tiny share, pure string marshalling, V8 already optimal |
| lexer char-class work (`peekType`, 4–8%) | ~4–8% | ~10ns/call | n/a | **NOT WORTH standalone** — 30× below the noop floor; already captured inside the native tokenizer |
| hash/argument parsing (`readHash`, filter args) | ~1–2% | once per parse | token objects (rich) | **NOT WORTH** — share too small; and parse-once + `cache: true` removes it |
| fs layer (T3's real hotspot, 88.5%) | workload-specific | syscall-bound | n/a | **NOT A COMPUTE PROBLEM** — use `cache` |

### Conclusion

The tokenizer was the **only** routine that satisfies both halves of the
decision rule (compute ≫ 300ns/unit AND flat marshalling). Everything else is
either too cheap per call (escape: 70ns; eval: 60ns; lookup: 300ns) or trapped
behind rich object marshalling (context, expressions). No additional native
prototype was warranted: the strongest remaining candidate (`escape`) would
measurably *lose* (~70ns compute vs ~400ns round-trip, i.e. ~0.2× JS speed)
and caps at ~1.07× end-to-end even if free. The highest-value non-native work
for T3-shaped workloads is enabling the template cache, not offloading.
