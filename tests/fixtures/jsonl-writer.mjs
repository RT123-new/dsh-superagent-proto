// Child process for the SIGKILL proofs: writes through the REAL JSONL persistence backend, tells the parent over a marker file, then waits to be killed.
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, SessionSeq } from '@deepseek-ai/dsh-session'
import persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { writeFileSync } from 'node:fs'

const [mode, root, marker, messageJson] = process.argv.slice(2)
const id = SessionId('worker-kill-proof')
const ctx = new Context()
ctx.plugin(SessionStore)
ctx.plugin(persistence, { root, compression: 'zstd' })
for (let i = 0; i < 200 && !ctx.sessionPersistence; i++) await new Promise(resolve => setTimeout(resolve, 25))
const handle = await ctx.sessionPersistence.create({ version: 4, id, createdAt: Date.now(), cwd: root, isSeeded: false })
if (mode !== 'header-only') await handle.append([{ type: 'user/message', seq: SessionSeq(0), time: Date.now(), surfaceOp: 'append', data: JSON.parse(messageJson) }])
if (mode === 'append-flush' || mode === 'header-only') await ctx.sessionPersistence.flush()
writeFileSync(marker, `${mode}:acknowledged`)
setInterval(() => {}, 1000)
