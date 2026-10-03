"""Exact source deployment and independent alias; bounded public metadata only."""
from pathlib import Path
import subprocess,json,datetime,re,sys
root=Path(__file__).resolve().parent;label=sys.argv[1];assert re.fullmatch(r'[a-z0-9-]+',label)
request=json.loads((root/'memory-production-redeploy-request-v1.json').read_text())
assert request['cliExit']==0 and request['returnedUrl']
cli=['/opt/homebrew/opt/node@24/bin/node','/opt/homebrew/lib/node_modules/vercel/dist/index.js','api'];team='team_OUj64KeLxJI3PkEbOaFZnorA'
def get(path):
    result=subprocess.run([*cli,path,'--scope',team,'--raw'],capture_output=True,text=True,timeout=35)
    assert result.returncode==0,'bounded readback failure'
    return json.loads(result.stdout)
project=get('/v9/projects/tzudong')
assert project['id']=='prj_sau35J5uUtShIQ9OKofRtOVVnTSl' and project['rootDirectory']=='apps/web' and project['link']['repo']=='tzudong'
deployment=get('/v13/deployments/'+request['returnedUrl'].removeprefix('https://'))
alias=get('/v4/aliases/www.tzudong.app');aliasId=alias.get('deployment',{}).get('id') or alias.get('deploymentId')
assert deployment.get('projectId')==project['id'] and deployment.get('meta',{}).get('githubCommitSha')==request['gitSha']
result={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'projectVerified':True,
        'deployment':{'id':deployment['id'],'url':deployment['url'],'state':deployment.get('readyState',deployment.get('state')),'target':deployment.get('target'),'gitSha':deployment.get('meta',{}).get('githubCommitSha')},
        'independentAlias':{'name':'www.tzudong.app','deploymentId':aliasId,'matches':aliasId==deployment['id']},'providerDiagnosticsStored':False}
with(root/f'{label}.json').open('x') as f:
    json.dump(result,f,indent=2);f.write('\n')
print(json.dumps(result))
