-- Canonical, read-only local Supabase catalog and seed readback (receipt-v1).
-- Each result row is one compact JSON array: [section, field_1, ... field_n].
-- No raw rows, function bodies, credentials, secrets, or provider endpoints are emitted.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset footer off
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;

-- The seed contract is deliberately fail-closed.  These checks run inside the
-- read-only transaction and therefore cannot alter the database.
DO $$
DECLARE
  user_count bigint;
  identity_count bigint;
  profile_count bigint;
  auth_api_count bigint;
  bucket_count bigint;
  profile_membership_count bigint;
  policy_count bigint;
BEGIN
  SELECT count(*) INTO user_count FROM auth.users;
  IF user_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM auth.users
    WHERE email = 'nightly-ci@local.invalid'
      AND instance_id = '00000000-0000-0000-0000-000000000000'::uuid
      AND aud = 'authenticated'
      AND role = 'authenticated'
      AND email_confirmed_at IS NOT NULL
      AND confirmed_at IS NOT NULL
      AND COALESCE(confirmation_token, '') = ''
      AND COALESCE(recovery_token, '') = ''
      AND COALESCE(email_change_token_new, '') = ''
      AND COALESCE(email_change, '') = ''
      AND COALESCE(raw_app_meta_data, '{}'::jsonb) = '{"provider":"email","providers":["email"]}'::jsonb
      AND COALESCE(raw_user_meta_data, '{}'::jsonb) = '{"nightly":true,"display_name":"Nightly CI","email_verified":true}'::jsonb
      AND is_sso_user = false
      AND is_anonymous = false
  ) THEN
    RAISE EXCEPTION 'receipt_unexpected_auth_user';
  END IF;

  SELECT count(*) INTO identity_count FROM auth.identities;
  IF identity_count <> 1 OR NOT EXISTS (
    SELECT 1
      FROM auth.identities AS identity_row
      JOIN auth.users AS user_row ON user_row.id = identity_row.user_id
     WHERE user_row.email = 'nightly-ci@local.invalid'
       AND identity_row.provider = 'email'
       AND identity_row.provider_id = user_row.id::text
       AND identity_row.identity_data = jsonb_build_object(
         'sub', user_row.id::text, 'email', 'nightly-ci@local.invalid',
         'email_verified', false, 'phone_verified', false)
  ) THEN
    RAISE EXCEPTION 'receipt_unexpected_auth_identity';
  END IF;
  SELECT count(*) INTO auth_api_count FROM _tzudong_local.auth_api_ledger;
  IF auth_api_count <> 1 OR NOT EXISTS (
    SELECT 1
      FROM _tzudong_local.auth_api_ledger AS auth_api_row
      JOIN auth.users AS user_row ON user_row.id = auth_api_row.user_id
     WHERE auth_api_row.logical_id = 'nightly-ci'
       AND auth_api_row.email = 'nightly-ci@local.invalid'
       AND auth_api_row.create_status = '2xx'
       AND auth_api_row.create_error_class = 'none'
       AND auth_api_row.login_status = '2xx'
       AND auth_api_row.login_error_class = 'none'
       AND auth_api_row.status = 'applied'
       AND user_row.email = 'nightly-ci@local.invalid'
  ) THEN
    RAISE EXCEPTION 'receipt_unexpected_auth_api';
  END IF;

  SELECT count(*) INTO profile_count FROM public.profiles;
  IF profile_count <> 1 OR EXISTS (
    SELECT 1
      FROM public.profiles AS profile_row
      LEFT JOIN auth.users AS user_row ON user_row.id = profile_row.user_id
     WHERE profile_row.user_id IS NULL
       OR profile_row.user_id IS DISTINCT FROM user_row.id
        OR user_row.id IS NULL
        OR user_row.email IS DISTINCT FROM 'nightly-ci@local.invalid'
  ) OR NOT EXISTS (
    SELECT 1
      FROM public.profiles AS profile_row
     WHERE profile_row.user_id IS NOT DISTINCT FROM (
       SELECT user_row.id FROM auth.users AS user_row
       WHERE user_row.email = 'nightly-ci@local.invalid'
     )
       AND profile_row.username = 'nightly-ci'
       AND profile_row.nickname = 'Nightly CI'
       AND profile_row.role = 'user'
       AND profile_row.email = 'nightly-ci@local.invalid'
       AND profile_row.updated_at = '2026-01-01T00:00:00Z'::timestamptz
  ) THEN
    RAISE EXCEPTION 'receipt_unexpected_profile';
  END IF;

  SELECT count(*) INTO bucket_count FROM storage.buckets;
  IF bucket_count <> 1 OR NOT EXISTS (
    SELECT 1 FROM storage.buckets
     WHERE id = 'avatars' AND name = 'avatars' AND public = true
       AND file_size_limit = 52428800
       AND allowed_mime_types = ARRAY['image/*']::text[]
  ) THEN
    RAISE EXCEPTION 'receipt_unexpected_storage_bucket';
  END IF;

  SELECT count(*) INTO profile_membership_count
    FROM pg_catalog.pg_publication_tables
   WHERE pubname = 'supabase_realtime'
     AND schemaname = 'public'
     AND tablename = 'profiles';
  IF profile_membership_count <> 1 THEN
    RAISE EXCEPTION 'receipt_unexpected_realtime_membership';
  END IF;

  SELECT count(*) INTO policy_count
    FROM pg_catalog.pg_policy AS policy_row
    JOIN pg_catalog.pg_class AS policy_relation ON policy_relation.oid = policy_row.polrelid
    JOIN pg_catalog.pg_namespace AS policy_schema ON policy_schema.oid = policy_relation.relnamespace
   WHERE policy_schema.nspname = 'storage'
     AND policy_relation.relname = 'objects';
  IF policy_count <> 2 OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy_row
      JOIN pg_catalog.pg_class AS policy_relation ON policy_relation.oid = policy_row.polrelid
      JOIN pg_catalog.pg_namespace AS policy_schema ON policy_schema.oid = policy_relation.relnamespace
     WHERE policy_schema.nspname = 'storage'
       AND policy_relation.relname = 'objects'
       AND policy_row.polname = 'local_nightly_avatar_read'
       AND policy_row.polpermissive IS TRUE
       AND policy_row.polcmd = 'r'
       AND COALESCE((
             SELECT array_agg(policy_role.rolname ORDER BY policy_role.rolname)::text[]
               FROM pg_catalog.unnest(policy_row.polroles) AS policy_role_id(role_oid)
               JOIN pg_catalog.pg_roles AS policy_role ON policy_role.oid = policy_role_id.role_oid
           ), ARRAY[]::text[]) IS NOT DISTINCT FROM ARRAY['anon', 'authenticated']::text[]
       AND btrim(regexp_replace(
             pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid),
             '[[:space:]]+', ' ', 'g'
           )) IS NOT DISTINCT FROM '(bucket_id = ''avatars''::text)'
       AND pg_catalog.pg_get_expr(policy_row.polwithcheck, policy_row.polrelid) IS NULL
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy_row
      JOIN pg_catalog.pg_class AS policy_relation ON policy_relation.oid = policy_row.polrelid
      JOIN pg_catalog.pg_namespace AS policy_schema ON policy_schema.oid = policy_relation.relnamespace
     WHERE policy_schema.nspname = 'storage'
       AND policy_relation.relname = 'objects'
       AND policy_row.polname = 'local_nightly_avatar_insert'
       AND policy_row.polpermissive IS TRUE
       AND policy_row.polcmd = 'a'
       AND COALESCE((
             SELECT array_agg(policy_role.rolname ORDER BY policy_role.rolname)::text[]
               FROM pg_catalog.unnest(policy_row.polroles) AS policy_role_id(role_oid)
               JOIN pg_catalog.pg_roles AS policy_role ON policy_role.oid = policy_role_id.role_oid
           ), ARRAY[]::text[]) IS NOT DISTINCT FROM ARRAY['authenticated']::text[]
       AND pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid) IS NULL
       AND btrim(regexp_replace(
             pg_catalog.pg_get_expr(policy_row.polwithcheck, policy_row.polrelid),
             '[[:space:]]+', ' ', 'g'
           )) IS NOT DISTINCT FROM '(bucket_id = ''avatars''::text)'
  ) THEN
    RAISE EXCEPTION 'receipt_unexpected_storage_policy';
  END IF;

  IF (SELECT count(*) FROM public.restaurants) <> 2
     OR NOT EXISTS (SELECT 1 FROM public.restaurants WHERE id = '00000000-0000-4000-8000-000000000101'::uuid
       AND trace_id = 'nightly-trace-1' AND approved_name = '정원분식' AND status = 'approved'
       AND categories = ARRAY['분식']::text[] AND created_at = '2026-01-01T00:00:00Z'::timestamptz
       AND updated_at = '2026-01-01T00:00:00Z'::timestamptz)
     OR NOT EXISTS (SELECT 1 FROM public.restaurants WHERE id = '00000000-0000-4000-8000-000000000102'::uuid
       AND trace_id = 'nightly-trace-2' AND approved_name = '명동칼국수' AND status = 'approved'
       AND categories = ARRAY['한식']::text[] AND created_at = '2026-01-02T00:00:00Z'::timestamptz
       AND updated_at = '2026-01-02T00:00:00Z'::timestamptz) THEN
    RAISE EXCEPTION 'receipt_unexpected_restaurants';
  END IF;

  IF (SELECT count(*) FROM public.announcements
        WHERE id = '00000000-0000-4000-8000-000000000201'::uuid) <> 1
     OR NOT EXISTS (SELECT 1 FROM public.announcements
       WHERE id = '00000000-0000-4000-8000-000000000201'::uuid
         AND title = 'Local nightly fixture'
         AND content = 'Deterministic local regression announcement.'
         AND is_active = true AND show_on_banner = true AND priority = 1
         AND created_at = '2026-01-01T00:00:00Z'::timestamptz
         AND updated_at = '2026-01-01T00:00:00Z'::timestamptz) THEN
    RAISE EXCEPTION 'receipt_unexpected_announcements';
  END IF;
