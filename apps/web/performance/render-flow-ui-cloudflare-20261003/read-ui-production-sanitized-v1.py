"""Minimized exact-project, deployment and independent live alias readback."""
from pathlib import Path
import datetime,json,re,subprocess,sys
root=Path(__file__).resolve().parent
label=sys.argv[1]
assert re.fullmatch(r'[a-z0-9-]+',label)
cli=['/opt/homebrew/opt/node@24/bin/node','/opt/homebrew/lib/node_modules/vercel/dist/index.js','api']
team='team_OUj64KeLxJI3PkEbOaFZnorA'
def get(path):
 r=subprocess.run([*cli,path,'--scope',team,'--raw'],capture_output=True,text=True,timeout=40)
 if r.returncode:raise RuntimeError('bounded hosted readback failed')
 return json.loads(r.stdout)
p=get('/v9/projects/tzudong')
assert p['id']=='prj_sau35J5uUtShIQ9OKofRtOVVnTSl' and p['name']=='tzudong' and p['rootDirectory']=='apps/web' and p['link']['repo']=='tzudong'
a=get('/v4/aliases/www.tzudong.app')
dep=a.get('deployment',{});depId=dep.get('id') or a.get('deploymentId')
assert depId and depId.startswith('dpl_')
d=get('/v13/deployments/'+depId)
assert d.get('projectId')==p['id']
result={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':'installed Vercel CLI authenticated GET, minimized in memory','project':{'id':p['id'],'name':p['name'],'rootDirectory':p['rootDirectory'],'repo':p['link']['repo']},'deployment':{'id':d['id'],'url':d['url'],'state':d.get('readyState',d.get('state')),'target':d.get('target'),'gitSha':d.get('meta',{}).get('githubCommitSha')},'independentAlias':{'name':'www.tzudong.app','deploymentId':depId},'privateConfigOrProviderDiagnosticsStored':False}
assert result['deployment']['state']=='READY' and result['deployment']['target']=='production'
with(root/(label+'.json')).open('x') as f:json.dump(result,f,indent=2);f.write('\n')
print(json.dumps(result))
