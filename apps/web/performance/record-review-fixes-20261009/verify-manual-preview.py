from pathlib import Path
import json,re
exec((Path(__file__).resolve().parent/'fixture-lib.py').read_text())
db=json.loads((out/'fixed-three-migration-replay.json').read_text())['database']
path=repo/'backend/supabase/migrations/20261009022915_restaurant_review_manual_preview_eligibility.sql';sql=path.read_text();wrapped=re.sub(r'^COMMIT;$','',re.sub(r'^BEGIN;$','',sql,count=1,flags=re.M),count=1,flags=re.M)
r={'status':'unconfirmed','sourceSha256':digest(sql),'operatingWrites':False}
sig='pipeline_control.restaurant_review_manual_preview(uuid,text)'
meta_sql="SELECT jsonb_build_object('meta',(SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid="+lit(sig)+"::regprocedure),'body',(SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid="+lit(sig)+"::regprocedure));"
try:
 before=query(db,meta_sql);sh=schema(db);state=query(db,state_sql)
 run(db,'BEGIN;'+wrapped+'ROLLBACK;','postgres');assert schema(db)==sh and query(db,meta_sql)==before;r['rollbackExact']=True
 run(db,sql,'postgres');after=query(db,meta_sql);assert before['meta']==after['meta'];run(db,assertions);r['g014Passed']=4;r['metadataPreserved']=True;r['oldBody']=before['body'];r['newBody']=after['body']
 run(db,sql,'postgres');assert query(db,meta_sql)==after;r['idempotentExact']=True
 assert query(db,state_sql)==state;r['rolesMembersLegacyAclManifestPreserved']=True
 fixture=seed+"INSERT INTO pipeline_control.restaurant_review_policy(singleton,version,enabled,operator_id,batch_size,daily_limit) VALUES(true,7,true,"+L('actor')+",50,50);"+"INSERT INTO pipeline_control.restaurant_review_runs(id,request_id,policy_version,started_at,approved) VALUES('00000000-0000-4000-8000-000000000001',gen_random_uuid(),7,now()-interval '2 days',10);"
 fixture+="INSERT INTO pipeline_control.restaurant_review_items(run_id,restaurant_id,fingerprint,applied_fingerprint,decision,reason,state,finished_at) VALUES('00000000-0000-4000-8000-000000000001',"+L('source')+",'prior-source',pipeline_control.restaurant_review_fingerprint((SELECT to_jsonb(r) FROM public.restaurants r WHERE id="+L('source')+")),'approve','verified','applied',now());"
 fixture+="DO $test$ DECLARE p jsonb;q jsonb;n int;BEGIN p:=pipeline_control.restaurant_review_manual_preview("+L('actor')+",'run');IF (p->>'remainingApprovals')::int<>49 OR (SELECT sum(value::int) FROM jsonb_each_text(p->'counts'))<>1 THEN RAISE EXCEPTION 'REVIEW_FIX_APPLIED_EXCLUSION_OR_BUDGET';END IF; q:=pipeline_control.restaurant_review_manual_preview("+L('actor')+",'stop');IF q->'counts'<>'{}' OR q->>'version'<>'7' THEN RAISE EXCEPTION 'REVIEW_FIX_STOP';END IF;"
 fixture+="UPDATE pipeline_control.restaurant_review_items SET state='succeeded',reason='daily_limit';p:=pipeline_control.restaurant_review_manual_preview("+L('actor')+",'run');IF (SELECT sum(value::int) FROM jsonb_each_text(p->'counts'))<>2 THEN RAISE EXCEPTION 'REVIEW_FIX_DEFERRED_INCLUDE';END IF;UPDATE pipeline_control.restaurant_review_runs SET policy_version=6;p:=pipeline_control.restaurant_review_manual_preview("+L('actor')+",'run');IF (SELECT sum(value::int) FROM jsonb_each_text(p->'counts'))<>1 THEN RAISE EXCEPTION 'REVIEW_FIX_STALE_POLICY';END IF;END $test$;ROLLBACK;"
 (out/'manual-preview-fixture.sql').write_text(fixture);run(db,fixture);assert query(db,state_sql)==state;r['runtimeCases']=['applied_fingerprint_excluded','today_finished_approval_prior_day_run_counted','same_policy_daily_deferred_reincluded','stale_policy_excluded','stop_counts_empty_version_preserved']
 # Exact runtime tick candidate set/count must equal the preview under unchanged fixture.
 base=fixture[:fixture.index("DO $test$")]
 parity=base+"DO $test$ DECLARE p jsonb;t jsonb;n integer;BEGIN p:=pipeline_control.restaurant_review_manual_preview("+L('actor')+",'run');t:=public.restaurant_review_automation_tick(gen_random_uuid());SELECT sum(value::int) INTO n FROM jsonb_each_text(p->'counts');IF (t->>'scanned')::integer IS DISTINCT FROM n THEN RAISE EXCEPTION 'REVIEW_FIX_TICK_COUNT_PARITY';END IF;IF EXISTS(SELECT 1 FROM pipeline_control.restaurant_review_items WHERE restaurant_id="+L('source')+" AND reason<>'verified') THEN RAISE EXCEPTION 'REVIEW_FIX_TICK_APPLIED_EXCLUSION';END IF;END $test$;ROLLBACK;"
 (out/'manual-preview-tick-fixture.sql').write_text(parity);run(db,parity);r['actualTickParity']=True
 # Function bytes drift must reject atomically; diagnostic retained as a fixed code only.
 drift="DO $drift$ DECLARE target oid:='pipeline_control.restaurant_review_manual_preview(uuid,text)'::regprocedure;source text;BEGIN SELECT prosrc INTO source FROM pg_proc WHERE oid=target;EXECUTE replace(pg_get_functiondef(target),source,source||E'\\n-- synthetic drift');END $drift$;"
 try:run(db,'BEGIN;'+drift+wrapped+'ROLLBACK;','postgres');raise AssertionError('DRIFT_ACCEPTED')
 except SqlFailure as e:assert e.state=='P0001';r['wrongBodyRejectedAtomically']=query(db,meta_sql)==after
 assert r['wrongBodyRejectedAtomically']
 r['status']='passed' 
except Exception as e:r['failure']={'state':e.state,'fixedCode':e.fixedCode} if isinstance(e,SqlFailure) else {'kind':type(e).__name__}
finally:
 (out/'manual-preview-runtime.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
 if r['status']!='passed':raise SystemExit(1)