END
$$;

-- Catalog sections.  The SELECT order below is part of receipt-v1 and each
-- section has an explicit identity ORDER BY.  Platform schemas remain visible
-- in catalog inventory, but function/closure diagnostics below are application
-- schema-only to avoid platform internals becoming false failures.
SELECT json_build_array('extensions', extension_row.extname, extension_schema.nspname,
                        extension_row.extversion, pg_get_userbyid(extension_row.extowner))::text
  FROM pg_catalog.pg_extension AS extension_row
  JOIN pg_catalog.pg_namespace AS extension_schema ON extension_schema.oid = extension_row.extnamespace
 ORDER BY extension_row.extname, extension_schema.nspname;

SELECT json_build_array('roles', role_row.rolname, role_row.rolsuper, role_row.rolcreatedb,
                        role_row.rolcreaterole, role_row.rolcanlogin,
                        COALESCE((SELECT array_agg(member_role.rolname ORDER BY member_role.rolname)
                                    FROM pg_catalog.pg_auth_members AS membership
                                    JOIN pg_catalog.pg_roles AS member_role ON member_role.oid = membership.roleid
                                   WHERE membership.member = role_row.oid), ARRAY[]::text[]))::text
  FROM pg_catalog.pg_roles AS role_row
 ORDER BY role_row.rolname;

