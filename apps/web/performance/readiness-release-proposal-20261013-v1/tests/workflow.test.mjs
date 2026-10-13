import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
const packet=new URL('../',import.meta.url),read=n=>JSON.parse(readFileSync(new URL('reports/'+n,packet)));
const c=read('workflow-parsed.json'),o=read('workflow-original-parsed.json'),pin=read('manifest-pin.json').sha256;
assert.deepEqual(c.jobs.apply,o.jobs.apply);
assert.deepEqual(c.jobs.validate.steps,o.jobs.validate.steps);
assert.deepEqual(c.concurrency,o.concurrency);assert.deepEqual(c.permissions,o.permissions);assert.deepEqual(c.true,o.true);
assert.equal(c.env.RELEASE_MIGRATION_MANIFEST_SHA256,o.env.RELEASE_MIGRATION_MANIFEST_SHA256);assert.equal(c.env.READINESS_RELEASE_MANIFEST_SHA256,pin);
let shellChecks=0;for(const job of Object.values(c.jobs))for(const step of job.steps){if(step.run){const r=spawnSync('bash',['-n'],{input:step.run,encoding:'utf8'});assert.equal(r.status,0);shellChecks++;}}
const id='review_media_readiness11_v1';
const base={github:{event_name:'workflow_dispatch',repository:'twoimo/tzudong',ref:'refs/heads/main',ref_name:'main',sha:'a'.repeat(40),event:{repository:{full_name:'twoimo/tzudong',default_branch:'main'},inputs:{migration_id:id,dry_run:'false',provider_receipt:'',verify_terminal_state:'false'}}},needs:{readiness_validate:{result:'success',outputs:{sha:'a'.repeat(40)}},validate:{result:'success',outputs:{validated_sha:'a'.repeat(40),manifest_sha256:'pin',expected_manifest_sha256:'pin',migration_id:id}}},vars:{G037_WRITE_FREEZE:'active'}};
const evaluate=(job,state)=>runInNewContext(c.jobs[job].if,{...state,contains:(a,b)=>a.includes(b),fromJSON:JSON.parse},{timeout:100});
assert.equal(evaluate('readiness_validate',base),true);assert.equal(evaluate('readiness_apply',base),true);assert.equal(evaluate('validate',base),false);assert.equal(evaluate('apply',base),false);
const paths=['github.event_name','github.repository','github.ref','github.ref_name','github.sha','github.event.repository.full_name','github.event.repository.default_branch','github.event.inputs.migration_id','github.event.inputs.dry_run','github.event.inputs.provider_receipt','needs.readiness_validate.result','needs.readiness_validate.outputs.sha','vars.G037_WRITE_FREEZE'];
for(const path of paths){const s=structuredClone(base),a=path.split('.'),last=a.pop();let target=s;for(const k of a)target=target[k];target[last]='untrusted';assert.equal(evaluate('readiness_apply',s),false,path);}
for(const migration of ['g016_privacy_audit_owner_policy','g016_onboarding_confirmation_freshness']){const s=structuredClone(base);s.github.event.inputs.migration_id=migration;s.needs.validate.outputs.migration_id=migration;s.github.event.inputs.verify_terminal_state='true';assert.equal(evaluate('apply',s),true);s.github.event.inputs.verify_terminal_state='false';assert.equal(evaluate('apply',s),false);}
const result={status:'passed',genericApplyUnchanged:true,genericManifestPinUnchanged:true,concurrencyUnchanged:true,g016TerminalPathsPreserved:2,negativeReadinessGateCases:paths.length,shellSyntaxChecks:shellChecks,yamlParser:'Ruby Psych; Actions expression matrix executed in node:vm',githubActionsExecution:false};
writeFileSync(new URL('reports/workflow.json',packet),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
