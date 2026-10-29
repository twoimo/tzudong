-- Run only inside the parent's rollback transaction after before.sql + exact migration.
DO $tests$
DECLARE base jsonb:='{"title":"synthetic sponsorship title","publishedAt":"2026-10-01T00:00:00Z","duration":42,"is_shorts":false}';
 meta jsonb; row_value jsonb; before_row jsonb; after_row jsonb; first_result jsonb; changes jsonb;
 analysis jsonb:='{"status":"unknown","outcome":"unknown","retained_previous":true,"version":"older","reason":"ambiguous"}';
 ads jsonb; flag boolean; decision text; bad jsonb; denied boolean; d jsonb;
BEGIN
 -- Missing/null/unknown supplement and new array-valued companies cannot hide base fields.
 FOR ads IN SELECT value FROM jsonb_array_elements('[null,{},
  {"is_ads":null,"what_ads":null,"sponsor_analysis":{"status":"unknown"}},
  {"is_ads":true,"what_ads":["SyntheticCo"]},{"is_ads":false,"what_ads":null}]'::jsonb)
 LOOP
  meta:=base||jsonb_build_object('ads_info',ads);
  IF NOT pipeline_control.admin_eval_valid_meta(meta) THEN RAISE EXCEPTION 'BASE_METADATA_REJECTED'; END IF;
  row_value:=jsonb_build_object('youtube_meta',meta,'created_at','2020-01-01T00:00:00Z');
  d:=pipeline_control.admin_eval_descriptor(row_value);
  IF d#>>'{search,0}' IS DISTINCT FROM 'synthetic sponsorship title'
   OR (d->>'latest')::numeric IS DISTINCT FROM pipeline_control.admin_eval_epoch(base->>'publishedAt')
   OR NOT pipeline_control.admin_eval_matches(d,'{"searchQuery":"synthetic sponsorship title"}')
  THEN RAISE EXCEPTION 'BASE_DESCRIPTOR_SEARCH_OR_DATE_LOST'; END IF;
 END LOOP;
 IF NOT pipeline_control.admin_eval_valid_meta(base)
  OR pipeline_control.admin_eval_valid_meta(NULL)
  OR pipeline_control.admin_eval_valid_meta('null')
  OR pipeline_control.admin_eval_valid_meta(base||'{"title":null}')
  OR pipeline_control.admin_eval_valid_meta(base||'{"publishedAt":null}')
 THEN RAISE EXCEPTION 'NULL_BASE_VALIDATION_CHANGED'; END IF;
 d:=pipeline_control.admin_eval_descriptor('{"youtube_meta":null,"created_at":"2020-01-01T00:00:00Z"}');
 IF (d->>'latest')::numeric IS DISTINCT FROM pipeline_control.admin_eval_epoch('2020-01-01T00:00:00Z') THEN
  RAISE EXCEPTION 'NULL_META_FALLBACK_CHANGED';
 END IF;
 -- Existing positive/negative and UNKNOWN provenance survive every base-only patch.
 FOREACH flag IN ARRAY ARRAY[true,false] LOOP
  ads:=jsonb_build_object('is_ads',flag,'what_ads',CASE WHEN flag THEN 'SavedCo' ELSE NULL END,
    'sponsor_analysis',analysis,'saved_extra','keep');
  before_row:=jsonb_build_object('id','11111111-1111-4111-8111-111111111111','youtube_meta',base||jsonb_build_object('ads_info',ads),
   'evaluation_results','{"keep":true}'::jsonb,'updated_by_admin_id','unchanged');
  after_row:=pipeline_control.admin_record_compose(before_row,'{"youtube_meta":{"title":"new base title"}}');
  IF after_row#>'{youtube_meta,ads_info}' IS DISTINCT FROM ads
   OR after_row-'youtube_meta' IS DISTINCT FROM before_row-'youtube_meta' THEN RAISE EXCEPTION 'BASE_PATCH_CHANGED_CUSTODY_OR_ADS'; END IF;
  -- Ordinary legacy/fetched fields must not falsely claim an explicit manual confirmation.
  after_row:=pipeline_control.admin_record_compose(before_row,'{"youtube_meta":{"is_ads":true,"what_ads":["FetchedCo"]}}');
  IF after_row#>'{youtube_meta,ads_info,sponsor_analysis}' IS DISTINCT FROM analysis THEN RAISE EXCEPTION 'IMPLICIT_MANUAL_TRANSITION'; END IF;
  FOREACH decision IN ARRAY ARRAY['detected','confirmed_none'] LOOP
   changes:=jsonb_build_object('youtube_meta',jsonb_build_object('sponsorship_confirmation',decision,
     'is_ads',decision='detected','what_ads',CASE WHEN decision='detected' THEN '["Johnson and Johnson","3M"]'::jsonb ELSE 'null'::jsonb END));
   first_result:=pipeline_control.admin_record_compose(before_row,changes);
   after_row:=pipeline_control.admin_record_compose(before_row,changes);
   IF after_row IS DISTINCT FROM first_result OR after_row-'youtube_meta' IS DISTINCT FROM before_row-'youtube_meta'
    OR after_row#>>'{youtube_meta,ads_info,saved_extra}' IS DISTINCT FROM 'keep'
    OR after_row#>'{youtube_meta,ads_info,is_ads}' IS DISTINCT FROM to_jsonb(decision='detected')
    OR after_row#>'{youtube_meta,ads_info,what_ads}' IS DISTINCT FROM (CASE WHEN decision='detected' THEN '"Johnson and Johnson, 3M"'::jsonb ELSE 'null'::jsonb END)
    OR after_row#>'{youtube_meta,ads_info,sponsor_analysis}' IS DISTINCT FROM jsonb_build_object(
     'status','completed','outcome',decision,'source','manual_admin','version','manual-sponsorship-v1',
     'reason','explicit_admin_confirmation','source_sha256',NULL)
   THEN RAISE EXCEPTION 'MANUAL_TRANSITION_NOT_ATOMIC_OR_DETERMINISTIC'; END IF;
   IF pipeline_control.admin_record_compose(after_row,changes) IS DISTINCT FROM after_row THEN RAISE EXCEPTION 'MANUAL_COMPOSE_NOT_IDEMPOTENT'; END IF;
  END LOOP;
 END LOOP;
 -- Strict payload and authority fields cannot be injected through compose.
 FOR bad IN SELECT value FROM jsonb_array_elements('[
  {"id":"22222222-2222-4222-8222-222222222222"},
  {"updated_by_admin_id":"22222222-2222-4222-8222-222222222222"},
  {"youtube_meta":{"sponsor_analysis":{"source":"description_rules"}}},
  {"youtube_meta":{"sponsorship_confirmation":null}},
  {"youtube_meta":{"sponsorship_confirmation":"unknown","is_ads":false,"what_ads":null}},
  {"youtube_meta":{"sponsorship_confirmation":"detected","is_ads":null,"what_ads":["Co"]}},
  {"youtube_meta":{"sponsorship_confirmation":"detected","is_ads":false,"what_ads":["Co"]}},
  {"youtube_meta":{"sponsorship_confirmation":"detected","is_ads":true,"what_ads":[]}},
  {"youtube_meta":{"sponsorship_confirmation":"detected","is_ads":true,"what_ads":["   "]}},
  {"youtube_meta":{"sponsorship_confirmation":"detected","is_ads":true,"what_ads":null}},
  {"youtube_meta":{"sponsorship_confirmation":"confirmed_none","is_ads":false,"what_ads":["Co"]}},
  {"youtube_meta":{"sponsorship_confirmation":"confirmed_none","what_ads":null}}
 ]'::jsonb) LOOP
  denied:=false;
  BEGIN PERFORM pipeline_control.admin_record_compose(before_row,bad);
  EXCEPTION WHEN raise_exception THEN
   IF SQLERRM NOT IN ('RECORD_ACTION_INVALID_PAYLOAD','RECORD_ACTION_INVALID_RESTAURANT') THEN RAISE; END IF;
   denied:=true;
  END;
  IF NOT denied THEN RAISE EXCEPTION 'INVALID_OR_UNOWNED_CHANGE_ACCEPTED'; END IF;
 END LOOP;
 denied:=false;
 BEGIN PERFORM public.admin_record_action(NULL,'preview','33333333-3333-4333-8333-333333333333','restaurant.edit',
   ARRAY['11111111-1111-4111-8111-111111111111'::uuid],'{"changes":{"youtube_meta":{"sponsorship_confirmation":"confirmed_none","is_ads":false,"what_ads":null}}}');
 EXCEPTION WHEN insufficient_privilege THEN denied:=true;
 END;
 IF NOT denied THEN RAISE EXCEPTION 'UNOWNED_ACTOR_ACCEPTED'; END IF;
 IF has_function_privilege('anon','pipeline_control.admin_record_compose(jsonb,jsonb)','EXECUTE')
  OR has_function_privilege('authenticated','pipeline_control.admin_record_compose(jsonb,jsonb)','EXECUTE')
  OR NOT has_function_privilege('service_role','pipeline_control.admin_record_compose(jsonb,jsonb)','EXECUTE')
 THEN RAISE EXCEPTION 'COMPOSE_ACL_CHANGED'; END IF;
