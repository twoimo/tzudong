-- PREPARED ONLY; root reviews and executes via psql -X -v ON_ERROR_STOP=1.
-- Owned runtime: tzudong-record-runtime-v3-20261009, network none, ports 0.
-- Exact database admission below. No external/provider/Storage calls.
-- Synthetic seed DML uses the existing bootstrap login supabase_admin; actions use
-- service_role and normal PostgREST JSON claims, not owner/superuser execution.
-- Original functions, assertions, ACL, RLS and triggers are never changed.
-- Errors are real prerequisite/behavior failures. Do not disable protections to pass.
-- Every change is transaction-local. Close the connection on ON_ERROR_STOP failure
-- to roll back an aborted transaction. The final ROLLBACK is mandatory on success.
-- This single-session CAS test is not a two-connection race test, Auth onboarding,
-- real service user flow, Storage physical deletion or hosted application proof.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='2s';
SET LOCAL row_security=on;
SET LOCAL search_path=pg_catalog,public,extensions;
DO $fixture$
BEGIN
 IF current_database()<>'tzudong_fresh_pg17_61d148a598b0' OR session_user<>'supabase_admin'
    OR current_setting('server_version_num')::integer/10000<>17 THEN
  RAISE EXCEPTION 'FIXTURE_OWNED_RUNTIME_ADMISSION_FAILED';
 END IF;
 IF (SELECT rolsuper FROM pg_roles WHERE rolname='postgres') THEN RAISE EXCEPTION 'FIXTURE_POSTGRES_ROLE_DRIFT'; END IF;
 IF to_regprocedure('public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)') IS NULL
    OR to_regprocedure('public.approve_submission_item(uuid,uuid,jsonb)') IS NULL
    OR to_regprocedure('public.approve_edit_submission_item(uuid,uuid,jsonb)') IS NULL THEN
  RAISE EXCEPTION 'FIXTURE_GUARDED_RPC_PREREQUISITE_MISSING';
 END IF;
 IF EXISTS(SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgenabled NOT IN ('O','A')
    AND tgrelid=ANY(ARRAY['public.restaurants'::regclass,'public.reviews'::regclass,
      'public.restaurant_submissions'::regclass,'public.restaurant_submission_items'::regclass,
      'privacy_retention.g014_catalog_contract_manifest'::regclass])) THEN
  RAISE EXCEPTION 'FIXTURE_SOURCE_TRIGGER_DISABLED';
 END IF;
END $fixture$;
SELECT privacy_retention.assert_g014_workflow_owner_contract();
SELECT privacy_retention.assert_g014_public_rpc_allowlist();
SELECT privacy_retention.assert_g014_definer_contract();
SELECT privacy_retention.assert_g014_catalog_contract();

CREATE TEMP TABLE fixture_source_before AS
SELECT p.oid,p.prosrc,p.proowner,p.proacl,p.proconfig,p.prosecdef
FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','privacy_retention','pipeline_control');
CREATE TEMP TABLE fixture_triggers_before AS
SELECT oid,tgrelid,tgname,tgenabled,tgfoid,pg_get_triggerdef(oid) AS definition
FROM pg_trigger WHERE NOT tgisinternal;
CREATE TEMP TABLE fixture_ids AS
SELECT gen_random_uuid() AS actor,gen_random_uuid() AS author,
 gen_random_uuid() AS restaurant,gen_random_uuid() AS stale_restaurant,
 gen_random_uuid() AS submission,gen_random_uuid() AS item,
 gen_random_uuid() AS review,gen_random_uuid() AS approval_op,
 gen_random_uuid() AS edit_op,gen_random_uuid() AS stale_op,
 gen_random_uuid() AS submission_op,gen_random_uuid() AS review_op,
 gen_random_uuid() AS run_id;
CREATE TEMP TABLE fixture_results(case_name text PRIMARY KEY);
GRANT SELECT ON fixture_ids TO service_role;
GRANT SELECT,INSERT ON fixture_results TO service_role;

-- FK-valid Auth rows. Existing Auth triggers remain active; their actual generated
-- profiles/stats are required below, rather than replaced with fixture stubs.
INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT actor,'authenticated','authenticated',actor::text||'@example.invalid',
 '{"provider":"email","providers":["email"]}'::jsonb,
 jsonb_build_object('nickname','fixture_admin_'||left(actor::text,6)),now(),now() FROM fixture_ids
