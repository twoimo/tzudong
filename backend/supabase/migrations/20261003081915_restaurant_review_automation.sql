-- Bounded, service-only restaurant review automation. No customer data is copied
-- to its audit ledger; classification and mutations share one locked snapshot.
BEGIN;
CREATE TABLE pipeline_control.restaurant_review_policy (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  version bigint NOT NULL DEFAULT 1,
  enabled boolean NOT NULL DEFAULT false,
  operator_id uuid,
  batch_size integer NOT NULL DEFAULT 50 CHECK(batch_size BETWEEN 1 AND 200),
  daily_limit integer NOT NULL DEFAULT 50 CHECK(daily_limit BETWEEN 1 AND 200),
  last_run_at timestamptz
);
INSERT INTO pipeline_control.restaurant_review_policy(singleton) VALUES(true);
CREATE TABLE pipeline_control.restaurant_review_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid UNIQUE NOT NULL,
  policy_version bigint NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  scanned integer NOT NULL DEFAULT 0,
  approved integer NOT NULL DEFAULT 0,
  recheck integer NOT NULL DEFAULT 0,
  held integer NOT NULL DEFAULT 0,
  protected integer NOT NULL DEFAULT 0
);
CREATE TABLE pipeline_control.restaurant_review_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES pipeline_control.restaurant_review_runs(id),
  restaurant_id uuid NOT NULL,
  fingerprint text NOT NULL,
  decision text NOT NULL CHECK(decision IN ('approve','recheck','hold','protected')),
  reason text NOT NULL,
  state text NOT NULL CHECK(state IN ('applied','queued','running','succeeded','failed','cancelled')),
  worker_token uuid,
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  UNIQUE(restaurant_id,fingerprint)
);
CREATE INDEX restaurant_review_items_queue ON pipeline_control.restaurant_review_items(created_at,id) WHERE state='queued';
CREATE INDEX restaurant_review_video_identity ON public.restaurants (
  public.extract_youtube_video_id(youtube_link),public.normalize_restaurant_identity_name(coalesce(origin_name,approved_name,naver_name,''))
);
CREATE INDEX restaurant_review_active_address ON public.restaurants (btrim(jibun_address)) WHERE status<>'deleted';
CREATE INDEX restaurant_review_active_phone ON public.restaurants (nullif(regexp_replace(phone,'[^0-9]','','g'),'')) WHERE status<>'deleted';
CREATE TABLE pipeline_control.restaurant_review_policy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version bigint NOT NULL,
  operator_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('start','stop')),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE pipeline_control.restaurant_review_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_control.restaurant_review_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_control.restaurant_review_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pipeline_control.restaurant_review_policy_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pipeline_control.restaurant_review_policy,pipeline_control.restaurant_review_runs,
  pipeline_control.restaurant_review_items,pipeline_control.restaurant_review_policy_events FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON pipeline_control.restaurant_review_policy,pipeline_control.restaurant_review_runs,
  pipeline_control.restaurant_review_items TO service_role;
GRANT SELECT,INSERT ON pipeline_control.restaurant_review_policy_events TO service_role;

CREATE FUNCTION pipeline_control.assert_restaurant_review_operator(actor uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles role JOIN public.user_account_status account ON account.user_id=role.user_id
    WHERE role.user_id=actor AND role.role='admin' AND account.account_status='active'
  ) THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_OPERATOR_INVALID' USING ERRCODE='42501'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION pipeline_control.assert_restaurant_review_operator(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pipeline_control.assert_restaurant_review_operator(uuid) TO service_role;

