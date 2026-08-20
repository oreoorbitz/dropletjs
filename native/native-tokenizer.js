'use strict';
/*
 * native-tokenizer.js — loader/wrapper for the optional dropletjs native
 * tokenizer addon (N-API).
 *
 * Lookup order:
 *   1. `dropletjs-native` package (the endgame: a separate optional package
 *      shipping prebuilt binaries per platform/arch — model this as an
 *      optionalDependency in your app).
 *   2. `process.env.DROPLETJS_NATIVE_PATH` (explicit path to a .node file).
 *   3. The locally compiled `native/tokenizer.node` next to this file
 *      (build with `native/build.sh`).
 *
 * Exposes:
 *   available   — true if a native module was loaded
 *   loadError   — the error from the last failed attempt (diagnostics only)
 *   tokenizeFlat(input) — flat tokenization:
 *       { count, kinds, begins, ends, contentStarts, contentBegins,
 *         contentEnds, contents }
 *       kinds: 16 = HTML, 8 = Output ({{ }}), 4 = Tag ({% %});
 *       begin/end are full token ranges in `input`; contentBegins/contentEnds
 *       are the whitespace-control-trimmed content ranges in `input`.
 *       Whitespace control ({%- -%} adjacent HTML trimming, raw/endraw) is
 *       applied natively, assuming DEFAULT delimiters and greedy=true.
 *   tokenizeCount(input) — token count only (diagnostics)
 */

const path = require('path');

let mod = null;
let loadError = null;

const attempts = [];
// 1. optional external package
attempts.push(['dropletjs-native', () => require('dropletjs-native')]);
// 2. explicit env override
if (process.env.DROPLETJS_NATIVE_PATH) {
  const p = process.env.DROPLETJS_NATIVE_PATH;
  attempts.push([p, () => require(p)]);
}
// 3. local build next to this file
const local = path.join(__dirname, 'tokenizer.node');
attempts.push([local, () => require(local)]);

let source = null;
for (const [name, load] of attempts) {
  try {
    mod = load();
    if (mod && typeof mod.tokenizeFlat === 'function') { source = name; break; }
    mod = null;
  } catch (e) {
    loadError = e;
    mod = null;
  }
}

module.exports = {
  available: !!mod,
  loadError: mod ? null : loadError,
  source,
  tokenizeFlat: mod ? mod.tokenizeFlat.bind(mod) : null,
  tokenizeCount: mod && typeof mod.tokenizeCount === 'function' ? mod.tokenizeCount.bind(mod) : null
};
