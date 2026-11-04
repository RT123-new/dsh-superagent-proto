import { it } from 'vitest'
import { Store } from '../src/app/store.ts'
it('end ticket', () => {
  const s = new Store('/tmp/dshstate2/orchestrator.sqlite')
  for (const t of s.tickets.list()) { s.tickets.save({ ...t, ended: { at: new Date().toISOString(), by: 'person', outcome: 'dropped', reason: 'spike' } as never }); console.log('ENDED', t.id) }
  s.close()
})
