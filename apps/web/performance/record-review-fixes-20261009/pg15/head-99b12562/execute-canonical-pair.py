from pathlib import Path
import subprocess,json,time,hashlib,re,os
out=Path(__file__).resolve().parent
plan=json.loads((out/'execution-plan.json').read_text());source=Path(plan['source'])
r={'sourceHead':plan['head'],'sourceAuthority':str(source),'sourceHashes':plan['sourceHashes'],'context':plan['context'],'ownership':plan['ownership'],'steps':[],'operatingWrites':False}
sha=lambda b:hashlib.sha256(b).hexdigest()
env=os.environ.copy();env['PATH']='/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:'+env['PATH'];env['PYTHONDONTWRITEBYTECODE']='1'
for stage,key in [('run-a','runA'),('run-b','runB'),('compare','compare')]:
 assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip()==plan['head']
 assert not subprocess.check_output(['git','status','--porcelain'],cwd=source,text=True).strip()
 start=time.monotonic();result=subprocess.run(plan[key],cwd=source,env=env,capture_output=True,timeout=600)
 decoded=(result.stdout+result.stderr).decode('utf8','replace')
 # Retain only bounded public fixed failure identifiers, never raw diagnostics or credentials.
 codes=sorted(set(re.findall(r'\b(?:G0[0-9][0-9]|REVIEW_MANUAL|REVIEW_DEFERRED|REVIEW_CATEGORY|RECORD_ACTION|registration_replay)[A-Z_a-z0-9]{0,96}\b',decoded)))
 errors=[]
 for line in decoded.splitlines():
  if re.fullmatch(r'(?:relevant source inputs must be clean|missing application migrations directory or output already exists|[a-z_]{3,100})',line.strip()):errors.append(line.strip())
  match=re.search(r'ERROR:\s*(?:[A-Z0-9]{5}:\s*)?([A-Z][A-Z0-9_]{3,96})(?:\s*)$',line)
  if match:errors.append(match.group(1))
 step={'stage':stage,'command':plan[key],'exitCode':result.returncode,'elapsedSeconds':round(time.monotonic()-start,3),'fixedCode':'CANONICAL_STEP_PASS' if result.returncode==0 else 'CANONICAL_STEP_FAILED','fixedFailureIdentifiers':codes if result.returncode else [],'originalFixedFailureLines':sorted(set(errors)) if result.returncode else [],'stdoutSha256':sha(result.stdout),'stderrSha256':sha(result.stderr)}
 r['steps'].append(step);(out/'execution-receipt.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({k:step[k] for k in ['stage','exitCode','fixedCode','fixedFailureIdentifiers','originalFixedFailureLines']}),flush=True)
 if result.returncode:raise SystemExit(result.returncode)
print(json.dumps({'pairAndCompare':'passed'}),flush=True)
