from pathlib import Path
import json,re,uuid,hashlib,subprocess
exec((Path(__file__).resolve().parent/'fixture-lib.py').read_text())
names=['20261004190259_admin_record_guarded_actions.sql','20261004192657_admin_evaluation_raw_warning_groups.sql','20261004194715_admin_evaluation_raw_warning_invoker_contract.sql','20261009022915_restaurant_review_manual_preview_eligibility.sql'];expected=['b373b7ea472c0352a33a4d4043cf8d6aa8474c04cc1ca5778805edfa77ac9c95','66eace1d6fb0dd55c1d780776bab855cc37690335ad40b0fdc1294c610e07d3a','e1c105df82c4f814d3e6adad807ff9d072b8cd42ae770b4b78f75b89a9387020','8acf6d1428764260ed57dac5fe09711868a82896f0a6d631d502128004c168a3']
r={'status':'unconfirmed','purpose':'isolated real four-source atomicity/ledger prototype, not adopted executor or operating ledger proof','operatingWrites':False,'sourceEdits':False,'schemaLedgerRowsAreSyntheticLocalOnly':True};db='tzudong_atomic_'+uuid.uuid4().hex[:10];owned=False
vectors=[];views=[];bindings=[]
def control(s):
 s=re.sub(r'^(?:\s*--[^\n]*(?:\n|$))*\s*','',s);return bool(re.match(r'^(?:BEGIN|COMMIT|ROLLBACK|ABORT|END|START\s+TRANSACTION|SAVEPOINT|RELEASE|PREPARE\s+TRANSACTION)\b',s,re.I))
try:
 for name,h in zip(names,expected):
  path=repo/'backend/supabase/migrations'/name;raw=path.read_bytes();assert hashlib.sha256(raw).hexdigest()==h
  result=subprocess.run(['/opt/homebrew/opt/node@24/bin/node',str(repo/'backend/supabase/scripts/g037_supabase_statement_vector.mjs'),'--source',str(path),'--version',name[:14],'--sha256',h,'--size',str(len(raw))],capture_output=True,text=True,timeout=20);assert result.returncode==0;v=json.loads(result.stdout)['statements'];assert [i for i,x in enumerate(v) if control(x)]==[0,len(v)-1]
  begin=re.search(rb'(?m)^BEGIN;$',raw);end=re.search(rb'(?m)^COMMIT;\s*$',raw);assert begin and end and begin.end()<end.start();view=raw[:begin.start()]+raw[begin.end():end.start()]+raw[end.start()+7:];inverse=view[:begin.start()]+raw[begin.start():begin.end()]+view[begin.start():len(view)-(len(raw)-end.start()-7)]+raw[end.start():end.start()+7]+raw[end.start()+7:];assert inverse==raw
  views.append(view.decode());vectors.append(v);bindings.append({'path':name,'sourceSha256':h,'vectorSha256':digest(json.dumps(v,separators=(',',':'),ensure_ascii=False)),'executionViewSha256':hashlib.sha256(view).hexdigest(),'inverseByteExact':True,'topLevelTransactionControlsOnlyOuter':True})
 r['sourceAdmission']=bindings;r['admissionLimits']='Known-hash four-source envelope only; lexical control check is not a generic SQL AST security validator. Root must choose fail-closed typed transaction admission before broader sources.'
 run('postgres','CREATE DATABASE '+db+' TEMPLATE '+source+' OWNER postgres;');owned=True
 before=query(db,state_sql);schema_before=schema(db);r['initialLedger']=query(db,"SELECT jsonb_build_object('rows',(SELECT count(*) FROM supabase_migrations.schema_migrations));")
 ledger='LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;'
 for name,v in zip(names,vectors):ledger+="INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES("+lit(name[:14])+','+lit(name[15:-4])+',ARRAY(SELECT jsonb_array_elements_text('+lit(json.dumps(v,ensure_ascii=False))+"::jsonb)));"
 term="DO $terminal$ DECLARE actual jsonb;BEGIN SELECT jsonb_build_object('record',to_regprocedure('public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)') IS NOT NULL,'raw',to_regprocedure('public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)') IS NOT NULL,'helper',to_regprocedure('pipeline_control.lock_restaurant_review_catalog_revision()') IS NOT NULL) INTO STRICT actual;IF actual IS DISTINCT FROM '{\"record\":true,\"raw\":true,\"helper\":true}'::jsonb THEN RAISE EXCEPTION 'FIXTURE_TERMINAL_MISMATCH';END IF;END $terminal$;"
 batch='\n'.join(views)+term+ledger
 try:run(db,'BEGIN;'+batch+"DO $mismatch$ BEGIN RAISE EXCEPTION 'FIXTURE_TERMINAL_MISMATCH';END $mismatch$;COMMIT;",'postgres');raise AssertionError('MISMATCH_ACCEPTED')
 except SqlFailure as e:r['mismatchSqlState']=e.state;r['mismatchFixedCode']=e.fixedCode;r['mismatchObject']=e.object;assert e.state=='P0001'
 r['rollbackSchemaExact']=schema(db)==schema_before;r['rollbackStateExact']=query(db,state_sql)==before;r['rollbackLedger']=query(db,"SELECT jsonb_build_object('rows',(SELECT count(*) FROM supabase_migrations.schema_migrations));");assert r['rollbackSchemaExact'] and r['rollbackStateExact'];assert r['rollbackLedger']==r['initialLedger'];r['fourSourceMismatchAllDdlAndManagedLedgerRollbackExact']=True
 run(db,'BEGIN;'+batch+'COMMIT;','postgres');after=query(db,state_sql);assert all(after[k]==before[k] for k in ['members','roles','manifest','legacy']);run(db,assertions);r['g014PassedAfterCommitExistingPrivilegedInspector']=4;r['g014PostconditionPrincipalLimitation']='Postgres lacks direct G014 assertion EXECUTE; source M1/M3 call their required checks through existing windows. No grants added. Four standalone checks here use existing fixture supabase_admin, not the proposed writer.';r['rolesMembersImmutableManifestLegacyExact']=True
 actual=query(db,"SELECT jsonb_build_object('rows',(SELECT count(*) FROM supabase_migrations.schema_migrations),'ledger',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name,'statements',statements) ORDER BY version) FROM supabase_migrations.schema_migrations));");assert actual['rows']==r['initialLedger']['rows']+4
 for item,name,v in zip(actual['ledger'],names,vectors):assert item=={'version':name[:14],'name':name[15:-4],'statements':v}
 r['successfulAtomicFourSourceAndManagedLedger']=True;r['managedLedgerOriginalStatementVectorsExact']=True
 r['status']='passed'
except Exception as e:r['failure']={'sqlState':e.state,'fixedCode':e.fixedCode} if isinstance(e,SqlFailure) else {'kind':type(e).__name__}
finally:
 if owned:run('postgres','DROP DATABASE '+db+';');r['ownedDbDropped']=True
 (out/'admission-batch-runtime.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps({k:v for k,v in r.items() if k not in ['sourceAdmission','admissionLimits']}))
 if r['status']!='passed':raise SystemExit(1)
