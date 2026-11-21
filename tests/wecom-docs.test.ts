import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { describe, it } from 'node:test'
import { KeelError } from '../src/errors.js'
import {
  createDoc,
  docHeader,
  docidFromUrl,
  docName,
  joinText,
  listDocsByName,
  resolveDocid,
  sectionRange
} from '../src/wecom/docs.js'

describe('docName', () => {
  it('replaces slashes with spaced dashes', () => {
    assert.equal(docName('acme/platform/app'), 'acme - platform - app')
  })

  it('handles paths exceeding 255 code points with hash suffix', () => {
    const longPath = 'a'.repeat(300)
    const result = docName(longPath)
    assert.equal([...result].length, 255)
    assert.equal(result.slice(0, 240), 'a'.repeat(240))
    assert.equal(result[240], '-')
    const hexSuffix = result.slice(241)
    assert.equal(hexSuffix.length, 14)
    assert.match(hexSuffix, /^[0-9a-f]{14}$/)
    assert.equal(hexSuffix, createHash('sha256').update(longPath).digest('hex').slice(0, 14))
    assert.equal(result, docName(longPath))

    const longPathWithSlashes = 'group/subgroup/project/' + 'b'.repeat(277)
    const resultWithSlashes = docName(longPathWithSlashes)
    assert.equal([...resultWithSlashes].length, 255)
    assert.equal(resultWithSlashes[240], '-')
    const hexSuffixWithSlashes = resultWithSlashes.slice(241)
    assert.equal(hexSuffixWithSlashes.length, 14)
    assert.equal(
      hexSuffixWithSlashes,
      createHash('sha256').update(longPathWithSlashes).digest('hex').slice(0, 14),
    )
  })

  it('returns unchanged when result has exactly 255 code points', () => {
    const exact255 = 'x'.repeat(255)
    assert.equal(docName(exact255), exact255)

    const pathWithSlashes = 'a/b' + 'c'.repeat(250)
    const expected = 'a - b' + 'c'.repeat(250)
    assert.equal([...expected].length, 255)
    assert.equal(docName(pathWithSlashes), expected)
  })
})

describe('docidFromUrl', () => {
  it('extracts doc id with query params', () => {
    assert.equal(docidFromUrl('https://doc.weixin.qq.com/doc/w3_ABC?scode=x'), 'w3_ABC')
  })

  it('extracts doc id with fragment and plain end', () => {
    assert.equal(docidFromUrl('https://doc.weixin.qq.com/doc/w3_ABC#frag'), 'w3_ABC')
    assert.equal(docidFromUrl('https://doc.weixin.qq.com/doc/w3_ABC'), 'w3_ABC')
  })

  it('returns null for non-doc URLs and empty doc segment', () => {
    assert.equal(docidFromUrl('https://doc.weixin.qq.com/sheet/x'), null)
    assert.equal(docidFromUrl('https://doc.weixin.qq.com/sheet/x?u=/doc/w3_X'), null)
    assert.equal(docidFromUrl('https://doc.weixin.qq.com/doc/'), null)
    assert.equal(docidFromUrl('.../doc/'), null)
    assert.equal(docidFromUrl('https://doc.weixin.qq.com/doc/?query=1'), null)
    assert.equal(docidFromUrl('https://doc.weixin.qq.com/doc/#fragment'), null)
  })
})

describe('joinText', () => {
  it('concatenates text nodes and returns starting offset', () => {
    const nodes = [
      { begin: 10, end: 15, text: 'hello' },
      { begin: 15, end: 16, text: ' ' },
      { begin: 16, end: 21, text: 'world' }
    ]
    assert.deepEqual(joinText(nodes), { text: 'hello world', offset: 10 })
    assert.deepEqual(joinText([]), { text: '', offset: 0 })
  })

  it('throws keel/wecom-doc-index when end - begin mismatches text length', () => {
    assert.throws(
      () => joinText([{ begin: 0, end: 10, text: 'short' }]),
      (err: unknown) => {
        return err instanceof KeelError && err.code === 'keel/wecom-doc-index'
      }
    )
  })

  it('throws keel/wecom-doc-index when there is a gap', () => {
    assert.throws(
      () =>
        joinText([
          { begin: 0, end: 5, text: 'hello' },
          { begin: 6, end: 11, text: 'world' }
        ]),
      (err: unknown) => {
        return err instanceof KeelError && err.code === 'keel/wecom-doc-index'
      }
    )
  })
})

