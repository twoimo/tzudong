-- Local synthetic behavior proof only. No provider or Storage API call occurs.
-- The caller binds __DATABASE__ to its owned clone before execution.
BEGIN;
SET LOCAL statement_timeout='30s';
SET LOCAL lock_timeout='2s';
SET LOCAL row_security=on;
SET LOCAL search_path=pg_catalog,public,extensions;

DO $fixture$
BEGIN
 IF current_database()<>'__DATABASE__' OR session_user<>'supabase_admin'
    OR current_setting('server_version_num')::integer<>170006 THEN
  RAISE EXCEPTION 'FIXTURE_OWNED_RUNTIME_ADMISSION_FAILED';
 END IF;
 IF to_regprocedure('pipeline_control.admin_record_storage_snapshot(text,text)') IS NULL
    OR to_regprocedure('pipeline_control.admin_record_review_media(jsonb)') IS NULL
    OR NOT has_function_privilege('service_role','pipeline_control.admin_record_storage_snapshot(text,text)','EXECUTE')
    OR has_function_privilege('anon','pipeline_control.admin_record_storage_snapshot(text,text)','EXECUTE')
    OR has_function_privilege('authenticated','pipeline_control.admin_record_storage_snapshot(text,text)','EXECUTE') THEN
  RAISE EXCEPTION 'FIXTURE_PRIVATE_HELPER_ACL_PREREQUISITE_FAILED';
 END IF;
END $fixture$;

CREATE TEMP TABLE fixture_ids AS
SELECT gen_random_uuid() actor, gen_random_uuid() author, gen_random_uuid() restaurant,
 gen_random_uuid() review, gen_random_uuid() stale_op, gen_random_uuid() apply_op;
CREATE TEMP TABLE fixture_results(case_name text PRIMARY KEY);
GRANT SELECT ON fixture_ids TO service_role;
GRANT SELECT,INSERT ON fixture_results TO service_role;

INSERT INTO auth.users(id,aud,role,email,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
SELECT actor,'authenticated','authenticated',actor::text||'@example.invalid',
 '{"provider":"email","providers":["email"]}'::jsonb,
 jsonb_build_object('nickname','fixture_admin_'||left(actor::text,6)),now(),now() FROM fixture_ids
UNION ALL
SELECT author,'authenticated','authenticated',author::text||'@example.invalid',
 '{"provider":"email","providers":["email"]}'::jsonb,
 jsonb_build_object('nickname','fixture_user_'||left(author::text,6)),now(),now() FROM fixture_ids;
INSERT INTO public.user_roles(user_id,role) SELECT actor,'admin'::public.app_role FROM fixture_ids;
INSERT INTO public.user_account_status(user_id,account_status)
SELECT actor,'active' FROM fixture_ids UNION ALL SELECT author,'active' FROM fixture_ids
ON CONFLICT(user_id) DO NOTHING;

INSERT INTO public.restaurants(id,status,source_type,origin_name,naver_name,approved_name,
 lat,lng,geocoding_success,jibun_address,categories,tzuyang_review,trace_id,youtube_link,
 youtube_meta,evaluation_results)
SELECT restaurant,'pending','crawler','Private Fixture','Private Fixture','Private Fixture',
 37.5,127,true,'synthetic private fixture avenue',ARRAY['한식'],
 'synthetic fixture review',restaurant::text,'https://www.youtube.com/watch?v=ABCDEFGHIJK',
 '{"title":"synthetic fixture video"}'::jsonb,
 jsonb_build_object(
  'visit_authenticity',jsonb_build_object('eval_value',1,'eval_basis','fixture evidence'),
  'rb_inference_score',jsonb_build_object('eval_value',1,'eval_basis','fixture evidence'),
  'review_faithfulness_score',jsonb_build_object('eval_value',1,'eval_basis','fixture evidence'),
  'rb_grounding_TF',jsonb_build_object('eval_value',true,'eval_basis','fixture evidence'),
  'category_validity_TF',jsonb_build_object('eval_value',true,'eval_basis','fixture evidence'),
  'category_TF',jsonb_build_object('eval_value',true,'eval_basis','fixture evidence'),
  'location_match_TF',jsonb_build_object('origin_name','Private Fixture','eval_value',true,
    'match_status','matched','evidence_families',jsonb_build_array('source_geo','provider_candidate')))
FROM fixture_ids;

INSERT INTO public.reviews(id,user_id,restaurant_id,title,content,visited_at,verification_photo,food_photos)
SELECT review,author,restaurant,'synthetic private review','synthetic private review content',now()-interval '1 day',
 author::text||'/reviews/'||review::text||'/verification/fixture.jpg','{}'::text[] FROM fixture_ids;
INSERT INTO storage.buckets(id,name,public)
VALUES('review-verifications','review-verifications',false),('review-photos','review-photos',true);
INSERT INTO storage.objects(bucket_id,name,metadata)
SELECT 'review-verifications',author::text||'/reviews/'||review::text||'/verification/fixture.jpg',
 '{"etag":"private-v1"}'::jsonb FROM fixture_ids;

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role','',true);
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);

