import assert from 'node:assert/strict'
import test from 'node:test'
import { GitLabApi, type ReportIssueQuery } from '../src/gitlab/api.js'

const TOKEN = 'test-gitlab-token'
const PROJECTS = new Map([[7, 'acme/app']])
const START = '2026-11-16T00:00:00.000+08:00'
const END = '2026-11-20T10:00:00.000+08:00'

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers })
}

function scripted(routes: (url: URL) => Response) {
  const calls: URL[] = []
  const logs: string[] = []
  const fetchImpl: typeof fetch = async input => {
    const url = new URL(String(input))
    calls.push(url)
    return routes(url)
  }
  return {
    calls,
    logs,
    api: new GitLabApi({
      baseUrl: 'https://gitlab.example.com',
      groupPath: 'acme/platform',
      token: TOKEN,
      fetch: fetchImpl,
      sleep: async () => {},
      log: line => logs.push(line),
    }),
  }
}

const rawIssue = {
  project_id: 7,
  iid: 12,
  title: '登录失败',
  state: 'opened',
  confidential: false,
  web_url: 'https://gitlab.example.com/acme/app/-/issues/12',
  created_at: '2026-11-17T08:00:00.000+08:00',
  closed_at: null,
  updated_at: '2026-11-18T09:00:00.000+08:00',
  labels: [{ name: 'bug', color: '#0969da' }],
  assignees: [
    { id: 3, username: 'zhangsan', name: '张三' },
    { id: 5, username: 'lisi', name: '李四' },
  ],
}

const rawEvent = {
  id: 1,
  action: 'add',
  created_at: '2026-11-18T14:02:11.000+08:00',
  resource_type: 'Issue',
  resource_id: 113,
  label: { id: 3, name: 'risk::high', color: '#CF222E' },
}

// 第二阶段设计第 5 节表格里的七个段。
const SEGMENTS: { name: string, params: ReportIssueQuery }[] = [
  { name: '新建', params: { state: 'all', created_after: START, created_before: END } },
  { name: '关闭', params: { state: 'closed', updated_after: START, updated_before: END } },
  { name: '逾期', params: { state: 'opened', due_date: 'overdue' } },
  { name: '高风险变动', params: { state: 'all', updated_after: START, updated_before: END } },
  { name: '进行中', params: { state: 'opened', labels: 'status::doing' } },
  { name: '阻塞', params: { state: 'opened', labels: 'status::blocked' } },
  { name: '当前高风险', params: { state: 'opened', labels: 'risk::high' } },
]

test('reportIssues sends the section 5 query for every report segment', async () => {
  for (const segment of SEGMENTS) {
    const { api, calls } = scripted(() => json([]))
    await api.reportIssues(7, { ...segment.params }, PROJECTS)
    assert.equal(calls.length, 1, segment.name)
    assert.equal(calls[0].pathname, '/api/v4/projects/7/issues', segment.name)
    assert.equal(
      calls[0].searchParams.toString(),
      new URLSearchParams({ ...segment.params, with_labels_details: 'true', per_page: '100', page: '1' }).toString(),
      segment.name,
    )
  }
})

test('reportIssues accepts every whitelisted query key and keeps its own pagination', async () => {
  const { api, calls } = scripted(() => json([rawIssue], 200, { 'x-next-page': '' }))
  const result = await api.reportIssues(7, {
    state: 'all',
    created_after: START,
    created_before: END,
    updated_after: START,
    updated_before: END,
    due_date: 'overdue',
    labels: 'risk::high',
    order_by: 'created_at',
    sort: 'asc',
    with_labels_details: 'false',
    per_page: '50',
    page: '3',
  }, PROJECTS)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].searchParams.get('order_by'), 'created_at')
  assert.equal(calls[0].searchParams.get('sort'), 'asc')
  assert.equal(calls[0].searchParams.get('with_labels_details'), 'true')
  assert.equal(calls[0].searchParams.get('per_page'), '100')
  assert.equal(calls[0].searchParams.get('page'), '1')
  assert.equal(result.truncated, false)
  assert.equal(result.issues.length, 1)
})

test('reportIssues rejects query keys outside the whitelist before sending', async () => {
  const { api, calls } = scripted(() => json([]))
  for (const key of ['search', 'in', 'iids[]', 'assignee_id', 'not[labels]', 'milestone', 'confidential', 'scope']) {
    await assert.rejects(
      () => api.reportIssues(7, { state: 'all', [key]: 'x' }, PROJECTS),
      /输入不符合约定格式/,
      key,
    )
  }
  assert.equal(calls.length, 0)
})

test('reportIssues and labelEvents refuse projects outside the allow set before sending', async () => {
  const { api, calls } = scripted(() => json([]))
  await assert.rejects(() => api.reportIssues(99, { state: 'all' }, PROJECTS), /该仓库不在已配置的组内/)
  await assert.rejects(() => api.labelEvents(99, 12, PROJECTS), /该仓库不在已配置的组内/)
  assert.equal(calls.length, 0)
})

test('reportIssues follows x-next-page and concatenates pages in order', async () => {
  const { api, calls } = scripted(url => {
    const page = Number(url.searchParams.get('page'))
    return json([{ ...rawIssue, iid: page }], 200, { 'x-next-page': page < 3 ? String(page + 1) : '' })
  })
  const result = await api.reportIssues(7, { state: 'all' }, PROJECTS)
  assert.equal(result.truncated, false)
  assert.deepEqual(result.issues.map(issue => issue.iid), [1, 2, 3])
  assert.deepEqual(calls.map(url => url.searchParams.get('page')), ['1', '2', '3'])
})

