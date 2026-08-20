import { LRUCacheStore, adaptCacheStore, isCacheStore } from './store'
import { Liquid } from '../liquid'
import { mock, restore } from '../../test/stub/mockfs'

describe('LRUCacheStore', () => {
  it('should get/set/has/delete/clear', () => {
    const s = new LRUCacheStore({ maxEntries: 10 })
    s.set('a', ['A'] as any)
    expect(s.get('a')).toEqual(['A'])
    expect(s.has('a')).toBe(true)
    expect(s.has('b')).toBe(false)
    expect(s.delete('a')).toBe(true)
    expect(s.get('a')).toBe(undefined)
    s.set('a', ['A'] as any)
    s.clear()
    expect(s.size).toBe(0)
    expect(s.has('a')).toBe(false)
  })
  it('should evict least-recently-used beyond maxEntries', () => {
    const s = new LRUCacheStore({ maxEntries: 2 })
    s.set('a', ['A'] as any)
    s.set('b', ['B'] as any)
    s.get('a') // refresh a
    s.set('c', ['C'] as any) // evicts b
    expect(s.has('a')).toBe(true)
    expect(s.has('b')).toBe(false)
    expect(s.has('c')).toBe(true)
    expect(s.size).toBe(2)
  })
  it('should expire entries after ttl', () => {
    let now = 1000
    const s = new LRUCacheStore({ maxEntries: 10, ttl: 100, now: () => now })
    s.set('a', ['A'] as any)
    now = 1050
    expect(s.get('a')).toEqual(['A'])
    now = 1200
    expect(s.get('a')).toBe(undefined)
    expect(s.has('a')).toBe(false)
  })
  it('should track stats', () => {
    const s = new LRUCacheStore({ maxEntries: 1 })
    s.set('a', ['A'] as any)
    s.get('a') // hit
    s.get('nope') // miss
    s.set('b', ['B'] as any) // evicts a
    expect(s.stats).toEqual({ hits: 1, misses: 1, evictions: 1, size: 1 })
    s.resetStats()
    expect(s.stats).toEqual({ hits: 0, misses: 0, evictions: 0, size: 1 })
  })
  it('should adapt to the legacy LiquidCache interface', () => {
    const s = new LRUCacheStore(2)
    expect(isCacheStore(s)).toBe(true)
    expect(isCacheStore({ read: () => undefined, write: () => undefined, remove: () => undefined })).toBe(false)
    const legacy = adaptCacheStore(s)
    legacy.write('k', ['V'] as any)
    expect(legacy.read('k')).toEqual(['V'])
    legacy.remove('k')
    expect(legacy.read('k')).toBe(undefined)
  })
})

describe('Liquid cache: CacheStore option', () => {
  afterEach(restore)
  const engine = (cache: any) => new Liquid({ cache, root: '/root', extname: '.liquid' })
  it('should expose templateCache for cache=true', () => {
    const e = engine(true)
    expect(e.templateCache).toBeInstanceOf(LRUCacheStore)
  })
  it('should expose templateCache for a custom store and populate it on renderFileSync', async () => {
    mock({ '/root/page.liquid': 'page:{{ c }}' })
    const store = new LRUCacheStore({ maxEntries: 8 })
    const e = engine(store)
    expect(e.templateCache).toBe(store)
    const html = await e.renderFile('page', { c: 'c' })
    expect(html).toBe('page:c')
    expect(store.size).toBe(1)
    expect(store.stats.hits).toBe(0)
    // second render hits the store
    await e.renderFile('page', { c: 'c' })
    expect(store.stats.hits).toBe(1)
    // manual invalidate
    const key = Array.from((store as any).map.keys())[0]
    store.delete(key as string)
    expect(store.size).toBe(0)
  })
  it('should keep cache=false disabled', () => {
    expect(engine(false).templateCache).toBe(undefined)
  })
})
