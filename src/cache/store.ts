import type { Template } from '../template/template'
import { LiquidCache } from './cache'

/**
 * Developer-facing pluggable template cache store.
 *
 * A CacheStore is the modern alternative to the legacy `LiquidCache`
 * ({ read/write/remove }) interface. Pass an instance via the `cache` option:
 *
 * ```ts
 * const engine = new Liquid({ cache: new LRUCacheStore({ maxEntries: 512, ttl: 60_000 }) })
 * ```
 *
 * Why: the T3 benchmark (200-partial page) profiled ~88.5% of cold-start time
 * in fs syscalls (lookup/exists/readFile) when no cache is installed. A
 * persistent, inspectable cache store eliminates those syscalls for repeated
 * renders and gives the developer manual control (warm/invalidate/inspect).
 */
export interface CacheStore {
  get (key: string): Template[] | undefined;
  set (key: string, value: Template[]): void;
  has? (key: string): boolean;
  delete? (key: string): boolean;
  clear? (): void;
}

export function isCacheStore (x: any): x is CacheStore {
  return !!x && typeof x.get === 'function' && typeof x.set === 'function'
}

/** Adapt a CacheStore to the internal legacy LiquidCache interface. */
export function adaptCacheStore (store: CacheStore): LiquidCache {
  return {
    read: (key: string) => store.get(key),
    write: (key: string, value: any) => { store.set(key, value) },
    remove: (key: string) => { if (store.delete) store.delete(key) }
  }
}

export interface LRUCacheStoreOptions {
  /** Maximum number of cached templates. Defaults to 1024. */
  maxEntries?: number;
  /** Time-to-live per entry in milliseconds. 0/undefined = no expiry. */
  ttl?: number;
  /** Clock override (testing). */
  now?: () => number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
}

interface Entry {
  value: Template[] | undefined;
  /** expiry timestamp (ms); 0 = never expires */
  expires: number;
}

/**
 * Map-based LRU cache store with optional TTL and hit/miss/eviction stats.
 * Iteration order of a Map is insertion order; on `get` the entry is
 * re-inserted to mark it most-recently-used. Eviction removes the oldest
 * (least-recently-used) entry.
 */
export class LRUCacheStore implements CacheStore {
  public readonly maxEntries: number
  public readonly ttl: number
  private readonly now: () => number
  private map = new Map<string, Entry>()
  private _hits = 0
  private _misses = 0
  private _evictions = 0

  public constructor (options: LRUCacheStoreOptions | number = {}) {
    const opts: LRUCacheStoreOptions = typeof options === 'number' ? { maxEntries: options } : options
    this.maxEntries = opts.maxEntries ?? 1024
    this.ttl = opts.ttl ?? 0
    this.now = opts.now ?? Date.now
  }

  public get (key: string): Template[] | undefined {
    const entry = this.map.get(key)
    if (!entry) {
      this._misses++
      return undefined
    }
    if (entry.expires !== 0 && this.now() >= entry.expires) {
      this.map.delete(key)
      this._evictions++
      this._misses++
      return undefined
    }
    // refresh recency
    this.map.delete(key)
    this.map.set(key, entry)
    this._hits++
    return entry.value
  }

  public set (key: string, value: Template[]): void {
    if (this.maxEntries <= 0) return
    if (this.map.has(key)) this.map.delete(key)
    else if (this.map.size >= this.maxEntries) this.evictOldest()
    const expires = this.ttl > 0 ? this.now() + this.ttl : 0
    this.map.set(key, { value, expires })
  }

  public has (key: string): boolean {
    const entry = this.map.get(key)
    if (!entry) return false
    if (entry.expires !== 0 && this.now() >= entry.expires) {
      this.map.delete(key)
      this._evictions++
      return false
    }
    return true
  }

  public delete (key: string): boolean {
    return this.map.delete(key)
  }

  public clear (): void {
    this.map.clear()
  }

  public get size (): number {
    return this.map.size
  }

  public get stats (): CacheStats {
    return {
      hits: this._hits,
      misses: this._misses,
      evictions: this._evictions,
      size: this.map.size
    }
  }

  /** Reset hit/miss/eviction counters (entries are kept). */
  public resetStats (): void {
    this._hits = 0
    this._misses = 0
    this._evictions = 0
  }

  private evictOldest (): void {
    const oldest = this.map.keys().next()
    if (!oldest.done) {
      this.map.delete(oldest.value)
      this._evictions++
    }
  }
}