END $tests$;

DO $preservation$
BEGIN
 IF EXISTS(SELECT 1 FROM sponsorship_business_before b FULL JOIN public.restaurants r USING(id)
   WHERE b.fingerprint IS DISTINCT FROM pipeline_control.admin_record_hash(to_jsonb(r))) THEN RAISE EXCEPTION 'BUSINESS_ROW_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM sponsorship_functions_before b FULL JOIN
  (SELECT oid,proowner,proacl,prosecdef,proconfig,provolatile,proparallel,proisstrict FROM pg_proc WHERE oid IN(SELECT oid FROM sponsorship_functions_before)) a USING(oid)
  WHERE to_jsonb(b) IS DISTINCT FROM to_jsonb(a)) THEN RAISE EXCEPTION 'FUNCTION_CUSTODY_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM sponsorship_tables_before b JOIN pg_class a USING(oid)
  WHERE b.relowner IS DISTINCT FROM a.relowner OR b.relacl IS DISTINCT FROM a.relacl
   OR b.relrowsecurity IS DISTINCT FROM a.relrowsecurity OR b.relforcerowsecurity IS DISTINCT FROM a.relforcerowsecurity)
  OR EXISTS((SELECT value FROM sponsorship_policies_before EXCEPT SELECT to_jsonb(p) FROM pg_policy p)
    UNION ALL (SELECT to_jsonb(p) FROM pg_policy p EXCEPT SELECT value FROM sponsorship_policies_before))
 THEN RAISE EXCEPTION 'TABLE_ACL_OR_RLS_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM sponsorship_index_before b FULL JOIN pipeline_control.admin_evaluation_read_index i USING(id)
  WHERE NOT EXISTS(SELECT 1 FROM sponsorship_affected_before a WHERE a.id=coalesce(b.id,i.id))
   AND b.fingerprint IS DISTINCT FROM pipeline_control.admin_record_hash(to_jsonb(i))) THEN RAISE EXCEPTION 'UNAFFECTED_INDEX_CHANGED'; END IF;
 IF EXISTS(SELECT 1 FROM sponsorship_affected_before a JOIN public.restaurants r USING(id)
  LEFT JOIN pipeline_control.admin_evaluation_read_index i USING(id)
  CROSS JOIN LATERAL(SELECT pipeline_control.admin_eval_descriptor(to_jsonb(r)||jsonb_build_object('name',r.approved_name)) d) expected
  WHERE i.descriptor IS DISTINCT FROM d OR i.latest IS DISTINCT FROM (d->>'latest')::numeric
   OR i.created IS DISTINCT FROM (d->>'created')::numeric OR i.video IS DISTINCT FROM d->>'video')
 THEN RAISE EXCEPTION 'AFFECTED_INDEX_NOT_REFRESHED'; END IF;
END $preservation$;
