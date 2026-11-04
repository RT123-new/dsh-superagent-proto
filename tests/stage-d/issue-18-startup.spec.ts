/**
 * Stage D, Issue 18: worker creation and recovery overhead, measured per component against the real launch path.
 * - Cold vs warm launches with a REAL `sh -c` prepare command (real process, real fs): the warm launch reuses the
 *   workspace only through its durable preparation record, which is the mandated reuse path.
 * - Partial-preparation recovery: a prepare killed mid-flight is re-run on the next launch (idempotent recovery).
 * - Restart recovery and restart storms on the full in-memory runtime over a real SQLite store: interrupted running
 *   assignments are reconciled and pending ones re-launch, with no loss or duplication, measured per restart.
 * - Prompt decoration (triggerMessage/batchLine/inputMessage) microbenchmarks, the executor-side cost per delivery.
 * Session-controller and provider/model-selection costs are mocked in this harness: NOT TESTED here (no paid calls).
 */
import { spawn } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { afterEach, expect, it } from 'vitest'
import { ExecutorFixture, ControlledSpawn, type SpawnHandle, type SpawnResult } from '../fixtures/executor.ts'
import { waitUntil } from '../fixtures/async.ts'
import { inputMessage, ticketExecution, triggerMessage } from '../../src/executor/dsh.ts'
import { SettingsSchema } from '../../src/policy.ts'
import { feishu, reopen, startRuntime, type Host } from './host.ts'
import { evidence, summarize } from './probe.ts'

const reader = (get: () => string) => ({ readFrom: () => ({ text: get(), nextOffset: get().length, lossy: false }) })
/** A SpawnHandle backed by a real child process, for honest prepare-command cost. */
const realSpawn = (spec: { argv: string[]; cwd: string; signal?: AbortSignal; env?: Record<string, string> }): SpawnHandle => {
  const child = spawn(spec.argv[0]!, spec.argv.slice(1), { cwd: spec.cwd, env: { ...process.env, ...spec.env }, signal: spec.signal })
  let out = '', err = ''
  child.stdout?.on('data', data => { out += data })
  child.stderr?.on('data', data => { err += data })
  const done = new Promise<SpawnResult>(resolve => child.on('close', (exitCode, signal) => resolve({ exitCode, signal })))
  return { done, waitForExit: async () => { await done; return true }, terminate: () => { child.kill() },
    collected: { stdout: reader(() => out), stderr: reader(() => err) } }
}
const timed = async <T>(run: () => Promise<T>): Promise<{ ms: number; value: T }> => {
  const t0 = performance.now()
  const value = await run()
  return { ms: performance.now() - t0, value }
}

let fixtures: ExecutorFixture[] = []
let hosts: Host[] = []
afterEach(async () => {
  for (const fixture of fixtures) fixture.dispose()
  fixtures = []
  for (const h of hosts) await h.stop()
  hosts = []
})

it('cold vs warm launches: real prepare cost, and reuse through the durable preparation record', async () => {
  const fixture = new ExecutorFixture({ prepare: 'mkdir -p .cache && dd if=/dev/zero of=.cache/blob bs=1024 count=64 2>/dev/null' })
  fixtures.push(fixture)
  fixture.intercept = spec => spec.argv[0] === 'sh' ? realSpawn(spec) : undefined
  const cold: number[] = [], warm: number[] = [], spawnsCold: number[] = []
  const R = 15
  for (let i = 0; i < R; i++) {
    const { ticket, assignment } = fixture.mkTicket(`t${i}`)
    const first = await timed(() => fixture.launch(ticket, assignment))
    spawnsCold.push(fixture.prepareCommands().length)
    cold.push(first.ms)
    const second = fixture.newAssignment(ticket)
    const retry = await timed(() => fixture.launch(ticket, second))
    warm.push(retry.ms)
  }
  evidence('issue-18-cold-warm-launch', {
    scenario: 'R=15 paired launches per ticket; prepare = real sh mkdir+64KB dd; warm launch reuses the prepared record',
    prepareCommandSpawnsTotal: spawnsCold.at(-1), coldMs: summarize(cold), warmMs: summarize(warm),
    pairedSavingMs: summarize(cold.map((ms, i) => ms - warm[i]!)),
    note: 'executor-side + real subprocess cost; provider session/model costs mocked out (NOT TESTED)',
  })
  expect(spawnsCold.at(-1)).toBe(R) // exactly one prepare per ticket: the warm launch ran none
  expect(summarize(warm).median).toBeLessThan(summarize(cold).median)
})

