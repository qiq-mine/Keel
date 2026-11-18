import assert from 'node:assert/strict'
import test from 'node:test'
import issue from './fixtures/issue.json' with { type: 'json' }
import { mapIssue } from '../src/gitlab/map.js'

test('projects a GitLab issue and ignores milestone', () => {
  const mapped = mapIssue(issue, { get: () => 'acme/app' }, true)
  assert.deepEqual(mapped, {
    projectId: 7,
    projectPath: 'acme/app',
    iid: 12,
    title: '修好登录',
    state: 'opened',
    status: null,
    statusConflict: false,
    issueType: 'issue',
    confidential: false,
    dueDate: '2026-11-20',
    overdue: true,
    risk: 'high',
    riskConflict: false,
    milestoneTitle: 'ignored',
    commentCount: 0,
    labels: [
      { name: 'risk::high', color: '#CF222E' },
      { name: 'bug', color: '#0969da' },
    ],
    assignees: [{ id: 3, username: 'ada', name: 'Ada Lovelace' }],
    webUrl: 'https://gitlab.example.com/acme/app/-/issues/12',
    updatedAt: '2026-11-18T00:00:00.000Z',
  })
  assert.equal('milestone' in mapped, false)
})

test('uses references.full when the project is missing from the allow set', () => {
  const mapped = mapIssue(issue, { get: () => undefined }, false)
  assert.equal(mapped.projectPath, 'acme/app')
  assert.equal(mapped.overdue, false)
})

test('a closed issue is never overdue', () => {
  const mapped = mapIssue({ ...issue, state: 'closed' }, { get: () => 'acme/app' }, true)
  assert.equal(mapped.overdue, false)
})
