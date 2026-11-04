/**
 * DshExecutor test harness for the workspace-preparation and cancellation workstream (mandate Issues 4 and 5):
 * a mock ExecutorHost with a controllable subprocess runtime, session manager and ticket store, so launches can be
 * driven deterministically and cancelled at exact asynchronous boundaries.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import { DshExecutor, type ExecutorHost } from '../../src/executor/dsh.ts'
import { latestAssignment, type Assignment, type Ticket } from '../../src/core/index.ts'
import { SettingsSchema, type Settings } from '../../src/policy.ts'

export interface SpawnSpec { argv: string[]; cwd: string; signal?: AbortSignal; env?: Record<string, string> }
interface Reader { readFrom(offset: number): { text: string; nextOffset: number; lossy: boolean } }
export interface SpawnResult { exitCode: number | null; signal: string | null }
export interface SpawnHandle { waitForExit(): Promise<boolean>; terminate(): void; done: Promise<SpawnResult>; collected: { stdout: Reader; stderr: Reader } }

export const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const reader = (get: () => string): Reader => ({ readFrom: () => ({ text: get(), nextOffset: get().length, lossy: false }) })

/** An immediate spawn result; `exitCode` null reports a terminated process, as DSH's provider reports a killed range. */
export const immediate = (exitCode: number | null, stderr = ''): SpawnHandle =>
  ({ done: Promise.resolve({ exitCode, signal: exitCode === null ? 'SIGTERM' : null }), waitForExit: async () => true, terminate: () => {},
    collected: { stdout: reader(() => ''), stderr: reader(() => stderr) } })

/** A spawn whose exit the test controls; aborting its signal ends it the way DSH's provider ends a terminated range. */
export class ControlledSpawn {
  readonly handle: SpawnHandle
  private readonly end = deferred<SpawnResult>()
  private readonly range = deferred<boolean>()
  private stderrText = ''
  constructor(readonly spec: SpawnSpec, options: { ignoreAbort?: boolean } = {}) {
    this.handle = { done: this.end.promise, waitForExit: () => this.range.promise, terminate: () => this.stop(),
      collected: { stdout: reader(() => ''), stderr: reader(() => this.stderrText) } }
    if (!options.ignoreAbort) {
      if (spec.signal?.aborted) this.stop()
      else spec.signal?.addEventListener('abort', () => this.stop(), { once: true })
    }
  }
  /** Ends the command the way DSH's provider reports a terminated managed process: no exit code. */
  stop(): void { this.end.resolve({ exitCode: null, signal: 'SIGTERM' }); this.range.resolve(true) }
  /** Ends the command normally with `exitCode` and `stderr` text. */
  finish(exitCode: number, stderr = ''): void { this.stderrText = stderr; this.end.resolve({ exitCode, signal: null }); this.range.resolve(true) }
}

const now = (): string => new Date().toISOString()

export class ExecutorFixture {
  readonly root = mkdtempSync(join(tmpdir(), 'dsh-executor-'))
  readonly stateDir: string
  readonly work: string
  settings: Settings
  readonly tickets = new Map<string, Ticket>()
  /** Every spawn the Executor requested, in request order. */
  readonly spawns: SpawnSpec[] = []
  /** Test hook: return a SpawnHandle to take over a spawn; undefined falls through to the default handler. */
  intercept?: (spec: SpawnSpec) => SpawnHandle | undefined
  closingFlag = false
  pausedFlag = false
  private readonly lifetime = new AbortController()
  private launchRun!: (payload: { ticketId: string; assignmentId: string }) => Promise<void>

  readonly engine: Record<string, ReturnType<typeof vi.fn>> = {
    assignmentStarted: vi.fn(), inputsDelivered: vi.fn(), inputsRead: vi.fn(), turnEnded: vi.fn(), deliveryFailed: vi.fn(),
    assignmentInterrupted: vi.fn(),
    report: vi.fn((ticketId: string, report: { state: 'progress' | 'waiting' | 'ready' | 'blocked' | 'failed' | 'dropped'; summary: string }) => {
      const ticket = this.tickets.get(ticketId)
      if (!ticket) throw new Error(`The engine got a report for an unknown ticket ${ticketId}`)
      const assignment = latestAssignment(ticket)
      if (assignment) assignment.report = { ...report, at: now() }
      ticket.updatedAt = now()
      return ticket
    }),
  }
  readonly sessions: {
    ensure: ReturnType<typeof vi.fn>
    prompt: ReturnType<typeof vi.fn>
    promptedId: (id: string) => string
    relay: ReturnType<typeof vi.fn>
    holds: ReturnType<typeof vi.fn>
  } = {
    ensure: vi.fn(async (id: string) => ({ id, status: 'idle', inbox: { remove: vi.fn() }, cancel: vi.fn(),
      whenIdle: async () => {}, session: { snapshotEvents: () => [] } })),
    prompt: vi.fn(async (_id: string, _requestId: string, _text: string, _mode: unknown, authorize?: () => void, accepted?: () => void) => {
      authorize?.(); accepted?.()
    }),
    promptedId: (id: string) => `msg-${id}`,
    relay: vi.fn(),
    holds: vi.fn(async () => false),
  }
  readonly executor: DshExecutor

