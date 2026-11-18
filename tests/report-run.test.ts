import test from 'node:test'
import assert from 'node:assert/strict'
import { writeProject } from '../src/report/run.js'
import { createFakeWecom } from './helpers/fake-wecom.js'
import { WecomHttp } from '../src/wecom/http.js'
import { KEEL_MESSAGES } from '../src/errors.js'

interface FileItem {
  fileid: string
  file_name: string
  file_type: number
  file_status: number
  url?: string
}

interface EnvOptions {
  files?: FileItem[]
  initialText?: string
  initialVersion?: number
  onBatchUpdate?: (req: { body?: unknown }) => { errcode: number; errmsg?: string } | void
}

function setupEnv(options: EnvOptions = {}) {
  let text = options.initialText ?? ''
  let version = options.initialVersion ?? 1
  const files: FileItem[] = options.files ? [...options.files] : []

  const fake = createFakeWecom({
    '/cgi-bin/gettoken': {
      errcode: 0,
      access_token: 'test-access-token',
      expires_in: 7200
    },
    '/cgi-bin/wedrive/file_list': () => ({
      body: {
        has_more: false,
        file_list: {
          item: files
        }
      }
    }),
    '/cgi-bin/wedoc/create_doc': (req) => {
      const b = req.body as { doc_name?: string } | undefined
      const createdItem: FileItem = {
        fileid: 'd1',
        file_name: b?.doc_name ?? 'doc',
        file_type: 3,
        file_status: 1,
        url: 'https://doc.weixin.qq.com/doc/w3_d1'
      }
      files.push(createdItem)
      return {
        body: {
          errcode: 0,
          docid: 'd1',
          url: 'https://doc.weixin.qq.com/doc/w3_d1'
        }
      }
    },
    '/cgi-bin/wedoc/document/get': () => ({
      body: {
        errcode: 0,
        version,
        document: {
          body: {
            children: [
              {
                begin: 0,
                end: text.length,
                text
              }
            ]
          }
        }
      }
    }),
    '/cgi-bin/wedoc/document/batch_update': (req) => {
      if (options.onBatchUpdate) {
        const failure = options.onBatchUpdate(req)
        if (failure) {
          return { body: failure }
        }
      }

      const body = req.body as {
        docid: string
        version: number
        requests?: Array<{
          delete_content?: { range: { start_index: number; length: number } }
          insert_text?: { text: string; location: { index: number } }
        }>
      }

      let current = text
      for (const r of body.requests ?? []) {
        if (r.delete_content) {
          const start = r.delete_content.range.start_index
          const len = r.delete_content.range.length
          current = current.slice(0, start) + current.slice(start + len)
        }
        if (r.insert_text) {
          const idx = r.insert_text.location.index
          current = current.slice(0, idx) + r.insert_text.text + current.slice(idx)
        }
      }
      text = current
      version++
      return { body: { errcode: 0 } }
    }
  })

  const http = new WecomHttp({
    corpId: 'fake_corp',
    secret: 'test-wecom-secret',
    fetch: fake.fetch,
    sleep: async () => {}
  })

  return {
    http,
    calls: fake.calls,
    getText: () => text,
    getVersion: () => version,
    getFiles: () => files
  }
}

function makeSectionText(
  weekTitle: string,
  options: {
    window?: string
    generatedAt?: string
    created?: number
    closed?: number
    overdue?: number
    highRisk?: number
  } = {}
): string {
  const windowStr = options.window ?? '统计窗口：2026-11-14 ～ 2026-11-20'
  const generatedAt = options.generatedAt ?? '2026-11-20 18:00:00'
  const created = options.created ?? 1
  const closed = options.closed ?? 0
  const overdue = options.overdue ?? 1
  const highRisk = options.highRisk ?? 1

  return [
    weekTitle,
    windowStr,
    `生成于：${generatedAt}`,
    `新建：${created}`,
    `关闭：${closed}`,
    `逾期：${overdue}`,
    `高风险变动：${highRisk}`,
    '已省略保密议题：0',
    ''
  ].join('\n')
}

function assertNoSecrets(result: unknown): void {
  const json = JSON.stringify(result)
  assert.equal(json.includes('test-wecom-secret'), false)
  assert.equal(json.includes('test-access-token'), false)
}

