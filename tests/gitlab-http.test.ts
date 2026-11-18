import assert from 'node:assert/strict'
import test from 'node:test'
import { GitLabHttp } from '../src/gitlab/http.js'

const TOKEN = 'super-secret-token'

function http(fetchImpl: typeof fetch, extra: { sleep?: (ms: number) => Promise<void>, log?: (line: string) => void, timeoutMs?: number } = {}) {
  return new GitLabHttp({
    baseUrl: 'https://gitlab.example.com',
    token: TOKEN,
    fetch: fetchImpl,
    sleep: extra.sleep ?? (async () => {}),
    log: extra.log,
    timeoutMs: extra.timeoutMs,
  })
}

test('rejects a path outside the allow list before fetch', async () => {
  let called = false
  const client = http(async () => {
    called = true
    return new Response('{}')
  })
  await assert.rejects(() => client.send({ method: 'GET', path: '/admin/ci/variables' }), /输入不符合约定格式/)
  assert.equal(called, false)
})

test('does not follow a redirect and does not log the token', async () => {
  const logs: string[] = []
  let calls = 0
  const client = http(async (_url, init) => {
    calls += 1
    const headers = new Headers(init?.headers)
    assert.equal(headers.get('PRIVATE-TOKEN'), TOKEN)
    return new Response('moved', { status: 302, headers: { location: 'https://evil.example/steal' } })
  }, { log: line => logs.push(line) })
  await assert.rejects(
    () => client.send({ method: 'GET', path: '/groups/acme%2Fplatform' }),
    (error: Error) => {
      assert.equal(error.message, '地址被重定向，请把 baseUrl 写成最终源站')
      assert.equal(error.message.includes(TOKEN), false)
      assert.equal(JSON.stringify(error).includes(TOKEN), false)
      return true
    },
  )
  assert.equal(calls, 1)
  assert.equal(logs.join('\n').includes(TOKEN), false)
})

test('retries one read after 429 and does not retry a write', async () => {
  const waits: number[] = []
  let reads = 0
  const client = http(async () => {
    reads += 1
    if (reads === 1) return new Response('slow', { status: 429, headers: { 'retry-after': '2' } })
    return new Response('[]', { status: 200, headers: { 'x-next-page': '' } })
  }, { sleep: async ms => { waits.push(ms) } })
  const page = await client.send({ method: 'GET', path: '/groups/acme%2Fplatform/issues' })
  assert.equal(page.status, 200)
  assert.deepEqual(waits, [2000])

  let writes = 0
  const writer = http(async () => {
    writes += 1
    return new Response(TOKEN, { status: 429 })
  })
  await assert.rejects(() => writer.send({
    method: 'PUT',
    path: '/projects/7/issues/12',
    body: { due_date: '2026-11-20' },
  }), (error: Error) => {
    assert.equal(error.message, 'GitLab 限流，请稍后再试')
    assert.equal(error.message.includes(TOKEN), false)
    return true
  })
  assert.equal(writes, 1)
})

test('a timeout becomes gitlab unavailable', async () => {
  const client = http((_url, init) => new Promise((_resolve, reject) => {
    const signal = init?.signal
    if (signal == null) {
      reject(new Error('missing signal'))
      return
    }
    if (signal.aborted) {
      reject(signal.reason)
      return
    }
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  }), { timeoutMs: 30 })
  await assert.rejects(() => client.send({ method: 'GET', path: '/groups/acme' }), /无法连接 GitLab/)
})

test('stops paging when x-next-page is empty and marks page 20 truncated', async () => {
  const { nextPageOf } = await import('../src/gitlab/http.js')
  assert.equal(nextPageOf(new Headers()), null)
  assert.equal(nextPageOf(new Headers({ 'x-next-page': '' })), null)
  assert.equal(nextPageOf(new Headers({ 'x-next-page': '3' })), 3)
})
