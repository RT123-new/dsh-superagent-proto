// Matched-seed cluster bootstrap keeps correlated within-run refills together.
import { readFileSync, writeFileSync } from 'node:fs'
const [basePath, variantPath, output] = process.argv.slice(2)
const base = JSON.parse(readFileSync(basePath)), variant = JSON.parse(readFileSync(variantPath))
const key = x => `${x.capacity}:${x.seed}:${x.n}`
const b = new Map(base.runs.map(x => [key(x), x]))
if (b.size !== base.runs.length || base.runs.length !== variant.runs.length) throw Error('unmatched/duplicate runs')
const pairs = variant.runs.map(v => { const x = b.get(key(v)); if (!x) throw Error('missing pair'); return [x, v] })
const quantile = (x,p) => [...x].sort((a,b)=>a-b)[Math.ceil(x.length*p)-1]
let seed = 7843
const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 2**32 }
const result = []
for (const capacity of [1,3,6,12]) {
  const rows = pairs.filter(([x]) => x.capacity === capacity)
  const metric = (rs, side) => capacity === 1 ? quantile(rs.flatMap(x=>x[side].refillsMs),.95) : quantile(rs.map(x=>x[side].makespanMs),.95)
  const a=metric(rows,0), z=metric(rows,1), improvements=[]
  for(let k=0;k<10000;k++) { const sample=rows.map(()=>rows[Math.floor(rand()*rows.length)]); const x=metric(sample,0), y=metric(sample,1); improvements.push((x-y)/x) }
  result.push({capacity,metric:capacity===1?'refill_p95_ms':'run_makespan_p95_ms', independent_seed_pairs:rows.length,
    refill_event_pairs:capacity===1?rows.reduce((n,x)=>n+x[0].refillsMs.length,0):null,
    baseline:a,variant:z,relative_improvement:(a-z)/a,paired_cluster_bootstrap_ci95:[quantile(improvements,.025),quantile(improvements,.975)],
    all_successful:rows.every(r=>r.every(x=>x.failed===0&&x.peakUsed<=capacity))})
}
writeFileSync(output,JSON.stringify({method:'10,000 matched seed-cluster resamples, nearest rank P95; exploratory five seeds, not 200 tasks/profile',result},null,2))
console.log(JSON.stringify(result,null,2))
