import { build } from 'esbuild'
import { readFileSync } from 'node:fs'

const platform = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  legalComments: 'none',
  external: [...platform],
  banner: {
    js: 'window.__ModuleLoader__.load({ id: "keel", factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;',
  },
  footer: {
    js: 'return module.exports; } });',
  },
})

const source = readFileSync('lib/client.js', 'utf8')
if (!source.includes('window.__ModuleLoader__.load({ id: "keel", factory: (require) => {')) {
  throw new Error('client bundle is missing the keel module-loader registration')
}
const requires = [...source.matchAll(/require\("([^"]+)"\)/g)].map(match => match[1])
const unexpected = [...new Set(requires)].filter(id => !platform.has(id))
if (unexpected.length > 0) {
  throw new Error(`client bundle requires modules outside the DSH platform seeds: ${unexpected.join(', ')}`)
}
