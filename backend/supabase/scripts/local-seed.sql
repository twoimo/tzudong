-- Deterministic disposable local seed. This file owns DML/fixtures only;
-- application/platform DDL remains in the prerequisite and migration chain.
BEGIN;
SET LOCAL search_path = public, extensions, pg_catalog;
SELECT pg_catalog.set_config('tzudong.local_nightly_user_id', :'nightly_user_id', true);
DO $$
DECLARE
  unexpected_column text;
BEGIN
  IF (
    SELECT pg_catalog.pg_get_userbyid(nspowner)
    FROM pg_catalog.pg_namespace
    WHERE nspname = 'auth'
  ) IS DISTINCT FROM 'supabase_admin' THEN
    RAISE EXCEPTION 'local_seed_auth_schema_owner';
  END IF;
  SELECT column_item.attname
    INTO unexpected_column
    FROM pg_catalog.pg_attribute AS column_item
    JOIN pg_catalog.pg_class AS relation_row ON relation_row.oid = column_item.attrelid
    JOIN pg_catalog.pg_namespace AS schema_row ON schema_row.oid = relation_row.relnamespace
   WHERE schema_row.nspname = 'auth'
     AND relation_row.relname = 'users'
     AND column_item.attnum > 0
     AND NOT column_item.attisdropped
     AND column_item.attname <> ALL (ARRAY[
       'instance_id', 'id', 'aud', 'role', 'email', 'encrypted_password',
       'email_confirmed_at', 'invited_at', 'confirmation_token',
       'confirmation_sent_at', 'recovery_token', 'recovery_sent_at',
       'email_change_token_new', 'email_change', 'email_change_sent_at',
       'last_sign_in_at', 'raw_app_meta_data', 'raw_user_meta_data',
       'is_super_admin', 'created_at', 'updated_at', 'phone',
       'phone_confirmed_at', 'phone_change', 'phone_change_token',
       'phone_change_sent_at', 'confirmed_at', 'email_change_token_current',
       'email_change_confirm_status', 'banned_until', 'reauthentication_token',
       'reauthentication_sent_at', 'is_sso_user', 'deleted_at', 'is_anonymous'
     ]);
  IF unexpected_column IS NOT NULL OR (
    SELECT count(*) FROM pg_catalog.pg_attribute AS column_item
    JOIN pg_catalog.pg_class AS relation_row ON relation_row.oid = column_item.attrelid
    JOIN pg_catalog.pg_namespace AS schema_row ON schema_row.oid = relation_row.relnamespace
    WHERE schema_row.nspname = 'auth' AND relation_row.relname = 'users'
      AND column_item.attnum > 0 AND NOT column_item.attisdropped
  ) <> 35 THEN
    RAISE EXCEPTION 'local_seed_auth_schema_columns';
  END IF;
  SELECT column_item.attname
    INTO unexpected_column
    FROM pg_catalog.pg_attribute AS column_item
    JOIN pg_catalog.pg_class AS relation_row ON relation_row.oid = column_item.attrelid
    JOIN pg_catalog.pg_namespace AS schema_row ON schema_row.oid = relation_row.relnamespace
   WHERE schema_row.nspname = 'auth'
     AND relation_row.relname = 'identities'
     AND column_item.attnum > 0
     AND NOT column_item.attisdropped
     AND column_item.attname <> ALL (ARRAY[
       'provider_id', 'user_id', 'identity_data', 'provider', 'last_sign_in_at',
       'created_at', 'updated_at', 'email', 'id'
     ]);
  IF unexpected_column IS NOT NULL OR (
    SELECT count(*) FROM pg_catalog.pg_attribute AS column_item
    JOIN pg_catalog.pg_class AS relation_row ON relation_row.oid = column_item.attrelid
    JOIN pg_catalog.pg_namespace AS schema_row ON schema_row.oid = relation_row.relnamespace
    WHERE schema_row.nspname = 'auth' AND relation_row.relname = 'identities'
      AND column_item.attnum > 0 AND NOT column_item.attisdropped
  ) <> 9 THEN
    RAISE EXCEPTION 'local_seed_auth_schema_columns';
  END IF;
  IF (SELECT count(*) FROM auth.users) <> 1
     OR EXISTS (
       SELECT 1 FROM auth.users
       WHERE email IS DISTINCT FROM 'nightly-ci@local.invalid'
     )
     OR (SELECT count(*) FROM auth.identities) <> 1
     OR EXISTS (
       SELECT 1 FROM auth.identities
       WHERE user_id IS DISTINCT FROM current_setting('tzudong.local_nightly_user_id', true)::uuid
          OR provider IS DISTINCT FROM 'email'
         OR provider_id IS DISTINCT FROM current_setting('tzudong.local_nightly_user_id', true)::text
          OR identity_data ->> 'email' IS DISTINCT FROM 'nightly-ci@local.invalid'
     )
     OR NOT EXISTS (
       SELECT 1 FROM auth.identities
       WHERE user_id = current_setting('tzudong.local_nightly_user_id', true)::uuid
         AND provider = 'email'
         AND identity_data ->> 'email' = 'nightly-ci@local.invalid'
     ) THEN
    RAISE EXCEPTION 'local_seed_unexpected_auth_identity';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = current_setting('tzudong.local_nightly_user_id', true)::uuid
      AND email = 'nightly-ci@local.invalid'
      AND aud = 'authenticated'
      AND role = 'authenticated'
      AND email_confirmed_at IS NOT NULL
      AND confirmed_at IS NOT NULL
  ) OR (SELECT count(*) FROM auth.users) <> 1 THEN
    RAISE EXCEPTION 'local_seed_unexpected_auth_user';
  END IF;
  IF (SELECT count(*) FROM _tzudong_local.auth_api_ledger) <> 1 OR NOT EXISTS (
    SELECT 1
      FROM _tzudong_local.auth_api_ledger
     WHERE logical_id = 'nightly-ci'
       AND email = 'nightly-ci@local.invalid'
       AND user_id = current_setting('tzudong.local_nightly_user_id', true)::uuid
       AND create_status = '2xx'
       AND create_error_class = 'none'
       AND login_status = '2xx'
       AND login_error_class = 'none'
       AND status = 'running'
  ) THEN
    RAISE EXCEPTION 'local_seed_unexpected_auth_api';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id IS NULL
       OR user_id IS DISTINCT FROM current_setting('tzudong.local_nightly_user_id', true)::uuid
  ) OR (SELECT count(*) FROM public.profiles) > 1 THEN
    RAISE EXCEPTION 'local_seed_unexpected_profile';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id IS DISTINCT FROM current_setting('tzudong.local_nightly_user_id', true)::uuid
       OR role::text IS DISTINCT FROM 'admin'
  ) OR (SELECT count(*) FROM public.user_roles) > 1 THEN
    RAISE EXCEPTION 'local_seed_unexpected_admin_role';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.user_account_status
    WHERE user_id IS DISTINCT FROM current_setting('tzudong.local_nightly_user_id', true)::uuid
       OR account_status IS DISTINCT FROM 'active'
       OR disabled_at IS NOT NULL
  ) OR (SELECT count(*) FROM public.user_account_status) > 1 THEN
    RAISE EXCEPTION 'local_seed_unexpected_account_status';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM privacy_retention.privacy_policy_versions
     WHERE id IS DISTINCT FROM '00000000-0000-4000-8000-000000000301'::uuid
        OR version IS DISTINCT FROM '2026-08-04.1'
        OR locale IS DISTINCT FROM 'ko-KR'
        OR status IS DISTINCT FROM 'published'
        OR content_sha256 IS DISTINCT FROM '6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b'
        OR effective_at IS DISTINCT FROM '2026-01-01T00:00:00Z'::timestamptz
        OR published_at IS DISTINCT FROM '2026-01-01T00:00:00Z'::timestamptz
        OR supersedes_id IS NOT NULL
        OR operator_approval_ref IS DISTINCT FROM 'LOCAL_TEST_ONLY:NOT_PRODUCTION:nightly-ci:privacy-policy-fixture-v1'
        OR created_at IS DISTINCT FROM '2026-01-01T00:00:00Z'::timestamptz
  ) OR (SELECT count(*) FROM privacy_retention.privacy_policy_versions) > 1 THEN
    RAISE EXCEPTION 'local_seed_unexpected_privacy_policy_fixture';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM privacy_retention.privacy_age_profiles
     WHERE user_id IS DISTINCT FROM current_setting('tzudong.local_nightly_user_id', true)::uuid
        OR age_band IS DISTINCT FROM 'age_14_plus'
        OR attested_at IS DISTINCT FROM '2026-01-01T00:00:00Z'::timestamptz
        OR method IS DISTINCT FROM 'self_attestation'
        OR status IS DISTINCT FROM 'eligible'
        OR policy_version_id IS DISTINCT FROM '00000000-0000-4000-8000-000000000301'::uuid
        OR updated_at IS DISTINCT FROM '2026-01-01T00:00:00Z'::timestamptz
  ) OR (SELECT count(*) FROM privacy_retention.privacy_age_profiles) > 1 THEN
    RAISE EXCEPTION 'local_seed_unexpected_privacy_age_profile';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public.youtube_channel_kpi_snapshots
     WHERE id IS DISTINCT FROM '00000000-0000-4000-8000-000000000401'::uuid
        OR channel_id IS DISTINCT FROM 'local-nightly-channel'
        OR channel_title IS DISTINCT FROM '[LOCAL TEST] Nightly channel fixture'
        OR channel_handle IS DISTINCT FROM '@local-nightly'
        OR subscriber_count IS DISTINCT FROM 1000
        OR view_count IS DISTINCT FROM 100000
        OR video_count IS DISTINCT FROM 100
        OR hidden_subscriber_count IS DISTINCT FROM false
        OR previous_bucket_started_at IS NOT NULL
        OR subscriber_delta IS DISTINCT FROM 0
        OR view_delta IS DISTINCT FROM 0
        OR video_delta IS DISTINCT FROM 0
        OR bucket_started_at IS DISTINCT FROM '2026-01-01T00:00:00Z'::timestamptz
        OR fetched_at IS DISTINCT FROM '2026-01-01T00:00:00Z'::timestamptz
        OR source IS DISTINCT FROM 'LOCAL_TEST_ONLY:NOT_PRODUCTION:nightly-ci:youtube-channel-snapshot-v1'
  ) OR (SELECT count(*) FROM public.youtube_channel_kpi_snapshots) > 1 THEN
    RAISE EXCEPTION 'local_seed_unexpected_youtube_channel_snapshot';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.restaurants
    WHERE id NOT IN (
      '00000000-0000-4000-8000-000000000101'::uuid,
      '00000000-0000-4000-8000-000000000102'::uuid
    )
  ) OR (SELECT count(*) FROM public.restaurants) > 2 THEN
    RAISE EXCEPTION 'local_seed_unexpected_restaurants';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.announcements
    WHERE id NOT IN (
      '00000000-0000-4000-8000-000000000201'::uuid,
      'a1b2c3d4-e5f6-7890-abcd-ef1234567890'::uuid,
      'a7b8c9d0-e1f2-3456-0123-789012345678'::uuid,
      'b2c3d4e5-f6a7-8901-bcde-f23456789012'::uuid,
      'b8c9d0e1-f2a3-4567-1234-890123456789'::uuid,
      'c3d4e5f6-a7b8-9012-cdef-345678901234'::uuid,
      'c9d0e1f2-a3b4-5678-2345-901234567890'::uuid,
      'd0e1f2a3-b4c5-6789-3456-012345678901'::uuid,
      'd4e5f6a7-b8c9-0123-def0-456789012345'::uuid,
      'e5f6a7b8-c9d0-1234-ef01-567890123456'::uuid,
      'f6a7b8c9-d0e1-2345-f012-678901234567'::uuid
    )
  ) OR (SELECT count(*) FROM public.announcements) > 11 THEN
    RAISE EXCEPTION 'local_seed_unexpected_announcements';
  END IF;
  IF EXISTS (
    SELECT 1 FROM storage.buckets
    WHERE id <> ALL (ARRAY[
      'ad-banner-images',
      'avatars',
      'profile-avatars',
      'review-photos',
      'youtube-thumbnail-releases'
    ]::text[])
  ) OR (SELECT count(*) FROM storage.buckets) NOT IN (4, 5)
     OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'ad-banner-images')
     OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'profile-avatars')
     OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'review-photos')
     OR NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'youtube-thumbnail-releases') THEN
    RAISE EXCEPTION 'local_seed_unexpected_storage_bucket';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND (
        schemaname <> 'public'
        OR tablename <> ALL (ARRAY[
          'notifications', 'profiles', 'review_likes', 'reviews'
        ]::text[])
      )
  ) OR (
    SELECT count(*) FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
  ) <> 4 THEN
    RAISE EXCEPTION 'local_seed_unexpected_realtime_membership';
  END IF;