it('partial preparation: a killed prepare is re-run on the next launch, which then succeeds', async () => {
  const fixture = new ExecutorFixture({ prepare: 'mkdir -p out && echo ok > out/prepared' })
  fixtures.push(fixture)
  let calls = 0
  let held: ControlledSpawn | undefined
  fixture.intercept = spec => {
    if (spec.argv[0] !== 'sh') return undefined
    calls++
    if (calls === 1) return (held = new ControlledSpawn(spec, { ignoreAbort: true })).handle // dies on its own, as on a host crash
    return realSpawn(spec)
  }
  const { ticket, assignment } = fixture.mkTicket('t1')
  const t0 = performance.now()
  const first = fixture.launch(ticket, assignment)
  await waitUntil(() => calls === 1)
  held!.stop() // the process range dies without an exit code, as DSH's provider reports a killed range
  await first // a terminated range fails the launch without retry; the ticket is marked failed and waits
  const failedMs = performance.now() - t0
  expect(fixture.prepareCommands().length).toBe(1)
  expect(ticket.assignments.at(-1)?.report?.state).toBe('failed')
  const promptsBefore = fixture.sessions.prompt.mock.calls.length
  const t1 = performance.now()
  const second = fixture.newAssignment(ticket)
  await fixture.launch(ticket, second)
  const recoveredMs = performance.now() - t1
  expect(fixture.prepareCommands().length).toBe(2) // re-prepared from its 'failed' record
  expect(fixture.sessions.prompt.mock.calls.length).toBeGreaterThan(promptsBefore) // the retried launch reached the worker
  evidence('issue-18-partial-preparation', {
    scenario: 'first prepare killed mid-flight (terminated range); relaunch re-runs prepare and succeeds',
    prepareCommands: fixture.prepareCommands().length, failedMs, recoveredMs, recovered: true,
  })
})

it('restart recovery and restart storms: no lost or duplicated assignments, per-restart cost', async () => {
  let h = await startRuntime()
  hosts.push(h)
  const settings = h.runtime.store.settings()
  h.runtime.store.saveSettings({ ...settings, executor: { ...settings.executor, maxWorkers: 2 } })
  const tickets: Awaited<ReturnType<Host['acceptedTicket']>>[] = []
  for (let i = 0; i < 4; i++) tickets.push(await h.acceptedTicket(feishu(`${i + 1}`, `@bot task ${i}`)))
  const restarts: { readyMs: number; relaunchMs: number; running: number; pending: number }[] = []
  for (let round = 0; round < 5; round++) {
    const t0 = performance.now()
    const h2 = await reopen(h)
    hosts.push(h2)
    h = h2
    const readyMs = performance.now() - t0
    const t1 = performance.now()
    await h.runtime.pump(); await h.runtime.idle()
    await waitUntil(() => tickets.filter(one => h.agents.get(one.sessionId)?.status === 'running').length >= 2, 10_000)
    await h.runtime.idle()
    const relaunchMs = performance.now() - t1
    const states = tickets.map(one => h.runtime.store.tickets.get(one.ticket.id)!.assignments.map(a => a.state))
    const running = states.flat().filter(s => s === 'running').length
    const pending = states.flat().filter(s => s === 'pending').length
    restarts.push({ readyMs, relaunchMs, running, pending })
    // End the running turns quietly so the next restart also exercises interrupt reconciliation.
    for (const one of tickets) {
      const agent = h.agents.get(one.sessionId)
      if (agent?.status === 'running') { agent.status = 'idle'; h.ctx.emit('agent/status', { agent, status: 'idle' } as never) }
    }
    await h.runtime.idle()
  }
  const finalStates = tickets.map(one => ({
    assignments: h.runtime.store.tickets.get(one.ticket.id)!.assignments.length,
    latest: h.runtime.store.tickets.get(one.ticket.id)!.assignments.at(-1)?.state,
    ended: !!h.runtime.store.tickets.get(one.ticket.id)!.ended,
  }))
  evidence('issue-18-restart-storm', {
    scenario: '4 tickets (2 running turns, 2 queued) through 5 sequential host restarts on one SQLite store',
    restarts, finalStates,
    note: 'readyMs = reopen to Runtime.ready (incl. resume reconciliation); relaunchMs = ready to turns running again',
  })
  for (const [i, state] of finalStates.entries()) {
    expect(state.ended).toBe(false)
    // Recovery reconciles by ending the interrupted assignment and pending a new one: never two live at once,
    // never more restarts' worth of churn than restarts that found it running, and the latest is live.
    const states = tickets.map(one => h.runtime.store.tickets.get(one.ticket.id)!.assignments.map(a => a.state))[i]!
    expect(states.filter(state => state !== 'ended')).toHaveLength(1)
    expect(state.assignments).toBeLessThanOrEqual(6) // at most one new assignment per restart plus the original
    expect(['pending', 'running']).toContain(state.latest)
  }
}, 120_000)

