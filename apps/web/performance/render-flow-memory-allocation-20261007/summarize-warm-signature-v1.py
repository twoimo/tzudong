from pathlib import Path
import json,statistics,hashlib,sys
root=Path(__file__).resolve().parent
label=sys.argv[1]
raw_path=root/f'warm-signature-{label}/raw.json';raw=json.loads(raw_path.read_text())
plan_path=root/'warm-signature-plan-v3.json';plan=json.loads(plan_path.read_text())
assert raw['planSha256']==hashlib.sha256(plan_path.read_bytes()).hexdigest() and raw['passed']
def quantile(v,p):
 a=sorted(v);k=(len(a)-1)*p;i=int(k);return a[i]+(a[min(i+1,len(a)-1)]-a[i])*(k-i)
runs=[]
for r in raw['runs']:
 heaps=[c['heap']['usedSize']/1e6 for c in r['cycles']];gaps=[x['gap'] for c in r['cycles'] for x in c['state']['frames']]
 runs.append({'run':r['run'],'kind':r['kind'],'sourceCommit':r['sourceCommit'],'browser':r['browser'],'cycles':len(heaps),'medianHeapMB':statistics.median(heaps),'peakHeapMB':max(heaps),'endpointHeapMB':heaps[-1],'initialHeapMB':r['initialHeap']['usedSize']/1e6,'frameGapP95Ms':quantile(gaps,.95),'frameGapMaxMs':max(gaps),'frameSamples':len(gaps),'gapsAbove50Ms':sum(v>50 for v in gaps),'longTaskMs':sum(c['state']['longTaskMs'] for c in r['cycles']),'membershipPassed':r['passed']})
metrics={}
for k in ('medianHeapMB','peakHeapMB','endpointHeapMB','frameGapP95Ms','frameGapMaxMs','gapsAbove50Ms','longTaskMs'):
 a=[r[k] for r in runs if r['kind']=='baseline'];b=[r[k] for r in runs if r['kind']=='candidate'];ma=statistics.median(a);mb=statistics.median(b);delta=ma-mb;tol=20 if 'Heap' in k else 15 if k=='frameGapP95Ms' else None
 floor=.1 if k.startswith('frame') else 0
 metrics[k]={'before':ma,'after':mb,'absoluteReduction':delta,'relativeReductionPercent':delta/ma*100 if ma>0 and abs(delta)>=floor else None,'beforeProcessRange':[min(a),max(a)],'afterProcessRange':[min(b),max(b)],'guardTolerancePercent':tol,'guardPassed':mb<=ma*(1+tol/100) if tol is not None else None,'noiseSeparatedImprovementProven':False,'ci':None,'reportingFloor':floor}
result={'runs':runs,'metrics':metrics,'raw':str(raw_path.relative_to(root)),'freshProcessesPerVariant':len([r for r in runs if r['kind']=='baseline']),'dependentCyclesPerProcess':60,'actualSdk':True,'cpuRate':4,'forcedGCDuringPrimary':False,'profilingDuringPrimary':False,'physicalDevices':0,'fieldAdmitted':0,'canonicalTimingAdmitted':0,'allFixedGuardsPassed':all(x['guardPassed'] for x in metrics.values() if x['guardPassed'] is not None),'originalCa235ComparisonNotIncluded':True,'limitations':['n2 processes/source; no population CI or end-user p95','prior A/A was Chrome154.0.8037.97; current Chrome154.0.8037.98. Gain beyond matched current A/A is not established','Natural endpoints depend on GC timing; original failed20% memory guard is not waived by this matched-source pilot','No physical Galaxy, production, or field improvement from this local candidate']}
with (root/f'warm-signature-summary-{label}.json').open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps({'guardsPassed':result['allFixedGuardsPassed'],'metrics':metrics}))
