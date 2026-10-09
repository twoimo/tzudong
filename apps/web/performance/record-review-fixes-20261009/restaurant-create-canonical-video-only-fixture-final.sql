BEGIN;SET LOCAL statement_timeout='20s';SET LOCAL row_security=on;
INSERT INTO auth.users(id,aud,role,email,raw_user_meta_data,created_at,updated_at) VALUES('00000000-0000-0000-0000-000000000065','authenticated','authenticated','phase-admin@example.invalid','{"nickname":"phase_admin"}',now(),now()),('00000000-0000-0000-0000-000000000066','authenticated','authenticated','phase-author@example.invalid','{"nickname":"phase_author"}',now(),now());
INSERT INTO public.user_roles(user_id,role) VALUES('00000000-0000-0000-0000-000000000065','admin');INSERT INTO public.user_account_status(user_id,account_status,disabled_at) VALUES('00000000-0000-0000-0000-000000000065','active',NULL),('00000000-0000-0000-0000-000000000066','active',NULL);
INSERT INTO public.restaurants(id,approved_name,origin_name,source_type,status,created_by,lat,lng,jibun_address,road_address,categories,youtube_link,tzuyang_review,youtube_meta,evaluation_results,geocoding_success,trace_id,created_at,updated_at) VALUES('00000000-0000-0000-0000-000000000067','Phase Target','Phase Target','crawler','pending','00000000-0000-0000-0000-000000000066',37.5,127,'synthetic alpha avenue','synthetic alpha avenue',ARRAY['한식'],'https://www.youtube.com/watch?v=ABCDEFGHIJK','synthetic public review','{"title":"synthetic video","operator_marker":"preserve"}'::jsonb,'{"fixture_evidence":true}'::jsonb,true,'00000000-0000-0000-0000-000000000067','2026-10-09T00:00:00Z','2026-10-09T00:00:00Z');
INSERT INTO public.restaurants(id,approved_name,origin_name,source_type,status,created_by,lat,lng,jibun_address,road_address,categories,youtube_link,tzuyang_review,youtube_meta,evaluation_results,geocoding_success,trace_id,created_at,updated_at) VALUES('00000000-0000-0000-0000-000000000068','Phase Source','Phase Source','crawler','pending','00000000-0000-0000-0000-000000000066',37.5,127,'synthetic beta avenue','synthetic beta avenue',ARRAY['한식'],'https://www.youtube.com/watch?v=ABCDEFGHIJK','synthetic public review','{"title":"synthetic video","operator_marker":"preserve"}'::jsonb,'{"fixture_evidence":true}'::jsonb,true,'00000000-0000-0000-0000-000000000068','2026-10-09T00:00:00Z','2026-10-09T00:00:00Z');
INSERT INTO public.restaurant_submissions(id,user_id,submission_type,restaurant_name,restaurant_address,restaurant_categories) VALUES('00000000-0000-0000-0000-000000000069','00000000-0000-0000-0000-000000000066','new','Phase Submitted','synthetic avenue',ARRAY['한식']);INSERT INTO public.restaurant_submission_items(id,submission_id,youtube_link,tzuyang_review,target_restaurant_id) VALUES('00000000-0000-0000-0000-00000000006b','00000000-0000-0000-0000-000000000069','https://www.youtube.com/watch?v=ABCDEFGHIJK','synthetic public review',NULL);
INSERT INTO public.restaurant_submissions(id,user_id,submission_type,restaurant_name,restaurant_address,restaurant_categories) VALUES('00000000-0000-0000-0000-00000000006a','00000000-0000-0000-0000-000000000066','edit','Phase Submitted','synthetic avenue',ARRAY['한식']);INSERT INTO public.restaurant_submission_items(id,submission_id,youtube_link,tzuyang_review,target_restaurant_id) VALUES('00000000-0000-0000-0000-00000000006c','00000000-0000-0000-0000-00000000006a','https://www.youtube.com/watch?v=ABCDEFGHIJK','synthetic public review','00000000-0000-0000-0000-000000000067');
SELECT set_config('fixture.target_updated_at',(SELECT updated_at::text FROM public.restaurants WHERE id='00000000-0000-0000-0000-000000000067'),true);
UPDATE public.restaurants SET youtube_link='https://www.youtube.com/watch?v=LMNOPQRSTUV' WHERE id='00000000-0000-0000-0000-000000000068';-- Feature: crawler-pipeline-orchestration (R4.5, R9.7)
-- Enforce a unique constraint on the stable candidate identity at the Hosted_Store
-- insert boundary so a losing concurrent writer observes a conflict.
--
-- Context: both Mac_Runner (apply_hosted_pending_candidates) and the GHA hosted-apply
-- path reflect pending candidates into public.restaurants keyed by the stable candidate
-- identity, which is the YouTube video id derived from youtube_link
-- (public.extract_youtube_video_id). The hosted classifier skips a candidate as
-- "skip_already_on_hosted" purely by that video id. To make the idempotent mutual-backup
-- contract safe under concurrency, at most one active hosted record may exist per
-- candidate identity, so that when two runners race to insert the same video id the
-- losing INSERT fails with a unique-violation conflict and the runner reclassifies the
-- candidate as already present (insert-if-absent).
--
-- Scope discipline:
--   * This migration is ADDITIVE only. It does NOT modify, delete, or overwrite any
--     already-applied migration.
--   * It does NOT alter or drop the existing composite index
--     idx_restaurants_active_video_identity (video id + resolved identity name) created
--     by 20260417_prevent_active_restaurant_identity_duplicates.sql; this index is a
--     strictly narrower guard on the candidate identity alone.
--   * public.extract_youtube_video_id(text) is IMMUTABLE (see 20260417) and is therefore
--     valid in a functional index expression.
--   * The index is partial: it excludes soft-deleted rows and rows with no resolvable
--     video id, matching the active-row and non-empty-identity semantics already used by
--     the insert boundary and the existing composite index.

