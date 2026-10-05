from pathlib import Path
import subprocess,json,re,hashlib
app=Path.cwd();evidence=Path('/Users/twoimo/.codex/worktrees/marker-memory-lifetime-20261001/tzudong/apps/web/performance/repository-quality-20261004/agents/astra-web-contract/v2')
node='/opt/homebrew/opt/node@24/bin/node'
files=subprocess.check_output(['git','diff','--name-only'],text=True).splitlines()+subprocess.check_output(['git','ls-files','--full-name','--others','--exclude-standard'],text=True).splitlines()
root=app.parents[1]
snap=lambda:{p:hashlib.sha256((root/p).read_bytes()).hexdigest() for p in files}
before=snap()
tests=['youtube-link-helpers','dashboard-aggregation','dashboard-route-contract','dashboard-public-visibility-source','dashboard-classifiers','home-map-youtube-kpi','admin-restaurant-update-conflict','admin-restaurant-identity-warning','admin-same-video-duplicate-warning']
tests=[f'tests-unit/{name}.test.ts' for name in tests if (app/f'tests-unit/{name}.test.ts').exists()]
checks=[('affected-unit',['bun','test',*tests]),('isolated-db-conflict',['bun','test','tests-unit/db-conflict-checker.test.ts']),('eslint',[node,'scripts/run-web-tool.mjs','eslint','lib/dashboard/helpers.ts','lib/dashboard/summary.ts','tests-unit/dashboard-aggregation.test.ts','tests-unit/youtube-link-helpers.test.ts','--max-warnings=0']),('native-compat-parity',[node,'scripts/run-typecheck.mjs','--compiler','parity']),('diff-whitespace',['git','diff','--check'])]
results=[]
for name,command in checks:
 result=subprocess.run(command,cwd=app,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 output=result.stdout+'\n'+result.stderr
 row={'name':name,'command':command,'exitCode':result.returncode,'outputSha256':hashlib.sha256(output.encode()).hexdigest()}
 if 'unit' in name or name=='isolated-db-conflict':
  for label,pattern in [('passed',r'(\d+) pass'),('failed',r'(\d+) fail'),('assertions',r'(\d+) expect\(\) calls')]:
   m=re.search(pattern,output);row[label]=int(m.group(1)) if m else None
 if name=='native-compat-parity' and result.returncode==0: row['receipt']=json.loads(result.stdout)
 if result.returncode: row['safeFailureSummary']='CHECK_FAILED; inspect locally before interpreting as pass'
 results.append(row)
 (evidence/'validation.json').write_text(json.dumps({'sourceHashesBefore':before,'checks':results,'sourceHashesAfter':snap()},indent=2)+'\n')
 print(json.dumps(row),flush=True)
 if result.returncode and name not in ['native-compat-parity']: print(output[-3500:])
if before!=snap(): raise SystemExit('SOURCE_CHANGED_DURING_VALIDATION')
if any(r['exitCode'] for r in results): raise SystemExit(1)
