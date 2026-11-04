# usage: create-kill.sh open|ended  - SIGKILL after sessionController.create returned and before the grant, then restart
source /tmp/final/lib.sh; MODE=$1; OUT=/tmp/final/out-create-$MODE; rm -rf $OUT; mkdir -p $OUT; rm -f /tmp/overlay2/release; : > /tmp/shim/calls.log
pkill -9 -f /tmp/dshhost; sleep 1
cd /tmp/rp3; cp /tmp/zz-seed.bak tests/zz-seed-scratch.spec.ts; npx -y pnpm@11.7.0 vitest run tests/zz-seed-scratch.spec.ts 2>&1 | grep -aE "Tests "; rm tests/zz-seed-scratch.spec.ts
snap "c0-seeded"
sleep 33; : > /tmp/overlay2/events.log; touch /tmp/overlay2/hang-after-create
cd /tmp/dshhost; npx dsh superagent --patch /tmp/overlay2/patch.yml --no-open > $OUT/boot1.log 2>&1 &
note "boot1 launched (hang after create)"; for i in $(seq 1 60); do grep -aq "hanging after create" /tmp/overlay2/events.log 2>/dev/null && break; sleep 1; done; sleep 1
snap "c1-at-kill-point"; tail -5 /tmp/overlay2/events.log; killhost
snap "c2-after-SIGKILL"
rm -f /tmp/overlay2/hang-after-create; cp /tmp/overlay2/events.log $OUT/events-boot1.log
if [ "$MODE" = ended ]; then cd /tmp/rp3; cp /tmp/zz-end.bak tests/zz-end-scratch.spec.ts; npx -y pnpm@11.7.0 vitest run tests/zz-end-scratch.spec.ts 2>&1 | grep -aE "Tests "; rm tests/zz-end-scratch.spec.ts; snap "c3-ticket-ended"; fi
sleep 33; : > /tmp/overlay2/events.log
cd /tmp/dshhost; npx dsh superagent --patch /tmp/overlay2/patch.yml --no-open > $OUT/boot2.log 2>&1 &
note "boot2 launched"; sleep 22; snap "c4-after-boot2"; tail -6 /tmp/overlay2/events.log; killhost
cp /tmp/overlay2/events.log $OUT/events-boot2.log; for f in boot1 boot2; do sed -E 's/token=[^ &]*/token=REDACTED/g' $OUT/$f.log > $OUT/b && mv $OUT/b $OUT/$f.log; done; 
