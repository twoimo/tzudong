\set ON_ERROR_STOP on
BEGIN;

DO $$
BEGIN
  PERFORM pg_catalog.set_config(
    'tzudong.test_user_id',
    (
      SELECT user_row.id::text
      FROM auth.users AS user_row
      WHERE user_row.email = 'nightly-ci@local.invalid'
    ),
    true
  );
  IF pg_catalog.current_setting('tzudong.test_user_id', true) IS NULL THEN
    RAISE EXCEPTION 'local_runtime_test_identity_missing';
  END IF;
END
$$;

-- Fixed rows make public-active, authenticated-admin, and service-role paths
-- observable without relying on pre-existing content. The outer transaction
-- rolls every fixture and write probe back.
INSERT INTO public.announcements (
  id, created_by, title, content, is_active, show_on_banner, priority,
  created_at, updated_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000000401'::uuid,
    pg_catalog.current_setting('tzudong.test_user_id')::uuid,
    'Public active probe', 'Local role-bound active announcement.',
    true, false, 40,
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000000402'::uuid,
    pg_catalog.current_setting('tzudong.test_user_id')::uuid,
    'Admin inactive probe', 'Local role-bound inactive announcement.',
    false, false, 41,
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
  );

INSERT INTO public.ad_banners (
  id, title, description, is_active, priority, display_target, created_by,
  media_type, created_at, updated_at
)
VALUES
  (
    '00000000-0000-4000-8000-000000000411'::uuid,
    'Public active banner probe', 'Local role-bound active banner.',
    true, 40, ARRAY['sidebar']::text[],
    pg_catalog.current_setting('tzudong.test_user_id')::uuid,
    'none',
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
  ),
  (
    '00000000-0000-4000-8000-000000000412'::uuid,
    'Admin inactive banner probe', 'Local role-bound inactive banner.',
    false, 41, ARRAY['sidebar']::text[],
    pg_catalog.current_setting('tzudong.test_user_id')::uuid,
    'none',
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-01-01T00:00:00Z'::timestamptz
  );

SET LOCAL ROLE anon;
DO $$
DECLARE
  denied_sql text;
BEGIN
  IF (
    SELECT count(*)
      FROM public.announcements
     WHERE id IN (
       '00000000-0000-4000-8000-000000000401'::uuid,
       '00000000-0000-4000-8000-000000000402'::uuid
     )
  ) <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.announcements
     WHERE id = '00000000-0000-4000-8000-000000000401'::uuid
  ) OR (
    SELECT count(*)
      FROM public.ad_banners
     WHERE id IN (
       '00000000-0000-4000-8000-000000000411'::uuid,
       '00000000-0000-4000-8000-000000000412'::uuid
     )
  ) <> 1 OR NOT EXISTS (
    SELECT 1 FROM public.ad_banners
     WHERE id = '00000000-0000-4000-8000-000000000411'::uuid
  ) THEN
    RAISE EXCEPTION 'local_runtime_anon_active_read_failed';
  END IF;

  BEGIN
    PERFORM public.is_user_admin(
      '00000000-0000-4000-8000-000000000099'::uuid
    );
    RAISE EXCEPTION 'local_runtime_anon_legacy_admin_helper_was_executable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.is_current_user_active_admin();
    RAISE EXCEPTION 'local_runtime_anon_caller_bound_helper_was_executable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM count(*) FROM public.admin_restaurant_map_overlays;
    RAISE EXCEPTION 'local_runtime_anon_overlay_direct_read_was_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.apply_admin_restaurant_map_overlay_action(
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, NULL
    );
    RAISE EXCEPTION 'local_runtime_anon_overlay_rpc_was_executable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.read_admin_user_ids_for_management();
    RAISE EXCEPTION 'local_runtime_anon_admin_data_rpc_was_executable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  FOREACH denied_sql IN ARRAY ARRAY[
    'SELECT public.read_admin_user_management_metadata(NULL::uuid[])',
    'SELECT public.read_admin_user_audit_events(NULL::integer)',
    'SELECT public.append_admin_user_audit_event(NULL::uuid,NULL::uuid,NULL::text,NULL::text,NULL::text,NULL::uuid,NULL::jsonb,NULL::jsonb,NULL::timestamptz,NULL::text,NULL::uuid,NULL::text,NULL::text)'
  ] LOOP
    BEGIN
      EXECUTE denied_sql;
      RAISE EXCEPTION 'local_runtime_anon_admin_data_rpc_was_executable';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  BEGIN
    INSERT INTO public.announcements (title, content)
    VALUES ('anon write probe', 'must be denied');
    RAISE EXCEPTION 'local_runtime_anon_public_write_was_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$$;

RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  denied_sql text;
BEGIN
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '00000000-0000-4000-8000-000000000099',
    true
  );
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);

  IF public.is_current_user_active_admin() IS NOT FALSE
     OR (
       SELECT count(*) FROM public.announcements
        WHERE id IN (
          '00000000-0000-4000-8000-000000000401'::uuid,
          '00000000-0000-4000-8000-000000000402'::uuid
        )
     ) <> 1
     OR (
       SELECT count(*) FROM public.ad_banners
        WHERE id IN (
          '00000000-0000-4000-8000-000000000411'::uuid,
          '00000000-0000-4000-8000-000000000412'::uuid
        )
     ) <> 1 THEN
    RAISE EXCEPTION 'local_runtime_authenticated_non_admin_boundary_failed';
  END IF;

  BEGIN
    PERFORM public.is_user_admin(
      pg_catalog.current_setting('tzudong.test_user_id')::uuid
    );
    RAISE EXCEPTION 'local_runtime_authenticated_legacy_admin_helper_was_executable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.read_admin_user_management_metadata(
      ARRAY[pg_catalog.current_setting('tzudong.test_user_id')::uuid]
    );
    RAISE EXCEPTION 'local_runtime_authenticated_admin_data_rpc_was_executable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM count(*) FROM public.admin_restaurant_map_overlays;
    RAISE EXCEPTION 'local_runtime_authenticated_overlay_direct_read_was_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.apply_admin_restaurant_map_overlay_action(
      NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL,
      NULL, NULL, NULL, NULL, NULL, NULL
    );
    RAISE EXCEPTION 'local_runtime_authenticated_overlay_rpc_was_executable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  FOREACH denied_sql IN ARRAY ARRAY[
    'SELECT public.read_admin_user_ids_for_management()',
    'SELECT public.read_admin_user_audit_events(NULL::integer)',
    'SELECT public.append_admin_user_audit_event(NULL::uuid,NULL::uuid,NULL::text,NULL::text,NULL::text,NULL::uuid,NULL::jsonb,NULL::jsonb,NULL::timestamptz,NULL::text,NULL::uuid,NULL::text,NULL::text)'
  ] LOOP
    BEGIN
      EXECUTE denied_sql;
      RAISE EXCEPTION 'local_runtime_authenticated_admin_data_rpc_was_executable';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  BEGIN
    INSERT INTO public.ad_banners (title, is_active, media_type)
    VALUES ('non-admin write probe', true, 'none');
    RAISE EXCEPTION 'local_runtime_authenticated_non_admin_write_was_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    pg_catalog.current_setting('tzudong.test_user_id'),
    true
  );

  IF public.is_current_user_active_admin() IS NOT TRUE
     OR (
       SELECT count(*) FROM public.announcements
        WHERE id IN (
          '00000000-0000-4000-8000-000000000401'::uuid,
          '00000000-0000-4000-8000-000000000402'::uuid
        )
     ) <> 2
     OR (
       SELECT count(*) FROM public.ad_banners
        WHERE id IN (
          '00000000-0000-4000-8000-000000000411'::uuid,
          '00000000-0000-4000-8000-000000000412'::uuid
        )
     ) <> 2 THEN
    RAISE EXCEPTION 'local_runtime_authenticated_admin_read_failed';
  END IF;

  -- Every legacy RLS caller now uses the same caller-bound predicate. Merely
  -- reading all affected relations catches a revoked-helper regression before
  -- a browser route encounters it.
  PERFORM count(*) FROM public.restaurant_refresh_candidates;
  PERFORM count(*) FROM public.restaurant_refresh_runs;
  PERFORM count(*) FROM public.restaurant_request_review_audit;
  PERFORM count(*) FROM public.restaurant_requests;
  PERFORM count(*) FROM public.restaurant_submission_items;
  PERFORM count(*) FROM public.restaurant_submissions;
  PERFORM count(*) FROM public.restaurants;
  PERFORM count(*) FROM public.short_urls;

  INSERT INTO public.announcements (
    id, created_by, title, content, is_active, priority
  ) VALUES (
    '00000000-0000-4000-8000-000000000403'::uuid,
    pg_catalog.current_setting('tzudong.test_user_id')::uuid,
    'Admin write probe', 'must be admitted', false, 42
  );
  UPDATE public.announcements
     SET priority = 43
   WHERE id = '00000000-0000-4000-8000-000000000403'::uuid;
  DELETE FROM public.announcements
   WHERE id = '00000000-0000-4000-8000-000000000403'::uuid;

  INSERT INTO public.ad_banners (
    id, title, is_active, priority, created_by, media_type
  ) VALUES (
    '00000000-0000-4000-8000-000000000413'::uuid,
    'Admin banner write probe', false, 42,
    pg_catalog.current_setting('tzudong.test_user_id')::uuid,
    'none'
  );
  UPDATE public.ad_banners
     SET priority = 43
   WHERE id = '00000000-0000-4000-8000-000000000413'::uuid;
  DELETE FROM public.ad_banners
   WHERE id = '00000000-0000-4000-8000-000000000413'::uuid;
