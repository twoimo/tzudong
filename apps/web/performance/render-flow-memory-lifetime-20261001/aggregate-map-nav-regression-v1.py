import json,statistics,random
from pathlib import Path
p=Path(__file__).resolve().parent
data=json.loads((p/'mobile-emulation-ab-map-nav-mobile-regression-v2/raw.json').read_text())
rows=[r for r in data['raw'] if not r['warmup']]
assert len(rows)==18 and all(r['valid'] for r in data['raw'])
pair={i:{r['kind']:r for r in rows if r['pair']==i} for i in range(9)}
rng=random.Random(20261002)
def quantile(a,q):
 a=sorted(a);pos=(len(a)-1)*q;i=int(pos);return a[i]+(a[min(i+1,len(a)-1)]-a[i])*(pos-i)
def metric(get,tolerance,unit):
 a=[get(pair[i]['baseline']) for i in range(9)];b=[get(pair[i]['candidate']) for i in range(9)]
 ma,mb=statistics.median(a),statistics.median(b);delta=ma-mb
 boot=[]
 for _ in range(10000):
  idx=[rng.randrange(9) for _ in range(9)];aa=statistics.median(a[i] for i in idx);bb=statistics.median(b[i] for i in idx);boot.append(aa-bb)
 return {'unit':unit,'beforeMedian':ma,'afterMedian':mb,'absoluteReduction':delta,'relativeReductionPercent':delta/ma*100,'pairedBootstrapReductionCI95':[quantile(boot,.025),quantile(boot,.975)],'beforeMAD':statistics.median(abs(x-ma) for x in a),'afterMAD':statistics.median(abs(x-mb) for x in b),'beforeRange':[min(a),max(a)],'afterRange':[min(b),max(b)],'regressionTolerancePercent':tolerance,'regressionPercent':(mb-ma)/ma*100,'medianRegressionGuardPassed':mb<=ma*(1+tolerance/100),'improvementClaimed':False,'aANoise':'not measured for this mobile geometry; no noise-separated gain asserted'}
result={'scope':'final mobile map/navigation geometry guard, lab actual SDK, synthetic735, fresh Chrome processes; not physical-device or field memory','raw':'mobile-emulation-ab-map-nav-mobile-regression-v2/raw.json','freshProcessesPerVariant':9,'warmupProcessesPerVariant':2,'insideProcessMeasuredClusterExpansions':1,'clickMs':metric(lambda r:r['state']['clickMs'],15,'ms'),'naturalHeap':metric(lambda r:r['heap']['usedSize']/1e6,20,'MB'),'gcDiagnostic':metric(lambda r:r['gc']['usedSize']/1e6,20,'MB'),'allExactPaddedMembership':all(r['state']['markerCount']==464 and r['valid'] for r in data['raw']),'fixedCountsPreserved':True,'p95':'not reported; n9','limitations':['no mobile A/A matched noise floor','explicit GC after primary endpoint is diagnostic only','earlier desktop final-source trials remain bound to their own build source; no relabeling','two bounded CSP console incidents per lab sample remain retained; no security allowlist relaxed']}
result['regressionGuardsPassed']=result['clickMs']['medianRegressionGuardPassed'] and result['naturalHeap']['medianRegressionGuardPassed']
with (p/'map-nav-mobile-regression-summary-v1.json').open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps(result))