END
$$;


INSERT INTO public.profiles (
  id, user_id, nickname, email, avatar_url, created_at, last_login, username, role, updated_at
) VALUES (
  :'nightly_user_id'::uuid,
  :'nightly_user_id'::uuid,
  'Nightly CI', 'nightly-ci@local.invalid', NULL,
  '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 'nightly-ci', 'user', '2026-01-01T00:00:00Z'
)
ON CONFLICT (user_id) DO UPDATE SET
  nickname = EXCLUDED.nickname,
  email = EXCLUDED.email,
  avatar_url = EXCLUDED.avatar_url,
  last_login = EXCLUDED.last_login,
  username = EXCLUDED.username,
  role = EXCLUDED.role,
  updated_at = EXCLUDED.updated_at;

INSERT INTO public.user_account_status (
  user_id, account_status, disabled_at, updated_at
) VALUES (
  :'nightly_user_id'::uuid, 'active', NULL, '2026-01-01T00:00:00Z'
)
ON CONFLICT (user_id) DO UPDATE SET
  account_status = EXCLUDED.account_status,
  disabled_at = EXCLUDED.disabled_at,
  updated_at = EXCLUDED.updated_at;

INSERT INTO public.user_roles (user_id, role, created_at)
VALUES (:'nightly_user_id'::uuid, 'admin', '2026-01-01T00:00:00Z')
ON CONFLICT (user_id, role) DO UPDATE SET
  created_at = EXCLUDED.created_at;

