-- Parent-owned PG15 only, after the exact migration, inside outer BEGIN/ROLLBACK.
-- Supply psql sponsor_actor (an existing active fixture admin) and sponsor_target
-- (an existing synthetic restaurant with UNKNOWN analysis). Creates no account.
-- The savepoint also restores business rows, revisions, operations and audit after testing.
SAVEPOINT sponsorship_guarded_fixture;
-- Typed inputs stay local to this savepoint; avoid DDL-triggered sequence changes.
SELECT pg_catalog.set_config('tzudong.test_sponsor_actor', :'sponsor_actor'::uuid::text, true) AS sponsor_actor_setting,
       pg_catalog.set_config('tzudong.test_sponsor_target', :'sponsor_target'::uuid::text, true) AS sponsor_target_setting
\gset
DO $guarded$
DECLARE v_actor uuid; target uuid; op uuid; receipt jsonb; applied jsonb; again jsonb;
 before_row jsonb; saved jsonb; expected jsonb; payload jsonb; outcome text; denied boolean;
BEGIN
 v_actor:=pg_catalog.current_setting('tzudong.test_sponsor_actor')::uuid;
 target:=pg_catalog.current_setting('tzudong.test_sponsor_target')::uuid;
 PERFORM pipeline_control.admin_record_assert_operator(v_actor);
 SELECT to_jsonb(r) INTO STRICT before_row FROM public.restaurants r WHERE id=target;
 IF before_row#>>'{youtube_meta,ads_info,sponsor_analysis,status}' IS DISTINCT FROM 'unknown'
 THEN RAISE EXCEPTION 'SPONSORSHIP_UNKNOWN_FIXTURE_REQUIRED'; END IF;
 FOREACH outcome IN ARRAY ARRAY['detected','confirmed_none'] LOOP
  SELECT to_jsonb(r) INTO STRICT before_row FROM public.restaurants r WHERE id=target;
  payload:=jsonb_build_object('changes',jsonb_build_object('youtube_meta',jsonb_build_object(
   'sponsorship_confirmation',outcome,'is_ads',outcome='detected',
   'what_ads',CASE WHEN outcome='detected' THEN '["SyntheticCo"]'::jsonb ELSE 'null'::jsonb END)));
  expected:=pipeline_control.admin_record_compose(before_row,payload->'changes');
  op:=gen_random_uuid();
  receipt:=public.admin_record_action(v_actor,'preview',op,'restaurant.edit',ARRAY[target],payload);
  SELECT to_jsonb(r) INTO STRICT saved FROM public.restaurants r WHERE id=target;
  IF saved IS DISTINCT FROM before_row OR receipt->>'state' IS DISTINCT FROM 'preview' THEN RAISE EXCEPTION 'PREVIEW_MUTATED_ROW'; END IF;
  applied:=public.admin_record_action(v_actor,'apply',op,'restaurant.edit',ARRAY[target],payload,receipt->>'previewHash');
  SELECT to_jsonb(r) INTO STRICT saved FROM public.restaurants r WHERE id=target;
  IF applied->>'state' IS DISTINCT FROM 'applied' OR saved->'youtube_meta' IS DISTINCT FROM expected->'youtube_meta'
   OR saved->'id' IS DISTINCT FROM before_row->'id' OR saved->'youtube_link' IS DISTINCT FROM before_row->'youtube_link'
   OR saved->'evaluation_results' IS DISTINCT FROM before_row->'evaluation_results'
   OR saved->>'updated_by_admin_id' IS DISTINCT FROM v_actor::text
  THEN RAISE EXCEPTION 'GUARDED_MANUAL_RESULT_INVALID'; END IF;
  again:=public.admin_record_action(v_actor,'readback',op);
  IF again->'auditId' IS DISTINCT FROM applied->'auditId' OR again->'readback' IS DISTINCT FROM applied->'readback'
   OR (SELECT count(*) FROM pipeline_control.admin_record_audit a WHERE a.operation_id=op AND a.actor=v_actor)<>1
  THEN RAISE EXCEPTION 'GUARDED_AUDIT_OR_READBACK_MISSING'; END IF;
  again:=public.admin_record_action(v_actor,'apply',op,'restaurant.edit',ARRAY[target],payload,receipt->>'previewHash');
  IF again->'auditId' IS DISTINCT FROM applied->'auditId'
   OR (SELECT count(*) FROM pipeline_control.admin_record_audit a WHERE a.operation_id=op)<>1
   OR (SELECT to_jsonb(r) FROM public.restaurants r WHERE id=target) IS DISTINCT FROM saved
  THEN RAISE EXCEPTION 'GUARDED_REPLAY_CHANGED_ROW'; END IF;
 END LOOP;
 -- A base-only real action must retain the last explicit confirmation unchanged.
 SELECT to_jsonb(r) INTO STRICT before_row FROM public.restaurants r WHERE id=target;
 payload:='{"changes":{"youtube_meta":{"title":"synthetic base-only edit"}}}';
 op:=gen_random_uuid();
 receipt:=public.admin_record_action(v_actor,'preview',op,'restaurant.edit',ARRAY[target],payload);
 PERFORM public.admin_record_action(v_actor,'apply',op,'restaurant.edit',ARRAY[target],payload,receipt->>'previewHash');
 SELECT to_jsonb(r) INTO STRICT saved FROM public.restaurants r WHERE id=target;
 IF saved#>'{youtube_meta,ads_info}' IS DISTINCT FROM before_row#>'{youtube_meta,ads_info}' THEN RAISE EXCEPTION 'GUARDED_BASE_EDIT_CHANGED_ADS'; END IF;
 -- An edit to a row outside the preview target set is rejected atomically.
 before_row:=saved;
 payload:=jsonb_build_object('changes','{}'::jsonb,'perTargetChanges',jsonb_build_array(jsonb_build_object(
   'id',gen_random_uuid(),'changes',jsonb_build_object('youtube_meta',jsonb_build_object(
    'sponsorship_confirmation','detected','is_ads',true,'what_ads',jsonb_build_array('UnownedCo'))))));
 op:=gen_random_uuid();
 receipt:=public.admin_record_action(v_actor,'preview',op,'restaurant.edit',ARRAY[target],payload);
 denied:=false;
 BEGIN PERFORM public.admin_record_action(v_actor,'apply',op,'restaurant.edit',ARRAY[target],payload,receipt->>'previewHash');
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'RECORD_ACTION_INVALID_PAYLOAD' THEN RAISE; END IF;
  denied:=true;
 END;
 IF NOT denied OR EXISTS(SELECT 1 FROM pipeline_control.admin_record_audit a WHERE a.operation_id=op)
  OR (SELECT to_jsonb(r) FROM public.restaurants r WHERE id=target) IS DISTINCT FROM before_row
 THEN RAISE EXCEPTION 'UNOWNED_CHANGE_NOT_ROLLED_BACK'; END IF;
END $guarded$;
ROLLBACK TO SAVEPOINT sponsorship_guarded_fixture;
RELEASE SAVEPOINT sponsorship_guarded_fixture;