END
$$;

RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
DECLARE
  metadata_row record;
  audit_event_id uuid;
  approved boolean;
  overlay_initial jsonb;
  overlay_replay jsonb;
  overlay_audit_id uuid;
  guard_message text;
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    '{"role":"service_role"}',
    true
  );
  IF (
    SELECT count(*) FROM public.announcements
     WHERE id IN (
       '00000000-0000-4000-8000-000000000401'::uuid,
       '00000000-0000-4000-8000-000000000402'::uuid
     )
  ) <> 2 OR (
    SELECT count(*) FROM public.ad_banners
     WHERE id IN (
       '00000000-0000-4000-8000-000000000411'::uuid,
       '00000000-0000-4000-8000-000000000412'::uuid
     )
  ) <> 2 THEN
    RAISE EXCEPTION 'local_runtime_service_role_bypass_failed';
  END IF;

  BEGIN
    PERFORM public.is_current_user_active_admin();
    RAISE EXCEPTION 'local_runtime_service_role_caller_bound_helper_was_executable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.is_user_admin(
      '00000000-0000-4000-8000-000000000099'::uuid
    );
    RAISE EXCEPTION 'local_runtime_service_role_legacy_admin_helper_was_executable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- EXECUTE remains service-only, while the definer independently requires an
  -- exact service-role JWT claim without touching the revoked auth schema.
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    '{"role":"authenticated"}',
    true
  );
  BEGIN
    PERFORM public.apply_admin_restaurant_map_overlay_action(
      pg_catalog.current_setting('tzudong.test_user_id')::uuid,
      'upsert_overlay',
      '00000000-0000-4000-8000-000000000101'::uuid,
      'trend',
      'Denied claim probe',
      NULL,
      NULL,
      NULL,
      '{}'::jsonb,
      'LOCAL_TEST_ONLY claim guard probe',
      repeat('c', 64),
      repeat('d', 64),
      '00000000-0000-4000-8000-000000000921'::uuid,
      'local-runtime-overlay-denied-claim-v1',
      '{"source":"LOCAL_TEST_ONLY:NOT_PRODUCTION"}'::jsonb
    );
    RAISE EXCEPTION 'local_runtime_overlay_claim_guard_failed';
  EXCEPTION WHEN insufficient_privilege THEN
    GET STACKED DIAGNOSTICS guard_message = MESSAGE_TEXT;
    IF guard_message IS DISTINCT FROM 'overlay_service_role_required' THEN
      RAISE EXCEPTION 'local_runtime_overlay_claim_guard_failed';
    END IF;
  END;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    '{"role":"service_role"}',
    true
  );

  -- Existing server-side preview/GET contracts retain direct service SELECT.
  PERFORM count(*) FROM public.admin_restaurant_map_overlays;
  BEGIN
    INSERT INTO public.admin_restaurant_map_overlays (
      restaurant_id, overlay_type, label, created_by_admin_id,
      updated_by_admin_id
    ) VALUES (
      '00000000-0000-4000-8000-000000000101'::uuid,
      'trend',
      'Forbidden direct write',
      pg_catalog.current_setting('tzudong.test_user_id')::uuid,
      pg_catalog.current_setting('tzudong.test_user_id')::uuid
    );
    RAISE EXCEPTION 'local_runtime_service_overlay_direct_write_was_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM count(*) FROM public.admin_restaurant_map_overlay_audit_events;
    RAISE EXCEPTION 'local_runtime_service_overlay_audit_direct_read_was_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  overlay_initial := public.apply_admin_restaurant_map_overlay_action(
    pg_catalog.current_setting('tzudong.test_user_id')::uuid,
    'upsert_overlay',
    '00000000-0000-4000-8000-000000000101'::uuid,
    'trend',
    'Local overlay probe',
    'Deterministic local map-overlay behavior fixture.',
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-12-31T23:59:59Z'::timestamptz,
    '{"source":"LOCAL_TEST_ONLY:NOT_PRODUCTION"}'::jsonb,
    'LOCAL_TEST_ONLY map-overlay behavior probe',
    repeat('c', 64),
    repeat('d', 64),
    '00000000-0000-4000-8000-000000000922'::uuid,
    'local-runtime-overlay-apply-v1',
    '{"source":"LOCAL_TEST_ONLY:NOT_PRODUCTION"}'::jsonb
  );
  overlay_audit_id := (overlay_initial #>> '{audit,id}')::uuid;
  IF overlay_initial ->> 'status' IS DISTINCT FROM 'applied'
     OR overlay_initial -> 'replayed' IS DISTINCT FROM 'false'::jsonb
     OR overlay_initial #>> '{overlay,restaurant_id}' IS DISTINCT FROM
       '00000000-0000-4000-8000-000000000101'
     OR overlay_initial #>> '{overlay,overlay_type}' IS DISTINCT FROM 'trend'
     OR overlay_initial #>> '{overlay,label}' IS DISTINCT FROM
       'Local overlay probe'
     OR overlay_initial #> '{readback,matchedPayloadHash}' IS DISTINCT FROM
       'true'::jsonb
     OR overlay_initial #> '{readback,matchedPreviewHash}' IS DISTINCT FROM
       'true'::jsonb
     OR overlay_audit_id IS NULL THEN
    RAISE EXCEPTION 'local_runtime_overlay_initial_apply_failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.admin_restaurant_map_overlays AS overlay_row
     WHERE overlay_row.restaurant_id =
       '00000000-0000-4000-8000-000000000101'::uuid
       AND overlay_row.overlay_type = 'trend'
       AND overlay_row.label = 'Local overlay probe'
       AND overlay_row.is_active = true
  ) THEN
    RAISE EXCEPTION 'local_runtime_service_overlay_direct_read_failed';
  END IF;

  overlay_replay := public.apply_admin_restaurant_map_overlay_action(
    pg_catalog.current_setting('tzudong.test_user_id')::uuid,
    'upsert_overlay',
    '00000000-0000-4000-8000-000000000101'::uuid,
    'trend',
    'Local overlay probe',
    'Deterministic local map-overlay behavior fixture.',
    '2026-01-01T00:00:00Z'::timestamptz,
    '2026-12-31T23:59:59Z'::timestamptz,
    '{"source":"LOCAL_TEST_ONLY:NOT_PRODUCTION"}'::jsonb,
    'LOCAL_TEST_ONLY map-overlay behavior probe',
    repeat('c', 64),
    repeat('d', 64),
    '00000000-0000-4000-8000-000000000922'::uuid,
    'local-runtime-overlay-apply-v1',
    '{"source":"LOCAL_TEST_ONLY:NOT_PRODUCTION"}'::jsonb
  );
  IF overlay_replay ->> 'status' IS DISTINCT FROM 'applied'
     OR overlay_replay -> 'replayed' IS DISTINCT FROM 'true'::jsonb
     OR (overlay_replay #>> '{audit,id}')::uuid IS DISTINCT FROM
       overlay_audit_id
     OR overlay_replay #> '{readback,matchedPayloadHash}' IS DISTINCT FROM
       'true'::jsonb
     OR overlay_replay #> '{readback,matchedPreviewHash}' IS DISTINCT FROM
       'true'::jsonb THEN
    RAISE EXCEPTION 'local_runtime_overlay_replay_failed';
  END IF;

  -- G014 direct-table revocations remain intact. The new service boundary is
  -- four fixed-shape RPCs, never a broad service table grant.
  BEGIN
    PERFORM count(*) FROM public.profiles;
    RAISE EXCEPTION 'local_runtime_service_profile_direct_read_was_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM count(*) FROM public.admin_audit_events;
    RAISE EXCEPTION 'local_runtime_service_audit_direct_read_was_admitted';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  SELECT * INTO STRICT metadata_row
    FROM public.read_admin_user_management_metadata(
      ARRAY[pg_catalog.current_setting('tzudong.test_user_id')::uuid]
    );
  IF metadata_row.user_id IS DISTINCT FROM
       pg_catalog.current_setting('tzudong.test_user_id')::uuid
     OR metadata_row.username IS DISTINCT FROM 'nightly-ci'
     OR metadata_row.nickname IS DISTINCT FROM 'Nightly CI'
     OR metadata_row.avatar_url IS NOT NULL
     OR metadata_row.profile_role IS DISTINCT FROM 'user'
     OR metadata_row.profile_created_at IS DISTINCT FROM
       '2026-01-01T00:00:00Z'::timestamptz
     OR metadata_row.profile_updated_at IS DISTINCT FROM
       '2026-01-01T00:00:00Z'::timestamptz
     OR metadata_row.is_admin IS DISTINCT FROM true
     OR metadata_row.account_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'local_runtime_admin_metadata_rpc_failed';
  END IF;

  IF (
    SELECT array_agg(user_id ORDER BY user_id)
      FROM public.read_admin_user_ids_for_management()
  ) IS DISTINCT FROM ARRAY[
    pg_catalog.current_setting('tzudong.test_user_id')::uuid
  ] THEN
    RAISE EXCEPTION 'local_runtime_admin_ids_rpc_failed';
  END IF;

  audit_event_id := public.append_admin_user_audit_event(
    pg_catalog.current_setting('tzudong.test_user_id')::uuid,
    pg_catalog.current_setting('tzudong.test_user_id')::uuid,
    'admin_user_profile_updated',
    'ADMIN_USER_PROFILE_UPDATE_INTENT',
    'intent',
    '00000000-0000-4000-8000-000000000902'::uuid,
    '{"requested":1}'::jsonb,
    '{"profileChanged":true}'::jsonb,
    NULL,
    NULL,
    '00000000-0000-4000-8000-000000000901'::uuid,
    repeat('a', 64),
    NULL
  );
  IF audit_event_id IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.read_admin_user_audit_events(50) AS audit_row
     WHERE audit_row.id = audit_event_id
       AND audit_row.actor_user_id =
         pg_catalog.current_setting('tzudong.test_user_id')::uuid
       AND audit_row.target_user_id =
         pg_catalog.current_setting('tzudong.test_user_id')::uuid
       AND audit_row.action = 'admin_user_profile_updated'
       AND audit_row.reason = 'ADMIN_USER_PROFILE_UPDATE_INTENT'
       AND audit_row.status = 'intent'
       AND audit_row.correlation_id =
         '00000000-0000-4000-8000-000000000902'::uuid
       AND audit_row.applied_at IS NULL
       AND audit_row.error_code IS NULL
       AND audit_row.audit_counts = '{"requested":1}'::jsonb
       AND audit_row.audit_flags = '{"profileChanged":true}'::jsonb
  ) THEN
    RAISE EXCEPTION 'local_runtime_admin_audit_rpc_failed';
  END IF;

  BEGIN
    PERFORM public.append_admin_user_audit_event(
      '00000000-0000-4000-8000-000000000099'::uuid,
      pg_catalog.current_setting('tzudong.test_user_id')::uuid,
      'admin_user_profile_updated',
      'ADMIN_USER_PROFILE_UPDATE_INTENT',
      'intent',
      NULL,
      '{"requested":1}'::jsonb,
      '{"profileChanged":true}'::jsonb,
      NULL,
      NULL,
      '00000000-0000-4000-8000-000000000903'::uuid,
      NULL,
      NULL
    );
    RAISE EXCEPTION 'local_runtime_non_admin_audit_actor_was_admitted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  BEGIN
    PERFORM public.read_admin_user_management_metadata(ARRAY[]::uuid[]);
    RAISE EXCEPTION 'local_runtime_empty_admin_metadata_was_admitted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  BEGIN
    PERFORM public.read_admin_user_audit_events(51);
    RAISE EXCEPTION 'local_runtime_oversized_admin_audit_read_was_admitted';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;

  SELECT result.success INTO approved
    FROM public.approve_submission_item(
      '00000000-0000-4000-8000-000000000999'::uuid,
      pg_catalog.current_setting('tzudong.test_user_id')::uuid,
      '{}'::jsonb
    ) AS result;
  IF approved IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'local_runtime_trusted_legacy_admin_rpc_failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.youtube_channel_kpi_snapshots AS channel_row
     WHERE channel_row.channel_id = 'local-nightly-channel'
       AND channel_row.source =
         'LOCAL_TEST_ONLY:NOT_PRODUCTION:nightly-ci:youtube-channel-snapshot-v1'
  ) THEN
    RAISE EXCEPTION 'local_runtime_youtube_channel_snapshot_failed';
  END IF;

  INSERT INTO public.announcements (
    id, title, content, is_active, priority
  ) VALUES (
    '00000000-0000-4000-8000-000000000404'::uuid,
    'Service write probe', 'must be admitted by BYPASSRLS', false, 44
  );
  DELETE FROM public.announcements
   WHERE id = '00000000-0000-4000-8000-000000000404'::uuid;
  INSERT INTO public.ad_banners (id, title, is_active, priority, media_type)
  VALUES (
    '00000000-0000-4000-8000-000000000414'::uuid,
    'Service banner write probe', false, 44, 'none'
  );
  DELETE FROM public.ad_banners
   WHERE id = '00000000-0000-4000-8000-000000000414'::uuid;