SELECT json_build_array('schemas', schema_row.nspname, pg_get_userbyid(schema_row.nspowner))::text
  FROM pg_catalog.pg_namespace AS schema_row
 WHERE schema_row.nspname <> 'information_schema'
   AND schema_row.nspname NOT LIKE 'pg_temp_%'
   AND schema_row.nspname NOT LIKE 'pg_toast_temp_%'
 ORDER BY schema_row.nspname;

SELECT json_build_array('relations', relation_schema.nspname, relation_row.relname,
                        relation_row.relkind::text, pg_get_userbyid(relation_row.relowner))::text
  FROM pg_catalog.pg_class AS relation_row
  JOIN pg_catalog.pg_namespace AS relation_schema ON relation_schema.oid = relation_row.relnamespace
 WHERE relation_schema.nspname <> 'information_schema'
   AND relation_schema.nspname NOT LIKE 'pg_%'
 ORDER BY relation_schema.nspname, relation_row.relname, relation_row.relkind::text;

SELECT json_build_array('columns', column_schema.nspname, column_relation.relname,
                        column_item.attnum, column_item.attname,
                        pg_catalog.format_type(column_item.atttypid, column_item.atttypmod),
                        column_item.attnotnull,
                        pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid))::text
  FROM pg_catalog.pg_attribute AS column_item
  JOIN pg_catalog.pg_class AS column_relation ON column_relation.oid = column_item.attrelid
  JOIN pg_catalog.pg_namespace AS column_schema ON column_schema.oid = column_relation.relnamespace
  LEFT JOIN pg_catalog.pg_attrdef AS default_value
    ON default_value.adrelid = column_item.attrelid AND default_value.adnum = column_item.attnum
 WHERE column_item.attnum > 0 AND NOT column_item.attisdropped
   AND column_schema.nspname <> 'information_schema'
   AND column_schema.nspname NOT LIKE 'pg_%'
 ORDER BY column_schema.nspname, column_relation.relname, column_item.attnum;

