import assert from 'node:assert/strict'
import test from 'node:test'
import { createIssueBody, issueParams, summaryQuery } from '../src/board/query.js'
import { renderIssueMarkdown } from '../src/board/markdown.js'
import { assigneeInitials } from '../src/board/people.js'
import { createDebounce, shortcutAction } from '../src/board/shortcuts.js'
import { columnModeOf, parseStatus, statusUpdate } from '../src/status.js'
import { gitlabConnectOptions, wecomConnectOptions } from '../src/tls.js'
import { normalizeWecomCorpId, normalizeWecomLocator } from '../src/config.js'

test('status labels pick done over the others and mark a conflict', () => {
  assert.equal(parseStatus([]).status, null)
  assert.equal(parseStatus([{ name: 'status::doing' }]).status, 'doing')
  const conflict = parseStatus([{ name: 'status::todo' }, { name: 'status::done' }])
  assert.equal(conflict.status, 'done')
  assert.equal(conflict.statusConflict, true)
  assert.equal(parseStatus([{ name: 'status::custom' }]).unrecognized, true)
})

test('status PUT does not send labels or state_event', () => {
  const body = statusUpdate(['bug'], 'doing')
  assert.deepEqual(body, { add_labels: 'status::doing', remove_labels: 'status::done,status::blocked,status::todo' })
  assert.equal(body !== null && !('labels' in body) && !('state_event' in body), true)
  assert.deepEqual(statusUpdate(['status::todo'], 'none'), {
    remove_labels: 'status::done,status::blocked,status::doing,status::todo',
  })
})

test('column mode is state only when every status query is empty', () => {
  assert.equal(columnModeOf({ todo: 0, doing: 0, blocked: 0, done: 0 }), 'state')
  assert.equal(columnModeOf({ todo: 0, doing: 1, blocked: 0, done: 0 }), 'status')
})

test('summary counts do not carry risk or label filters, and due this week is due_date=week', () => {
  const base = summaryQuery({
    scope: 'all',
    labels: ['bug'],
    risk: 'low',
    search: '登录',
    assigneeId: 3,
    page: 4,
    perPage: 20,
  }, 'due_this_week')
  assert.equal(base.labels, undefined)
  assert.equal(base.risk, undefined)
  assert.equal(base.summary, 'due_this_week')
  const params = issueParams(base)
  assert.equal(params.due_date, 'week')
  assert.equal(params.labels, undefined)
  assert.equal(params.search, '登录')
  const unassessed = issueParams(summaryQuery({ scope: 'opened', page: 1, perPage: 1 }, 'unassessed'))
  assert.equal(unassessed['not[labels]'], 'risk::low,risk::medium,risk::high')
})

test('create issue omits empty status and risk labels', () => {
  assert.deepEqual(createIssueBody({ title: '登录失败' }), { title: '登录失败' })
  assert.deepEqual(createIssueBody({ title: '登录失败', assigneeId: 3, status: 'todo', risk: 'high', dueDate: '2026-11-20' }), {
    title: '登录失败',
    assignee_ids: [3],
    due_date: '2026-11-20',
    labels: 'status::todo,risk::high',
  })
})

test('gitlab images become links and data images do not render', () => {
  const html = renderIssueMarkdown('看 ![图](/uploads/a.png) 和 ![外](https://cdn.example/a.png) ![内联](data:image/png;base64,aaaa)', 'https://gitlab.example.com')
  assert.match(html, /在 GitLab 中打开/)
  assert.equal(html.includes('<img'), true)
  assert.equal(html.includes('src="https://gitlab.example.com/uploads/a.png"'), false)
  assert.equal(html.includes('data:image'), false)
  assert.match(html, /src="https:\/\/cdn\.example\/a\.png"/)
})

test('search changes inside 300ms collapse to one query', () => {
  const queued: (() => void)[] = []
  const debounce = createDebounce(300, (fn) => {
    queued.push(fn)
    return () => { const index = queued.indexOf(fn); if (index >= 0) queued.splice(index, 1) }
  })
  let runs = 0
  debounce(() => { runs += 1 })
  debounce(() => { runs += 1 })
  debounce(() => { runs += 1 })
  assert.equal(queued.length, 1)
  queued[0]?.()
  assert.equal(runs, 1)
})

test('shortcuts do not fire while typing, except escape', () => {
  assert.deepEqual(shortcutAction('c', { typing: true, helpOpen: false, drawer: 'none', hasCard: true }), { type: 'ignore' })
  assert.deepEqual(shortcutAction('Escape', { typing: true, helpOpen: false, drawer: 'none', hasCard: true }), { type: 'escape' })
  assert.deepEqual(shortcutAction('1', { typing: false, helpOpen: false, drawer: 'create', hasCard: true }), { type: 'ignore' })
  assert.deepEqual(shortcutAction('1', { typing: false, helpOpen: false, drawer: 'issue', hasCard: false }), { type: 'status', status: 'todo' })
})

test('assignee initials prefer the first Han character', () => {
  assert.equal(assigneeInitials('张三', 'zhang'), '张')
  assert.equal(assigneeInitials('Ada Lovelace', 'ada'), 'AL')
  assert.equal(assigneeInitials('', 'ada'), 'ad')
})

test('allowSelfSigned stays off the WeCom client', () => {
  assert.equal(gitlabConnectOptions(false).rejectUnauthorized, true)
  assert.equal(gitlabConnectOptions(true).rejectUnauthorized, false)
  assert.equal(typeof gitlabConnectOptions(true).checkServerIdentity, 'function')
  assert.equal(wecomConnectOptions().rejectUnauthorized, true)
  assert.equal('checkServerIdentity' in wecomConnectOptions(), false)
})

test('wecom config fields reject blank secrets and oversized ids', () => {
  assert.equal(normalizeWecomCorpId('ww-1'), 'ww-1')
  assert.throws(() => normalizeWecomCorpId('has space'), /输入不符合约定格式/)
  assert.equal(normalizeWecomLocator(''), '')
  assert.throws(() => normalizeWecomLocator('x'.repeat(129)), /输入不符合约定格式/)
})
