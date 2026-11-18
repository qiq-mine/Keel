import assert from 'node:assert/strict'
import test from 'node:test'
import { loadBoard } from '../src/board/load.js'
import {
  beginSave,
  cardStatus,
  DEFAULT_FILTER,
  droppedIssue,
  failSave,
  finishSave,
  shouldMove,
  toListQuery,
} from '../src/board/model.js'
import type { KeelIssue, KeelListPage, KeelListQuery } from '../src/model.js'

function issue(over: Partial<KeelIssue> = {}): KeelIssue {
  return {
    projectId: 7,
    projectPath: 'acme/app',
    iid: 12,
    title: '修好登录',
    state: 'opened',
    issueType: 'issue',
    confidential: false,
    dueDate: null,
    overdue: false,
    risk: null,
    riskConflict: false,
    status: null,
    statusConflict: false,
    milestoneTitle: null,
    commentCount: 0,
    labels: [],
    assignees: [],
    webUrl: 'https://gitlab.example.com/acme/app/-/issues/12',
    updatedAt: '2026-11-18T00:00:00.000Z',
    ...over,
  }
}

test('default filter omits assignee, labels, and project', () => {
  assert.deepEqual(toListQuery(DEFAULT_FILTER, 'opened', 1), {
    scope: 'opened',
    page: 1,
    perPage: 100,
  })
})

test('selected labels are passed together for an AND query', () => {
  const query = toListQuery({ ...DEFAULT_FILTER, labels: ['bug'], risk: 'high', assigneeId: 'None', projectId: 7 }, 'closed', 2)
  assert.deepEqual(query.labels, ['bug'])
  assert.equal(query.risk, 'high')
  assert.equal(query.assigneeId, 'None')
  assert.equal(query.projectId, 7)
})

test('a field stays saving until the response, then failure restores the confirmed value', () => {
  const original = issue({ dueDate: '2026-11-01' })
  const saving = beginSave([{ issue: original }], '7:12', 'dueDate', '2026-11-20')
  assert.equal(cardStatus(saving[0]!), 'saving')
  assert.equal(saving[0]?.issue.dueDate, '2026-11-01')
  const failed = failSave(saving, '7:12', '无法连接 GitLab')
  assert.equal(failed[0]?.issue.dueDate, '2026-11-01')
  assert.equal(failed[0]?.error?.message, '无法连接 GitLab')
  assert.equal(cardStatus(failed[0]!), 'idle')
  const saved = finishSave(saving, '7:12', issue({ dueDate: '2026-11-20' }))
  assert.equal(saved[0]?.issue.dueDate, '2026-11-20')
  assert.equal(saved[0]?.pending, undefined)
})

test('a risk write keeps the previous overdue flag', () => {
  const original = issue({ overdue: true, risk: null })
  const saving = beginSave([{ issue: original }], '7:12', 'risk', 'high')
  const saved = finishSave(saving, '7:12', issue({ overdue: false, risk: 'high' }))
  assert.equal(saved[0]?.issue.overdue, true)
  assert.equal(saved[0]?.issue.risk, 'high')
})

test('dropping on the same column does not request a move', () => {
  assert.equal(shouldMove('opened', 'opened'), false)
  assert.equal(shouldMove('opened', 'closed'), true)
  const card = { issue: issue() }
  assert.equal(droppedIssue([card], [], '7:12', 'opened'), null)
  assert.equal(droppedIssue([card], [], '7:12', 'closed')?.state, 'opened')
})

test('opened column stops at page 20 and closed column starts at one page', async () => {
  const queries: KeelListQuery[] = []
  const api = {
    async listIssues(query: KeelListQuery): Promise<KeelListPage> {
      queries.push(query)
      return {
        issues: [issue({ iid: query.page, state: query.scope === 'closed' ? 'closed' : 'opened' })],
        page: query.page,
        perPage: query.perPage,
        nextPage: query.page + 1,
        truncated: query.page === 20,
        total: null,
      }
    },
    async columnModes() {
      return { modes: [{ projectId: 7, columnMode: 'state' as const }], truncated: false }
    },
    async summary() {
      return {
        overdue: { count: 0, complete: true },
        dueThisWeek: { count: 0, complete: true },
        highRisk: { count: 0, complete: true },
        unassessed: { count: 0, complete: true },
      }
    },
  }
  const loaded = await loadBoard(api, DEFAULT_FILTER, 1)
  const openedPages = queries.filter(query => query.scope === 'opened' && query.summary !== 'overdue')
  assert.equal(openedPages.length, 20)
  assert.equal(loaded.openedTruncated, true)
  assert.equal(loaded.opened.length, 20)
  const closedPages = queries.filter(query => query.scope === 'closed')
  assert.equal(closedPages.length, 1)
  assert.equal(loaded.closedHasMore, true)
  assert.equal(loaded.overduePartial, true)
})
