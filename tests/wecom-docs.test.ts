import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  docHeader,
  docidFromUrl,
  docName,
  joinText,
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
    assert.equal(result, docName(longPath))
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
        const e = err as { code?: string; message?: string }
        return e.code === 'keel/wecom-doc-index' || e.message?.includes('keel/wecom-doc-index') === true
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
        const e = err as { code?: string; message?: string }
        return e.code === 'keel/wecom-doc-index' || e.message?.includes('keel/wecom-doc-index') === true
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
