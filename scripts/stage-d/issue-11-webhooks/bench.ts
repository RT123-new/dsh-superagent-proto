/** Synthetic event-detection comparison, separate from model execution. Not deployment evidence.
 * 200 events x five seeds per profile. Same events in both variants; dropped hooks retain polling fallback.
 * Poll interval stays 60s; loopback arrival assumption 200-2000ms. No live requests.
 */
import { writeFileSync } from 'node:fs'
import { rng } from '../lib/rng.ts'
import { pairedBootstrap, percentileOf } from '../lib/stats.ts'
const rows: {profile:string;seed:number;event:number;poll:number;hook:number;lost:boolean}[] = []
for (const loss of [0,0.1,0.5,1]) {
  const base:number[]=[], variant:number[]=[]
  for (let seed=1;seed<=5;seed++) {
    const random=rng(seed)
    for (let event=0;event<200;event++) {
      const poll=60_000-random()*60_000+200 // fixed source read assumption; zero model time
      const arrival=200+random()*1800, lost=random()<loss
      const hook=lost?poll:Math.min(poll,arrival+200)
      base.push(poll);variant.push(hook)
      rows.push({profile:`loss=${loss}`,seed,event,poll,hook,lost})
    }
  }
  console.log(JSON.stringify({issue:11,profile:`loss=${loss}`,
    pollP95:percentileOf(base,0.95),hookP95:percentileOf(variant,0.95),
    ...pairedBootstrap(base,variant,rng(900),10_000,'p95'),statistic:'p95',synthetic:true,
    modelTimeExcluded:true,eligibleEvents:1000,missed:0,pollFallback:true}))
}
if(process.env.RAW_OUT)writeFileSync(process.env.RAW_OUT,JSON.stringify(rows,null,2))