SELECT json_build_array('constraints', constraint_schema.nspname, constraint_relation.relname,
                        constraint_row.conname, constraint_row.contype::text,
                        regexp_replace(pg_catalog.pg_get_constraintdef(constraint_row.oid, true), '[[:space:]]+', ' ', 'g'))::text
  FROM pg_catalog.pg_constraint AS constraint_row
  JOIN pg_catalog.pg_class AS constraint_relation ON constraint_relation.oid = constraint_row.conrelid
  JOIN pg_catalog.pg_namespace AS constraint_schema ON constraint_schema.oid = constraint_relation.relnamespace
 WHERE constraint_schema.nspname <> 'information_schema'
   AND constraint_schema.nspname NOT LIKE 'pg_%'
 ORDER BY constraint_schema.nspname, constraint_relation.relname, constraint_row.conname;

SELECT json_build_array('indexes', index_schema.nspname, indexed_relation.relname,
                        index_relation.relname,
                        regexp_replace(pg_catalog.pg_get_indexdef(index_relation.oid), '[[:space:]]+', ' ', 'g'))::text
  FROM pg_catalog.pg_index AS index_item
  JOIN pg_catalog.pg_class AS indexed_relation ON indexed_relation.oid = index_item.indrelid
  JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_item.indexrelid
  JOIN pg_catalog.pg_namespace AS index_schema ON index_schema.oid = indexed_relation.relnamespace
 WHERE index_schema.nspname <> 'information_schema'
   AND index_schema.nspname NOT LIKE 'pg_%'
 ORDER BY index_schema.nspname, indexed_relation.relname, index_relation.relname;

SELECT json_build_array('functions', function_schema.nspname,
                        pg_catalog.pg_get_function_identity_arguments(function_row.oid),
                        pg_catalog.pg_get_function_result(function_row.oid),
                        function_row.prosecdef,
                        CASE function_row.provolatile WHEN 'i' THEN 'immutable' WHEN 's' THEN 'stable' ELSE 'volatile' END,
                        COALESCE((SELECT array_agg(setting.value ORDER BY setting.ordinality)
                                    FROM pg_catalog.unnest(COALESCE(function_row.proconfig, ARRAY[]::text[]))
                                         WITH ORDINALITY AS setting(value, ordinality)
                                   WHERE setting.value LIKE 'search_path=%'), ARRAY[]::text[]),
                        encode(extensions.digest(convert_to(regexp_replace(pg_catalog.pg_get_functiondef(function_row.oid), '[[:space:]]+', ' ', 'g'), 'UTF8'), 'sha256'), 'hex'))::text
  FROM pg_catalog.pg_proc AS function_row
  JOIN pg_catalog.pg_namespace AS function_schema ON function_schema.oid = function_row.pronamespace
 WHERE function_schema.nspname NOT IN ('pg_catalog', 'information_schema', 'auth', 'storage', 'realtime', '_realtime', 'extensions', 'graphql', 'graphql_public', 'vault')
   AND function_schema.nspname NOT LIKE 'pg_%'
   AND function_row.prokind IN ('f', 'p')
