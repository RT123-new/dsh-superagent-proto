/**
 * Final review phase 2.3: delivery idempotency against the REAL JSONL persistence backend and a REAL SIGKILL of the writing process.
 * The writer is a separate OS process using the shipped backend (pinned devDependency); the restart is a fresh Context reading the same files.
 * Scope: the log's durability across process death and the delivery history check over it. The agent loop that appends a consumed message
 * is not installed here, so the "message consumed by the agent" step is written directly through the backend handle.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { freezeMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import persistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, truncateSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, expect, it } from 'vitest'
import { AgentDelivery, messageId } from '../src/app/delivery.ts'

const writer = fileURLToPath(new URL('./fixtures/jsonl-writer.mjs', import.meta.url))
const dirs: string[] = [], contexts: Context[] = []
afterEach(async () => { for (const c of contexts.splice(0)) await (c as unknown as { scope?: { dispose?: () => unknown } }).scope?.dispose?.(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })
const id = SessionId('worker-kill-proof')
const message = () => freezeMessage({ id: messageId('req-1'), role: 'user' as const, content: [{ type: 'text' as const, text: 'hi' }], source: { kind: 'dsh-superagent' as const, form: 'relay' as const } } as never)

/** Runs the writer, waits for its acknowledgement marker, then SIGKILLs it and waits for it to be gone. */
async function killedWriter(mode: 'append-flush' | 'append-noflush' | 'header-only') {
  const root = mkdtempSync(join(tmpdir(), 'jsonl-kill-')); dirs.push(root)
  const marker = join(root, 'marker')
  const child = spawn(process.execPath, [writer, mode, join(root, 'logs'), marker, JSON.stringify(message())], { stdio: ['ignore', 'inherit', 'inherit'] })
  const exited = new Promise<NodeJS.Signals | null>(resolve => child.on('exit', (_code, signal) => resolve(signal)))
  const deadline = Date.now() + 20_000
  while (!existsSync(marker)) { if (Date.now() > deadline || child.exitCode !== null) throw new Error('writer never acknowledged'); await new Promise(resolve => setTimeout(resolve, 20)) }
  child.kill('SIGKILL')
  expect(await exited).toBe('SIGKILL')
  return join(root, 'logs')
}
/** A fresh process incarnation: new Context, the same files. The agent is the delivery-facing part only. */
async function restart(logs: string) {
  const ctx = new Context(); contexts.push(ctx)
  ctx.plugin(SessionStore); ctx.plugin(persistence, { root: logs, compression: 'zstd' })
  for (let i = 0; i < 200 && !(ctx as unknown as { sessionPersistence?: unknown }).sessionPersistence; i++) await new Promise(resolve => setTimeout(resolve, 25))
  const calls = { steer: 0, followup: 0 }
  const inbox = { nextTurn: [] as unknown[], nextStep: [] as unknown[] }
  const agent = { id, session: {}, inbox, steer: (m: unknown) => { calls.steer++; inbox.nextStep.push(m) }, followup: (m: unknown) => { calls.followup++; inbox.nextTurn.push(m) }, inject: () => {} } as unknown as Agent
  const agents = new Map([[id, agent]]); ctx.reflect.provide('agents', agents)
  const delivery = new AgentDelivery(ctx as never)
  return { ctx, delivery, agent, calls, signal: new AbortController().signal }
}

it('a message appended and flushed by a SIGKILLed process is held after restart and is not delivered again', async () => {
  const logs = await killedWriter('append-flush')
  const { delivery, agent, calls, signal } = await restart(logs)
  expect(await delivery.holds(agent, 'req-1')).toBe(true)
  await delivery.send(agent, 'req-1', '{}', 'steer', signal)
  expect(calls).toEqual({ steer: 0, followup: 0 })
}, 40000)

it('characterization: a message appended but never explicitly flushed is also in the log after SIGKILL on this backend (the seam only promises it after flush)', async () => {
  const logs = await killedWriter('append-noflush')
  const { delivery, agent } = await restart(logs)
  expect(await delivery.holds(agent, 'req-1')).toBe(true)
}, 40000)

it('a message that was only in an agent inbox (never appended) is not in the log after SIGKILL, so the restart delivers it exactly once more', async () => {
  const logs = await killedWriter('header-only')
  const { delivery, agent, calls, signal } = await restart(logs)
  expect(await delivery.holds(agent, 'req-1')).toBe(false)
  await delivery.send(agent, 'req-1', '{}', 'steer', signal)
  await delivery.send(agent, 'req-1', '{}', 'steer', signal)       // a retry while it sits in the inbox does not duplicate
  expect(calls).toEqual({ steer: 1, followup: 0 })
}, 40000)

it('characterization (one simulated case): after SIGKILL and a 5-byte truncation of the log file, the stored message is no longer readable and delivery repeats it (at-least-once)', async () => {
  const logs = await killedWriter('append-flush')
  const files = (readdirSync(logs, { recursive: true }) as string[]).map(name => join(logs, name)).filter(file => /\.jsonl/.test(file) && statSync(file).isFile())
  expect(files).toHaveLength(1)
  truncateSync(files[0]!, statSync(files[0]!).size - 5)          // SIMULATED damage after the kill, not a kill that landed mid-write
  const { ctx, delivery, agent, calls, signal } = await restart(logs)
  const snap = await (ctx as unknown as { sessionPersistence: { stat: (id: unknown) => Promise<unknown> } }).sessionPersistence.stat(id).catch((error: unknown) => ({ error: String(error) }))
  expect(snap).toMatchObject({ header: { id }, formatStatus: 'current' })   // observed: the session header is still readable; whether the event frame or more was dropped is not established
  expect(await delivery.holds(agent, 'req-1')).toBe(false)       // the log no longer yields the message; which part of the file recovery dropped is NOT established here
  await delivery.send(agent, 'req-1', '{}', 'steer', signal)
  expect(calls).toEqual({ steer: 1, followup: 0 })               // the producer redelivers a message the log had held; this one size, file and run only
}, 40000)
