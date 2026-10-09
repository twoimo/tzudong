from pathlib import Path
import subprocess, json, hashlib, datetime, time, re
repo=Path(__file__).resolve().parents[5]
out=Path(__file__).resolve().parent
head=subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()
assert head=='df3b784b5438113bcdb8b29ab0a7224e67c2f8c9'
sql=repo/'backend/supabase/migrations/20261004190259_admin_record_guarded_actions.sql'
assert hashlib.sha256(sql.read_bytes()).hexdigest()=='04d993212374b7be75e39452a189e6a990282f08e1993d622a4b24df681f1294'
steps=[]
for name in ['run-a','run-b','compare']:
 if name=='compare':
  command=['python3','backend/supabase/scripts/compare_g024_clean_replays.py','--left',str(out/'run-a'),'--right',str(out/'run-b'),'--output',str(out/'dual-clean-replay.json')]
 else:
  command=['/opt/homebrew/bin/bash','backend/supabase/scripts/generate_g014_catalog_contract_baseline.sh','--output-dir',str(out/name),'--docker-context','colima-tzudong-catalog-20261007']
 start=time.monotonic()
 print(json.dumps({'stage':name,'status':'started','command':command}),flush=True)
 r=subprocess.run(command,cwd=repo,capture_output=True)
 step={'stage':name,'command':command,'exitCode':r.returncode,'elapsedSeconds':round(time.monotonic()-start,3),'fixedCode':'CANONICAL_STEP_PASS' if r.returncode==0 else 'CANONICAL_STEP_FAIL','stdoutSha256':hashlib.sha256(r.stdout).hexdigest(),'stderrSha256':hashlib.sha256(r.stderr).hexdigest()}
 if r.returncode:
  lines=r.stderr.decode(errors='replace').splitlines()
  allowed=[line for line in lines if line.startswith(('ERROR:','psql:','relevant source inputs','catalog_local_docker','required pinned','invalid ','unreadable '))]
  step['diagnostic']=allowed[-3:]
  if not allowed:
   safe=[]
   for line in lines[-10:]:
    if len(line)>300 or re.search(r'password|credential|secret|token|https?://|postgres(?:ql)?://|@',line,re.I): continue
    safe.append(line)
   step['diagnostic']=safe[-5:]
 steps.append(step)
 receipt={'sourceHead':head,'guardedSqlSha256':hashlib.sha256(sql.read_bytes()).hexdigest(),'context':'colima-tzudong-catalog-20261007','ownership':'Generator-owned mktemp g014-catalog-contract and random g014catalog Compose project only; generator cleanup trap','steps':steps,'hostedOperationExecuted':False}
 (out/'execution-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
 print(json.dumps(step),flush=True)
 if r.returncode: raise SystemExit(r.returncode)
