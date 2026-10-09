-- Gemini recommendation is necessary, never sufficient, for automatic approval.
-- Apply after 20261004045404_restaurant_review_category_contract.sql.
BEGIN;
ALTER TABLE pipeline_control.restaurant_review_items ADD COLUMN input_sha256 text,
  ADD COLUMN applied_fingerprint text, ADD COLUMN gemini_decision jsonb;

CREATE FUNCTION pipeline_control.restaurant_review_gemini_valid(value jsonb,input_sha text)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE codes text[]; approval text[]:=ARRAY['visit_supported','identity_supported','review_grounded','category_supported','location_corroborated','source_consistent'];
BEGIN
 IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR value->'schemaVersion' IS DISTINCT FROM '1'::jsonb
   OR value->>'model' IS DISTINCT FROM 'gemini-3.8-flash' OR value->>'modelVersion' IS DISTINCT FROM 'gemini-3.8-flash'
   OR value->>'promptVersion' IS DISTINCT FROM 'restaurant-review-v1'
   OR input_sha IS NULL OR input_sha !~ '^[a-f0-9]{64}$' OR value->>'inputSha256' IS DISTINCT FROM input_sha
   OR coalesce(value->>'promptSha256','') !~ '^[a-f0-9]{64}$'
   OR coalesce(value->>'recommendation','') NOT IN ('approve','hold','recheck')
   OR jsonb_typeof(value->'evidenceCodes') IS DISTINCT FROM 'array'
   OR (SELECT count(*) FROM jsonb_object_keys(value))<>8
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(value) k WHERE k NOT IN
     ('schemaVersion','model','modelVersion','promptVersion','inputSha256','promptSha256','recommendation','evidenceCodes'))
 THEN RETURN false; END IF;
 IF jsonb_array_length(value->'evidenceCodes') NOT BETWEEN 1 AND 12
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(value->'evidenceCodes') code WHERE jsonb_typeof(code)<>'string') THEN RETURN false; END IF;
 SELECT array_agg(code) INTO codes FROM jsonb_array_elements_text(value->'evidenceCodes') code;
 IF cardinality(codes)<>(SELECT count(DISTINCT code) FROM unnest(codes) code)
   OR NOT codes <@ (approval||ARRAY['insufficient_evidence','identity_conflict','location_conflict','review_unfaithful','category_conflict','source_conflict'])
 THEN RETURN false; END IF;
 IF value->>'recommendation'='approve' THEN RETURN codes @> approval AND codes <@ approval; END IF;
 RETURN NOT codes <@ approval;
