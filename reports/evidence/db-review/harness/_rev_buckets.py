import json,math,sys
rows=json.load(open(sys.argv[1]))
def p95(v): v=sorted(v); return v[math.ceil(.95*len(v))-1]
for lo,hi in ((0,.25),(.25,.5),(.5,.75),(.75,1.01)):
  rs=[r for r in rows if lo<=1-r['frac']<hi]
  if rs:
    b=p95([r['flow'] for r in rs]);c=p95([r['flowRep'] for r in rs]);print('width',lo,hi,'n',len(rs),'flow P95 gain %.1f'%(100*(b-c)/b))
