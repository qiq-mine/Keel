import assert from 'node:assert/strict'
import test from 'node:test'
import { GitLabApi } from '../src/gitlab/api.js'

const baseUrl = process.env.KEEL_GITLAB_TEST_BASE_URL
const groupPath = process.env.KEEL_GITLAB_TEST_GROUP
const token = process.env.KEEL_GITLAB_TEST_TOKEN
const enabled = baseUrl !== undefined && groupPath !== undefined && token !== undefined

test('live gitlab issue round trip', { skip: enabled ? false : 'KEEL_GITLAB_TEST_* is not set' }, async () => {
  const api = new GitLabApi({ baseUrl: baseUrl!, groupPath: groupPath!, token: token! })
  await api.group()
  const projects = await api.projects()
  assert.equal(await api.ensureRiskLabels(true), true)
  const projectId = [...projects.keys()][0]
  assert.ok(projectId !== undefined)
  const created = await fetch(`${baseUrl}/api/v4/projects/${projectId}/issues`, {
    method: 'POST',
    headers: { 'PRIVATE-TOKEN': token!, 'content-type': 'application/json' },
    body: JSON.stringify({ title: `keel-integration-${Date.now()}`, labels: 'keel-keep' }),
  })
  const raw = await created.json() as { iid: number }
  const dated = await api.setDueDate(projectId, raw.iid, '2026-12-01', projects)
  assert.equal(dated.dueDate, '2026-12-01')
  const risk = await api.setRisk(projectId, raw.iid, 'high', projects)
  assert.equal(risk.risk, 'high')
  assert.equal(risk.labels.some(label => label.name === 'keel-keep'), true)
  assert.equal(risk.labels.some(label => label.name === 'risk::low'), false)
  const closed = await api.setState(projectId, raw.iid, 'closed', projects)
  assert.equal(closed.state, 'closed')
  const reopened = await api.setState(projectId, raw.iid, 'opened', projects)
  assert.equal(reopened.state, 'opened')
  const cleared = await api.setRisk(projectId, raw.iid, 'none', projects)
  assert.equal(cleared.labels.some(label => label.name.startsWith('risk::')), false)
  assert.equal(cleared.labels.some(label => label.name === 'keel-keep'), true)
})
