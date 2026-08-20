import { Limiter, assert, isTagToken, isOutputToken, ParseError, deepFreezeTemplates } from '../util'
import { Tokenizer } from './tokenizer'
import { ParseStream } from './parse-stream'
import { TopLevelToken, OutputToken } from '../tokens'
import { Template, Output, HTML } from '../template'
import { LiquidCache } from '../cache'
import { FS, Loader, LookupType } from '../fs'
import { LiquidError, LiquidErrors } from '../util/error'
import type { Liquid } from '../liquid'

export class Parser {
  public parseFile: (file: string, sync?: boolean, type?: LookupType, currentFile?: string) => Template[]

  private liquid: Liquid
  private fs: FS
  private cache?: LiquidCache
  private loader: Loader
  private parseLimit: Limiter

  public constructor (liquid: Liquid) {
    this.liquid = liquid
    this.cache = this.liquid.options.cache
    this.fs = this.liquid.options.fs
    this.parseFile = this.cache ? this._parseFileCached : this._parseFile
    this.loader = new Loader(this.liquid.options)
    this.parseLimit = new Limiter('parse length', liquid.options.parseLimit)
  }
  public parse (html: string, filepath?: string): Template[] {
    html = String(html)
    this.parseLimit.use(html.length)
    const tokenizer = new Tokenizer(html, this.liquid.options.operators, filepath, undefined, this.liquid.options.groupedExpressions)
    const tokens = tokenizer.readTopLevelTokens(this.liquid.options)
    const templates = this.parseTokens(tokens)
    if (this.liquid.options.immutableTemplates) deepFreezeTemplates(templates)
    return templates
  }
  public parseTokens (tokens: TopLevelToken[]) {
    let token
    const templates: Template[] = []
    const errors: LiquidError[] = []
    while ((token = tokens.shift())) {
      try {
        templates.push(this.parseToken(token, tokens))
      } catch (err) {
        if (this.liquid.options.catchAllErrors) errors.push(err as LiquidError)
        else throw err
      }
    }
    if (errors.length) throw new LiquidErrors(errors)
    return templates
  }
  public parseToken (token: TopLevelToken, remainTokens: TopLevelToken[]) {
    try {
      if (isTagToken(token)) {
        const TagClass = this.liquid.tags[token.name]
        assert(TagClass, `tag "${token.name}" not found`)
        return new TagClass(token, remainTokens, this.liquid, this)
      }
      if (isOutputToken(token)) {
        return new Output(token as OutputToken, this.liquid)
      }
      return new HTML(token)
    } catch (e) {
      if (LiquidError.is(e)) throw e
      throw new ParseError(e as Error, token)
    }
  }
  public parseStream (tokens: TopLevelToken[]) {
    return new ParseStream(tokens, (token, tokens) => this.parseToken(token, tokens))
  }
  private _parseFileCached (file: string, sync?: boolean, type: LookupType = LookupType.Root, currentFile?: string): Template[] {
    const cache = this.cache!
    const key = this.loader.shouldLoadRelative(file) ? currentFile + ',' + file : type + ':' + file
    const tpls = cache.read(key)
    if (tpls) {
      if (typeof (tpls as any).then === 'function') {
        throw new Error('async cache is not supported in the sync-only build of liquidjs')
      }
      return tpls as Template[]
    }

    try {
      const parsed = this._parseFile(file, sync, type, currentFile)
      cache.write(key, parsed as any)
      return parsed
    } catch (err) { cache.remove(key); throw err }
  }
  private _parseFile (file: string, sync?: boolean, type: LookupType = LookupType.Root, currentFile?: string): Template[] {
    const filepath = this.loader.lookup(file, type, sync, currentFile)
    if (!this.fs.readFileSync) throw new Error('readFileSync not implemented')
    return this.parse(this.fs.readFileSync(filepath), filepath)
  }
}
