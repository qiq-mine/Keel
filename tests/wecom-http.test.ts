import assert from 'node:assert/strict'
import test from 'node:test'
import type { KeelError } from '../src/errors.js'
import { WecomHttp, type WecomHttpOptions } from '../src/wecom/http.js'
import { createFakeWecom } from './helpers/fake-wecom.js'

const SECRET = 'test-wecom-secret'
const TOKEN = 'test-access-token'
const CORP_ID = 'test-corp-id'

const allLogs: string[] = []
const allErrors: string[] = []

function createClient(
  routes: Parameters<typeof createFakeWecom>[0] = {},
  options?: Partial<WecomHttpOptions>,
) {
  const fake = createFakeWecom(routes)
  const client = new WecomHttp({
    corpId: CORP_ID,
    secret: SECRET,
    fetch: fake.fetch,
    log: line => allLogs.push(line),
    ...options,
  })
  return { client, fake }
}

function recordError(error: unknown): void {
  if (error instanceof Error) {
    allErrors.push(error.message)
  }
}

test('rejects path outside allow list without sending any request', async () => {
  const { client, fake } = createClient()

  await assert.rejects(
    async () => {
      try {
        await client.call('/cgi-bin/not-in-whitelist', {})
      } catch (err) {
        recordError(err)
        throw err
      }
    },
    (err: Error) => {
      assert.equal((err as KeelError).code, 'keel/invalid-input')
      assert.equal(err.message, '输入不符合约定格式')
      assert.equal(err.message.includes('/cgi-bin/not-in-whitelist'), false)
      return true
    },
  )

  await assert.rejects(
    async () => {
      try {
        await client.call('/cgi-bin/gettoken', {})
      } catch (err) {
        recordError(err)
        throw err
      }
    },
    (err: Error) => {
      assert.equal((err as KeelError).code, 'keel/invalid-input')
      assert.equal(err.message, '输入不符合约定格式')
      return true
    },
  )

  assert.equal(fake.calls.length, 0)
})

test('3xx redirect is not followed and throws keel/wecom-unavailable', async () => {
  const { client: redirectTokenClient } = createClient({
    '/cgi-bin/gettoken': {
      status: 302,
      headers: { location: 'https://evil.example.com/steal' },
      body: 'redirect',
    },
  })

  await assert.rejects(
    async () => {
      try {
        await redirectTokenClient.token()
      } catch (err) {
        recordError(err)
        throw err
      }
    },
    (err: Error) => {
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      assert.equal(err.message, '无法连接企业微信')
      return true
    },
  )

  const { client: redirectCallClient } = createClient({
    '/cgi-bin/gettoken': {
      body: { errcode: 0, access_token: TOKEN },
    },
    '/cgi-bin/wedrive/file_list': {
      status: 301,
      headers: { location: 'https://evil.example.com/steal' },
      body: 'moved',
    },
  })

  await assert.rejects(
    async () => {
      try {
        await redirectCallClient.call('/cgi-bin/wedrive/file_list', {})
      } catch (err) {
        recordError(err)
        throw err
      }
    },
    (err: Error) => {
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      assert.equal(err.message, '无法连接企业微信')
      return true
    },
  )
})

test('gettoken fails when errcode is non-zero', async () => {
  const { client } = createClient({
    '/cgi-bin/gettoken': {
      body: { errcode: 40001, errmsg: 'invalid credential secret-leak' },
    },
  })

  await assert.rejects(
    async () => {
      try {
        await client.token()
      } catch (err) {
        recordError(err)
        throw err
      }
    },
    (err: Error) => {
      assert.equal((err as KeelError).code, 'keel/wecom-unauthorized')
      assert.equal(err.message, '企业微信 Secret 无效或应用未授权')
      return true
    },
  )
})

test('gettoken fails when access_token is missing or empty', async () => {
  const { client: clientNoToken } = createClient({
    '/cgi-bin/gettoken': {
      body: { errcode: 0 },
    },
  })

  await assert.rejects(
    async () => {
      try {
        await clientNoToken.token()
      } catch (err) {
        recordError(err)
        throw err
      }
    },
    (err: Error) => {
      assert.equal((err as KeelError).code, 'keel/wecom-unauthorized')
      assert.equal(err.message, '企业微信 Secret 无效或应用未授权')
      return true
    },
  )

  const { client: clientEmptyToken } = createClient({
    '/cgi-bin/gettoken': {
      body: { errcode: 0, access_token: '' },
    },
  })

  await assert.rejects(
    async () => {
      try {
        await clientEmptyToken.token()
      } catch (err) {
        recordError(err)
        throw err
      }
    },
    (err: Error) => {
      assert.equal((err as KeelError).code, 'keel/wecom-unauthorized')
      assert.equal(err.message, '企业微信 Secret 无效或应用未授权')
      return true
    },
  )
})

