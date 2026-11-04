/**
 * Stage D measurement probe (mandate Issues 16-18): observes the real DshExecutor's WorkerSlots decisions, worker status
 * transitions and Engine turn boundaries without changing production code, and integrates per-state slot occupancy:
 * for each state s, occupancy_fraction_s = slot_seconds_in_state_s / (capacity x window_seconds), plus the
 * available_slots = max(0, configured_capacity - active_reservations) reading at every scheduling transition.
 * Slot-holding states are starting (launch/wake reservation), turn (worker turn running) and background-wait (the turn
 * ended but shell jobs or subagents still run); handed-off and idle hold no slot. Reasoning, in-turn tool use and
 * in-turn external waits are inside 'turn': separating them needs the Issue 9 in-Session hooks, noted as a limitation.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import type { Host } from './host.ts'

export type SlotState = 'starting' | 'turn' | 'background-wait' | 'handed-off' | 'idle'
export const HOLDS_SLOT: ReadonlySet<SlotState> = new Set(['starting', 'turn', 'background-wait'])

export interface Sample { t: number; label: string; states: Record<string, SlotState>; used: number; capacity: number }

export class SlotProbe {
  readonly samples: Sample[] = []
  readonly marks = new Map<string, Record<string, number>>()
  /** Peak concurrent slot usage observed, and the peak that came from a person's extra reservation. */
  peakUsed = 0
  peakPerson = 0
  private readonly executor: any
  private readonly slots: any
  private readonly host: Host
  private readonly disposeStatus: () => void

  constructor(host: Host) {
    this.host = host
    this.executor = host.runtime.executor as any
    this.slots = this.executor.slots
    for (const method of ['reserve', 'free'] as const) {
      const original = this.slots[method].bind(this.slots)
      this.slots[method] = (...args: any[]) => {
        const result = original(...args)
        this.sample(`${method}:${args[0]}:${args[1] ?? ''}`)
        return result
      }
    }
    const engine = this.host.runtime.engine as any
    for (const method of ['turnEnded', 'assignmentStarted'] as const) {
      const original = engine[method].bind(engine)
      engine[method] = (ticketId: string, assignmentId: string) => {
        this.mark(ticketId, method)
        this.sample(`engine:${method}:${ticketId}`)
        return original(ticketId, assignmentId)
      }
    }
    this.disposeStatus = (host.ctx as any).on('agent/status', ({ agent, status }: any) => {
      const ticketId = typeof agent?.id === 'string' && agent.id.startsWith('worker-') ? agent.id.slice('worker-'.length) : undefined
      if (ticketId) this.sample(`status:${ticketId}:${status}`)
    })
  }

  mark(ticketId: string, name: string): void {
    const entry = this.marks.get(ticketId) ?? {}
    entry[name] = Date.now()
    this.marks.set(ticketId, entry)
  }

  /** The state of one ticket's worker right now, from the Executor's own bookkeeping. */
  stateOf(ticketId: string): SlotState {
    if (this.slots.starting.has(ticketId)) return 'starting'
    const agent = (this.host.ctx as any).agents.get(`worker-${ticketId}`)
    if (agent?.status === 'running') return 'turn'
    if (this.executor.settling.has(ticketId)) return 'background-wait'
    if (this.executor.left.has(ticketId)) return 'handed-off'
    return 'idle'
  }

  /** Tickets known to the probe: every worker reservation, running agent, settling look or handoff seen so far. */
  private tickets(): string[] {
    const known = new Set<string>([...this.marks.keys()])
    for (const key of ['starting'] as const) for (const id of this.slots[key].keys()) known.add(id)
    for (const key of ['settling', 'left'] as const) for (const id of this.executor[key].keys()) known.add(id)
    return [...known]
  }

  sample(label: string): void {
    const states: Record<string, SlotState> = {}
    for (const ticketId of this.tickets()) states[ticketId] = this.stateOf(ticketId)
    const used = this.slots.used()
    const capacity = this.host.runtime.store.settings().executor.maxWorkers
    this.peakUsed = Math.max(this.peakUsed, used)
    if ([...this.slots.starting.values()].includes('person')) this.peakPerson = Math.max(this.peakPerson, used)
    this.samples.push({ t: Date.now(), label, states, used, capacity })
  }

  /** Integrates per-state slot-seconds over the sampled window; fractions use the mandate's capacity slot-seconds. */
  report(): {
    windowMs: number; capacitySlotMs: number; stateSlotMs: Record<SlotState, number>
    occupancyFraction: Record<string, number>; peakUsed: number; peakPerson: number; sampleCount: number
  } {
    const stateSlotMs: Record<SlotState, number> = { starting: 0, turn: 0, 'background-wait': 0, 'handed-off': 0, idle: 0 }
    const first = this.samples[0], last = this.samples.at(-1)
    const windowMs = (last?.t ?? 0) - (first?.t ?? 0)
    const capacity = last?.capacity ?? 0
    for (let i = 0; i + 1 < this.samples.length; i++) {
      const dt = this.samples[i + 1]!.t - this.samples[i]!.t
      for (const state of Object.values(this.samples[i]!.states)) stateSlotMs[state] += dt
    }
    // Mandate formula: occupancy_fraction_s = total_worker_slot_seconds_in_state_s / total_available_worker_slot_seconds,
    // where total_available_worker_slot_seconds = configured_capacity x window (capacity slot-seconds). Fractions of
    // non-holding states (handed-off, idle) are ticket-seconds per capacity slot-second and do not consume slots.
    const capacitySlotMs = capacity * windowMs
    const occupancyFraction: Record<string, number> = {}
    for (const [state, ms] of Object.entries(stateSlotMs)) occupancyFraction[state] = capacitySlotMs > 0 ? ms / capacitySlotMs : 0
    return { windowMs, capacitySlotMs, stateSlotMs, occupancyFraction,
      peakUsed: this.peakUsed, peakPerson: this.peakPerson, sampleCount: this.samples.length }
  }

  dispose(): void { this.disposeStatus() }
}

/** Explicit evidence regeneration only; normal pnpm test never overwrites recorded benchmark evidence. */
export function evidence(name: string, data: unknown): void {
  const directory = process.env.STAGE_D_EVIDENCE_DIR
  if (!directory) return
  mkdirSync(directory, { recursive: true })
  writeFileSync(`${directory}/${name}.json`, JSON.stringify(data, null, 2))
}

export const mean = (values: number[]): number => values.reduce((sum, value) => sum + value, 0) / (values.length || 1)
export const median = (values: number[]): number => percentile(values, 50)
/** Nearest-rank percentile, as the mandate's windowed metrics use. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p / 100 * sorted.length) - 1))]!
}
/** 95% normal-approximation half-width of the mean; NaN for n < 2. */
export function ci95(values: number[]): number {
  if (values.length < 2) return NaN
  const m = mean(values)
  const variance = values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1)
  return 1.96 * Math.sqrt(variance / values.length)
}
export const summarize = (values: number[]) =>
  ({ n: values.length, mean: mean(values), median: median(values), p95: percentile(values, 95), ci95: ci95(values), min: Math.min(...values), max: Math.max(...values) })

/** A small deterministic PRNG (mulberry32) for seeded workload mixes. */
export function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
}
