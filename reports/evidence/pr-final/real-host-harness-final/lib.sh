# Helpers for the real-host lineage replay. Source this, then follow RUNBOOK.md steps in order.
export DSH_HOME=/tmp/dshhome STATE=/tmp/dshstate2 OUT=/tmp/final/out
mkdir -p $OUT
stamp() { date -u +%Y-%m-%dT%H:%M:%S.%3NZ; }
note() { echo "$(stamp) $*" | tee -a $OUT/timeline.log; }
snap() {  # snap LABEL: ticket/assignment/effect state from the sqlite store, plus worker session header and hash
  node -e "
const {DatabaseSync}=require('node:sqlite');const z=require('zlib'),fs=require('fs'),c=require('crypto');
const d=new DatabaseSync('$STATE/orchestrator.sqlite');
const t=JSON.parse(d.prepare('select value from ticket').get().value);
const out={label:'$1',at:new Date().toISOString(),ticketId:t.id,ended:t.ended?t.ended.outcome:null,assignments:t.assignments.map(a=>a.state+':'+(a.endedReason||'')),inputs:t.inputs.map(i=>i.kind),effects:d.prepare('select kind,attempts from effect').all(),workers:[]};
const root='$DSH_HOME/sessions';
if(fs.existsSync(root)) for(const p of fs.readdirSync(root)) for(const s of fs.readdirSync(root+'/'+p)) if(s.startsWith('worker-')){const f=root+'/'+p+'/'+s+'/session.v4.jsonl.zstd';const buf=fs.readFileSync(f);const raw=z.zstdDecompressSync(buf);const lines=raw.toString().split('\n').filter(Boolean);out.workers.push({id:s,dsha:c.createHash('sha256').update(raw).digest('hex').slice(0,16),sha256:c.createHash('sha256').update(buf).digest('hex').slice(0,16),events:lines.length,header:JSON.parse(lines[0]).agentPreset})}
console.log(JSON.stringify(out))" 2>/dev/null | tee -a $OUT/snapshots.jsonl
}
boot() {  # boot N: start the real host with the overlay in the background; records pid
  cd /tmp/dshhost; npx dsh superagent --patch /tmp/overlay/patch.yml --no-open > $OUT/boot$1.log 2>&1 &
  sleep 1; note "boot $1 launched (launcher pid $!)"
}
hostpids() { pgrep -f "/tmp/dshhost" | tr '\n' ' '; }
killhost() { note "SIGKILL host pids: $(hostpids)"; pkill -9 -f "/tmp/dshhost"; sleep 1; note "after kill, remaining pids: [$(hostpids)]"; }
