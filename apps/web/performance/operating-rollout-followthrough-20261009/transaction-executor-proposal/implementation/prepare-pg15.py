from pathlib import Path
import json,subprocess,time
out=Path(__file__).resolve().parent;base=Path('/Users/twoimo/.codex/runtime-cache/pipeline-recovery-20261007/pg17-refresh-20261009')
cfg=json.loads((base/'source-runtime-container-config.json').read_text());d=['/opt/homebrew/bin/docker','--context','colima-tzudong-catalog-20261007'];name='tzudong-atomic-impl-pg15-20261009';owner='01a0f860-10d0-71b0-bb2a-95c2b52e025e';image='supabase/postgres@sha256:af083ef64d0408c8f098ee6f5c364a59b26f36fbc0f3a334a62c5c1d57362e9b'
assert subprocess.run(d+['image','inspect','--platform','linux/amd64',image],capture_output=True).returncode==0
assert subprocess.run(d+['volume','create','--label','tzudong.record-owner='+owner,'--label','tzudong.phased-run='+name,name],capture_output=True).returncode==0
args=['run','-d','--platform','linux/amd64','--network','none','--name',name,'--label','tzudong.record-owner='+owner,'--label','tzudong.phased-run='+name,'-v',name+':/var/lib/postgresql/data']
for e in cfg['env']:args+=['-e',e]
r=subprocess.run(d+args+[image,'postgres'],capture_output=True,text=True);assert r.returncode==0;cid=r.stdout.strip()
for _ in range(60):
 r=subprocess.run(d+['exec','-e','PGPASSWORD=fixture-only',cid,'psql','-X','-qAt','-h','127.0.0.1','-U','postgres','-d','postgres','-c',"SELECT current_setting('server_version');"],capture_output=True,text=True)
 if r.returncode==0:break
 time.sleep(1)
assert r.returncode==0 and r.stdout.strip().startswith('15.8')
(out/'pg15-resource.json').write_text(json.dumps({'name':name,'volume':name,'containerId':cid,'owner':owner,'image':image,'network':'none','ports':0,'serverVersion':r.stdout.strip()},indent=2)+'\n');print(json.dumps({'stage':'pg15-native-ready','version':r.stdout.strip(),'network':'none'}))