describe('sectionRange', () => {
  const text = 'Keel 周报\nacme/app\n周报 2026-11-13\na\n周报 2026-11-20\nb\nc\n月报 2026-11\nm\n'

  it('extracts correct section range between boundaries', () => {
    const rangeWeekly = sectionRange(text, '周报 2026-11-20')
    assert.ok(rangeWeekly !== null)
    assert.equal(text.slice(rangeWeekly.begin, rangeWeekly.end), '周报 2026-11-20\nb\nc\n')
  })

  it('extracts section range running to the end', () => {
    const rangeMonthly = sectionRange(text, '月报 2026-11')
    assert.ok(rangeMonthly !== null)
    assert.equal(rangeMonthly.end, text.length)
    assert.equal(text.slice(rangeMonthly.begin, rangeMonthly.end), '月报 2026-11\nm\n')
  })

  it('returns null when title does not exist', () => {
    assert.equal(sectionRange(text, '周报 2026-11-27'), null)
  })

  it('does not treat lines with trailing space as title or boundary', () => {
    const trailingSpaceTitle = 'Keel 周报\nacme/app\n周报 2026-11-20 \ncontent\n'
    assert.equal(sectionRange(trailingSpaceTitle, '周报 2026-11-20'), null)

    const trailingSpaceBoundary = 'Keel 周报\nacme/app\n周报 2026-11-13\ncontent\n周报 2026-11-20 \nmore\n'
    const range = sectionRange(trailingSpaceBoundary, '周报 2026-11-13')
    assert.ok(range !== null)
    assert.equal(range.end, trailingSpaceBoundary.length)
  })
})

describe('docHeader', () => {
  it('formats header with path with namespace', () => {
    assert.equal(docHeader('acme/app'), 'Keel 周报\nacme/app\n')
  })
})

import { createFakeWecom, type FakeRouteHandler } from './helpers/fake-wecom.js'
import { WecomHttp } from '../src/wecom/http.js'

function setupWecom(routes: Record<string, FakeRouteHandler> = {}) {
  const fake = createFakeWecom({
    '/cgi-bin/gettoken': { errcode: 0, access_token: 't', expires_in: 7200 },
    ...routes
  })
  const http = new WecomHttp({
    corpId: 'fake_corp',
    secret: 'fake_secret',
    fetch: fake.fetch,
    sleep: async () => {}
  })
  return { http, calls: fake.calls }
}