ORDER BY convert_to(function_schema.nspname, 'UTF8'),
         convert_to(pg_catalog.pg_get_function_identity_arguments(function_row.oid), 'UTF8'),
         convert_to(pg_catalog.pg_get_function_result(function_row.oid), 'UTF8'),
         function_row.oid;

SELECT json_build_array('policies', policy_schema.nspname, policy_relation.relname, policy_row.polname,
                        CASE policy_row.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                             WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
                        COALESCE((SELECT array_agg(policy_role.rolname ORDER BY policy_role.rolname)
                                    FROM pg_catalog.unnest(policy_row.polroles) AS policy_role_id(role_oid)
                                    JOIN pg_catalog.pg_roles AS policy_role ON policy_role.oid = policy_role_id.role_oid), ARRAY[]::text[]),
                        regexp_replace(pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid), '[[:space:]]+', ' ', 'g'),
                        regexp_replace(pg_catalog.pg_get_expr(policy_row.polwithcheck, policy_row.polrelid), '[[:space:]]+', ' ', 'g'))::text
  FROM pg_catalog.pg_policy AS policy_row
  JOIN pg_catalog.pg_class AS policy_relation ON policy_relation.oid = policy_row.polrelid
  JOIN pg_catalog.pg_namespace AS policy_schema ON policy_schema.oid = policy_relation.relnamespace
 WHERE policy_schema.nspname <> 'information_schema'
   AND policy_schema.nspname NOT LIKE 'pg_%'
 ORDER BY policy_schema.nspname, policy_relation.relname, policy_row.polname;

SELECT json_build_array('triggers', trigger_schema.nspname, trigger_relation.relname, trigger_row.tgname,
                        CASE WHEN (trigger_row.tgtype & 2) <> 0 THEN 'BEFORE'
                             WHEN (trigger_row.tgtype & 64) <> 0 THEN 'INSTEAD OF' ELSE 'AFTER' END,
                        ARRAY_REMOVE(ARRAY[
                          CASE WHEN (trigger_row.tgtype & 4) <> 0 THEN 'INSERT' END,
                          CASE WHEN (trigger_row.tgtype & 8) <> 0 THEN 'DELETE' END,
                          CASE WHEN (trigger_row.tgtype & 16) <> 0 THEN 'UPDATE' END,
                          CASE WHEN (trigger_row.tgtype & 32) <> 0 THEN 'TRUNCATE' END
                        ], NULL),
                        regexp_replace(pg_catalog.pg_get_triggerdef(trigger_row.oid, true), '[[:space:]]+', ' ', 'g'))::text
  FROM pg_catalog.pg_trigger AS trigger_row
  JOIN pg_catalog.pg_class AS trigger_relation ON trigger_relation.oid = trigger_row.tgrelid
  JOIN pg_catalog.pg_namespace AS trigger_schema ON trigger_schema.oid = trigger_relation.relnamespace
 WHERE NOT trigger_row.tgisinternal
   AND trigger_schema.nspname <> 'information_schema'
   AND trigger_schema.nspname NOT LIKE 'pg_%'
 ORDER BY trigger_schema.nspname, trigger_relation.relname, trigger_row.tgname;

SELECT json_build_array('storage_buckets', bucket_row.id, bucket_row.name, bucket_row.public,
                        bucket_row.file_size_limit, bucket_row.allowed_mime_types)::text
  FROM storage.buckets AS bucket_row
 ORDER BY bucket_row.id, bucket_row.name;

