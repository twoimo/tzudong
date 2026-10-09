from pathlib import Path
import json,re,uuid
exec((Path(__file__).resolve().parent/'fixture-lib.py').read_text())
db=json.loads((out/'fixed-three-migration-replay.json').read_text())['database']
result={'status':'unconfirmed','operatingWrites':False,'extraHelperGrants':False,'cases':[]}
def test(name,sql):
 run(db,seed+sql+'ROLLBACK;');result['cases'].append(name)
actor=L('actor');target=L('target')
role="SET LOCAL ROLE service_role;SELECT set_config('request.jwt.claims','{\"role\":\"service_role\"}',true);"
def action(action,targets,payload,op='gen_random_uuid()'):
 return "p:=public.admin_record_action("+actor+",'preview',o,"+lit(action)+","+targets+","+lit(json.dumps(payload))+"::jsonb);a:=public.admin_record_action("+actor+",'apply',o,"+lit(action)+","+targets+","+lit(json.dumps(payload))+"::jsonb,p->>'previewHash');"
try:
 test('canonical_metadata_omissions_clear_order_and_invalid_types',role+'''DO $test$ DECLARE r jsonb; v jsonb; BEGIN
 r:='{"youtube_meta":{"title":"original","publishedAt":"2026-10-01","duration":42,"is_shorts":false,"ads_info":{"is_ads":true,"what_ads":"old sponsor","provenance":"retained"},"source":"retained"}}';
 v:=pipeline_control.admin_record_compose(r,'{"youtube_meta":{"title":"new"}}');
 IF v->'youtube_meta' IS DISTINCT FROM jsonb_set(r->'youtube_meta','{title}','"new"') THEN RAISE EXCEPTION 'RECORD_ACTION_FIX_OMISSION';END IF;
 v:=pipeline_control.admin_record_compose(r,'{"youtube_meta":{"published_at":"","is_ads":false,"what_ads":["A","B"]}}');
 IF v#>>'{youtube_meta,publishedAt}'<>'' OR v#>'{youtube_meta,ads_info,is_ads}'<>'false' OR v#>>'{youtube_meta,ads_info,what_ads}'<>'A, B' OR v#>>'{youtube_meta,source}'<>'retained' OR v#>>'{youtube_meta,ads_info,provenance}'<>'retained' OR v->'youtube_meta' ?| ARRAY['published_at','is_ads','what_ads'] THEN RAISE EXCEPTION 'RECORD_ACTION_FIX_CANONICAL';END IF;
 FOR v IN SELECT value FROM jsonb_array_elements('[{"what_ads":null},{"what_ads":[]}]') LOOP
  IF pipeline_control.admin_record_compose(r,jsonb_build_object('youtube_meta',v))#>'{youtube_meta,ads_info,what_ads}'<>'null' THEN RAISE EXCEPTION 'RECORD_ACTION_FIX_CLEAR';END IF;
 END LOOP;
 FOR v IN SELECT value FROM jsonb_array_elements('[{"what_ads":"bad"},{"duration":"bad"},{"is_ads":null},{"published_at":null},{"unknown":true}]') LOOP
  BEGIN PERFORM pipeline_control.admin_record_compose(r,jsonb_build_object('youtube_meta',v));RAISE EXCEPTION 'RECORD_ACTION_FIX_BAD_ACCEPTED';
  EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'RECORD_ACTION_INVALID_PAYLOAD' THEN RAISE;END IF;END;
 END LOOP;
 END $test$;''')
 # Runtime create/delete/create keeps prior trace and provenance; composite same-video different-name works.
 ch=dict(payload);ch.pop('name');ch['geocoding_success']=True;ch['youtube_meta']['published_at']='2026-10-01'
 create=action('restaurant.create','ARRAY[]::uuid[]',{'changes':ch})
 test('deleted_trace_recreate_composite_same_video_different_name',role+"DO $test$ DECLARE o uuid:=gen_random_uuid();p jsonb;a jsonb; first_id uuid; first_trace text;second_id uuid;BEGIN "+create+"first_id:=(a->'createdRestaurantIds'->>0)::uuid;IF first_id IS NULL THEN SELECT id INTO first_id FROM public.restaurants WHERE approved_name='Phase Submitted';END IF;SELECT trace_id INTO first_trace FROM public.restaurants WHERE id=first_id;UPDATE public.restaurants SET status='deleted' WHERE id=first_id;o:=gen_random_uuid();"+create+"SELECT id INTO second_id FROM public.restaurants WHERE approved_name='Phase Submitted' AND status<>'deleted';IF second_id IS NULL OR second_id=first_id OR (SELECT trace_id FROM public.restaurants WHERE id=second_id)=first_trace OR (SELECT trace_id FROM public.restaurants WHERE id=first_id)<>first_trace OR (SELECT trace_id FROM public.restaurants WHERE id="+target+")<>"+target+"::text OR (SELECT evaluation_results FROM public.restaurants WHERE id="+target+")<>'{\"fixture_evidence\":true}' THEN RAISE EXCEPTION 'RECORD_ACTION_FIX_TRACE';END IF;END $test$;")
 for act in ['submission.reject','submission.delete']:
  test(act+'_parent_child_reason',role+"DO $test$ DECLARE o uuid:=gen_random_uuid();p jsonb;a jsonb;BEGIN "+action(act,'ARRAY['+L('newSubmission')+']::uuid[]',{'reason':'synthetic reason'})+"IF (SELECT rejection_reason FROM public.restaurant_submissions WHERE id="+L('newSubmission')+")<>'synthetic reason' OR (SELECT rejection_reason FROM public.restaurant_submission_items WHERE id="+L('newItem')+")<>'synthetic reason' THEN RAISE EXCEPTION 'RECORD_ACTION_FIX_PARENT_REASON';END IF;END $test$;")
 result['status']='passed'
except Exception as e:
 result['failure']={'state':e.state,'fixedCode':e.fixedCode} if isinstance(e,SqlFailure) else {'kind':type(e).__name__}
finally:
 (out/'fixes-runtime.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
 if result['status']!='passed':raise SystemExit(1)
