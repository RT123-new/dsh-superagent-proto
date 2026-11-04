// vite arrives via vitest (not a direct dependency); resolve it portably through vitest's real path so no absolute machine path is baked in.
import { createRequire } from 'node:module'
import { realpathSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
const repoRequire = createRequire(new URL('../../package.json', import.meta.url))
const vitestRequire = createRequire(realpathSync(repoRequire.resolve('vitest')))
const { build } = await import(pathToFileURL(vitestRequire.resolve('vite')))
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