  constructor(options: { prepare?: string; maxWorkers?: number; prepareTimeoutMs?: number; paths?: { stateDir: string; work: string } } = {}) {
    this.stateDir = options.paths?.stateDir ?? join(this.root, 'state')
    this.work = options.paths?.work ?? join(this.root, 'work')
    this.settings = SettingsSchema.parse({ executor: { prepare: options.prepare ?? '', directory: this.work,
      ...options.maxWorkers === undefined ? {} : { maxWorkers: options.maxWorkers } } })
    const spawn = (spec: SpawnSpec): SpawnHandle => {
      this.spawns.push(spec)
      const taken = this.intercept?.(spec)
      if (taken) return taken
      if (spec.signal?.aborted) return immediate(null)
      // `git config --get-regexp` exits 1 when no keys match, which verifyDirectory reads as "no dangerous keys".
      if (spec.argv[0] === 'git' && spec.argv.includes('--get-regexp')) return immediate(1)
      return immediate(0)
    }
    const host = {
      context: { subprocess: { spawn }, agents: { get: () => undefined }, on: () => () => {}, get: () => undefined },
      engine: this.engine,
      store: {
        tickets: { get: (id: string) => this.tickets.get(id), open: () => [...this.tickets.values()].filter(ticket => !ticket.ended),
          list: () => [...this.tickets.values()] },
        triggers: { get: () => undefined },
        set: vi.fn(),
        settings: () => this.settings,
        atomic: (run: () => void) => run(),
        afterCommit: (run: () => void) => run(),
      },
      effects: { enqueue: vi.fn(), handle: vi.fn((kind: string, run: (payload: { ticketId: string; assignmentId: string }) => Promise<void>) => {
        if (kind === 'launch') this.launchRun = run
      }) },
      health: { get: () => undefined, set: vi.fn() },
      machine: { stateDir: this.stateDir },
      lifetime: this.lifetime.signal,
      sessions: this.sessions,
      closing: () => this.closingFlag,
      paused: () => this.pausedFlag,
      environment: () => [],
      sourceLink: async () => ({}),
      repliedTo: () => undefined,
      // Fields added by the Issue 4/5 repair; the cast keeps this harness compiling against the original ExecutorHost.
      repository: () => 'acme/widgets',
      ...options.prepareTimeoutMs === undefined ? {} : { prepareTimeoutMs: options.prepareTimeoutMs },
    } as unknown as ExecutorHost
    this.executor = new DshExecutor(host)
  }

  /** The `sh -c` prepare commands the Executor ran, in order. */
  prepareCommands(): SpawnSpec[] { return this.spawns.filter(spec => spec.argv[0] === 'sh' && spec.argv[1] === '-c') }

  mkTicket(id: string): { ticket: Ticket; assignment: Assignment } {
    const name = `fix-work-${id}`
    const ticket: Ticket = {
      id, title: `Ticket ${id}`, decisionId: `decision-${id}`,
      mandate: { strength: 'explicit', policyVersion: 'v1', basis: { via: 'addressed', addressed: 'mention' },
        actor: { source: 'github', id: 'octocat' }, scope: 'Fix the thing' },
      channels: [], assignments: [], inputs: [], undelivered: [],
      createdAt: now(), updatedAt: now(),
      origin: { triggerId: `trigger-${id}`, triggerIds: [`trigger-${id}`] },
      execution: { name, directory: join(this.work, name), assignment: 'Fix the thing' },
    }
    this.tickets.set(id, ticket)
    return { ticket, assignment: this.newAssignment(ticket) }
  }

  newAssignment(ticket: Ticket): Assignment {
    const assignment: Assignment = { id: `${ticket.id}-a${ticket.assignments.length + 1}`, state: 'pending', createdAt: now() }
    ticket.assignments.push(assignment)
    return assignment
  }

  /** Ends the assignment the way Tickets does (domain end committed, then `executor.stop`); optionally ends the ticket too. */
  cancelAssignment(ticket: Ticket, assignment: Assignment, reason: string, endTicket = false): void {
    assignment.state = 'ended'; assignment.endedAt = now(); assignment.endedReason = reason
    if (endTicket) ticket.ended = { at: now(), by: 'human', outcome: 'stopped' }
    ticket.updatedAt = now()
    this.executor.stop(ticket, assignment, reason)
  }

  /** Runs the `launch` effect handler the Executor registered, as Effects would. */
  launch(ticket: Ticket, assignment: Assignment): Promise<void> { return this.launchRun({ ticketId: ticket.id, assignmentId: assignment.id }) }

  dispose(): void {
    this.executor.dispose()
    this.lifetime.abort()
    rmSync(this.root, { recursive: true, force: true })
  }
}