test('new doc, F not last Friday: creates doc and writes weekly section', async () => {
  const env = setupEnv()
  const sectionText = makeSectionText('周报 2026-11-20')

  const result = await writeProject(env.http, {
    target: { spaceid: 's1', fatherid: 'f1' },
    projectPath: 'acme/app',
    weekTitle: '周报 2026-11-20',
    F: '2026-11-20',
    sectionText,
    kind: 'scheduled'
  })

  const createCalls = env.calls.filter((c) => c.path === '/cgi-bin/wedoc/create_doc')
  assert.equal(createCalls.length, 1)
  assert.ok(env.getText().startsWith('Keel 周报\nacme/app\n周报 2026-11-20\n'))
  assert.equal(result.weekly, 'written')
  assert.equal(result.monthly, 'not-due')
  assert.equal(result.docUrl, 'https://doc.weixin.qq.com/doc/w3_d1')
  assert.equal(result.message, null)
  assertNoSecrets(result)

  // Same run again with only the 生成于 line changed -> weekly 'skipped', no batch_update in second run
  const batchUpdatesBefore = env.calls.filter((c) => c.path === '/cgi-bin/wedoc/document/batch_update').length
  const rerunSectionText = makeSectionText('周报 2026-11-20', { generatedAt: '2026-11-20 19:30:00' })
  const result2 = await writeProject(env.http, {
    target: { spaceid: 's1', fatherid: 'f1' },
    projectPath: 'acme/app',
    weekTitle: '周报 2026-11-20',
    F: '2026-11-20',
    sectionText: rerunSectionText,
    kind: 'scheduled'
  })

  assert.equal(result2.weekly, 'skipped')
  assert.equal(result2.monthly, 'not-due')
  assert.equal(result2.docUrl, 'https://doc.weixin.qq.com/doc/w3_d1')
  assert.equal(result2.message, null)
  const batchUpdatesAfter = env.calls.filter((c) => c.path === '/cgi-bin/wedoc/document/batch_update').length
  assert.equal(batchUpdatesAfter, batchUpdatesBefore)
  assertNoSecrets(result2)
})

test('existing doc with weeks 2026-11-06/13/20 and F 2026-11-27: writes weekly and monthly, skips on rerun', async () => {
  const initialText = [
    'Keel 周报',
    'acme/app',
    makeSectionText('周报 2026-11-06'),
    makeSectionText('周报 2026-11-13'),
    makeSectionText('周报 2026-11-20')
  ].join('\n')

  const env = setupEnv({
    initialText,
    files: [
      {
        fileid: 'd1',
        file_name: 'acme - app',
        file_type: 3,
        file_status: 1,
        url: 'https://doc.weixin.qq.com/doc/w3_d1'
      }
    ]
  })

  const sectionText = makeSectionText('周报 2026-11-27')
  const input = {
    target: { spaceid: 's1', fatherid: 'f1' },
    projectPath: 'acme/app',
    weekTitle: '周报 2026-11-27',
    F: '2026-11-27',
    sectionText,
    kind: 'scheduled' as const
  }

  const result1 = await writeProject(env.http, input)
  assert.equal(result1.weekly, 'written')
  assert.equal(result1.monthly, 'written')
  assert.equal(result1.docUrl, 'https://doc.weixin.qq.com/doc/w3_d1')
  assert.equal(result1.message, null)
  assert.ok(env.getText().includes('月报 2026-11'))
  assert.ok(env.getText().includes('周次：4'))
  assertNoSecrets(result1)

  const batchUpdatesBefore = env.calls.filter((c) => c.path === '/cgi-bin/wedoc/document/batch_update').length
  const result2 = await writeProject(env.http, input)
  assert.equal(result2.weekly, 'skipped')
  assert.equal(result2.monthly, 'skipped')
  assert.equal(result2.docUrl, 'https://doc.weixin.qq.com/doc/w3_d1')
  assert.equal(result2.message, null)
  const batchUpdatesAfter = env.calls.filter((c) => c.path === '/cgi-bin/wedoc/document/batch_update').length
  assert.equal(batchUpdatesAfter, batchUpdatesBefore)
  assertNoSecrets(result2)
})