describe('listDocsByName', () => {
  it('returns target only on page 2 with 2 file_list calls and correct pagination body', async () => {
    let fileListCallCount = 0
    const { http, calls } = setupWecom({
      '/cgi-bin/wedrive/file_list': () => {
        fileListCallCount++
        if (fileListCallCount === 1) {
          return {
            body: {
              has_more: true,
              next_start: 1000,
              file_list: {
                item: [
                  {
                    fileid: 'id0',
                    file_name: 'other',
                    file_type: 3,
                    file_status: 1,
                    url: 'https://doc.weixin.qq.com/doc/w3_0'
                  }
                ]
              }
            }
          }
        }
        return {
          body: {
            has_more: false,
            file_list: {
              item: [
                {
                  fileid: 'id1',
                  file_name: 'report',
                  file_type: 3,
                  file_status: 1,
                  url: 'https://doc.weixin.qq.com/doc/w3_1'
                }
              ]
            }
          }
        }
      }
    })

    const result = await listDocsByName(http, { spaceid: 's1', fatherid: 'f1' }, 'report')
    assert.deepEqual(result, [{ fileid: 'id1', url: 'https://doc.weixin.qq.com/doc/w3_1' }])

    const fileListCalls = calls.filter(c => c.path === '/cgi-bin/wedrive/file_list')
    assert.equal(fileListCalls.length, 2)
    assert.equal((fileListCalls[1].body as { start: number }).start, 1000)
    assert.equal((fileListCalls[1].body as { limit: number }).limit, 1000)
  })

  it('ignores entries with file_status 2, file_type 4, or a name differing by a trailing space', async () => {
    const { http } = setupWecom({
      '/cgi-bin/wedrive/file_list': {
        has_more: false,
        file_list: {
          item: [
            { fileid: 'id-wrong-status', file_name: 'report', file_type: 3, file_status: 2, url: 'https://doc.weixin.qq.com/doc/w3_s2' },
            { fileid: 'id-wrong-type', file_name: 'report', file_type: 4, file_status: 1, url: 'https://doc.weixin.qq.com/doc/w3_t4' },
            { fileid: 'id-trailing-space', file_name: 'report ', file_type: 3, file_status: 1, url: 'https://doc.weixin.qq.com/doc/w3_space' },
            { fileid: 'id-valid', file_name: 'report', file_type: 3, file_status: 1, url: 'https://doc.weixin.qq.com/doc/w3_valid' }
          ]
        }
      }
    })
    const result = await listDocsByName(http, { spaceid: 's1', fatherid: 'f1' }, 'report')
    assert.deepEqual(result, [{ fileid: 'id-valid', url: 'https://doc.weixin.qq.com/doc/w3_valid' }])
  })

  it('rejects keel/wecom-ambiguous-doc after 20 pages all has_more: true with exactly 20 calls', async () => {
    const { http, calls } = setupWecom({
      '/cgi-bin/wedrive/file_list': () => ({
        body: {
          has_more: true,
          next_start: 1000,
          file_list: { item: [] }
        }
      })
    })

    await assert.rejects(
      async () => {
        await listDocsByName(http, { spaceid: 's1', fatherid: 'f1' }, 'report')
      },
      (err: unknown) => {
        return err instanceof KeelError && err.code === 'keel/wecom-ambiguous-doc'
      }
    )

    const fileListCalls = calls.filter(c => c.path === '/cgi-bin/wedrive/file_list')
    assert.equal(fileListCalls.length, 20)
  })

  it('handles page 1 has_more: true with no next_start: second body has start: 1000 and first body has spaceid/fatherid', async () => {
    let fileListCallCount = 0
    const { http, calls } = setupWecom({
      '/cgi-bin/wedrive/file_list': () => {
        fileListCallCount++
        if (fileListCallCount === 1) {
          return {
            body: {
              has_more: true,
              file_list: {
                item: []
              }
            }
          }
        }
        return {
          body: {
            has_more: false,
            file_list: {
              item: []
            }
          }
        }
      }
    })

    await listDocsByName(http, { spaceid: 's_target', fatherid: 'f_target' }, 'report')

    const fileListCalls = calls.filter(c => c.path === '/cgi-bin/wedrive/file_list')
    assert.equal(fileListCalls.length, 2)
    const firstBody = fileListCalls[0].body as Record<string, unknown>
    assert.equal(firstBody.spaceid, 's_target')
    assert.equal(firstBody.fatherid, 'f_target')
    const secondBody = fileListCalls[1].body as Record<string, unknown>
    assert.equal(secondBody.start, 1000)
  })
})

