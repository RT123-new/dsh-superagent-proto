/** Deterministic seeded PRNG (mulberry32) so every Stage D workload and latency draw is reproducible. */
export function rng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
/** Uniform draw in [min, max). */
export function uniform(random: () => number, min: number, max: number): number {
  return min + random() * (max - min)
}
/** Approximate lognormal-ish latency draw (ms): right-tailed like real API reads, deterministic per seed. */
export function latencyMs(random: () => number, base: number, spread: number): number {
  const u = Math.max(random(), 1e-9)
  return base + spread * -Math.log(u)
}
