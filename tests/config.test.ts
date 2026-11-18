import assert from 'node:assert/strict'
import test from 'node:test'
import { Config, normalizeBaseUrl, normalizeGroupPath, normalizeTokenRef } from '../src/config.js'

test('accepts an origin and strips one trailing slash', () => {
  assert.equal(normalizeBaseUrl('https://gitlab.example.com/'), 'https://gitlab.example.com')
  assert.equal(normalizeBaseUrl(''), '')
})

test('rejects baseUrl values that are not a bare origin', () => {
  for (const value of [
    'https://user:secret@gitlab.example.com',
    'https://gitlab.example.com/group',
    'https://gitlab.example.com?token=secret',
    'https://gitlab.example.com#frag',
    'ftp://gitlab.example.com',
    'gitlab.example.com',
  ]) {
    assert.throws(() => normalizeBaseUrl(value), /输入不符合约定格式/)
  }
})

test('accepts a group path and rejects a full URL or slashes', () => {
  assert.equal(normalizeGroupPath('acme/platform'), 'acme/platform')
  assert.equal(normalizeGroupPath(''), '')
  assert.throws(() => normalizeGroupPath('https://gitlab.example.com/acme'), /输入不符合约定格式/)
  assert.throws(() => normalizeGroupPath('/acme/platform'), /输入不符合约定格式/)
  assert.throws(() => normalizeGroupPath('acme/platform/'), /输入不符合约定格式/)
})

test('token ref is an environment-variable name and empty is rejected', () => {
  assert.equal(normalizeTokenRef('KEEL_GITLAB_TOKEN'), 'KEEL_GITLAB_TOKEN')
  assert.throws(() => normalizeTokenRef(''), /输入不符合约定格式/)
  assert.throws(() => normalizeTokenRef('1TOKEN'), /输入不符合约定格式/)
  assert.throws(() => normalizeTokenRef('KEEL-TOKEN'), /输入不符合约定格式/)
})

test('schema defaults and rejects a URL that carries a user', async () => {
  const parsed = await Config['~standard'].validate({})
  assert.equal('issues' in parsed, false)
  if ('value' in parsed) {
    const value = parsed.value as { baseUrl: { get(): string }, tokenRef: { get(): string } }
    assert.equal(value.baseUrl.get(), '')
    assert.equal(value.tokenRef.get(), 'KEEL_GITLAB_TOKEN')
  }
  assert.throws(
    () => { void Config['~standard'].validate({ baseUrl: 'https://user:pw@gitlab.example.com' }) },
    /输入不符合约定格式/,
  )
})
