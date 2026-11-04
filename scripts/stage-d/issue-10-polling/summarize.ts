/** Per-profile exploratory P95 bootstrap, avoiding pooled workload-mix claims. */
import { readFileSync } from 'node:fs'
import { pairedBootstrap, percentileOf } from '../lib/stats.ts'
import { rng } from '../lib/rng.ts'
const rows = JSON.parse(readFileSync(process.argv[2]!, 'utf8')) as
  { workload: unknown; seed: number; sequentialMs: number; projections: Record<string,number> }[]
for(const profile of [...new Set(rows.map(r=>JSON.stringify(r.workload)))]) {
  const slice=rows.filter(r=>JSON.stringify(r.workload)===profile)
  for(const c of [1,2,4,8]) {
    const b=slice.map(r=>r.sequentialMs), v=slice.map(r=>r.projections[`C${c}`]!)
    console.log(JSON.stringify({profile,concurrency:c,synthetic:true,exploratory:true,
      baselineP95:percentileOf(b,0.95),variantP95:percentileOf(v,0.95),
      ...pairedBootstrap(b,v,rng(99+c),10_000,'p95')}))
  }
}