END
$$;

RESET ROLE;

SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    pg_catalog.current_setting('tzudong.test_user_id'),
    true
  );
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    pg_catalog.jsonb_build_object(
      'sub', pg_catalog.current_setting('tzudong.test_user_id'),
      'role', 'authenticated'
    )::text,
    true
  );
END
$$;

DO $$
DECLARE
  receipt jsonb;
BEGIN
  receipt := public.get_current_privacy_eligibility();
  IF receipt ->> 'schemaVersion' IS DISTINCT FROM '1'
     OR receipt ->> 'eligible' IS DISTINCT FROM 'true'
     OR receipt ->> 'reasonCode' IS DISTINCT FROM 'PRIVACY_ELIGIBLE'
     OR receipt ->> 'policyVersionId' IS DISTINCT FROM '00000000-0000-4000-8000-000000000301'
     OR receipt ->> 'policyVersion' IS DISTINCT FROM '2026-08-04.1'
     OR receipt ->> 'contentSha256' IS DISTINCT FROM '6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b' THEN
    RAISE EXCEPTION 'local_runtime_privacy_fixture_not_eligible';
  END IF;
END
$$;

-- The published policy row remains immutable. These savepoint-scoped changes
-- exercise the removable/inactive age-attestation half of the synthetic
-- fixture and are covered by the outer rollback.
RESET ROLE;
SAVEPOINT privacy_fixture_inactive;
UPDATE privacy_retention.privacy_age_profiles
   SET status = 'blocked',
       updated_at = '2026-01-01T00:00:01Z'::timestamptz
 WHERE user_id = pg_catalog.current_setting('tzudong.test_user_id')::uuid;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  receipt jsonb;
