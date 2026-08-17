import { QuotedToken, RangeToken, OperatorToken, Token, PropertyAccessToken, OperatorType, operatorTypes, FilteredValueToken } from '../tokens'
import { isRangeToken, isPropertyAccessToken, isFilteredValueToken, UndefinedVariableError, range, isOperatorToken, assert } from '../util'
import type { Context } from '../context'
import type { UnaryOperatorHandler } from '../render'
import { Drop } from '../drop'
import { Filter } from '../template/filter'

const FILTER_CACHE = '__liquidSyncFilterCache'

export class Expression {
  readonly postfix: Token[]

  public constructor (tokens: Iterable<Token>) {
    this.postfix = toPostfix(tokens)
  }
  public evaluate (ctx: Context, lenient?: boolean): unknown {
    assert(ctx, 'unable to evaluate: context not defined')
    const operands: any[] = []
    for (const token of this.postfix) {
      if (isOperatorToken(token)) {
        const r = operands.pop()
        let result
        if (operatorTypes[token.operator] === OperatorType.Unary) {
          result = (ctx.opts.operators[token.operator] as UnaryOperatorHandler)(r, ctx)
        } else {
          const l = operands.pop()
          result = ctx.opts.operators[token.operator](l, r, ctx)
        }
        operands.push(result)
      } else {
        operands.push(evalToken(token, ctx, lenient))
      }
    }
    return operands[0]
  }
  public valid () {
    return !!this.postfix.length
  }
}

export function evalToken (token: Token | undefined, ctx: Context, lenient = false): unknown {
  if (!token) return
  if ('content' in token) return token.content
  if (isPropertyAccessToken(token)) return evalPropertyAccessToken(token, ctx, lenient)
  if (isRangeToken(token)) return evalRangeToken(token, ctx)
  if (isFilteredValueToken(token)) return evalFilteredValueToken(token, ctx, lenient)
}

function evalFilteredValueToken (token: FilteredValueToken, ctx: Context, lenient: boolean): unknown {
  assert(ctx.liquid, 'FilteredValueToken evaluation requires liquid instance in context')
  lenient = lenient || (ctx.opts.lenientIf && token.filters.length > 0 && token.filters[0].name === 'default')
  let val = token.initial.evaluate(ctx, lenient)

  // Cache Filter instances per filter token: token and liquid are stable across
  // renders of the same template, and Filter holds no per-render state besides
  // its reusable `this` object (whose `context` is refreshed per render).
  let filterCache: Map<string, Filter> | undefined = (token as any)[FILTER_CACHE]
  if (filterCache === undefined) {
    filterCache = new Map()
    Object.defineProperty(token, FILTER_CACHE, { value: filterCache, enumerable: false, configurable: false, writable: false })
  }

  for (const filterToken of token.filters) {
    let filter = filterCache.get(filterToken.name)
    if (filter === undefined) {
      const filterImpl = ctx.liquid.filters[filterToken.name]
      assert(filterImpl || !ctx.liquid.options.strictFilters, () => `undefined filter: ${filterToken.name}`)
      filter = new Filter(filterToken, filterImpl, ctx.liquid)
      filterCache.set(filterToken.name, filter)
    }
    val = filter.render(val, ctx)
  }

  return val
}

function evalPropertyAccessToken (token: PropertyAccessToken, ctx: Context, lenient: boolean): unknown {
  // Fast path: all props are static identifier/quoted segments — no per-segment evalToken calls
  let allStatic = true
  const tokenProps = token.props
  for (let i = 0; i < tokenProps.length; i++) {
    if (!('content' in tokenProps[i])) { allStatic = false; break }
  }
  try {
    if (allStatic) {
      const props: (string | number)[] = new Array(tokenProps.length)
      for (let i = 0; i < tokenProps.length; i++) props[i] = (tokenProps[i] as any).content
      if (token.variable) {
        const variable = evalToken(token.variable, ctx, lenient)
        return ctx._getFromScope(variable, props)
      }
      return ctx._get(props)
    }
    const props: (string | number | Drop)[] = []
    for (const prop of tokenProps) {
      props.push(evalToken(prop, ctx, false) as unknown as string | number | Drop)
    }
    if (token.variable) {
      const variable = evalToken(token.variable, ctx, lenient)
      return ctx._getFromScope(variable, props)
    } else {
      return ctx._get(props)
    }
  } catch (e) {
    if (lenient && (e as Error).name === 'InternalUndefinedVariableError') return null
    throw (new UndefinedVariableError(e as Error, token))
  }
}

export function evalQuotedToken (token: QuotedToken) {
  return token.content
}

function evalRangeToken (token: RangeToken, ctx: Context) {
  const low: number = evalToken(token.lhs, ctx) as number
  const high: number = evalToken(token.rhs, ctx) as number
  ctx.memoryLimit.use(high - low + 1)
  return range(+low, +high + 1)
}

function toPostfix (tokens: Iterable<Token>): Token[] {
  const result: Token[] = []
  const ops: OperatorToken[] = []
  for (const token of tokens) {
    if (isOperatorToken(token)) {
      while (ops.length && ops[ops.length - 1].getPrecedence() > token.getPrecedence()) {
        result.push(ops.pop()!)
      }
      ops.push(token)
    } else result.push(token)
  }
  while (ops.length) {
    result.push(ops.pop()!)
  }
  return result
}
