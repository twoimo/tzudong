import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync,spawn} from 'node:child_process';
import {loadRelease,compileRelease,executeRelease,snapshotSql} from '../candidate/apps/web/scripts/readiness-release.mjs';
import {runPsql} from '../candidate/apps/web/scripts/apply-supabase-migration.mjs';
const packet=new URL('../',import.meta.url),root=new URL('../candidate/',import.meta.url).pathname.replace(/\/$/,'');
const f=JSON.parse(readFileSync(new URL('reports/fixture.json',packet)));
const pin=JSON.parse(readFileSync(new URL('reports/manifest-pin.json',packet))).sha256;
assert.equal(f.context,'colima-tzudong-catalog-20261007');assert.equal(f.container,'tzudong-ranking-clone-20261008');
const base=['--context',f.context,'exec','-i','-e','PGPASSWORD=fixture-only',f.container];
const command=(db,sql,actor='postgres',single=false)=>{
  const args=[...base,'psql','-XAtq','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-h','127.0.0.1','-U',actor,'-d',db];
  if(single)args.push('--single-transaction');
  const r=spawnSync('docker',args,{encoding:'utf8',input:sql,maxBuffer:10*1024*1024,timeout:45000});
  if(r.status!==0)throw new Error('LOCAL_SQL_FAILED_'+(/(?:ERROR|FATAL):\s+([0-9A-Z]{5})/.exec(r.stderr??'')?.[1]??'UNKNOWN'));
  return r.stdout.trim();
};
const inspected=JSON.parse(spawnSync('docker',['--context',f.context,'inspect',f.container],{encoding:'utf8'}).stdout)[0];
assert.equal(inspected.HostConfig.NetworkMode,'none');assert.ok(!Object.keys(inspected.NetworkSettings.Ports??{}).length);
const fresh=suffix=>{const db=f.prefix+'_'+suffix;assert.match(db,/^rrel_[a-f0-9]{12}_[a-z_]+$/);assert.equal(command('postgres',`SELECT count(*) FROM pg_database WHERE datname='${db}';`,'supabase_admin'),'0');command('postgres',`CREATE DATABASE ${db} TEMPLATE ${f.base} OWNER postgres;`,'supabase_admin');return db;};
const testSuffix=randomBytes(3).toString('hex').replace(/[0-9]/g,c=>'abcdefghij'[Number(c)]);
const owned=[];const newDB=s=>{const db=fresh(testSuffix+'_'+s);owned.push(db);return db;};
const url=db=>`postgresql://postgres:fixture-only@127.0.0.1/${db}`;
// Exercise the ORIGINAL env-only connection and safe psql adapter; only its
// process transport is mapped to the explicitly admitted offline container.
const transport=(databaseUrl,sql,one)=>runPsql(databaseUrl,sql,one,{environment:{},spawnImpl:(_exe,args,opts)=>{
  const db=opts.env.PGDATABASE;assert.ok(owned.includes(db));assert.equal(opts.env.PGHOST,'127.0.0.1');assert.equal(opts.env.PGPASSWORD,'fixture-only');
  return spawnSync('docker',[...base,'psql',...args,'-h',opts.env.PGHOST,'-U',opts.env.PGUSER,'-d',db],{input:opts.input,encoding:'utf8',maxBuffer:opts.maxBuffer,timeout:45000});
}});
const loaded=loadRelease(root,pin);
// Local fixtures deliberately do not impersonate the hosted 86-row ledger.
// Only this test adapter substitutes the local prefix/membership contract.
const manifest={...loaded.manifest,prior:f.prior,final:f.final,ledger:f.ledger};
const c=compileRelease(manifest,loaded.plans,loaded.execution,pin);
const results=[];
const pass=(name,details={})=>{results.push({name,status:'passed',...details});console.log(JSON.stringify({test:name,status:'passed'}));};
const expectCode=(fn,code)=>assert.throws(fn,error=>error.code===code);
const fingerprint=db=>command(db,`SET search_path=pg_catalog,public; SELECT jsonb_build_object('surface',(${snapshotSql()}),'ledger',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY version),'[]') FROM supabase_migrations.schema_migrations m),'functions',(SELECT md5(coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]')::text) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','review_media_private','privacy_retention','pipeline_control')),'buckets',(SELECT md5(coalesce(jsonb_agg(to_jsonb(b) ORDER BY id),'[]')::text) FROM storage.buckets b));`);
const q=x=>`'${String(x).replaceAll("'","''")}'`;
const row=p=>`INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES(${q(p.version)},${q(p.name)},ARRAY(SELECT jsonb_array_elements_text(${q(JSON.stringify(p.originalVector))}::jsonb)));`;
let blocker;
try {
  const db=newDB('success');let calls=[];
  const traced=(u,s,t)=>{calls.push(s===c.sql?'write':'read');return transport(u,s,t);};
  assert.equal(executeRelease(url(db),c,{runPsqlImpl:traced}).outcome,'applied_verified');
  assert.deepEqual(calls,['read','write','read']);
  const ledger=JSON.parse(command(db,`SELECT jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version) FROM supabase_migrations.schema_migrations WHERE version IN (${c.plans.map(p=>q(p.version)).join(',')});`));
  assert.deepEqual(ledger,c.plans.map(p=>({version:p.version,name:p.name,statements:p.originalVector})));
  pass('atomic_apply_all_11_original_vectors',{canonicalVectors:11,aggregateRows:0,nonsuper:true});
  calls=[];assert.equal(executeRelease(url(db),c,{runPsqlImpl:traced}).outcome,'already_applied');assert.deepEqual(calls,['read']);pass('all_present_exact_final_read_only');
  command(db,`UPDATE supabase_migrations.schema_migrations SET statements=ARRAY['mismatched vector'] WHERE version=${q(c.plans[4].version)};`);
  calls=[];expectCode(()=>executeRelease(url(db),c,{runPsqlImpl:traced}),'READINESS_STATE_CONFLICT');assert.deepEqual(calls,['read']);pass('all_present_vector_mismatch_closed');
  const partial=newDB('partial');command(partial,row(c.plans[0]));const beforePartial=fingerprint(partial);
  expectCode(()=>executeRelease(url(partial),c,{runPsqlImpl:transport}),'READINESS_STATE_CONFLICT');assert.equal(fingerprint(partial),beforePartial);pass('partial_ledger_closed');
  const wrongPrior=newDB('prior_drift');command(wrongPrior,"UPDATE storage.buckets SET public=false WHERE id='review-photos';");
  // Alter one covered grant locally, preserving actual production permissions.
  command(wrongPrior,'REVOKE SELECT ON public.reviews FROM anon;');
  expectCode(()=>executeRelease(url(wrongPrior),c,{runPsqlImpl:transport}),'READINESS_STATE_CONFLICT');pass('prior_grant_drift_closed');
  const rollback=newDB('rollback');const before=fingerprint(rollback);let writes=0;
  const failing=(u,s,t)=>{if(s===c.sql){writes++;s=s.replace("PERFORM set_config('readiness.release_outcome','applied',true);","RAISE EXCEPTION 'LOCAL_AFTER_LEDGER_FAILURE';");}return transport(u,s,t);};
  expectCode(()=>executeRelease(url(rollback),c,{runPsqlImpl:failing}),'READINESS_NOT_APPLIED');assert.equal(writes,1);assert.equal(fingerprint(rollback),before);pass('failure_after_ddl_and_11_ledger_inserts_rolls_back',{exactFingerprint:true});
  const lost=newDB('lost_commit');let lostCalls=[];
  const losing=(u,s,t)=>{lostCalls.push(s===c.sql?'write':'read');const out=transport(u,s,t);if(s===c.sql)throw new Error('simulated acknowledgement lost');return out;};
  assert.equal(executeRelease(url(lost),c,{runPsqlImpl:losing}).outcome,'committed_reconciled');assert.deepEqual(lostCalls,['read','write','read']);pass('lost_commit_read_only_reconciliation_no_resend');
  const finalDrift=newDB('final_drift');executeRelease(url(finalDrift),c,{runPsqlImpl:transport});command(finalDrift,"UPDATE storage.buckets SET public=true WHERE id='review-verifications';");
  expectCode(()=>executeRelease(url(finalDrift),c,{runPsqlImpl:transport}),'READINESS_STATE_CONFLICT');pass('all_present_final_private_bucket_drift_closed');
  const pipelineDrift=newDB('pipeline_drift');executeRelease(url(pipelineDrift),c,{runPsqlImpl:transport});command(pipelineDrift,'ALTER FUNCTION pipeline_control.bump_admin_evaluation_revision() COST 99;');
  expectCode(()=>executeRelease(url(pipelineDrift),c,{runPsqlImpl:transport}),'READINESS_STATE_CONFLICT');pass('all_present_revision_function_drift_closed');
  const locked=newDB('locked');
  blocker=spawn('docker',[...base,'psql','-XAtq','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-U','postgres','-d',locked],{stdio:['pipe','pipe','pipe']});
  const ready=new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('LOCAL_LOCK_NOT_READY')),5000);blocker.stdout.on('data',chunk=>{text+=chunk.toString();if(text.includes('LOCK_READY')){clearTimeout(timer);resolve();}});blocker.on('error',reject);});
  blocker.stdin.write('BEGIN; LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;\n\\echo LOCK_READY\n');await ready;
  expectCode(()=>executeRelease(url(locked),c,{runPsqlImpl:transport}),'READINESS_NOT_APPLIED');
  const ended=new Promise(resolve=>blocker.on('exit',resolve));blocker.stdin.end('ROLLBACK;\n');await ended;blocker=null;
  assert.equal(JSON.parse(transport(url(locked),c.reconciliation,true)).state,'prior');pass('ledger_lock_contention_no_partial_apply');
  const probe=readFileSync(new URL('../user-readiness-20261009/full-clone-user-role-probe-v2.sql',packet),'utf8');
  // This proven probe rolls its synthetic owner/anon work back internally.
  const checks=command(lost,probe).split('\n').filter(x=>x.startsWith('{')).map(x=>JSON.parse(x));
  assert.deepEqual(checks,[{ownerRPCsPassed:7,privateSchemaDenied:true},{anonRPCDenied:true,privateSchemaDenied:true}]);pass('owner7_anon_private_schema',{checks});
} catch(error) {
  results.push({name:'integration',status:'failed',code:/^(LOCAL|READINESS|MIGRATION)_[A-Z0-9_]+$/.test(error.message)?error.message:'LOCAL_ASSERTION_FAILED'});
  process.exitCode=1;
} finally {
  if(blocker)blocker.stdin.end('ROLLBACK;\n');
  writeFileSync(new URL('reports/integration.json',packet),JSON.stringify({engine:'17.6',node:process.version,context:f.context,container:f.container,hostedWrites:0,tests:results,databases:owned},null,2)+'\n');
}
