"""Exact main approval through one production-only sensitive guard; no secrets printed."""
from pathlib import Path
import datetime,json,re,subprocess,sys,tempfile,os
root=Path(__file__).resolve().parent
sha,label=sys.argv[1:];assert re.fullmatch(r'[a-f0-9]{40}',sha) and re.fullmatch(r'[a-z0-9-]+',label)
team='team_OUj64KeLxJI3PkEbOaFZnorA';pid='prj_sau35J5uUtShIQ9OKofRtOVVnTSl';eid='i4fHH6tbzAA1jtCM'
repo='/Users/twoimo/.codex/worktrees/marker-memory-release-20261002/tzudong'
remote=subprocess.run(['git','ls-remote','origin','refs/heads/main'],cwd=repo,capture_output=True,text=True,check=True).stdout.split();assert remote and remote[0]==sha
cli=['/opt/homebrew/opt/node@24/bin/node','/opt/homebrew/lib/node_modules/vercel/dist/index.js','api']
def call(path,extra=()):
 r=subprocess.run([*cli,path,'--scope',team,'--raw',*extra],cwd=repo,capture_output=True,text=True,timeout=45)
 if r.returncode:raise RuntimeError('bounded exact-project operation failed; read back before retry')
 return json.loads(r.stdout)
p=call('/v9/projects/tzudong');assert p['id']==pid and p['name']=='tzudong' and p['rootDirectory']=='apps/web' and p['link']['repo']=='tzudong'
e=call('/v9/projects/'+pid+'/env');item=next(x for x in e['envs'] if x['id']==eid);assert item['key']=='TZUDONG_APPROVED_PRODUCTION_SHA' and item['type']=='sensitive' and item['target']==['production']
preview={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'projectVerified':True,'publicApprovedMainSha':sha,'guardId':eid,'guardKey':item['key'],'guardType':item['type'],'target':item['target'],'guardNotDisabled':True,'otherConfigurationChanged':False}
with(root/(label+'-preview.json')).open('x') as f:json.dump(preview,f,indent=2);f.write('\n')
fd,path=tempfile.mkstemp(prefix='tzudong-exact-main-guard-',suffix='.json')
try:
 with os.fdopen(fd,'w') as f:json.dump({'value':sha,'type':'sensitive','target':['production']},f)
 updated=call('/v9/projects/'+pid+'/env/'+eid,('-X','PATCH','--input',path))
finally:Path(path).unlink()
a=call('/v9/projects/'+pid+'/env');item=next(x for x in a['envs'] if x['id']==eid);assert item['key']==preview['guardKey'] and item['type']=='sensitive' and item['target']==['production']
receipt={**preview,'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'patchReturnedSuccess':True,'independentMetadataReadbackMatches':True,'encryptedValueOrOtherEnvValuesRetained':False,'remainingProof':'exact approved SHA production build READY and independent alias'}
with(root/(label+'-apply-readback.json')).open('x') as f:json.dump(receipt,f,indent=2);f.write('\n')
print(json.dumps(receipt))
