"""Paired descriptive analysis. Never admits these runs as field/G003 evidence."""
import json,random,statistics,sys,hashlib
from pathlib import Path
root=Path(__file__).resolve().parent
def median(a):return statistics.median(a)
def q(a,p):
 s=sorted(a);i=(len(s)-1)*p;lo=int(i);hi=min(lo+1,len(s)-1);return s[lo]+(s[hi]-s[lo])*(i-lo)
def stats(a):return {'n':len(a),'median':median(a),'min':min(a),'max':max(a),'mad':median([abs(x-median(a)) for x in a])}
def bootstrap(pairs,block=False):
 rng=random.Random(20260930+(1 if block else 0));d=[]
 for _ in range(10000):
  if block:
   blocks=[pairs[i:i+2] for i in range(0,len(pairs)-1,2)]
   s=sum([rng.choice(blocks) for _ in blocks],[])+pairs[-1:]
  else:s=[rng.choice(pairs) for _ in pairs]
  d.append(median([x for x,y in s])-median([y for x,y in s]))
 return [q(d,.025),q(d,.975)]
def load(d):return json.loads((root/d/'raw.json').read_text())
def pairing(raw,count,aa=False):
 out=[]
 for i in range(9):
  rows=[r for r in raw['raw'] if r['count']==count and r['pair']==i]
  assert len(rows)==2 and all(r['valid'] for r in rows)
  if aa:out.append(sorted(rows,key=lambda r:r['position']))
  else:out.append([next(r for r in rows if r['kind']==k) for k in ['baseline','candidate']])
 return out

if __name__=='__main__':
 ab_dir=sys.argv[1];aa_dir=sys.argv[2];out=sys.argv[3]
 raw=load(ab_dir);result={'schema':'memory-ui-trial.v1','source':ab_dir+'/raw.json','aaSource':aa_dir+'/raw.json','resamples':10000,'seed':20260930,'fieldAdmitted':0,'canonicalTimingAdmitted':0,'independentDriverExecutions':1,'limitations':['n9pairs per cell; no user-latency p95','consoleCSP errors remain','natural heap and forcedGC diagnostic differ','sampleCIs do not eliminate host/provider/time bias'],'cells':{}}
 for count in sorted(set(r['count'] for r in raw['raw'])):
  paired=pairing(raw,count);aa=pairing(load(aa_dir),count,True)
  noise=q([abs(a['state']['clickMs']-b['state']['clickMs']) for a,b in aa],.95);drift=abs(median([a['state']['clickMs'] for a,b in aa])-median([b['state']['clickMs'] for a,b in aa]))
  cell={'count':count,'measuredPairs':9,'warmupPairs':2,'aa95AbsoluteDeltaMs':noise,'aaMedianDriftMs':drift,'metrics':[]}
  for name,get in [('clickMs',lambda r:r['state']['clickMs']),('naturalHeapBytes',lambda r:r['heap']['usedSize']),('gcDiagnosticHeapBytes',lambda r:r['gc']['usedSize']),('markerCount',lambda r:r['state']['markerCount']),('longTaskMs',lambda r:r['state']['longTaskMs']),('maxFrameGapMs',lambda r:r['state']['maxFrameGapMs'])]:
   pairs=[(get(a),get(b)) for a,b in paired];before,after=stats([a for a,b in pairs]),stats([b for a,b in pairs]);delta=before['median']-after['median'];ci=bootstrap(pairs);blockci=bootstrap(pairs,True);floor=max(25,before['median']*.15,noise,drift) if name=='clickMs' else None
   entry={'metric':name,'before':before,'after':after,'absoluteReduction':delta,'relativeReductionPercent':delta/before['median']*100 if before['median']>0 else None,'pairedCi95':ci,'abbaBlockCi95':blockci,'noiseFloor':floor}
   if name=='clickMs':entry.update({'latencyRegressionBudgetPass':after['median']<=before['median']*1.15,'descriptiveImprovementAboveNoise':min(ci[0],blockci[0])>floor})
   if name=='naturalHeapBytes':entry['naturalHeap20PercentBudgetPass']=after['median']<=before['median']*1.2
   cell['metrics'].append(entry)
  result['cells'][str(count)]=cell
 with (root/out).open('x') as f:json.dump(result,f,indent=2);f.write('\n')
 for n,c in result['cells'].items():print(n,json.dumps([{k:v for k,v in m.items() if k not in ['before','after']}|{'beforeMedian':m['before']['median'],'afterMedian':m['after']['median']} for m in c['metrics'][:3]]))
