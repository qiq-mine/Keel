import test from 'node:test'
import assert from 'node:assert/strict'
import {
  writeProject,
  checkAsOf,
  previewReport,
  writeReport,
  ReportJobs,
  type ReportPreview,
  type ReportResult,
  type RunDeps,
  type RunProject
} from '../src/report/run.js'
import { createFakeWecom, type FakeRouteHandler } from './helpers/fake-wecom.js'
import { WecomHttp } from '../src/wecom/http.js'
import { KEEL_MESSAGES, KeelError, keelError } from '../src/errors.js'
import type { ReportSource } from '../src/report/collect.js'

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
  tokenHandler?: FakeRouteHandler
}

function setupEnv(options: EnvOptions = {}) {
  let text = options.initialText ?? ''
  let version = options.initialVersion ?? 1
  const files: FileItem[] = options.files ? [...options.files] : []

  const fake = createFakeWecom({
    '/cgi-bin/gettoken': options.tokenHandler ?? {
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
    fake,
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

test('writeProject: F = bad after successful weekly write returns monthly failed without throwing', async () => {
  const env = setupEnv()
  const result = await writeProject(env.http, {
    target: { spaceid: 's1', fatherid: 'f1' },
    projectPath: 'acme/app',
    weekTitle: '周报 2026-11-20',
    F: 'bad',
    sectionText: makeSectionText('周报 2026-11-20'),
    kind: 'scheduled'
  })
  assert.equal(result.weekly, 'written')
  assert.equal(result.monthly, 'failed')
  assert.equal(result.message, KEEL_MESSAGES['keel/invalid-input'])
  assert.equal(result.docUrl, 'https://doc.weixin.qq.com/doc/w3_d1')
  assertNoSecrets(result)
})

test('checkAsOf: valid returns ms, stale/future/invalid/cross-week reject keel/report-stale', () => {
  const now = Date.parse('2026-11-20T09:00:00.000+08:00')
  const tenMinAgo = new Date(now - 10 * 60 * 1000).toISOString()
  const result = checkAsOf(tenMinAgo, now)
  assert.equal(result, now - 10 * 60 * 1000)

  const thirtyOneMinAgo = new Date(now - 31 * 60 * 1000).toISOString()
  assert.throws(
    () => checkAsOf(thirtyOneMinAgo, now),
    (err: unknown) => err instanceof KeelError && err.code === 'keel/report-stale'
  )

  const oneMinFuture = new Date(now + 1 * 60 * 1000).toISOString()
  assert.throws(
    () => checkAsOf(oneMinFuture, now),
    (err: unknown) => err instanceof KeelError && err.code === 'keel/report-stale'
  )

  assert.throws(
    () => checkAsOf('garbage', now),
    (err: unknown) => err instanceof KeelError && err.code === 'keel/report-stale'
  )

  const mondayNow = Date.parse('2026-11-23T00:05:00.000+08:00')
  const sundayAsOf = '2026-11-22T23:50:00.000+08:00'
  assert.throws(
    () => checkAsOf(sundayAsOf, mondayNow),
    (err: unknown) => err instanceof KeelError && err.code === 'keel/report-stale'
  )
})

test('previewReport: two projects, deps.wecom never called, gitlab error lands in failed, onProgress reaches (2, 2)', async () => {
  const now = Date.parse('2026-11-20T09:00:00.000+08:00')
  let wecomCalled = 0
  const progress: [number, number][] = []

  const source: ReportSource = {
    reportIssues: async (projectId: number) => {
      if (projectId === 2) {
        throw keelError('keel/gitlab-unavailable')
      }
      return { issues: [], truncated: false }
    },
    labelEvents: async () => ({ events: [], truncated: false })
  }

  const projects: RunProject[] = [
    { projectId: 1, projectPath: 'acme/app1', columnMode: 'status' },
    { projectId: 2, projectPath: 'acme/app2', columnMode: 'state' }
  ]

  const deps: RunDeps = {
    now: () => now,
    projects: async () => projects,
    source,
    wecom: async () => {
      wecomCalled++
      return null
    },
    onProgress: (done, total) => {
      progress.push([done, total])
    }
  }

  const preview = await previewReport(deps)

  assert.equal(wecomCalled, 0)
  assert.equal(preview.windowEnd, '2026-11-20T09:00:00.000+08:00')
  assert.equal(preview.projects.length, 1)
  assert.equal(preview.projects[0].projectId, 1)
  assert.equal(preview.projects[0].projectPath, 'acme/app1')
  assert.equal(preview.failed.length, 1)
  assert.equal(preview.failed[0].projectId, 2)
  assert.equal(preview.failed[0].projectPath, 'acme/app2')
  assert.equal(preview.failed[0].message, KEEL_MESSAGES['keel/gitlab-unavailable'])
  assert.deepEqual(progress, [[1, 2], [2, 2]])
})

test('writeReport: manual at = now - 5 min, two projects written, created_before uses windowEnd', async () => {
  const now = Date.parse('2026-11-20T09:00:00.000+08:00')
  const at = now - 5 * 60 * 1000
  const env = setupEnv()
  const recordedIssuesParams: Record<string, string>[] = []

  const source: ReportSource = {
    reportIssues: async (_projectId, params) => {
      recordedIssuesParams.push(params)
      return { issues: [], truncated: false }
    },
    labelEvents: async () => ({ events: [], truncated: false })
  }

  const deps: RunDeps = {
    now: () => now,
    projects: async () => [
      { projectId: 1, projectPath: 'acme/app1', columnMode: 'status' },
      { projectId: 2, projectPath: 'acme/app2', columnMode: 'state' }
    ],
    source,
    wecom: async () => ({
      http: env.http,
      target: { spaceid: 's1', fatherid: 'f1' }
    })
  }

  const result = await writeReport(deps, 'manual', at)

  assert.equal(result.message, null)
  assert.equal(result.projects.length, 2)
  assert.equal(result.projects[0].weekly, 'written')
  assert.equal(result.projects[1].weekly, 'written')
  assert.ok(result.projects[0].counts !== null)
  assert.ok(result.projects[1].counts !== null)

  const createdCalls = recordedIssuesParams.filter(p => p.state === 'all' && 'created_before' in p)
  assert.ok(createdCalls.length >= 2)
  for (const call of createdCalls) {
    assert.equal(call.created_before, '2026-11-20T08:55:00.000+08:00')
  }
  assertNoSecrets(result)
})

test('writeReport: gettoken fails (errcode 40001) -> every project failed, only gettoken called, no gitlab call', async () => {
  const now = Date.parse('2026-11-20T09:00:00.000+08:00')
  const env = setupEnv({
    tokenHandler: { errcode: 40001, errmsg: 'invalid secret' }
  })
  let projectsCalled = 0
  let reportIssuesCalled = 0
  let labelEventsCalled = 0

  const source: ReportSource = {
    reportIssues: async () => {
      reportIssuesCalled++
      return { issues: [], truncated: false }
    },
    labelEvents: async () => {
      labelEventsCalled++
      return { events: [], truncated: false }
    }
  }

  const deps: RunDeps = {
    now: () => now,
    projects: async () => {
      projectsCalled++
      return [
        { projectId: 1, projectPath: 'acme/app1', columnMode: 'status' },
        { projectId: 2, projectPath: 'acme/app2', columnMode: 'state' }
      ]
    },
    source,
    wecom: async () => ({
      http: env.http,
      target: { spaceid: 's1', fatherid: 'f1' }
    })
  }

  const result = await writeReport(deps, 'scheduled', now)

  assert.equal(projectsCalled, 0)
  assert.equal(reportIssuesCalled, 0)
  assert.equal(labelEventsCalled, 0)
  assert.deepEqual(result.projects, [])
  assert.equal(result.message, '企业微信 Secret 无效或应用未授权')
  assert.equal(env.calls.length, 1)
  assert.equal(env.calls[0].path, '/cgi-bin/gettoken')
  assertNoSecrets(result)
})

test('writeReport: deps.wecom returns null -> every project failed, no fetch, no gitlab call', async () => {
  const env = setupEnv()
  const now = Date.parse('2026-11-20T09:00:00.000+08:00')
  let projectsCalled = 0
  let reportIssuesCalled = 0
  let labelEventsCalled = 0

  const source: ReportSource = {
    reportIssues: async () => {
      reportIssuesCalled++
      return { issues: [], truncated: false }
    },
    labelEvents: async () => {
      labelEventsCalled++
      return { events: [], truncated: false }
    }
  }

  const deps: RunDeps = {
    now: () => now,
    projects: async () => {
      projectsCalled++
      return [
        { projectId: 1, projectPath: 'acme/app1', columnMode: 'status' },
        { projectId: 2, projectPath: 'acme/app2', columnMode: 'state' }
      ]
    },
    source,
    wecom: async () => null
  }

  const result = await writeReport(deps, 'scheduled', now)

  assert.equal(projectsCalled, 0)
  assert.equal(reportIssuesCalled, 0)
  assert.equal(labelEventsCalled, 0)
  assert.deepEqual(result.projects, [])
  assert.equal(result.message, KEEL_MESSAGES['keel/wecom-not-configured'])
  assert.equal(env.calls.length, 0)
  assertNoSecrets(result)
})

test('writeReport: one project collect throws -> that project failed, other written, no file_list for failed', async () => {
  const now = Date.parse('2026-11-20T09:00:00.000+08:00')
  const env = setupEnv()

  const source: ReportSource = {
    reportIssues: async (projectId: number) => {
      if (projectId === 1) {
        throw keelError('keel/gitlab-unavailable')
      }
      return { issues: [], truncated: false }
    },
    labelEvents: async () => ({ events: [], truncated: false })
  }

  const deps: RunDeps = {
    now: () => now,
    projects: async () => [
      { projectId: 1, projectPath: 'acme/app1', columnMode: 'status' },
      { projectId: 2, projectPath: 'acme/app2', columnMode: 'state' }
    ],
    source,
    wecom: async () => ({
      http: env.http,
      target: { spaceid: 's1', fatherid: 'f1' }
    })
  }

  const result = await writeReport(deps, 'scheduled', now)

  assert.equal(result.projects.length, 2)
  assert.equal(result.projects[0].weekly, 'failed')
  assert.equal(result.projects[0].monthly, 'failed')
  assert.equal(result.projects[0].message, KEEL_MESSAGES['keel/gitlab-unavailable'])
  assert.equal(result.projects[0].counts, null)

  assert.equal(result.projects[1].weekly, 'written')
  assert.ok(result.projects[1].counts !== null)

  const fileListCalls = env.calls.filter(c => c.path === '/cgi-bin/wedrive/file_list')
  assert.equal(fileListCalls.length, 1)
  assertNoSecrets(result)
})

test('writeReport: fresh client per run -> deps.wecom called twice, new secret used in query, no secrets in results', async () => {
  const now = Date.parse('2026-11-20T09:00:00.000+08:00')
  const fake = createFakeWecom({
    '/cgi-bin/gettoken': {
      errcode: 0,
      access_token: 'test-access-token',
      expires_in: 7200
    },
    '/cgi-bin/wedrive/file_list': () => ({
      body: { has_more: false, file_list: { item: [] } }
    }),
    '/cgi-bin/wedoc/create_doc': () => ({
      body: { errcode: 0, docid: 'd1', url: 'https://doc.weixin.qq.com/doc/w3_d1' }
    }),
    '/cgi-bin/wedoc/document/get': () => ({
      body: { errcode: 0, version: 1, document: { body: { children: [] } } }
    }),
    '/cgi-bin/wedoc/document/batch_update': () => ({
      body: { errcode: 0 }
    })
  })

  let wecomCount = 0
  const secrets = ['secret-alpha', 'secret-beta']
  const deps: RunDeps = {
    now: () => now,
    projects: async () => [{ projectId: 1, projectPath: 'acme/app', columnMode: 'status' }],
    source: {
      reportIssues: async () => ({ issues: [], truncated: false }),
      labelEvents: async () => ({ events: [], truncated: false })
    },
    wecom: async () => {
      const secret = secrets[wecomCount]
      wecomCount++
      const http = new WecomHttp({
        corpId: 'fake_corp',
        secret,
        fetch: fake.fetch,
        sleep: async () => {}
      })
      return { http, target: { spaceid: 's1', fatherid: 'f1' } }
    }
  }

  const result1 = await writeReport(deps, 'scheduled', now)
  const result2 = await writeReport(deps, 'scheduled', now)

  assert.equal(wecomCount, 2)
  const gettokenCalls = fake.calls.filter(c => c.path === '/cgi-bin/gettoken')
  assert.equal(gettokenCalls.length, 2)
  assert.equal(gettokenCalls[0].query.corpsecret, 'secret-alpha')
  assert.equal(gettokenCalls[1].query.corpsecret, 'secret-beta')

  const json1 = JSON.stringify(result1)
  assert.equal(json1.includes('secret-alpha'), false)
  assert.equal(json1.includes('test-access-token'), false)

  const json2 = JSON.stringify(result2)
  assert.equal(json2.includes('secret-beta'), false)
  assert.equal(json2.includes('test-access-token'), false)
})

test('ReportJobs: two jobs started back to back run serially without overlap', async () => {
  const jobs = new ReportJobs()
  let running = 0
  let maxConcurrent = 0
  const order: string[] = []

  let signalJob1Started!: () => void
  const job1Started = new Promise<void>(resolve => {
    signalJob1Started = resolve
  })

  let resolveJob1!: () => void
  const gate1 = new Promise<void>(resolve => {
    resolveJob1 = resolve
  })

  const id1 = jobs.start(async () => {
    running++
    maxConcurrent = Math.max(maxConcurrent, running)
    order.push('job1-start')
    signalJob1Started()
    await gate1
    order.push('job1-end')
    running--
    return {}
  })

  const id2 = jobs.start(async () => {
    running++
    maxConcurrent = Math.max(maxConcurrent, running)
    order.push('job2-start')
    order.push('job2-end')
    running--
    return {}
  })

  await job1Started
  assert.equal(jobs.status(id1).state, 'running')
  assert.equal(jobs.status(id2).state, 'queued')

  resolveJob1()
  await jobs.idle()

  assert.equal(jobs.status(id1).state, 'done')
  assert.equal(jobs.status(id2).state, 'done')
  assert.equal(maxConcurrent, 1)
  assert.deepEqual(order, ['job1-start', 'job1-end', 'job2-start', 'job2-end'])
})

test('ReportJobs: progress never decreases', async () => {
  const jobs = new ReportJobs()
  const readProgresses: number[] = []

  const id = jobs.start(async onProgress => {
    onProgress(1, 3)
    readProgresses.push(jobs.status(id).progress.done)
    onProgress(0, 3)
    readProgresses.push(jobs.status(id).progress.done)
    onProgress(2, 3)
    readProgresses.push(jobs.status(id).progress.done)
    return {}
  })

  await jobs.idle()
  const finalStatus = jobs.status(id)
  assert.deepEqual(finalStatus.progress, { done: 2, total: 3 })
  assert.deepEqual(readProgresses, [1, 1, 2])
  for (let i = 1; i < readProgresses.length; i++) {
    assert.ok(readProgresses[i] >= readProgresses[i - 1])
  }
})

test('ReportJobs: task failures handle errors properly and next queued job still runs', async () => {
  const jobs = new ReportJobs()

  const id1 = jobs.start(async () => {
    throw keelError('keel/report-stale')
  })

  const id2 = jobs.start(async () => {
    throw new Error('boom secret=xyz')
  })

  const id3 = jobs.start(async () => {
    return {}
  })

  await jobs.idle()

  const s1 = jobs.status(id1)
  assert.equal(s1.state, 'failed')
  assert.equal(s1.message, '预览已过期，请重新预览')

  const s2 = jobs.status(id2)
  assert.equal(s2.state, 'failed')
  assert.equal(s2.message, '周报生成失败')
  assert.equal(s2.message.includes('xyz'), false)

  const s3 = jobs.status(id3)
  assert.equal(s3.state, 'done')
})

test('ReportJobs: lastReport tracks result projects and ignores preview-only jobs', async () => {
  const jobs = new ReportJobs()
  assert.equal(jobs.lastReport(), null)

  const finishedAt = '2026-11-19T10:00:00+08:00'
  const fakeResult: ReportResult = {
    kind: 'manual',
    weekTitle: '2026-W47',
    finishedAt,
    message: null,
    projects: [
      { projectId: 1, projectPath: 'p1', weekly: 'written', monthly: 'not-due', message: null, docUrl: null, counts: null },
      { projectId: 2, projectPath: 'p2', weekly: 'skipped', monthly: 'not-due', message: null, docUrl: null, counts: null },
      { projectId: 3, projectPath: 'p3', weekly: 'failed', monthly: 'not-due', message: null, docUrl: null, counts: null },
      { projectId: 4, projectPath: 'p4', weekly: 'written', monthly: 'not-due', message: null, docUrl: null, counts: null }
    ]
  }

  jobs.start(async () => ({ result: fakeResult }))
  await jobs.idle()

  assert.deepEqual(jobs.lastReport(), {
    at: finishedAt,
    written: 2,
    skipped: 1,
    failed: 1
  })

  const fakePreview: ReportPreview = {
    asOf: '2026-11-19T10:00:00+08:00',
    weekTitle: '2026-W47',
    windowStart: '2026-11-12T00:00:00+08:00',
    windowEnd: '2026-11-19T00:00:00+08:00',
    generatedAt: '2026-11-19T10:05:00+08:00',
    monthlyDue: false,
    monthlyTitle: null,
    projects: [],
    failed: []
  }

  jobs.start(async () => ({ preview: fakePreview }))
  await jobs.idle()

  assert.deepEqual(jobs.lastReport(), {
    at: finishedAt,
    written: 2,
    skipped: 1,
    failed: 1
  })
})

test('ReportJobs: keep 10 drops oldest finished jobs when new jobs are added', async () => {
  let count = 0
  const jobs = new ReportJobs({
    newId: () => {
      count++
      return `r${count}`
    },
    keep: 10
  })

  for (let i = 1; i <= 12; i++) {
    jobs.start(async () => ({}))
    await jobs.idle()
  }

  assert.throws(
    () => jobs.status('r1'),
    (err: unknown) => err instanceof KeelError && err.code === 'keel/not-found'
  )
  assert.throws(
    () => jobs.status('r2'),
    (err: unknown) => err instanceof KeelError && err.code === 'keel/not-found'
  )
  const s12 = jobs.status('r12')
  assert.equal(s12.state, 'done')
})

test('ReportJobs: status of unknown runId throws keel/not-found', () => {
  const jobs = new ReportJobs()
  assert.throws(
    () => jobs.status('nope'),
    (err: unknown) => err instanceof KeelError && err.code === 'keel/not-found'
  )
})

test('ReportJobs: status returns deep copies of preview and result', async () => {
  const jobs = new ReportJobs()
  const originalPreviewProject = {
    projectId: 1,
    projectPath: 'p1',
    text: 'original preview text',
    counts: { created: 1, closed: 0, overdue: 0, highRiskEvents: 0, doing: null, blocked: null, highRiskNow: 0 },
    truncated: false
  }
  const originalResultProject: ReportResult['projects'][number] = {
    projectId: 1,
    projectPath: 'p1',
    weekly: 'written',
    monthly: 'not-due',
    message: 'original message',
    docUrl: null,
    counts: null
  }
  const id = jobs.start(async onProgress => {
    onProgress(1, 1)
    return {
      preview: {
        asOf: '2026-11-19T10:00:00+08:00',
        weekTitle: '2026-W47',
        windowStart: '2026-11-12T00:00:00+08:00',
        windowEnd: '2026-11-19T00:00:00+08:00',
        generatedAt: '2026-11-19T10:05:00+08:00',
        monthlyDue: false,
        monthlyTitle: null,
        projects: [originalPreviewProject],
        failed: []
      },
      result: {
        kind: 'manual',
        weekTitle: '2026-W47',
        finishedAt: '2026-11-19T10:00:00+08:00',
        message: null,
        projects: [originalResultProject]
      }
    }
  })
  await jobs.idle()

  const s = jobs.status(id)
  s.progress.done = 99
  s.result!.projects.push({
    projectId: 2,
    projectPath: 'p2',
    weekly: 'failed',
    monthly: 'not-due',
    message: 'mutated',
    docUrl: null,
    counts: null
  })
  s.result!.projects[0].message = 'x'
  s.preview!.projects[0].text = 'x'

  const sAfter = jobs.status(id)
  assert.equal(sAfter.progress.done, 1)
  assert.equal(sAfter.progress.total, 1)
  assert.equal(sAfter.result!.projects.length, 1)
  assert.equal(sAfter.result!.projects[0].message, 'original message')
  assert.equal(sAfter.preview!.projects[0].text, 'original preview text')
})

test('ReportJobs: failed job does not overwrite lastReport from earlier success', async () => {
  const jobs = new ReportJobs()
  const finishedAt = '2026-11-19T10:00:00+08:00'
  const id1 = jobs.start(async () => ({
    result: {
      kind: 'manual',
      weekTitle: '2026-W47',
      finishedAt,
      message: null,
      projects: [
        { projectId: 1, projectPath: 'p1', weekly: 'written', monthly: 'not-due', message: null, docUrl: null, counts: null }
      ]
    }
  }))
  await jobs.idle()
  assert.equal(jobs.status(id1).state, 'done')

  const reportBefore = jobs.lastReport()
  assert.deepEqual(reportBefore, {
    at: finishedAt,
    written: 1,
    skipped: 0,
    failed: 0
  })

  const id2 = jobs.start(async () => {
    throw new Error('job failed')
  })
  await jobs.idle()

  assert.equal(jobs.status(id2).state, 'failed')
  assert.deepEqual(jobs.lastReport(), reportBefore)
})

test('ReportJobs: early-stop write does not change lastReport, first-ever leaves it null', async () => {
  const jobs = new ReportJobs()
  const finishedAt = '2026-11-19T10:00:00+08:00'

  jobs.start(async () => ({
    result: {
      kind: 'manual',
      weekTitle: '2026-W47',
      finishedAt,
      message: null,
      projects: [
        { projectId: 1, projectPath: 'p1', weekly: 'written', monthly: 'not-due', message: null, docUrl: null, counts: null }
      ]
    }
  }))
  await jobs.idle()

  const normalReport = {
    at: finishedAt,
    written: 1,
    skipped: 0,
    failed: 0
  }
  assert.deepEqual(jobs.lastReport(), normalReport)

  jobs.start(async () => ({
    result: {
      kind: 'manual',
      weekTitle: '2026-W47',
      finishedAt: '2026-11-19T11:00:00+08:00',
      message: '尚未配置企业微信',
      projects: []
    }
  }))
  await jobs.idle()

  assert.deepEqual(jobs.lastReport(), normalReport)

  const freshJobs = new ReportJobs()
  freshJobs.start(async () => ({
    result: {
      kind: 'manual',
      weekTitle: '2026-W47',
      finishedAt: '2026-11-19T09:00:00+08:00',
      message: '尚未配置企业微信',
      projects: []
    }
  }))
  await freshJobs.idle()

  assert.equal(freshJobs.lastReport(), null)
})


