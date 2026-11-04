import { build } from '/home/sandbox/superagent/head/node_modules/.pnpm/vite@8.2.2_@types+node@22.20.0_esbuild@0.28.2_tsx@4.23.15_yaml@2.9.1/node_modules/vite/dist/node/index.js'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const here = dirname(fileURLToPath(import.meta.url))
const shim = resolve(here, 'node-shims.mjs')
const mods = ['node:util', 'node:child_process', 'node:crypto', 'node:fs', 'node:fs/promises', 'node:path', 'node:os', 'node:url']
await build({
  root: here,
  logLevel: 'warn',
  resolve: { alias: [
    { find: 'vitest', replacement: resolve(here, 'vitest-shim.mjs') },
    ...mods.map(m => ({ find: new RegExp('^' + m.replace(/[\/:]/g, '\\$&') + '$'), replacement: shim })),
  ] },
  build: { outDir: resolve(here, 'dist'), emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 8000 },
})
console.log('harness build ok')
