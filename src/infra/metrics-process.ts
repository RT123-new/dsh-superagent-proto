import { performance } from 'node:perf_hooks'

/** Process-wide resource usage read at snapshot time. Scope is the whole Node process (all sessions, subprocesses excluded), not per ticket or per stage. */
export interface ProcessUsage {
  scope: 'process'
  uptimeSeconds: number
  cpuUserMicros: number
  cpuSystemMicros: number
  rssBytes: number
  heapUsedBytes: number
  /** Event-loop utilization since process start, 0..1; null where the runtime does not report it. */
  eventLoopUtilization: number | null
}

/** Cumulative CPU time and current memory of this process. Child processes (gh, git, prepare commands) are not included. */
export function processUsage(): ProcessUsage {
  const cpu = process.cpuUsage(), mem = process.memoryUsage()
  let elu: number | null = null
  try { elu = performance.eventLoopUtilization().utilization } catch { elu = null }
  return { scope: 'process', uptimeSeconds: process.uptime(), cpuUserMicros: cpu.user, cpuSystemMicros: cpu.system, rssBytes: mem.rss, heapUsedBytes: mem.heapUsed, eventLoopUtilization: elu }
}