DO $fixture$
DECLARE
 f record; stale jsonb; preview jsonb; applied jsonb; repeated jsonb; jobs jsonb; readback jsonb;
 private_job uuid; public_job uuid; path text; caught boolean;
BEGIN
 SELECT * INTO STRICT f FROM fixture_ids;
 path:=f.author::text||'/reviews/'||f.review::text||'/verification/fixture.jpg';

 stale:=public.admin_record_action(f.actor,'preview',f.stale_op,'review.delete',ARRAY[f.review],'{"reason":"privacy cleanup"}',NULL);
 UPDATE storage.objects SET metadata='{"etag":"private-v2"}'::jsonb
 WHERE bucket_id='review-verifications' AND name=path;
 caught:=false;
 BEGIN
  PERFORM public.admin_record_action(f.actor,'apply',f.stale_op,'review.delete',ARRAY[f.review],'{"reason":"privacy cleanup"}',stale->>'previewHash');
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'RECORD_ACTION_STALE' THEN RAISE; END IF;
  caught:=true;
 END;
 IF NOT caught OR NOT EXISTS(SELECT 1 FROM public.reviews WHERE id=f.review)
    OR EXISTS(SELECT 1 FROM pipeline_control.admin_record_media_cleanup WHERE operation_id=f.stale_op)
    OR EXISTS(SELECT 1 FROM pipeline_control.admin_record_audit WHERE operation_id=f.stale_op) THEN
  RAISE EXCEPTION 'FIXTURE_PRIVATE_CAS_STALE_ROLLBACK_FAILED';
 END IF;
 INSERT INTO fixture_results VALUES('private_metadata_cas_stale_rejected_without_cleanup');

 preview:=public.admin_record_action(f.actor,'preview',f.apply_op,'review.delete',ARRAY[f.review],'{"reason":"privacy cleanup"}',NULL);
 applied:=public.admin_record_action(f.actor,'apply',f.apply_op,'review.delete',ARRAY[f.review],'{"reason":"privacy cleanup"}',preview->>'previewHash');
 repeated:=public.admin_record_action(f.actor,'apply',f.apply_op,'review.delete',ARRAY[f.review],'{"reason":"privacy cleanup"}',preview->>'previewHash');
 IF applied IS DISTINCT FROM repeated OR applied->>'state'<>'applied'
    OR coalesce((applied->>'mediaCleanupPending')::boolean,false) IS NOT TRUE
    OR EXISTS(SELECT 1 FROM public.reviews WHERE id=f.review) THEN
  RAISE EXCEPTION 'FIXTURE_PRIVATE_APPLY_IDEMPOTENCY_FAILED';
 END IF;
 jobs:=public.admin_record_action(f.actor,'cleanup_read',f.apply_op,NULL,'{}','{}',NULL);
 IF jsonb_array_length(jobs->'jobs')<>2
    OR (SELECT count(*) FROM pipeline_control.admin_record_media_cleanup WHERE operation_id=f.apply_op)<>2
    OR NOT EXISTS(SELECT 1 FROM pipeline_control.admin_record_media_cleanup WHERE operation_id=f.apply_op AND bucket='review-verifications' AND object_name=path)
    OR NOT EXISTS(SELECT 1 FROM pipeline_control.admin_record_media_cleanup WHERE operation_id=f.apply_op AND bucket='review-photos' AND object_name=path) THEN
  RAISE EXCEPTION 'FIXTURE_PRIVATE_EXACT_TWO_JOB_CONTRACT_FAILED';
 END IF;
 INSERT INTO fixture_results VALUES('verification_key_creates_exact_private_and_public_jobs');

 SELECT id INTO STRICT private_job FROM pipeline_control.admin_record_media_cleanup
 WHERE operation_id=f.apply_op AND bucket='review-verifications' AND object_name=path;
 IF coalesce((public.admin_record_action(f.actor,'cleanup_claim',f.apply_op,NULL,'{}',jsonb_build_object('jobId',private_job),NULL)->>'claimed')::boolean,false) IS NOT TRUE THEN
  RAISE EXCEPTION 'FIXTURE_PRIVATE_JOB_CLAIM_FAILED';
 END IF;
 caught:=false;
 BEGIN
  UPDATE storage.objects SET metadata='{"etag":"forbidden-replacement"}'::jsonb
  WHERE bucket_id='review-verifications' AND name=path;
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'RECORD_ACTION_MEDIA_RETIRED' THEN RAISE; END IF;
  caught:=true;
 END;
 IF NOT caught OR NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='review-verifications' AND name=path AND metadata->>'etag'='private-v2') THEN
  RAISE EXCEPTION 'FIXTURE_PRIVATE_OBJECT_LATE_WRITE_FENCE_FAILED';
 END IF;
 caught:=false;
 BEGIN
  INSERT INTO public.reviews(id,user_id,restaurant_id,title,content,visited_at,verification_photo,food_photos)
  VALUES(gen_random_uuid(),f.author,f.restaurant,'late synthetic review','late synthetic content',now(),path,'{}');
 EXCEPTION WHEN OTHERS THEN
  IF SQLERRM<>'RECORD_ACTION_MEDIA_RETIRED' THEN RAISE; END IF;
  caught:=true;
 END;
 IF NOT caught THEN RAISE EXCEPTION 'FIXTURE_PRIVATE_REFERENCE_LATE_WRITE_FENCE_FAILED'; END IF;
 PERFORM public.admin_record_action(f.actor,'cleanup_uncertain',f.apply_op,NULL,'{}',jsonb_build_object('jobId',private_job),NULL);
 INSERT INTO fixture_results VALUES('claimed_private_job_fences_object_and_reference_late_writes');

 SELECT id INTO STRICT public_job FROM pipeline_control.admin_record_media_cleanup
 WHERE operation_id=f.apply_op AND bucket='review-photos' AND object_name=path;
 IF pipeline_control.admin_record_storage_snapshot('review-photos',path) IS NOT NULL
    OR coalesce((public.admin_record_action(f.actor,'cleanup_claim',f.apply_op,NULL,'{}',jsonb_build_object('jobId',public_job),NULL)->>'claimed')::boolean,false) IS NOT TRUE THEN
  RAISE EXCEPTION 'FIXTURE_PUBLIC_ABSENT_JOB_CLAIM_FAILED';
 END IF;
 PERFORM public.admin_record_action(f.actor,'cleanup_absent',f.apply_op,NULL,'{}',jsonb_build_object('jobId',public_job),NULL);
 readback:=public.admin_record_action(f.actor,'readback',f.apply_op);
 IF coalesce((readback->>'mediaCleanupPending')::boolean,false) IS NOT TRUE
    OR (SELECT jsonb_object_agg(bucket||':'||object_name,state ORDER BY bucket||':'||object_name)
        FROM pipeline_control.admin_record_media_cleanup WHERE operation_id=f.apply_op)
       IS DISTINCT FROM jsonb_build_object('review-photos:'||path,'done','review-verifications:'||path,'uncertain')
    OR (SELECT count(*) FROM pipeline_control.admin_record_audit WHERE operation_id=f.apply_op)<>1
    OR EXISTS(SELECT 1 FROM pipeline_control.admin_record_audit WHERE operation_id=f.apply_op AND to_jsonb(admin_record_audit)::text LIKE '%'||path||'%') THEN
  RAISE EXCEPTION 'FIXTURE_PRIVATE_READBACK_OR_AUDIT_FAILED';
 END IF;
 INSERT INTO fixture_results VALUES('public_absent_done_private_uncertain_readback_pending');
END $fixture$;

RESET ROLE;
SELECT jsonb_build_object(
 'kind','local-synthetic-private-verification-fixture',
 'status','checks_passed_in_transaction',
 'caseCount',(SELECT count(*) FROM fixture_results),
 'cases',(SELECT jsonb_agg(case_name ORDER BY case_name) FROM fixture_results),
 'exactVerificationJobCount',2,
 'providerCalls',0,
 'storageApiCalls',0,
 'syntheticOnly',true,
 'rollbackStillRequired',true
);
ROLLBACK;
