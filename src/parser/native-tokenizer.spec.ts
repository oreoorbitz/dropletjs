import * as fs from 'fs'
import * as path from 'path'
import { Tokenizer } from './tokenizer'
import { defaultOptions, normalize } from '../liquid-options'
import { isTagToken, isOutputToken, isHTMLToken } from '../util'
import { Liquid } from '../liquid'
import * as nativeSupport from './native'

const wrapper = require('../../native/native-tokenizer.js')

function collectTemplates (): { name: string; tpl: string }[] {
  const out: { name: string; tpl: string }[] = []
  const stubDir = path.join(__dirname, '..', '..', 'test', 'stub')
  for (const sub of ['root', 'partials', 'views']) {
    const dir = path.join(stubDir, sub)
    if (!fs.existsSync(dir)) continue
    for (const f of fs.readdirSync(dir)) {
      out.push({ name: `stub/${sub}/${f}`, tpl: fs.readFileSync(path.join(dir, f), 'utf8') })
    }
  }
  // synthetic edge cases
  out.push({ name: 'inline/basic', tpl: 'a {{ b }} {% if x %}y{% endif %}' })
  out.push({ name: 'inline/whitespace-ctrl', tpl: '  {%- if x -%} y {%- endif -%}  {{- z -}} ' })
  out.push({ name: 'inline/raw', tpl: '{% raw %}{{ not evaluated }} {% x %}{% endraw %}done' })
  out.push({ name: 'inline/raw-nested', tpl: '{% raw %}a{% raw %}b{% endraw %}{% endraw %}c' })
  out.push({ name: 'inline/quoted-delims', tpl: '{{ "}}" }} {{ \'{%\' }} {{ "a \\" }} b" }}' })
  out.push({ name: 'inline/filters', tpl: '{{ p.price | times: 1.2 | round: 2 | prepend: "$" }}' })
  out.push({ name: 'inline/unicode', tpl: 'héllo wörld {{ ü }} 💧 {% if ü %}✓{% endif %}' })
  out.push({ name: 'inline/comment-tag', tpl: '{% # this is an inline comment %}x' })
  out.push({ name: 'inline/eof-in-html', tpl: 'plain text with no tags at all' })
  out.push({ name: 'inline/only-output', tpl: '{{x}}' })
  out.push({ name: 'inline/adjacent', tpl: '{{a}}{{b}}{% if c %}{% endif %}' })
  // larger page-ish template
  const lines = ['<html><body>']
  for (let i = 0; i < 200; i++) {
    lines.push(`<div class="item ${i}">{{ p${i}.title | escape | upcase }} {% if p${i}.stock > 0 %}in stock{% else %}sold out{% endif %}</div>`)
  }
  lines.push('</body></html>')
  out.push({ name: 'inline/page-200', tpl: lines.join('\n') })
  return out
}

interface TokenSnapshot {
  kind: number;
  begin: number;
  end: number;
  text: string;
  trimLeft: number | boolean;
  trimRight: number | boolean;
  content?: string;
  name?: string;
  args?: string;
}

function snapshot (tokens: any[]): TokenSnapshot[] {
  return tokens.map(t => {
    const s: TokenSnapshot = {
      kind: t.kind, begin: t.begin, end: t.end,
      text: t.input.slice(t.begin, t.end),
      trimLeft: t.trimLeft, trimRight: t.trimRight
    }
    if (isTagToken(t)) { s.name = t.name; s.args = t.args; s.content = t.content }
    else if (isOutputToken(t)) { s.content = t.content }
    else if (isHTMLToken(t)) { s.content = t.getContent() }
    return s
  })
}

