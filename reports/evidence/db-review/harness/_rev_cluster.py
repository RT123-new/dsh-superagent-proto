import json,sys,math,random
rows=json.load(open(sys.argv[1])); random.seed(20261104)
by={}
for r in rows: by.setdefault(r['seed'],[]).append(r)
seeds=sorted(by)
def p95(v): v=sorted(v); return v[math.ceil(.95*len(v))-1]
def p50(v): v=sorted(v); return v[math.ceil(.5*len(v))-1]
print('pairs',len(rows),'clusters',len(seeds),'mismatch',sum(1 for r in rows if not r['match']))
for q,qr in (('stats','statsRep'),('flow','flowRep')):
  for nm,fn in (('P50',p50),('P95',p95)):
    def gain(rs): b=fn([r[q] for r in rs]); c=fn([r[qr] for r in rs]); return 100*(b-c)/b
    pt=gain(rows); bs=[]
    for _ in range(10000):
        pick=[random.choice(seeds) for _ in seeds]  # resample clusters (seeds), keep all pairs within a cluster
        rs=[r for s in pick for r in by[s]]; bs.append(gain(rs))
    bs.sort(); per=[round(gain(by[s]),1) for s in seeds]
    print(q,nm,f'gain {pt:.1f}% cluster-bootstrap 95% CI [{bs[249]:.1f}, {bs[9749]:.1f}] per-seed {per} slower-pairs {sum(1 for r in rows if r[qr]>r[q])}')