UNION ALL
SELECT author,'authenticated','authenticated',author::text||'@example.invalid',
 '{"provider":"email","providers":["email"]}'::jsonb,
 jsonb_build_object('nickname','fixture_user_'||left(author::text,6)),now(),now() FROM fixture_ids;
DO $fixture$
BEGIN
 IF (SELECT count(*) FROM public.profiles p,fixture_ids f WHERE p.user_id IN(f.actor,f.author))<>2
    OR (SELECT count(*) FROM public.user_stats p,fixture_ids f WHERE p.user_id IN(f.actor,f.author))<>2 THEN
  RAISE EXCEPTION 'FIXTURE_AUTH_PROFILE_STATS_PREREQUISITE_MISSING';
 END IF;
END $fixture$;
-- Explicit synthetic admin/account fixtures are not a claim about Auth role granting.
INSERT INTO public.user_roles(user_id,role) SELECT actor,'admin'::public.app_role FROM fixture_ids;
INSERT INTO public.user_account_status(user_id,account_status)
SELECT actor,'active' FROM fixture_ids UNION ALL SELECT author,'active' FROM fixture_ids
ON CONFLICT(user_id) DO NOTHING;

INSERT INTO public.restaurants(id,status,source_type,origin_name,naver_name,approved_name,
 lat,lng,geocoding_success,jibun_address,categories,tzuyang_review,trace_id,youtube_link,
 youtube_meta,evaluation_results)
SELECT r.id,'pending','crawler',r.name,r.name,r.name,37.5,127,true,r.address,ARRAY['한식'],
 'synthetic public review [ts:00:12]',r.id::text,
 'https://www.youtube.com/watch?v='||left(replace(r.id::text,'-',''),11),
 '{"title":"synthetic fixture video","operator_marker":"preserve","duration":42}'::jsonb,
 jsonb_build_object(
 'visit_authenticity',jsonb_build_object('eval_value',1,'eval_basis','fixture evidence'),
 'rb_inference_score',jsonb_build_object('eval_value',1,'eval_basis','fixture evidence'),
 'review_faithfulness_score',jsonb_build_object('eval_value',1,'eval_basis','fixture evidence'),
 'rb_grounding_TF',jsonb_build_object('eval_value',true,'eval_basis','fixture evidence'),
 'category_validity_TF',jsonb_build_object('eval_value',true,'eval_basis','fixture evidence'),
 'category_TF',jsonb_build_object('eval_value',true,'eval_basis','fixture evidence'),
 'location_match_TF',jsonb_build_object('origin_name',r.name,'eval_value',true,'match_status','matched',
 'evidence_families',jsonb_build_array('source_geo','provider_candidate')))
FROM fixture_ids f CROSS JOIN LATERAL (VALUES
 (f.restaurant,'Fixture Alpha '||left(f.run_id::text,8),'synthetic alpha avenue '||f.restaurant::text),
 (f.stale_restaurant,'Fixture Beta '||left(f.run_id::text,8),'synthetic beta plaza '||f.stale_restaurant::text)) r(id,name,address);
CREATE TEMP TABLE fixture_evaluation_before AS
SELECT id,evaluation_results,youtube_meta,tzuyang_review FROM public.restaurants
WHERE id IN(SELECT restaurant FROM fixture_ids UNION ALL SELECT stale_restaurant FROM fixture_ids);
GRANT SELECT ON fixture_evaluation_before TO service_role;

INSERT INTO public.restaurant_submissions(id,user_id,submission_type,restaurant_name,restaurant_address,restaurant_categories)
SELECT submission,author,'edit'::public.submission_type,r.approved_name,r.jibun_address,ARRAY['한식']
FROM fixture_ids f JOIN public.restaurants r ON r.id=f.restaurant;
INSERT INTO public.restaurant_submission_items(id,submission_id,youtube_link,tzuyang_review,target_restaurant_id)
SELECT item,submission,r.youtube_link,r.tzuyang_review,r.id FROM fixture_ids f JOIN public.restaurants r ON r.id=f.restaurant;
-- Path is synthetic and actor-bound, but no Storage object or physical deletion is used.
INSERT INTO public.reviews(id,user_id,restaurant_id,title,content,visited_at,verification_photo)
SELECT review,author,restaurant,'synthetic review','synthetic fixture review content',now()-interval '1 day',
 author::text||'/fixture-'||review::text||'.jpg' FROM fixture_ids;

