# usage: hook2.sh ctl|stop   (one shell call: boots, scripts a slow PR-lookup report, optionally stops the ticket mid-lookup)
source /tmp/final/lib.sh; MODE=$1; OUT=/tmp/final/out-nf5-$MODE; mkdir -p $OUT; rm -f /tmp/overlay2/release /tmp/shim/slow; : > /tmp/shim/calls.log
pkill -9 -f /tmp/dshhost; sleep 1
cd /tmp/rp3; cp /tmp/zz-seed.bak tests/zz-seed-scratch.spec.ts; node_modules/.bin/vitest run tests/zz-seed-scratch.spec.ts 2>&1 | grep -aE "Tests "; rm tests/zz-seed-scratch.spec.ts
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('$STATE/orchestrator.sqlite');const t=JSON.parse(d.prepare('select value from ticket').get().value);console.log(t.execution&&t.execution.name)" 2>/dev/null > /tmp/shim/branch; echo "branch=$(cat /tmp/shim/branch)"
sleep 33; : > /tmp/overlay2/events.log
cd /tmp/dshhost; npx dsh superagent --patch /tmp/overlay2/patch.yml --no-open > $OUT/boot-$MODE.log 2>&1 &
note "$MODE boot launched"; for i in $(seq 1 80); do grep -aq "llm/stream requested #1" /tmp/overlay2/events.log 2>/dev/null && break; sleep 1; done; sleep 2
if [ "$MODE" != plain ]; then touch /tmp/shim/slow; echo '{"state":"progress","summary":"exec-probe: slow PR lookup","pr_number":42}' > /tmp/overlay2/release; note "release (scripted report, slow lookup)"; fi
sleep 4; note "tool executing: $(grep -c 'slow pull lookup begins' /tmp/shim/calls.log) lookup(s) begun"
if [ "$MODE" != ctl ]; then
  TOK=$(grep -ao "token=[A-Za-z0-9_-]*" $OUT/boot-$MODE.log | head -1 | cut -d= -f2)
  TID=$(node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('$STATE/orchestrator.sqlite');console.log(JSON.parse(d.prepare('select value from ticket').get().value).id)" 2>/dev/null)
  code=$(curl -s -o /tmp/stop.out -w '%{http_code}' -X POST -H 'x-orchestrator-request: 1' "http://127.0.0.1:3991/orchestrator/api/tickets/$TID/stop?token=$TOK"); note "stop route http=$code"
fi
sleep 16; note "after 16 s"
cat /tmp/overlay2/events.log | tail -9; echo "--- shim calls"; grep -a "pulls\|slow" /tmp/shim/calls.log
node -e "
const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('$STATE/orchestrator.sqlite');const t=JSON.parse(d.prepare('select value from ticket').get().value);console.log(JSON.stringify({ended:t.ended&&t.ended.outcome,follows:t.follows,a:t.assignments.map(a=>[a.state,a.report?.summary??null])}))" 2>/dev/null
killhost; sed -E 's/token=[^ &]*/token=REDACTED/g' $OUT/boot-$MODE.log > $OUT/b && mv $OUT/b $OUT/boot-$MODE.log; cp /tmp/overlay2/events.log $OUT/events-$MODE.log; cp /tmp/shim/calls.log $OUT/shim-calls-$MODE.log
