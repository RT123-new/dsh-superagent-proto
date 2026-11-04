/** Final review phase 2.4: a REAL SIGKILL between the attempt-start marker and settlement reconciles to "attempted, outcome unknown". */
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { Effects, ATTEMPT_UNKNOWN } from '../src/app/effects.ts'
import { HealthBoard } from '../src/infra/health.ts'
import { Store } from '../src/app/store.ts'

const child = (dbPath: string) => `
const { Store } = await import(${JSON.stringify(new URL('../src/app/store.ts', import.meta.url).href)});
const { Effects } = await import(${JSON.stringify(new URL('../src/app/effects.ts', import.meta.url).href)});
const { HealthBoard } = await import(${JSON.stringify(new URL('../src/infra/health.ts', import.meta.url).href)});
const store = new Store(${JSON.stringify(dbPath)}, () => {});
const effects = new Effects(store, new HealthBoard());
effects.handle('reply', async () => { console.log('SENDING'); await new Promise(() => {}) }, { markAttempt: true });
store.atomic(() => effects.enqueue('reply', 'm1', {}));
effects.start();
setInterval(() => {}, 1000);
`
it('kill during an in-flight send leaves attempted-unknown after restart, not a never-attempted row', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'outbox-kill-'))
  const dbPath = join(dir, 'o.sqlite')
  try {
    const proc = spawn(process.execPath, ['--experimental-transform-types', '--no-warnings', '--input-type=module', '-e', child(dbPath)], { stdio: ['ignore', 'pipe', 'inherit'] })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('child never started a send')), 20000)
      proc.stdout.on('data', data => { if (String(data).includes('SENDING')) { clearTimeout(timer); resolve() } })
      proc.on('exit', code => reject(new Error(`child exited early (${code})`)))
    })
    proc.removeAllListeners('exit'); proc.kill('SIGKILL'); await new Promise(resolve => proc.on('exit', resolve))
    const store = new Store(dbPath, () => {})
    try {
      const before = store.db.prepare("SELECT attempts, error FROM effect WHERE key = 'm1'").get() as { attempts: number; error: string }
      expect(before).toEqual({ attempts: 0, error: 'attempt-started' })     // durable even though the process died mid-send
      const effects = new Effects(store, new HealthBoard())
      effects.start()                                                       // restart reconciliation
      expect(effects.attemptUnknown('reply', 'm1')).toBe(true)
      const after = store.db.prepare("SELECT error, due FROM effect WHERE key = 'm1'").get() as { error: string; due: number }
      expect(after.error).toBe(ATTEMPT_UNKNOWN)
      expect(after.due).toBeLessThanOrEqual(Date.now())                      // still due: it will be re-sent (duplicate possible), never silently dropped
    } finally { store.close() }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}, 40000)