DO $fixture$
BEGIN
 IF EXISTS(SELECT 1 FROM fixture_ids f JOIN public.restaurants r ON r.id=f.restaurant WHERE r.review_count<>1) THEN
  RAISE EXCEPTION 'FIXTURE_REVIEW_INSERT_COUNTER_MISMATCH';
 END IF;
END $fixture$;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
DO $fixture$
DECLARE f record; p jsonb; applied jsonb; repeated jsonb; readback jsonb; patch jsonb; snapshot jsonb; caught boolean;
BEGIN
 SELECT * INTO STRICT f FROM pg_temp.fixture_ids;
 -- Restaurant approval, exact repeated Preview/Apply, Readback and one minimized Audit.
 p:=public.admin_record_action(f.actor,'preview',f.approval_op,'restaurant.approve',ARRAY[f.restaurant],'{}',NULL);
 IF p->>'state'<>'preview' OR p->>'previewHash' IS NULL THEN RAISE EXCEPTION 'FIXTURE_APPROVAL_PREVIEW'; END IF;
 IF public.admin_record_action(f.actor,'preview',f.approval_op,'restaurant.approve',ARRAY[f.restaurant],'{}',NULL) IS DISTINCT FROM p THEN RAISE EXCEPTION 'FIXTURE_PREVIEW_IDEMPOTENCY'; END IF;
 applied:=public.admin_record_action(f.actor,'apply',f.approval_op,'restaurant.approve',ARRAY[f.restaurant],'{}',p->>'previewHash');
 repeated:=public.admin_record_action(f.actor,'apply',f.approval_op,'restaurant.approve',ARRAY[f.restaurant],'{}',p->>'previewHash');
 readback:=public.admin_record_action(f.actor,'readback',f.approval_op);
 IF applied->>'state'<>'applied' OR repeated IS DISTINCT FROM applied
    OR readback IS DISTINCT FROM applied
    OR (SELECT count(*) FROM pipeline_control.admin_record_audit WHERE operation_id=f.approval_op)<>1
    OR NOT EXISTS(SELECT 1 FROM pipeline_control.admin_record_audit WHERE operation_id=f.approval_op AND id=(applied->>'auditId')::uuid AND actor=f.actor AND action='restaurant.approve') THEN
  RAISE EXCEPTION 'FIXTURE_APPROVAL_RECEIPT_AUDIT_IDEMPOTENCY';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.restaurants r JOIN fixture_evaluation_before b USING(id)
    WHERE r.id=f.restaurant AND r.status='approved' AND r.updated_by_admin_id=f.actor
      AND r.evaluation_results=b.evaluation_results AND r.youtube_meta=b.youtube_meta AND r.tzuyang_review=b.tzuyang_review) THEN
  RAISE EXCEPTION 'FIXTURE_APPROVAL_EVIDENCE_PRESERVATION';
 END IF;
 INSERT INTO fixture_results VALUES('restaurant.approve_preview_apply_readback_audit_idempotency');
 -- Invalid changed payload for same operation must not mutate/audit again.
 caught:=false;
 BEGIN
  PERFORM public.admin_record_action(f.actor,'apply',f.approval_op,'restaurant.approve',ARRAY[f.restaurant],'{"changes":{"phone":"fixture-new"}}',p->>'previewHash');
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'RECORD_ACTION_IDEMPOTENCY_CONFLICT' THEN RAISE; END IF; caught:=true;
 END;
 IF NOT caught OR (SELECT count(*) FROM pipeline_control.admin_record_audit WHERE operation_id=f.approval_op)<>1 THEN RAISE EXCEPTION 'FIXTURE_IDEMPOTENCY_CONFLICT_NOT_REJECTED'; END IF;
 INSERT INTO fixture_results VALUES('changed_payload_same_uuid_rejected');
 -- Actual guarded partial edit retains raw [ts] source and all evaluation JSON.
 patch:='{"changes":{"phone":"02-1234-5678"}}';
 p:=public.admin_record_action(f.actor,'preview',f.edit_op,'restaurant.edit',ARRAY[f.restaurant],patch,NULL);
 applied:=public.admin_record_action(f.actor,'apply',f.edit_op,'restaurant.edit',ARRAY[f.restaurant],patch,p->>'previewHash');
 readback:=public.admin_record_action(f.actor,'readback',f.edit_op);
 IF applied->>'state'<>'applied' OR readback IS DISTINCT FROM applied
    OR (SELECT count(*) FROM pipeline_control.admin_record_audit WHERE operation_id=f.edit_op)<>1
    OR NOT EXISTS(SELECT 1 FROM public.restaurants r JOIN fixture_evaluation_before b USING(id) WHERE r.id=f.restaurant AND r.phone='02-1234-5678' AND r.evaluation_results=b.evaluation_results AND r.tzuyang_review=b.tzuyang_review) THEN
  RAISE EXCEPTION 'FIXTURE_PARTIAL_EDIT_PRESERVATION';
 END IF;
 INSERT INTO fixture_results VALUES('restaurant.edit_partial_readback_audit');
 -- Submission edit approval uses the current-schema atomic invoker path.
 patch:=jsonb_build_object('items',jsonb_build_array(jsonb_build_object('id',f.item,'decision','approve','changes',jsonb_build_object('phone','02-1234-9999'))));
 p:=public.admin_record_action(f.actor,'preview',f.submission_op,'submission.approve',ARRAY[f.submission],patch,NULL);
 applied:=public.admin_record_action(f.actor,'apply',f.submission_op,'submission.approve',ARRAY[f.submission],patch,p->>'previewHash');
 readback:=public.admin_record_action(f.actor,'readback',f.submission_op);
 IF applied->>'state'<>'applied' OR readback IS DISTINCT FROM applied
    OR current_setting('request.jwt.claim.role',true)<>''
    OR (SELECT count(*) FROM pipeline_control.admin_record_audit WHERE operation_id=f.submission_op)<>1
    OR NOT EXISTS(SELECT 1 FROM public.restaurant_submission_items WHERE id=f.item AND item_status='approved' AND target_restaurant_id=f.restaurant)
    OR NOT EXISTS(SELECT 1 FROM public.restaurant_submissions WHERE id=f.submission AND status='approved')
    OR NOT EXISTS(SELECT 1 FROM public.restaurants r JOIN fixture_evaluation_before b USING(id) WHERE r.id=f.restaurant AND r.phone='02-1234-9999' AND r.evaluation_results=b.evaluation_results AND r.youtube_meta->>'operator_marker'='preserve') THEN
  RAISE EXCEPTION 'FIXTURE_SUBMISSION_APPROVE_BRIDGE_PRESERVATION';
 END IF;
 INSERT INTO fixture_results VALUES('submission.approve_current_schema_readback_audit');
 -- Review verification uses the original source counters and statistics triggers.
 p:=public.admin_record_action(f.actor,'preview',f.review_op,'review.approve',ARRAY[f.review],'{}',NULL);
 applied:=public.admin_record_action(f.actor,'apply',f.review_op,'review.approve',ARRAY[f.review],'{}',p->>'previewHash');
 readback:=public.admin_record_action(f.actor,'readback',f.review_op);
 IF applied->>'state'<>'applied' OR readback IS DISTINCT FROM applied
    OR (SELECT count(*) FROM pipeline_control.admin_record_audit WHERE operation_id=f.review_op)<>1
    OR NOT EXISTS(SELECT 1 FROM public.reviews WHERE id=f.review AND is_verified)
    OR NOT EXISTS(SELECT 1 FROM public.restaurants WHERE id=f.restaurant AND review_count=1)
    OR NOT EXISTS(SELECT 1 FROM public.user_stats WHERE user_id=f.author AND review_count=1 AND verified_review_count=1) THEN
  RAISE EXCEPTION 'FIXTURE_REVIEW_APPROVE_COUNTER_PARITY';
 END IF;
 INSERT INTO fixture_results VALUES('review.approve_original_triggers_readback_audit');
 -- Preview a second row; next block seeds a real later administrator update.
 patch:='{"changes":{"phone":"02-3333-4444"}}';
 p:=public.admin_record_action(f.actor,'preview',f.stale_op,'restaurant.edit',ARRAY[f.stale_restaurant],patch,NULL);
 IF p->>'state'<>'preview' THEN RAISE EXCEPTION 'FIXTURE_STALE_PREVIEW'; END IF;
