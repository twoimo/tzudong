-- Narrow manual recovery for held crawler rows. No pending reset, approval,
-- cleanup, scheduler, policy or existing assertion/permission changes.
BEGIN;

CREATE TABLE pipeline_control.restaurant_evidence_recovery_jobs (
 id uuid PRIMARY KEY,
 restaurant_id uuid NOT NULL,
 actor uuid NOT NULL,
 policy_version bigint NOT NULL,
 row_sha256 text NOT NULL CHECK (row_sha256 ~ '^[a-f0-9]{64}$'),
 input_sha256 text NOT NULL CHECK (input_sha256 ~ '^[a-f0-9]{64}$'),
 video_id text NOT NULL CHECK (video_id ~ '^[A-Za-z0-9_-]{11}$'),
 original_row jsonb NOT NULL CHECK (jsonb_typeof(original_row)='object'),
 request_operation_id uuid UNIQUE NOT NULL REFERENCES pipeline_control.admin_record_operations(id),
 state text NOT NULL CHECK (state IN ('queued','running','draft','applied','failed','uncertain')),
 reason text NOT NULL CHECK (reason IN ('queued','claimed','evidence_ready','evidence_applied',
   'source_unavailable','gemini_configuration_invalid','evaluation_incomplete','result_invalid',
   'evaluation_failed','gemini_result_uncertain','gemini_decision_invalid','gemini_decision_incomplete','worker_timeout',
   'source_incomplete','source_local_missing','source_input_invalid','source_identity_mismatch','source_recollect_mismatch',
   'source_channel_unverified','source_original_evidence_missing','source_provider_transient','source_provider_unavailable','result_unconfirmed',
   'source_changed','policy_changed')),
 worker_token uuid,
 lease_until timestamptz,
 result jsonb,
 result_sha256 text CHECK (result_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 finished_at timestamptz
);
CREATE UNIQUE INDEX restaurant_evidence_recovery_one_active
 ON pipeline_control.restaurant_evidence_recovery_jobs(restaurant_id)
 WHERE state IN ('queued','running','draft','uncertain');
ALTER TABLE pipeline_control.restaurant_evidence_recovery_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON pipeline_control.restaurant_evidence_recovery_jobs FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON pipeline_control.restaurant_evidence_recovery_jobs TO service_role;

CREATE FUNCTION pipeline_control.evidence_recovery_input_sha(row_value jsonb) RETURNS text
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT pipeline_control.admin_record_hash(row_value-ARRAY['search_count','weekly_search_count','review_count','updated_at'])
$$;

-- Callers serialize mutations through policy -> restaurants -> jobs -> operation.
-- Context is only a read preview; mutation RPCs take those locks and recheck.
CREATE FUNCTION pipeline_control.evidence_recovery_guard(
 actor uuid,target uuid,policy_version bigint,row_sha text,input_sha text,own_job uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE policy pipeline_control.restaurant_review_policy; row_value jsonb;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO policy FROM pipeline_control.restaurant_review_policy WHERE singleton;
 IF NOT FOUND OR NOT policy.enabled OR policy.operator_id IS DISTINCT FROM actor
   OR policy.version IS DISTINCT FROM policy_version THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_POLICY_CHANGED'; END IF;
 PERFORM pipeline_control.assert_restaurant_review_operator(actor);
 SELECT to_jsonb(r) INTO row_value FROM public.restaurants r WHERE r.id=target;
 IF row_value IS NULL THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_NOT_FOUND'; END IF;
 IF row_value->>'status' IS DISTINCT FROM 'hold'
   OR nullif(row_value->>'created_by','') IS NOT NULL OR nullif(row_value->>'updated_by_admin_id','') IS NOT NULL
   OR row_value->>'source_type' IN ('admin','manual','user') OR row_value->'is_not_selected'='true'::jsonb
   OR row_value#>>'{db_error_details,error_type}'='duplicate'
   OR nullif(row_value#>>'{db_error_details,conflicting_restaurant,id}','') IS NOT NULL
 THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_PROTECTED'; END IF;
 IF coalesce(row_value->>'youtube_link','') !~ '^https://(www\.)?youtube\.com/watch\?v=[A-Za-z0-9_-]{11}$'
   OR nullif(btrim(row_value->>'origin_name'),'') IS NULL OR nullif(btrim(row_value->>'trace_id'),'') IS NULL
   OR length(row_value->>'origin_name')>160 OR row_value->>'updated_at' IS NULL
   OR coalesce(row_value->>'channel_name','') NOT IN ('','tzuyang')
 THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_SOURCE_REQUIRED'; END IF;
 IF pipeline_control.admin_record_hash(row_value) IS DISTINCT FROM row_sha
   OR pipeline_control.evidence_recovery_input_sha(row_value) IS DISTINCT FROM input_sha
 THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_STALE'; END IF;
 IF EXISTS(SELECT 1 FROM pipeline_control.restaurant_review_items i WHERE i.restaurant_id=target AND
   (i.state IN ('queued','running') OR (i.state='failed' AND i.reason NOT IN ('source_unavailable','gemini_configuration_invalid'))))
   OR EXISTS(SELECT 1 FROM pipeline_control.restaurant_evidence_recovery_jobs j WHERE j.restaurant_id=target
     AND j.id IS DISTINCT FROM own_job AND j.state IN ('queued','running','draft','uncertain'))
 THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_WORK_OUTSTANDING'; END IF;
 RETURN row_value;
END $$;

CREATE FUNCTION pipeline_control.evidence_recovery_metadata(
 job pipeline_control.restaurant_evidence_recovery_jobs,receipt jsonb DEFAULT NULL
) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT jsonb_build_object('schemaVersion',1,'jobId',job.id,'state',job.state,'reason',job.reason,
  'restaurantId',job.restaurant_id,'policyVersion',job.policy_version,'rowSha256',job.row_sha256,
  'inputSha256',job.input_sha256,'videoId',job.video_id,'resultSha256',job.result_sha256,'receipt',receipt)
$$;

-- Validate a domain result, not provider prose. False/zero evaluations remain
-- real evidence; final approval remains the existing guarded SQL classifier.
CREATE FUNCTION pipeline_control.evidence_recovery_validate_result(
 result jsonb,original jsonb,input_sha text
) RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE evaluation jsonb; metric text; value jsonb; location jsonb; field text;
 allowed text[]:=ARRAY['evaluation_results','geocoding_success','geocoding_false_stage','lat','lng',
   'road_address','jibun_address','english_address','address_elements','naver_name','google_name','categories','gemini_decision'];
BEGIN
 IF jsonb_typeof(result) IS DISTINCT FROM 'object' OR octet_length(result::text)>131072
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(result) k WHERE NOT k=ANY(allowed))
   OR NOT pipeline_control.restaurant_review_gemini_valid(result->'gemini_decision',input_sha)
 THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
 evaluation:=result->'evaluation_results';
 IF jsonb_typeof(evaluation) IS DISTINCT FROM 'object' OR
   EXISTS(SELECT 1 FROM jsonb_object_keys(evaluation) k WHERE NOT k=ANY(ARRAY[
    'visit_authenticity','rb_inference_score','rb_grounding_TF','review_faithfulness_score',
    'category_validity_TF','category_TF','location_match_TF']))
 THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
 FOREACH metric IN ARRAY ARRAY['visit_authenticity','rb_inference_score','rb_grounding_TF',
   'review_faithfulness_score','category_validity_TF','category_TF'] LOOP
  value:=evaluation->metric;
  IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(value) k
    WHERE k NOT IN ('name','eval_value','eval_basis','category_revision')) THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
  IF metric IN ('visit_authenticity','rb_inference_score','review_faithfulness_score') THEN
   IF jsonb_typeof(value->'eval_value') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
   IF (value->>'eval_value')::numeric<0 OR (value->>'eval_value')::numeric>
     (CASE metric WHEN 'visit_authenticity' THEN 4 WHEN 'rb_inference_score' THEN 2 ELSE 1 END)
     OR (metric<>'review_faithfulness_score' AND trunc((value->>'eval_value')::numeric)<>(value->>'eval_value')::numeric)
   THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
  ELSIF jsonb_typeof(value->'eval_value') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
  IF metric NOT IN ('category_validity_TF','category_TF') AND
    (jsonb_typeof(value->'eval_basis') IS DISTINCT FROM 'string'
     OR btrim(value->>'eval_basis') IN ('','-','근거 내용 없음','평가 근거 없음','평가근거없음'))
  THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
 END LOOP;
 location:=evaluation->'location_match_TF';
 IF jsonb_typeof(location) IS DISTINCT FROM 'object'
   OR jsonb_typeof(location->'eval_value') IS DISTINCT FROM 'boolean'
   OR lower(btrim(location->>'origin_name')) IS DISTINCT FROM lower(btrim(original->>'origin_name'))
   OR coalesce(location->>'match_status','') NOT IN ('matched','pending','failed','unmatched')
   OR jsonb_typeof(location->'evidence_families') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(location) k WHERE k NOT IN (
   'name','origin_name','eval_value','match_status','matched_provider','matched_name','naver_name','google_name',
   'origin_address','matched_address','naver_address','evidence_summary','evidence_families','pending_reason',
   'second_pass','falseMessage','identity_state','auto_closed_store','auto_relocated'))
 THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(location->'evidence_families') f WHERE jsonb_typeof(f)<>'string'
   OR f#>>'{}' NOT IN ('provider_candidate','source_geo','cross_provider','browser_verification','geocode_provider','llm_verification'))
 THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
 IF location->'eval_value'='true'::jsonb AND (location->>'match_status'<>'matched'
   OR nullif(location->>'pending_reason','') IS NOT NULL OR nullif(location->>'falseMessage','') IS NOT NULL
   OR (SELECT count(DISTINCT f) FROM jsonb_array_elements_text(location->'evidence_families') f WHERE f<>'llm_verification')<2)
 THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
 IF location->'eval_value'='false'::jsonb AND (location->>'match_status'='matched'
   OR (coalesce(location->>'pending_reason','') NOT IN
     ('insufficient_evidence','cross_country_mismatch','ambiguous_chain','multi_candidate','timeout','rate_limited')
     AND nullif(btrim(location->>'falseMessage'),'') IS NULL))
 THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
 IF jsonb_typeof(result->'geocoding_success') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
 FOREACH field IN ARRAY ARRAY['lat','lng'] LOOP
  IF result ? field AND result->field<>'null'::jsonb THEN
   IF jsonb_typeof(result->field)<>'number' THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
   IF (result->>field)::numeric NOT BETWEEN (CASE field WHEN 'lat' THEN -90 ELSE -180 END) AND
     (CASE field WHEN 'lat' THEN 90 ELSE 180 END) THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
  END IF;
 END LOOP;
 IF result->'geocoding_success'='true'::jsonb AND
   (jsonb_typeof(result->'lat') IS DISTINCT FROM 'number' OR jsonb_typeof(result->'lng') IS DISTINCT FROM 'number'
    OR nullif(btrim(result->>'jibun_address'),'') IS NULL) THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
 FOREACH field IN ARRAY ARRAY['road_address','jibun_address','english_address','naver_name','google_name'] LOOP
  IF result ? field AND (jsonb_typeof(result->field) NOT IN ('null','string') OR length(result->>field)>4000)
  THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
 END LOOP;
 IF result ? 'address_elements' AND jsonb_typeof(result->'address_elements') NOT IN ('object','array','null')
   OR (result ? 'geocoding_false_stage' AND result->'geocoding_false_stage'<>'null'::jsonb AND
     (jsonb_typeof(result->'geocoding_false_stage')<>'number' OR result->>'geocoding_false_stage' !~ '^[0-9]+$'))
 THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
 IF result ? 'geocoding_false_stage' AND result->'geocoding_false_stage'<>'null'::jsonb
   AND (result->>'geocoding_false_stage')::numeric>2147483647 THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
 IF jsonb_typeof(result->'categories') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
 IF jsonb_array_length(result->'categories') NOT BETWEEN 1 AND 15 OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(result->'categories') x WHERE jsonb_typeof(x)<>'string' OR
    x#>>'{}' NOT IN ('치킨','중식','돈까스·회','피자','패스트푸드','찜·탕','족발·보쌈','분식','카페·디저트','한식','고기','양식','아시안','야식','도시락'))
   OR (SELECT count(*)<>count(DISTINCT x) FROM jsonb_array_elements(result->'categories') x)
 THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_INVALID'; END IF;
