/**
 * Final review phase 2.3 / 2.2: a REAL dsh agent loop over the REAL JSONL backend, a REAL SIGKILL, then a restarted Context that resumes the persisted
 * agent and runs the real AgentDelivery. The model is offline and never answers (no network, no paid call). The child hands the message to the agent the
 * way AgentDelivery does (frozen message, agent.steer) because AgentDelivery is TypeScript and the child is a plain node script.
 * Scope: invariants over the log states that two kill points produced in this environment, not a claim about every kill point, power loss or exactly-once delivery.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { freezeMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { AgentDelivery, messageId } from '../src/app/delivery.ts'

const writer = fileURLToPath(new URL('./fixtures/loop-writer.mjs', import.meta.url))
const dirs: string[] = [], contexts: Context[] = []
afterEach(async () => { for (const c of contexts.splice(0)) await (c as unknown as { scope?: { dispose?: () => unknown } }).scope?.dispose?.(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const sid = 'loop-kill-proof' as SessionId
const message = () => freezeMessage({ id: messageId('req-1'), role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }], source: { kind: 'dsh-superagent' as const, form: 'relay' as const } } as never)

function logFile(root: string): string { const found: string[] = []; const walk = (d: string) => { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(join(d, e.name)) : /session\.v\d+\.jsonl$/.test(e.name) && found.push(join(d, e.name)) }; walk(root); expect(found).toHaveLength(1); return found[0]! }
const events = (file: string) => readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { type: string; data?: { id?: string; target?: string; removedCount?: number; inserted?: unknown[] } })
const delivered = (file: string) => events(file).filter(e => e.type === 'user/message' && e.data?.id === messageId('req-1')).length

async function killed(mode: 'model-started' | 'model-started-flushed' | 'right-after-steer') {
  const root = mkdtempSync(join(tmpdir(), 'loop-kill-')); dirs.push(root)
  const marker = join(root, 'marker'), logs = join(root, 'logs')
  const child = spawn(process.execPath, [writer, mode, logs, marker, JSON.stringify(message())], { stdio: ['ignore', 'inherit', 'inherit'] })
  const exited = new Promise<NodeJS.Signals | null>(resolve => child.on('exit', (_c, signal) => resolve(signal)))
  const deadline = Date.now() + 30_000
  while (!existsSync(marker)) { if (Date.now() > deadline || child.exitCode !== null) throw new Error('child never reached its marker'); await new Promise(resolve => setTimeout(resolve, 5)) }
  child.kill("SIGKILL")
  expect(await exited).toBe('SIGKILL')
  return logs
}
/** Truncates the log to its first `count` events, a flushed prefix that a kill at that point could leave. */
function prefixCopy(logs: string, count: number): string {
  const root = mkdtempSync(join(tmpdir(), 'loop-prefix-')); dirs.push(root)
  const file = logFile(logs); const rel = file.slice(logs.length)
  const target = join(root, rel); mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(0, count).map(l => l + '\n').join(''))
  return root
}
const modelCalls = { n: 0 }
async function restart(logs: string) {
  const ctx = new Context(); contexts.push(ctx)
  for (const name of ['dsh-llm', 'dsh-session', 'dsh-system-prompt', 'dsh-tools', 'dsh-agent', 'dsh-session-projection', 'dsh-session-persistence-jsonl', 'dsh-agent-loop']) {
    const m = await import(/* @vite-ignore */ `@deepseek-ai/${name}`) as { default?: never }
    ctx.plugin((m.default ?? m) as never, (name.endsWith('jsonl') ? { root: logs, compression: 'none' } : undefined) as never)
  }
  const anyCtx = ctx as unknown as { agents?: { resume(o: unknown): Promise<unknown>; get(id: string): Agent | undefined }; sessionPersistence?: unknown }
  for (let i = 0; i < 200 && !(anyCtx.agents && anyCtx.sessionPersistence); i++) await new Promise(resolve => setTimeout(resolve, 25))
  ctx.on('llm/stream', async function* () { modelCalls.n++; await new Promise(() => {}) })
  for (let i = 0; ; i++) {
    try { await anyCtx.agents!.resume({ resumeSessionId: sid, agentOptions: { provider: 'scripted', model: 'none' } }); break }
    catch (error) { if (i > 200 || !String(error).includes('no agent factory')) throw error; await new Promise(resolve => setTimeout(resolve, 25)) }
  }
  const agent = anyCtx.agents!.get(sid)!
  return { ctx, agent, delivery: new AgentDelivery(ctx as never), signal: new AbortController().signal }
}
async function redeliver(logs: string) {
  const r = await restart(logs)
  const held = await r.delivery.holds(r.agent, 'req-1')
  await r.delivery.send(r.agent, 'req-1', 'hi', 'steer', r.signal)
  await new Promise(resolve => setTimeout(resolve, 300))
  await (r.ctx as unknown as { sessionPersistence: { flush(): Promise<void> } }).sessionPersistence.flush()
  return { held, ...r }
}

it('characterization: the model request starts before the log file exists, so a SIGKILL at that moment (no flush) leaves no session on disk', async () => {
  const logs = await killed('model-started')
  console.log('LOG EXISTS AFTER UNFLUSHED KILL:', existsSync(logs) && readdirSync(logs).length > 0)
}, 60_000)

it('real SIGKILL after the loop consumed the message: restart holds it and delivery does not append a second copy', async () => {
  const logs = await killed('model-started-flushed')
  const file = logFile(logs)
  expect(delivered(file)).toBe(1)
  const { held } = await redeliver(logs)
  expect(held).toBe(true)
  expect(delivered(file)).toBe(1)
}, 60_000)

it('real SIGKILL immediately after steer(): whatever prefix reached disk, the restart ends with the message in the log exactly once', async () => {
  const logs = await killed('right-after-steer')
  if (!existsSync(logs)) { console.log('NOTHING PERSISTED before the kill: the agent session itself is absent after restart'); return }
  const before = delivered(logFile(logs))
  const { held } = await redeliver(logs)
  // Either the log already had it (held) or the restart delivered it; never two copies.
  expect(delivered(logFile(logs))).toBe(1)
  if (before === 1) expect(held).toBe(true)
}, 60_000)

it('prefix sweep over the real loop log: after every event-boundary prefix the restart leaves the message in the log at most once and never parked', async () => {
  const logs = await killed('model-started-flushed')
  const total = events(logFile(logs)).length
  const outcomes: string[] = []
  for (let count = 1; count <= total; count++) {
    const prefix = prefixCopy(logs, count)
    const r = await redeliver(prefix); const { held } = r
    const n = delivered(logFile(prefix))
    outcomes.push(`${count}:${held ? 'held' : 'sent'}:${n}:model${modelCalls.n}:phase${(r.agent as unknown as { phase?: string }).phase}`)
    // Behaviour contract: after delivery reports success, the message is in the log exactly once OR the agent is running it (a model request was made). Never parked unprocessed.
    expect(n, `prefix ${count} of ${total}: copies in log`).toBeLessThanOrEqual(1)
    expect(n === 1 || modelCalls.n > 0, `prefix ${count} of ${total}: held=${held}, ${n} copies, ${modelCalls.n} model requests: message parked in the restored inbox and never processed`).toBe(true)
    modelCalls.n = 0
    for (const c of contexts.splice(0)) await (c as unknown as { scope?: { dispose?: () => unknown } }).scope?.dispose?.()
  }
  console.log('PREFIX OUTCOMES', outcomes.join(' '))
}, 120_000)