END $fixture$;
RESET ROLE;
-- Synthetic later admin DML deliberately changes the fingerprint. This is one-session
-- optimistic-conflict verification; it does not simulate independent committed writers.
UPDATE public.restaurants SET phone='02-9999-8888',updated_by_admin_id=f.actor,updated_at=clock_timestamp()
FROM fixture_ids f WHERE id=f.stale_restaurant;
SET LOCAL ROLE service_role;
DO $fixture$
DECLARE f record; p jsonb; caught boolean:=false; a jsonb;
BEGIN
 SELECT * INTO STRICT f FROM fixture_ids;
 p:=public.admin_record_action(f.actor,'readback',f.stale_op);
 BEGIN
  PERFORM public.admin_record_action(f.actor,'apply',f.stale_op,'restaurant.edit',ARRAY[f.stale_restaurant],'{"changes":{"phone":"02-3333-4444"}}',p->>'previewHash');
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'RECORD_ACTION_STALE' THEN RAISE; END IF; caught:=true;
 END;
 IF NOT caught OR EXISTS(SELECT 1 FROM pipeline_control.admin_record_audit WHERE operation_id=f.stale_op)
    OR NOT EXISTS(SELECT 1 FROM public.restaurants WHERE id=f.stale_restaurant AND phone='02-9999-8888' AND updated_by_admin_id=f.actor)
    OR (public.admin_record_action(f.actor,'readback',f.stale_op)->>'state')<>'preview' THEN
  RAISE EXCEPTION 'FIXTURE_STALE_ADMIN_UPDATE_NOT_PROTECTED';
 END IF;
 INSERT INTO fixture_results VALUES('stale_preview_preserves_later_admin_change_without_audit');
 -- Only operation-scoped audits; no raw source evidence or address copied into audit.
 FOR a IN SELECT to_jsonb(x) FROM pipeline_control.admin_record_audit x
   WHERE operation_id=ANY(ARRAY[f.approval_op,f.edit_op,f.submission_op,f.review_op]) LOOP
  IF a::text LIKE '%fixture evidence%' OR a::text LIKE '%synthetic public review%'
     OR a::text LIKE '%synthetic alpha avenue%' OR a::text LIKE '%evaluation_results%' THEN
   RAISE EXCEPTION 'FIXTURE_AUDIT_RAW_DATA_EXPOSURE';
  END IF;
 END LOOP;