create unique index if not exists idx_restaurants_active_candidate_identity
on public.restaurants (
  public.extract_youtube_video_id(youtube_link)
)
where status <> 'deleted'
  and public.extract_youtube_video_id(youtube_link) <> '';
SET LOCAL ROLE service_role;SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);DO $test$ DECLARE o uuid:=gen_random_uuid();p jsonb;a jsonb;c text;expected text:='P0001';BEGIN p:=public.admin_record_action('00000000-0000-0000-0000-000000000065','preview',o,'restaurant.create',ARRAY[]::uuid[],'{"changes": {"approved_name": "Phase Submitted", "phone": null, "categories": ["\ud55c\uc2dd"], "tzuyang_review": "synthetic public review", "youtube_link": "https://www.youtube.com/watch?v=ABCDEFGHIJK", "jibun_address": "synthetic avenue", "road_address": "synthetic avenue", "address_elements": {}, "lat": 37.5, "lng": 127, "youtube_meta": {"title": "synthetic video", "duration": 42, "is_shorts": false, "is_ads": false, "what_ads": null}, "geocoding_success": true}}'::jsonb);BEGIN a:=public.admin_record_action('00000000-0000-0000-0000-000000000065','apply',o,'restaurant.create',ARRAY[]::uuid[],'{"changes": {"approved_name": "Phase Submitted", "phone": null, "categories": ["\ud55c\uc2dd"], "tzuyang_review": "synthetic public review", "youtube_link": "https://www.youtube.com/watch?v=ABCDEFGHIJK", "jibun_address": "synthetic avenue", "road_address": "synthetic avenue", "address_elements": {}, "lat": 37.5, "lng": 127, "youtube_meta": {"title": "synthetic video", "duration": 42, "is_shorts": false, "is_ads": false, "what_ads": null}, "geocoding_success": true}}'::jsonb,p->>'previewHash');RAISE EXCEPTION 'RECORD_ACTION_FIX_CONFLICT_ACCEPTED';EXCEPTION WHEN unique_violation THEN GET STACKED DIAGNOSTICS c=CONSTRAINT_NAME;IF expected<>'23505' OR c<>'fixture_unrelated_phone_unique' THEN RAISE;END IF;WHEN raise_exception THEN IF expected<>'P0001' OR SQLERRM<>'RECORD_ACTION_DUPLICATE' THEN RAISE;END IF;END;IF EXISTS(SELECT 1 FROM pipeline_control.admin_record_audit WHERE operation_id=o) OR (SELECT state FROM pipeline_control.admin_record_operations WHERE id=o)<>'preview' THEN RAISE EXCEPTION 'RECORD_ACTION_FIX_PARTIAL_COMMIT';END IF;END $test$;ROLLBACK;