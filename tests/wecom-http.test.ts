import assert from 'node:assert/strict'
import test from 'node:test'
import type { KeelError } from '../src/errors.js'
import { WecomClients, WecomHttp, type WecomHttpOptions } from '../src/wecom/http.js'
import { createFakeWecom } from './helpers/fake-wecom.js'

const SECRET = 'test-wecom-secret'
const TOKEN = 'test-access-token'
const CORP_ID = 'test-corp-id'

function assertNoSecrets(logs: string[], errors: string[] = []): void {
  for (const line of logs) {
    assert.equal(line.includes(SECRET), false, `Log line leaked secret: ${line}`)
    assert.equal(line.includes(TOKEN), false, `Log line leaked token: ${line}`)
  }
  for (const msg of errors) {
    assert.equal(msg.includes(SECRET), false, `Error message leaked secret: ${msg}`)
    assert.equal(msg.includes(TOKEN), false, `Error message leaked token: ${msg}`)
  }
}

type CreateClientOptions = Omit<Partial<WecomHttpOptions>, 'log'> & {
  log?: ((line: string) => void) | string[]
}

function createClient(
  routes: Parameters<typeof createFakeWecom>[0] = {},
  optionsOrLogs?: CreateClientOptions | string[],
  logsParam?: string[],
) {
  let options: CreateClientOptions | undefined
  let logs: string[]

  if (Array.isArray(optionsOrLogs)) {
    logs = optionsOrLogs
    options = undefined
  } else {
    options = optionsOrLogs
    if (Array.isArray(options?.log)) {
      logs = options.log
    } else {
      logs = logsParam ?? []
    }
  }

  const userLogFn = typeof options?.log === 'function' ? options.log : undefined

  const fake = createFakeWecom(routes)
  const client = new WecomHttp({
    corpId: CORP_ID,
    secret: SECRET,
    fetch: fake.fetch,
    sleep: options?.sleep ?? (async () => {}),
    ...options,
    log: (line: string) => {
      logs.push(line)
      userLogFn?.(line)
    },
  })
  return { client, fake, logs }
}

test('rejects path outside allow list without sending any request', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  const { client, fake } = createClient({}, logs)

  await assert.rejects(
    async () => {
      await client.call('/cgi-bin/not-in-whitelist', {})
    },
    (err: Error) => {
      caughtErrors.push(err.message)
      assert.equal((err as KeelError).code, 'keel/invalid-input')
      assert.equal(err.message, '输入不符合约定格式')
      assert.equal(err.message.includes('/cgi-bin/not-in-whitelist'), false)
      return true
    },
  )

  await assert.rejects(
    async () => {
      await client.call('/cgi-bin/gettoken', {})
    },
    (err: Error) => {
      caughtErrors.push(err.message)
      assert.equal((err as KeelError).code, 'keel/invalid-input')
      assert.equal(err.message, '输入不符合约定格式')
      return true
    },
  )

  assert.equal(fake.calls.length, 0)
  assertNoSecrets(logs, caughtErrors)
})

test('3xx redirect is not followed and throws keel/wecom-unavailable', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []

  const { client: redirectTokenClient } = createClient(
    {
      '/cgi-bin/gettoken': {
        status: 302,
        headers: { location: 'https://evil.example.com/steal' },
        body: 'redirect',
      },
    },
    logs,
  )

  await assert.rejects(
    async () => {
      await redirectTokenClient.token()
    },
    (err: Error) => {
      caughtErrors.push(err.message)
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      assert.equal(err.message, '无法连接企业微信')
      return true
    },
  )

  const { client: redirectCallClient } = createClient(
    {
      '/cgi-bin/gettoken': {
        body: { errcode: 0, access_token: TOKEN },
      },
      '/cgi-bin/wedrive/file_list': {
        status: 301,
        headers: { location: 'https://evil.example.com/steal' },
        body: 'moved',
      },
    },
    logs,
  )

  await assert.rejects(
    async () => {
      await redirectCallClient.call('/cgi-bin/wedrive/file_list', {})
    },
    (err: Error) => {
      caughtErrors.push(err.message)
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      assert.equal(err.message, '无法连接企业微信')
      return true
    },
  )

  assertNoSecrets(logs, caughtErrors)
})

test('gettoken fails when errcode is non-zero', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []

  const { client } = createClient(
    {
      '/cgi-bin/gettoken': {
        body: { errcode: 40001, errmsg: 'invalid credential secret-leak' },
      },
    },
    logs,
  )

  await assert.rejects(
    async () => {
      await client.token()
    },
    (err: Error) => {
      caughtErrors.push(err.message)
      assert.equal((err as KeelError).code, 'keel/wecom-unauthorized')
      assert.equal(err.message, '企业微信 Secret 无效或应用未授权')
      return true
    },
  )

  assertNoSecrets(logs, caughtErrors)
})

