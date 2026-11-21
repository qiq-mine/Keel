import assert from 'node:assert/strict'
import test from 'node:test'
import type { ReportIssue, ReportLabelEvent } from '../src/gitlab/api.js'
import { collectReport, isoShanghai, type ReportSource } from '../src/report/collect.js'

const PROJECT_ID = 7
const PROJECT_PATH = 'acme/app'
const WEEK_TITLE = '周报 2026-11-20'
const WINDOW_START = Date.parse('2026-11-16T00:00:00+08:00')
const WINDOW_END = Date.parse('2026-11-20T10:00:00+08:00')
// 周六补跑：运行时刻晚于窗口终点，用来区分 updated_before（runAt）和 created_before（windowEnd）。
const RUN_AT = Date.parse('2026-11-21T12:00:00+08:00')
const START_ISO = '2026-11-16T00:00:00.000+08:00'
const END_ISO = '2026-11-20T10:00:00.000+08:00'
const RUN_ISO = '2026-11-21T12:00:00.000+08:00'

type IssueResult = { issues: ReportIssue[], truncated: boolean }
type EventResult = { events: ReportLabelEvent[], truncated: boolean }

function makeIssue(overrides: Partial<ReportIssue> & Pick<ReportIssue, 'iid'>): ReportIssue {
  return {
    projectId: PROJECT_ID,
    projectPath: PROJECT_PATH,
    title: `议题 ${overrides.iid}`,
    confidential: false,
    webUrl: `https://gitlab.example.com/acme/app/-/issues/${overrides.iid}`,
    assignees: [],
    createdAt: '2026-11-17T08:00:00.000+08:00',
    closedAt: null,
    ...overrides,
  }
}

function makeEvent(overrides: Partial<ReportLabelEvent> & Pick<ReportLabelEvent, 'id'>): ReportLabelEvent {
  return {
    action: 'add',
    labelName: 'risk::high',
    createdAt: '2026-11-18T14:02:11.000+08:00',
    ...overrides,
  }
}

// 第二阶段设计第 5 节的七个段，按收到的 params 判断是哪一段在查询。
function segmentOf(params: Record<string, string>): string {
  if (params.created_after !== undefined) return 'created'
  if (params.state === 'closed') return 'closed'
  if (params.due_date === 'overdue') return 'overdue'
  if (params.state === 'all') return 'changed'
  if (params.labels === 'status::doing') return 'doing'
  if (params.labels === 'status::blocked') return 'blocked'
  return 'highRiskNow'
}

function fakeSource(handlers: {
  issues?: (segment: string, params: Record<string, string>) => IssueResult
  events?: (iid: number) => EventResult
} = {}) {
  const issueCalls: Record<string, string>[] = []
  const eventCalls: number[] = []
  let inFlight = 0
  let maxInFlight = 0
  const source: ReportSource = {
    async reportIssues(_projectId, params) {
      issueCalls.push({ ...params })
      return handlers.issues ? handlers.issues(segmentOf(params), params) : { issues: [], truncated: false }
    },
    async labelEvents(_projectId, iid) {
      eventCalls.push(iid)
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        await Promise.resolve()
        return handlers.events ? handlers.events(iid) : { events: [], truncated: false }
      } finally {
        inFlight -= 1
      }
    },
  }
  return { source, issueCalls, eventCalls, maxInFlight: () => maxInFlight }
}

function collect(source: ReportSource, columnMode: 'status' | 'state' = 'status') {
  return collectReport(source, {
    projectId: PROJECT_ID,
    projectPath: PROJECT_PATH,
    columnMode,
    weekTitle: WEEK_TITLE,
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    runAt: RUN_AT,
  })
}

test('status mode sends exactly the seven section 5 queries with +08:00 ISO params', async () => {
  const { source, issueCalls } = fakeSource()
  const data = await collect(source)
  assert.deepEqual(issueCalls, [
    { state: 'all', created_after: START_ISO, created_before: END_ISO },
    { state: 'closed', updated_after: START_ISO, updated_before: RUN_ISO },
    { state: 'opened', due_date: 'overdue' },
    { state: 'all', updated_after: START_ISO, updated_before: RUN_ISO },
    { state: 'opened', labels: 'status::doing' },
    { state: 'opened', labels: 'status::blocked' },
    { state: 'opened', labels: 'risk::high' },
  ])
  assert.equal(data.projectId, PROJECT_ID)
  assert.equal(data.projectPath, PROJECT_PATH)
  assert.equal(data.columnMode, 'status')
  assert.equal(data.weekTitle, WEEK_TITLE)
  assert.equal(data.windowStart, WINDOW_START)
  assert.equal(data.windowEnd, WINDOW_END)
  assert.equal(data.generatedAt, RUN_AT)
  assert.deepEqual(data.created, { issues: [], truncated: false })
  assert.deepEqual(data.closed, { issues: [], truncated: false })
  assert.deepEqual(data.overdue, { issues: [], truncated: false })
  assert.deepEqual(data.highRisk, { events: [], truncated: false })
  assert.deepEqual(data.doing, { issues: [], truncated: false })
  assert.deepEqual(data.blocked, { issues: [], truncated: false })
  assert.deepEqual(data.highRiskNow, { issues: [], truncated: false })
})

