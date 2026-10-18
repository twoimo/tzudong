"""Read-only current PR checks/reviews, exact-head bound; no merge or resolution."""
import collections,datetime,json,re,subprocess,sys
from pathlib import Path
number,sha,label=sys.argv[1:]
if not number.isdigit() or not re.fullmatch('[a-f0-9]{40}',sha) or not re.fullmatch('[a-z0-9-]+',label):raise ValueError('INVALID_INPUT')
root=Path(__file__).resolve().parent;out=root/(label+'.json')
if out.exists():raise ValueError('PRESERVE_EXISTING_RECEIPT')
def run(args):return json.loads(subprocess.check_output(args,text=True))
x=run(['gh','pr','view',number,'--repo','twoimo/tzudong','--json','number,state,headRefOid,baseRefOid,baseRefName,mergeStateStatus,mergeCommit,statusCheckRollup,mergedAt,url'])
if x['headRefOid']!=sha:raise ValueError('HEAD_CHANGED')
q='query { repository(owner:"twoimo", name:"tzudong") { pullRequest(number:'+number+') { reviewThreads(first:100) { nodes { id isResolved path line } pageInfo { hasNextPage } } } } }'
t=run(['gh','api','graphql','-f','query='+q])['data']['repository']['pullRequest']['reviewThreads']
if t['pageInfo']['hasNextPage']:raise ValueError('REVIEW_PAGE_INCOMPLETE')
cs=x.pop('statusCheckRollup');x['checks']=[{k:c[k] for k in ['name','context','status','conclusion','state','detailsUrl','targetUrl'] if k in c} for c in cs]
x['counts']=dict(collections.Counter(c.get('conclusion') or c.get('state') or c.get('status') for c in cs))
x['unresolved']=[c for c in t['nodes'] if not c['isResolved']]
x['pending']=[c for c in x['checks'] if c.get('status') not in [None,'COMPLETED'] or c.get('state')=='PENDING']
x['failed']=[c for c in x['checks'] if (c.get('conclusion') or c.get('state')) in ['FAILURE','CANCELLED','TIMED_OUT','ACTION_REQUIRED','ERROR','FAIL']]
required=subprocess.run(['gh','pr','checks',number,'--repo','twoimo/tzudong','--required','--json','name,state,bucket,link'],capture_output=True,text=True)
x['requiredChecks']=json.loads(required.stdout)
x['requiredCommandExitCode']=required.returncode
x['requiredSuccess']=required.returncode==0 and all(any(c['name']==name and c['bucket']=='pass' for c in x['requiredChecks']) for name in ['Release','Promotion Path'])
x['allChecksCompleted']=not x['pending'];x['observedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat()
with out.open('x') as f:json.dump(x,f,indent=2);f.write('\n')
print(json.dumps({k:x[k] for k in ['number','state','headRefOid','mergeStateStatus','counts','requiredSuccess','allChecksCompleted']}|{'unresolved':len(x['unresolved']),'failed':len(x['failed'])}))
