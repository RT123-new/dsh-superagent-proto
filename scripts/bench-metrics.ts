// Overhead benchmark for src/infra/metrics.ts. Run: node --experimental-transform-types scripts/bench-metrics.ts
import { Metrics, STAGES } from '../src/infra/metrics.ts'
const N = 1_000_000, m = new Metrics()
const bare = (): number => { const t = performance.now(); let x = 0; for (let i = 0; i < N; i++) x += i % 7; return performance.now() - t + (x < 0 ? 1 : 0) }
const base = bare()
let t = performance.now()
for (let i = 0; i < N; i++) m.observe(STAGES[i % STAGES.length]!, 'github', i % 1000)
const observeMs = performance.now() - t
t = performance.now()
for (let i = 0; i < N; i++) { const stop = m.timer('worker_turn', 'github'); stop() }
const timerMs = performance.now() - t
const ser = Array.from({ length: 50 }, () => m.serialize())
const ms = ser.map((s) => s.ms).sort((a, b) => a - b)
console.log(JSON.stringify({ node: process.version, N, loopBaselineMs: +base.toFixed(2), observeNsPerCall: +(observeMs / N * 1e6).toFixed(1), timerStartStopNsPerCall: +(timerMs / N * 1e6).toFixed(1), snapshotBytes: ser[0]!.bytes, serializeMsP50: +ms[24]!.toFixed(3), serializeMsMax: +ms[49]!.toFixed(3), heapMB: +(process.memoryUsage().heapUsed / 1e6).toFixed(1) }, null, 1))
