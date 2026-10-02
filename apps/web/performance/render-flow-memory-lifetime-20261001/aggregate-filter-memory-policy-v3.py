"""Process medians are the independent units, not individual repeated cycles."""
import json, statistics, sys, runpy
from pathlib import Path
root=Path(__file__).resolve().parent
helper=runpy.run_path(str(root/'aggregate-memory-trials.py'))
median=statistics.median;stats=helper['stats'];bootstrap=helper['bootstrap']
ab=json.loads((root/sys.argv[1]/'raw.json').read_text());aa=json.loads((root/sys.argv[2]/'raw.json').read_text())
assert ab['passed'] and aa['passed']
def pair_runs(raw):
 pairs=[]
 for i in sorted(set(r['pair'] for r in raw['runs'])):
  rows=sorted([r for r in raw['runs'] if r['pair']==i],key=lambda r:r['position'])
  assert len(rows)==2 and all(r['passed'] for r in rows)
  if not raw['aa']: rows=[next(r for r in rows if r['kind']==k) for k in ['baseline','candidate']]
  pairs.append(rows)
 return pairs
pairs=pair_runs(ab);ap=pair_runs(aa)
expected={k:set(next(r for r in ab['runs'] if r['kind']==k)['expectedIds']) for k in ['baseline','candidate']}
assert len(expected['baseline'])==571 and len(expected['candidate'])==571
for raw in [ab,aa]:
 for run in raw['runs']:
  for c in run['cycles']:
   o=c['observed'];assert o['probe']['trusted'] and o['mapCreates']==1 and o['overflow']==0
   assert len(o['ids'])==len(expected[run['kind']]) and set(o['ids'])==expected[run['kind']]
get_latency=lambda r:median([c['latencyMs'] for c in r['cycles'] if not c['warmup']])
get_heap=lambda r:median([c['heap']['usedSize'] for c in r['cycles'] if not c['warmup']])
noise=max(abs(get_latency(a)-get_latency(b)) for a,b in ap)
drift=abs(median([get_latency(a) for a,b in ap])-median([get_latency(b) for a,b in ap]))
result={'source':sys.argv[1]+'/raw.json','aaSource':sys.argv[2]+'/raw.json','independentDriverExecutions':1,'freshProcessesPerVariant':len(pairs),'measuredCyclesPerProcess':3,'warmupCyclesPerProcess':1,'aaPairs':len(ap),'maxAbsoluteAAPairedDeltaMs':noise,'aaMedianDriftMs':drift,'resamples':10000,'seed':20260930,'noUserP95':True,'exactMarkerMembershipAcrossRuns':True,'fieldAdmitted':0,'canonicalTimingAdmitted':0,'limitations':['CIs do not remove external host/SDK/time bias','metric endpoint is DOM visibility, not complete pixel/composite','natural transient heap is separate from long term RSS/leak'],'metrics':[]}
for name,get in [('latencyMs',get_latency),('naturalHeapBytes',get_heap)]:
 xs=[(get(a),get(b)) for a,b in pairs];b=stats([x for x,y in xs]);a=stats([y for x,y in xs]);delta=b['median']-a['median'];ci=bootstrap(xs);bc=bootstrap(xs,True)
 m={'metric':name,'before':b,'after':a,'absoluteReduction':delta,'relativeReductionPercent':delta/b['median']*100 if b['median']>0 else None,'pairedCi95':ci,'abbaBlockCi95':bc}
 if name=='latencyMs':
  floor=max(25,b['median']*.15,noise,drift);m.update(noiseFloor=floor,latency15PercentBudgetPass=a['median']<=b['median']*1.15,descriptiveImprovementAboveNoise=min(ci[0],bc[0])>floor)
 else:m.update(naturalHeap20PercentBudgetPass=a['median']<=b['median']*1.2)
 result['metrics'].append(m)
with (root/sys.argv[3]).open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps(result,indent=2))
