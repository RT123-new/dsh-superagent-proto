/** Final review phase 2.1: directory-sync failure handling and real SIGKILL of a record writer. */
import { spawn } from 'node:child_process'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const failing = vi.hoisted(() => ({ code: '' }))
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return { ...actual, open: async (path: string, flags?: string) => {
    if (failing.code && flags === 'r' && String(path).endsWith('workspaces')) throw Object.assign(new Error(`injected ${failing.code}`), { code: failing.code })
    return actual.open(path, flags as never)
  } }
})
import { inspectPreparation, writePreparation } from '../src/executor/workspace.ts'

const record = { state: 'prepared' as const, identity: 'i', directory: '/w', at: 'now' }
describe('review phase 2.1: record durability', () => {
  it('a real directory-sync failure (EIO) throws and leaves no standing prepared record', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prep-'))
    failing.code = 'EIO'
    try {
      await expect(writePreparation(dir, 'w', record)).rejects.toThrow('injected EIO')
      const seen = await inspectPreparation(dir, 'w')
      expect(seen.kind === 'record' && seen.record.state).toBe('failed')
    } finally { failing.code = ''; rmSync(dir, { recursive: true, force: true }) }
  })
  it('an unsupported directory sync (EINVAL) is tolerated and the record stands', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prep-'))
    failing.code = 'EINVAL'
    try {
      await writePreparation(dir, 'w', record)
      const seen = await inspectPreparation(dir, 'w')
      expect(seen.kind === 'record' && seen.record.state).toBe('prepared')
    } finally { failing.code = ''; rmSync(dir, { recursive: true, force: true }) }
  })
  it('SIGKILL of a process rewriting the record never leaves a corrupt authoritative record', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prep-'))
    try {
      await writePreparation(dir, 'w', record)
      for (let round = 0; round < 8; round++) {
        const child = spawn(process.execPath, ['--experimental-strip-types', '--no-warnings', '-e',
          `const {writePreparation}=await import(${JSON.stringify(new URL('../src/executor/workspace.ts', import.meta.url).href)});
           for(let i=0;;i++){await writePreparation(${JSON.stringify(dir)},'w',{state:i%2?'prepared':'preparing',identity:'i',directory:'/w',at:String(i)})}`],
          { stdio: 'ignore' })
        await new Promise(resolve => setTimeout(resolve, 150 + round * 17))
        child.kill('SIGKILL'); await new Promise(resolve => child.on('exit', resolve))
        expect((await inspectPreparation(dir, 'w')).kind).toBe('record')
      }
      // Leftover temporary files are tolerated debris, never read as records.
      expect(readdirSync(join(dir, 'workspaces')).filter(file => file === 'w.json')).toHaveLength(1)
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }, 30000)
})