test('gettoken fails when access_token is missing or empty', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []

  const { client: clientNoToken } = createClient(
    {
      '/cgi-bin/gettoken': {
        body: { errcode: 0 },
      },
    },
    logs,
  )

  await assert.rejects(
    async () => {
      await clientNoToken.token()
    },
    (err: Error) => {
      caughtErrors.push(err.message)
      assert.equal((err as KeelError).code, 'keel/wecom-unauthorized')
      assert.equal(err.message, '企业微信 Secret 无效或应用未授权')
      return true
    },
  )

  const { client: clientEmptyToken } = createClient(
    {
      '/cgi-bin/gettoken': {
        body: { errcode: 0, access_token: '' },
      },
    },
    logs,
  )

  await assert.rejects(
    async () => {
      await clientEmptyToken.token()
    },
    (err: Error) => {
      caughtErrors.push(err.message)
      assert.equal((err as KeelError).code, 'keel/wecom-unauthorized')
      assert.equal(err.message, '企业微信 Secret 无效或应用未授权')
      return true
    },
  )

  assertNoSecrets(logs, caughtErrors)
})

test('maps errcode to unauthorized (40014, 42001, 41001)', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []

  for (const errcode of [40014, 42001, 41001]) {
    const { client } = createClient(
      {
        '/cgi-bin/gettoken': {
          body: { errcode: 0, access_token: TOKEN },
        },
        '/cgi-bin/wedoc/document/get': {
          body: { errcode, errmsg: 'token error details' },
        },
      },
      logs,
    )

    await assert.rejects(
      async () => {
        await client.call('/cgi-bin/wedoc/document/get', { docid: 'test' })
      },
      (err: Error) => {
        caughtErrors.push(err.message)
        assert.equal((err as KeelError).code, 'keel/wecom-unauthorized')
        assert.equal(err.message, '企业微信 Secret 无效或应用未授权')
        return true
      },
    )
  }

  assertNoSecrets(logs, caughtErrors)
})

test('maps errcode to forbidden (60011, 60020, 48002, 301002, 640014)', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []

  for (const errcode of [60011, 60020, 48002, 301002, 640014]) {
    const { client } = createClient(
      {
        '/cgi-bin/gettoken': {
          body: { errcode: 0, access_token: TOKEN },
        },
        '/cgi-bin/wedoc/create_doc': {
          body: { errcode, errmsg: 'permission denied details' },
        },
      },
      logs,
    )

    await assert.rejects(
      async () => {
        await client.call('/cgi-bin/wedoc/create_doc', { spaceid: 's' })
      },
      (err: Error) => {
        caughtErrors.push(err.message)
        assert.equal((err as KeelError).code, 'keel/wecom-forbidden')
        assert.equal(err.message, '企业微信应用缺少文档或微盘权限')
        return true
      },
    )
  }

  assertNoSecrets(logs, caughtErrors)
})

test('maps errcode to unavailable (45009, -1)', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []

  for (const errcode of [45009, -1]) {
    const { client } = createClient(
      {
        '/cgi-bin/gettoken': {
          body: { errcode: 0, access_token: TOKEN },
        },
        '/cgi-bin/wedrive/file_list': {
          body: { errcode, errmsg: 'system busy details' },
        },
      },
      logs,
    )

    await assert.rejects(
      async () => {
        await client.call('/cgi-bin/wedrive/file_list', {})
      },
      (err: Error) => {
        caughtErrors.push(err.message)
        assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
        assert.equal(err.message, '无法连接企业微信')
        return true
      },
    )
  }

  assertNoSecrets(logs, caughtErrors)
})

test('maps other non-zero errcode to rejected with errcode in message and no errmsg', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []

  for (const errcode of [99999, 40003]) {
    const sensitiveErrmsg = 'sensitive-backend-path-or-param'
    const { client } = createClient(
      {
        '/cgi-bin/gettoken': {
          body: { errcode: 0, access_token: TOKEN },
        },
        '/cgi-bin/wedoc/document/batch_update': {
          body: { errcode, errmsg: sensitiveErrmsg },
        },
      },
      logs,
    )

    await assert.rejects(
      async () => {
        await client.call('/cgi-bin/wedoc/document/batch_update', {})
      },
      (err: Error) => {
        caughtErrors.push(err.message)
        assert.equal((err as KeelError).code, 'keel/wecom-rejected')
        assert.equal(err.message, `企业微信拒绝了这次写入（errcode ${errcode}）`)
        assert.equal(err.message.includes(sensitiveErrmsg), false)
        return true
      },
    )
  }

  assertNoSecrets(logs, caughtErrors)
})

