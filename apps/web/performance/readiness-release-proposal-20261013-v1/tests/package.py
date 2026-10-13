from pathlib import Path
import hashlib,json,difflib,subprocess,shutil
P=Path(__file__).resolve().parents[1]; ROOT=P.parents[3]
sha=lambda b:hashlib.sha256(b).hexdigest()
paths=['.github/workflows/supabase-migration-apply.yml','.github/supabase-readiness-release-manifest.v1.json','apps/web/scripts/readiness-release.mjs','apps/web/scripts/apply-readiness-release.mjs','backend/supabase/release-bundles/readiness11-v1.sql']
chunks=[]
for name in paths:
 old=(P/'original'/name).read_text() if (P/'original'/name).exists() else ''
 new=(P/'candidate'/name).read_text()
 chunk=f'diff --git a/{name} b/{name}\n'+('new file mode 100644\n' if not old else '')+''.join(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile='a/'+name if old else '/dev/null',tofile='b/'+name))
 chunks.append(chunk)
(P/'source.patch').write_text(''.join(chunks));(P/'workflow.patch').write_text(chunks[0])
assert not any(x.startswith('backend/supabase/migrations/') for x in paths)
check=P/'patch-check';check.mkdir(exist_ok=True)
for name in paths:
 dest=check/name
 if dest.exists(): dest.unlink()
 if (P/'original'/name).exists(): dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes((P/'original'/name).read_bytes())
p=subprocess.run(['patch','--batch','-p1','-i',str(P/'source.patch')],cwd=check,capture_output=True,text=True)
assert p.returncode==0
assert all((check/x).read_bytes()==(P/'candidate'/x).read_bytes() for x in paths)
source=json.loads((P/'source-hashes.json').read_text());assert all(sha((ROOT/r['path']).read_bytes())==r['sha256'] and len((ROOT/r['path']).read_bytes())==r['bytes'] for r in source['files'])
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()==source['sourceHead']
result={'status':'passed','sourceHead':source['sourceHead'],'originalFilesUnchanged':len(source['files']),'changedPaths':paths,'canonicalMigrationsAdded':0,'fixtureFoundationUnitsInPayload':0,'patchApplyAndByteReadback':True,'sourcePatchSha256':sha((P/'source.patch').read_bytes()),'workflowPatchSha256':sha((P/'workflow.patch').read_bytes()),'files':[{'path':x,'bytes':(P/'candidate'/x).stat().st_size,'sha256':sha((P/'candidate'/x).read_bytes())} for x in paths]}
(P/'reports/package.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:result[k] for k in ['status','sourceHead','originalFilesUnchanged','canonicalMigrationsAdded','patchApplyAndByteReadback','sourcePatchSha256']}))
