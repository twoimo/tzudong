"""Reproduce the saved warm-window calculation into a fresh output file."""
from pathlib import Path
import json,re,statistics,sys
root=Path(__file__).resolve().parent
label=sys.argv[1];assert re.fullmatch(r'[a-z0-9-]+',label)
raw=json.loads((root/'integrated-warm-minimal-main-v1/raw.json').read_text())
plan=json.loads((root/'integrated-main-warm-plan-v1.json').read_text())
assert raw['passed'] and len(raw['runs'])==4
runs=[]
def q(values,p):
    a=sorted(values);pos=(len(a)-1)*p;i=int(pos)
    return a[i]+(a[min(i+1,len(a)-1)]-a[i])*(pos-i)
for r in raw['runs']:
    heaps=[c['heap']['usedSize']/1e6 for c in r['cycles']]
    gaps=[f['gap'] for c in r['cycles'] for f in c['state']['frames']]
    runs.append({'run':r['run'],'kind':r['kind'],'medianHeapMB':statistics.median(heaps),'peakHeapMB':max(heaps),'endpointHeapMB':heaps[-1],'initialHeapMB':r['initialHeap']['usedSize']/1e6,'endpointGrowthMB':heaps[-1]-r['initialHeap']['usedSize']/1e6,'frameSamples':len(gaps),'frameGapP95Ms':q(gaps,.95),'frameGapMaxMs':max(gaps),'gapsAbove50Ms':sum(v>50 for v in gaps),'longTaskMs':sum(c['state']['longTaskMs'] for c in r['cycles']),'allExactMembership':r['passed']})
metrics={}
for name in ('medianHeapMB','peakHeapMB','endpointHeapMB','frameGapP95Ms','frameGapMaxMs','gapsAbove50Ms','longTaskMs'):
    a=[r[name] for r in runs if r['kind']=='baseline'];b=[r[name] for r in runs if r['kind']=='candidate']
    ma=statistics.median(a);mb=statistics.median(b)
    tol=20 if 'Heap' in name else 15 if name=='frameGapP95Ms' else None
    metrics[name]={'before':ma,'after':mb,'beforeProcessRange':[min(a),max(a)],'afterProcessRange':[min(b),max(b)],'absoluteReduction':ma-mb,'absoluteDifferenceBelowReportingResolution':name=='frameGapP95Ms' and abs(ma-mb)<.1,'relativeReductionPercent':(ma-mb)/ma*100 if ma>0 and not (name=='frameGapP95Ms' and abs(ma-mb)<.1) else None,'guardTolerancePercent':tol,'guardPassed':mb<=ma*(1+tol/100) if tol is not None else None,'noiseSeparatedImprovementProven':False,'ci':None}
result={'raw':'integrated-warm-minimal-main-v1/raw.json','runs':runs,'metrics':metrics,'freshProcessesPerVariant':2,'dependentCyclesPerProcess':60,'independentDevices':0,'mobileEmulation':True,'cpuRate':4,'actualSdk':True,'forcedGC':False,'fieldAdmitted':0,'canonicalTimingAdmitted':0,'regressionGuardsPassed':all(m['guardPassed'] for m in metrics.values() if m['guardPassed'] is not None),'limitations':['no independently matched warm A/A; n2 processes per variant, no population confidence interval','positive within-process natural-heap growth remains visible and is not evidence of a resolved leak','rAF p95 refers to thousands of frame gaps within each finite process window, not user latency p95','production builds use exact git source with identical small-set retention; later type-only output equivalence is separate from a final deployment readback']}
with(root/f'integrated-warm-minimal-summary-{label}.json').open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps({'regressionGuardsPassed':result['regressionGuardsPassed'],'output':f'integrated-warm-minimal-summary-{label}.json'}))
