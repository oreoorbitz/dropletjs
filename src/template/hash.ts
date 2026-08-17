import { evalToken } from '../render/expression'
import { Context } from '../context/context'
import { Tokenizer } from '../parser/tokenizer'
import { Token } from '../tokens/token'

type HashValueTokens = Record<string, Token | undefined>

const EMPTY_HASH: Record<string, any> = Object.freeze({}) as Record<string, any>

/**
 * Key-Value Pairs Representing Tag Arguments
 * Example:
 *    For the markup `, foo:'bar', coo:2 reversed %}`,
 *    hash['foo'] === 'bar'
 *    hash['coo'] === 2
 *    hash['reversed'] === undefined
 */
export class Hash {
  hash: HashValueTokens = {}

  constructor (input: string | Tokenizer, jekyllStyle?: boolean | string) {
    const tokenizer = input instanceof Tokenizer ? input : new Tokenizer(input, {})
    for (const hash of tokenizer.readHashes(jekyllStyle)) {
      this.hash[hash.name.content] = hash.value
    }
  }

  render (ctx: Context): Record<string, any> {
    const source = this.hash
    const keys = Object.keys(source)
    if (keys.length === 0) return EMPTY_HASH
    const hash: Record<string, any> = {}
    for (const key of keys) {
      hash[key] = source[key] === undefined ? true : evalToken(source[key], ctx)
    }
    return hash
  }
}