END; $$;
REVOKE ALL ON FUNCTION pipeline_control.restaurant_review_gemini_valid(jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION pipeline_control.restaurant_review_gemini_valid(jsonb,text) TO service_role;

CREATE OR REPLACE FUNCTION public.restaurant_review_automation_tick(request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE policy pipeline_control.restaurant_review_policy; run pipeline_control.restaurant_review_runs;
 restaurant public.restaurants; previous pipeline_control.restaurant_review_items;
 data jsonb; v_fingerprint text; classification text; decision text; reason text; remaining integer;
BEGIN
 IF request_id IS NULL THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_REQUEST_INVALID'; END IF;
 SELECT * INTO policy FROM pipeline_control.restaurant_review_policy WHERE singleton FOR UPDATE;
 SELECT * INTO run FROM pipeline_control.restaurant_review_runs r WHERE r.request_id=restaurant_review_automation_tick.request_id;
 IF FOUND THEN RETURN to_jsonb(run); END IF;
 IF NOT policy.enabled THEN RETURN jsonb_build_object('disabled',true); END IF;
 PERFORM pipeline_control.assert_restaurant_review_operator(policy.operator_id);
 LOCK TABLE public.restaurants IN SHARE ROW EXCLUSIVE MODE;
 SELECT greatest(0,policy.daily_limit-count(*)) INTO remaining FROM pipeline_control.restaurant_review_items
   WHERE restaurant_review_items.decision='approve' AND state='applied' AND finished_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';
 INSERT INTO pipeline_control.restaurant_review_runs(request_id,policy_version) VALUES(request_id,policy.version) RETURNING * INTO run;
 FOR restaurant IN SELECT candidate.* FROM public.restaurants candidate WHERE candidate.status='pending' AND (
   NOT EXISTS(SELECT 1 FROM pipeline_control.restaurant_review_items prior WHERE prior.restaurant_id=candidate.id
     AND (prior.fingerprint=pipeline_control.restaurant_review_fingerprint(to_jsonb(candidate)) OR prior.applied_fingerprint=pipeline_control.restaurant_review_fingerprint(to_jsonb(candidate))))
   OR EXISTS(SELECT 1 FROM pipeline_control.restaurant_review_items prior JOIN pipeline_control.restaurant_review_runs r ON r.id=prior.run_id
     WHERE prior.restaurant_id=candidate.id AND prior.applied_fingerprint=pipeline_control.restaurant_review_fingerprint(to_jsonb(candidate))
       AND prior.state='succeeded' AND prior.reason='daily_limit' AND r.policy_version=policy.version))
   AND (remaining>0 OR pipeline_control.restaurant_review_decision(to_jsonb(candidate)) NOT LIKE 'approve:%')
   ORDER BY candidate.created_at,candidate.id LIMIT policy.batch_size FOR UPDATE
 LOOP
   data:=to_jsonb(restaurant);v_fingerprint:=pipeline_control.restaurant_review_fingerprint(data);
   classification:=pipeline_control.restaurant_review_decision(data);decision:=split_part(classification,':',1);reason:=split_part(classification,':',2);
   SELECT prior.* INTO previous FROM pipeline_control.restaurant_review_items prior JOIN pipeline_control.restaurant_review_runs r ON r.id=prior.run_id
     WHERE prior.restaurant_id=restaurant.id AND prior.applied_fingerprint=v_fingerprint AND prior.state='succeeded' AND prior.reason='daily_limit'
       AND r.policy_version=policy.version ORDER BY prior.created_at DESC LIMIT 1 FOR UPDATE OF prior;
   IF FOUND THEN
     IF decision='approve' AND remaining>0 AND previous.gemini_decision->>'recommendation'='approve'
       AND pipeline_control.restaurant_review_gemini_valid(previous.gemini_decision-ARRAY['outcome','decidedAt'],previous.input_sha256) THEN
       UPDATE public.restaurants SET status='approved',approved_name=coalesce(nullif(btrim(approved_name),''),nullif(btrim(naver_name),''),nullif(btrim(google_name),''),origin_name),
         updated_by_admin_id=policy.operator_id,updated_at=now() WHERE id=restaurant.id;
       IF NOT EXISTS(SELECT 1 FROM public.restaurants WHERE id=restaurant.id AND status='approved' AND updated_by_admin_id=policy.operator_id)
         THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_READBACK_FAILED'; END IF;
       UPDATE pipeline_control.restaurant_review_items SET state='applied',decision='approve',reason='gemini_approved',finished_at=now(),
         gemini_decision=gemini_decision||jsonb_build_object('outcome','approve') WHERE id=previous.id;
       run.approved:=run.approved+1;remaining:=remaining-1;
     ELSE
       UPDATE pipeline_control.restaurant_review_items SET state='cancelled',reason='server_constraints',finished_at=now(),
         gemini_decision=gemini_decision||jsonb_build_object('outcome','blocked') WHERE id=previous.id;
     END IF;
   ELSE
     IF decision='approve' THEN decision:='recheck';reason:='gemini_decision_required'; END IF;
     IF decision='recheck' THEN run.recheck:=run.recheck+1;
     ELSIF decision='protected' THEN run.protected:=run.protected+1;
     ELSE
       UPDATE public.restaurants SET status='hold',updated_at=now() WHERE id=restaurant.id;
       IF NOT EXISTS(SELECT 1 FROM public.restaurants WHERE id=restaurant.id AND status='hold') THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_READBACK_FAILED'; END IF;
       run.held:=run.held+1;
     END IF;
     INSERT INTO pipeline_control.restaurant_review_items(run_id,restaurant_id,fingerprint,decision,reason,state,finished_at)
       VALUES(run.id,restaurant.id,v_fingerprint,decision,reason,CASE WHEN decision='recheck' THEN 'queued' ELSE 'applied' END,CASE WHEN decision='recheck' THEN NULL ELSE now() END);
   END IF;
   run.scanned:=run.scanned+1;
 END LOOP;
 UPDATE pipeline_control.restaurant_review_runs SET scanned=run.scanned,approved=run.approved,recheck=run.recheck,held=run.held,protected=run.protected WHERE id=run.id;
 UPDATE pipeline_control.restaurant_review_policy SET last_run_at=now() WHERE singleton;
 RETURN to_jsonb(run);
END; $$;
ALTER FUNCTION public.restaurant_review_automation_tick(uuid) SET lock_timeout='2s';

CREATE OR REPLACE FUNCTION public.restaurant_review_automation_worker(action text,item_id uuid,token uuid,result jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE policy pipeline_control.restaurant_review_policy; item pipeline_control.restaurant_review_items; restaurant public.restaurants;
 fields text[]:=ARRAY['evaluation_results','geocoding_success','geocoding_false_stage','lat','lng','road_address','jibun_address','english_address','address_elements','naver_name','google_name','categories','gemini_decision'];
 recommendation jsonb; classification text; final_decision text; final_reason text; remaining integer; outcome text;
BEGIN
 IF token IS NULL THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_LEASE_INVALID'; END IF;
 SELECT * INTO policy FROM pipeline_control.restaurant_review_policy WHERE singleton FOR UPDATE;
 IF action='read' THEN
   SELECT * INTO item FROM pipeline_control.restaurant_review_items WHERE id=item_id AND worker_token=token;
   IF NOT FOUND THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_LEASE_INVALID'; END IF;
   RETURN jsonb_build_object('state',item.state,'reason',item.reason,'geminiDecision',item.gemini_decision);
 END IF;
 IF NOT policy.enabled THEN RETURN jsonb_build_object('disabled',true); END IF;
 PERFORM pipeline_control.assert_restaurant_review_operator(policy.operator_id);
 IF action='claim' THEN
   UPDATE pipeline_control.restaurant_review_items SET state='failed',reason='worker_lease_expired',finished_at=now() WHERE state='running' AND lease_until<now();
   IF EXISTS(SELECT 1 FROM pipeline_control.restaurant_review_items WHERE state='running') THEN RETURN NULL; END IF;
   UPDATE pipeline_control.restaurant_review_items SET state='cancelled',reason='source_changed',finished_at=now() WHERE id IN (
     SELECT queued.id FROM pipeline_control.restaurant_review_items queued LEFT JOIN public.restaurants candidate ON candidate.id=queued.restaurant_id
     JOIN pipeline_control.restaurant_review_runs r ON r.id=queued.run_id
     WHERE queued.state='queued' AND (candidate.id IS NULL OR candidate.status<>'pending' OR candidate.updated_by_admin_id IS NOT NULL
       OR candidate.created_by IS NOT NULL OR r.policy_version<>policy.version OR pipeline_control.restaurant_review_fingerprint(to_jsonb(candidate))<>queued.fingerprint)
     ORDER BY queued.created_at,queued.id LIMIT 200);
   SELECT queued.* INTO item FROM pipeline_control.restaurant_review_items queued JOIN public.restaurants candidate ON candidate.id=queued.restaurant_id
     JOIN pipeline_control.restaurant_review_runs r ON r.id=queued.run_id
     WHERE queued.state='queued' AND candidate.status='pending' AND candidate.updated_by_admin_id IS NULL AND candidate.created_by IS NULL
       AND r.policy_version=policy.version AND pipeline_control.restaurant_review_fingerprint(to_jsonb(candidate))=queued.fingerprint
     ORDER BY queued.created_at,queued.id LIMIT 1 FOR UPDATE OF queued,candidate SKIP LOCKED;
   IF NOT FOUND THEN RETURN NULL; END IF;
   SELECT * INTO restaurant FROM public.restaurants WHERE id=item.restaurant_id;
   UPDATE pipeline_control.restaurant_review_items SET state='running',worker_token=token,lease_until=now()+interval '60 minutes',
     input_sha256=encode(sha256(convert_to((to_jsonb(restaurant)-ARRAY['search_count','weekly_search_count','review_count','updated_at'])::text,'UTF8')),'hex')
     WHERE id=item.id RETURNING * INTO item;
   RETURN jsonb_build_object('id',item.id,'restaurant',to_jsonb(restaurant),'decisionContext',jsonb_build_object('inputSha256',item.input_sha256));
 END IF;
 SELECT * INTO item FROM pipeline_control.restaurant_review_items WHERE id=item_id FOR UPDATE;
 IF NOT FOUND OR item.worker_token IS DISTINCT FROM token THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_LEASE_INVALID'; END IF;
 IF item.state IN ('applied','succeeded','failed','cancelled') THEN RETURN jsonb_build_object('state',item.state); END IF;
 IF item.state<>'running' OR item.lease_until<now() THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_LEASE_INVALID'; END IF;
 IF (SELECT r.policy_version FROM pipeline_control.restaurant_review_runs r WHERE r.id=item.run_id)<>policy.version THEN
   UPDATE pipeline_control.restaurant_review_items SET state='cancelled',reason='policy_changed',finished_at=now() WHERE id=item.id;
   RETURN jsonb_build_object('state','cancelled');
 END IF;
 IF action='fail' THEN
   IF coalesce(result->>'code','') NOT IN ('source_unavailable','evaluation_failed','evaluation_incomplete','worker_timeout','result_invalid',
     'gemini_configuration_invalid','gemini_result_uncertain','gemini_decision_invalid','gemini_decision_incomplete') THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_RESULT_INVALID'; END IF;
   UPDATE pipeline_control.restaurant_review_items SET state='failed',reason=result->>'code',finished_at=now() WHERE id=item.id;
   RETURN jsonb_build_object('state','failed');
 END IF;
 IF action<>'complete' OR jsonb_typeof(result) IS DISTINCT FROM 'object' OR octet_length(result::text)>131072
   OR EXISTS(SELECT 1 FROM jsonb_object_keys(result) k WHERE NOT k=ANY(fields)) THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_RESULT_INVALID'; END IF;
 recommendation:=result->'gemini_decision';
 IF NOT pipeline_control.restaurant_review_gemini_valid(recommendation,item.input_sha256) THEN
   UPDATE pipeline_control.restaurant_review_items SET state='failed',reason='gemini_decision_invalid',finished_at=now() WHERE id=item.id;
   RETURN jsonb_build_object('state','failed');
 END IF;
 LOCK TABLE public.restaurants IN SHARE ROW EXCLUSIVE MODE;
 SELECT * INTO restaurant FROM public.restaurants WHERE id=item.restaurant_id FOR UPDATE;
 IF NOT FOUND OR pipeline_control.restaurant_review_fingerprint(to_jsonb(restaurant))<>item.fingerprint
   OR restaurant.updated_by_admin_id IS NOT NULL OR restaurant.created_by IS NOT NULL OR restaurant.status<>'pending' THEN
   UPDATE pipeline_control.restaurant_review_items SET state='cancelled',reason='source_changed',finished_at=now(),
     gemini_decision=recommendation||jsonb_build_object('outcome','blocked','decidedAt',now()) WHERE id=item.id;
   RETURN jsonb_build_object('state','cancelled');
 END IF;
 IF jsonb_typeof(result->'evaluation_results') IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_RESULT_INVALID'; END IF;
 restaurant:=jsonb_populate_record(restaurant,result-'gemini_decision');
 -- Preserve the domain evaluation and its actual basis; only the separate
 -- judgment ledger is restricted to structured codes and hashes.
 classification:=pipeline_control.restaurant_review_decision(to_jsonb(restaurant));
 final_decision:=split_part(classification,':',1);final_reason:=split_part(classification,':',2);
 IF final_decision='protected' THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_PROTECTED'; END IF;
 IF recommendation->>'recommendation'='hold' THEN final_decision:='hold';final_reason:='gemini_hold';
 ELSIF recommendation->>'recommendation'='recheck' AND final_decision<>'hold' THEN final_decision:='recheck';final_reason:='gemini_recheck_required';
 END IF;
 SELECT greatest(0,policy.daily_limit-count(*)) INTO remaining FROM pipeline_control.restaurant_review_items WHERE decision='approve' AND state='applied'
   AND finished_at>=date_trunc('day',now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul';
 IF final_decision='approve' AND remaining=0 THEN final_reason:='daily_limit';outcome:='deferred';
 ELSE outcome:=final_decision; END IF;
 IF final_decision='approve' AND remaining>0 THEN
   restaurant.status:='approved';restaurant.approved_name:=coalesce(nullif(btrim(restaurant.approved_name),''),nullif(btrim(restaurant.naver_name),''),nullif(btrim(restaurant.google_name),''),restaurant.origin_name);
   restaurant.updated_by_admin_id:=policy.operator_id;final_reason:='gemini_approved';
 ELSIF final_decision='hold' THEN restaurant.status:='hold'; END IF;
 UPDATE public.restaurants SET evaluation_results=restaurant.evaluation_results,geocoding_success=restaurant.geocoding_success,
   geocoding_false_stage=restaurant.geocoding_false_stage,lat=restaurant.lat,lng=restaurant.lng,road_address=restaurant.road_address,
   jibun_address=restaurant.jibun_address,english_address=restaurant.english_address,address_elements=restaurant.address_elements,
   naver_name=restaurant.naver_name,google_name=restaurant.google_name,categories=restaurant.categories,status=restaurant.status,
   approved_name=restaurant.approved_name,updated_by_admin_id=restaurant.updated_by_admin_id,updated_at=now() WHERE id=item.restaurant_id RETURNING * INTO restaurant;
 IF NOT EXISTS(SELECT 1 FROM public.restaurants WHERE id=item.restaurant_id AND status=restaurant.status AND evaluation_results=restaurant.evaluation_results)
   THEN RAISE EXCEPTION 'REVIEW_AUTOMATION_READBACK_FAILED'; END IF;
 UPDATE pipeline_control.restaurant_review_items SET state=CASE WHEN outcome IN ('approve','hold') THEN 'applied' ELSE 'succeeded' END,
   decision=final_decision,reason=final_reason,finished_at=now(),applied_fingerprint=pipeline_control.restaurant_review_fingerprint(to_jsonb(restaurant)),
   gemini_decision=recommendation||jsonb_build_object('outcome',outcome,'decidedAt',now()) WHERE id=item.id RETURNING * INTO item;
 UPDATE pipeline_control.restaurant_review_runs SET approved=approved+CASE WHEN outcome='approve' THEN 1 ELSE 0 END,
   held=held+CASE WHEN outcome='hold' THEN 1 ELSE 0 END WHERE id=item.run_id;
 RETURN jsonb_build_object('state',item.state,'reason',item.reason,'geminiDecision',item.gemini_decision);
END; $$;
ALTER FUNCTION public.restaurant_review_automation_worker(text,uuid,uuid,jsonb) SET lock_timeout='2s';

CREATE OR REPLACE FUNCTION public.restaurant_review_automation_status()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
SELECT jsonb_build_object('policy',(SELECT to_jsonb(policy)-'operator_id' FROM pipeline_control.restaurant_review_policy policy WHERE singleton),
 'runs',coalesce((SELECT jsonb_agg(to_jsonb(run) ORDER BY run.started_at DESC) FROM (SELECT * FROM pipeline_control.restaurant_review_runs ORDER BY started_at DESC LIMIT 10) run),'[]'::jsonb),
 'items',coalesce((SELECT jsonb_agg((to_jsonb(item)-ARRAY['worker_token','fingerprint','applied_fingerprint','input_sha256','gemini_decision'])||jsonb_build_object('geminiDecision',item.gemini_decision) ORDER BY item.created_at DESC) FROM
   (SELECT item.*,left(coalesce(restaurant.approved_name,restaurant.origin_name,restaurant.naver_name,'삭제된 항목'),160) AS restaurant_name
     FROM pipeline_control.restaurant_review_items item LEFT JOIN public.restaurants restaurant ON restaurant.id=item.restaurant_id ORDER BY item.created_at DESC,item.id DESC LIMIT 20) item),'[]'::jsonb),
 'queue',jsonb_build_object('queued',(SELECT count(*) FROM pipeline_control.restaurant_review_items WHERE state='queued'),'running',(SELECT count(*) FROM pipeline_control.restaurant_review_items WHERE state='running'),'failed',(SELECT count(*) FROM pipeline_control.restaurant_review_items WHERE state='failed')),
 'policyEvents',coalesce((SELECT jsonb_agg(jsonb_build_object('id',event.id,'version',event.version,'action',event.action,'created_at',event.created_at)) FROM (SELECT * FROM pipeline_control.restaurant_review_policy_events ORDER BY created_at DESC LIMIT 10) event),'[]'::jsonb),
 'judgmentEngine',jsonb_build_object('provider','gemini','model','gemini-3.8-flash','promptVersion','restaurant-review-v1','requiredForApproval',true,'maxCallsPerClaim',1));
$$;
COMMIT;
