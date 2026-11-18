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