describe('createDoc', () => {
  it('succeeds: body has doc_type: 3, doc_name, no admin_users; returns docid/url', async () => {
    const { http, calls } = setupWecom({
      '/cgi-bin/wedoc/create_doc': {
        errcode: 0,
        docid: 'doc_123',
        url: 'https://doc.weixin.qq.com/doc/w3_123'
      }
    })

    const res = await createDoc(http, { spaceid: 's1', fatherid: 'f1' }, 'report')
    assert.deepEqual(res, { docid: 'doc_123', url: 'https://doc.weixin.qq.com/doc/w3_123' })

    const createCalls = calls.filter(c => c.path === '/cgi-bin/wedoc/create_doc')
    assert.equal(createCalls.length, 1)
    const reqBody = createCalls[0].body as Record<string, unknown>
    assert.equal(reqBody.doc_type, 3)
    assert.equal(reqBody.doc_name, 'report')
    assert.equal(reqBody.spaceid, 's1')
    assert.equal(reqBody.fatherid, 'f1')
    assert.equal('admin_users' in reqBody, false)
  })

  it('handles create_doc network throw: 1 match returns it, called once; 0 matches rejects keel/wecom-unavailable, called once', async () => {
    {
      const { http, calls } = setupWecom({
        '/cgi-bin/wedoc/create_doc': () => {
          throw new Error('network down')
        },
        '/cgi-bin/wedrive/file_list': {
          has_more: false,
          file_list: {
            item: [
              {
                fileid: 'file_found',
                file_name: 'report',
                file_type: 3,
                file_status: 1,
                url: 'https://doc.weixin.qq.com/doc/w3_found'
              }
            ]
          }
        }
      })
      const res = await createDoc(http, { spaceid: 's1', fatherid: 'f1' }, 'report')
      assert.deepEqual(res, { docid: 'file_found', url: 'https://doc.weixin.qq.com/doc/w3_found' })
      const createCalls = calls.filter(c => c.path === '/cgi-bin/wedoc/create_doc')
      assert.equal(createCalls.length, 1)
    }

    {
      const { http, calls } = setupWecom({
        '/cgi-bin/wedoc/create_doc': () => {
          throw new Error('network down')
        },
        '/cgi-bin/wedrive/file_list': {
          has_more: false,
          file_list: {
            item: []
          }
        }
      })
      await assert.rejects(
        async () => {
          await createDoc(http, { spaceid: 's1', fatherid: 'f1' }, 'report')
        },
        (err: unknown) => {
          return err instanceof KeelError && err.code === 'keel/wecom-unavailable'
        }
      )
      const createCalls = calls.filter(c => c.path === '/cgi-bin/wedoc/create_doc')
      assert.equal(createCalls.length, 1)
    }
  })

  it('rejects keel/wecom-ambiguous-doc when create_doc throws network error and file_list returns 2 exact matches, create_doc called once', async () => {
    const { http, calls } = setupWecom({
      '/cgi-bin/wedoc/create_doc': () => {
        throw new Error('network down')
      },
      '/cgi-bin/wedrive/file_list': {
        has_more: false,
        file_list: {
          item: [
            {
              fileid: 'file_match_1',
              file_name: 'report',
              file_type: 3,
              file_status: 1,
              url: 'https://doc.weixin.qq.com/doc/w3_match1'
            },
            {
              fileid: 'file_match_2',
              file_name: 'report',
              file_type: 3,
              file_status: 1,
              url: 'https://doc.weixin.qq.com/doc/w3_match2'
            }
          ]
        }
      }
    })

    await assert.rejects(
      async () => {
        await createDoc(http, { spaceid: 's1', fatherid: 'f1' }, 'report')
      },
      (err: unknown) => {
        return err instanceof KeelError && err.code === 'keel/wecom-ambiguous-doc'
      }
    )

    const createCalls = calls.filter(c => c.path === '/cgi-bin/wedoc/create_doc')
    assert.equal(createCalls.length, 1)
  })
})