SELECT json_build_array('storage_policies', policy_schema.nspname, policy_relation.relname, policy_row.polname,
                        CASE policy_row.polcmd WHEN 'r' THEN 'SELECT' WHEN 'a' THEN 'INSERT'
                             WHEN 'w' THEN 'UPDATE' WHEN 'd' THEN 'DELETE' ELSE 'ALL' END,
                        COALESCE((SELECT array_agg(policy_role.rolname ORDER BY policy_role.rolname)
                                    FROM pg_catalog.unnest(policy_row.polroles) AS policy_role_id(role_oid)
                                    JOIN pg_catalog.pg_roles AS policy_role ON policy_role.oid = policy_role_id.role_oid), ARRAY[]::text[]),
                        regexp_replace(pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid), '[[:space:]]+', ' ', 'g'),
                        regexp_replace(pg_catalog.pg_get_expr(policy_row.polwithcheck, policy_row.polrelid), '[[:space:]]+', ' ', 'g'))::text
  FROM pg_catalog.pg_policy AS policy_row
  JOIN pg_catalog.pg_class AS policy_relation ON policy_relation.oid = policy_row.polrelid
  JOIN pg_catalog.pg_namespace AS policy_schema ON policy_schema.oid = policy_relation.relnamespace
 WHERE policy_schema.nspname = 'storage'
 ORDER BY policy_schema.nspname, policy_relation.relname, policy_row.polname;

SELECT json_build_array('realtime_membership', publication_row.pubname, publication_table.schemaname,
                        publication_table.tablename)::text
  FROM pg_catalog.pg_publication_tables AS publication_table
  JOIN pg_catalog.pg_publication AS publication_row ON publication_row.pubname = publication_table.pubname
 ORDER BY publication_table.pubname, publication_table.schemaname, publication_table.tablename;

-- Seed sections.  Auth UUIDs are intentionally represented by the fixed
-- logical ID; the independent checks above reject every extra/unknown identity.
SELECT json_build_array('auth_users', 'nightly-ci', user_row.email, user_row.aud,
                        user_row.role, (user_row.email_confirmed_at IS NOT NULL))::text
  FROM auth.users AS user_row
 WHERE user_row.email = 'nightly-ci@local.invalid'
 ORDER BY user_row.email;

SELECT json_build_array('auth_identities', 'nightly-ci', identity_row.provider,
                        identity_row.identity_data ->> 'email')::text
  FROM auth.identities AS identity_row
  JOIN auth.users AS user_row ON user_row.id = identity_row.user_id
 WHERE user_row.email = 'nightly-ci@local.invalid'
 ORDER BY identity_row.provider, identity_row.identity_data ->> 'email';

SELECT json_build_array('profiles', 'nightly-ci', profile_row.username, profile_row.nickname,
                        profile_row.role, profile_row.email,
                        to_char(profile_row.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))::text
  FROM public.profiles AS profile_row
 ORDER BY profile_row.username, profile_row.email;

SELECT json_build_array('restaurants', restaurant_row.id::text, restaurant_row.trace_id,
                        restaurant_row.approved_name, restaurant_row.status, restaurant_row.categories,
                        to_char(restaurant_row.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                        to_char(restaurant_row.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))::text
  FROM public.restaurants AS restaurant_row
 ORDER BY restaurant_row.id;

SELECT json_build_array('announcements', announcement_row.id::text, announcement_row.title,
                        announcement_row.content, announcement_row.is_active,
                        announcement_row.show_on_banner, announcement_row.priority,
                        to_char(announcement_row.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
                        to_char(announcement_row.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))::text
  FROM public.announcements AS announcement_row
 ORDER BY announcement_row.id;

SELECT json_build_array('seed_buckets', bucket_row.id, bucket_row.name, bucket_row.public)::text
  FROM storage.buckets AS bucket_row
 ORDER BY bucket_row.id, bucket_row.name;

SELECT json_build_array('seed_realtime', publication_table.pubname, publication_table.schemaname,
                        publication_table.tablename)::text
  FROM pg_catalog.pg_publication_tables AS publication_table
 WHERE publication_table.pubname = 'supabase_realtime'
   AND publication_table.schemaname = 'public'
   AND publication_table.tablename = 'profiles'
 ORDER BY publication_table.pubname, publication_table.schemaname, publication_table.tablename;

COMMIT;