BEGIN
  receipt := public.get_current_privacy_eligibility();
  IF receipt ->> 'eligible' IS DISTINCT FROM 'false'
     OR receipt ->> 'reasonCode' IS DISTINCT FROM 'PRIVACY_AGE_BLOCKED'
     OR receipt ->> 'policyVersionId' IS DISTINCT FROM '00000000-0000-4000-8000-000000000301'
     OR receipt ->> 'policyVersion' IS DISTINCT FROM '2026-08-04.1'
     OR receipt ->> 'contentSha256' IS DISTINCT FROM '6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b' THEN
    RAISE EXCEPTION 'local_runtime_inactive_privacy_fixture_was_admitted';
  END IF;
END
$$;
RESET ROLE;
ROLLBACK TO SAVEPOINT privacy_fixture_inactive;
RELEASE SAVEPOINT privacy_fixture_inactive;

SAVEPOINT privacy_fixture_removed;
DELETE FROM privacy_retention.privacy_age_profiles
 WHERE user_id = pg_catalog.current_setting('tzudong.test_user_id')::uuid;
SET LOCAL ROLE authenticated;
DO $$
DECLARE
  receipt jsonb;
BEGIN
  receipt := public.get_current_privacy_eligibility();
  IF receipt ->> 'eligible' IS DISTINCT FROM 'false'
     OR receipt ->> 'reasonCode' IS DISTINCT FROM 'PRIVACY_AGE_ATTESTATION_REQUIRED'
     OR receipt ->> 'policyVersionId' IS DISTINCT FROM '00000000-0000-4000-8000-000000000301'
     OR receipt ->> 'policyVersion' IS DISTINCT FROM '2026-08-04.1'
     OR receipt ->> 'contentSha256' IS DISTINCT FROM '6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b' THEN
    RAISE EXCEPTION 'local_runtime_removed_privacy_fixture_was_admitted';
  END IF;
