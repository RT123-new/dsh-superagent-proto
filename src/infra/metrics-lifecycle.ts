/**
 * Lifecycle timelines (Issue 9): derive stage durations from the events the Engine and worker Sessions already emit.
 * All durations are local monotonic deltas between events observed live by this process: a start that was not observed
 * (before a restart, or dropped by a bound) records nothing and is counted as `lifecycle_unmatched`, never as a zero or a guess.
 * Maps are bounded; the oldest entries drop first and each drop counts `lifecycle_dropped`.
 */
import type { DomainEvent } from '../core/ports.ts'
import type { Probe } from './metrics-probe.ts'

/** Insertion-ordered map with a size cap that drops the oldest entry on overflow. */
class Pending<K, V> {
  private readonly map = new Map<K, V>()
  constructor(private readonly cap: number, private readonly onDrop: () => void) { if (!Number.isInteger(cap) || cap < 1 || cap > 10_000) throw new RangeError('timeline capacity must be1..10000') }
  set(key: K, value: V): void {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.cap) { const oldest = this.map.keys().next(); if (!oldest.done) { this.map.delete(oldest.value); this.onDrop() } }
  }
  take(key: K): V | undefined { const v = this.map.get(key); if (v !== undefined) this.map.delete(key); return v }
  peek(key: K): V | undefined { return this.map.get(key) }
  get size(): number { return this.map.size }
}

const label = (text: string): string => /^[a-z][a-z0-9_]{0,31}$/.test(text) ? text : 'other'

/** Durations between Engine domain events: trigger to evaluation, evaluation to decision, decision to ticket, launch, ticket lifetime. */
export class DomainTimeline {
  private readonly received: Pending<string, number>
  /** Mandate T_i chain: earliest received stamp carried eval -> decision -> ticket so t_terminal - t_received is one correlated measurement. */
  /** Receipt stamps for the T_i chain: the intake arrival when the intake noted one, else the queue commit. Never a session or model step. */
  private readonly taskChain: Pending<string, number>
  private readonly evalReceived: Pending<string, number>
  private readonly taskReceived: Pending<string, number>
  private readonly taskTerminal: Pending<string, number>
  private readonly arrivals: Pending<string, number>
  private readonly evaluating: Pending<string, number>
  private readonly decided: Pending<string, number>
  private readonly launching: Pending<string, number>
  private readonly alive: Pending<string, number>
  constructor(private readonly probe: Probe, private readonly mono: () => number, cap = 5000, private readonly evalOfDecision?: (id: string) => string | undefined) {
    const drop = () => { probe.count('lifecycle_dropped') }
    this.received = new Pending(cap, drop); this.arrivals = new Pending(cap, drop); this.evaluating = new Pending(cap, drop); this.decided = new Pending(cap, drop)
    this.taskChain = new Pending(cap, drop)
    this.evalReceived = new Pending(cap, drop); this.taskReceived = new Pending(cap, drop); this.taskTerminal = new Pending(cap, drop)
    this.launching = new Pending(cap, drop); this.alive = new Pending(cap, drop)
  }
  private since(map: Pending<string, number>, key: string, stage: string): void {
    const start = map.take(key)
    if (start === undefined) { this.probe.count('lifecycle_unmatched'); return }
    this.probe.observe(stage, 'internal', this.mono() - start)
  }
  /** The application received a Trigger (entry of `Passes.receive`); never throws. Pair with `abandoned` when no `trigger.received` event follows. */
  arrived(triggerId: string): void { try { this.arrivals.set(triggerId, this.mono()) } catch { this.probe.count('metrics_error') } }
  /** The intake ended without a `trigger.received` event (duplicate, filtered, or failed): forget the arrival. Never throws. */
  abandoned(triggerId: string): void { try { this.arrivals.take(triggerId) } catch { this.probe.count('metrics_error') } }
  /** Feed one Engine domain event; never throws. */
  observe(event: DomainEvent): void {
    try {
      const now = this.mono()
      switch (event.type) {
        case 'trigger.received': {
          this.probe.count('lifecycle_trigger_received')
          const arrival = this.arrivals.take(event.data.triggerId)
          // Only a trigger the intake actually queued for an Eval has a queue entry; a ticket owner's or an already waiting trigger has none.
          if (!event.data.queued) { this.probe.count('trigger_not_queued'); break }
          this.received.set(event.data.triggerId, now)
          // The mandate's t_received is the application's receipt of the trigger (entry of Passes.receive). A requeue of the same
          // trigger keeps its ORIGINAL receipt; the queue commit is only the fallback when nothing was ever noted.
          const known = this.taskChain.peek(event.data.triggerId)
          this.taskChain.set(event.data.triggerId, known ?? arrival ?? now)
          if (arrival !== undefined) this.probe.observe('source_to_eval_queue', 'internal', now - arrival)
          else if (known === undefined) this.probe.count('lifecycle_unmatched')
          break
        }
        case 'eval.started': {
          let earliest: number | undefined
          for (const id of event.data.triggerIds) { const at = this.received.take(id); if (at !== undefined) this.probe.observe('trigger_to_eval_start', 'internal', now - at); const chain = this.taskChain.peek(id); if (chain !== undefined) earliest = earliest === undefined ? chain : Math.min(earliest, chain) }
          if (earliest !== undefined) this.evalReceived.set(event.data.evalId, earliest)
          this.evaluating.set(event.data.evalId, now); break
        }
        case 'decision.recorded':
          const evalId = this.evalOfDecision?.(event.data.decisionId)
          if (evalId) {
            this.since(this.evaluating, evalId, 'eval_run')
            // Only an accept can create a ticket, and one eval can accept several times: peek, never consume.
            if (event.data.kind === 'accept') {
              const start = this.evalReceived.peek(evalId)
              if (start !== undefined) this.taskReceived.set(event.data.decisionId, start)
            }
          } else this.probe.count('lifecycle_unmatched')
          this.decided.set(event.data.decisionId, now); this.probe.count(`decision_${label(String(event.data.kind))}`); break
        case 'ticket.created':
          this.since(this.decided, event.data.decisionId, 'decision_to_ticket')
          const taskStart = this.taskReceived.take(event.data.decisionId)
          if (taskStart !== undefined) this.taskTerminal.set(event.data.ticketId, taskStart)
          this.launching.set(event.data.ticketId, now); this.alive.set(event.data.ticketId, now); this.probe.count('ticket_created'); break
        case 'ticket.resumed': this.launching.set(event.data.ticketId, now); this.alive.set(event.data.ticketId, now); this.probe.count('ticket_resumed'); break
        case 'assignment.started': this.since(this.launching, event.data.ticketId, 'assignment_launch'); break
        case 'ticket.ended': {
          this.since(this.alive, event.data.ticketId, 'ticket_lifetime')
          // T_i: the unmatched case is already counted by the lifetime lookup above; a missing chain stamps nothing, never zero.
          const taskStart = this.taskTerminal.take(event.data.ticketId)
          if (taskStart !== undefined) this.probe.observe('task_total', 'internal', now - taskStart)
          this.probe.count(`ticket_outcome_${label(String(event.data.outcome))}`); break
        }
        default: break
      }
    } catch { this.probe.count('metrics_error') }
  }
}

