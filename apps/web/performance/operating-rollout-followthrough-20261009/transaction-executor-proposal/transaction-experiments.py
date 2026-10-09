from pathlib import Path
import json,uuid,re,time
exec((Path(__file__).resolve().parent/'fixture-lib.py').read_text())
db='tzudong_executor_'+uuid.uuid4().hex[:10];owned=False
r={'status':'unconfirmed','operatingWrites':False,'sourceEdits':False,'newRolesOrGrants':False,'fixtureLedger':'fixture_executor.journal only; never operating schema_migrations','cases':[]}
def raw(sql,single=False,discard=False):
 args=docker+['exec','-i','-e','PGPASSWORD=fixture-only',cid,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h','127.0.0.1','-U','postgres','-d',db]
 if single:args+=['--single-transaction']
 a=subprocess.run(args,input=sql,capture_output=True,text=True,timeout=30);state=re.search(r'ERROR:\s+([A-Z0-9]{5})',a.stderr);fixed=re.search(r'\bFIXTURE_[A-Z_]+\b',a.stderr)
 return {'exitCode':a.returncode,'sqlState':state[1] if state else None,'fixedCode':fixed[0] if fixed else None,'responseIntentionallyDiscarded':discard}
def observed(name):
 return query(db,"SELECT jsonb_build_object('tablePresent',to_regclass('fixture_executor."+name+"') IS NOT NULL,'journalPresent',EXISTS(SELECT 1 FROM fixture_executor.journal WHERE version="+lit(name)+"));")
def assertion(actual,expected):return "DO $assert$ DECLARE value jsonb;BEGIN EXECUTE "+lit("SELECT "+lit(json.dumps(actual))+"::jsonb")+" INTO STRICT value;IF value IS DISTINCT FROM "+lit(json.dumps(expected))+"::jsonb THEN RAISE EXCEPTION 'FIXTURE_TERMINAL_MISMATCH';END IF;END $assert$;"
def ddl(name):return 'CREATE TABLE fixture_executor.'+name+'(id int PRIMARY KEY);'
def journal(name):return "INSERT INTO fixture_executor.journal(version,source_sha,vector_sha) VALUES("+lit(name)+",repeat('a',64),repeat('b',64));"
try:
 run('postgres','CREATE DATABASE '+db+' TEMPLATE '+source+' OWNER postgres;');owned=True
 run(db,'CREATE SCHEMA fixture_executor;CREATE TABLE fixture_executor.journal(version text PRIMARY KEY,source_sha text NOT NULL,vector_sha text NOT NULL);','postgres')
 r['ownerAdmission']=query(db,"SELECT jsonb_build_object('postgresSuperuser',(SELECT rolsuper FROM pg_roles WHERE rolname='postgres'),'realLedgerExists',to_regclass('supabase_migrations.schema_migrations') IS NOT NULL,'postgresLedgerInsert',CASE WHEN to_regclass('supabase_migrations.schema_migrations') IS NULL THEN NULL ELSE has_table_privilege('postgres',to_regclass('supabase_migrations.schema_migrations'),'INSERT') END);")
 # Original runner's external equality fails only after psql has committed.
 name='legacy_terminal';result=raw(ddl(name)+"SELECT '{\"ready\":false}'::text;",True);a=observed(name);assert result['exitCode']==0 and a=={'tablePresent':True,'journalPresent':False};r['cases'].append({'case':'legacy_external_terminal_mismatch','execution':result,'readback':a,'nodeEqualityWouldFailAfterCommit':True})
 name='legacy_midcommit';result=raw('BEGIN;'+ddl(name)+'COMMIT;SELECT * FROM fixture_executor.nonexistent;',True);a=observed(name);assert result['sqlState']=='42P01' and a['tablePresent'] and not a['journalPresent'];r['cases'].append({'case':'legacy_internal_commit_then_ddl_error','execution':result,'readback':a})
 for name,payload in [('atomic_terminal',ddl('atomic_terminal')+assertion({'ready':False},{'ready':True})+journal('atomic_terminal')),('atomic_ddl',ddl('atomic_ddl')+'SELECT * FROM fixture_executor.nonexistent;'+journal('atomic_ddl')),('atomic_journal',ddl('atomic_journal')+assertion({'ready':True},{'ready':True})+"INSERT INTO fixture_executor.journal VALUES('atomic_journal',NULL,repeat('b',64));")]:
  result=raw('BEGIN;'+payload+'COMMIT;');a=observed(name);assert result['exitCode']!=0 and a=={'tablePresent':False,'journalPresent':False};r['cases'].append({'case':name+'_failure_rolls_back_ddl_and_journal','execution':result,'readback':a})
 name='atomic_success';result=raw('BEGIN;'+ddl(name)+assertion({'ready':True},{'ready':True})+journal(name)+'COMMIT;');a=observed(name);assert result['exitCode']==0 and a=={'tablePresent':True,'journalPresent':True};r['cases'].append({'case':'atomic_success','execution':result,'readback':a})
 # Connection/result ambiguity after COMMIT cannot mean rollback or permit resend.
 name='lost_response';result=raw('BEGIN;'+ddl(name)+assertion({'ready':True},{'ready':True})+journal(name)+'COMMIT;',discard=True);a=observed(name);assert a=={'tablePresent':True,'journalPresent':True};r['cases'].append({'case':'commit_response_discarded_fresh_connection_reconciles','execution':result,'readback':a,'automaticResend':False})
 name='commit_error_after';result=raw('BEGIN;'+ddl(name)+journal(name)+'COMMIT;SELECT * FROM fixture_executor.nonexistent;');a=observed(name);assert result['exitCode']!=0 and a=={'tablePresent':True,'journalPresent':True};r['cases'].append({'case':'nonzero_exit_after_commit_is_committed_not_rollback','execution':result,'readback':a})
 # Deliberately delivering an unadmitted middle COMMIT shows why admission is mandatory.
 name='unadmitted_midcommit';result=raw('BEGIN;'+ddl(name)+'COMMIT;'+assertion({'ready':False},{'ready':True})+journal(name)+'COMMIT;');a=observed(name);assert result['exitCode']!=0 and a=={'tablePresent':True,'journalPresent':False};r['cases'].append({'case':'unadmitted_midcommit_breaks_atomicity','execution':result,'readback':a,'requiredMitigation':'reject all top-level intermediate transaction controls before connection'})
 # Duplicate version conflicts roll back later DDL; existing receipt remains unchanged.
 before=query(db,"SELECT jsonb_build_object('source',(SELECT source_sha FROM fixture_executor.journal WHERE version='atomic_success')); ")
 result=raw('BEGIN;'+ddl('duplicate_version')+journal('atomic_success')+'COMMIT;');a=observed('duplicate_version');assert result['sqlState']=='23505' and not a['tablePresent'];assert query(db,"SELECT jsonb_build_object('source',(SELECT source_sha FROM fixture_executor.journal WHERE version='atomic_success')); ")==before;r['cases'].append({'case':'duplicate_version_no_ddl_or_receipt_overwrite','execution':result,'readback':a})
 r['status']='passed'
except Exception as e:r['failure']={'sqlState':e.state,'fixedCode':e.fixedCode} if isinstance(e,SqlFailure) else {'kind':type(e).__name__}
finally:
 if owned:run('postgres','DROP DATABASE '+db+';');r['ownedDisposableDatabaseDropped']=True
 (out/'transaction-runtime.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({'status':r['status'],'caseCount':len(r['cases']),'ownerAdmission':r.get('ownerAdmission'),'failure':r.get('failure'),'ownedDbDropped':r.get('ownedDisposableDatabaseDropped')}))
 if r['status']!='passed':raise SystemExit(1)
