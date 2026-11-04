/** Final review phase 2.4: measured cost of the per-attempt marker UPDATEs on a real file store. Reports, asserts only sanity. */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { Effects } from '../src/app/effects.ts'
import { Store } from '../src/app/store.ts'
import { HealthBoard } from '../src/infra/health.ts'

it('marker overhead per attempt is measured', async () => {
  const run = async (mark: boolean) => {
    const dir = mkdtempSync(join(tmpdir(), 'bench-')); const store = new Store(join(dir, 'o.sqlite'), () => {})
    try {
      const effects = new Effects(store, new HealthBoard()); let done = 0
      effects.handle('reply', async () => { done++ }, { markAttempt: mark })
      const n = 300
      for (let i = 0; i < n; i++) store.atomic(() => effects.enqueue('reply', `k${i}`, {}))
      const t0 = performance.now(); effects.start()
      for (let i = 0; i < 2000 && done < n; i++) await new Promise(r => setTimeout(r, 5))
      await effects.idle('reply')
      return (performance.now() - t0) / n
    } finally { store.close(); rmSync(dir, { recursive: true, force: true }) }
  }
  await run(false)
  const off = await run(false); const on = await run(true)
  console.log(`BENCH ms/attempt off=${off.toFixed(3)} on=${on.toFixed(3)} extra=${(on - off).toFixed(3)}`)
  expect(on).toBeGreaterThan(0)
}, 60000)