END $$;

CREATE FUNCTION public.restaurant_evidence_recovery_context(p_actor uuid,p_restaurant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE row_value jsonb; version bigint;
BEGIN
 SELECT policy.version INTO version FROM pipeline_control.restaurant_review_policy policy WHERE singleton;
 SELECT to_jsonb(r) INTO row_value FROM public.restaurants r WHERE r.id=p_restaurant_id;
 row_value:=pipeline_control.evidence_recovery_guard(p_actor,p_restaurant_id,version,
   pipeline_control.admin_record_hash(row_value),pipeline_control.evidence_recovery_input_sha(row_value),NULL);
 RETURN jsonb_build_object('schemaVersion',1,'restaurantId',p_restaurant_id,'policyVersion',version,
  'rowSha256',pipeline_control.admin_record_hash(row_value),'inputSha256',pipeline_control.evidence_recovery_input_sha(row_value),
  'videoId',public.extract_youtube_video_id(row_value->>'youtube_link'),
  'originName',row_value->>'origin_name','sourceUpdatedAt',row_value->>'updated_at');
END $$;

CREATE FUNCTION public.restaurant_evidence_recovery_admin(
 p_actor uuid,p_phase text,p_operation_id uuid,p_job_id uuid,p_restaurant_id uuid,p_policy_version bigint,
 p_row_sha256 text,p_input_sha256 text,p_preview_hash text DEFAULT NULL,p_confirmation text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' AS $$
<<recovery_admin>>
DECLARE job pipeline_control.restaurant_evidence_recovery_jobs; op pipeline_control.admin_record_operations;
 row_value jsonb; expected jsonb; after_state jsonb; payload jsonb; digest text; action text; receipt jsonb;
 audit uuid; is_request boolean; changed public.restaurants; prior jsonb;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_FORBIDDEN' USING ERRCODE='42501'; END IF;
 PERFORM pipeline_control.assert_restaurant_review_operator(p_actor);
 IF p_phase='read' THEN
  SELECT * INTO job FROM pipeline_control.restaurant_evidence_recovery_jobs WHERE id=p_job_id AND actor=p_actor;
  SELECT o.* INTO op FROM pipeline_control.admin_record_operations o WHERE o.id=p_operation_id AND o.actor=p_actor
    AND o.action IN ('restaurant.evidence_recovery.request','restaurant.evidence_recovery.apply');
  IF job.id IS NULL AND op.id IS NULL THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_NOT_FOUND'; END IF;
  IF op.id IS NOT NULL AND (op.target_ids IS DISTINCT FROM ARRAY[p_restaurant_id] OR
    op.receipt->>'jobId' IS DISTINCT FROM p_job_id::text) THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_IDEMPOTENCY_CONFLICT'; END IF;
  IF job.id IS NOT NULL THEN RETURN pipeline_control.evidence_recovery_metadata(job,op.receipt); END IF;
  job.id:=p_job_id;job.restaurant_id:=p_restaurant_id;job.state:='preview';job.reason:='request_preview';
  job.policy_version:=(op.receipt->>'policyVersion')::bigint;job.row_sha256:=op.receipt->>'rowSha256';
  job.input_sha256:=op.receipt->>'inputSha256';job.video_id:=op.receipt->>'videoId';
  RETURN pipeline_control.evidence_recovery_metadata(job,op.receipt);
 END IF;
 IF p_phase IS NULL OR p_phase NOT IN ('preview_request','request','preview_apply','apply') OR
   p_operation_id IS NULL OR p_job_id IS NULL OR p_restaurant_id IS NULL OR p_policy_version IS NULL OR
   coalesce(p_row_sha256,'') !~ '^[a-f0-9]{64}$' OR coalesce(p_input_sha256,'') !~ '^[a-f0-9]{64}$'
 THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_INVALID_PAYLOAD'; END IF;
 is_request:=p_phase IN ('preview_request','request');
 action:=CASE WHEN is_request THEN 'restaurant.evidence_recovery.request' ELSE 'restaurant.evidence_recovery.apply' END;
 IF p_phase LIKE 'preview_%' THEN
  IF p_preview_hash IS NOT NULL OR p_confirmation IS NOT NULL THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_INVALID_PAYLOAD'; END IF;
 ELSIF p_confirmation IS DISTINCT FROM (CASE WHEN is_request THEN 'REQUEST EVIDENCE RECOVERY' ELSE 'APPLY EVIDENCE RECOVERY' END)
   OR coalesce(p_preview_hash,'') !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_CONFIRMATION_REQUIRED'; END IF;
 PERFORM 1 FROM pipeline_control.restaurant_review_policy WHERE singleton FOR UPDATE;
 LOCK TABLE public.restaurants IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO job FROM pipeline_control.restaurant_evidence_recovery_jobs WHERE id=p_job_id FOR UPDATE;
 SELECT * INTO op FROM pipeline_control.admin_record_operations WHERE id=p_operation_id FOR UPDATE;
 payload:=jsonb_build_object('schemaVersion',1,'jobId',p_job_id,'restaurantId',p_restaurant_id,'policyVersion',p_policy_version,
  'rowSha256',p_row_sha256,'inputSha256',p_input_sha256,'resultSha256',CASE WHEN is_request THEN NULL ELSE job.result_sha256 END);
 digest:=pipeline_control.admin_record_hash(payload);
 IF op.id IS NOT NULL THEN
  IF op.actor IS DISTINCT FROM p_actor OR op.action IS DISTINCT FROM action OR op.target_ids IS DISTINCT FROM ARRAY[p_restaurant_id]
    OR op.payload_sha IS DISTINCT FROM digest THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_IDEMPOTENCY_CONFLICT'; END IF;
  IF p_phase NOT LIKE 'preview_%' AND op.preview_hash IS DISTINCT FROM p_preview_hash THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_PREVIEW_MISMATCH'; END IF;
  -- Lost ACK reconciliation returns the same operation, even if policy/source later changed.
  IF op.state='applied' THEN RETURN pipeline_control.evidence_recovery_metadata(job,op.receipt); END IF;
  IF op.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_PREVIEW_EXPIRED'; END IF;
 ELSIF p_phase NOT LIKE 'preview_%' THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_PREVIEW_REQUIRED'; END IF;
 IF job.id IS NOT NULL AND (job.restaurant_id IS DISTINCT FROM p_restaurant_id OR job.actor IS DISTINCT FROM p_actor
   OR job.policy_version IS DISTINCT FROM p_policy_version OR job.row_sha256 IS DISTINCT FROM p_row_sha256
   OR job.input_sha256 IS DISTINCT FROM p_input_sha256) THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_IDEMPOTENCY_CONFLICT'; END IF;
 IF is_request AND job.id IS NOT NULL THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_JOB_EXISTS'; END IF;
 IF NOT is_request AND (job.id IS NULL OR job.state<>'draft' OR job.result_sha256 IS NULL) THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_DRAFT_REQUIRED'; END IF;
 row_value:=pipeline_control.evidence_recovery_guard(p_actor,p_restaurant_id,p_policy_version,p_row_sha256,p_input_sha256,
   CASE WHEN is_request THEN NULL ELSE p_job_id END);
 expected:=pipeline_control.admin_record_snapshot('restaurant.edit',ARRAY[p_restaurant_id]);
 IF op.id IS NOT NULL AND op.expected IS DISTINCT FROM expected THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_STALE'; END IF;
 IF NOT is_request THEN
  IF pipeline_control.admin_record_hash(job.result) IS DISTINCT FROM job.result_sha256 THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_CHANGED'; END IF;
  PERFORM pipeline_control.evidence_recovery_validate_result(job.result,job.original_row,job.input_sha256);
 END IF;
 IF p_phase LIKE 'preview_%' THEN
  IF op.id IS NULL THEN
   receipt:=jsonb_build_object('operationId',p_operation_id,'action',action,'state','preview','targetIds',ARRAY[p_restaurant_id],
   'jobId',p_job_id,'auditId',NULL,'previewHash',pipeline_control.admin_record_hash(jsonb_build_array(p_actor,p_operation_id,action,digest,expected)),
   'expiresAt',clock_timestamp()+interval '15 minutes','readback',pipeline_control.admin_record_readback(expected),'mediaCleanupPending',false,
   'policyVersion',p_policy_version,'rowSha256',p_row_sha256,'inputSha256',p_input_sha256,
   'videoId',public.extract_youtube_video_id(row_value->>'youtube_link'));
   INSERT INTO pipeline_control.admin_record_operations(id,actor,action,target_ids,payload_sha,expected,preview_hash,expires_at,state,receipt)
   VALUES(p_operation_id,p_actor,action,ARRAY[p_restaurant_id],digest,expected,receipt->>'previewHash',(receipt->>'expiresAt')::timestamptz,'preview',receipt);
  ELSE receipt:=op.receipt; END IF;
  -- Preview has no job/provider effect. The receipt's jobId binds the later request.
  IF is_request THEN
   job.id:=p_job_id;job.restaurant_id:=p_restaurant_id;job.state:='preview';job.reason:='request_preview';
   job.policy_version:=p_policy_version;job.row_sha256:=p_row_sha256;job.input_sha256:=p_input_sha256;
   job.video_id:=public.extract_youtube_video_id(row_value->>'youtube_link');
  END IF;
  RETURN pipeline_control.evidence_recovery_metadata(job,receipt);
 END IF;
 IF is_request THEN
  INSERT INTO pipeline_control.restaurant_evidence_recovery_jobs(id,restaurant_id,actor,policy_version,row_sha256,input_sha256,
   video_id,original_row,request_operation_id,state,reason)
   VALUES(p_job_id,p_restaurant_id,p_actor,p_policy_version,p_row_sha256,p_input_sha256,
    public.extract_youtube_video_id(row_value->>'youtube_link'),
    (SELECT jsonb_object_agg(key,value) FROM jsonb_each(row_value) WHERE key=ANY(ARRAY[
      'id','status','origin_name','approved_name','naver_name','google_name','trace_id','trace_id_name_source',
      'channel_name','youtube_link','youtube_meta','reasoning_basis','tzuyang_review','origin_address','recollect_version',
      'source_type','is_missing','is_not_selected','evaluation_results','geocoding_success','geocoding_false_stage',
      'lat','lng','road_address','jibun_address','english_address','address_elements','categories'])),
    p_operation_id,'queued','queued') RETURNING * INTO job;
 ELSE
  prior:=row_value;
  changed:=jsonb_populate_record(NULL::public.restaurants,row_value||(job.result-'gemini_decision'));
  UPDATE public.restaurants SET evaluation_results=changed.evaluation_results,geocoding_success=changed.geocoding_success,
   geocoding_false_stage=changed.geocoding_false_stage,lat=changed.lat,lng=changed.lng,road_address=changed.road_address,
   jibun_address=changed.jibun_address,english_address=changed.english_address,address_elements=changed.address_elements,
   naver_name=changed.naver_name,google_name=changed.google_name,categories=changed.categories,
   updated_by_admin_id=p_actor,updated_at=clock_timestamp() WHERE id=p_restaurant_id;
  SELECT to_jsonb(r) INTO row_value FROM public.restaurants r WHERE r.id=p_restaurant_id;
  IF (row_value-ARRAY['evaluation_results','geocoding_success','geocoding_false_stage','lat','lng','road_address',
    'jibun_address','english_address','address_elements','naver_name','google_name','categories','updated_by_admin_id','updated_at'])
    IS DISTINCT FROM (prior-ARRAY['evaluation_results','geocoding_success','geocoding_false_stage','lat','lng','road_address',
    'jibun_address','english_address','address_elements','naver_name','google_name','categories','updated_by_admin_id','updated_at'])
    OR EXISTS(SELECT 1 FROM jsonb_each(job.result-'gemini_decision') item WHERE row_value->item.key IS DISTINCT FROM item.value)
    OR row_value->>'status' IS DISTINCT FROM 'hold' OR row_value->>'updated_by_admin_id' IS DISTINCT FROM p_actor::text
  THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_READBACK_FAILED'; END IF;
  UPDATE pipeline_control.restaurant_evidence_recovery_jobs SET state='applied',reason='evidence_applied',finished_at=clock_timestamp()
   WHERE id=p_job_id RETURNING * INTO job;
 END IF;
 after_state:=pipeline_control.admin_record_snapshot('restaurant.edit',ARRAY[p_restaurant_id]);
 audit:=gen_random_uuid();
 INSERT INTO pipeline_control.admin_record_audit(id,operation_id,actor,action,target_ids,payload_sha,before_fingerprints,after_fingerprints)
  VALUES(audit,p_operation_id,p_actor,action,ARRAY[p_restaurant_id],digest,expected,after_state);
 receipt:=op.receipt||jsonb_build_object('state','applied','auditId',audit,'readback',pipeline_control.admin_record_readback(after_state));
 UPDATE pipeline_control.admin_record_operations SET state='applied',receipt=recovery_admin.receipt WHERE id=p_operation_id;
 RETURN pipeline_control.evidence_recovery_metadata(job,receipt);
END $$;

CREATE FUNCTION public.restaurant_evidence_recovery_worker(
 p_phase text,p_job_id uuid,p_token uuid,p_result jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' SET lock_timeout='2s' AS $$
DECLARE job pipeline_control.restaurant_evidence_recovery_jobs; code text; row_value jsonb;
 policy pipeline_control.restaurant_review_policy;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_phase IS NULL OR p_phase NOT IN ('next','claim','complete','fail','read') OR p_token IS NULL
   OR (p_phase<>'next' AND p_job_id IS NULL) OR (p_phase='next' AND p_job_id IS NOT NULL)
 THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_INVALID_PAYLOAD'; END IF;
 IF p_phase='next' THEN
  SELECT * INTO policy FROM pipeline_control.restaurant_review_policy WHERE singleton;
  IF NOT FOUND OR NOT policy.enabled THEN RETURN NULL; END IF;
  PERFORM pipeline_control.assert_restaurant_review_operator(policy.operator_id);
  -- Read only: old-policy jobs stay discoverable so claim can retire only a
  -- confirmed unspent request. Concurrent readers do not acquire a paid lease.
  SELECT * INTO job FROM pipeline_control.restaurant_evidence_recovery_jobs
   WHERE state='queued' AND worker_token IS NULL ORDER BY created_at,id LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN pipeline_control.evidence_recovery_metadata(job);
 END IF;
 IF p_phase<>'read' THEN
  PERFORM 1 FROM pipeline_control.restaurant_review_policy WHERE singleton FOR UPDATE;
  LOCK TABLE public.restaurants IN SHARE ROW EXCLUSIVE MODE;
 END IF;
 SELECT * INTO job FROM pipeline_control.restaurant_evidence_recovery_jobs WHERE id=p_job_id
  AND (worker_token IS NULL OR worker_token=p_token) FOR UPDATE;
 IF job.id IS NULL THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_NOT_FOUND'; END IF;
 IF p_phase='read' THEN RETURN pipeline_control.evidence_recovery_metadata(job); END IF;
 IF p_phase='claim' THEN
  -- A repeated claim returns metadata only. Expired/uncertain work is never reclaimed.
  IF job.state<>'queued' THEN RETURN pipeline_control.evidence_recovery_metadata(job); END IF;
  IF job.worker_token IS NOT NULL THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_STATE_CONFLICT'; END IF;
  BEGIN
   row_value:=pipeline_control.evidence_recovery_guard(job.actor,job.restaurant_id,job.policy_version,job.row_sha256,job.input_sha256,job.id);
  EXCEPTION WHEN OTHERS THEN
   GET STACKED DIAGNOSTICS code=MESSAGE_TEXT;
   IF code NOT IN ('EVIDENCE_RECOVERY_STALE','EVIDENCE_RECOVERY_PROTECTED',
     'EVIDENCE_RECOVERY_SOURCE_REQUIRED','EVIDENCE_RECOVERY_POLICY_CHANGED') THEN RAISE; END IF;
   UPDATE pipeline_control.restaurant_evidence_recovery_jobs SET state='failed',
    reason=CASE WHEN code='EVIDENCE_RECOVERY_POLICY_CHANGED' THEN 'policy_changed' ELSE 'source_changed' END,
    finished_at=clock_timestamp() WHERE id=p_job_id AND state='queued' AND worker_token IS NULL RETURNING * INTO job;
   RETURN pipeline_control.evidence_recovery_metadata(job);
  END;
  UPDATE pipeline_control.restaurant_evidence_recovery_jobs SET state='running',reason='claimed',worker_token=p_token,
   lease_until=clock_timestamp()+interval '60 minutes' WHERE id=p_job_id RETURNING * INTO job;
  RETURN pipeline_control.evidence_recovery_metadata(job)||jsonb_build_object('restaurant',row_value,
   'decisionContext',jsonb_build_object('inputSha256',job.input_sha256));
 END IF;
 IF job.worker_token IS DISTINCT FROM p_token THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_NOT_FOUND'; END IF;
 IF p_phase='complete' AND job.state IN ('draft','applied') THEN
  IF pipeline_control.admin_record_hash(p_result) IS DISTINCT FROM job.result_sha256 THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_CHANGED'; END IF;
  RETURN pipeline_control.evidence_recovery_metadata(job);
 END IF;
 IF p_phase='fail' AND job.state IN ('failed','uncertain') THEN
  IF p_result IS DISTINCT FROM jsonb_build_object('code',job.reason) THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_STATE_CONFLICT'; END IF;
  RETURN pipeline_control.evidence_recovery_metadata(job);
 END IF;
 IF job.state<>'running' THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_STATE_CONFLICT'; END IF;
 IF p_phase='fail' THEN
  code:=p_result->>'code';
  IF jsonb_typeof(p_result) IS DISTINCT FROM 'object' OR p_result IS DISTINCT FROM jsonb_build_object('code',code)
    OR code IS NULL OR code NOT IN ('source_unavailable','gemini_configuration_invalid','evaluation_incomplete',
      'result_invalid','evaluation_failed','gemini_result_uncertain','gemini_decision_invalid','gemini_decision_incomplete','worker_timeout',
      'source_incomplete','source_local_missing','source_input_invalid','source_identity_mismatch','source_recollect_mismatch',
      'source_channel_unverified','source_original_evidence_missing','source_provider_transient','source_provider_unavailable','result_unconfirmed')
  THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_INVALID_PAYLOAD'; END IF;
  -- Only known pre-provider failures are retryable by a later explicit request.
  -- No lease expiry or generic failure asserts that a paid attempt did not occur.
  UPDATE pipeline_control.restaurant_evidence_recovery_jobs SET
   state=CASE WHEN code IN ('source_unavailable','gemini_configuration_invalid','source_incomplete','source_local_missing',
    'source_input_invalid','source_identity_mismatch','source_recollect_mismatch','source_channel_unverified',
    'source_original_evidence_missing','source_provider_transient','source_provider_unavailable') THEN 'failed' ELSE 'uncertain' END,
   reason=code,finished_at=clock_timestamp() WHERE id=p_job_id RETURNING * INTO job;
  RETURN pipeline_control.evidence_recovery_metadata(job);
 END IF;
 IF job.lease_until<=clock_timestamp() THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_LEASE_EXPIRED'; END IF;
 PERFORM pipeline_control.evidence_recovery_guard(job.actor,job.restaurant_id,job.policy_version,job.row_sha256,job.input_sha256,job.id);
 PERFORM pipeline_control.evidence_recovery_validate_result(p_result,job.original_row,job.input_sha256);
 UPDATE pipeline_control.restaurant_evidence_recovery_jobs SET state='draft',reason='evidence_ready',result=p_result,
  result_sha256=pipeline_control.admin_record_hash(p_result),finished_at=clock_timestamp() WHERE id=p_job_id RETURNING * INTO job;
 RETURN pipeline_control.evidence_recovery_metadata(job);
END $$;

CREATE FUNCTION public.restaurant_evidence_recovery_status(p_actor uuid,p_restaurant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE jobs jsonb:='[]'; job pipeline_control.restaurant_evidence_recovery_jobs;
 apply_id uuid; metadata jsonb; entry record; op pipeline_control.admin_record_operations;
BEGIN
 IF current_user<>'service_role' THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_FORBIDDEN' USING ERRCODE='42501'; END IF;
 PERFORM pipeline_control.assert_restaurant_review_operator(p_actor);
 FOR entry IN
  SELECT * FROM (
   SELECT j.created_at,j.id AS sort_id,j.id AS job_id,NULL::uuid AS preview_id
    FROM pipeline_control.restaurant_evidence_recovery_jobs j WHERE j.restaurant_id=p_restaurant_id AND j.actor=p_actor
   UNION ALL
   SELECT o.created_at,o.id,NULL::uuid,o.id FROM pipeline_control.admin_record_operations o
    WHERE o.actor=p_actor AND o.action='restaurant.evidence_recovery.request' AND o.state='preview'
     AND o.expires_at>clock_timestamp() AND o.target_ids=ARRAY[p_restaurant_id]
     AND NOT EXISTS(SELECT 1 FROM pipeline_control.restaurant_evidence_recovery_jobs j WHERE j.id::text=o.receipt->>'jobId')
  ) candidates ORDER BY created_at DESC,sort_id DESC LIMIT 5
 LOOP
  IF entry.preview_id IS NOT NULL THEN
   SELECT * INTO op FROM pipeline_control.admin_record_operations WHERE id=entry.preview_id;
   job:=NULL;job.id:=(op.receipt->>'jobId')::uuid;job.restaurant_id:=p_restaurant_id;
   job.state:='preview';job.reason:='request_preview';job.policy_version:=(op.receipt->>'policyVersion')::bigint;
   job.row_sha256:=op.receipt->>'rowSha256';job.input_sha256:=op.receipt->>'inputSha256';job.video_id:=op.receipt->>'videoId';
   metadata:=pipeline_control.evidence_recovery_metadata(job)||jsonb_build_object('requestOperationId',op.id,'applyOperationId',NULL,'proposal',NULL);
   jobs:=jobs||jsonb_build_array(metadata);
   CONTINUE;
  END IF;
  SELECT * INTO job FROM pipeline_control.restaurant_evidence_recovery_jobs WHERE id=entry.job_id;
  SELECT o.id INTO apply_id FROM pipeline_control.admin_record_operations o
   WHERE o.actor=p_actor AND o.action='restaurant.evidence_recovery.apply' AND o.receipt->>'jobId'=job.id::text
    AND o.target_ids=ARRAY[p_restaurant_id] ORDER BY o.created_at DESC,o.id DESC LIMIT 1;
  metadata:=pipeline_control.evidence_recovery_metadata(job)||
   jsonb_build_object('requestOperationId',job.request_operation_id,'applyOperationId',apply_id,'proposal',NULL);
  IF job.state='draft' THEN
   IF pipeline_control.admin_record_hash(job.result) IS DISTINCT FROM job.result_sha256 THEN RAISE EXCEPTION 'EVIDENCE_RECOVERY_RESULT_CHANGED'; END IF;
   PERFORM pipeline_control.evidence_recovery_validate_result(job.result,job.original_row,job.input_sha256);
   metadata:=metadata||jsonb_build_object('proposal',job.result-'gemini_decision');
  END IF;
  jobs:=jobs||jsonb_build_array(metadata);
 END LOOP;
 RETURN jsonb_build_object('schemaVersion',1,'restaurantId',p_restaurant_id,'jobs',jobs);
END $$;

REVOKE ALL ON FUNCTION pipeline_control.evidence_recovery_input_sha(jsonb),
 pipeline_control.evidence_recovery_guard(uuid,uuid,bigint,text,text,uuid),
 pipeline_control.evidence_recovery_metadata(pipeline_control.restaurant_evidence_recovery_jobs,jsonb),
 pipeline_control.evidence_recovery_validate_result(jsonb,jsonb,text),
 public.restaurant_evidence_recovery_context(uuid,uuid),
 public.restaurant_evidence_recovery_status(uuid,uuid),
 public.restaurant_evidence_recovery_admin(uuid,text,uuid,uuid,uuid,bigint,text,text,text,text),
 public.restaurant_evidence_recovery_worker(text,uuid,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pipeline_control.evidence_recovery_input_sha(jsonb),
 pipeline_control.evidence_recovery_guard(uuid,uuid,bigint,text,text,uuid),
 pipeline_control.evidence_recovery_metadata(pipeline_control.restaurant_evidence_recovery_jobs,jsonb),
 pipeline_control.evidence_recovery_validate_result(jsonb,jsonb,text),
 public.restaurant_evidence_recovery_context(uuid,uuid),
 public.restaurant_evidence_recovery_status(uuid,uuid),
 public.restaurant_evidence_recovery_admin(uuid,text,uuid,uuid,uuid,bigint,text,text,text,text),
 public.restaurant_evidence_recovery_worker(text,uuid,uuid,jsonb) TO service_role;

-- Add only four exact invoker identities to both frozen G014 assertion bodies.
-- Their previous bytes/metadata and all previous checks are preserved. The
-- owner-owned temporary bridge follows existing registration custody; no
-- permanent assertion EXECUTE grant or owner membership is introduced.
DO $evidence_recovery_registration$
DECLARE members_before jsonb; members_after jsonb; helper oid; lease text;
 major integer:=current_setting('server_version_num')::integer/10000;
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres' OR major NOT IN (15,17)
   OR current_setting('transaction_read_only')<>'off'
   OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='privacy_workflow_owner' AND NOT rolsuper
    AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolinherit)
 THEN RAISE EXCEPTION 'G014_EVIDENCE_EXECUTOR'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') INTO members_before FROM pg_auth_members m;
 IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN
  IF major=17 THEN
   IF pg_has_role('postgres','privacy_workflow_owner','SET') OR pg_has_role('postgres','privacy_workflow_owner','USAGE')
     OR EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole AND grantor='postgres'::regrole)
     OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole
       AND admin_option AND NOT inherit_option AND NOT set_option)
   THEN RAISE EXCEPTION 'G014_EVIDENCE_MEMBERSHIP'; END IF;
   EXECUTE 'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres';
   lease:='pg17';
  ELSIF NOT pg_has_role('postgres','privacy_workflow_owner','MEMBER') THEN
   IF NOT (SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user) THEN RAISE EXCEPTION 'G014_EVIDENCE_MEMBERSHIP'; END IF;
   EXECUTE 'GRANT privacy_workflow_owner TO postgres';lease:='pg15';
  END IF;
 END IF;
 IF to_regprocedure('pg_temp.evidence_recovery_registration()') IS NOT NULL THEN RAISE EXCEPTION 'G014_EVIDENCE_HELPER'; END IF;
 EXECUTE 'SET LOCAL ROLE privacy_workflow_owner';
 EXECUTE $definition$
 CREATE FUNCTION pg_temp.evidence_recovery_registration() RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
 DECLARE name text; target oid; definition text; source text; admitted text; metadata jsonb; expected text[];
  anchor text; addition text; rewritten text; status_anchor text:=$status_anchor$      'public.restaurant_review_automation_status()',$status_anchor$;
  record_addition text:=$record_addition$      'public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)',
$record_addition$;
  raw_addition text:=$raw_addition$      'public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)',
$raw_addition$;
  invoker_addition text:=$recovery_invoker$    IF v_signature IN (
      'public.restaurant_evidence_recovery_context(uuid,uuid)',
      'public.restaurant_evidence_recovery_status(uuid,uuid)',
      'public.restaurant_evidence_recovery_admin(uuid,text,uuid,uuid,uuid,bigint,text,text,text,text)',
      'public.restaurant_evidence_recovery_worker(text,uuid,uuid,jsonb)'
    ) THEN
      IF v_is_definer OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=v_oid
          AND p.proowner='postgres'::pg_catalog.regrole AND p.prokind='f' AND NOT p.proretset
          AND p.prorettype='jsonb'::pg_catalog.regtype AND NOT p.proisstrict AND NOT p.proleakproof
          AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
          AND p.provolatile=(CASE WHEN v_signature='public.restaurant_evidence_recovery_status(uuid,uuid)' THEN 's' ELSE 'v' END)::"char"
          AND p.proconfig IS NOT DISTINCT FROM CASE WHEN v_signature='public.restaurant_evidence_recovery_status(uuid,uuid)'
            THEN ARRAY['search_path=""']::text[] ELSE ARRAY['search_path=""','lock_timeout=2s']::text[] END
          AND pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
          AND NOT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
          AND NOT pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
            WHERE acl.grantee NOT IN (p.proowner,'service_role'::pg_catalog.regrole) OR acl.is_grantable)
      ) OR (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist
        WHERE source_signature=v_signature AND grantee='service_role')<>1
        OR EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist
          WHERE source_signature=v_signature AND grantee<>'service_role')
      THEN RAISE EXCEPTION 'G014 evidence recovery SECURITY INVOKER contract mismatch: %',v_signature;
      END IF;
      CONTINUE;
    END IF;
