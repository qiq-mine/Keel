import assert from 'node:assert/strict'
import test from 'node:test'
import { dueDateUpdate, parseRisk, riskUpdate, stateUpdate } from '../src/risk.js'

test('parses missing, single, conflicting, and unknown risk labels', () => {
  assert.deepEqual(parseRisk([]), { risk: null, riskConflict: false, unrecognized: false })
  assert.deepEqual(parseRisk([{ name: 'risk::low' }, { name: 'bug' }]), {
    risk: 'low', riskConflict: false, unrecognized: false,
  })
  assert.deepEqual(parseRisk([{ name: 'risk::low' }, { name: 'risk::high' }]), {
    risk: 'high', riskConflict: true, unrecognized: false,
  })
  assert.deepEqual(parseRisk([{ name: 'risk::critical' }]), {
    risk: null, riskConflict: false, unrecognized: true,
  })
})

test('risk PUT adds the target and removes the other two, and none only removes', () => {
  const high = riskUpdate(['bug'], 'high')
  assert.deepEqual(high, { add_labels: 'risk::high', remove_labels: 'risk::medium,risk::low' })
  assert.equal(high === null || !('labels' in high), true)
  const none = riskUpdate(['risk::high', 'bug'], 'none')
  assert.deepEqual(none, { remove_labels: 'risk::high,risk::medium,risk::low' })
  assert.equal(none === null || !('add_labels' in none) && !('labels' in none), true)
  assert.equal(riskUpdate(['risk::low', 'bug'], 'low'), null)
})

test('clearing a due date sends an empty string and a matching value sends nothing', () => {
  assert.deepEqual(dueDateUpdate('2026-11-18', ''), { due_date: '' })
  assert.equal(dueDateUpdate(null, ''), null)
  assert.equal(dueDateUpdate('2026-11-18', '2026-11-18'), null)
})

test('state_event is only close or reopen', () => {
  assert.deepEqual(stateUpdate('opened', 'closed'), { state_event: 'close' })
  assert.deepEqual(stateUpdate('closed', 'opened'), { state_event: 'reopen' })
  assert.equal(stateUpdate('opened', 'opened'), null)
})
