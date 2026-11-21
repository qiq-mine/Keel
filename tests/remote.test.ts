import assert from 'node:assert/strict'
import test from 'node:test'
import { TYPERT_REMOTE } from '../src/remote.js'

test('the remote contribution exposes the board methods with strict codecs', () => {
  assert.equal(TYPERT_REMOTE.package, 'keel')
  const names = TYPERT_REMOTE.descriptors.map(descriptor => descriptor.method).sort()
  assert.deepEqual(names, [
    'analyzeIssue',
    'clearToken',
    'clearWecomSecret',
    'columnModes',
    'connection',
    'createIssue',
    'getIssue',
    'listIssues',
    'listLabels',
    'listMembers',
    'listNotes',
    'listProjects',
    'reportStart',
    'reportStatus',
    'setDueDate',
    'setRisk',
    'setState',
    'setStatus',
    'setToken',
    'setWecomSecret',
    'summary',
  ])
  for (const descriptor of TYPERT_REMOTE.descriptors) {
    assert.equal(descriptor.result.mode, 'strict')
    if (descriptor.result.mode === 'strict') assert.equal(typeof descriptor.result.create, 'function')
    for (const parameter of descriptor.parameters) {
      assert.equal(parameter.codec.mode, 'strict')
    }
    assert.equal(descriptor.cancellation?.parameter, 'signal')
  }
})

test('reportStatus schema validates valid status and rejects invalid state', () => {
  const descriptor = TYPERT_REMOTE.descriptors.find(d => d.method === 'reportStatus')
  assert.ok(descriptor)
  assert.equal(descriptor.result.mode, 'strict')
  if (descriptor.result.mode !== 'strict') throw new Error('expected strict')
  const schema = descriptor.result.create()

  const counts = {
    created: 1,
    closed: 0,
    overdue: 0,
    highRiskEvents: 0,
    doing: null,
    blocked: null,
    highRiskNow: 0,
  }

  const sample = {
    state: 'done',
    progress: { done: 1, total: 1 },
    preview: {
      asOf: '2026-11-20T10:00:00.000+08:00',
      weekTitle: '周报 2026-11-20',
      windowStart: '2026-11-14T00:00:00.000+08:00',
      windowEnd: '2026-11-20T10:00:00.000+08:00',
      generatedAt: '2026-11-20T10:00:00.000+08:00',
      monthlyDue: false,
      monthlyTitle: null,
      projects: [
        {
          projectId: 1,
          projectPath: 'group/repo',
          text: 'preview text',
          counts,
          truncated: false,
        },
      ],
      failed: [],
    },
    result: {
      kind: 'manual',
      weekTitle: '周报 2026-11-20',
      finishedAt: '2026-11-20T10:05:00.000+08:00',
      message: null,
      projects: [
        {
          projectId: 1,
          projectPath: 'group/repo',
          weekly: 'written',
          monthly: 'not-due',
          message: null,
          docUrl: 'https://doc.weixin.qq.com/doc/abc',
          counts,
        },
      ],
    },
    message: null,
  }

  assert.doesNotThrow(() => schema.parse(sample))
  const parsed = schema.parse(sample)
  assert.ok(parsed && typeof parsed === 'object' && 'state' in parsed && parsed.state === 'done')
  assert.throws(() => schema.parse({ ...sample, state: 'bogus' }))
})
