"""Regression-only analysis; no matching 2000-row A/A speed claim."""
import json,hashlib
from pathlib import Path
import importlib.util
spec=importlib.util.spec_from_file_location('analysis',Path(__file__).resolve().parent/'aggregate-memory-trials.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
pairing,stats,bootstrap=m.pairing,m.stats,m.bootstrap
root=Path(__file__).resolve().parent
source=root/'desktop-ab-desktop-css-large-confirm-v1/raw.json'
raw=json.loads(source.read_text());paired=pairing(raw,2000)
result={'schema':'memory-ui-regression.v1','source':str(source.relative_to(root)), 'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'count':2000,'measuredPairs':9,'warmupPairs':2,'independentProcessesPerVariant':9,'matchingAaAvailable':False,'fieldAdmitted':0,'canonicalTimingAdmitted':0,'interpretation':'regression guard only; no proven speed improvement or 2000-row A/A noise estimate','metrics':[]}
for name,get,budget in [('clickMs',lambda r:r['state']['clickMs'],15),('naturalHeapBytes',lambda r:r['heap']['usedSize'],20),('gcDiagnosticHeapBytes',lambda r:r['gc']['usedSize'],None)]:
 pairs=[(get(a),get(b)) for a,b in paired];before=stats([a for a,b in pairs]);after=stats([b for a,b in pairs]);delta=before['median']-after['median'];ci=bootstrap(pairs);block=bootstrap(pairs,True)
 result['metrics'].append({'metric':name,'before':before,'after':after,'absoluteReduction':delta,'relativeReductionPercent':delta/before['median']*100 if before['median']>0 else None,'pairedCi95':ci,'abbaBlockCi95':block,'fixedRegressionTolerancePercent':budget,'medianTolerancePass': after['median']<=before['median']*(1+budget/100) if budget is not None else None, 'ciAbsoluteTolerancePass': min(ci[0],block[0])>=-before['median']*budget/100 if budget is not None else None})
result['semanticsPass']=all(r['valid'] and r['state']['markerCount']==992 and not r['state']['missingIds'] and not r['state']['unexpectedIds'] and r['state']['sdkMapCreates']==1 for pair in paired for r in pair)
with (root/'desktop-css-large-summary-v1.json').open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps(result,indent=2))
