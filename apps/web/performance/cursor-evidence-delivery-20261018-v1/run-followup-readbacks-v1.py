"""Run distinct saved predicates serially; retain expected strict failures."""
import datetime,json,os,re,subprocess,sys
from pathlib import Path
sha=sys.argv[1]
if not re.fullmatch('[a-f0-9]{40}',sha):raise ValueError('INVALID_SHA')
root=Path(__file__).resolve().parent
out=root/'production-followup-readbacks-v1.json'
if out.exists():raise ValueError('PRESERVE_RESULT')
env=os.environ.copy();env['PATH']='/opt/homebrew/opt/node@24/bin:'+env['PATH']
env['PLAYWRIGHT_BROWSERS_PATH']='/Users/twoimo/.codex/runtime-cache/cursor-evidence-browser-20261018'
runs=[]
for script,args in [
 ('run-public-alias-readback-v2.mjs',[sha]),
 ('run-live-visual-readback-v3.mjs',[sha]),
 ('run-privacy-gate-readback-v2.mjs',['after',sha]),
 ('run-live-history-readback-v3.mjs',['after',sha]),
 ('run-live-history-readback-v4.mjs',['after',sha]),
]:
 started=datetime.datetime.now(datetime.timezone.utc).isoformat()
 r=subprocess.run(['node',str(root/script),*args],cwd=root.parents[3],env=env,capture_output=True,text=True)
 item={'script':script,'startedAt':started,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':r.returncode}
 runs.append(item);print(json.dumps(item),flush=True)
with out.open('x') as f:json.dump({'gitSha':sha,'runs':runs,'strictPredicateNotReplacedByDiagnostic':True,'allPassClaimed':False},f,indent=2);f.write('\n')
if any(x['exitCode'] for x in runs if x['script']!='run-live-history-readback-v3.mjs'):raise SystemExit(1)
