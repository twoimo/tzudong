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
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id <> 'avatars')
     OR (SELECT count(*) FROM storage.buckets) > 1 THEN
    RAISE EXCEPTION 'local_seed_unexpected_storage_bucket';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND (schemaname <> 'public' OR tablename <> 'profiles')
  ) OR (
    SELECT count(*) FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
  ) > 1 THEN
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