describe('resolveDocid', () => {
  it('returns fileid with 1 document/get call when fileid works', async () => {
    const { http, calls } = setupWecom({
      '/cgi-bin/wedoc/document/get': {
        errcode: 0,
        document: { title: 'doc' }
      }
    })
    const res = await resolveDocid(http, {
      fileid: 'fid_direct',
      url: 'https://doc.weixin.qq.com/doc/w3_URL?scode=x'
    })
    assert.equal(res, 'fid_direct')
    const getCalls = calls.filter(c => c.path === '/cgi-bin/wedoc/document/get')
    assert.equal(getCalls.length, 1)
    assert.equal((getCalls[0].body as { docid: string }).docid, 'fid_direct')
    assert.equal(calls.filter(c => c.path === '/cgi-bin/wedoc/create_doc').length, 0)
  })

  it('returns w3_REAL when fileid gives errcode 40058 and url works', async () => {
    const { http, calls } = setupWecom({
      '/cgi-bin/wedoc/document/get': req => {
        const b = req.body as { docid: string }
        if (b?.docid === 'fid_bad') {
          return { status: 200, body: { errcode: 40058, errmsg: 'invalid docid' } }
        }
        if (b?.docid === 'w3_REAL') {
          return { status: 200, body: { errcode: 0 } }
        }
        return { status: 404 }
      }
    })
    const res = await resolveDocid(http, {
      fileid: 'fid_bad',
      url: 'https://doc.weixin.qq.com/doc/w3_REAL?scode=x'
    })
    assert.equal(res, 'w3_REAL')
    const getCalls = calls.filter(c => c.path === '/cgi-bin/wedoc/document/get')
    assert.equal(getCalls.length, 2)
    assert.equal((getCalls[0].body as { docid: string }).docid, 'fid_bad')
    assert.equal((getCalls[1].body as { docid: string }).docid, 'w3_REAL')
    assert.equal(calls.filter(c => c.path === '/cgi-bin/wedoc/create_doc').length, 0)
  })

  it('rejects keel/wecom-docid-unreadable when both fail, and never calls create_doc', async () => {
    const { http, calls } = setupWecom({
      '/cgi-bin/wedoc/document/get': {
        status: 200,
        body: { errcode: 40058, errmsg: 'invalid docid' }
      }
    })
    await assert.rejects(
      async () => {
        await resolveDocid(http, {
          fileid: 'fid_bad',
          url: 'https://doc.weixin.qq.com/doc/w3_REAL?scode=x'
        })
      },
      (err: unknown) => {
        return err instanceof KeelError && err.code === 'keel/wecom-docid-unreadable'
      }
    )
    assert.equal(calls.filter(c => c.path === '/cgi-bin/wedoc/create_doc').length, 0)
  })

  it('rejects keel/wecom-unavailable when first document/get throws network error, and does not try URL id', async () => {
    const { http, calls } = setupWecom({
      '/cgi-bin/wedoc/document/get': () => {
        throw new Error('network error')
      }
    })

    await assert.rejects(
      async () => {
        await resolveDocid(http, {
          fileid: 'fid_bad',
          url: 'https://doc.weixin.qq.com/doc/w3_URL?scode=x'
        })
      },
      (err: unknown) => {
        return err instanceof KeelError && err.code === 'keel/wecom-unavailable'
      }
    )

    const getCalls = calls.filter(c => c.path === '/cgi-bin/wedoc/document/get')
    const counts: Record<string, number> = {}
    for (const c of getCalls) {
      const docid = (c.body as { docid: string }).docid
      counts[docid] = (counts[docid] ?? 0) + 1
    }
    assert.ok((counts['fid_bad'] ?? 0) > 0)
    assert.equal(counts['w3_URL'] ?? 0, 0)
  })

  it('rejects keel/wecom-unauthorized when document/get returns 42001 twice or gettoken returns 40001', async () => {
    {
      const { http } = setupWecom({
        '/cgi-bin/wedoc/document/get': {
          errcode: 42001,
          errmsg: 'token expired'
        }
      })

      await assert.rejects(
        async () => {
          await resolveDocid(http, {
            fileid: 'fid_bad',
            url: 'https://doc.weixin.qq.com/doc/w3_URL?scode=x'
          })
        },
        (err: unknown) => {
          return err instanceof KeelError && err.code === 'keel/wecom-unauthorized'
        }
      )
    }

    {
      const { http } = setupWecom({
        '/cgi-bin/gettoken': {
          errcode: 40001,
          errmsg: 'invalid credential'
        }
      })

      await assert.rejects(
        async () => {
          await resolveDocid(http, {
            fileid: 'fid_bad',
            url: 'https://doc.weixin.qq.com/doc/w3_URL?scode=x'
          })
        },
        (err: unknown) => {
          return err instanceof KeelError && err.code === 'keel/wecom-unauthorized'
        }
      )
    }
  })
})