test('kind catch-up with week title already present but different text: weekly skipped, no batch_update', async () => {
  const initialText = [
    'Keel 周报',
    'acme/app',
    makeSectionText('周报 2026-11-20', { created: 1, closed: 0 })
  ].join('\n')

  const env = setupEnv({
    initialText,
    files: [
      {
        fileid: 'd1',
        file_name: 'acme - app',
        file_type: 3,
        file_status: 1,
        url: 'https://doc.weixin.qq.com/doc/w3_d1'
      }
    ]
  })

  const batchUpdatesBefore = env.calls.filter((c) => c.path === '/cgi-bin/wedoc/document/batch_update').length
  const differentSectionText = makeSectionText('周报 2026-11-20', { created: 99, closed: 99 })

  const result = await writeProject(env.http, {
    target: { spaceid: 's1', fatherid: 'f1' },
    projectPath: 'acme/app',
    weekTitle: '周报 2026-11-20',
    F: '2026-11-20',
    sectionText: differentSectionText,
    kind: 'catch-up'
  })

  assert.equal(result.weekly, 'skipped')
  assert.equal(result.monthly, 'not-due')
  assert.equal(result.docUrl, 'https://doc.weixin.qq.com/doc/w3_d1')
  assert.equal(result.message, null)
  const batchUpdatesAfter = env.calls.filter((c) => c.path === '/cgi-bin/wedoc/document/batch_update').length
  assert.equal(batchUpdatesAfter, batchUpdatesBefore)
  assertNoSecrets(result)
})

test('two matching docs in file_list: weekly and monthly failed, message 目录里有多份同名文档, no create_doc or batch_update', async () => {
  const env = setupEnv({
    files: [
      {
        fileid: 'd1',
        file_name: 'acme - app',
        file_type: 3,
        file_status: 1,
        url: 'https://doc.weixin.qq.com/doc/w3_d1'
      },
      {
        fileid: 'd2',
        file_name: 'acme - app',
        file_type: 3,
        file_status: 1,
        url: 'https://doc.weixin.qq.com/doc/w3_d2'
      }
    ]
  })

  const result = await writeProject(env.http, {
    target: { spaceid: 's1', fatherid: 'f1' },
    projectPath: 'acme/app',
    weekTitle: '周报 2026-11-20',
    F: '2026-11-20',
    sectionText: makeSectionText('周报 2026-11-20'),
    kind: 'scheduled'
  })

  assert.equal(result.weekly, 'failed')
  assert.equal(result.monthly, 'failed')
  assert.equal(result.message, '目录里有多份同名文档')
  assert.equal(result.docUrl, null)
  assert.equal(env.calls.filter((c) => c.path === '/cgi-bin/wedoc/create_doc').length, 0)
  assert.equal(env.calls.filter((c) => c.path === '/cgi-bin/wedoc/document/batch_update').length, 0)
  assertNoSecrets(result)
})

test('file_list entry without url (url empty string): docUrl null, weekly written', async () => {
  const env = setupEnv({
    files: [
      {
        fileid: 'd1',
        file_name: 'acme - app',
        file_type: 3,
        file_status: 1,
        url: ''
      }
    ]
  })

  const result = await writeProject(env.http, {
    target: { spaceid: 's1', fatherid: 'f1' },
    projectPath: 'acme/app',
    weekTitle: '周报 2026-11-20',
    F: '2026-11-20',
    sectionText: makeSectionText('周报 2026-11-20'),
    kind: 'scheduled'
  })

  assert.equal(result.weekly, 'written')
  assert.equal(result.monthly, 'not-due')
  assert.equal(result.docUrl, null)
  assert.equal(result.message, null)
  assertNoSecrets(result)
})

test('batch_update returns errcode 640014 on monthly write only: weekly written, monthly failed', async () => {
  const initialText = [
    'Keel 周报',
    'acme/app',
    makeSectionText('周报 2026-11-06'),
    makeSectionText('周报 2026-11-13'),
    makeSectionText('周报 2026-11-20')
  ].join('\n')

  const env = setupEnv({
    initialText,
    files: [
      {
        fileid: 'd1',
        file_name: 'acme - app',
        file_type: 3,
        file_status: 1,
        url: 'https://doc.weixin.qq.com/doc/w3_d1'
      }
    ],
    onBatchUpdate: (req) => {
      const bodyStr = JSON.stringify(req.body ?? {})
      if (bodyStr.includes('月报')) {
        return { errcode: 640014, errmsg: 'forbidden' }
      }
    }
  })

  const result = await writeProject(env.http, {
    target: { spaceid: 's1', fatherid: 'f1' },
    projectPath: 'acme/app',
    weekTitle: '周报 2026-11-27',
    F: '2026-11-27',
    sectionText: makeSectionText('周报 2026-11-27'),
    kind: 'scheduled'
  })

  assert.equal(result.weekly, 'written')
  assert.equal(result.monthly, 'failed')
  assert.equal(result.docUrl, 'https://doc.weixin.qq.com/doc/w3_d1')
  assert.ok(result.message !== null)
  assert.ok(result.message.includes('（errcode 640014）') || result.message === KEEL_MESSAGES['keel/wecom-forbidden'])
  assertNoSecrets(result)
})
