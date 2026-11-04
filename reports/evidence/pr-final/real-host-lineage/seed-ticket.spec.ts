import { cpSync, mkdirSync, rmSync, readdirSync } from 'node:fs'
import { it } from 'vitest'
import { feishu, startRuntime } from './fixtures/host.ts'
it('seed', async () => {
  const h = await startRuntime()
  const one = await h.acceptedTicket(feishu('1', '@bot 修一'))
  console.log('TICKET', one.ticket.id, one.sessionId, JSON.stringify(h.runtime.store.tickets.get(one.ticket.id)!.assignments.map(a => a.state)))
  const st = h.runtime.store.settings(); h.runtime.store.saveSettings({ ...st, sources: { github: { enabled: true, config: { repository: 'acme/widgets', cli: '/tmp/shim/gh' } }, feishu: { enabled: true, config: { cli: '/tmp/shim/lark', chats: [{ chatId: 'oc_team', listen: 'all' }], directMessages: true } } } as never })
  await h.runtime.stop()
  rmSync('/tmp/dshstate2', { recursive: true, force: true }); mkdirSync('/tmp/dshstate2', { recursive: true })
  for (const f of readdirSync(h.directory)) if (f.startsWith('orchestrator.sqlite')) cpSync(`${h.directory}/${f}`, `/tmp/dshstate2/${f}`)
  console.log('COPIED', readdirSync('/tmp/dshstate2').join(','))
})