test('network failure and 5xx throw keel/wecom-unavailable', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []

  const { client: networkErrorClient } = createClient(
    {
      '/cgi-bin/gettoken': () => {
        throw new Error('fetch failed')
      },
    },
    logs,
  )

  await assert.rejects(
    async () => {
      await networkErrorClient.token()
    },
    (err: Error) => {
      caughtErrors.push(err.message)
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      assert.equal(err.message, '无法连接企业微信')
      return true
    },
  )

  const { client: server500Client } = createClient(
    {
      '/cgi-bin/gettoken': {
        status: 500,
        body: 'Internal Server Error',
      },
    },
    logs,
  )

  await assert.rejects(
    async () => {
      await server500Client.token()
    },
    (err: Error) => {
      caughtErrors.push(err.message)
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      assert.equal(err.message, '无法连接企业微信')
      return true
    },
  )

  assertNoSecrets(logs, caughtErrors)
})

test('successful call returns data and logs sanitized line', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  const { client, fake } = createClient(
    {
      '/cgi-bin/gettoken': {
        body: { errcode: 0, access_token: TOKEN },
      },
      '/cgi-bin/wedoc/document/get': {
        body: { errcode: 0, title: 'Weekly Report' },
      },
    },
    logs,
  )

  const result = await client.call<{ errcode: number; title: string }>('/cgi-bin/wedoc/document/get', { docid: 'doc-1' })
  assert.equal(result.title, 'Weekly Report')
  assert.equal(fake.calls.length, 2)
  assert.equal(fake.calls[0].path, '/cgi-bin/gettoken')
  assert.equal(fake.calls[1].path, '/cgi-bin/wedoc/document/get')
  assert.deepEqual(logs, [
    'GET /cgi-bin/gettoken 200 errcode=0',
    'POST /cgi-bin/wedoc/document/get 200 errcode=0',
  ])
  assertNoSecrets(logs, caughtErrors)
})

test('WecomHttp does not have allowSelfSigned parameter', () => {
  type HasAllowSelfSigned = 'allowSelfSigned' extends keyof WecomHttpOptions ? true : false
  const hasProp: HasAllowSelfSigned = false
  assert.equal(hasProp, false)

  const logs: string[] = []
  const caughtErrors: string[] = []
  const options: WecomHttpOptions = {
    corpId: CORP_ID,
    secret: SECRET,
    sleep: async () => {},
    log: line => logs.push(line),
  }
  assert.equal('allowSelfSigned' in options, false)
  const client = new WecomHttp(options)
  assert.equal('allowSelfSigned' in client, false)
  assertNoSecrets(logs, caughtErrors)
})

test('缓存命中时第二次 call 不再请求 gettoken', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  let now = 1_000_000
  let tokenCalls = 0
  const { client, fake } = createClient(
    {
      '/cgi-bin/gettoken': () => {
        tokenCalls++
        return {
          body: { errcode: 0, access_token: TOKEN, expires_in: 7200 },
        }
      },
      '/cgi-bin/wedoc/document/get': {
        body: { errcode: 0, title: 'Doc' },
      },
    },
    {
      now: () => now,
    },
    logs,
  )

  await client.call('/cgi-bin/wedoc/document/get', { docid: 'doc-1' })
  assert.equal(tokenCalls, 1)
  assert.equal(fake.calls.length, 2)
  assert.equal(fake.calls[0].path, '/cgi-bin/gettoken')
  assert.equal(fake.calls[1].path, '/cgi-bin/wedoc/document/get')

  // Advance time by 60 seconds (well before 7200s - 120s)
  now += 60_000
  await client.call('/cgi-bin/wedoc/document/get', { docid: 'doc-2' })
  assert.equal(tokenCalls, 1, 'gettoken should not be called again when cache hits')
  assert.equal(fake.calls.length, 3)
  assert.equal(fake.calls[2].path, '/cgi-bin/wedoc/document/get')
  assertNoSecrets(logs, caughtErrors)
})