END
$$;
RESET ROLE;
ROLLBACK TO SAVEPOINT privacy_fixture_removed;
RELEASE SAVEPOINT privacy_fixture_removed;

SET LOCAL ROLE authenticated;
DO $$
DECLARE
  receipt jsonb;
BEGIN
  receipt := public.get_current_privacy_eligibility();
  IF receipt ->> 'eligible' IS DISTINCT FROM 'true'
     OR receipt ->> 'reasonCode' IS DISTINCT FROM 'PRIVACY_ELIGIBLE'
     OR receipt ->> 'policyVersion' IS DISTINCT FROM '2026-08-04.1' THEN
    RAISE EXCEPTION 'local_runtime_privacy_fixture_rollback_failed';
  END IF;
END
$$;

INSERT INTO storage.objects (bucket_id, name, owner_id)
VALUES
  (
    'profile-avatars',
    pg_catalog.current_setting('tzudong.test_user_id') || '/avatar.jpg',
    pg_catalog.current_setting('tzudong.test_user_id')
  ),
  (
    'review-photos',
    pg_catalog.current_setting('tzudong.test_user_id') || '/food.webp',
    pg_catalog.current_setting('tzudong.test_user_id')
  ),
  (
    'ad-banner-images',
    pg_catalog.current_setting('tzudong.test_user_id') || '/banner.webp',
    pg_catalog.current_setting('tzudong.test_user_id')
  );

