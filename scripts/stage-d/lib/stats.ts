/** Paired-comparison statistics per the programme mandate (section 9.2): pair by workload identity and seed,
 * 10,000-sample paired bootstrap, 2.5th/97.5th percentile interval, preserving correlation between matched tasks. */
export interface PairedResult {
  pairs: number
  baselineMean: number
  variantMean: number
  relativeImprovement: number
  ciLow: number
  ciHigh: number
  bootstrapSamples: number
}
/** Lower-is-better metrics: (baseline - variant) / baseline. Positive means the variant is better. */
export function pairedBootstrap(baseline: number[], variant: number[], random: () => number, samples = 10_000, statistic: 'mean' | 'p95' = 'mean'): PairedResult {
  if (baseline.length !== variant.length || baseline.length === 0) throw new Error('paired bootstrap needs equal non-empty samples')
  const n = baseline.length
  const improvement = (b: number[], v: number[]): number => {
    const bm = statistic === 'p95' ? percentileOf(b, 0.95) : b.reduce((a, x) => a + x, 0) / b.length
    const vm = statistic === 'p95' ? percentileOf(v, 0.95) : v.reduce((a, x) => a + x, 0) / v.length
    return (bm - vm) / bm
  }
  const observed = improvement(baseline, variant)
  const distribution: number[] = []
  for (let sample = 0; sample < samples; sample++) {
    const b: number[] = []
    const v: number[] = []
    for (let index = 0; index < n; index++) {
      const pick = Math.floor(random() * n)
      b.push(baseline[pick]!)
      v.push(variant[pick]!)
    }
    distribution.push(improvement(b, v))
  }
  distribution.sort((a, b) => a - b)
  const percentile = (p: number): number => distribution[Math.min(samples - 1, Math.floor(p * samples))]!
  return { pairs: n, baselineMean: baseline.reduce((a, x) => a + x, 0) / n, variantMean: variant.reduce((a, x) => a + x, 0) / n,
    relativeImprovement: observed, ciLow: percentile(0.025), ciHigh: percentile(0.975), bootstrapSamples: samples }
}
export const percentileOf = (values: number[], p: number): number => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!
}
