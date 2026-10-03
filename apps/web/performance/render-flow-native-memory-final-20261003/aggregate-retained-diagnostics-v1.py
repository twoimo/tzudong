"""Reproduce bounded SDK ownership/GC/type totals; never waive natural budgets."""
from pathlib import Path
import collections,json,re,sys
root=Path(__file__).resolve().parent;label=sys.argv[1];assert re.fullmatch(r'[a-z0-9-]+',label)
result={'rawForcedGcDiagnosticOnly':True,'primaryBudgetWaived':False,'fieldAdmitted':0,'cells':{}}
for kind in ('baseline','candidate'):
    raw=json.loads((root/f'retained-heap-{kind}-v1/raw.json').read_text());assert raw['passed']
    a,b,c=raw['checkpoints'];profile=json.loads((root/f'retained-heap-{kind}-v1/sanitized-cpu-profile.json').read_text())
    nodes={n['id']:n for n in profile['nodes']};source=collections.Counter()
    for i,sample in enumerate(profile['samples']):source[nodes[sample]['callFrame']['source']]+=profile['timeDeltas'][i]
    result['cells'][kind]={'raw':f'retained-heap-{kind}-v1/raw.json','gcUsedMB':[x['gc']['usedSize']/1e6 for x in raw['checkpoints']],'initialToFinalGcGrowthMB':(c['gc']['usedSize']-a['gc']['usedSize'])/1e6,'lastHalfGcGrowthMB':(c['gc']['usedSize']-b['gc']['usedSize'])/1e6,'codeSelfBytesGrowth':c['heapTypeTotals']['code']['selfBytes']-a['heapTypeTotals']['code']['selfBytes'],'objectSelfBytesGrowth':c['heapTypeTotals']['object']['selfBytes']-a['heapTypeTotals']['object']['selfBytes'],'capturedSdkMarkersCreated':c['ownership']['created'],'capturedSdkMarkersLive':c['ownership']['live'],'detachedMarkerAppCallbacks':c['ownership']['detachedWithAppClick'],'sdkSetters':c['ownership']['setters'],'cpuSampleTimeBySourceMs':{key:value/1000 for key,value in source.items()}}
result['limitations']=['one fresh process per variant with forcedGC/snapshot/profiler overhead, not a primary performance comparison','captured public SDK Marker objects stayed bounded; not every SDK object or leak-free proof','snapshot native self-bytes and Runtime JS usedSize differ; do not sum them as one heap metric','GC retained growth includes code/JIT and other runtime state; categorical totals do not identify every retainer','profile URL/body/strings were discarded; sampled source class is diagnostic not complete browser rendering time']
with(root/f'retained-heap-diagnostic-summary-{label}.json').open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps({'output':f'retained-heap-diagnostic-summary-{label}.json','primaryBudgetWaived':False}))