DO $$
BEGIN
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES (
      'profile-avatars',
      '00000000-0000-4000-8000-000000000099/avatar.jpg',
      pg_catalog.current_setting('tzudong.test_user_id')
    );
    RAISE EXCEPTION 'local_runtime_foreign_path_was_admitted';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END
$$;

DO $$
BEGIN
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES (
      'youtube-thumbnail-releases',
      'youtube-thumbnail-generator/00000000-0000-4000-8000-000000000899.png',
      pg_catalog.current_setting('tzudong.test_user_id')
    );
    RAISE EXCEPTION 'local_runtime_private_release_bucket_was_admitted';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END
$$;

DO $$
DECLARE
  v_admin_id text := pg_catalog.current_setting('tzudong.test_user_id');
BEGIN
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.sub',
    '00000000-0000-4000-8000-000000000099',
    true
  );
  BEGIN
    INSERT INTO storage.objects (bucket_id, name, owner_id)
    VALUES (
      'ad-banner-images',
      '00000000-0000-4000-8000-000000000099/banner.webp',
      '00000000-0000-4000-8000-000000000099'
    );
    RAISE EXCEPTION 'local_runtime_non_admin_banner_write_was_admitted';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', v_admin_id, true);
END
$$;

RESET ROLE;
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM storage.objects AS object_row
    WHERE object_row.name IN (
      pg_catalog.current_setting('tzudong.test_user_id') || '/avatar.jpg',
      pg_catalog.current_setting('tzudong.test_user_id') || '/food.webp',
      pg_catalog.current_setting('tzudong.test_user_id') || '/banner.webp'
    )
  ) <> 3 THEN
    RAISE EXCEPTION 'local_runtime_public_media_read_failed';
  END IF;