test('maps errcode to unauthorized (40014, 42001, 41001)', async () => {
  for (const errcode of [40014, 42001, 41001]) {
    const { client } = createClient({
      '/cgi-bin/gettoken': {
        body: { errcode: 0, access_token: TOKEN },
      },
      '/cgi-bin/wedoc/document/get': {
        body: { errcode, errmsg: 'token error details' },
      },
    })

    await assert.rejects(
      async () => {
        try {
          await client.call('/cgi-bin/wedoc/document/get', { docid: 'test' })
        } catch (err) {
          recordError(err)
          throw err
        }
      },
      (err: Error) => {
        assert.equal((err as KeelError).code, 'keel/wecom-unauthorized')
        assert.equal(err.message, '企业微信 Secret 无效或应用未授权')
        return true
      },
    )
  }
})

test('maps errcode to forbidden (60011, 60020, 48002, 301002, 640014)', async () => {
  for (const errcode of [60011, 60020, 48002, 301002, 640014]) {
    const { client } = createClient({
      '/cgi-bin/gettoken': {
        body: { errcode: 0, access_token: TOKEN },
      },
      '/cgi-bin/wedoc/create_doc': {
        body: { errcode, errmsg: 'permission denied details' },
      },
    })

    await assert.rejects(
      async () => {
        try {
          await client.call('/cgi-bin/wedoc/create_doc', { spaceid: 's' })
        } catch (err) {
          recordError(err)
          throw err
        }
      },
      (err: Error) => {
        assert.equal((err as KeelError).code, 'keel/wecom-forbidden')
        assert.equal(err.message, '企业微信应用缺少文档或微盘权限')
        return true
      },
    )
  }
})

test('maps errcode to unavailable (45009, -1)', async () => {
  for (const errcode of [45009, -1]) {
    const { client } = createClient({
      '/cgi-bin/gettoken': {
        body: { errcode: 0, access_token: TOKEN },
      },
      '/cgi-bin/wedrive/file_list': {
        body: { errcode, errmsg: 'system busy details' },
      },
    })

    await assert.rejects(
      async () => {
        try {
          await client.call('/cgi-bin/wedrive/file_list', {})
        } catch (err) {
          recordError(err)
          throw err
        }
      },
      (err: Error) => {
        assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
        assert.equal(err.message, '无法连接企业微信')
        return true
      },
    )
  }
})

test('maps other non-zero errcode to rejected with errcode in message and no errmsg', async () => {
  for (const errcode of [99999, 40003]) {
    const sensitiveErrmsg = 'sensitive-backend-path-or-param'
    const { client } = createClient({
      '/cgi-bin/gettoken': {
        body: { errcode: 0, access_token: TOKEN },
      },
      '/cgi-bin/wedoc/document/batch_update': {
        body: { errcode, errmsg: sensitiveErrmsg },
      },
    })

    await assert.rejects(
      async () => {
        try {
          await client.call('/cgi-bin/wedoc/document/batch_update', {})
        } catch (err) {
          recordError(err)
          throw err
        }
      },
      (err: Error) => {
        assert.equal((err as KeelError).code, 'keel/wecom-rejected')
        assert.equal(err.message, `企业微信拒绝了这次写入（errcode ${errcode}）`)
        assert.equal(err.message.includes(sensitiveErrmsg), false)
        return true
      },
    )
  }
})

test('network failure and 5xx throw keel/wecom-unavailable', async () => {
  const { client: networkErrorClient } = createClient({
    '/cgi-bin/gettoken': () => {
      throw new Error('fetch failed')
    },
  })

  await assert.rejects(
    async () => {
      try {
        await networkErrorClient.token()
      } catch (err) {
        recordError(err)
        throw err
      }
    },
    (err: Error) => {
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      assert.equal(err.message, '无法连接企业微信')
      return true
    },
  )

  const { client: server500Client } = createClient({
    '/cgi-bin/gettoken': {
      status: 500,
      body: 'Internal Server Error',
    },
  })

  await assert.rejects(
    async () => {
      try {
        await server500Client.token()
      } catch (err) {
        recordError(err)
        throw err
      }
    },
    (err: Error) => {
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      assert.equal(err.message, '无法连接企业微信')
      return true
    },
  )
})

