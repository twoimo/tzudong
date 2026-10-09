from pathlib import Path
import json,re
exec((Path(__file__).resolve().parent/'fixture-lib-lock.py').read_text())
db=json.loads((out/'lock-three-migration-replay.json').read_text())['database'];path=repo/'backend/supabase/migrations/20261009022915_restaurant_review_manual_preview_eligibility.sql';sql=path.read_text();wrapped=re.sub(r'^COMMIT;$','',re.sub(r'^BEGIN;$','',sql,count=1,flags=re.M),count=1,flags=re.M)
r={'status':'unconfirmed','migrationSha256':digest(sql),'operatingWrites':False,'newTableOrRolePrivileges':False,'newMemberships':False,'principal':'actual service_role'}
sig='pipeline_control.lock_restaurant_review_catalog_revision()'
acl_sql="SELECT jsonb_build_object('tables',(SELECT encode(sha256(convert_to(jsonb_agg(jsonb_build_array(oid,relacl) ORDER BY oid)::text,'UTF8')),'hex') FROM pg_class),'schemas',(SELECT encode(sha256(convert_to(jsonb_agg(jsonb_build_array(oid,nspacl) ORDER BY oid)::text,'UTF8')),'hex') FROM pg_namespace),'functions',(SELECT encode(sha256(convert_to(jsonb_agg(jsonb_build_array(oid,proacl) ORDER BY oid)::text,'UTF8')),'hex') FROM pg_proc WHERE oid IS DISTINCT FROM to_regprocedure("+lit(sig)+")));"
seed=seed.replace('BEGIN;',"BEGIN;INSERT INTO pipeline_control.admin_evaluation_catalog_revision(singleton,revision) VALUES(true,0);",1)
role="SET LOCAL ROLE service_role;SELECT set_config('request.jwt.claim.role','',true);SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);"
policy="INSERT INTO pipeline_control.restaurant_review_policy(singleton,version,enabled,operator_id,batch_size,daily_limit) VALUES(true,7,true,"+L('actor')+",50,50);"
def test(name,sql):
 run(db,sql);r.setdefault('cases',[]).append(name)
