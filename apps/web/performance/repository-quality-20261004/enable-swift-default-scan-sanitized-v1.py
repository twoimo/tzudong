"""Add Swift to existing default scanning without disabling current languages."""
from pathlib import Path
import json,subprocess,sys,re,datetime
sha,label=sys.argv[1:]
assert re.fullmatch(r'[a-f0-9]{40}',sha) and re.fullmatch(r'[a-z0-9-]+',label)
root=Path(__file__).resolve().parent
repo='twoimo/tzudong'
def api(path,body=None):
    args=['gh','api',path]
    if body is not None:args+=['--method','PATCH','--input','-']
    p=subprocess.run(args,input=json.dumps(body) if body is not None else None,text=True,capture_output=True,timeout=45)
    if p.returncode:
        return None,{'exitCode':p.returncode,'fixedCode':'github_default_setup_operation_failed','requiresIndependentReadbackBeforeRetry':True}
    return json.loads(p.stdout),None
main,err=api('repos/'+repo+'/git/ref/heads/main');assert not err and main['object']['sha']==sha
source=subprocess.check_output(['git','ls-tree',sha,'--','Package.swift','backend/restaurant-crawling/scripts/main.swift'],cwd='/Users/twoimo/.codex/worktrees/nightly-quality-20261004/tzudong',text=True)
assert '100644 blob' in source and '120000 blob' in source
before,err=api('repos/'+repo+'/code-scanning/default-setup');assert not err and before['state']=='configured' and before['runner_type']=='standard'
def canonical(xs):return set('javascript-typescript' if x in ['javascript','typescript'] else x for x in xs)
old=canonical(before['languages']);assert old=={'actions','go','javascript-typescript','python','rust'}
payload={'languages':sorted(old|{'swift'})}
fields=['state','languages','query_suite','threat_model','runner_type','schedule','updated_at']
def bounded(d):return {k:d.get(k) for k in fields}
backup={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'approvedSourceMain':sha,'before':bounded(before),'partialPatch':payload,'fiveExistingLanguageSemanticsPreserved':old<=set(payload['languages']),'querySuiteAndThreatModelPatchOmitted':True,'standardRunnerPreserved':True,'paidCapacityAdded':False,'historicalAnalysisDeletion':False}
with (root/(label+'-preview.json')).open('x') as f:json.dump(backup,f,indent=2);f.write('\n')
result,error=api('repos/'+repo+'/code-scanning/default-setup',payload)
after,readerr=api('repos/'+repo+'/code-scanning/default-setup')
receipt={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'approvedSourceMain':sha,'applyError':error,'readbackError':readerr,'validationRunId':result.get('run_id') if result else None,'after':bounded(after) if after else None,'requestAccepted':error is None,'allRequiredLanguagesEnabled':canonical(after['languages'])==old|{'swift'} if after else False,'remainingProof':'wait this validation handle, then exact main Swift analysis and original five language analysis readback'}
with (root/(label+'-apply-readback.json')).open('x') as f:json.dump(receipt,f,indent=2);f.write('\n')
print(json.dumps(receipt))
if error or readerr:sys.exit(1)