test('reportIssues reports truncated at page 20 with a next page instead of throwing', async () => {
  const { api, calls } = scripted(url => {
    const page = Number(url.searchParams.get('page'))
    return json([rawIssue], 200, { 'x-next-page': String(page + 1) })
  })
  const result = await api.reportIssues(7, { state: 'all' }, PROJECTS)
  assert.equal(result.truncated, true)
  assert.equal(result.issues.length, 20)
  assert.equal(calls.length, 20)
})

test('reportIssues reports not truncated when page 20 is the last page', async () => {
  const { api, calls } = scripted(url => {
    const page = Number(url.searchParams.get('page'))
    return json([rawIssue], 200, { 'x-next-page': page < 20 ? String(page + 1) : '' })
  })
  const result = await api.reportIssues(7, { state: 'all' }, PROJECTS)
  assert.equal(result.truncated, false)
  assert.equal(result.issues.length, 20)
  assert.equal(calls.length, 20)
})

test('reportIssues maps the projection from the allowed project, not from the payload', async () => {
  const { api } = scripted(() => json([
    {
      ...rawIssue,
      project_id: 999,
      confidential: true,
      web_url: undefined,
      title: '第一行\n第二行',
      closed_at: '2026-11-19T10:00:00.000+08:00',
      assignees: [{ id: 3, username: 'zhangsan', name: '张三' }, { username: 'noname' }, 42],
    },
  ], 200, { 'x-next-page': '' }))
  const result = await api.reportIssues(7, { state: 'all' }, PROJECTS)
  assert.deepEqual(result.issues, [
    {
      projectId: 7,
      projectPath: 'acme/app',
      iid: 12,
      title: '第一行\n第二行',
      confidential: true,
      webUrl: null,
      assignees: [{ id: 3, name: '张三' }],
      createdAt: '2026-11-17T08:00:00.000+08:00',
      closedAt: '2026-11-19T10:00:00.000+08:00',
    },
  ])
})

test('reportIssues keeps webUrl when present and closedAt null when the issue is reopened', async () => {
  const { api } = scripted(() => json([rawIssue], 200, { 'x-next-page': '' }))
  const result = await api.reportIssues(7, { state: 'all' }, PROJECTS)
  assert.deepEqual(result.issues, [
    {
      projectId: 7,
      projectPath: 'acme/app',
      iid: 12,
      title: '登录失败',
      confidential: false,
      webUrl: 'https://gitlab.example.com/acme/app/-/issues/12',
      assignees: [
        { id: 3, name: '张三' },
        { id: 5, name: '李四' },
      ],
      createdAt: '2026-11-17T08:00:00.000+08:00',
      closedAt: null,
    },
  ])
})

test('labelEvents requests resource_label_events and maps the event projection', async () => {
  const { api, calls } = scripted(() => json([
    rawEvent,
    { id: 2, action: 'remove', created_at: '2026-11-19T09:00:00.000+08:00', label: { id: 4, name: 'risk::medium', color: '#D4A017' } },
    { id: 3, action: 'add', created_at: '2026-11-19T10:30:00.000+08:00' },
  ], 200, { 'x-next-page': '' }))
  const result = await api.labelEvents(7, 4, PROJECTS)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].pathname, '/api/v4/projects/7/issues/4/resource_label_events')
  assert.equal(calls[0].searchParams.toString(), new URLSearchParams({ per_page: '100', page: '1' }).toString())
  assert.deepEqual(result, {
    events: [
      { id: 1, action: 'add', labelName: 'risk::high', createdAt: '2026-11-18T14:02:11.000+08:00' },
      { id: 2, action: 'remove', labelName: 'risk::medium', createdAt: '2026-11-19T09:00:00.000+08:00' },
      { id: 3, action: 'add', labelName: null, createdAt: '2026-11-19T10:30:00.000+08:00' },
    ],
    truncated: false,
  })
})

test('labelEvents follows pagination and reports truncated at page 20 instead of throwing', async () => {
  const { api, calls } = scripted(url => {
    const page = Number(url.searchParams.get('page'))
    return json([{ ...rawEvent, id: page }], 200, { 'x-next-page': String(page + 1) })
  })
  const result = await api.labelEvents(7, 4, PROJECTS)
  assert.equal(result.truncated, true)
  assert.equal(result.events.length, 20)
  assert.deepEqual(result.events.at(-1), { id: 20, action: 'add', labelName: 'risk::high', createdAt: rawEvent.created_at })
  assert.equal(calls.length, 20)
  assert.equal(calls[0].pathname, '/api/v4/projects/7/issues/4/resource_label_events')
})

test('report queries never leak the GitLab token in URLs, logs, or mapped results', async () => {
  const { api, calls, logs } = scripted(url => url.pathname.endsWith('/resource_label_events')
    ? json([rawEvent], 200, { 'x-next-page': '' })
    : json([rawIssue], 200, { 'x-next-page': '' }))
  const issues = await api.reportIssues(7, { state: 'all' }, PROJECTS)
  const events = await api.labelEvents(7, 12, PROJECTS)
  for (const url of calls) assert.equal(url.toString().includes(TOKEN), false)
  for (const line of logs) assert.equal(line.includes(TOKEN), false)
  assert.equal(JSON.stringify(issues).includes(TOKEN), false)
  assert.equal(JSON.stringify(events).includes(TOKEN), false)
})