test('isoShanghai renders ISO 8601 with millisecond and +08:00 offset', () => {
  assert.equal(isoShanghai(WINDOW_START), START_ISO)
  assert.equal(isoShanghai(WINDOW_END), END_ISO)
  assert.equal(isoShanghai(RUN_AT), RUN_ISO)
  assert.equal(isoShanghai(Date.parse('2026-11-20T02:00:00.500Z')), '2026-11-20T10:00:00.500+08:00')
})

test('created keeps the closed window: exact start counts in, one millisecond before does not', async () => {
  const { source } = fakeSource({
    issues: (_segment, params) => {
      if (params.created_after === undefined) return { issues: [], truncated: false }
      return {
        issues: [
          makeIssue({ iid: 1, createdAt: new Date(WINDOW_START - 1).toISOString() }),
          makeIssue({ iid: 2, createdAt: isoShanghai(WINDOW_START) }),
          makeIssue({ iid: 3, createdAt: isoShanghai(WINDOW_END) }),
          makeIssue({ iid: 4, createdAt: new Date(WINDOW_END + 1).toISOString() }),
        ],
        truncated: false,
      }
    },
  })
  const data = await collect(source)
  assert.deepEqual(data.created.issues.map(issue => issue.iid), [2, 3])
})

test('closed keeps issues closed inside the window; reopened or closed outside does not count', async () => {
  const { source } = fakeSource({
    issues: segment => {
      if (segment !== 'closed') return { issues: [], truncated: false }
      return {
        issues: [
          makeIssue({ iid: 1, closedAt: new Date(WINDOW_START - 1).toISOString() }),
          makeIssue({ iid: 2, closedAt: isoShanghai(WINDOW_START) }),
          makeIssue({ iid: 3, closedAt: isoShanghai(WINDOW_END) }),
          makeIssue({ iid: 4, closedAt: new Date(WINDOW_END + 1).toISOString() }),
          makeIssue({ iid: 5, closedAt: null }),
        ],
        truncated: false,
      }
    },
  })
  const data = await collect(source)
  assert.deepEqual(data.closed.issues.map(issue => issue.iid), [2, 3])
})

test('high risk events keep only risk::high add/remove inside the window, sorted by iid then time', async () => {
  const { source, eventCalls } = fakeSource({
    issues: segment => {
      if (segment !== 'changed') return { issues: [], truncated: false }
      return {
        issues: [makeIssue({ iid: 9 }), makeIssue({ iid: 4 }), makeIssue({ iid: 12 })],
        truncated: false,
      }
    },
    events: iid => {
      if (iid === 4) {
        return {
          events: [
            makeEvent({ id: 1, action: 'remove', createdAt: '2026-11-19T09:00:00.000+08:00' }),
            makeEvent({ id: 2, createdAt: '2026-11-17T23:00:00.000+08:00' }),
            makeEvent({ id: 3, createdAt: '2026-11-18T08:00:00.000+08:00' }),
          ],
          truncated: false,
        }
      }
      if (iid === 9) {
        return {
          events: [
            makeEvent({ id: 4, labelName: 'risk::medium', createdAt: '2026-11-18T08:00:00.000+08:00' }),
            makeEvent({ id: 5, labelName: null, createdAt: '2026-11-18T08:00:00.000+08:00' }),
            makeEvent({ id: 6, action: 'assign', createdAt: '2026-11-18T08:00:00.000+08:00' }),
            makeEvent({ id: 7, createdAt: new Date(WINDOW_START - 1).toISOString() }),
            makeEvent({ id: 8, createdAt: new Date(WINDOW_END + 1).toISOString() }),
          ],
          truncated: false,
        }
      }
      return {
        events: [makeEvent({ id: 9, createdAt: '2026-11-20T10:00:00.000+08:00' })],
        truncated: false,
      }
    },
  })
  const data = await collect(source)
  assert.deepEqual(eventCalls, [4, 9, 12])
  assert.deepEqual(data.highRisk.events.map(event => [event.issue.iid, event.action, event.at]), [
    [4, 'add', '2026-11-17T23:00:00.000+08:00'],
    [4, 'add', '2026-11-18T08:00:00.000+08:00'],
    [4, 'remove', '2026-11-19T09:00:00.000+08:00'],
    [12, 'add', '2026-11-20T10:00:00.000+08:00'],
  ])
  for (const event of data.highRisk.events) {
    assert.equal(event.issue.projectId, PROJECT_ID)
    assert.equal(event.issue.projectPath, PROJECT_PATH)
  }
})