-- Local regression eligibility fixture only. The provenance is deliberately
-- machine-readable and cannot be mistaken for hosted publication, operator
-- approval, legal approval, or a production consent/age-attestation record.
INSERT INTO privacy_retention.privacy_policy_versions (
  id, version, locale, status, content_sha256, effective_at, published_at,
  supersedes_id, operator_approval_ref, created_at
) VALUES (
  '00000000-0000-4000-8000-000000000301',
  '2026-08-04.1',
  'ko-KR',
  'published',
  '6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b',
  '2026-01-01T00:00:00Z',
  '2026-01-01T00:00:00Z',
  NULL,
  'LOCAL_TEST_ONLY:NOT_PRODUCTION:nightly-ci:privacy-policy-fixture-v1',
  '2026-01-01T00:00:00Z'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO privacy_retention.privacy_age_profiles (
  user_id, age_band, attested_at, method, status, policy_version_id, updated_at
) VALUES (
  :'nightly_user_id'::uuid,
  'age_14_plus',
  '2026-01-01T00:00:00Z',
  'self_attestation',
  'eligible',
  '00000000-0000-4000-8000-000000000301',
  '2026-01-01T00:00:00Z'
)
ON CONFLICT (user_id) DO NOTHING;

-- A deterministic local fallback for the admin channel UI.  Its explicit
-- provenance prevents this row from being interpreted as a successful
-- YouTube provider fetch or as hosted/production evidence.
INSERT INTO public.youtube_channel_kpi_snapshots (
  id,
  channel_id,
  channel_title,
  channel_handle,
  subscriber_count,
  view_count,
  video_count,
  hidden_subscriber_count,
  previous_bucket_started_at,
  subscriber_delta,
  view_delta,
  video_delta,
  bucket_started_at,
  fetched_at,
  source
) VALUES (
  '00000000-0000-4000-8000-000000000401',
  'local-nightly-channel',
  '[LOCAL TEST] Nightly channel fixture',
  '@local-nightly',
  1000,
  100000,
  100,
  false,
  NULL,
  0,
  0,
  0,
  '2026-01-01T00:00:00Z',
  '2026-01-01T00:00:00Z',
  'LOCAL_TEST_ONLY:NOT_PRODUCTION:nightly-ci:youtube-channel-snapshot-v1'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.restaurants (
  id, trace_id, approved_name, road_address, jibun_address,
  english_address, categories, lat, lng, phone, status,
  created_at, updated_at, weekly_search_count
) VALUES
  ('00000000-0000-4000-8000-000000000101', 'nightly-trace-1', '정원분식',
   '서울특별시 중구 세종대로 110', '서울특별시 중구 태평로1가 31',
   '110 Sejong-daero, Jung-gu, Seoul', ARRAY['분식'], 37.5665, 126.978,
   '02-0000-0001', 'approved', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', 10),
  ('00000000-0000-4000-8000-000000000102', 'nightly-trace-2', '명동칼국수',
   '서울특별시 중구 을지로 30', '서울특별시 을지로1가 50',
   '30 Eulji-ro, Jung-gu, Seoul', ARRAY['한식'], 37.56695, 126.97885,
   '02-0000-0002', 'approved', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', 8)
ON CONFLICT (id) DO UPDATE SET
  trace_id = EXCLUDED.trace_id,
  approved_name = EXCLUDED.approved_name,
  road_address = EXCLUDED.road_address,
  jibun_address = EXCLUDED.jibun_address,
  english_address = EXCLUDED.english_address,
  categories = EXCLUDED.categories,
  lat = EXCLUDED.lat,
  lng = EXCLUDED.lng,
  phone = EXCLUDED.phone,
  status = EXCLUDED.status,
  created_at = EXCLUDED.created_at,
  updated_at = EXCLUDED.updated_at,
  weekly_search_count = EXCLUDED.weekly_search_count;

INSERT INTO public.announcements (
  id, created_by, title, content, is_active, show_on_banner, priority, created_at, updated_at
) VALUES (
  '00000000-0000-4000-8000-000000000201',
  :'nightly_user_id'::uuid,
  'Local nightly fixture', 'Deterministic local regression announcement.',
  true, true, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 52428800, ARRAY['image/*']::text[])
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;


COMMIT;