import { readDoc, replaceSection } from '../src/wecom/docs.js'

interface FakeDocOptions {
  version?: number
  text?: string
  offset?: number
  children?: Array<{ begin: number; end: number; text: string }>
  batchUpdateHandler?: (callCount: number) => { errcode: number; errmsg?: string } | void
}

function setupDocFake(options: FakeDocOptions = {}) {
  let version = options.version ?? 1
  let text = options.text ?? ''
  const offset = options.offset ?? 0
  let customChildren = options.children
  let batchUpdateCallCount = 0

  const { http, calls } = setupWecom({
    '/cgi-bin/wedoc/document/get': () => {
      const children = customChildren ?? [
        {
          begin: offset,
          end: offset + text.length,
          text
        }
      ]
      return {
        body: {
          errcode: 0,
          version,
          document: {
            body: {
              children
            }
          }
        }
      }
    },
    '/cgi-bin/wedoc/document/batch_update': req => {
      batchUpdateCallCount++
      if (options.batchUpdateHandler) {
        const failure = options.batchUpdateHandler(batchUpdateCallCount)
        if (failure) {
          return { body: failure }
        }
      }

      const body = req.body as {
        docid: string
        version: number
        requests: Array<{
          delete_content?: { range: { start_index: number; length: number } }
          insert_text?: { text: string; location: { index: number } }
        }>
      }

      let current = text
      for (const r of body.requests ?? []) {
        if (r.delete_content) {
          const start = r.delete_content.range.start_index - offset
          const len = r.delete_content.range.length
          current = current.slice(0, start) + current.slice(start + len)
        }
        if (r.insert_text) {
          const idx = r.insert_text.location.index - offset
          current = current.slice(0, idx) + r.insert_text.text + current.slice(idx)
        }
      }
      text = current
      version++
      customChildren = undefined

      return {
        body: {
          errcode: 0
        }
      }
    }
  })

  return {
    http,
    calls,
    getText: () => text,
    getVersion: () => version
  }
}

describe('readDoc', () => {
  it('walks document depth-first in property/array order and collects text nodes', async () => {
    const { http } = setupWecom({
      '/cgi-bin/wedoc/document/get': {
        errcode: 0,
        version: 5,
        document: {
          header: {
            title: { begin: 0, end: 5, text: 'Hello' }
          },
          body: {
            elements: [
              { begin: 5, end: 6, text: ' ' },
              {
                nested: {
                  begin: 6,
                  end: 11,
                  text: 'World',
                  extra: { begin: 99, end: 100, text: 'ignored because inside collected node' }
                }
              }
            ]
          }
        }
      }
    })
    const doc = await readDoc(http, 'd1')
    assert.deepEqual(doc, { version: 5, text: 'Hello World', offset: 0 })
  })

  it('rejects when joinText fails due to mismatched lengths', async () => {
    const { http } = setupWecom({
      '/cgi-bin/wedoc/document/get': {
        errcode: 0,
        version: 1,
        document: {
          children: [{ begin: 0, end: 20, text: 'short' }]
        }
      }
    })
    await assert.rejects(
      async () => {
        await readDoc(http, 'd1')
      },
      (err: unknown) => err instanceof KeelError && err.code === 'keel/wecom-doc-index'
    )
  })
})