test('now 推进到到期前 120 秒时会重新 gettoken', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  let now = 1_000_000
  let tokenCalls = 0
  const { client, fake } = createClient(
    {
      '/cgi-bin/gettoken': () => {
        tokenCalls++
        return {
          body: { errcode: 0, access_token: `token-${tokenCalls}`, expires_in: 7200 },
        }
      },
      '/cgi-bin/wedoc/document/get': {
        body: { errcode: 0, title: 'Doc' },
      },
    },
    {
      now: () => now,
    },
    logs,
  )

  // First call fetches token at now = 1_000_000. expiresAt = 1_000_000 + 7200_000 = 8_200_000.
  await client.call('/cgi-bin/wedoc/document/get', { docid: 'doc-1' })
  assert.equal(tokenCalls, 1)

  // Advance to 121 seconds before expiresAt: 8_200_000 - 121_000 = 8_079_000 -> cache still valid
  now = 8_079_000
  await client.call('/cgi-bin/wedoc/document/get', { docid: 'doc-2' })
  assert.equal(tokenCalls, 1)

  // Advance to exactly 120 seconds before expiresAt: 8_200_000 - 120_000 = 8_080_000 -> expired!
  now = 8_080_000
  await client.call('/cgi-bin/wedoc/document/get', { docid: 'doc-3' })
  assert.equal(tokenCalls, 2)
  assert.equal(fake.calls.filter(c => c.path === '/cgi-bin/gettoken').length, 2)
  assertNoSecrets(logs, caughtErrors)
})

test('40014 后重取 token 并成功', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  let tokenCalls = 0
  let docGetCalls = 0
  const { client, fake } = createClient(
    {
      '/cgi-bin/gettoken': () => {
        tokenCalls++
        return {
          body: { errcode: 0, access_token: `token-${tokenCalls}`, expires_in: 7200 },
        }
      },
      '/cgi-bin/wedoc/document/get': () => {
        docGetCalls++
        if (docGetCalls === 1) {
          return {
            body: { errcode: 40014, errmsg: 'invalid access_token' },
          }
        }
        return {
          body: { errcode: 0, title: 'Success After 40014' },
        }
      },
    },
    logs,
  )

  const result = await client.call<{ errcode: number; title: string }>('/cgi-bin/wedoc/document/get', { docid: 'doc-1' })
  assert.equal(result.title, 'Success After 40014')
  assert.equal(tokenCalls, 2)
  assert.equal(docGetCalls, 2)
  assert.equal(fake.calls.length, 4)
  assert.equal(fake.calls[0].path, '/cgi-bin/gettoken')
  assert.equal(fake.calls[1].path, '/cgi-bin/wedoc/document/get')
  assert.equal(fake.calls[2].path, '/cgi-bin/gettoken')
  assert.equal(fake.calls[3].path, '/cgi-bin/wedoc/document/get')
  assertNoSecrets(logs, caughtErrors)
})

test('读接口 45009 重试一次成功且 sleep 收到 1000', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  const sleptMs: number[] = []
  let fileListCalls = 0
  const { client, fake } = createClient(
    {
      '/cgi-bin/gettoken': {
        body: { errcode: 0, access_token: TOKEN, expires_in: 7200 },
      },
      '/cgi-bin/wedrive/file_list': () => {
        fileListCalls++
        if (fileListCalls === 1) {
          return {
            body: { errcode: 45009, errmsg: 'api freq out of limit' },
          }
        }
        return {
          body: { errcode: 0, file_list: [{ fileid: 'f1' }] },
        }
      },
    },
    {
      sleep: async (ms: number) => {
        sleptMs.push(ms)
      },
    },
    logs,
  )

  const result = await client.call<{ errcode: number; file_list: unknown[] }>('/cgi-bin/wedrive/file_list', {})
  assert.equal(result.errcode, 0)
  assert.equal(fileListCalls, 2)
  assert.deepEqual(sleptMs, [1000])
  assert.equal(fake.calls.length, 3)
  assertNoSecrets(logs, caughtErrors)
})

test('create_doc 遇 45009 不重试', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  const sleptMs: number[] = []
  let createDocCalls = 0
  const { client } = createClient(
    {
      '/cgi-bin/gettoken': {
        body: { errcode: 0, access_token: TOKEN, expires_in: 7200 },
      },
      '/cgi-bin/wedoc/create_doc': () => {
        createDocCalls++
        return {
          body: { errcode: 45009, errmsg: 'api freq out of limit' },
        }
      },
    },
    {
      sleep: async (ms: number) => {
        sleptMs.push(ms)
      },
    },
    logs,
  )

  await assert.rejects(
    async () => {
      await client.call('/cgi-bin/wedoc/create_doc', { spaceid: 's' })
    },
    (err: Error) => {
      caughtErrors.push(err.message)
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      assert.equal(err.message, '无法连接企业微信')
      return true
    },
  )

  assert.equal(createDocCalls, 1)
  assert.equal(sleptMs.length, 0)
  assertNoSecrets(logs, caughtErrors)
})

