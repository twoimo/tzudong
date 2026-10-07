from pathlib import Path
import json,hashlib,statistics,random,sys
root=Path(__file__).resolve().parent
label=sys.argv[1];raw_path=root/f'warm-{label}/raw.json';raw=json.loads(raw_path.read_text());plan_path=root/f'warm-{label}-plan.json';plan=json.loads(plan_path.read_text());assert raw['passed'] and raw['planSha256']==hashlib.sha256(plan_path.read_bytes()).hexdigest()
def q(v,p):
 a=sorted(v);pos=(len(a)-1)*p;i=int(pos);return a[i]+(a[min(i+1,len(a)-1)]-a[i])*(pos-i)
runs=[]
for r in raw['runs']:
 heaps=[c['heap']['usedSize']/1e6 for c in r['cycles']];frames=[f['gap'] for c in r['cycles'] for f in c['state']['frames']]
 runs.append({'run':r['run'],'kind':r['kind'],'source':r['sourceCommit'],'browser':r['browser'],'medianHeapMB':statistics.median(heaps),'peakHeapMB':max(heaps),'endpointHeapMB':heaps[-1],'initialHeapMB':r['initialHeap']['usedSize']/1e6,'frameGapP95Ms':q(frames,.95),'frameGapMaxMs':max(frames),'gapsAbove50Ms':sum(v>50 for v in frames),'longTaskMs':sum(c['state']['longTaskMs'] for c in r['cycles']),'membershipPassed':r['passed']})
is_aa=label.startswith('aa-');aa_file=root/'warm-summary-aa-current-v4.json';aa=json.loads(aa_file.read_text()) if aa_file.exists() and not is_aa else None;metrics={};rnd=random.Random(20261007)
for k in ['medianHeapMB','peakHeapMB','endpointHeapMB','frameGapP95Ms','frameGapMaxMs','gapsAbove50Ms','longTaskMs']:
 a=[x[k] for x in runs if x['kind']=='baseline'];b=[x[k] for x in runs if x['kind']=='candidate'];ma=statistics.median(a);mb=statistics.median(b);delta=ma-mb;tol=20 if 'Heap' in k else 15 if k=='frameGapP95Ms' else None;floor=.1 if k.startswith('frame') else 0
 metric={'before':ma,'after':mb,'absoluteReduction':delta,'relativeReductionPercent':delta/ma*100 if ma>0 and abs(delta)>=floor else None,'beforeProcessRange':[min(a),max(a)],'afterProcessRange':[min(b),max(b)],'independentProcessesPerSource':len(a),'guardTolerancePercent':tol,'guardPassed':mb<=ma*(1+tol/100) if tol is not None and not is_aa else None,'ci95MedianPairedAbsoluteReduction':None,'noiseFloorAbsolute':abs(aa['metrics'][k]['absoluteReduction']) if aa else None,'gainProven':False,'reportingFloor':floor}
 if len(a)>=9 and not is_aa:
  pairs=[sorted(runs[i:i+2],key=lambda x:0 if x['kind']=='baseline' else 1) for i in range(0,len(runs),2)];assert all(p[0]['kind']=='baseline' and p[1]['kind']=='candidate' for p in pairs)
  diffs=[p[0][k]-p[1][k] for p in pairs];boots=[statistics.median([diffs[rnd.randrange(len(diffs))] for _ in diffs]) for _ in range(20000)];ci=[q(boots,.025),q(boots,.975)];metric['ci95MedianPairedAbsoluteReduction']=ci;metric['medianPairedAbsoluteReduction']=statistics.median(diffs);metric['gainProven']=bool(ci[0]>0 and metric['noiseFloorAbsolute'] is not None and delta>metric['noiseFloorAbsolute'] and abs(delta)>=floor)
 metrics[k]=metric
result={'sourceRuns':runs,'metrics':metrics,'raw':str(raw_path.relative_to(root)),'aa':is_aa,'freshProcessesPerSource':len([x for x in runs if x['kind']=='baseline']),'dependentCyclesPerProcess':60,'physicalDevices':0,'fieldAdmitted':0,'canonicalTimingAdmitted':0,'allFixedGuardsPassed':all(x['guardPassed'] for x in metrics.values() if x['guardPassed'] is not None) if not is_aa else None,'limitations':['Natural heaps include GC phases; no forcedGC during primary','CI resamples independent adjacent process-pair deltas, not60dependent cycles','n9 does not support end-user population p95; frame p95 is within a finite lab window','A/A is one4process execution; prior different Chrome patch22.15% variation remains disclosed','No field or physical-device gain inferred from lab observations']}
with(root/f'warm-summary-{label}.json').open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps({'label':label,'guardsPassed':result['allFixedGuardsPassed'],'metrics':metrics}))
