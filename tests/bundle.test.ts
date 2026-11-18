import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

test('the built client registers as keel and stays on platform seeds', () => {
  assert.equal(existsSync('lib/client.js'), true, 'run npm run build before this test')
  const source = readFileSync('lib/client.js', 'utf8')
  assert.match(source, /window\.__ModuleLoader__\.load\(\{ id: "keel", factory: \(require\) => \{/)
  const requires = [...source.matchAll(/require\("([^"]+)"\)/g)].map(match => match[1])
  const allowed = new Set(['react', 'react/jsx-runtime', 'react-dom', 'zod'])
  assert.deepEqual([...new Set(requires)].filter(id => !allowed.has(id)), [])
  assert.equal(source.includes('super-secret-token'), false)
})