test('403 JSON 无 errcode 抛 unavailable', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []

  const { client } = createClient(
    {
      '/cgi-bin/gettoken': {
        body: { errcode: 0, access_token: TOKEN, expires_in: 7200 },
      },
      '/cgi-bin/wedoc/document/get': {
        status: 403,
        body: { message: 'Forbidden without errcode' },
      },
    },
    logs,
  )

  await assert.rejects(
    async () => {
      await client.call('/cgi-bin/wedoc/document/get', { docid: 'doc-1' })
    },
    (err: Error) => {
      caughtErrors.push(err.message)
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      assert.equal(err.message, '无法连接企业微信')
      return true
    },
  )

  const { client: tokenClient } = createClient(
    {
      '/cgi-bin/gettoken': {
        status: 403,
        body: { message: 'Forbidden without errcode' },
      },
    },
    logs,
  )

  await assert.rejects(
    async () => {
      await tokenClient.token()
    },
    (err: Error) => {
      caughtErrors.push(err.message)
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      assert.equal(err.message, '无法连接企业微信')
      return true
    },
  )

  assertNoSecrets(logs, caughtErrors)
})

test('40014 重取 token 后再遇 45009 不再等待重试', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  let docGetCalls = 0
  const slept: number[] = []
  const { client } = createClient(
    {
      '/cgi-bin/gettoken': { body: { errcode: 0, access_token: TOKEN, expires_in: 7200 } },
      '/cgi-bin/wedoc/document/get': () => {
        docGetCalls++
        if (docGetCalls === 1) return { body: { errcode: 45009 } }
        if (docGetCalls === 2) return { body: { errcode: 40014 } }
        return { body: { errcode: 45009 } }
      },
    },
    { sleep: async (ms: number) => { slept.push(ms) } },
    logs,
  )

  await assert.rejects(
    () => client.call('/cgi-bin/wedoc/document/get', { docid: 'doc-1' }),
    (err: Error) => {
      caughtErrors.push(err.message)
      return (err as KeelError).code === 'keel/wecom-unavailable'
    },
  )
  assert.equal(docGetCalls, 3)
  assert.deepEqual(slept, [1000])
  assertNoSecrets(logs, caughtErrors)
})

test('403 带 errcode 60011 按 errcode 映射为 forbidden', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  const { client } = createClient(
    {
      '/cgi-bin/gettoken': { body: { errcode: 0, access_token: TOKEN, expires_in: 7200 } },
      '/cgi-bin/wedoc/document/get': { status: 403, body: { errcode: 60011, errmsg: 'no privilege' } },
    },
    logs,
  )

  await assert.rejects(
    () => client.call('/cgi-bin/wedoc/document/get', { docid: 'doc-1' }),
    (err: Error) => {
      caughtErrors.push(err.message)
      return (err as KeelError).code === 'keel/wecom-forbidden'
    },
  )
  assert.ok(logs.includes('POST /cgi-bin/wedoc/document/get 403 errcode=60011'))
  assertNoSecrets(logs, caughtErrors)
})

test('非 2xx 带 errcode：gettoken 403+40013 抛 unauthorized；读接口 429+45009 等 1 秒重试一次', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  const { client: tokenClient } = createClient(
    {
      '/cgi-bin/gettoken': { status: 403, body: { errcode: 40013 } },
    },
    logs,
  )
  await assert.rejects(
    () => tokenClient.token(),
    (err: Error) => {
      caughtErrors.push(err.message)
      return (err as KeelError).code === 'keel/wecom-unauthorized'
    },
  )

  let docGetCalls = 0
  const slept: number[] = []
  const { client } = createClient(
    {
      '/cgi-bin/gettoken': { body: { errcode: 0, access_token: TOKEN, expires_in: 7200 } },
      '/cgi-bin/wedoc/document/get': () => {
        docGetCalls++
        if (docGetCalls === 1) return { status: 429, body: { errcode: 45009 } }
        return { body: { errcode: 0, title: 'ok' } }
      },
    },
    { sleep: async (ms: number) => { slept.push(ms) } },
    logs,
  )
  const result = await client.call<{ title: string }>('/cgi-bin/wedoc/document/get', { docid: 'doc-1' })
  assert.equal(result.title, 'ok')
  assert.deepEqual(slept, [1000])
  assertNoSecrets(logs, caughtErrors)
})

