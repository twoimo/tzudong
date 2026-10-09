from pathlib import Path
import json
exec((Path(__file__).resolve().parent/'fixture-lib.py').read_text())
db=json.loads((out/'fixed-three-migration-replay.json').read_text())['database'];r={'status':'unconfirmed','operatingWrites':False,'cases':[]}
role="SET LOCAL ROLE service_role;SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);"
def action(act,targets,pay):
 args=L('actor')+",'preview',o,"+lit(act)+','+targets+','+lit(json.dumps(pay))+"::jsonb"
 return 'p:=public.admin_record_action('+args+");BEGIN a:=public.admin_record_action("+args.replace("'preview'","'apply'")+",p->>'previewHash');RAISE EXCEPTION 'RECORD_ACTION_FIX_CONFLICT_ACCEPTED';EXCEPTION WHEN unique_violation THEN GET STACKED DIAGNOSTICS c=CONSTRAINT_NAME;IF expected<>'23505' OR c<>'fixture_unrelated_phone_unique' THEN RAISE;END IF;WHEN raise_exception THEN IF expected<>'P0001' OR SQLERRM<>'RECORD_ACTION_DUPLICATE' THEN RAISE;END IF;END;IF EXISTS(SELECT 1 FROM pipeline_control.admin_record_audit WHERE operation_id=o) OR (SELECT state FROM pipeline_control.admin_record_operations WHERE id=o)<>'preview' THEN RAISE EXCEPTION 'RECORD_ACTION_FIX_PARTIAL_COMMIT';END IF;"
ch=dict(payload);ch.pop('name');ch['geocoding_success']=True
try:
 sh=schema(db);before=query(db,state_sql);r['canonicalIndexSourceSha256']=digest((repo/'backend/supabase/migrations/20260828000100_hosted_candidate_identity_unique.sql').read_text())
 for act in ['restaurant.create','restaurant.restore']:
  base=seed+"UPDATE public.restaurants SET youtube_link='https://www.youtube.com/watch?v=LMNOPQRSTUV' WHERE id="+L('source')+';'
  if act=='restaurant.restore':base+='UPDATE public.restaurants SET status=\'deleted\',youtube_link='+lit(video)+' WHERE id='+L('source')+';'
  base+=(repo/'backend/supabase/migrations/20260828000100_hosted_candidate_identity_unique.sql').read_text()
  pay={'changes':ch} if act=='restaurant.create' else {};idsarg='ARRAY[]::uuid[]' if act=='restaurant.create' else 'ARRAY['+L('source')+']::uuid[]'
  sql=base+role+"DO $test$ DECLARE o uuid:=gen_random_uuid();p jsonb;a jsonb;c text;expected text:='P0001';BEGIN "+action(act,idsarg,pay)+"END $test$;ROLLBACK;"
  (out/(act.replace('.','-')+'-canonical-video-only-fixture.sql')).write_text(sql);run(db,sql);r['cases'].append(act+'_video_only_named_conflict_rollback')
 # Unknown constraint remains 23505, no universal swallowing.
 ch['phone']='fixture-phone';sql=seed+"UPDATE public.restaurants SET phone='fixture-phone' WHERE id="+L('target')+";CREATE UNIQUE INDEX fixture_unrelated_phone_unique ON public.restaurants(phone) WHERE phone IS NOT NULL;"+role+"DO $test$ DECLARE o uuid:=gen_random_uuid();p jsonb;a jsonb;c text;expected text:='23505';BEGIN "+action('restaurant.create','ARRAY[]::uuid[]',{'changes':ch})+"END $test$;ROLLBACK;"
 (out/'unrelated-unique-fixture-v2.sql').write_text(sql);run(db,sql);r['cases'].append('unrelated_named_unique_retains_23505_rollback')
 assert schema(db)==sh and query(db,state_sql)==before;r['schemaStateRollbackExact']=True;r['compositeSameVideoDifferentName']='passed in fixes-runtime deleted/create positive';r['status']='passed'
except Exception as e:r['failure']={'state':e.state,'fixedCode':e.fixedCode} if isinstance(e,SqlFailure) else {'kind':type(e).__name__}
finally:
 (out/'index-conflicts-runtime-v2.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
 if r['status']!='passed':raise SystemExit(1)
