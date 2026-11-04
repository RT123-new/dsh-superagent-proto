/** Process-kill test helper. No power-loss claim. */
import { Store } from '../../src/app/store.ts'
const s=new Store(process.argv[2]!)
if(process.argv[3]==='uncommitted')s.db.exec('BEGIN IMMEDIATE')
s.decisions.save({id:'d',threadKey:'github:1',kind:'ignore',triggerIds:['b'],at:'2026-01-01'} as never)
process.kill(process.pid,'SIGKILL')
