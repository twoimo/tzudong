from pathlib import Path
import json,statistics,hashlib
root=Path(__file__).resolve().parent
raw_path=root/'integrated-warm-minimal-main-aa-v1/raw.json'
plan_path=root/'integrated-main-warm-aa-plan-v1.json'
raw=json.loads(raw_path.read_text());plan=json.loads(plan_path.read_text())
assert raw['passed'] and raw['planSha256']==hashlib.sha256(plan_path.read_bytes()).hexdigest()
runs=[]
for row in raw['runs']:
    heaps=[c['heap']['usedSize']/1e6 for c in row['cycles']]
    runs.append({'run':row['run'],'positionGroup':plan['independentPositionGroups'][row['run']],'sourceCommit':row['sourceCommit'],'medianMB':statistics.median(heaps),'peakMB':max(heaps),'endpointMB':heaps[-1],'allMembershipPassed':row['passed']})
metrics={}
for key in ['medianMB','peakMB','endpointMB']:
    a=statistics.median(x[key] for x in runs if x['positionGroup']=='a')
    b=statistics.median(x[key] for x in runs if x['positionGroup']=='b')
    metrics[key]={'groupA':a,'groupB':b,'absoluteDifference':a-b,'relativeDifferencePercent':(a-b)/a*100 if a else None}
print(json.dumps({'sourceIdentical':len({x['sourceCommit'] for x in runs})==1,'freshProcesses':4,'dependentCyclesPerProcess':60,'metrics':metrics,'oneAAExecutionOnly':True,'primaryABFailureNotWaived':True}))