test('call /cgi-bin/wedoc/document/get where route returns status 502 with non-JSON body rejects with keel/wecom-unavailable', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  const { client } = createClient(
    {
      '/cgi-bin/gettoken': {
        body: { errcode: 0, access_token: TOKEN },
      },
      '/cgi-bin/wedoc/document/get': {
        status: 502,
        headers: { 'content-type': 'text/html' },
        body: '<html><body>502 Bad Gateway</body></html>',
      },
    },
    logs,
  )

  await assert.rejects(
    () => client.call('/cgi-bin/wedoc/document/get', { docid: 'doc-1' }),
    (err: Error) => {
      caughtErrors.push(err.message)
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      return true
    },
  )

  assertNoSecrets(logs, caughtErrors)
})

test('timeoutMs: 20 and a fetch that never resolves until its signal aborts -> call() rejects with keel/wecom-unavailable', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  const client = new WecomHttp({
    corpId: CORP_ID,
    secret: SECRET,
    timeoutMs: 20,
    sleep: async () => {},
    log: line => logs.push(line),
    fetch: (_input, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal
        if (signal == null) {
          reject(new Error('missing signal'))
          return
        }
        if (signal.aborted) {
          reject(signal.reason ?? new DOMException('This operation was aborted', 'AbortError'))
          return
        }
        signal.addEventListener('abort', () => {
          reject(signal.reason ?? new DOMException('This operation was aborted', 'AbortError'))
        })
      }),
  })

  await assert.rejects(
    () => client.call('/cgi-bin/wedoc/document/get', {}),
    (err: Error) => {
      caughtErrors.push(err.message)
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      return true
    },
  )

  assertNoSecrets(logs, caughtErrors)
})

test('first fetch throws network error, second succeeds for /cgi-bin/gettoken (via token()) -> sleep received [1000]', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  const slept: number[] = []
  let attempts = 0

  const { client } = createClient(
    {
      '/cgi-bin/gettoken': () => {
        attempts++
        if (attempts === 1) {
          throw new Error('network error')
        }
        return {
          body: { errcode: 0, access_token: TOKEN, expires_in: 7200 },
        }
      },
    },
    {
      sleep: async (ms: number) => {
        slept.push(ms)
      },
    },
    logs,
  )

  const token = await client.token()
  assert.equal(token, TOKEN)
  assert.equal(attempts, 2)
  assert.deepEqual(slept, [1000])
  assertNoSecrets(logs, caughtErrors)
})

test('first fetch throws network error, second succeeds for /cgi-bin/wedrive/file_list -> sleep received [1000]', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  const slept: number[] = []
  let attempts = 0

  const { client } = createClient(
    {
      '/cgi-bin/gettoken': {
        body: { errcode: 0, access_token: TOKEN, expires_in: 7200 },
      },
      '/cgi-bin/wedrive/file_list': () => {
        attempts++
        if (attempts === 1) {
          throw new Error('network error')
        }
        return {
          body: { errcode: 0, file_list: [{ fileid: 'f1' }] },
        }
      },
    },
    {
      sleep: async (ms: number) => {
        slept.push(ms)
      },
    },
    logs,
  )

  const result = await client.call<{ errcode: number; file_list: unknown[] }>('/cgi-bin/wedrive/file_list', {})
  assert.equal(result.errcode, 0)
  assert.equal(attempts, 2)
  assert.deepEqual(slept, [1000])
  assertNoSecrets(logs, caughtErrors)
})

test('first fetch throws network error, second succeeds for /cgi-bin/wedoc/document/get -> sleep received [1000]', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  const slept: number[] = []
  let attempts = 0

  const { client } = createClient(
    {
      '/cgi-bin/gettoken': {
        body: { errcode: 0, access_token: TOKEN, expires_in: 7200 },
      },
      '/cgi-bin/wedoc/document/get': () => {
        attempts++
        if (attempts === 1) {
          throw new Error('network error')
        }
        return {
          body: { errcode: 0, title: 'doc' },
        }
      },
    },
    {
      sleep: async (ms: number) => {
        slept.push(ms)
      },
    },
    logs,
  )

  const result = await client.call<{ errcode: number; title: string }>('/cgi-bin/wedoc/document/get', { docid: 'doc-1' })
  assert.equal(result.title, 'doc')
  assert.equal(attempts, 2)
  assert.deepEqual(slept, [1000])
  assertNoSecrets(logs, caughtErrors)
})

