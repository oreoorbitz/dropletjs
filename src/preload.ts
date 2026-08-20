import { LookupType } from './fs/loader'
import { isString } from './util'
import type { Template } from './template/template'
import type { Liquid } from './liquid'

/**
 * Predictive preload support (Feature 2).
 *
 * Setup-time only: parsing stays fully synchronous; `preload()` is an `async`
 * batch driver that yields to the event loop between concurrency chunks.
 */

export interface PreloadOptions {
  /** Preload the full static include/layout dependency closure. Defaults to `true`. */
  deep?: boolean;
  /** Batch size between event-loop yields. Defaults to 8. */
  concurrency?: number;
  /** Lookup type for the root files. Defaults to `LookupType.Root`. */
  lookupType?: LookupType;
}

export interface PreloadResult {
  /** files parsed (roots + discovered dependencies), in load order */
  files: string[];
  /** total number of top-level template nodes parsed */
  templates: number;
}

export interface PreloadGraphNode {
  file: string;
  lookupType: LookupType;
  dependencies: PreloadGraphNode[];
  /** true when this edge closes a cycle (dependencies not expanded again) */
  circular?: boolean;
}

export interface PreloadIdleHandle {
  promise: Promise<PreloadResult | null>;
  cancel: () => void;
}

export interface Dependency {
  file: string;
  lookupType: LookupType;
  currentFile?: string;
}

const DEP_TAGS: Record<string, LookupType> = {
  include: LookupType.Partials,
  render: LookupType.Partials,
  layout: LookupType.Layouts
}

const WALK_SKIP_KEYS = new Set(['liquid', 'parser', 'tokenizer', 'filterThis', 'context', 'handlers'])

function depKey (d: Dependency): string {
  // mirror the parser cache key: relative references include the referrer
  const relative = d.file.startsWith('./') || d.file.startsWith('../')
  return d.lookupType + ':' + d.file + (relative ? '|' + (d.currentFile ?? '') : '')
}

function looksLikeTemplate (v: any): boolean {
  return !!v && typeof v === 'object' && v.token !== undefined &&
    (typeof v.render === 'function' || typeof v.value === 'function')
}

/**
 * Collect static include/render/layout dependencies of parsed templates.
 * Walks nested template structures (branches, loop bodies, blocks) via
 * own-property scanning. Dynamic (variable) file names are skipped — this is
 * static analysis, matching `template/analysis.ts` semantics.
 */
export function collectDependencies (templates: Template[]): Dependency[] {
  const deps: Dependency[] = []
  const seen = new Set<object>()
  const visitValue = (v: any): void => {
    if (Array.isArray(v)) {
      for (const item of v) visitValue(item)
    } else if (looksLikeTemplate(v)) {
      visitTemplate(v)
    } else if (v && typeof v === 'object' && !seen.has(v)) {
      // plain container (e.g. a branch `{ templates: [...] }`); recurse
      seen.add(v)
      for (const key of Object.keys(v)) {
        if (WALK_SKIP_KEYS.has(key)) continue
        const child = v[key]
        if (child && typeof child === 'object') visitValue(child)
      }
    }
  }
  const visitTemplate = (tpl: any): void => {
    if (seen.has(tpl)) return
    seen.add(tpl)
    const token = tpl.token
    const tagName = token && token.name
    const lookupType = tagName && DEP_TAGS[tagName]
    if (lookupType !== undefined && isString(tpl.file)) {
      deps.push({ file: tpl.file, lookupType, currentFile: token.file })
    }
    for (const key of Object.keys(tpl)) {
      if (WALK_SKIP_KEYS.has(key)) continue
      const v = tpl[key]
      if (v && typeof v === 'object') visitValue(v)
    }
  }
  for (const tpl of templates) visitTemplate(tpl)
  return deps
}

/**
 * Expand glob entries (`*`, `**`) against the engine's root directories using
 * Node's fs. Non-glob entries pass through unchanged. Glob expansion requires
 * the default Node file system (it is a setup-time convenience; with a custom
 * `fs` option, pass explicit file lists).
 */
export function expandGlobs (files: string[], liquid: Liquid): string[] {
  const out: string[] = []
  let nodeFs: typeof import('fs') | undefined
  let nodePath: typeof import('path') | undefined
  for (const entry of files) {
    if (!/[*]/.test(entry)) {
      out.push(entry)
      continue
    }
    try {
      nodeFs = nodeFs ?? require('fs')
      nodePath = nodePath ?? require('path')
    } catch {
      throw new Error('preload: glob expansion requires the Node.js fs module; pass explicit file paths when using a custom `fs` option')
    }
    const re = new RegExp('^' + entry.split(/(\*\*|\*)/g).map(part =>
      part === '**' ? '.*' : part === '*' ? '[^/]*' : part.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    ).join('') + '$')
    for (const root of liquid.options.root) {
      walkDir(nodeFs!, nodePath!, root, '', re, out)
    }
  }
  return out
}

function walkDir (fs: typeof import('fs'), path: typeof import('path'), root: string, rel: string, re: RegExp, out: string[]): void {
  let entries
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const r = rel ? rel + '/' + e.name : e.name
    if (e.isDirectory()) walkDir(fs, path, root, r, re, out)
    else if (re.test(r)) out.push(r)
  }
}

/** Shared driver used by Liquid.preload / preloadGraph. */
export async function preloadFiles (liquid: Liquid, files: string[], opts: PreloadOptions): Promise<PreloadResult> {
  const deep = opts.deep !== false
  const concurrency = Math.max(1, opts.concurrency ?? 8)
  const list = expandGlobs(files, liquid)
  const seen = new Set<string>()
  const queue: Dependency[] = list.map(file => ({ file, lookupType: opts.lookupType ?? LookupType.Root }))
  const loaded: string[] = []
  let templates = 0
  while (queue.length) {
    const chunk = queue.splice(0, concurrency)
    for (const item of chunk) {
      const key = depKey(item)
      if (seen.has(key)) continue
      seen.add(key)
      let tpls: Template[]
      try {
        tpls = liquid._parseFile(item.file, true, item.lookupType, item.currentFile)
      } catch (err) {
        throw new Error(`preload: failed to parse "${item.file}": ${(err as Error).message}`)
      }
      templates += tpls.length
      loaded.push(item.file)
      if (deep) {
        for (const dep of collectDependencies(tpls)) queue.push(dep)
      }
    }
    // yield to the event loop between concurrency chunks
    if (queue.length) await new Promise(resolve => setImmediate(resolve))
  }
  return { files: loaded, templates }
}

/** Build the static dependency tree of root files (parses as needed). */
export function buildPreloadGraph (liquid: Liquid, files: string[], opts: PreloadOptions): PreloadGraphNode[] {
  const list = expandGlobs(files, liquid)
  const build = (file: string, lookupType: LookupType, currentFile: string | undefined, stack: Set<string>): PreloadGraphNode => {
    const key = depKey({ file, lookupType, currentFile })
    const node: PreloadGraphNode = { file, lookupType, dependencies: [] }
    if (stack.has(key)) {
      node.circular = true
      return node
    }
    stack.add(key)
    const tpls = liquid._parseFile(file, true, lookupType, currentFile)
    for (const dep of collectDependencies(tpls)) {
      node.dependencies.push(build(dep.file, dep.lookupType, dep.currentFile, stack))
    }
    stack.delete(key)
    return node
  }
  return list.map(file => build(file, opts.lookupType ?? LookupType.Root, undefined, new Set()))
}
