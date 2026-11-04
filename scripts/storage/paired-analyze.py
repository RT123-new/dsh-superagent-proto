"""Paired analysis: nearest-rank P95 and 10k paired bootstrap (resampling task pairs, identity preserved)."""
import json,glob,math,random,sys
D=sys.argv[1]; random.seed(20261104)
pairs=[]
for f in sorted(glob.glob(f'{D}/base-*.json')):
    seed=f.split('base-')[1][:-5]; b=json.load(open(f)); r=json.load(open(f'{D}/rep-{seed}.json'))
    for x,y in zip(b,r):
        assert (x['seed'],x['k'])==(y['seed'],y['k'])
        pairs.append((x,y))
mism=sum(1 for x,y in pairs if x['statsResult']!=y['statsResult'] or x['flowResult']!=y['flowResult'])
def p95(v): v=sorted(v); return v[math.ceil(0.95*len(v))-1]
def med(v): v=sorted(v); return v[math.ceil(0.5*len(v))-1]
out=[f"pairs={len(pairs)} seeds={len(set(x['seed'] for x,_ in pairs))} result-mismatches={mism}",""]
out+=["| query | stat | baseline ms | repaired ms | paired ratio base/rep | 95% bootstrap CI of ratio (10k) |","|---|---|---|---|---|---|"]
for q in ('stats','flow'):
    b=[x[q] for x,_ in pairs]; r=[y[q] for _,y in pairs]; n=len(b)
    for name,fn in (('P50',med),('P95',p95)):
        ratios=[]
        for _ in range(10000):
            idx=[random.randrange(n) for _ in range(n)]
            ratios.append(fn([b[i] for i in idx])/fn([r[i] for i in idx]))
        ratios.sort()
        out.append(f"| {'triggerStats' if q=='stats' else 'flow'} | {name} | {fn(b):.2f} | {fn(r):.2f} | {fn(b)/fn(r):.1f}x | {ratios[249]:.1f}x - {ratios[9749]:.1f}x |")
    pr=sorted(x/y for x,y in zip(b,r)); out.append(f"| {q} | per-pair ratio min/median/max | | | {pr[0]:.1f} / {med(pr):.1f} / {pr[-1]:.1f} | pairs where repaired slower: {sum(1 for x,y in zip(b,r) if y>x)} |")
print("\n".join(out))
