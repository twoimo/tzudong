-- Synthetic claim IDs only. The entire probe is rolled back; no fixture review,
-- real user row, Storage object, credential or raw request is retained.
BEGIN;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.role = 'authenticated';
SET LOCAL request.jwt.claim.sub = '11111111-1111-4111-8111-111111111111';
SET LOCAL request.jwt.claims = '{"role":"authenticated","sub":"11111111-1111-4111-8111-111111111111"}';
DO $$
DECLARE owner_id uuid := '11111111-1111-4111-8111-111111111111';
  review_id uuid := '22222222-2222-4222-8222-222222222222';
  operation_id uuid := '33333333-3333-4333-8333-333333333333';
  key text := owner_id::text || '/reviews/' || review_id::text || '/food/probe.webp';
BEGIN
  IF public.read_review_media_commit(operation_id,review_id,'edit') <> 'REVIEW_NOT_CONFIRMED'
    OR public.mutate_review_with_media(operation_id,review_id,'edit',now(),
      'Synthetic fixture review content.',ARRAY['한식'],ARRAY[key]) <> 'REVIEW_NOT_FOUND'
    OR public.queue_review_upload_cleanup(review_id,ARRAY[key]) <> 'REVIEW_CLEANUP_QUEUED'
    OR (SELECT count(*) FROM public.pending_review_media_cleanup()) <> 1
    OR NOT public.review_media_delete_allowed(key)
    OR public.finish_review_media_cleanup() <> 0 THEN
    RAISE EXCEPTION 'READINESS_OWNER_RPC_FAILED';
  END IF;
END $$;
SELECT jsonb_build_object('ownerRPCsPassed',6,'privateSchemaDenied',NOT has_schema_privilege(current_user,'review_media_private','USAGE'));
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM public.read_review_media_commit('33333333-3333-4333-8333-333333333333',
      '22222222-2222-4222-8222-222222222222','edit');
    RAISE EXCEPTION 'READINESS_ANON_RPC_ADMITTED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
SELECT jsonb_build_object('anonRPCDenied',true,'privateSchemaDenied',NOT has_schema_privilege(current_user,'review_media_private','USAGE'));
RESET ROLE;
ROLLBACK;