$recovery_invoker$;
 BEGIN
  IF session_user<>'postgres' OR current_user<>'privacy_workflow_owner' THEN RAISE EXCEPTION 'G014_EVIDENCE_EXECUTOR'; END IF;
  IF EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature IN (
    'public.restaurant_evidence_recovery_context(uuid,uuid)','public.restaurant_evidence_recovery_status(uuid,uuid)',
    'public.restaurant_evidence_recovery_admin(uuid,text,uuid,uuid,uuid,bigint,text,text,text,text)',
    'public.restaurant_evidence_recovery_worker(text,uuid,uuid,jsonb)')) THEN RAISE EXCEPTION 'G014_EVIDENCE_ALLOWLIST_DRIFT'; END IF;
  FOREACH name IN ARRAY ARRAY['definer','catalog'] LOOP
   target:=to_regprocedure('privacy_retention.assert_g014_'||name||'_contract()');
   SELECT pg_get_functiondef(p.oid),p.prosrc,to_jsonb(p)-'prosrc' INTO definition,source,metadata FROM pg_proc p
    WHERE p.oid=target AND p.proowner='privacy_workflow_owner'::regrole AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[];
   expected:=CASE WHEN name='definer' THEN ARRAY['f3fe7e01b85da1718b91ff0439e204b2c07f9795b6bda720b277a50e56eb51d8','a5fff8ca63e34d41fc7c56e5a646023d44645750a7abf9ae0c0efc35818aa964','046f35860df85c3d05434d41887975f3e1a019e2b5e148abdcf49b19bf2ebab5']
    ELSE ARRAY['06076b2296e9cf2cef9748ef43390a7805fe90c0a9145f96e9fed8ff62f9f330','8e9101ecdbb506e25a9ace2a40f7de9cc0dcf3f06d80cc1a75fe07a55effbeab','a144c3149a1964633852e3817e2d7ab1503cd2bbdae012f0fa4d5387222c03df'] END;
   -- Also admit the exact observed hosted variant (fixture SHA-bound in tests).
   -- Its older existing checks are retained, never replaced by a local template.
   -- Remove only the two previously admitted exact additions for preimage
   -- verification. The live rewritten source retains both additions verbatim.
   admitted:=source;
   IF definition IS NULL OR (length(admitted)-length(replace(admitted,raw_addition||status_anchor,'')))<>length(raw_addition||status_anchor)
    THEN RAISE EXCEPTION 'G014_EVIDENCE_SOURCE_DRIFT'; END IF;
   admitted:=replace(admitted,raw_addition||status_anchor,status_anchor);
   IF (length(admitted)-length(replace(admitted,record_addition||status_anchor,'')))<>length(record_addition||status_anchor)
    THEN RAISE EXCEPTION 'G014_EVIDENCE_SOURCE_DRIFT'; END IF;
   admitted:=replace(admitted,record_addition||status_anchor,status_anchor);
   IF NOT(encode(sha256(convert_to(admitted,'UTF8')),'hex')=ANY(expected)) THEN RAISE EXCEPTION 'G014_EVIDENCE_SOURCE_DRIFT'; END IF;
   anchor:='    IF '||CASE WHEN name='definer' THEN 'v_signature' ELSE 'v_expected.source_signature' END||E' IN (\n      ''public.match_storyboard_documents_hybrid';
   addition:=CASE WHEN name='definer' THEN invoker_addition
     ELSE replace(replace(invoker_addition,'v_signature','v_expected.source_signature'),'v_oid','v_procedure') END;
   IF (length(source)-length(replace(source,anchor,'')))<>length(anchor) OR strpos(source,addition)>0
    THEN RAISE EXCEPTION 'G014_EVIDENCE_SOURCE_DRIFT'; END IF;
   rewritten:=replace(source,anchor,addition||anchor);
   IF replace(rewritten,addition||anchor,anchor) IS DISTINCT FROM source THEN RAISE EXCEPTION 'G014_EVIDENCE_SOURCE_DRIFT'; END IF;
   EXECUTE replace(definition,source,rewritten);
   IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM metadata
     OR (SELECT p.prosrc FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM rewritten
    THEN RAISE EXCEPTION 'G014_EVIDENCE_METADATA_DRIFT'; END IF;
  END LOOP;
  INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature)
   SELECT n.nspname,p.proname,p.proargtypes::text,'service_role',signature
   FROM unnest(ARRAY['public.restaurant_evidence_recovery_context(uuid,uuid)',
    'public.restaurant_evidence_recovery_status(uuid,uuid)',
    'public.restaurant_evidence_recovery_admin(uuid,text,uuid,uuid,uuid,bigint,text,text,text,text)',
    'public.restaurant_evidence_recovery_worker(text,uuid,uuid,jsonb)']) signature
   JOIN pg_proc p ON p.oid=to_regprocedure(signature) JOIN pg_namespace n ON n.oid=p.pronamespace;
  PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
  PERFORM privacy_retention.assert_g014_definer_contract();
  DROP FUNCTION pg_temp.evidence_recovery_registration();
 END $body$;
 $definition$;
 EXECUTE 'REVOKE ALL ON FUNCTION pg_temp.evidence_recovery_registration() FROM PUBLIC,anon,authenticated,service_role';
 EXECUTE 'GRANT EXECUTE ON FUNCTION pg_temp.evidence_recovery_registration() TO postgres';
 EXECUTE 'RESET ROLE';
 IF lease='pg17' THEN EXECUTE 'REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres';
 ELSIF lease='pg15' THEN EXECUTE 'REVOKE privacy_workflow_owner FROM postgres'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') INTO members_after FROM pg_auth_members m;
 IF members_after IS DISTINCT FROM members_before THEN RAISE EXCEPTION 'G014_EVIDENCE_MEMBERSHIP_DRIFT'; END IF;
 helper:=to_regprocedure('pg_temp.evidence_recovery_registration()');
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE p.oid=helper AND p.proowner='privacy_workflow_owner'::regrole
   AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[]
   AND (SELECT count(*) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))))=2
   AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
     WHERE a.grantee NOT IN ('privacy_workflow_owner'::regrole,'postgres'::regrole) OR a.is_grantable))
 THEN RAISE EXCEPTION 'G014_EVIDENCE_HELPER'; END IF;
 PERFORM pg_temp.evidence_recovery_registration();
 IF to_regprocedure('pg_temp.evidence_recovery_registration()') IS NOT NULL THEN RAISE EXCEPTION 'G014_EVIDENCE_HELPER'; END IF;
END $evidence_recovery_registration$;
COMMIT;