describe('native tokenizer (optional)', function () {
  const options = normalize({})

  describe('wrapper native/native-tokenizer.js', function () {
    it('loads the local tokenizer.node build', function () {
      expect(wrapper.available).toBe(true)
      expect(typeof wrapper.tokenizeFlat).toBe('function')
      expect(String(wrapper.source)).toContain('tokenizer.node')
    })
  })

  describe('differential: native vs JS tokenization', function () {
    const templates = collectTemplates()
    it('module is available for the differential test', function () {
      expect(nativeSupport.getNativeTokenizer()).toBeTruthy()
    })
    for (const { name, tpl } of templates) {
      it(`produces identical tokens for ${name}`, function () {
        // JS path (forced)
        const jsToks = new Tokenizer(tpl).readTopLevelTokens(normalize({ useNativeTokenizer: false }))
        // force native
        const nativeOpts = normalize({ useNativeTokenizer: true })
        const natToks = new Tokenizer(tpl).readTopLevelTokens(nativeOpts)
        expect(snapshot(natToks)).toEqual(snapshot(jsToks))
      })
    }
    it('produces identical tokens for auto (default) mode when available', function () {
      const tpl = 'a {{ b | upcase }} {% if x %}y{% endif %}'
      const jsToks = new Tokenizer(tpl).readTopLevelTokens(options)
      const autoToks = new Tokenizer(tpl).readTopLevelTokens(normalize({}))
      expect(snapshot(autoToks)).toEqual(snapshot(jsToks))
    })
    it('tokenizes an empty template identically', function () {
      expect(snapshot(new Tokenizer('').readTopLevelTokens(normalize({ useNativeTokenizer: true }))))
        .toEqual(snapshot(new Tokenizer('').readTopLevelTokens(options)))
    })
    it('throws the same error for unclosed tags', function () {
      const jsErr = () => new Tokenizer('{% if x').readTopLevelTokens(options)
      const natErr = () => new Tokenizer('{% if x').readTopLevelTokens(normalize({ useNativeTokenizer: true }))
      expect(jsErr).toThrow(/not closed/)
      expect(natErr).toThrow(/not closed/)
    })
    it('throws the same error for unclosed raw', function () {
      const natErr = () => new Tokenizer('{% raw %}foo').readTopLevelTokens(normalize({ useNativeTokenizer: true }))
      expect(natErr).toThrow(/raw.*not closed/)
    })
    it('end-to-end render output is identical with native tokenizer', function () {
      const tpl = collectTemplates().find(t => t.name === 'inline/page-200')!.tpl
      const ctx: any = {}
      for (let i = 0; i < 200; i++) ctx['p' + i] = { title: `T<${i}>`, stock: i % 2 }
      const a = new Liquid().parseAndRenderSync(tpl, ctx)
      const b = new Liquid({ useNativeTokenizer: true }).parseAndRenderSync(tpl, ctx)
      const c = new Liquid({ useNativeTokenizer: false }).parseAndRenderSync(tpl, ctx)
      expect(b).toBe(a)
      expect(c).toBe(a)
    })
  })

  describe('flag semantics', function () {
    it('auto (default) uses the native tokenizer when it loads', function () {
      const spy = jest.spyOn(nativeSupport, 'getNativeTokenizer')
      new Tokenizer('a {{ b }}').readTopLevelTokens(normalize({}))
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })
    it('useNativeTokenizer: false never consults the native loader', function () {
      const spy = jest.spyOn(nativeSupport, 'getNativeTokenizer')
      const toks = new Tokenizer('a {{ b }}').readTopLevelTokens(normalize({ useNativeTokenizer: false }))
      expect(toks.length).toBe(2)
      expect(spy).not.toHaveBeenCalled()
      spy.mockRestore()
    })
    it('useNativeTokenizer: true throws when the module is unavailable', function () {
      const spy = jest.spyOn(nativeSupport, 'getNativeTokenizer').mockReturnValue(null)
      expect(() => new Tokenizer('a {{ b }}').readTopLevelTokens(normalize({ useNativeTokenizer: true })))
        .toThrow(/useNativeTokenizer.*not available/)
      spy.mockRestore()
    })
    it('auto silently falls back to JS when the module is unavailable', function () {
      const spy = jest.spyOn(nativeSupport, 'getNativeTokenizer').mockReturnValue(null)
      const toks = new Tokenizer('a {{ b }}').readTopLevelTokens(normalize({}))
      expect(toks.length).toBe(2)
      expect(isOutputToken(toks[1])).toBe(true)
      spy.mockRestore()
    })
    it('custom delimiters fall back to JS (warn once when flag is true)', function () {
      const spy = jest.spyOn(nativeSupport, 'getNativeTokenizer')
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
      const opts = normalize({ useNativeTokenizer: true, tagDelimiterLeft: '[[%', tagDelimiterRight: '%]]' })
      const toks = new Tokenizer('a [[% if x %]]y[[% endif %]]').readTopLevelTokens(opts)
      expect(spy).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledTimes(1)
      expect(toks.map(t => t.kind)).toEqual([16, 4, 16, 4])
      // JS tokenizer is authoritative for custom delimiters
      const jsToks = new Tokenizer('a [[% if x %]]y[[% endif %]]')
        .readTopLevelTokens(normalize({ tagDelimiterLeft: '[[%', tagDelimiterRight: '%]]' }))
      expect(snapshot(toks)).toEqual(snapshot(jsToks))
      spy.mockRestore()
      warn.mockRestore()
    })
    it('trimTagLeft/trimOutputRight options fall back to JS (native only ports "-"-marker control)', function () {
      const spy = jest.spyOn(nativeSupport, 'getNativeTokenizer')
      const engine = new Liquid({ trimTagLeft: true, useNativeTokenizer: true })
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined)
      expect(engine.parseAndRenderSync(' \n \t{%if true%}foo{%endif%} ')).toBe('foo ')
      expect(spy).not.toHaveBeenCalled()
      expect(warn).toHaveBeenCalledTimes(1)
      spy.mockRestore()
      warn.mockRestore()
    })
    it('custom delimiters with auto mode silently use JS', function () {
      const spy = jest.spyOn(nativeSupport, 'getNativeTokenizer')
      const opts = normalize({ outputDelimiterLeft: '[[', outputDelimiterRight: ']]' })
      const toks = new Tokenizer('a [[ b ]]').readTopLevelTokens(opts)
      expect(spy).not.toHaveBeenCalled()
      expect(isOutputToken(toks[1])).toBe(true)
      spy.mockRestore()
    })
  })

  describe('engine wiring', function () {
    it('Liquid options default keeps auto semantics', function () {
      expect(new Liquid().options.useNativeTokenizer).toBeUndefined()
      expect(new Liquid({ useNativeTokenizer: false }).options.useNativeTokenizer).toBe(false)
      expect(new Liquid({ useNativeTokenizer: true }).options.useNativeTokenizer).toBe(true)
    })
    it('parse/render with native enabled matches JS for stub templates', function () {
      const engineJS = new Liquid({ root: path.join(__dirname, '..', '..', 'test', 'stub', 'root') })
      const engineNat = new Liquid({ root: path.join(__dirname, '..', '..', 'test', 'stub', 'root'), useNativeTokenizer: true })
      expect(engineNat.parseAndRenderSync('foo.html loaded')).toBe(engineJS.parseAndRenderSync('foo.html loaded'))
    })
  })
})