test('successful call returns data and logs sanitized line', async () => {
  const { client, fake } = createClient({
    '/cgi-bin/gettoken': {
      body: { errcode: 0, access_token: TOKEN },
    },
    '/cgi-bin/wedoc/document/get': {
      body: { errcode: 0, title: 'Weekly Report' },
    },
  })

  const result = await client.call<{ errcode: number, title: string }>('/cgi-bin/wedoc/document/get', { docid: 'doc-1' })
  assert.equal(result.title, 'Weekly Report')
  assert.equal(fake.calls.length, 2)
  assert.equal(fake.calls[0].path, '/cgi-bin/gettoken')
  assert.equal(fake.calls[1].path, '/cgi-bin/wedoc/document/get')
})

test('no test-wecom-secret or test-access-token appears in logs or error messages', () => {
  assert.ok(allLogs.length > 0, 'Should have recorded log lines')
  assert.ok(allErrors.length > 0, 'Should have recorded error messages')

  for (const line of allLogs) {
    assert.equal(line.includes(SECRET), false, `Log line leaked secret: ${line}`)
    assert.equal(line.includes(TOKEN), false, `Log line leaked token: ${line}`)
  }

  for (const msg of allErrors) {
    assert.equal(msg.includes(SECRET), false, `Error message leaked secret: ${msg}`)
    assert.equal(msg.includes(TOKEN), false, `Error message leaked token: ${msg}`)
  }
})

test('WecomHttp does not have allowSelfSigned parameter', () => {
  type HasAllowSelfSigned = 'allowSelfSigned' extends keyof WecomHttpOptions ? true : false
  const hasProp: HasAllowSelfSigned = false
  assert.equal(hasProp, false)

  const options: WecomHttpOptions = {
    corpId: CORP_ID,
    secret: SECRET,
  }
  assert.equal('allowSelfSigned' in options, false)
  const client = new WecomHttp(options)
  assert.equal('allowSelfSigned' in client, false)
})

test('缓存命中时第二次 call 不再请求 gettoken', async () => {
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
})

test('now 推进到到期前 120 秒时会重新 gettoken', async () => {
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
})

test('40014 后重取 token 并成功', async () => {
  let tokenCalls = 0
  let docGetCalls = 0
  const { client, fake } = createClient({
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
  })

  const result = await client.call<{ errcode: number, title: string }>('/cgi-bin/wedoc/document/get', { docid: 'doc-1' })
  assert.equal(result.title, 'Success After 40014')
  assert.equal(tokenCalls, 2)
  assert.equal(docGetCalls, 2)
  assert.equal(fake.calls.length, 4)
  assert.equal(fake.calls[0].path, '/cgi-bin/gettoken')
  assert.equal(fake.calls[1].path, '/cgi-bin/wedoc/document/get')
  assert.equal(fake.calls[2].path, '/cgi-bin/gettoken')
  assert.equal(fake.calls[3].path, '/cgi-bin/wedoc/document/get')
})

test('读接口 45009 重试一次成功且 sleep 收到 1000', async () => {
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
  )

  const result = await client.call<{ errcode: number, file_list: unknown[] }>('/cgi-bin/wedrive/file_list', {})
  assert.equal(result.errcode, 0)
  assert.equal(fileListCalls, 2)
  assert.deepEqual(sleptMs, [1000])
  assert.equal(fake.calls.length, 3)
})

test('create_doc 遇 45009 不重试', async () => {
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
  )

  await assert.rejects(
    async () => {
      try {
        await client.call('/cgi-bin/wedoc/create_doc', { spaceid: 's' })
      } catch (err) {
        recordError(err)
        throw err
      }
    },
    (err: Error) => {
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      assert.equal(err.message, '无法连接企业微信')
      return true
    },
  )

  assert.equal(createDocCalls, 1)
  assert.equal(sleptMs.length, 0)
})

test('403 JSON 无 errcode 抛 unavailable', async () => {
  const { client } = createClient({
    '/cgi-bin/gettoken': {
      body: { errcode: 0, access_token: TOKEN, expires_in: 7200 },
    },
    '/cgi-bin/wedoc/document/get': {
      status: 403,
      body: { message: 'Forbidden without errcode' },
    },
  })

  await assert.rejects(
    async () => {
      try {
        await client.call('/cgi-bin/wedoc/document/get', { docid: 'doc-1' })
      } catch (err) {
        recordError(err)
        throw err
      }
    },
    (err: Error) => {
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      assert.equal(err.message, '无法连接企业微信')
      return true
    },
  )

  const { client: tokenClient } = createClient({
    '/cgi-bin/gettoken': {
      status: 403,
      body: { message: 'Forbidden without errcode' },
    },
  })

  await assert.rejects(
    async () => {
      try {
        await tokenClient.token()
      } catch (err) {
        recordError(err)
        throw err
      }
    },
    (err: Error) => {
      assert.equal((err as KeelError).code, 'keel/wecom-unavailable')
      assert.equal(err.message, '无法连接企业微信')
      return true
    },
  )
})
