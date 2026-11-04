import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'tsdown'
const raw = { name: 'raw', resolveId: (s: string, i?: string) => s.endsWith('?raw') && i ? resolve(dirname(i), s) : undefined,
  load: (id: string) => id.endsWith('?raw') ? { code: `export default ${JSON.stringify(readFileSync(id.slice(0, -4), 'utf8'))}`, moduleType: 'js' as const } : undefined }
const stub = { name: 'nodestub', resolveId: (s: string) => s.startsWith('node:') ? '\0' + s : undefined,
  load: (id: string) => id.startsWith('\0node:') ? { code: readFileSync(resolve(import.meta.dirname, 'nodestub.js'), 'utf8'), moduleType: 'js' as const } : undefined }
export default defineConfig({ entry: { entry: resolve(import.meta.dirname, 'entry.tsx') }, outDir: resolve(import.meta.dirname, 'dist'), format: 'iife', platform: 'browser', dts: false, clean: true, plugins: [stub, raw],
  deps: { alwaysBundle: [/.*/] }, outputOptions: { entryFileNames: 'entry.js' }, define: { 'process.env.NODE_ENV': '"development"' } })