END
$$;

RESET ROLE;
SET LOCAL ROLE service_role;
DO $$
BEGIN
  PERFORM public.publish_youtube_thumbnail_release(
    '00000000-0000-4000-8000-000000000801'::uuid,
    'youtube-thumbnail-generator/current',
    'local-candidate-1',
    'local-manifest-1',
    'local-image-1',
    'youtube-thumbnail-releases',
    'youtube-thumbnail-generator/00000000-0000-4000-8000-000000000801.png',
    '/api/admin/youtube-thumbnail-generator/releases/assets/00000000-0000-4000-8000-000000000801',
    repeat('a', 64),
    95,
    '["none"]'::jsonb,
    '[]'::jsonb,
    '{"width":1280,"height":720}'::jsonb,
    '{}'::jsonb,
    pg_catalog.current_setting('tzudong.test_user_id')::uuid,
    '2026-01-01T01:00:00Z'::timestamptz
  );

  PERFORM public.publish_youtube_thumbnail_release(
    '00000000-0000-4000-8000-000000000802'::uuid,
    'youtube-thumbnail-generator/current',
    'local-candidate-2',
    'local-manifest-2',
    'local-image-2',
    'youtube-thumbnail-releases',
    'youtube-thumbnail-generator/00000000-0000-4000-8000-000000000802.png',
    '/api/admin/youtube-thumbnail-generator/releases/assets/00000000-0000-4000-8000-000000000802',
    repeat('b', 64),
    96,
    '["none"]'::jsonb,
    '[]'::jsonb,
    '{"width":1280,"height":720}'::jsonb,
    '{}'::jsonb,
    pg_catalog.current_setting('tzudong.test_user_id')::uuid,
    '2026-01-01T02:00:00Z'::timestamptz
  );
END
$$;

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM public.youtube_thumbnail_releases
    WHERE release_key = 'youtube-thumbnail-generator/current'
      AND status = 'active'
  ) <> 1 OR NOT EXISTS (
    SELECT 1
    FROM public.youtube_thumbnail_releases
    WHERE id = '00000000-0000-4000-8000-000000000801'::uuid
      AND status = 'superseded'
      AND superseded_at = '2026-01-01T02:00:00Z'::timestamptz
  ) THEN
    RAISE EXCEPTION 'local_runtime_thumbnail_release_transition_failed';
  END IF;
END
$$;

RESET ROLE;
DO $$
BEGIN
  IF (
    SELECT array_agg(publication_table.tablename::text ORDER BY publication_table.tablename::text)
    FROM pg_catalog.pg_publication_tables AS publication_table
    WHERE publication_table.pubname = 'supabase_realtime'
      AND publication_table.schemaname = 'public'
  ) IS DISTINCT FROM ARRAY[
    'notifications', 'profiles', 'review_likes', 'reviews'
  ]::text[] THEN
    RAISE EXCEPTION 'local_runtime_realtime_membership_failed';
  END IF;
END
$$;

ROLLBACK;
