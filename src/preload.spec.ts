import { Liquid } from './liquid'
import { LRUCacheStore } from './cache'
import { LookupType } from './fs/loader'
import { mock, restore } from '../test/stub/mockfs'

const FILES = {
  '/root/page.liquid': '{% layout "skeleton" %}{% block content %}{% include "header" %}{% render "item", item: items[0] %}page{% endblock %}',
  '/root/header.liquid': '{% include "nav" %}H',
  '/root/nav.liquid': 'N',
  '/root/item.liquid': 'I{{ item }}',
  '/root/layouts/skeleton.liquid': 'S{% block content %}{% endblock %}'
}

describe('preload', () => {
  afterEach(restore)
  const make = () => {
    mock(FILES)
    const store = new LRUCacheStore({ maxEntries: 64 })
    const engine = new Liquid({ root: '/root', layouts: '/root/layouts', extname: '.liquid', cache: store })
    return { engine, store }
  }

  it('should preload a file and its static dependency closure (deep default)', async () => {
    const { engine, store } = make()
    const res = await engine.preload('page')
    expect(res.files.sort()).toEqual(['header', 'item', 'nav', 'page', 'skeleton'].sort())
    expect(store.size).toBe(5)
    // everything renders from cache now
    const html = await engine.renderFile('page', { items: ['x'] })
    expect(html).toContain('Ix')
    expect(html).toContain('NH')
  })

  it('should not load dependencies with deep: false', async () => {
    const { engine, store } = make()
    const res = await engine.preload('page', { deep: false })
    expect(res.files).toEqual(['page'])
    expect(store.size).toBe(1)
  })

  it('should respect concurrency chunking', async () => {
    const { engine } = make()
    const res = await engine.preload(['page', 'header', 'nav'], { concurrency: 1 })
    expect(res.files.length).toBe(7) // Root:* + Partials:* keys
  })

  it('should render identical output before and after preload', async () => {
    const { engine } = make()
    const ctx = { items: ['x'] }
    const before = await engine.renderFile('page', ctx)
    const e2 = make().engine
    await e2.preload('page')
    const after = await e2.renderFile('page', ctx)
    expect(after).toBe(before)
  })
})

describe('preloadGraph', () => {
  afterEach(restore)
  it('should return the static dependency tree', () => {
    mock(FILES)
    const engine = new Liquid({ root: '/root', layouts: '/root/layouts', extname: '.liquid', cache: true })
    const graph = engine.preloadGraph('page')
    expect(graph).toHaveLength(1)
    const page = graph[0]
    expect(page.file).toBe('page')
    expect(page.lookupType).toBe(LookupType.Root)
    const names = page.dependencies.map(d => d.file).sort()
    expect(names).toEqual(['item', 'skeleton'].sort().concat('header').sort())
    const skeleton = page.dependencies.find(d => d.file === 'skeleton')!
    expect(skeleton.lookupType).toBe(LookupType.Layouts)
    const header = page.dependencies.find(d => d.file === 'header')!
    expect(header.dependencies.map(d => d.file)).toEqual(['nav'])
  })
})

describe('preloadOnIdle', () => {
  afterEach(restore)
  it('should preload on the next idle tick', async () => {
    mock(FILES)
    const store = new LRUCacheStore(64)
    const engine = new Liquid({ root: '/root', layouts: '/root/layouts', extname: '.liquid', cache: store })
    const handle = engine.preloadOnIdle('page')
    const res = await handle.promise
    expect(res).not.toBeNull()
    expect(store.size).toBe(5)
  })
  it('should be cancellable', async () => {
    mock(FILES)
    const store = new LRUCacheStore(64)
    const engine = new Liquid({ root: '/root', layouts: '/root/layouts', extname: '.liquid', cache: store })
    const handle = engine.preloadOnIdle('page')
    handle.cancel()
    const res = await handle.promise
    expect(res).toBeNull()
    expect(store.size).toBe(0)
  })
})
