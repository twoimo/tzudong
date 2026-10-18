import subprocess,json,sys,datetime
from pathlib import Path
number, expected, label = sys.argv[1:]
if not number.isdigit() or len(expected)!=40 or not all(c in '0123456789abcdef' for c in expected): raise SystemExit('INVALID_INPUT')
if not label.replace('-','').isalnum():raise SystemExit('INVALID_LABEL')
def gh(*a):return json.loads(subprocess.check_output(['gh',*a],text=True))
p=gh('pr','view',number,'--repo','twoimo/tzudong','--json','number,url,state,headRefOid,baseRefName,headRefName,mergeStateStatus,mergeable,statusCheckRollup,mergeCommit,mergedAt')
if p['headRefOid']!=expected:raise SystemExit('HEAD_CHANGED')
q='query{repository(owner:"twoimo",name:"tzudong"){pullRequest(number:'+number+'){reviewThreads(first:100){pageInfo{hasNextPage} nodes{id isResolved isOutdated comments(first:1){nodes{path line body}}}}}}}'
t=gh('api','graphql','-f','query='+q)['data']['repository']['pullRequest']['reviewThreads']
if t['pageInfo']['hasNextPage']:raise SystemExit('THREADS_TRUNCATED')
checks=p['statusCheckRollup'];bad=[];counts={}
for c in checks:
 state=c.get('conclusion') or c.get('state') or c.get('status')
 counts[state]=counts.get(state,0)+1
 if state not in ['SUCCESS','NEUTRAL','SKIPPED']:bad.append(c.get('name') or c.get('context'))
unresolved=[x for x in t['nodes'] if not x['isResolved']]
required={c.get('name') or c.get('context') for c in checks if (c.get('conclusion') or c.get('state'))=='SUCCESS'}
requiredPresent={'Release','Promotion Path'}.issubset(required)
r={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'expectedHead':expected,'pr':p,'checkCounts':counts,'unresolvedThreads':unresolved,'requiredPresent':requiredPresent,'readyByObservedChecks':bool(checks) and requiredPresent and not bad and not unresolved,'badChecks':bad}
out=Path(__file__).parent/(label+'.json')
with out.open('x') as f:json.dump(r,f,indent=2,ensure_ascii=False);f.write('\n')
print(json.dumps({k:r[k] for k in ['observedAt','expectedHead','checkCounts','readyByObservedChecks','badChecks']}))
print('unresolvedThreads',len(unresolved));print('mergeStateStatus',p['mergeStateStatus'])
