import assert from 'node:assert/strict'
import test from 'node:test'
import { preExecuteDecision } from '../src/tools.js'

test('write tools ask and other tools continue, without calling GitLab', () => {
  let continued = false
  const ask = preExecuteDecision({
    name: 'keel_set_risk',
    arguments: { projectId: 7, iid: 12, risk: 'high' },
  })
  assert.equal(ask.kind, 'ask')
  if (ask.kind === 'ask') {
    assert.match(ask.reason, /keel_set_risk/)
    assert.match(ask.reason, /7/)
    assert.match(ask.reason, /12/)
    assert.match(ask.reason, /high/)
    assert.match(ask.displayReason.zh, /风险设为高/)
    assert.match(ask.displayReason.en, /set risk to high/)
    assert.equal(ask.reason.includes('super-secret-token'), false)
  }
  const read = preExecuteDecision({ name: 'keel_list_overdue', arguments: {} })
  assert.equal(read.kind, 'next')
  if (read.kind === 'next') continued = true
  assert.equal(continued, true)
})

test('clearing a due date is described as a clear', () => {
  const ask = preExecuteDecision({
    name: 'keel_set_due_date',
    arguments: { projectId: 7, iid: 12, dueDate: '' },
  })
  assert.equal(ask.kind, 'ask')
  if (ask.kind === 'ask') assert.match(ask.displayReason.zh, /清除/)
})