describe('replaceSection', () => {
  const initialDoc = 'Keel 周报\nacme/app\n周报 2026-11-13\na\n周报 2026-11-20\nold\n月报 2026-11\nm\n'

  it('replaces existing section: written, correct requests and version, idempotent on rerun', async () => {
    const { http, calls, getText } = setupDocFake({ text: initialDoc })

    const res1 = await replaceSection(
      http,
      'doc1',
      '周报 2026-11-20',
      '周报 2026-11-20\nnew\n',
      'if-different'
    )
    assert.equal(res1, 'written')
    assert.equal(
      getText(),
      'Keel 周报\nacme/app\n周报 2026-11-13\na\n周报 2026-11-20\nnew\n月报 2026-11\nm\n'
    )

    const batchCalls = calls.filter(c => c.path === '/cgi-bin/wedoc/document/batch_update')
    assert.equal(batchCalls.length, 1)
    const body = batchCalls[0].body as Record<string, unknown>
    assert.equal(body.docid, 'doc1')
    assert.equal(body.version, 1)

    const requests = body.requests as Array<{
      delete_content?: { range: { start_index: number; length: number } }
      insert_text?: { text: string; location: { index: number } }
    }>
    assert.equal(requests.length, 2)
    assert.ok(requests[0].delete_content)
    assert.ok(requests[1].insert_text)
    assert.equal(
      requests[0].delete_content.range.start_index,
      requests[1].insert_text.location.index
    )

    const res2 = await replaceSection(
      http,
      'doc1',
      '周报 2026-11-20',
      '周报 2026-11-20\nnew\n',
      'if-different'
    )
    assert.equal(res2, 'skipped')
    const batchCallsAfterRerun = calls.filter(c => c.path === '/cgi-bin/wedoc/document/batch_update')
    assert.equal(batchCallsAfterRerun.length, 1)
  })

  it('skips when policy is if-missing and title exists', async () => {
    const { http, calls, getText } = setupDocFake({ text: initialDoc })

    const res = await replaceSection(
      http,
      'doc1',
      '周报 2026-11-20',
      '周报 2026-11-20\nnew\n',
      'if-missing'
    )
    assert.equal(res, 'skipped')
    assert.equal(getText(), initialDoc)
    assert.equal(calls.filter(c => c.path === '/cgi-bin/wedoc/document/batch_update').length, 0)
  })

  it('appends at end when title is missing, only insert_text and no delete_content', async () => {
    const { http, calls, getText } = setupDocFake({ text: 'Keel 周报\nacme/app\n' })

    const res = await replaceSection(
      http,
      'doc1',
      '周报 2026-11-27',
      '周报 2026-11-27\nadded\n',
      'if-different'
    )
    assert.equal(res, 'written')
    assert.equal(getText(), 'Keel 周报\nacme/app\n周报 2026-11-27\nadded\n')

    const batchCalls = calls.filter(c => c.path === '/cgi-bin/wedoc/document/batch_update')
    assert.equal(batchCalls.length, 1)
    const body = batchCalls[0].body as Record<string, unknown>
    const requests = body.requests as Array<Record<string, unknown>>
    assert.equal(requests.length, 1)
    assert.ok('insert_text' in requests[0])
    assert.equal('delete_content' in requests[0], false)
  })

  it('prefixes newline when appending to non-empty doc that does not end with newline', async () => {
    const { http, getText } = setupDocFake({ text: 'Keel 周报\nacme/app' })

    const res = await replaceSection(
      http,
      'doc1',
      '周报 2026-11-27',
      '周报 2026-11-27\nadded\n',
      'if-missing'
    )
    assert.equal(res, 'written')
    assert.equal(getText(), 'Keel 周报\nacme/app\n周报 2026-11-27\nadded\n')
  })

  it('runs replacement to end of doc for 月报 2026-11', async () => {
    const docWithMonthly = 'Keel 周报\nacme/app\n周报 2026-11-13\na\n月报 2026-11\nold\n'
    const { http, getText } = setupDocFake({ text: docWithMonthly })

    const res = await replaceSection(
      http,
      'doc1',
      '月报 2026-11',
      '月报 2026-11\nnew content\n',
      'if-different'
    )
    assert.equal(res, 'written')
    assert.equal(
      getText(),
      'Keel 周报\nacme/app\n周报 2026-11-13\na\n月报 2026-11\nnew content\n'
    )
  })

  it('rejects keel/wecom-doc-index when document/get has invalid node and records no batch_update', async () => {
    const { http, calls } = setupWecom({
      '/cgi-bin/wedoc/document/get': {
        errcode: 0,
        version: 1,
        document: {
          body: {
            children: [{ begin: 0, end: 10, text: 'mismatch' }]
          }
        }
      }
    })

    await assert.rejects(
      async () => {
        await replaceSection(
          http,
          'doc1',
          '周报 2026-11-20',
          '周报 2026-11-20\nnew\n',
          'if-different'
        )
      },
      (err: unknown) => err instanceof KeelError && err.code === 'keel/wecom-doc-index'
    )

    assert.equal(calls.filter(c => c.path === '/cgi-bin/wedoc/document/batch_update').length, 0)
  })

  it('retries when batch_update fails once then succeeds, and fails twice rethrows with no delete_content alone', async () => {
    {
      const { http, calls, getText } = setupDocFake({
        text: initialDoc,
        batchUpdateHandler: count => {
          if (count === 1) {
            return { errcode: 640014, errmsg: 'version conflict' }
          }
        }
      })

      const res = await replaceSection(
        http,
        'doc1',
        '周报 2026-11-20',
        '周报 2026-11-20\nnew\n',
        'if-different'
      )
      assert.equal(res, 'written')
      assert.equal(
        getText(),
        'Keel 周报\nacme/app\n周报 2026-11-13\na\n周报 2026-11-20\nnew\n月报 2026-11\nm\n'
      )
      assert.equal(calls.filter(c => c.path === '/cgi-bin/wedoc/document/get').length, 2)
      assert.equal(calls.filter(c => c.path === '/cgi-bin/wedoc/document/batch_update').length, 2)
    }

    {
      const { http, calls } = setupDocFake({
        text: initialDoc,
        batchUpdateHandler: () => ({ errcode: 640014, errmsg: 'version conflict' })
      })

      await assert.rejects(async () => {
        await replaceSection(
          http,
          'doc1',
          '周报 2026-11-20',
          '周报 2026-11-20\nnew\n',
          'if-different'
        )
      })

      assert.equal(calls.filter(c => c.path === '/cgi-bin/wedoc/document/get').length, 2)
      const batchCalls = calls.filter(c => c.path === '/cgi-bin/wedoc/document/batch_update')
      assert.equal(batchCalls.length, 2)

      for (const c of calls) {
        if (c.path === '/cgi-bin/wedoc/document/batch_update') {
          const b = c.body as { requests?: Array<Record<string, unknown>> }
          const hasDelete = b.requests?.some(r => 'delete_content' in r)
          const hasInsert = b.requests?.some(r => 'insert_text' in r)
          if (hasDelete) {
            assert.ok(hasInsert)
          }
        } else {
          const body = c.body as Record<string, unknown> | undefined
          assert.equal(Boolean(body && 'delete_content' in body), false)
        }
      }
    }
  })

  it('treats sections as same and skips when custom same ignores 生成于 lines', async () => {
    const docWithGen = 'Keel 周报\nacme/app\n周报 2026-11-20\ncontent\n生成于 2026-11-19 10:00\n'
    const nextWithGen = '周报 2026-11-20\ncontent\n生成于 2026-11-19 11:00\n'
    const { http, calls } = setupDocFake({ text: docWithGen })

    const ignoreGenerated = (a: string, b: string) => {
      const filter = (s: string) =>
        s
          .split('\n')
          .filter(l => !l.startsWith('生成于'))
          .join('\n')
      return filter(a) === filter(b)
    }

    const res = await replaceSection(
      http,
      'doc1',
      '周报 2026-11-20',
      nextWithGen,
      'if-different',
      ignoreGenerated
    )
    assert.equal(res, 'skipped')
    assert.equal(calls.filter(c => c.path === '/cgi-bin/wedoc/document/batch_update').length, 0)
  })
})
