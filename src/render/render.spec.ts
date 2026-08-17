import { Context } from '../context'
import { HTMLToken, TagToken } from '../tokens'
import { Render } from './render'
import { Tag, HTML } from '../template'
import { SimpleEmitter } from '../emitters'
import { toPromise } from '../util'

describe('render', function () {
  let render: Render
  beforeEach(function () {
    render = new Render()
  })

  describe('.renderTemplates()', function () {
    it('should render html', async function () {
      const scope = new Context()
      const token = { getContent: () => '<p>' } as HTMLToken
      const html = await toPromise(render.renderTemplates([new HTML(token)], scope, new SimpleEmitter()))
      return expect(html).toBe('<p>')
    })
  })

  describe('.renderTemplatesToNodeStream()', function () {
    it('should render to html stream', function (done) {
      const scope = new Context()
      const tpls = [
        new HTML({ getContent: () => '<p>' } as HTMLToken),
        new HTML({ getContent: () => '</p>' } as HTMLToken)
      ]
      const stream = render.renderTemplatesToNodeStream(tpls, scope)
      let result = ''
      stream.on('data', (data) => {
        result += data
      })
      stream.on('end', () => {
        expect(result).toBe('<p></p>')
        done()
      })
    })
    // SYNC FORK: tags returning Promises are rejected; the stream errors.
    it('should error the stream for async tags (sync-only build)', function (done) {
      const scope = new Context()
      class CustomTag extends Tag {
        render () {
          return new Promise(
            resolve => setTimeout(() => resolve('async tag'), 10)
          )
        }
      }
      const tpls = [
        new HTML({ getContent: () => '<p>' } as HTMLToken),
        new CustomTag({ content: 'foo', args: '', name: 'foo', input: 'foo', file: undefined, getText: () => 'foo', getPosition: () => [1, 1] } as unknown as TagToken, [], {} as any),
        new HTML({ getContent: () => '</p>' } as HTMLToken)
      ]
      const stream = render.renderTemplatesToNodeStream(tpls, scope)
      stream.on('data', () => undefined)
      stream.on('error', (err: Error) => {
        expect(err.message).toMatch(/is not supported in the sync-only build/)
        done()
      })
      stream.on('end', () => done(new Error('stream should have errored')))
    })
  })
})