END $fixture$;
RESET ROLE;
SELECT privacy_retention.assert_g014_workflow_owner_contract();
SELECT privacy_retention.assert_g014_public_rpc_allowlist();
SELECT privacy_retention.assert_g014_definer_contract();
SELECT privacy_retention.assert_g014_catalog_contract();
DO $fixture$
BEGIN
 IF EXISTS((SELECT p.oid,p.prosrc,p.proowner,p.proacl,p.proconfig,p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','privacy_retention','pipeline_control') EXCEPT SELECT * FROM fixture_source_before)
 UNION ALL (SELECT * FROM fixture_source_before EXCEPT SELECT p.oid,p.prosrc,p.proowner,p.proacl,p.proconfig,p.prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN('public','privacy_retention','pipeline_control'))) THEN RAISE EXCEPTION 'FIXTURE_SOURCE_FUNCTION_DRIFT'; END IF;
 IF EXISTS((SELECT oid,tgrelid,tgname,tgenabled,tgfoid,pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal EXCEPT SELECT * FROM fixture_triggers_before)
 UNION ALL (SELECT * FROM fixture_triggers_before EXCEPT SELECT oid,tgrelid,tgname,tgenabled,tgfoid,pg_get_triggerdef(oid) FROM pg_trigger WHERE NOT tgisinternal)) THEN RAISE EXCEPTION 'FIXTURE_SOURCE_TRIGGER_DRIFT'; END IF;
 IF (SELECT count(*) FROM fixture_results)<>6 THEN RAISE EXCEPTION 'FIXTURE_CASE_SET_INCOMPLETE'; END IF;
END $fixture$;
-- This is a pre-rollback observation, not proof of persisted rows or successful cleanup.
SELECT jsonb_build_object('kind','fresh-full-source-synthetic-record-fixture','status','checks_passed_in_transaction',
 'caseCount',(SELECT count(*) FROM fixture_results),'cases',(SELECT jsonb_agg(case_name ORDER BY case_name) FROM fixture_results),
 'sourceFunctionsUnchanged',true,'sourceTriggersUnchanged',true,'assertionsPassed',4,
 'syntheticOnly',true,'externalCalls',0,'operatingWrites',false,'rollbackStillRequired',true,
 'limitations',jsonb_build_array('SQL synthetic fixture only; not UI/Auth onboarding/provider/Storage physical deletion.','Submission edit approval only; new-submission creation is not exercised.','Single-session optimistic conflict; concurrent commit races remain untested.'));
ROLLBACK;
