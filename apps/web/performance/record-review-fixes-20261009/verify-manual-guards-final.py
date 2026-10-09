from pathlib import Path
import json,re
exec((Path(__file__).resolve().parent/'fixture-lib-final.py').read_text())
db=json.loads((out/'final-three-migration-replay.json').read_text())['database'];r={'status':'unconfirmed','operatingWrites':False,'principal':'postgres source owner; not service-role deployment proof','serviceRoleMutationBlocked':'42501 admin_evaluation_catalog_revision FOR UPDATE'}
try:
 sh=schema(db);state=query(db,state_sql)
 sql=seed+"INSERT INTO pipeline_control.restaurant_review_policy(singleton,version,enabled,operator_id,batch_size,daily_limit) VALUES(true,7,true,"+L('actor')+",50,50);SET LOCAL ROLE postgres;SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);"
 sql+="DO $test$ DECLARE p jsonb;a jsonb;BEGIN p:=public.restaurant_review_automation_manual("+L('actor')+",'preview-run',NULL,NULL,NULL);BEGIN a:=public.restaurant_review_automation_manual("+L('actor')+",'run','6',p->>'previewHash',gen_random_uuid());RAISE EXCEPTION 'REVIEW_FIX_STALE_ACCEPTED';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'REVIEW_AUTOMATION_STALE' THEN RAISE;END IF;END;BEGIN a:=public.restaurant_review_automation_manual("+L('actor')+",'run','7','wrong',gen_random_uuid());RAISE EXCEPTION 'REVIEW_FIX_STALE_ACCEPTED';EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'REVIEW_AUTOMATION_STALE' THEN RAISE;END IF;END;IF EXISTS(SELECT 1 FROM pipeline_control.restaurant_review_runs) THEN RAISE EXCEPTION 'REVIEW_FIX_STALE_WROTE';END IF;p:=public.restaurant_review_automation_manual("+L('actor')+",'preview-stop',NULL,NULL,NULL);a:=public.restaurant_review_automation_manual("+L('actor')+",'stop',p->>'version',p->>'previewHash',NULL);IF (SELECT enabled FROM pipeline_control.restaurant_review_policy WHERE singleton) THEN RAISE EXCEPTION 'REVIEW_FIX_STOP_UNCHANGED';END IF;END $test$;ROLLBACK;"
 (out/'manual-cas-stop-fixture-final.sql').write_text(sql);run(db,sql);assert schema(db)==sh and query(db,state_sql)==state;r['versionHashCasStopRollback']=True
 # Exact fixed code on a perturbed body, with automatic abort restoring all bytes.
 path=repo/'backend/supabase/migrations/20261009022915_restaurant_review_manual_preview_eligibility.sql';wrapped=re.sub(r'^COMMIT;$','',re.sub(r'^BEGIN;$','',path.read_text(),count=1,flags=re.M),count=1,flags=re.M)
 drift="DO $drift$ DECLARE t oid:='pipeline_control.restaurant_review_manual_preview(uuid,text)'::regprocedure;s text;BEGIN SELECT prosrc INTO s FROM pg_proc WHERE oid=t;EXECUTE replace(pg_get_functiondef(t),s,s||E'\\n-- synthetic drift');END $drift$;"
 args=docker+['exec','-i','-e','PGPASSWORD=fixture-only',cid,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-h','127.0.0.1','-U','postgres','-d',db]
 response=subprocess.run(args,input='BEGIN;'+drift+wrapped+'ROLLBACK;',capture_output=True,text=True,timeout=60)
 assert response.returncode and re.search(r'ERROR:\s+P0001:\s+REVIEW_MANUAL_PREVIEW_SOURCE_DRIFT',response.stderr)
 assert schema(db)==sh;r['driftRejectedFixedCode']='REVIEW_MANUAL_PREVIEW_SOURCE_DRIFT';r['driftRollbackExact']=True;r['status']='passed'
except Exception as e:r['failure']={'state':e.state,'fixedCode':e.fixedCode,'deniedHelper':e.object,'classification':e.kind} if isinstance(e,SqlFailure) else {'kind':type(e).__name__}
finally:
 (out/'manual-guards-runtime-final.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
 if r['status']!='passed':raise SystemExit(1)