try:
 before=query(db,state_sql);sh=schema(db);acls=query(db,acl_sql)
 run(db,'BEGIN;'+wrapped+'ROLLBACK;','postgres');assert schema(db)==sh and query(db,state_sql)==before;r['fullForwardRollbackExact']=True
 run(db,sql,'postgres');assert query(db,acl_sql)==acls and query(db,state_sql)==before;r['allPriorFunctionTableSchemaAclsAndRolesMembersManifestExact']=True
 run(db,assertions);r['g014Passed']=4
 helper=query(db,"SELECT jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'settings',proconfig,'bodySha256',encode(sha256(convert_to(prosrc,'UTF8')),'hex'),'acl',proacl,'service',has_function_privilege('service_role',oid,'EXECUTE'),'anon',has_function_privilege('anon',oid,'EXECUTE'),'authenticated',has_function_privilege('authenticated',oid,'EXECUTE'),'serviceRevisionUpdate',has_table_privilege('service_role','pipeline_control.admin_evaluation_catalog_revision','UPDATE')) FROM pg_proc WHERE oid="+lit(sig)+"::regprocedure;")
 assert helper['owner']=='postgres' and helper['definer'] and helper['service'] and not helper['anon'] and not helper['authenticated'] and not helper['serviceRevisionUpdate'];assert helper['bodySha256']==json.loads((out/'fixed-lock-source-binding.json').read_text())['helperBodySha256'];r['privateHelperExact']=helper
 after_sh=schema(db);run(db,sql,'postgres');assert schema(db)==after_sh;r['idempotentExact']=True
 # Missing control singleton is fail closed; pristine schemas contain no control data.
 try:run(db,role+'SELECT pipeline_control.lock_restaurant_review_catalog_revision();');raise AssertionError('MISSING_SINGLETON_ACCEPTED')
 except SqlFailure as e:assert e.state=='P0001' and e.fixedCode=='REVIEW_AUTOMATION_STALE'
 r['missingRevisionSingletonFailClosed']=True
 # Actual service role positive run, idempotent request readback, and stop.
 pos=seed+policy+role+"DO $test$ DECLARE p jsonb;a jsonb;b jsonb;request uuid:=gen_random_uuid();BEGIN p:=public.restaurant_review_automation_manual("+L('actor')+",'preview-run',NULL,NULL,NULL);a:=public.restaurant_review_automation_manual("+L('actor')+",'run',p->>'version',p->>'previewHash',request);IF a->'run' IS NULL OR (SELECT count(*) FROM pipeline_control.restaurant_review_runs)<>1 THEN RAISE EXCEPTION 'REVIEW_FIX_RUN_MISSING';END IF;b:=public.restaurant_review_automation_manual("+L('actor')+",'run','stale','stale',request);IF b IS DISTINCT FROM a OR (SELECT count(*) FROM pipeline_control.restaurant_review_runs)<>1 THEN RAISE EXCEPTION 'REVIEW_FIX_RUN_IDEMPOTENCY';END IF;p:=public.restaurant_review_automation_manual("+L('actor')+",'preview-stop',NULL,NULL,NULL);a:=public.restaurant_review_automation_manual("+L('actor')+",'stop',p->>'version',p->>'previewHash',NULL);IF (SELECT enabled FROM pipeline_control.restaurant_review_policy WHERE singleton) OR EXISTS(SELECT 1 FROM pipeline_control.restaurant_review_items WHERE state='queued') THEN RAISE EXCEPTION 'REVIEW_FIX_STOP';END IF;END $test$;ROLLBACK;"
 (out/'manual-service-run-stop-fixture.sql').write_text(pos);test('service_run_stop_idempotent_readback',pos)
 # Non-admin/random actor/disabled admin preserve operator enforcement.
 for name,actor,setup in [('non_admin',L('author'),''),('forged_nonexistent_actor',"'00000000-0000-4000-8000-999999999999'",''),('disabled_admin',L('actor'),"INSERT INTO public.user_roles(user_id,role) VALUES("+L('author')+",'admin');UPDATE public.user_account_status SET account_status='disabled',disabled_at=now() WHERE user_id="+L('actor')+';')]:
  s=seed+policy+setup+role+"DO $test$ BEGIN BEGIN PERFORM public.restaurant_review_automation_manual("+actor+",'preview-run',NULL,NULL,NULL);RAISE EXCEPTION 'REVIEW_FIX_ACTOR_ACCEPTED';EXCEPTION WHEN insufficient_privilege THEN IF SQLERRM<>'REVIEW_AUTOMATION_OPERATOR_INVALID' THEN RAISE;END IF;END;END $test$;ROLLBACK;"
  test(name+'_denied',s)
 for browser in ['anon','authenticated']:
  for call in ['SELECT pipeline_control.lock_restaurant_review_catalog_revision();','SELECT public.restaurant_review_automation_manual('+L('actor')+",'preview-run',NULL,NULL,NULL);"]:
   try:run(db,seed+policy+'SET LOCAL ROLE '+browser+';'+call+'ROLLBACK;');raise AssertionError('BROWSER_ACCEPTED')
   except SqlFailure as e:assert e.state=='42501'
  r['cases'].append(browser+'_forged_admin_and_helper_denied')
 # Revision/policy staleness and disabled policy before mutation.
 s=seed+policy+role+"DO $test$ DECLARE p jsonb;BEGIN p:=public.restaurant_review_automation_manual("+L('actor')+",'preview-run',NULL,NULL,NULL);UPDATE pipeline_control.restaurant_review_policy SET version=8;BEGIN PERFORM public.restaurant_review_automation_manual("+L('actor')+",'run',p->>'version',p->>'previewHash',gen_random_uuid());RAISE EXCEPTION 'REVIEW_FIX_STALE_ACCEPTED';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'REVIEW_AUTOMATION_STALE' THEN RAISE;END IF;END;UPDATE pipeline_control.restaurant_review_policy SET version=7;p:=public.restaurant_review_automation_manual("+L('actor')+",'preview-run',NULL,NULL,NULL);UPDATE public.restaurants SET phone='fixture changed' WHERE id="+L('target')+";BEGIN PERFORM public.restaurant_review_automation_manual("+L('actor')+",'run',p->>'version',p->>'previewHash',gen_random_uuid());RAISE EXCEPTION 'REVIEW_FIX_STALE_ACCEPTED';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'REVIEW_AUTOMATION_STALE' THEN RAISE;END IF;END;UPDATE pipeline_control.restaurant_review_policy SET enabled=false;BEGIN PERFORM public.restaurant_review_automation_manual("+L('actor')+",'preview-run',NULL,NULL,NULL);RAISE EXCEPTION 'REVIEW_FIX_DISABLED_POLICY_ACCEPTED';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'REVIEW_AUTOMATION_STALE' THEN RAISE;END IF;END;IF EXISTS(SELECT 1 FROM pipeline_control.restaurant_review_runs) THEN RAISE EXCEPTION 'REVIEW_FIX_STALE_WROTE';END IF;END $test$;ROLLBACK;"
 (out/'manual-service-actor-policy-cas-fixture.sql').write_text(s);test('service_policy_data_cas_and_disabled_policy',s)
 assert query(db,state_sql)==before and schema(db)==after_sh;r['fixtureRollbackExact']=True;r['status']='passed'
except Exception as e:r['failure']={'state':e.state,'fixedCode':e.fixedCode,'object':e.object} if isinstance(e,SqlFailure) else {'kind':type(e).__name__}
finally:
 (out/'fixed-lock-runtime.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
 if r['status']!='passed':raise SystemExit(1)
