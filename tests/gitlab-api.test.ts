import assert from 'node:assert/strict'
import test from 'node:test'
import issue from './fixtures/issue.json' with { type: 'json' }
import { GitLabApi } from '../src/gitlab/api.js'

const TOKEN = 'super-secret-token'

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers })
}

function scripted(routes: (url: URL, init: RequestInit | undefined) => Response) {
  const calls: { url: string, method: string, body: string | undefined }[] = []
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input))
    calls.push({ url: url.toString(), method: init?.method ?? 'GET', body: typeof init?.body === 'string' ? init.body : undefined })
    return routes(url, init)
  }
  return {
    calls,
    api: new GitLabApi({
      baseUrl: 'https://gitlab.example.com',
      groupPath: 'acme/platform',
      token: TOKEN,
      fetch: fetchImpl,
      sleep: async () => {},
      log: () => {},
    }),
  }
}

test('drops issues outside the allow set and refuses a write there', async () => {
  const { api, calls } = scripted(url => {
    if (url.pathname.endsWith('/projects')) {
      return json([{ id: 7, path_with_namespace: 'acme/app' }], 200, { 'x-next-page': '' })
    }
    if (url.pathname.endsWith('/issues/99')) return json({ message: 'missing' }, 404)
    return json([{ ...issue, project_id: 99 }], 200, { 'x-next-page': '' })
  })
  const projects = await api.projects()
  const page = await api.listIssues({ scope: 'opened', page: 1, perPage: 100 }, projects)
  assert.deepEqual(page.issues, [])
  await assert.rejects(() => api.setDueDate(99, 1, '2026-11-20', projects), /该仓库不在已配置的组内/)
  assert.equal(calls.some(call => call.method === 'PUT'), false)
})

test('page 20 with a next page is truncated and an empty next page is not', async () => {
  const { api } = scripted(url => {
    const page = url.searchParams.get('page')
    const next = page === '20' ? '21' : ''
    return json([issue], 200, { 'x-next-page': next })
  })
  const projects = new Map([[7, 'acme/app']])
  const truncated = await api.listIssues({ scope: 'opened', page: 20, perPage: 100 }, projects)
  assert.equal(truncated.truncated, true)
  assert.equal(truncated.nextPage, 21)
  const done = await api.listIssues({ scope: 'opened', page: 1, perPage: 100 }, projects)
  assert.equal(done.truncated, false)
  assert.equal(done.nextPage, null)
})

test('risk and due date writes send only the allowed fields', async () => {
  const bodies: unknown[] = []
  const { api } = scripted((url, init) => {
    if (init?.method === 'PUT') bodies.push(JSON.parse(String(init.body)))
    if (url.pathname.endsWith('/labels')) return json([{ name: 'risk::low' }, { name: 'risk::medium' }, { name: 'risk::high' }])
    if (url.searchParams.get('due_date') === 'overdue') return json([])
    if (url.pathname.endsWith('/issues/12')) return json({ ...issue, labels: [{ name: 'bug', color: '#0969da' }] })
    return json(issue)
  })
  const projects = new Map([[7, 'acme/app']])
  await api.setRisk(7, 12, 'high', projects)
  await api.setDueDate(7, 12, '', projects)
  await api.setState(7, 12, 'closed', projects)
  assert.deepEqual(bodies[0], { add_labels: 'risk::high', remove_labels: 'risk::medium,risk::low' })
  assert.equal(JSON.stringify(bodies[0]).includes('"labels"'), false)
  assert.deepEqual(bodies[1], { due_date: '' })
  assert.deepEqual(bodies[2], { state_event: 'close' })
})

test('an unchanged due date does not PUT', async () => {
  let puts = 0
  const { api } = scripted((_url, init) => {
    if (init?.method === 'PUT') puts += 1
    return json(issue)
  })
  await api.setDueDate(7, 12, '2026-11-20', new Map([[7, 'acme/app']]))
  assert.equal(puts, 0)
})

test('creating the missing risk label is skipped when the token is forbidden', async () => {
  const { api } = scripted(url => {
    if (url.pathname.endsWith('/labels') && url.searchParams.get('search') === 'risk::') return json([])
    return json({ message: 'no' }, 403)
  })
  assert.equal(await api.ensureRiskLabels(true), false)
})

test('more than 2000 projects fails closed', async () => {
  const { api } = scripted(url => json([{ id: Number(url.searchParams.get('page')), path_with_namespace: 'acme/app' }], 200, {
    'x-next-page': String(Number(url.searchParams.get('page') ?? '1') + 1),
  }))
  await assert.rejects(() => api.projects(), /项目列表超过 2000 个/)
})
