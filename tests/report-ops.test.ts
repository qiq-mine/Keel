import assert from 'node:assert/strict'
import test from 'node:test'
import type { Config } from '../src/config.js'
import { KeelError, KEEL_MESSAGES } from '../src/errors.js'
import {
  connection,
  type OperationContext,
  reportDeps,
  reportStart,
  reportStatus,
  wecomClient,
} from '../src/operations.js'
import { ReportJobs } from '../src/report/run.js'
import { WecomClients } from '../src/wecom/http.js'
import { createFakeWecom, type FakeRouteHandler } from './helpers/fake-wecom.js'

const SECRET = 'test-wecom-secret'
const TOKEN = 'test-access-token'
const CORP_ID = 'test-corp-id'

function assertSafeJson(result: unknown, extraSecrets: string[] = []): void {
  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes(SECRET), false, `Leaked SECRET in JSON: ${serialized}`)
  assert.equal(serialized.includes(TOKEN), false, `Leaked TOKEN in JSON: ${serialized}`)
  for (const s of extraSecrets) {
    assert.equal(serialized.includes(s), false, `Leaked secret in JSON: ${serialized}`)
  }
}

function fakeConfig(overrides: {
  baseUrl?: string
  groupPath?: string
  tokenRef?: string
  allowSelfSigned?: boolean
  wecomCorpId?: string
  wecomSecretRef?: string
  wecomSpaceId?: string
  wecomFatherId?: string
} = {}): Config {
  return {
    baseUrl: { get: () => overrides.baseUrl ?? '' },
    groupPath: { get: () => overrides.groupPath ?? '' },
    tokenRef: { get: () => overrides.tokenRef ?? 'KEEL_GITLAB_TOKEN' },
    allowSelfSigned: { get: () => overrides.allowSelfSigned ?? false },
    wecomCorpId: { get: () => overrides.wecomCorpId ?? '' },
    wecomSecretRef: { get: () => overrides.wecomSecretRef ?? 'KEEL_WECOM_SECRET' },
    wecomSpaceId: { get: () => overrides.wecomSpaceId ?? '' },
    wecomFatherId: { get: () => overrides.wecomFatherId ?? '' },
  } as unknown as Config
}

