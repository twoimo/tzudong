from pathlib import Path
import json,subprocess,time,sys
out=Path(__file__).resolve().parent
p=json.loads((out/'resource-plan-final.json').read_text());cfg=json.loads(Path('/Users/twoimo/.codex/runtime-cache/pipeline-recovery-20261007/pg17-refresh-20261009/source-runtime-container-config.json').read_text())
d=['/opt/homebrew/bin/docker','--context','colima-tzudong-catalog-20261007']
def call(args):
 r=subprocess.run(d+args,capture_output=True,text=True,timeout=60)
 if r.returncode:raise RuntimeError('RESOURCE_COMMAND_FAILED')
 return r.stdout.strip()
def start(bootstrap):
 cmd=[('supautils.privileged_extensions=' if bootstrap and x.startswith('supautils.privileged_extensions=') else x) for x in cfg['cmd']]
 args=['run','-d','--name',p['name'],'--network','none','--label','tzudong.record-owner='+p['owner'],'--label','tzudong.phased-run='+p['name'],'-v',p['volume']+':/var/lib/postgresql/data']
 for e in cfg['env']:args+=['-e',e]
 cid=call(args+[p['image']]+cmd);(out/'owned-container-id.txt').write_text(cid+'\n')
 for i in range(60):
  r=subprocess.run(d+['exec',cid,'pg_isready','-h','127.0.0.1','-U','supabase_admin'],capture_output=True,timeout=10)
  if r.returncode==0:return
  time.sleep(1)
 raise RuntimeError('RESOURCE_READY_TIMEOUT')
if sys.argv[1]=='bootstrap':
 call(['volume','create','--label','tzudong.record-owner='+p['owner'],'--label','tzudong.phased-run='+p['name'],p['volume']]);start(True)
elif sys.argv[1]=='runtime':
 cid=(out/'owned-container-id.txt').read_text().strip();c=json.loads(call(['inspect',cid]))[0]
 assert c['Config']['Labels']['tzudong.phased-run']==p['name']
 call(['stop',cid]);call(['rm',cid]);start(False)
print(json.dumps({'stage':sys.argv[1],'resource':p['name'],'network':'none','status':'ready'}))
