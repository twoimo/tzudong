import subprocess,sys,json,datetime,os,hashlib
from pathlib import Path
sha=sys.argv[1]
if len(sha)!=40 or any(c not in '0123456789abcdef' for c in sha):raise SystemExit('INVALID_SHA')
root=Path(__file__).resolve().parent
repo=root.parents[3]
for name in ['live-readback-after-v4.json','public-assets-after-v2.json','console-boundary-after-v3.json','production-verification-receipt-v2.json']:
 if (root/name).exists():raise SystemExit('PRESERVE_EXISTING_RECEIPT:'+name)
env=os.environ.copy();env['PATH']='/opt/homebrew/opt/node@24/bin:'+env['PATH']
env['PLAYWRIGHT_BROWSERS_PATH']='/Users/twoimo/.codex/runtime-cache/cursor-evidence-browser-20261018'
receipt={'gitSha':sha,'scope':'anonymous production functional/asset/CSP verification, no account or database writes; not field/device/performance proof','runs':[]}
for script in ['run-live-readback-v4.mjs','run-public-assets-readback-v2.mjs','run-console-boundary-diagnosis-v3.mjs']:
 started=datetime.datetime.now(datetime.timezone.utc).isoformat()
 r=subprocess.run(['node',str(root/script),'after',sha],cwd=repo,env=env,capture_output=True,text=True)
 # Only fixed exit/timestamps and each script's already bounded JSON go to evidence.
 receipt['runs'].append({'script':script,'startedAt':started,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':r.returncode})
 print(json.dumps(receipt['runs'][-1]))
 if r.returncode:break
if all(x['exitCode']==0 for x in receipt['runs']) and len(receipt['runs'])==3:
 assets=json.loads((root/'public-assets-after-v2.json').read_text())
 checks=[]
 for a in assets['rows']:
  if not a['path'].endswith('.webp'):continue
  path='apps/web/public'+a['path']
  b=subprocess.check_output(['git','show',sha+':'+path],cwd=repo)
  digest=hashlib.sha256(b).hexdigest()
  checks.append({'path':path,'gitBytes':len(b),'liveBytes':a['bytes'],'gitSha256':digest,'liveSha256':a['sha256'],'equal':digest==a['sha256'] and len(b)==a['bytes']})
 receipt['assetEquality']=checks
 receipt['passed']=all(x['equal'] for x in checks) and len(checks)==4
else:receipt['passed']=False
with (root/'production-verification-receipt-v2.json').open('x') as f:json.dump(receipt,f,indent=2);f.write('\n')
print(json.dumps({'passed':receipt['passed'],'assetCount':len(receipt.get('assetEquality',[]))}))
if not receipt['passed']:raise SystemExit(1)