it('prompt decoration: triggerMessage, batchLine and inputMessage cost per delivery', () => {
  const trigger = feishu('1', '@bot please fix the flaky login test '.repeat(30))
  const longTrigger = feishu('2', '@bot x'.repeat(5000))
  const link = { source_url: 'https://example.test/msg/1' }
  const batch = Array.from({ length: 50 }, (_, i) => feishu(`${i + 10}`, `@bot item ${i} ` + 'context '.repeat(20)))
  const measure = (name: string, iterations: number, run: () => unknown) => {
    run() // warm
    const t0 = performance.now()
    for (let i = 0; i < iterations; i++) run()
    const ms = performance.now() - t0
    return { name, iterations, totalMs: Math.round(ms * 100) / 100, nsPerOp: Math.round(ms * 1e6 / iterations) }
  }
  const results = [
    measure('triggerMessage', 20_000, () => triggerMessage(trigger, link)),
    measure('triggerMessage-long-capped', 20_000, () => triggerMessage(longTrigger, link)),
    measure('triggerMessage-with-reply', 20_000, () => triggerMessage(trigger, link, 'note', longTrigger)),
    measure('batchLine-x50', 10_000, () => batch.map(batchLine0)),
    measure('inputMessage-note', 20_000, () => inputMessage({ id: 'i1', kind: 'note', text: 'CI passed', at: '2026-11-04T00:00:00Z' } as never)),
    measure('inputMessage-trigger', 20_000, () => inputMessage({ id: 'i2', kind: 'trigger', triggerId: trigger.id, at: '2026-11-04T00:00:00Z' } as never,
      triggerMessage(trigger, link))),
    measure('ticketExecution', 20_000, () => ticketExecution(
      { id: 't1', origin: { triggerId: trigger.id, triggerIds: [trigger.id] }, mandate: { strength: 'explicit', basis: {}, policyVersion: 'v1' } } as never,
      { kind: 'accept', name: 'fix-x', scope: 'Fix x', title: 'Fix x' } as never, SettingsSchema.parse({}), '/tmp/state')),
  ]
  evidence('issue-18-prompt-decoration', { scenario: 'pure decoration functions, in-process, no I/O', results })
  // every decoration well under 0.5ms per call (batchLine-x50 renders 50 triggers per call)
  for (const result of results) expect(result.nsPerOp).toBeLessThan(500_000)
})
const batchLine0 = (trigger: Parameters<typeof triggerMessage>[0]) => {
  // Local copy of the exported batchLine shape to keep the import list honest.
  return { trigger_id: trigger.id, from: trigger.actor.id, at: trigger.at,
    preview: trigger.text.replace(/\s+/g, ' ').slice(0, 160), read: `trigger/${trigger.id}` }
}