test('gettoken returns 200 {errcode:45009} then 200 ok -> token() resolves, slept [1000]', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  const slept: number[] = []
  let attempts = 0

  const { client } = createClient(
    {
      '/cgi-bin/gettoken': () => {
        attempts++
        if (attempts === 1) {
          return {
            status: 200,
            body: { errcode: 45009, errmsg: 'system busy' },
          }
        }
        return {
          status: 200,
          body: { errcode: 0, access_token: TOKEN, expires_in: 7200 },
        }
      },
    },
    {
      sleep: async (ms: number) => {
        slept.push(ms)
      },
    },
    logs,
  )

  const token = await client.token()
  assert.equal(token, TOKEN)
  assert.equal(attempts, 2)
  assert.deepEqual(slept, [1000])
  assertNoSecrets(logs, caughtErrors)
})

test('gettoken returns 429 {errcode:45009} then 200 ok -> resolves, slept [1000]; twice 429 45009 -> rejects keel/wecom-unavailable', async () => {
  const logs1: string[] = []
  const caughtErrors1: string[] = []
  const slept1: number[] = []
  let attempts1 = 0

  const { client: client1 } = createClient(
    {
      '/cgi-bin/gettoken': () => {
        attempts1++
        if (attempts1 === 1) {
          return {
            status: 429,
            body: { errcode: 45009, errmsg: 'rate limit' },
          }
        }
        return {
          status: 200,
          body: { errcode: 0, access_token: TOKEN, expires_in: 7200 },
        }
      },
    },
    {
      sleep: async (ms: number) => {
        slept1.push(ms)
      },
    },
    logs1,
  )

  const token = await client1.token()
  assert.equal(token, TOKEN)
  assert.equal(attempts1, 2)
  assert.deepEqual(slept1, [1000])
  assertNoSecrets(logs1, caughtErrors1)

  const logs2: string[] = []
  const caughtErrors2: string[] = []
  const slept2: number[] = []
  let attempts2 = 0

  const { client: client2 } = createClient(
    {
      '/cgi-bin/gettoken': () => {
        attempts2++
        return {
          status: 429,
          body: { errcode: 45009, errmsg: 'rate limit' },
        }
      },
    },
    {
      sleep: async (ms: number) => {
        slept2.push(ms)
      },
    },
    logs2,
  )

  await assert.rejects(
    async () => {
      await client2.token()
    },
    (err: Error) => {
      caughtErrors2.push(err.message)
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      assert.equal(err.message, '无法连接企业微信')
      return true
    },
  )
  assert.equal(attempts2, 2)
  assert.deepEqual(slept2, [1000])
  assertNoSecrets(logs2, caughtErrors2)
})

test('gettoken 200 {errcode:-1} -> rejects keel/wecom-unavailable', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  const slept: number[] = []
  let attempts = 0

  const { client } = createClient(
    {
      '/cgi-bin/gettoken': () => {
        attempts++
        return {
          status: 200,
          body: { errcode: -1, errmsg: 'system error' },
        }
      },
    },
    {
      sleep: async (ms: number) => {
        slept.push(ms)
      },
    },
    logs,
  )

  await assert.rejects(
    async () => {
      await client.token()
    },
    (err: Error) => {
      caughtErrors.push(err.message)
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      assert.equal(err.message, '无法连接企业微信')
      return true
    },
  )
  assert.equal(attempts, 1)
  assert.deepEqual(slept, [])
  assertNoSecrets(logs, caughtErrors)
})

test('batch_update (/cgi-bin/wedoc/document/batch_update) network error rejects keel/wecom-unavailable, called once, sleep never called', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  const slept: number[] = []
  let batchUpdateCalls = 0

  const { client } = createClient(
    {
      '/cgi-bin/gettoken': {
        body: { errcode: 0, access_token: TOKEN, expires_in: 7200 },
      },
      '/cgi-bin/wedoc/document/batch_update': () => {
        batchUpdateCalls++
        throw new Error('network error')
      },
    },
    {
      sleep: async (ms: number) => {
        slept.push(ms)
      },
    },
    logs,
  )

  await assert.rejects(
    async () => {
      await client.call('/cgi-bin/wedoc/document/batch_update', {})
    },
    (err: Error) => {
      caughtErrors.push(err.message)
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      assert.equal(err.message, '无法连接企业微信')
      return true
    },
  )

  assert.equal(batchUpdateCalls, 1)
  assert.deepEqual(slept, [])
  assertNoSecrets(logs, caughtErrors)
})

test('log sanitizing masks access_token, corpsecret, and key', () => {
  const logs: string[] = []
  const fake = createFakeWecom({
    '/cgi-bin/gettoken': {
      status: 200,
      body: { errcode: 0, access_token: TOKEN },
    },
  })
  const client = new WecomHttp({
    corpId: CORP_ID,
    secret: SECRET,
    fetch: fake.fetch,
    log: (line: string) => {
      logs.push(line)
    },
  })

  ;(client as unknown as { logFn: (l: string) => void }).logFn(
    'GET /x?access_token=abc&corpsecret=def&key=ghi 200 errcode=0',
  )

  assert.equal(logs.length, 1)
  assert.equal(logs[0], 'GET /x?access_token=***&corpsecret=***&key=*** 200 errcode=0')
})

