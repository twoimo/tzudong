"""Read-only exact-source/project/current-alias rollback preflight. No env writes."""
import datetime,json,os,re,subprocess,sys,urllib.request
from pathlib import Path
sha,label=sys.argv[1:]
if not re.fullmatch(r'[a-f0-9]{40}',sha) or not re.fullmatch(r'[a-z0-9-]{1,100}',label):raise ValueError('INVALID_PREFLIGHT_INPUT')
root=Path(__file__).resolve().parent;repo=root.parents[3];out=root/(label+'.json')
if out.exists():raise ValueError('PRESERVE_EXISTING_RECEIPT')
plan=json.loads((root/'production-verification-plan-v4.json').read_text())
env=os.environ.copy();env['PATH']='/opt/homebrew/opt/node@24/bin:'+env['PATH']
def run(args):return subprocess.check_output(args,cwd=repo,env=env,text=True)
subprocess.run(['git','fetch','origin','main'],cwd=repo,env=env,check=True)
main=run(['git','rev-parse','origin/main']).strip();tree=run(['git','rev-parse','origin/main^{tree}']).strip()
if main!=sha or tree!=plan['expectedSourceTree']:raise ValueError('PROTECTED_SOURCE_CHANGED')
project=plan['projectId'];team=plan['teamId']
def api(path):return json.loads(run(['vercel','api',path,'--method','GET','--scope',team]))
p=api('/v9/projects/'+project);link=p.get('link',{})
if p.get('id')!=project or p.get('name')!='tzudong' or p.get('rootDirectory')!='apps/web' or p.get('accountId')!=team or p.get('nodeVersion')!='24.x':raise ValueError('WRONG_PROJECT')
if link.get('type')!='github' or link.get('repoId')!=1080324661 or link.get('org')!='twoimo' or link.get('repo')!='tzudong' or link.get('productionBranch')!='main':raise ValueError('WRONG_GIT_CONNECTION')
h=json.loads(run(['node','--input-type=module','-e',"const r=await fetch('https://www.tzudong.app/api/health',{cache:'no-store',signal:AbortSignal.timeout(30000)});if(r.status!==200)throw Error('HEALTH_HTTP_'+r.status);const h=await r.json();console.log(JSON.stringify(Object.fromEntries(['ok','gitSha','projectId','deploymentId'].map(k=>[k,h[k]]))));"]))
if not h.get('ok') or h.get('projectId')!=project or h.get('gitSha') not in [sha,plan['currentKnownRollback']['sha']]:raise ValueError('LIVE_VERSION_CHANGED')
a=api('/v4/aliases/www.tzudong.app');deployment=a.get('deploymentId') or (a.get('deployment')or{}).get('id')
if not deployment or deployment!=h.get('deploymentId'):raise ValueError('ALIAS_HEALTH_DIVERGED')
d=api('/v13/deployments/'+deployment);git=d.get('gitSource')or{}
if d.get('projectId')!=project or d.get('readyState')!='READY' or d.get('target')!='production' or git.get('sha')!=h.get('gitSha') or 'www.tzudong.app' not in d.get('alias',[]):raise ValueError('ROLLBACK_DEPLOYMENT_DIVERGED')
result={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'mainSha':sha,'sourceTree':tree,'project':{'id':project,'teamId':team,'name':p['name'],'rootDirectory':p['rootDirectory'],'nodeVersion':p.get('nodeVersion'),'git':{k:link.get(k) for k in ['type','repoId','org','repo','productionBranch']}},'live':{k:h.get(k) for k in ['ok','gitSha','projectId','deploymentId']},'currentReadyDeployment':{'id':d['id'],'url':d['url'],'sha':git.get('sha'),'aliases':d.get('alias',[])},'needsDeployment':h.get('gitSha')!=sha,'previousApprovedShaValueRead':False,'mutationPerformed':False}
with out.open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps(result))