function createTestContext(options: {
  configOverrides?: Parameters<typeof fakeConfig>[0]
  secrets?: Record<string, string | undefined>
  wecomRoutes?: Record<string, FakeRouteHandler>
  jobs?: ReportJobs
  wecomClients?: WecomClients
  gitlabHandler?: (url: string, init?: RequestInit) => Response | Promise<Response>
} = {}) {
  const gitlabUrls: string[] = []
  const secretsMap = new Map<string, string | undefined>(Object.entries(options.secrets ?? {}))
  let resolveCount = 0

  const wecom = createFakeWecom(options.wecomRoutes ?? {})

  const combinedFetch: typeof fetch = async (input, init) => {
    const urlStr = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input && typeof (input as Request).url === 'string'
          ? (input as Request).url
          : String(input)

    if (new URL(urlStr).host === 'qyapi.weixin.qq.com') {
      return wecom.fetch(input, init)
    }

    gitlabUrls.push(urlStr)
    if (options.gitlabHandler) {
      return options.gitlabHandler(urlStr, init)
    }
    return new Response(JSON.stringify([]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  const ctx: OperationContext = {
    config: fakeConfig(options.configOverrides),
    resolve: async ref => {
      resolveCount++
      return secretsMap.get(ref)
    },
    describe: async ref => {
      const val = secretsMap.get(ref)
      return {
        configured: val !== undefined && val.trim() !== '',
        masked: val ? '******' : undefined,
      }
    },
    set: async (ref, val) => {
      secretsMap.set(ref, val)
    },
    unset: async ref => {
      secretsMap.delete(ref)
    },
    fetch: combinedFetch,
    sleep: async () => {},
    jobs: options.jobs,
    wecomClients: options.wecomClients,
  }

  return {
    ctx,
    gitlabUrls,
    wecomCalls: wecom.calls,
    getResolveCount: () => resolveCount,
    setSecret: (ref: string, val: string | undefined) => secretsMap.set(ref, val),
  }
}

test('wecomClient: missing corpId -> null', async () => {
  const { ctx } = createTestContext({
    configOverrides: { wecomCorpId: '', wecomSpaceId: 'space-1', wecomFatherId: 'father-1' },
    secrets: { KEEL_WECOM_SECRET: SECRET },
  })
  const client = await wecomClient(ctx)
  assert.equal(client, null)
})

test('wecomClient: secret resolving to empty string or whitespace -> null', async () => {
  const { ctx, setSecret } = createTestContext({
    configOverrides: { wecomCorpId: CORP_ID, wecomSpaceId: 'space-1', wecomFatherId: 'father-1' },
    secrets: { KEEL_WECOM_SECRET: '' },
  })
  assert.equal(await wecomClient(ctx), null)

  setSecret('KEEL_WECOM_SECRET', '   ')
  assert.equal(await wecomClient(ctx), null)

  setSecret('KEEL_WECOM_SECRET', undefined)
  assert.equal(await wecomClient(ctx), null)
})

test('wecomClient: configured -> two calls return two different WecomHttp instances', async () => {
  const { ctx, setSecret, getResolveCount } = createTestContext({
    configOverrides: { wecomCorpId: CORP_ID, wecomSpaceId: 'space-1', wecomFatherId: 'father-1' },
    secrets: { KEEL_WECOM_SECRET: SECRET },
  })
  const initialResolves = getResolveCount()

  const first = await wecomClient(ctx)
  assert.ok(first)
  assert.deepEqual(first.target, { spaceid: 'space-1', fatherid: 'father-1' })
  assert.equal(getResolveCount(), initialResolves + 1)

  setSecret('KEEL_WECOM_SECRET', 'changed-secret')

  const second = await wecomClient(ctx)
  assert.ok(second)
  assert.deepEqual(second.target, { spaceid: 'space-1', fatherid: 'father-1' })
  assert.equal(getResolveCount(), initialResolves + 2)

  assert.notEqual(first.http, second.http)

  // with a shared new WecomClients() and unchanged config the same instance
  ctx.wecomClients = new WecomClients()
  const third = await wecomClient(ctx)
  const fourth = await wecomClient(ctx)
  assert.ok(third)
  assert.ok(fourth)
  assert.equal(third.http, fourth.http)
})

test('connection(): GitLab NOT configured (baseUrl empty) but WeCom configured and gettoken ok', async () => {
  const { ctx, wecomCalls } = createTestContext({
    configOverrides: { baseUrl: '', wecomCorpId: CORP_ID, wecomSpaceId: 'space-1', wecomFatherId: 'father-1' },
    secrets: { KEEL_WECOM_SECRET: SECRET },
    wecomRoutes: {
      '/cgi-bin/gettoken': {
        errcode: 0,
        access_token: TOKEN,
        expires_in: 7200,
      },
    },
  })

  const res = await connection(ctx)
  assert.equal(res.gitlabHealth, 'unconfigured')
  assert.equal(res.wecomHealth, 'ok')
  assert.equal(res.wecomHealthDetail, null)
  assert.deepEqual(wecomCalls.map(c => c.path), ['/cgi-bin/gettoken'])
  assertSafeJson(res)
})

test('connection(): gettoken errcode 40001 -> wecomHealth error and proper detail', async () => {
  const { ctx, wecomCalls } = createTestContext({
    configOverrides: { baseUrl: '', wecomCorpId: CORP_ID, wecomSpaceId: 'space-1', wecomFatherId: 'father-1' },
    secrets: { KEEL_WECOM_SECRET: SECRET },
    wecomRoutes: {
      '/cgi-bin/gettoken': {
        errcode: 40001,
        errmsg: 'invalid credential',
      },
    },
  })

  const res = await connection(ctx)
  assert.equal(res.wecomHealth, 'error')
  assert.equal(res.wecomHealthDetail, '企业微信 Secret 无效或应用未授权')
  assert.deepEqual(wecomCalls.map(c => c.path), ['/cgi-bin/gettoken'])
  assertSafeJson(res)
})

test('connection(): gettoken network error -> wecomHealth error and proper detail', async () => {
  const { ctx, wecomCalls } = createTestContext({
    configOverrides: { baseUrl: '', wecomCorpId: CORP_ID, wecomSpaceId: 'space-1', wecomFatherId: 'father-1' },
    secrets: { KEEL_WECOM_SECRET: SECRET },
    wecomRoutes: {
      '/cgi-bin/gettoken': () => {
        throw new Error('network down')
      },
    },
  })

  const res = await connection(ctx)
  assert.equal(res.wecomHealth, 'error')
  assert.equal(res.wecomHealthDetail, '无法连接企业微信')
  assert.ok(wecomCalls.length > 0)
  for (const call of wecomCalls) {
    assert.equal(call.path, '/cgi-bin/gettoken')
  }
  assertSafeJson(res)
})

test('connection(): WeCom not configured -> unconfigured and zero WeCom requests', async () => {
  const { ctx, wecomCalls } = createTestContext({
    configOverrides: { baseUrl: '', wecomCorpId: '' },
  })

  const res = await connection(ctx)
  assert.equal(res.wecomHealth, 'unconfigured')
  assert.equal(res.wecomHealthDetail, null)
  assert.equal(wecomCalls.length, 0)
  assertSafeJson(res)
})

test('connection(): with shared WecomClients, unchanged config sends one gettoken, secret change sends new gettoken with new secret in query', async () => {
  const SECRET2 = 'test-wecom-secret-2'
  const { ctx, wecomCalls, setSecret } = createTestContext({
    configOverrides: { baseUrl: '', wecomCorpId: CORP_ID, wecomSpaceId: 'space-1', wecomFatherId: 'father-1' },
    secrets: { KEEL_WECOM_SECRET: SECRET },
    wecomClients: new WecomClients(),
    wecomRoutes: {
      '/cgi-bin/gettoken': {
        errcode: 0,
        access_token: TOKEN,
        expires_in: 7200,
      },
    },
  })

  const res1 = await connection(ctx)
  assert.equal(res1.wecomHealth, 'ok')
  assertSafeJson(res1, [SECRET2])

  const res2 = await connection(ctx)
  assert.equal(res2.wecomHealth, 'ok')
  assertSafeJson(res2, [SECRET2])

  const gettokenCalls1 = wecomCalls.filter(c => c.path === '/cgi-bin/gettoken')
  assert.equal(gettokenCalls1.length, 1)

  setSecret('KEEL_WECOM_SECRET', SECRET2)

  const res3 = await connection(ctx)
  assert.equal(res3.wecomHealth, 'ok')
  assertSafeJson(res3, [SECRET2])

  const gettokenCalls2 = wecomCalls.filter(c => c.path === '/cgi-bin/gettoken')
  assert.equal(gettokenCalls2.length, 2)
  assert.equal(gettokenCalls2[1].query.corpsecret, SECRET2)
})

test('connection(): ctx.resolve throws for WeCom secret ref -> connection() resolves with wecomHealth error, detail 无法连接企业微信', async () => {
  const { ctx } = createTestContext({
    configOverrides: { baseUrl: '', wecomCorpId: CORP_ID, wecomSpaceId: 'space-1', wecomFatherId: 'father-1' },
    secrets: { KEEL_WECOM_SECRET: SECRET },
  })
  const origResolve = ctx.resolve
  ctx.resolve = async ref => {
    if (ref === 'KEEL_WECOM_SECRET') {
      throw new Error('resolve failed')
    }
    return origResolve(ref)
  }

  const res = await connection(ctx)
  assert.equal(res.wecomHealth, 'error')
  assert.equal(res.wecomHealthDetail, '无法连接企业微信')
  assertSafeJson(res)
})

test('reportStart: write with asOf 31 minutes old rejects keel/report-stale and creates no job', async () => {
  const jobs = new ReportJobs({ newId: () => 'r1' })
  const { ctx } = createTestContext({
    jobs,
    configOverrides: { wecomCorpId: CORP_ID, wecomSpaceId: 'space-1', wecomFatherId: 'father-1' },
    secrets: { KEEL_WECOM_SECRET: SECRET },
  })

  const staleAsOf = new Date(Date.now() - 31 * 60 * 1000).toISOString()
  await assert.rejects(
    async () => {
      await reportStart(ctx, 'write', staleAsOf)
    },
    (err: unknown) => {
      assert.ok(err instanceof KeelError)
      assert.equal(err.code, 'keel/report-stale')
      return true
    },
  )

  assert.throws(
    () => ctx.jobs!.status('r1'),
    (err: unknown) => {
      assert.ok(err instanceof KeelError)
      assert.equal(err.code, 'keel/not-found')
      return true
    },
  )
})

test('reportStart bogus -> keel/invalid-input and reportStatus nope -> keel/not-found', async () => {
  const jobs = new ReportJobs()
  const { ctx } = createTestContext({ jobs })

  await assert.rejects(
    async () => {
      await reportStart(ctx, 'bogus', new Date().toISOString())
    },
    (err: unknown) => {
      assert.ok(err instanceof KeelError)
      assert.equal(err.code, 'keel/invalid-input')
      return true
    },
  )

  assert.throws(
    () => reportStatus(ctx, 'nope'),
    (err: unknown) => {
      assert.ok(err instanceof KeelError)
      assert.equal(err.code, 'keel/not-found')
      return true
    },
  )
})

test('reportStart and reportStatus without jobs -> throws keel errors', async () => {
  const { ctx } = createTestContext()

  await assert.rejects(
    async () => {
      await reportStart(ctx, 'write', new Date().toISOString())
    },
    (err: unknown) => {
      assert.ok(err instanceof KeelError)
      assert.equal(err.code, 'keel/not-configured')
      return true
    },
  )

  assert.throws(
    () => reportStatus(ctx, 'r1'),
    (err: unknown) => {
      assert.ok(err instanceof KeelError)
      assert.equal(err.code, 'keel/not-found')
      return true
    },
  )
})

test('reportStart: write with WeCom not configured -> done, empty projects, zero GitLab requests', async () => {
  const jobs = new ReportJobs()
  const { ctx, gitlabUrls } = createTestContext({
    jobs,
    configOverrides: { wecomCorpId: '' },
  })

  const freshAsOf = new Date().toISOString()
  const { runId } = await reportStart(ctx, 'write', freshAsOf)

  await ctx.jobs!.idle()

  const st = reportStatus(ctx, runId)
  assert.equal(st.state, 'done')
  assert.ok(st.result)
  assert.deepEqual(st.result.projects, [])
  assert.equal(st.result.message, KEEL_MESSAGES['keel/wecom-not-configured'])
  assert.equal(gitlabUrls.length, 0)
  assertSafeJson(st)
})

test('reportStart: preview with GitLab configured via fake GitLab fetch -> done, preview not null, zero recorded WeCom requests', async () => {
  const jobs = new ReportJobs()
  const { ctx, wecomCalls } = createTestContext({
    jobs,
    configOverrides: {
      baseUrl: 'https://gitlab.example.com',
      groupPath: 'my-group',
      tokenRef: 'KEEL_GITLAB_TOKEN',
      wecomCorpId: CORP_ID,
      wecomSpaceId: 'space-1',
      wecomFatherId: 'father-1',
    },
    secrets: {
      KEEL_GITLAB_TOKEN: 'gitlab-token-val',
      KEEL_WECOM_SECRET: SECRET,
    },
    wecomRoutes: {
      '/cgi-bin/gettoken': {
        errcode: 0,
        access_token: TOKEN,
        expires_in: 7200,
      },
    },
  })

  const freshAsOf = new Date().toISOString()
  const { runId } = await reportStart(ctx, 'preview', freshAsOf)

  await ctx.jobs!.idle()

  const st = reportStatus(ctx, runId)
  assert.equal(st.state, 'done')
  assert.ok(st.preview !== null)
  assert.equal(wecomCalls.length, 0)
  assertSafeJson(st)
})

test('reportDeps: throws keel/not-configured if source called before projects', async () => {
  const { ctx } = createTestContext()
  const deps = reportDeps(ctx)

  assert.equal(typeof deps.now(), 'number')
  await assert.rejects(
    async () => {
      await deps.source.reportIssues(1, {})
    },
    (err: unknown) => {
      assert.ok(err instanceof KeelError)
      assert.equal(err.code, 'keel/not-configured')
      return true
    },
  )

  await assert.rejects(
    async () => {
      await deps.source.labelEvents(1, 10)
    },
    (err: unknown) => {
      assert.ok(err instanceof KeelError)
      assert.equal(err.code, 'keel/not-configured')
      return true
    },
  )
})