/** The slice of a Session event the worker timeline reads. */
export interface TimelineEvent { type: string; data?: unknown }

/** Per worker Session: turn, model call (step) and tool call durations from DSH session events, kept apart from success samples on failure. */
export class SessionTimeline {
  private readonly turns: Pending<string, number>
  private readonly steps: Pending<string, number>
  private readonly tools: Pending<string, number>
  constructor(private readonly probe: Probe, private readonly mono: () => number, cap = 1000) {
    const drop = () => { probe.count('lifecycle_dropped') }
    this.turns = new Pending(cap, drop); this.steps = new Pending(cap, drop); this.tools = new Pending(cap, drop)
  }
  /** Feed one event of one Session; `session` scopes the correlation keys. Never throws. */
  observe(session: string, event: TimelineEvent): void {
    try {
      const now = this.mono(), data = (event.data ?? {}) as { turn?: number; step?: number; callId?: string; reason?: { kind?: string }; interrupted?: boolean; message?: { isError?: boolean } }
      const stepKey = `${session}:${data.turn}:${data.step}`
      const finish = (map: Pending<string, number>, key: string, stage: string, outcome: 'success' | 'failure') => {
        const start = map.take(key)
        if (start === undefined) { this.probe.count('lifecycle_unmatched'); return }
        this.probe.observe(stage, 'internal', now - start, outcome)
      }
      switch (event.type) {
        case 'turn/start': this.turns.set(`${session}:${data.turn}`, now); break
        case 'turn/end': finish(this.turns, `${session}:${data.turn}`, 'worker_turn', data.reason?.kind === 'completed' ? 'success' : 'failure'); break
        case 'step/start': this.steps.set(stepKey, now); break
        // A step is one model call plus the tools it requested: the model call ends at the assistant message (or the failed attempt).
        case 'assistant/message': finish(this.steps, stepKey, 'step_to_settlement', data.interrupted ? 'failure' : 'success'); break
        case 'assistant/attempt': finish(this.steps, stepKey, 'step_to_settlement', 'failure'); break
        case 'tool/call': if (data.callId) this.tools.set(`${session}:${data.callId}`, now); break
        case 'tool/result': { const id = (event.data as { message?: { toolCallId?: string } }).message?.toolCallId; if (id) finish(this.tools, `${session}:${id}`, 'tool_run', data.message?.isError ? 'failure' : 'success') } break
        default: break
      }
    } catch { this.probe.count('metrics_error') }
  }
}