CREATE FUNCTION pipeline_control.restaurant_review_fingerprint(row_data jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT md5((row_data - ARRAY['search_count','weekly_search_count','review_count','updated_at'])::text);
$$;
REVOKE ALL ON FUNCTION pipeline_control.restaurant_review_fingerprint(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pipeline_control.restaurant_review_fingerprint(jsonb) TO service_role;

-- Conservative policy v1: every approval predicate is required, never averaged.
-- Existing holds and all admin/user-authored rows are left untouched.
CREATE FUNCTION pipeline_control.restaurant_review_classify(row_data jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE evaluation jsonb := row_data->'evaluation_results'; metric text; value jsonb;
  candidate text := nullif(btrim(coalesce(row_data->>'approved_name',row_data->>'naver_name',row_data->>'google_name',row_data->>'origin_name')),'');
BEGIN
  IF row_data->>'status' IS DISTINCT FROM 'pending' OR nullif(row_data->>'updated_by_admin_id','') IS NOT NULL
    OR nullif(row_data->>'created_by','') IS NOT NULL THEN RETURN 'protected:admin_or_terminal'; END IF;
  IF row_data->'is_missing'='true'::jsonb OR row_data->'is_not_selected'='true'::jsonb THEN RETURN 'hold:not_a_target'; END IF;
  IF nullif(row_data->>'db_error_message','') IS NOT NULL OR coalesce(row_data->'db_error_details','null'::jsonb) NOT IN ('null'::jsonb,'{}'::jsonb)
    THEN RETURN 'hold:database_or_identity_conflict'; END IF;
  IF candidate IS NULL OR nullif(btrim(row_data->>'origin_name'),'') IS NULL
    OR lower(btrim(row_data->>'origin_name'))<>lower(candidate) THEN RETURN 'hold:name_requires_review'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(ARRAY[row_data->>'naver_name',row_data->>'google_name',evaluation#>>'{location_match_TF,matched_name}']) name
    WHERE nullif(btrim(name),'') IS NOT NULL AND lower(btrim(name))<>lower(candidate)) THEN RETURN 'hold:name_requires_review'; END IF;
  IF row_data->'geocoding_success' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(row_data->'lat') IS DISTINCT FROM 'number' OR jsonb_typeof(row_data->'lng') IS DISTINCT FROM 'number'
    OR (row_data->>'lat')::numeric NOT BETWEEN -90 AND 90 OR (row_data->>'lng')::numeric NOT BETWEEN -180 AND 180
    OR nullif(btrim(row_data->>'jibun_address'),'') IS NULL THEN RETURN 'hold:location_requires_review'; END IF;
  IF evaluation#>'{location_match_TF,eval_value}' IS DISTINCT FROM 'true'::jsonb
    OR evaluation#>>'{location_match_TF,match_status}' IS DISTINCT FROM 'matched'
    OR nullif(evaluation#>>'{location_match_TF,pending_reason}','') IS NOT NULL
    OR nullif(evaluation#>>'{location_match_TF,falseMessage}','') IS NOT NULL
    OR coalesce(jsonb_typeof(evaluation#>'{location_match_TF,evidence_families}'),'null')<>'array'
    THEN RETURN 'hold:location_evidence_incomplete'; END IF;
  IF (SELECT count(DISTINCT family) FROM jsonb_array_elements_text(evaluation#>'{location_match_TF,evidence_families}') family
      WHERE family IN ('provider_candidate','source_geo','cross_provider','browser_verification','geocode_provider'))<2
    THEN RETURN 'hold:independent_location_evidence_required'; END IF;
  FOREACH metric IN ARRAY ARRAY['visit_authenticity','rb_inference_score','rb_grounding_TF','review_faithfulness_score','category_validity_TF','category_TF'] LOOP
    value:=evaluation#>ARRAY[metric,'eval_value'];
    IF value IS NULL OR value='null'::jsonb OR
      (metric IN ('visit_authenticity','rb_inference_score','review_faithfulness_score') AND jsonb_typeof(value)<>'number') OR
      (metric IN ('rb_grounding_TF','category_validity_TF','category_TF') AND jsonb_typeof(value)<>'boolean')
      THEN RETURN 'recheck:missing_evaluation'; END IF;
    IF metric NOT IN ('category_validity_TF','category_TF') AND
      (jsonb_typeof(evaluation#>ARRAY[metric,'eval_basis']) IS DISTINCT FROM 'string' OR
       coalesce(btrim(evaluation#>>ARRAY[metric,'eval_basis']),'') IN ('','-','근거 내용 없음','평가 근거 없음'))
      THEN RETURN 'recheck:missing_basis'; END IF;
  END LOOP;
  IF evaluation#>'{visit_authenticity,eval_value}'<>'1'::jsonb OR evaluation#>'{rb_inference_score,eval_value}'<>'1'::jsonb
    OR evaluation#>'{review_faithfulness_score,eval_value}'<>'1'::jsonb OR evaluation#>'{rb_grounding_TF,eval_value}'<>'true'::jsonb
    OR evaluation#>'{category_validity_TF,eval_value}'<>'true'::jsonb OR evaluation#>'{category_TF,eval_value}'<>'true'::jsonb
    THEN RETURN 'hold:evaluation_failed'; END IF;
  IF jsonb_typeof(row_data->'categories') IS DISTINCT FROM 'array' OR jsonb_array_length(row_data->'categories')=0
    OR nullif(btrim(row_data->>'tzuyang_review'),'') IS NULL OR nullif(btrim(row_data->>'trace_id'),'') IS NULL
    OR public.extract_youtube_video_id(row_data->>'youtube_link') IS NULL THEN RETURN 'hold:source_incomplete'; END IF;
  RETURN 'approve:all_checks_passed';
END;
$$;
REVOKE ALL ON FUNCTION pipeline_control.restaurant_review_classify(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pipeline_control.restaurant_review_classify(jsonb) TO service_role;

CREATE FUNCTION pipeline_control.restaurant_review_decision(row_data jsonb)
RETURNS text LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE result text := pipeline_control.restaurant_review_classify(row_data);
BEGIN
  IF result NOT LIKE 'protected:%' AND EXISTS (
    SELECT 1 FROM public.restaurants other WHERE other.id::text<>row_data->>'id' AND (
      (public.extract_youtube_video_id(other.youtube_link)=public.extract_youtube_video_id(row_data->>'youtube_link')
       AND public.normalize_restaurant_identity_name(coalesce(other.origin_name,other.approved_name,other.naver_name,''))=
           public.normalize_restaurant_identity_name(coalesce(row_data->>'origin_name',row_data->>'approved_name','')))
      OR (other.status<>'deleted' AND (
        (nullif(btrim(other.jibun_address),'')=nullif(btrim(row_data->>'jibun_address'),'') AND
         public.normalize_restaurant_identity_name(coalesce(other.approved_name,other.origin_name,other.naver_name,''))=
         public.normalize_restaurant_identity_name(coalesce(row_data->>'approved_name',row_data->>'origin_name','')))
        OR (nullif(regexp_replace(other.phone,'[^0-9]','','g'),'')=nullif(regexp_replace(row_data->>'phone','[^0-9]','','g'),''))
      ))
    )
  ) THEN RETURN 'hold:duplicate_requires_review'; END IF;
  RETURN result;
END;
$$;
REVOKE ALL ON FUNCTION pipeline_control.restaurant_review_decision(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pipeline_control.restaurant_review_decision(jsonb) TO service_role;

CREATE FUNCTION public.restaurant_review_automation_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
SELECT jsonb_build_object('policy',(SELECT to_jsonb(policy)-'operator_id' FROM pipeline_control.restaurant_review_policy policy WHERE singleton),
  'runs',coalesce((SELECT jsonb_agg(to_jsonb(run) ORDER BY run.started_at DESC) FROM
    (SELECT * FROM pipeline_control.restaurant_review_runs ORDER BY started_at DESC LIMIT 10) run),'[]'::jsonb),
  'items',coalesce((SELECT jsonb_agg(to_jsonb(item)-ARRAY['worker_token','fingerprint'] ORDER BY item.created_at DESC) FROM
    (SELECT item.*,left(coalesce(restaurant.approved_name,restaurant.origin_name,restaurant.naver_name,'삭제된 항목'),160) AS restaurant_name
      FROM pipeline_control.restaurant_review_items item LEFT JOIN public.restaurants restaurant ON restaurant.id=item.restaurant_id
      ORDER BY item.created_at DESC,item.id DESC LIMIT 20) item),'[]'::jsonb),
  'queue',jsonb_build_object('queued',(SELECT count(*) FROM pipeline_control.restaurant_review_items WHERE state='queued'),
    'running',(SELECT count(*) FROM pipeline_control.restaurant_review_items WHERE state='running'),
    'failed',(SELECT count(*) FROM pipeline_control.restaurant_review_items WHERE state='failed')),
  'policyEvents',coalesce((SELECT jsonb_agg(jsonb_build_object('id',event.id,'version',event.version,'action',event.action,'created_at',event.created_at))
    FROM (SELECT * FROM pipeline_control.restaurant_review_policy_events ORDER BY created_at DESC LIMIT 10) event),'[]'::jsonb));
$$;
REVOKE ALL ON FUNCTION public.restaurant_review_automation_status() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.restaurant_review_automation_status() TO service_role;

CREATE FUNCTION public.restaurant_review_automation_preview(actor uuid,batch_size integer,daily_limit integer)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE revision text; version bigint; counts jsonb;
BEGIN
  PERFORM pipeline_control.assert_restaurant_review_operator(actor);
  IF (SELECT count(*) FROM (SELECT 1 FROM public.restaurants LIMIT 50001) bounded)>50000
    THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_CAPACITY_EXCEEDED'; END IF;
  IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 200 OR daily_limit IS NULL OR daily_limit NOT BETWEEN 1 AND 200
    THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_LIMIT_INVALID'; END IF;
  SELECT policy.version INTO version FROM pipeline_control.restaurant_review_policy policy WHERE singleton;
  revision:=public.admin_evaluation_revision();
  SELECT coalesce(jsonb_object_agg(decision,total),'{}'::jsonb) INTO counts FROM (
    SELECT split_part(pipeline_control.restaurant_review_decision(to_jsonb(restaurant)),':',1) decision,count(*) total
    FROM public.restaurants restaurant WHERE restaurant.status='pending' GROUP BY 1
  ) grouped;
  RETURN jsonb_build_object('version',version::text,'revision',revision,'counts',counts,'batchSize',batch_size,'dailyLimit',daily_limit,
    'previewHash',md5(actor::text||':'||version::text||':'||revision||':'||batch_size::text||':'||daily_limit::text));
END;
$$;
REVOKE ALL ON FUNCTION public.restaurant_review_automation_preview(uuid,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.restaurant_review_automation_preview(uuid,integer,integer) TO service_role;

CREATE FUNCTION public.restaurant_review_automation_configure(actor uuid,action text,expected_version text,preview_hash text,batch_size integer,daily_limit integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE policy pipeline_control.restaurant_review_policy; expected_hash text;
BEGIN
  PERFORM pipeline_control.assert_restaurant_review_operator(actor);
  SELECT * INTO policy FROM pipeline_control.restaurant_review_policy WHERE singleton FOR UPDATE;
  IF expected_version IS DISTINCT FROM policy.version::text THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_STALE'; END IF;
  IF action='start' THEN
    IF batch_size IS NULL OR batch_size NOT BETWEEN 1 AND 200 OR daily_limit IS NULL OR daily_limit NOT BETWEEN 1 AND 200
      THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_LIMIT_INVALID'; END IF;
    -- The revision row serializes source mutations with activation.
    PERFORM 1 FROM pipeline_control.admin_evaluation_catalog_revision WHERE singleton FOR UPDATE;
    expected_hash:=md5(actor::text||':'||policy.version::text||':'||public.admin_evaluation_revision()||':'||batch_size::text||':'||daily_limit::text);
    IF preview_hash IS DISTINCT FROM expected_hash THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_STALE'; END IF;
    UPDATE pipeline_control.restaurant_review_policy SET enabled=true,operator_id=actor,version=version+1,
      batch_size=restaurant_review_automation_configure.batch_size,daily_limit=restaurant_review_automation_configure.daily_limit WHERE singleton;
  ELSIF action='stop' THEN
    UPDATE pipeline_control.restaurant_review_policy SET enabled=false,version=version+1 WHERE singleton;
    UPDATE pipeline_control.restaurant_review_items SET state='cancelled',finished_at=now() WHERE state IN ('queued','running');
  ELSE RAISE EXCEPTION 'REVIEW_AUTOMATION_ACTION_INVALID'; END IF;
  INSERT INTO pipeline_control.restaurant_review_policy_events(version,operator_id,action) VALUES(policy.version+1,actor,action);
  RETURN public.restaurant_review_automation_status();
END;
$$;
REVOKE ALL ON FUNCTION public.restaurant_review_automation_configure(uuid,text,text,text,integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.restaurant_review_automation_configure(uuid,text,text,text,integer,integer) TO service_role;

CREATE FUNCTION public.restaurant_review_automation_tick(request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE policy pipeline_control.restaurant_review_policy; run pipeline_control.restaurant_review_runs;
  restaurant public.restaurants; data jsonb; fingerprint text; classification text; decision text; remaining integer;
BEGIN
  IF request_id IS NULL THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_REQUEST_INVALID'; END IF;
  SELECT * INTO policy FROM pipeline_control.restaurant_review_policy WHERE singleton FOR UPDATE;
  SELECT * INTO run FROM pipeline_control.restaurant_review_runs existing WHERE existing.request_id=restaurant_review_automation_tick.request_id;
  IF FOUND THEN RETURN to_jsonb(run); END IF;
  IF NOT policy.enabled THEN RETURN jsonb_build_object('disabled',true); END IF;
  PERFORM pipeline_control.assert_restaurant_review_operator(policy.operator_id);
  -- Reject rather than race with browser/source writes. All writers obey this lock;
  -- lock timeout is configured by the caller's bounded request, never retried blind.
  LOCK TABLE public.restaurants IN SHARE ROW EXCLUSIVE MODE;
  SELECT greatest(0,policy.daily_limit-coalesce(sum(approved),0)) INTO remaining FROM pipeline_control.restaurant_review_runs
    WHERE started_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';
  INSERT INTO pipeline_control.restaurant_review_runs(request_id,policy_version) VALUES(request_id,policy.version) RETURNING * INTO run;
  FOR restaurant IN SELECT candidate.* FROM public.restaurants candidate WHERE candidate.status='pending' AND NOT EXISTS(
      SELECT 1 FROM pipeline_control.restaurant_review_items prior WHERE prior.restaurant_id=candidate.id
      AND prior.fingerprint=pipeline_control.restaurant_review_fingerprint(to_jsonb(candidate)))
    ORDER BY candidate.created_at,candidate.id LIMIT policy.batch_size FOR UPDATE
  LOOP
    data:=to_jsonb(restaurant); fingerprint:=pipeline_control.restaurant_review_fingerprint(data);
    classification:=pipeline_control.restaurant_review_decision(data); decision:=split_part(classification,':',1);
    IF decision='approve' AND remaining=0 THEN CONTINUE; END IF;
    IF decision='approve' THEN
      UPDATE public.restaurants SET status='approved',approved_name=coalesce(nullif(btrim(approved_name),''),nullif(btrim(naver_name),''),nullif(btrim(google_name),''),origin_name),
        updated_by_admin_id=policy.operator_id,updated_at=now() WHERE id=restaurant.id;
      IF NOT EXISTS(SELECT 1 FROM public.restaurants WHERE id=restaurant.id AND status='approved' AND updated_by_admin_id=policy.operator_id)
        THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_READBACK_FAILED'; END IF;
      remaining:=remaining-1; run.approved:=run.approved+1;
    ELSIF decision='recheck' THEN run.recheck:=run.recheck+1;
    ELSIF decision='protected' THEN run.protected:=run.protected+1;
    ELSE
      UPDATE public.restaurants SET status='hold',updated_at=now() WHERE id=restaurant.id;
      IF NOT EXISTS(SELECT 1 FROM public.restaurants WHERE id=restaurant.id AND status='hold')
        THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_READBACK_FAILED'; END IF;
      run.held:=run.held+1;
    END IF;
    INSERT INTO pipeline_control.restaurant_review_items(run_id,restaurant_id,fingerprint,decision,reason,state,finished_at)
    VALUES(run.id,restaurant.id,fingerprint,decision,split_part(classification,':',2),CASE WHEN decision='recheck' THEN 'queued' ELSE 'applied' END,
      CASE WHEN decision='recheck' THEN NULL ELSE now() END);
    run.scanned:=run.scanned+1;
  END LOOP;
  UPDATE pipeline_control.restaurant_review_runs SET scanned=run.scanned,approved=run.approved,recheck=run.recheck,held=run.held,protected=run.protected WHERE id=run.id;
  UPDATE pipeline_control.restaurant_review_policy SET last_run_at=now() WHERE singleton;
  RETURN to_jsonb(run);
END;
$$;
REVOKE ALL ON FUNCTION public.restaurant_review_automation_tick(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.restaurant_review_automation_tick(uuid) TO service_role;

CREATE FUNCTION public.restaurant_review_automation_worker(action text,item_id uuid,token uuid,result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE policy pipeline_control.restaurant_review_policy; item pipeline_control.restaurant_review_items;
  restaurant public.restaurants; fields text[]:=ARRAY['evaluation_results','geocoding_success','geocoding_false_stage','lat','lng','road_address','jibun_address','english_address','address_elements','naver_name','google_name','categories'];
BEGIN
  IF token IS NULL THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_LEASE_INVALID'; END IF;
  SELECT * INTO policy FROM pipeline_control.restaurant_review_policy WHERE singleton FOR UPDATE;
  IF NOT policy.enabled THEN RETURN jsonb_build_object('disabled',true); END IF;
  PERFORM pipeline_control.assert_restaurant_review_operator(policy.operator_id);
  IF action='claim' THEN
    -- Expired provider work becomes uncertain, never silently dispatched again.
    UPDATE pipeline_control.restaurant_review_items SET state='failed',reason='worker_lease_expired',finished_at=now()
      WHERE state='running' AND lease_until<now();
    IF EXISTS(SELECT 1 FROM pipeline_control.restaurant_review_items WHERE state='running') THEN RETURN NULL; END IF;
    SELECT * INTO item FROM pipeline_control.restaurant_review_items WHERE state='queued' ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN RETURN NULL; END IF;
    UPDATE pipeline_control.restaurant_review_items SET state='running',worker_token=token,lease_until=now()+interval '30 minutes' WHERE id=item.id;
    SELECT * INTO restaurant FROM public.restaurants WHERE id=item.restaurant_id;
    IF NOT FOUND OR pipeline_control.restaurant_review_fingerprint(to_jsonb(restaurant))<>item.fingerprint
      OR restaurant.updated_by_admin_id IS NOT NULL OR restaurant.status<>'pending' THEN
      UPDATE pipeline_control.restaurant_review_items SET state='cancelled',reason='source_changed',finished_at=now() WHERE id=item.id;
      RETURN NULL;
    END IF;
    RETURN jsonb_build_object('id',item.id,'restaurant',to_jsonb(restaurant));
  END IF;
  SELECT * INTO item FROM pipeline_control.restaurant_review_items WHERE id=item_id FOR UPDATE;
  IF NOT FOUND OR item.worker_token IS DISTINCT FROM token THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_LEASE_INVALID'; END IF;
  IF item.state IN ('succeeded','failed','cancelled') THEN RETURN jsonb_build_object('state',item.state); END IF;
  IF item.state<>'running' OR item.lease_until<now() THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_LEASE_INVALID'; END IF;
  IF action='fail' THEN
    IF result->>'code' NOT IN ('source_unavailable','evaluation_failed','evaluation_incomplete','worker_timeout','result_invalid')
      OR result->>'code' IS NULL THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_RESULT_INVALID'; END IF;
    UPDATE pipeline_control.restaurant_review_items SET state='failed',reason=result->>'code',finished_at=now() WHERE id=item.id;
    RETURN jsonb_build_object('state','failed');
  ELSIF action<>'complete' OR jsonb_typeof(result) IS DISTINCT FROM 'object' OR octet_length(result::text)>131072
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(result) key WHERE NOT key=ANY(fields)) THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_RESULT_INVALID'; END IF;
  SELECT * INTO restaurant FROM public.restaurants WHERE id=item.restaurant_id FOR UPDATE;
  IF NOT FOUND OR pipeline_control.restaurant_review_fingerprint(to_jsonb(restaurant))<>item.fingerprint
    OR restaurant.updated_by_admin_id IS NOT NULL OR restaurant.status<>'pending' THEN
    UPDATE pipeline_control.restaurant_review_items SET state='cancelled',reason='source_changed',finished_at=now() WHERE id=item.id;
    RETURN jsonb_build_object('state','cancelled');
  END IF;
  IF jsonb_typeof(result->'evaluation_results') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_RESULT_INVALID'; END IF;
  -- Populate only allowlisted fields, keeping all identifiers, reviews and admin data.
  restaurant:=jsonb_populate_record(restaurant,result);
  UPDATE public.restaurants SET evaluation_results=restaurant.evaluation_results,geocoding_success=restaurant.geocoding_success,
    geocoding_false_stage=restaurant.geocoding_false_stage,lat=restaurant.lat,lng=restaurant.lng,road_address=restaurant.road_address,
    jibun_address=restaurant.jibun_address,english_address=restaurant.english_address,address_elements=restaurant.address_elements,
    naver_name=restaurant.naver_name,google_name=restaurant.google_name,categories=restaurant.categories,updated_at=now() WHERE id=item.restaurant_id;
  IF NOT EXISTS(SELECT 1 FROM public.restaurants WHERE id=item.restaurant_id AND evaluation_results=restaurant.evaluation_results)
    THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_READBACK_FAILED'; END IF;
  UPDATE pipeline_control.restaurant_review_items SET state='succeeded',finished_at=now() WHERE id=item.id;
  RETURN jsonb_build_object('state','succeeded');
END;
$$;
REVOKE ALL ON FUNCTION public.restaurant_review_automation_worker(text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.restaurant_review_automation_worker(text,uuid,uuid,jsonb) TO service_role;
ALTER FUNCTION public.restaurant_review_automation_tick(uuid) SET lock_timeout='2s';
ALTER FUNCTION public.restaurant_review_automation_worker(text,uuid,uuid,jsonb) SET lock_timeout='2s';

WITH expected(signature) AS (VALUES
 ('public.restaurant_review_automation_status()'),('public.restaurant_review_automation_preview(uuid,integer,integer)'),
 ('public.restaurant_review_automation_configure(uuid,text,text,text,integer,integer)'),
 ('public.restaurant_review_automation_tick(uuid)'),('public.restaurant_review_automation_worker(text,uuid,uuid,jsonb)')
)
INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature)
SELECT n.nspname,p.proname,p.proargtypes::text,'service_role'::name,expected.signature FROM expected
JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(expected.signature) JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
ON CONFLICT(source_signature,grantee) DO NOTHING;
COMMIT;
