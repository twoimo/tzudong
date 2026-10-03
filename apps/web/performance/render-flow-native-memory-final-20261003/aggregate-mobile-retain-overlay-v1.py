"""Paired natural-heap/latency regression analysis; no physical/field extrapolation."""
from pathlib import Path
import hashlib,json,random,statistics,sys

root=Path(__file__).resolve().parent
aa_path=root/'mobile-retain-ui-ret-overlay-v1-aa/raw.json'
ab_path=root/'mobile-retain-ui-ret-overlay-v1-ab/raw.json'
plan_bytes=(root/'mobile-retain-overlay-plan-v1.json').read_bytes()
plan=json.loads(plan_bytes);plan_hash=hashlib.sha256(plan_bytes).hexdigest()
aa=json.loads(aa_path.read_text());ab=json.loads(ab_path.read_text())
assert aa['planSha256']==ab['planSha256']==plan_hash
assert aa['passed'] and ab['passed'] and all(x['valid'] for x in aa['raw']+ab['raw'])
rng=random.Random(20261004)
def q(values,proportion):
    values=sorted(values);pos=(len(values)-1)*proportion;i=int(pos)
    return values[i]+(values[min(i+1,len(values)-1)]-values[i])*(pos-i)
def stats(values):
    center=statistics.median(values)
    return {'n':len(values),'median':center,'mad':statistics.median(abs(v-center) for v in values),'range':[min(values),max(values)]}
def boot(before,after,block=False):
    samples=[];n=len(before);groups=[list(range(i,min(i+2,n))) for i in range(0,n,2)]
    for _ in range(10000):
        if block:indices=[i for group in rng.choices(groups,k=len(groups)) for i in group]
        else:indices=[rng.randrange(n) for _ in range(n)]
        samples.append(statistics.median(before[i] for i in indices)-statistics.median(after[i] for i in indices))
    return [q(samples,.025),q(samples,.975)]
def paired(rows,count,is_aa=False):
    result=[]
    for pair in range(plan['processPairs']):
        cell=[r for r in rows if r['count']==count and r['pair']==pair and not r['warmup']]
        assert len(cell)==2
        if is_aa:cell.sort(key=lambda r:r['position'])
        else:cell.sort(key=lambda r:0 if r['kind']=='baseline' else 1)
        result.append(cell)
    return result
result={'planSha256':plan_hash,'aaRaw':str(aa_path.relative_to(root)),'abRaw':str(ab_path.relative_to(root)),'freshProcessesPerVariantPerCell':9,'warmupProcessesPerVariantPerCell':2,'clusterInteractionsPerFreshProcess':1,'bootstrapResamples':10000,'bootstrapSeed':20261004,'forcedGC':False,'fieldAdmitted':0,'canonicalTimingAdmitted':0,'cells':{},'limitations':['one driver execution for A/A and one for A/B','actual SDK with synthetic REST data, mobile emulation is not a physical phone','CIs do not remove SDK/network/time/GC-phase confounding','no p95 at n9; no 2000 A/A','natural heap includes transient allocation; no leak-absence claim']}
for count in plan['abCounts']:
    pairs=paired(ab['raw'],count)
    aa_pairs=paired(aa['raw'],count,True) if count in plan['aaCounts'] else None
    noise=q([abs(a['state']['clickMs']-b['state']['clickMs']) for a,b in aa_pairs],.95) if aa_pairs else None
    drift=abs(statistics.median(a['state']['clickMs'] for a,b in aa_pairs)-statistics.median(b['state']['clickMs'] for a,b in aa_pairs)) if aa_pairs else None
    cell={'count':count,'aaPairs':len(aa_pairs) if aa_pairs else 0,'aa95AbsoluteDeltaMs':noise,'aaMedianDriftMs':drift,'metrics':{}}
    for name,get,unit,tolerance in [
        ('clickMs',lambda r:r['state']['clickMs'],'ms',plan['latencyRegressionTolerancePercent']),
        ('naturalHeapMB',lambda r:r['heap']['usedSize']/1e6,'MB',plan['naturalHeapRegressionTolerancePercent']),
        ('longTaskMs',lambda r:r['state']['longTaskMs'],'ms',None),
        ('domNodes',lambda r:r['state']['domNodes'],'nodes',None)
    ]:
        before=[get(a) for a,b in pairs];after=[get(b) for a,b in pairs];sa,sb=stats(before),stats(after)
        delta=sa['median']-sb['median'];ci=boot(before,after);bci=boot(before,after,True)
        entry={'unit':unit,'before':sa,'after':sb,'absoluteReduction':delta,'relativeReductionPercent':delta/sa['median']*100 if sa['median']>0 else None,'pairedReductionCI95':ci,'abbaBlockReductionCI95':bci,'regressionTolerancePercent':tolerance,'medianRegressionGuardPassed':sb['median']<=sa['median']*(1+tolerance/100) if tolerance is not None else None,'improvementClaimed':False}
        if name=='clickMs':
            floor=max(25,sa['median']*plan['noiseFloorRelativePercent']/100,noise,drift) if aa_pairs else None
            entry['noiseFloorMs']=floor
            entry['improvementAboveNoise']=min(ci[0],bci[0])>floor if floor is not None else False
            entry['judgement']='improvement_proven_in_this_lab_window' if entry['improvementAboveNoise'] else 'improvement_not_proven'
            entry['improvementClaimed']=entry['improvementAboveNoise']
        elif name=='naturalHeapMB':
            entry['judgement']='fixed_regression_budget_passed' if entry['medianRegressionGuardPassed'] else 'fixed_regression_budget_failed'
            entry['aa95AbsoluteDeltaMB']=q([abs(get(a)-get(b)) for a,b in aa_pairs],.95) if aa_pairs else None
        cell['metrics'][name]=entry
    cell['regressionGuardsPassed']=all(cell['metrics'][name]['medianRegressionGuardPassed'] for name in ('clickMs','naturalHeapMB'))
    cell['beforeMarkerCounts']=sorted({a['state']['markers'] for a,b in pairs});cell['afterMarkerCounts']=sorted({b['state']['markers'] for a,b in pairs})
    result['cells'][str(count)]=cell
result['regressionGuardsPassed']=all(cell['regressionGuardsPassed'] for cell in result['cells'].values())
with(root/'mobile-retain-overlay-summary-v1.json').open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps({'regressionGuardsPassed':result['regressionGuardsPassed'],'cells':{key:{'beforeHeapMB':cell['metrics']['naturalHeapMB']['before']['median'],'afterHeapMB':cell['metrics']['naturalHeapMB']['after']['median'],'beforeClickMs':cell['metrics']['clickMs']['before']['median'],'afterClickMs':cell['metrics']['clickMs']['after']['median'],'speedJudgement':cell['metrics']['clickMs']['judgement']} for key,cell in result['cells'].items()}}))
