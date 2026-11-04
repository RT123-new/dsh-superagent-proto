import { spawn } from 'node:child_process'
import { expect, it } from 'vitest'
import { currentOwner, foreignOwnerMayBeLive } from '../src/executor/workspace.ts'
const rec = (owner: any) => ({ state: 'preparing', identity: 'x', directory: '/d', at: 'n', owner }) as any
it('record left by a previous incarnation that had the SAME pid+host (container restart, pid reuse) is blocked', () => {
  // simulate: previous process wrote currentOwner(); restarted container gets same pid and hostname
  // Same pid and host, different process incarnation: only the nonce differs. (currentOwner() itself is this process.)
  expect(foreignOwnerMayBeLive(rec({ ...currentOwner(), nonce: 'previous-incarnation' }))).toBe(true)
  expect(foreignOwnerMayBeLive(rec({ pid: process.pid, host: currentOwner().host }))).toBe(true)
  expect(foreignOwnerMayBeLive(rec(currentOwner()))).toBe(false)
})
it('dead parent with live descendant is blocked', async () => {
  const p = spawn('sh', ['-c', 'sleep 30 & echo $!; echo $$; exit 0'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] })
  let out = ''; p.stdout.on('data', d => out += d)
  await new Promise(r => p.on('exit', r)); await new Promise(r => setTimeout(r, 100))
  const [child, parent] = out.trim().split('\n').map(Number) as [number, number]
  let alive = true; try { process.kill(child, 0) } catch { alive = false }
  const verdict = foreignOwnerMayBeLive(rec({ pid: parent, host: currentOwner().host }))
  try { process.kill(child, 'SIGKILL') } catch {}
  expect(alive).toBe(true)
  expect(verdict).toBe(true)
})