test('state mode leaves doing and blocked null and never queries the two status labels', async () => {
  const { source, issueCalls } = fakeSource()
  const data = await collect(source, 'state')
  assert.equal(data.doing, null)
  assert.equal(data.blocked, null)
  assert.equal(issueCalls.length, 5)
  for (const params of issueCalls) {
    assert.equal(params.labels === 'status::doing' || params.labels === 'status::blocked', false)
  }
})

test('status mode still queries doing and blocked before the current high risk snapshot', async () => {
  const { source, issueCalls } = fakeSource()
  const data = await collect(source, 'status')
  assert.deepEqual(data.doing, { issues: [], truncated: false })
  assert.deepEqual(data.blocked, { issues: [], truncated: false })
  assert.deepEqual(issueCalls[4], { state: 'opened', labels: 'status::doing' })
  assert.deepEqual(issueCalls[5], { state: 'opened', labels: 'status::blocked' })
  assert.deepEqual(issueCalls[6], { state: 'opened', labels: 'risk::high' })
})

test('every segment sorts its issues by iid ascending regardless of source order', async () => {
  const shuffled = [
    makeIssue({ iid: 30, closedAt: isoShanghai(WINDOW_END) }),
    makeIssue({ iid: 10, closedAt: isoShanghai(WINDOW_START) }),
    makeIssue({ iid: 20, closedAt: isoShanghai(WINDOW_END) }),
  ]
  const { source } = fakeSource({
    issues: segment => {
      if (segment === 'changed') return { issues: shuffled, truncated: false }
      return { issues: shuffled, truncated: false }
    },
    events: () => ({ events: [], truncated: false }),
  })
  const data = await collect(source)
  const { doing, blocked } = data
  assert.ok(doing !== null && blocked !== null)
  for (const segment of [data.created, data.closed, data.overdue, doing, blocked, data.highRiskNow]) {
    assert.deepEqual(segment.issues.map(issue => issue.iid), [10, 20, 30])
  }
})

test('truncated flags propagate from every issue query to its segment', async () => {
  const { source } = fakeSource({
    issues: () => ({ issues: [], truncated: true }),
  })
  const data = await collect(source)
  assert.equal(data.created.truncated, true)
  assert.equal(data.closed.truncated, true)
  assert.equal(data.overdue.truncated, true)
  assert.equal(data.highRisk.truncated, true)
  assert.equal(data.doing?.truncated, true)
  assert.equal(data.blocked?.truncated, true)
  assert.equal(data.highRiskNow.truncated, true)
})

test('high risk marks truncated when the issue list or any event list was truncated', async () => {
  const truncatedIssues = fakeSource({
    issues: segment => ({
      issues: segment === 'changed' ? [makeIssue({ iid: 1 })] : [],
      truncated: segment === 'changed',
    }),
  })
  const fromIssues = await collect(truncatedIssues.source)
  assert.equal(fromIssues.highRisk.truncated, true)

  const truncatedEvents = fakeSource({
    issues: segment => ({
      issues: segment === 'changed' ? [makeIssue({ iid: 1 }), makeIssue({ iid: 2 })] : [],
      truncated: false,
    }),
    events: iid => ({ events: [], truncated: iid === 2 }),
  })
  const fromEvents = await collect(truncatedEvents.source)
  assert.equal(fromEvents.highRisk.truncated, true)
  assert.equal(fromEvents.created.truncated, false)
})

test('event reads never exceed four concurrent calls and still read every issue', async () => {
  const iids = Array.from({ length: 10 }, (_, index) => index + 1)
  const { source, eventCalls, maxInFlight } = fakeSource({
    issues: segment => ({
      issues: segment === 'changed' ? iids.map(iid => makeIssue({ iid })) : [],
      truncated: false,
    }),
    events: iid => ({
      events: [makeEvent({ id: iid, createdAt: '2026-11-18T08:00:00.000+08:00' })],
      truncated: false,
    }),
  })
  const data = await collect(source)
  assert.equal(maxInFlight(), 4)
  assert.equal(new Set(eventCalls).size, 10)
  assert.equal(data.highRisk.events.length, 10)
  assert.deepEqual(data.highRisk.events.map(event => event.issue.iid), iids)
})

test('a single changed issue still reads events and an empty changed list reads none', async () => {
  const empty = fakeSource()
  const emptyData = await collect(empty.source)
  assert.deepEqual(emptyData.highRisk.events, [])
  assert.equal(empty.eventCalls.length, 0)

  const single = fakeSource({
    issues: segment => ({
      issues: segment === 'changed' ? [makeIssue({ iid: 4 })] : [],
      truncated: false,
    }),
    events: () => ({ events: [], truncated: false }),
  })
  await collect(single.source)
  assert.deepEqual(single.eventCalls, [4])
})
