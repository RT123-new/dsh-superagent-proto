/** Process-kill test helper. No power-loss claim. Boundary marker is synchronously written before SIGKILL. */
import { writeSync } from 'node:fs'
import { Store } from '../../src/app/store.ts'
const s=new Store(process.argv[2]!)
if(process.argv[3]==='helper-failure')throw new Error('Deliberate helper failure before save boundary')
if(process.argv[3]==='uncommitted')s.db.exec('BEGIN IMMEDIATE')
s.decisions.save({id:'d',threadKey:'github:1',kind:'ignore',triggerIds:['b'],at:'2026-01-01'} as never)
writeSync(1,`SAVE_BOUNDARY:${process.argv[3]}\n`)
process.kill(process.pid,'SIGKILL')