test('request placement: query params and body secrets', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  const { client, fake } = createClient(
    {
      '/cgi-bin/gettoken': {
        body: { errcode: 0, access_token: TOKEN },
      },
      '/cgi-bin/wedoc/document/get': {
        body: { errcode: 0, title: 'Document Title' },
      },
    },
    logs,
  )

  await client.call('/cgi-bin/wedoc/document/get', { docid: 'd' })

  assert.equal(fake.calls.length, 2)
  const tokenCall = fake.calls[0]
  const docCall = fake.calls[1]

  assert.equal(tokenCall.path, '/cgi-bin/gettoken')
  assert.equal(tokenCall.query.corpsecret, 'test-wecom-secret')

  assert.equal(docCall.path, '/cgi-bin/wedoc/document/get')
  assert.equal(docCall.query.access_token, 'test-access-token')
  assert.equal('corpsecret' in docCall.query, false)

  for (const call of fake.calls) {
    const bodyStr = typeof call.body === 'string' ? call.body : JSON.stringify(call.body ?? '')
    assert.equal(bodyStr.includes('test-wecom-secret'), false)
    assert.equal(bodyStr.includes('test-access-token'), false)
  }

  assertNoSecrets(logs, caughtErrors)
})

test('gettoken 502 with errcode -1 rejects keel/wecom-unavailable with slept []', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  const slept: number[] = []
  const { client } = createClient(
    {
      '/cgi-bin/gettoken': {
        status: 502,
        body: { errcode: -1 },
      },
    },
    { sleep: async (ms: number) => { slept.push(ms) } },
    logs,
  )

  await assert.rejects(
    () => client.token(),
    (err: Error) => {
      caughtErrors.push(err.message)
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      return true
    },
  )

  assert.deepEqual(slept, [])
  assertNoSecrets(logs, caughtErrors)
})

test('gettoken always 200 errcode 45009 rejects keel/wecom-unavailable, called 2 times, slept [1000]', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  const slept: number[] = []
  let tokenCalls = 0
  const { client } = createClient(
    {
      '/cgi-bin/gettoken': () => {
        tokenCalls++
        return {
          status: 200,
          body: { errcode: 45009 },
        }
      },
    },
    { sleep: async (ms: number) => { slept.push(ms) } },
    logs,
  )

  await assert.rejects(
    () => client.token(),
    (err: Error) => {
      caughtErrors.push(err.message)
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      return true
    },
  )

  assert.equal(tokenCalls, 2)
  assert.deepEqual(slept, [1000])
  assertNoSecrets(logs, caughtErrors)
})

test('gettoken first network error, then 429 errcode 45009, then 200 ok resolves, slept [1000, 1000]', async () => {
  const logs: string[] = []
  const caughtErrors: string[] = []
  const slept: number[] = []
  let tokenCalls = 0
  const { client } = createClient(
    {
      '/cgi-bin/gettoken': () => {
        tokenCalls++
        if (tokenCalls === 1) {
          throw new Error('network failure')
        }
        if (tokenCalls === 2) {
          return {
            status: 429,
            body: { errcode: 45009 },
          }
        }
        return {
          status: 200,
          body: { errcode: 0, access_token: TOKEN },
        }
      },
    },
    { sleep: async (ms: number) => { slept.push(ms) } },
    logs,
  )

  const token = await client.token()
  assert.equal(token, TOKEN)
  assert.equal(tokenCalls, 3)
  assert.deepEqual(slept, [1000, 1000])
  assertNoSecrets(logs, caughtErrors)
})

test('WecomClients: same corpId+secret -> same instance; different secret -> new instance; different corpId -> new instance; back to first secret -> new instance', () => {
  const clients = new WecomClients()
  const c1 = clients.get({ corpId: 'corp-a', secret: 'secret-a' })
  const c2 = clients.get({ corpId: 'corp-a', secret: 'secret-a' })
  assert.equal(c1, c2)

  const c3 = clients.get({ corpId: 'corp-a', secret: 'secret-b' })
  assert.notEqual(c1, c3)

  const c4 = clients.get({ corpId: 'corp-b', secret: 'secret-b' })
  assert.notEqual(c3, c4)

  const c5 = clients.get({ corpId: 'corp-a', secret: 'secret-a' })
  assert.notEqual(c1, c5)
})
