"""Read current alias and bounded error-log result counts without retaining logs."""
from pathlib import Path
import subprocess,json,datetime
root=Path(__file__).resolve().parent
cli=['/opt/homebrew/opt/node@24/bin/node','/opt/homebrew/lib/node_modules/vercel/dist/index.js']
team='team_OUj64KeLxJI3PkEbOaFZnorA';pid='prj_sau35J5uUtShIQ9OKofRtOVVnTSl'
def get(path):
    r=subprocess.run([*cli,'api',path,'--scope',team,'--raw'],capture_output=True,text=True,timeout=35)
    assert r.returncode==0,'bounded hosted readback failed'
    return json.loads(r.stdout)
project=get('/v9/projects/tzudong')
assert project['id']==pid and project['name']=='tzudong' and project['rootDirectory']=='apps/web' and project['link']['repo']=='tzudong'
alias=get('/v4/aliases/www.tzudong.app');depId=alias.get('deployment',{}).get('id') or alias.get('deploymentId')
deployment=get('/v13/deployments/'+depId);assert deployment['projectId']==pid
current={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exactProjectVerified':True,'deployment':{'id':deployment['id'],'state':deployment.get('readyState',deployment.get('state')),'target':deployment.get('target'),'gitSha':deployment.get('meta',{}).get('githubCommitSha')},'alias':{'name':'www.tzudong.app','deploymentId':depId},'providerDiagnosticsRetained':False}
with(root/'current-production-v1.json').open('x') as f:
    json.dump(current,f,indent=2);f.write('\n')
end=datetime.datetime.now(datetime.timezone.utc);start=end-datetime.timedelta(minutes=45)
args=[*cli,'logs',depId,'--project',pid,'--scope',team,'--no-branch','--environment','production','--level','error','--since',start.isoformat(),'--until',end.isoformat(),'--limit','500','--json','--no-follow']
result=subprocess.run(args,capture_output=True,text=True,timeout=45)
records=[];undecoded=0
for line in result.stdout.splitlines():
    if not line.strip():continue
    try:
        item=json.loads(line)
        if isinstance(item,dict):records.append(item)
        else:undecoded+=1
    except ValueError:undecoded+=1
counts={}
for record in records:
    code=record.get('statusCode')
    if isinstance(code,int) and 100<=code<=599:
        key=str(code);counts[key]=counts.get(key,0)+1
summary={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'deploymentId':depId,'gitSha':current['deployment']['gitSha'],'window':{'start':start.isoformat(),'end':end.isoformat()},'filter':'level error, exact production deployment, no branch detection','limit':500,'cliExit':result.returncode,'returnedJsonObjects':len(records),'undecodedStdoutLines':undecoded,'statusCodeCounts':counts,'rawLogsMessagesIdentifiersHeadersOrBodiesRetained':False,'coverageLimit':'filtered retained request logs; availability, sampling and query completeness are not global invocation-error coverage','newCanonicalHealthZeroProduced':False}
with(root/'current-runtime-error-query-v1.json').open('x') as f:
    json.dump(summary,f,indent=2);f.write('\n')
print(json.dumps({'production':current,'runtimeQuery':summary}))
