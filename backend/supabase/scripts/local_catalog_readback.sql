-- Canonical, read-only local Supabase catalog and seed readback (receipt-v1).
-- Each result row is one compact JSON array: [section, field_1, ... field_n].
-- No raw rows, function bodies, credentials, secrets, or provider endpoints are emitted.
\set ON_ERROR_STOP on
\pset format unaligned
\pset tuples_only on
\pset footer off
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path = public, extensions;

-- The seed contract is deliberately fail-closed.  These checks run inside the
-- read-only transaction and therefore cannot alter the database.
DO $$
DECLARE
  user_count bigint;
  identity_count bigint;
  profile_count bigint;
  admin_role_count bigint;
  account_status_count bigint;
  privacy_policy_fixture_count bigint;
  privacy_age_profile_count bigint;
  youtube_channel_snapshot_count bigint;
  auth_api_count bigint;
  bucket_count bigint;
  publication_count bigint;
  realtime_membership_count bigint;
  platform_realtime_membership_count bigint;
  public_read_policy_count bigint;
  caller_bound_policy_count bigint;
  policy_count bigint;
  policy_names text[];
  policy_record record;
  policy_using text;
  policy_check text;
  expected_bucket text;
  release_function regprocedure;
  public_read_helper regprocedure;
  legacy_admin_helper regprocedure;
  privacy_incident_guard regprocedure;
  public_read_admin_expression constant text :=
    '( SELECT is_current_user_active_admin() AS is_current_user_active_admin)';
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

  SELECT count(*) INTO admin_role_count FROM public.user_roles;
  IF admin_role_count <> 1 OR NOT EXISTS (
    SELECT 1
      FROM public.user_roles AS role_row
      JOIN auth.users AS user_row ON user_row.id = role_row.user_id
     WHERE user_row.email = 'nightly-ci@local.invalid'
       AND role_row.role::text = 'admin'
       AND role_row.created_at = '2026-01-01T00:00:00Z'::timestamptz
  ) THEN
    RAISE EXCEPTION 'receipt_unexpected_admin_role';
  END IF;

  SELECT count(*) INTO account_status_count FROM public.user_account_status;
  IF account_status_count <> 1 OR NOT EXISTS (
    SELECT 1
      FROM public.user_account_status AS status_row
      JOIN auth.users AS user_row ON user_row.id = status_row.user_id
     WHERE user_row.email = 'nightly-ci@local.invalid'
       AND status_row.account_status = 'active'
       AND status_row.disabled_at IS NULL
       AND status_row.updated_at = '2026-01-01T00:00:00Z'::timestamptz
  ) THEN
    RAISE EXCEPTION 'receipt_unexpected_account_status';
  END IF;

  SELECT count(*) INTO privacy_policy_fixture_count
    FROM privacy_retention.privacy_policy_versions;
  IF privacy_policy_fixture_count <> 1 OR NOT EXISTS (
    SELECT 1
      FROM privacy_retention.privacy_policy_versions AS policy_row
     WHERE policy_row.id = '00000000-0000-4000-8000-000000000301'::uuid
       AND policy_row.version = '2026-08-04.1'
       AND policy_row.locale = 'ko-KR'
       AND policy_row.status = 'published'
       AND policy_row.content_sha256 = '6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b'
       AND policy_row.effective_at = '2026-01-01T00:00:00Z'::timestamptz
       AND policy_row.published_at = '2026-01-01T00:00:00Z'::timestamptz
       AND policy_row.supersedes_id IS NULL
       AND policy_row.operator_approval_ref = 'LOCAL_TEST_ONLY:NOT_PRODUCTION:nightly-ci:privacy-policy-fixture-v1'
       AND policy_row.created_at = '2026-01-01T00:00:00Z'::timestamptz
  ) THEN
    RAISE EXCEPTION 'receipt_unexpected_privacy_policy_fixture';
  END IF;

  SELECT count(*) INTO privacy_age_profile_count
    FROM privacy_retention.privacy_age_profiles;
  IF privacy_age_profile_count <> 1 OR NOT EXISTS (
    SELECT 1
      FROM privacy_retention.privacy_age_profiles AS age_row
      JOIN auth.users AS user_row ON user_row.id = age_row.user_id
      JOIN privacy_retention.privacy_policy_versions AS policy_row
        ON policy_row.id = age_row.policy_version_id
     WHERE user_row.email = 'nightly-ci@local.invalid'
       AND age_row.age_band = 'age_14_plus'
       AND age_row.attested_at = '2026-01-01T00:00:00Z'::timestamptz
       AND age_row.method = 'self_attestation'
       AND age_row.status = 'eligible'
       AND age_row.policy_version_id = '00000000-0000-4000-8000-000000000301'::uuid
       AND age_row.updated_at = '2026-01-01T00:00:00Z'::timestamptz
       AND policy_row.version = '2026-08-04.1'
       AND policy_row.operator_approval_ref = 'LOCAL_TEST_ONLY:NOT_PRODUCTION:nightly-ci:privacy-policy-fixture-v1'
  ) THEN
    RAISE EXCEPTION 'receipt_unexpected_privacy_age_profile';
  END IF;

  SELECT count(*) INTO youtube_channel_snapshot_count
    FROM public.youtube_channel_kpi_snapshots;
  IF youtube_channel_snapshot_count <> 1 OR NOT EXISTS (
    SELECT 1
      FROM public.youtube_channel_kpi_snapshots AS channel_row
     WHERE channel_row.id = '00000000-0000-4000-8000-000000000401'::uuid
       AND channel_row.channel_id = 'local-nightly-channel'
       AND channel_row.channel_title = '[LOCAL TEST] Nightly channel fixture'
       AND channel_row.channel_handle = '@local-nightly'
       AND channel_row.subscriber_count = 1000
       AND channel_row.view_count = 100000
       AND channel_row.video_count = 100
       AND channel_row.hidden_subscriber_count = false
       AND channel_row.previous_bucket_started_at IS NULL
       AND channel_row.subscriber_delta = 0
       AND channel_row.view_delta = 0
       AND channel_row.video_delta = 0
       AND channel_row.bucket_started_at = '2026-01-01T00:00:00Z'::timestamptz
       AND channel_row.fetched_at = '2026-01-01T00:00:00Z'::timestamptz
       AND channel_row.source = 'LOCAL_TEST_ONLY:NOT_PRODUCTION:nightly-ci:youtube-channel-snapshot-v1'
  ) THEN
    RAISE EXCEPTION 'receipt_unexpected_youtube_channel_snapshot';
  END IF;

  SELECT count(*) INTO bucket_count FROM storage.buckets;
  IF bucket_count <> 7 OR NOT EXISTS (
    SELECT 1 FROM storage.buckets
     WHERE id = 'avatars' AND name = 'avatars' AND public = true
       AND file_size_limit = 52428800
       AND allowed_mime_types = ARRAY['image/*']::text[]
  ) OR NOT EXISTS (
    SELECT 1 FROM storage.buckets
     WHERE id = 'profile-avatars' AND name = 'profile-avatars' AND public = true
       AND file_size_limit = 2097152
       AND allowed_mime_types = ARRAY['image/*']::text[]
  ) OR NOT EXISTS (
    SELECT 1 FROM storage.buckets
     WHERE id = 'review-photos' AND name = 'review-photos' AND public = true
       AND file_size_limit = 5242880
       AND allowed_mime_types = ARRAY['image/*']::text[]
  ) OR NOT EXISTS (
    SELECT 1 FROM storage.buckets
     WHERE id = 'ad-banner-images' AND name = 'ad-banner-images' AND public = true
       AND file_size_limit = 52428800
       AND allowed_mime_types = ARRAY['image/*', 'video/*']::text[]
  ) OR NOT EXISTS (
    SELECT 1 FROM storage.buckets
     WHERE id = 'youtube-thumbnail-releases'
       AND name = 'youtube-thumbnail-releases' AND public = false
       AND file_size_limit = 10485760
       AND allowed_mime_types = ARRAY['image/png']::text[]
  ) OR NOT EXISTS (
    SELECT 1 FROM storage.buckets
     WHERE id = 'storyboard-private'
       AND name = 'storyboard-private' AND public = false
       AND file_size_limit = 12582912
       AND allowed_mime_types = ARRAY['image/png', 'image/jpeg', 'image/webp']::text[]
  ) OR NOT EXISTS (
    SELECT 1 FROM storage.buckets WHERE id='review-verifications' AND name='review-verifications'
      AND public=false AND file_size_limit=5242880
      AND allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp','image/avif']::text[]
  ) THEN
    RAISE EXCEPTION 'receipt_unexpected_storage_bucket';
  END IF;

  SELECT count(*) INTO publication_count
    FROM pg_catalog.pg_publication;
  IF publication_count <> 2 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_publication AS publication_row
      JOIN pg_catalog.pg_roles AS owner_role
        ON owner_role.oid = publication_row.pubowner
     WHERE NOT (
       (publication_row.pubname = 'supabase_realtime'
         AND owner_role.rolname = 'postgres')
       OR
       (publication_row.pubname = 'supabase_realtime_messages_publication'
         AND owner_role.rolname = 'supabase_admin')
     )
  ) THEN
    RAISE EXCEPTION 'receipt_unexpected_realtime_publication';
  END IF;

  SELECT count(*) INTO realtime_membership_count
    FROM pg_catalog.pg_publication_tables
   WHERE pubname = 'supabase_realtime'
     AND schemaname = 'public';
  IF realtime_membership_count <> 4 OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND (
         schemaname <> 'public'
         OR tablename <> ALL (ARRAY[
           'notifications', 'profiles', 'review_likes', 'reviews'
         ]::text[])
       )
  ) THEN
    RAISE EXCEPTION 'receipt_unexpected_realtime_membership';
  END IF;

  -- Realtime owns a rolling, date-partitioned internal publication. Keep its
  -- rows out of the application receipt while proving that the exact internal
  -- publication remains bounded to the pinned platform's message partitions.
  SELECT count(*) INTO platform_realtime_membership_count
    FROM pg_catalog.pg_publication_tables
   WHERE pubname = 'supabase_realtime_messages_publication';
  IF platform_realtime_membership_count < 1
     OR platform_realtime_membership_count > 7
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_publication_tables
        WHERE pubname = 'supabase_realtime_messages_publication'
          AND (
            schemaname <> 'realtime'
            OR tablename !~ '^messages_[0-9]{4}_[0-9]{2}_[0-9]{2}$'
          )
     ) THEN
    RAISE EXCEPTION 'receipt_unexpected_realtime_platform_publication';
  END IF;

  public_read_helper := pg_catalog.to_regprocedure(
    'public.is_current_user_active_admin()'
  );
  legacy_admin_helper := pg_catalog.to_regprocedure('public.is_user_admin(uuid)');
  IF public_read_helper IS NULL
     OR legacy_admin_helper IS NULL
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', public_read_helper, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('anon', public_read_helper, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', public_read_helper, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', legacy_admin_helper, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'authenticated', legacy_admin_helper, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', legacy_admin_helper, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'privacy_workflow_owner', legacy_admin_helper, 'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS function_row
        WHERE function_row.oid = public_read_helper
          AND (
            function_row.pronargs <> 0
            OR function_row.prorettype <> 'boolean'::regtype
            OR function_row.prosecdef IS TRUE
            OR function_row.provolatile <> 's'
            OR function_row.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
          )
     ) THEN
    RAISE EXCEPTION 'receipt_unexpected_public_read_helper';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation_row
     WHERE relation_row.oid IN (
       'public.announcements'::regclass,
       'public.ad_banners'::regclass
     )
       AND relation_row.relrowsecurity IS NOT TRUE
  )
     OR NOT pg_catalog.has_table_privilege(
       'anon', 'public.announcements', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'anon', 'public.announcements', 'INSERT,UPDATE,DELETE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'authenticated', 'public.announcements', 'SELECT,INSERT,UPDATE,DELETE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.announcements', 'SELECT,INSERT,UPDATE,DELETE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'anon', 'public.ad_banners', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'anon', 'public.ad_banners', 'INSERT,UPDATE,DELETE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'authenticated', 'public.ad_banners', 'SELECT,INSERT,UPDATE,DELETE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.ad_banners', 'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION 'receipt_unexpected_public_read_table_grant';
  END IF;

  SELECT count(*) INTO public_read_policy_count
    FROM pg_catalog.pg_policy AS public_read_policy
    JOIN pg_catalog.pg_class AS public_read_relation
      ON public_read_relation.oid = public_read_policy.polrelid
    JOIN pg_catalog.pg_namespace AS public_read_schema
      ON public_read_schema.oid = public_read_relation.relnamespace
   WHERE public_read_schema.nspname = 'public'
     AND public_read_relation.relname IN ('announcements', 'ad_banners');
  IF public_read_policy_count <> 10 THEN
    RAISE EXCEPTION 'receipt_unexpected_public_read_policy';
  END IF;

  FOR policy_record IN
    SELECT
      public_read_policy.*,
      public_read_relation.relname AS relation_name,
      COALESCE((
        SELECT array_agg(public_read_role.rolname ORDER BY public_read_role.rolname)::text[]
          FROM pg_catalog.unnest(public_read_policy.polroles) AS public_read_role_id(role_oid)
          JOIN pg_catalog.pg_roles AS public_read_role
            ON public_read_role.oid = public_read_role_id.role_oid
      ), ARRAY[]::text[]) AS role_names,
      (
        SELECT count(*)
          FROM pg_catalog.pg_depend AS dependency
         WHERE dependency.classid = 'pg_policy'::regclass
           AND dependency.objid = public_read_policy.oid
           AND dependency.refclassid = 'pg_proc'::regclass
           AND dependency.refobjid = public_read_helper
      ) AS helper_dependency_count,
      (
        SELECT count(*)
          FROM pg_catalog.pg_depend AS dependency
         WHERE dependency.classid = 'pg_policy'::regclass
           AND dependency.objid = public_read_policy.oid
           AND dependency.refclassid = 'pg_proc'::regclass
           AND dependency.refobjid = legacy_admin_helper
      ) AS legacy_dependency_count
      FROM pg_catalog.pg_policy AS public_read_policy
      JOIN pg_catalog.pg_class AS public_read_relation
        ON public_read_relation.oid = public_read_policy.polrelid
      JOIN pg_catalog.pg_namespace AS public_read_schema
        ON public_read_schema.oid = public_read_relation.relnamespace
     WHERE public_read_schema.nspname = 'public'
       AND public_read_relation.relname IN ('announcements', 'ad_banners')
     ORDER BY public_read_relation.relname, public_read_policy.polname
  LOOP
    policy_using := COALESCE(pg_catalog.pg_get_expr(
      policy_record.polqual, policy_record.polrelid
    ), '');
    policy_check := COALESCE(pg_catalog.pg_get_expr(
      policy_record.polwithcheck, policy_record.polrelid
    ), '');

    IF policy_record.polpermissive IS NOT TRUE
       OR policy_record.legacy_dependency_count <> 0 THEN
      RAISE EXCEPTION 'receipt_unexpected_public_read_policy';
    END IF;

    IF policy_record.polname =
       'tzudong_' || policy_record.relation_name || '_select_active' THEN
      IF policy_record.polcmd <> 'r'
         OR policy_record.role_names IS DISTINCT FROM ARRAY['anon', 'authenticated']::text[]
         OR policy_using <> '(is_active = true)'
         OR policy_check <> ''
         OR policy_record.helper_dependency_count <> 0 THEN
        RAISE EXCEPTION 'receipt_unexpected_public_read_policy';
      END IF;
    ELSIF policy_record.polname =
          'tzudong_' || policy_record.relation_name || '_select_admin' THEN
      IF policy_record.polcmd <> 'r'
         OR policy_record.role_names IS DISTINCT FROM ARRAY['authenticated']::text[]
         OR policy_using <> public_read_admin_expression
         OR policy_check <> ''
         OR policy_record.helper_dependency_count <> 1 THEN
        RAISE EXCEPTION 'receipt_unexpected_public_read_policy';
      END IF;
    ELSIF policy_record.polname =
          'tzudong_' || policy_record.relation_name || '_insert_admin' THEN
      IF policy_record.polcmd <> 'a'
         OR policy_record.role_names IS DISTINCT FROM ARRAY['authenticated']::text[]
         OR policy_using <> ''
         OR policy_check <> public_read_admin_expression
         OR policy_record.helper_dependency_count <> 1 THEN
        RAISE EXCEPTION 'receipt_unexpected_public_read_policy';
      END IF;
    ELSIF policy_record.polname =
          'tzudong_' || policy_record.relation_name || '_update_admin' THEN
      IF policy_record.polcmd <> 'w'
         OR policy_record.role_names IS DISTINCT FROM ARRAY['authenticated']::text[]
         OR policy_using <> public_read_admin_expression
         OR policy_check <> public_read_admin_expression
         OR policy_record.helper_dependency_count <> 2 THEN
        RAISE EXCEPTION 'receipt_unexpected_public_read_policy';
      END IF;
    ELSIF policy_record.polname =
          'tzudong_' || policy_record.relation_name || '_delete_admin' THEN
      IF policy_record.polcmd <> 'd'
         OR policy_record.role_names IS DISTINCT FROM ARRAY['authenticated']::text[]
         OR policy_using <> public_read_admin_expression
         OR policy_check <> ''
         OR policy_record.helper_dependency_count <> 1 THEN
        RAISE EXCEPTION 'receipt_unexpected_public_read_policy';
      END IF;
    ELSE
      RAISE EXCEPTION 'receipt_unexpected_public_read_policy';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_depend AS dependency
     WHERE dependency.classid = 'pg_policy'::regclass
       AND dependency.refclassid = 'pg_proc'::regclass
       AND dependency.refobjid = legacy_admin_helper
  ) THEN
    RAISE EXCEPTION 'receipt_legacy_admin_policy_dependency';
  END IF;

  SELECT count(DISTINCT dependency.objid) INTO caller_bound_policy_count
    FROM pg_catalog.pg_depend AS dependency
   WHERE dependency.classid = 'pg_policy'::regclass
     AND dependency.refclassid = 'pg_proc'::regclass
     AND dependency.refobjid = public_read_helper;
  IF caller_bound_policy_count <> 26 THEN
    RAISE EXCEPTION 'receipt_caller_bound_admin_policy_count';
  END IF;

  IF EXISTS (
    WITH expected(
      relation_name, policy_name, command, helper_dependency_count,
      uid_dependency_count
    ) AS (
      VALUES
        ('restaurant_refresh_candidates', 'restaurant_refresh_candidates_admin_insert', 'a'::"char", 1, 0),
        ('restaurant_refresh_candidates', 'restaurant_refresh_candidates_admin_select', 'r'::"char", 1, 0),
        ('restaurant_refresh_candidates', 'restaurant_refresh_candidates_admin_update', 'w'::"char", 2, 0),
        ('restaurant_refresh_runs', 'restaurant_refresh_runs_admin_insert', 'a'::"char", 1, 0),
        ('restaurant_refresh_runs', 'restaurant_refresh_runs_admin_select', 'r'::"char", 1, 0),
        ('restaurant_refresh_runs', 'restaurant_refresh_runs_admin_update', 'w'::"char", 2, 0),
        ('restaurant_request_review_audit', 'Admins can view request review audit', 'r'::"char", 1, 0),
        ('restaurant_requests', 'Admins can update requests', 'w'::"char", 2, 0),
        ('restaurant_requests', 'Admins can view all requests', 'r'::"char", 1, 0),
        ('restaurant_requests', 'Restaurant requests select policy', 'r'::"char", 1, 1),
        ('restaurant_submission_items', 'Admins can delete submission items', 'd'::"char", 1, 0),
        ('restaurant_submission_items', 'Admins can update submission items', 'w'::"char", 1, 0),
        ('restaurant_submission_items', 'Submission items insert policy', 'a'::"char", 1, 1),
        ('restaurant_submission_items', 'Submission items select policy', 'r'::"char", 1, 1),
        ('restaurant_submissions', 'Admins can update all submissions', 'w'::"char", 1, 0),
        ('restaurant_submissions', 'Restaurant submissions select policy', 'r'::"char", 1, 1),
        ('restaurants', 'restaurants_authenticated_admin_update', 'w'::"char", 2, 0),
        ('short_urls', 'Admins can delete short URLs', 'd'::"char", 1, 0)
    ), actual AS (
      SELECT
        relation_row.relname AS relation_name,
        policy_row.polname AS policy_name,
        policy_row.polcmd AS command,
        COALESCE((
          SELECT array_agg(role_row.rolname ORDER BY role_row.rolname)::text[]
            FROM pg_catalog.unnest(policy_row.polroles) AS role_id(oid)
            JOIN pg_catalog.pg_roles AS role_row ON role_row.oid = role_id.oid
        ), ARRAY[]::text[]) AS role_names,
        (
          SELECT count(*)
            FROM pg_catalog.pg_depend AS dependency
           WHERE dependency.classid = 'pg_policy'::regclass
             AND dependency.objid = policy_row.oid
             AND dependency.refclassid = 'pg_proc'::regclass
             AND dependency.refobjid = public_read_helper
        ) AS helper_dependency_count,
        (
          SELECT count(*)
            FROM pg_catalog.pg_depend AS dependency
           WHERE dependency.classid = 'pg_policy'::regclass
             AND dependency.objid = policy_row.oid
             AND dependency.refclassid = 'pg_proc'::regclass
             AND dependency.refobjid = 'auth.uid()'::regprocedure
        ) AS uid_dependency_count
        FROM pg_catalog.pg_policy AS policy_row
        JOIN pg_catalog.pg_class AS relation_row
          ON relation_row.oid = policy_row.polrelid
        JOIN pg_catalog.pg_namespace AS schema_row
          ON schema_row.oid = relation_row.relnamespace
       WHERE schema_row.nspname = 'public'
    )
    SELECT 1
      FROM expected
      LEFT JOIN actual USING (relation_name, policy_name)
     WHERE actual.policy_name IS NULL
        OR actual.command <> expected.command
        OR actual.role_names IS DISTINCT FROM ARRAY['authenticated']::text[]
        OR actual.helper_dependency_count <> expected.helper_dependency_count
        OR actual.uid_dependency_count <> expected.uid_dependency_count
  ) THEN
    RAISE EXCEPTION 'receipt_caller_bound_admin_policy_contract';
  END IF;

  privacy_incident_guard := pg_catalog.to_regprocedure(
    'public.privacy_incident_require_admin(uuid)'
  );
  IF privacy_incident_guard IS NULL OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS function_row
     WHERE function_row.oid = privacy_incident_guard
       AND (
         pg_catalog.pg_get_userbyid(function_row.proowner) <>
           'privacy_workflow_owner'
         OR function_row.prosecdef IS NOT TRUE
         OR function_row.provolatile <> 'v'
         OR function_row.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
         OR position(
           'privacy_incident_service_role_required'
           IN pg_catalog.pg_get_functiondef(function_row.oid)
         ) = 0
         OR position(
           'privacy_incident_privacy_admin_required'
           IN pg_catalog.pg_get_functiondef(function_row.oid)
         ) = 0
         OR position(
           'request.jwt.claim.role'
           IN pg_catalog.pg_get_functiondef(function_row.oid)
         ) = 0
         OR position('auth.role()' IN pg_catalog.pg_get_functiondef(function_row.oid)) <> 0
       )
  )
     OR pg_catalog.has_function_privilege('anon', privacy_incident_guard, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'authenticated', privacy_incident_guard, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', privacy_incident_guard, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'privacy_workflow_owner', privacy_incident_guard, 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'receipt_privacy_incident_guard_contract';
  END IF;

  IF EXISTS (
    WITH expected(signature, result_type, volatility) AS (
      VALUES
        (
          'public.read_admin_user_management_metadata(uuid[])',
          'TABLE(user_id uuid, username text, nickname text, avatar_url text, profile_role text, profile_created_at timestamp with time zone, profile_updated_at timestamp with time zone, is_admin boolean, account_status text)',
          's'::"char"
        ),
        (
          'public.read_admin_user_ids_for_management()',
          'TABLE(user_id uuid)',
          's'::"char"
        ),
        (
          'public.read_admin_user_audit_events(integer)',
          'TABLE(id uuid, actor_user_id uuid, target_user_id uuid, action text, reason text, status text, correlation_id uuid, applied_at timestamp with time zone, error_code text, created_at timestamp with time zone, audit_counts jsonb, audit_flags jsonb)',
          's'::"char"
        ),
        (
          'public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)',
          'uuid',
          'v'::"char"
        )
    ), actual AS (
      SELECT
        expected.signature,
        expected.result_type,
        expected.volatility,
        resolved.function_oid,
        pg_catalog.pg_get_function_result(function_row.oid) AS actual_result,
        function_row.provolatile AS actual_volatility,
        function_row.prosecdef,
        function_row.proconfig,
        pg_catalog.pg_get_userbyid(function_row.proowner) AS owner_name
        FROM expected
        CROSS JOIN LATERAL pg_catalog.to_regprocedure(expected.signature)
          AS resolved(function_oid)
        LEFT JOIN pg_catalog.pg_proc AS function_row
          ON function_row.oid = resolved.function_oid
    )
    SELECT 1
      FROM actual
     WHERE actual.function_oid IS NULL
        OR actual.actual_result <> actual.result_type
        OR actual.actual_volatility <> actual.volatility
        OR actual.prosecdef IS NOT TRUE
        OR actual.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
        OR actual.owner_name <> 'privacy_workflow_owner'
        OR NOT pg_catalog.has_function_privilege(
          'service_role', actual.function_oid, 'EXECUTE'
        )
        OR pg_catalog.has_function_privilege(
          'anon', actual.function_oid, 'EXECUTE'
        )
        OR pg_catalog.has_function_privilege(
          'authenticated', actual.function_oid, 'EXECUTE'
        )
        OR NOT EXISTS (
          SELECT 1
            FROM privacy_retention.g014_public_rpc_allowlist AS allowed
           WHERE allowed.source_signature = actual.signature
             AND allowed.grantee = 'service_role'
        )
  )
     OR pg_catalog.has_table_privilege('service_role', 'public.profiles', 'SELECT,INSERT,UPDATE,DELETE')
     OR pg_catalog.has_table_privilege('service_role', 'public.user_roles', 'SELECT,INSERT,UPDATE,DELETE')
     OR pg_catalog.has_table_privilege('service_role', 'public.user_account_status', 'SELECT,INSERT,UPDATE,DELETE')
     OR pg_catalog.has_table_privilege('service_role', 'public.admin_audit_events', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'receipt_admin_data_boundary_contract';
  END IF;

  SELECT count(*) INTO policy_count
    FROM pg_catalog.pg_policy AS policy_row
    JOIN pg_catalog.pg_class AS policy_relation ON policy_relation.oid = policy_row.polrelid
    JOIN pg_catalog.pg_namespace AS policy_schema ON policy_schema.oid = policy_relation.relnamespace
   WHERE policy_schema.nspname = 'storage'
     AND policy_relation.relname = 'objects';
  SELECT array_agg(policy_row.polname ORDER BY policy_row.polname), count(*)
    INTO policy_names, policy_count
    FROM pg_catalog.pg_policy AS policy_row
    JOIN pg_catalog.pg_class AS policy_relation ON policy_relation.oid = policy_row.polrelid
    JOIN pg_catalog.pg_namespace AS policy_schema ON policy_schema.oid = policy_relation.relnamespace
   WHERE policy_schema.nspname = 'storage'
     AND policy_relation.relname = 'objects';
  IF policy_count <> 20 OR policy_names IS DISTINCT FROM ARRAY[
    'local_nightly_avatar_insert',
    'local_nightly_avatar_read',
    'review_media_safe_delete',
    'review_media_workflow_read',
    'review_photos_food_insert',
    'review_photos_food_update',
    'review_verifications_owner_delete',
    'review_verifications_owner_insert',
    'review_verifications_owner_read',
    'review_verifications_safe_delete',
    'tzudong_ad_banner_delete_admin',
    'tzudong_ad_banner_insert_admin',
    'tzudong_ad_banner_update_admin',
    'tzudong_profile_avatar_delete_own',
    'tzudong_profile_avatar_insert_own',
    'tzudong_profile_avatar_update_own',
    'tzudong_public_media_read',
    'tzudong_review_photo_delete_own',
    'tzudong_review_photo_insert_own',
    'tzudong_review_photo_update_own'
  ]::text[] THEN
    RAISE EXCEPTION 'receipt_unexpected_storage_policy';
  END IF;

  FOR policy_record IN
    SELECT policy_row.*,
           COALESCE((
             SELECT array_agg(policy_role.rolname ORDER BY policy_role.rolname)::text[]
               FROM pg_catalog.unnest(policy_row.polroles) AS policy_role_id(role_oid)
               JOIN pg_catalog.pg_roles AS policy_role ON policy_role.oid = policy_role_id.role_oid
           ), ARRAY[]::text[]) AS role_names,
           (
             SELECT count(*)
               FROM pg_catalog.pg_depend AS dependency
              WHERE dependency.classid = 'pg_policy'::regclass
                AND dependency.objid = policy_row.oid
                AND dependency.refclassid = 'pg_proc'::regclass
                AND dependency.refobjid = 'auth.uid()'::regprocedure
           ) AS uid_dependency_count
      FROM pg_catalog.pg_policy AS policy_row
      JOIN pg_catalog.pg_class AS policy_relation ON policy_relation.oid = policy_row.polrelid
      JOIN pg_catalog.pg_namespace AS policy_schema ON policy_schema.oid = policy_relation.relnamespace
     WHERE policy_schema.nspname = 'storage'
       AND policy_relation.relname = 'objects'
  LOOP
    policy_using := COALESCE(pg_catalog.pg_get_expr(
      policy_record.polqual, policy_record.polrelid
    ), '');
    policy_check := COALESCE(pg_catalog.pg_get_expr(
      policy_record.polwithcheck, policy_record.polrelid
    ), '');

    IF policy_record.polname = ANY(ARRAY['review_media_safe_delete','review_media_workflow_read','review_photos_food_insert','review_photos_food_update','review_verifications_owner_delete','review_verifications_owner_insert','review_verifications_owner_read','review_verifications_safe_delete']) THEN
      CONTINUE; -- Checked by review_media_catalog_readback below.
    END IF;

    IF policy_record.polpermissive IS NOT TRUE THEN
      RAISE EXCEPTION 'receipt_unexpected_storage_policy';
    END IF;

    IF policy_record.polname = 'local_nightly_avatar_read' THEN
      IF policy_record.polcmd <> 'r'
         OR policy_record.role_names IS DISTINCT FROM ARRAY['anon', 'authenticated']::text[]
         OR policy_using <> '(bucket_id = ''avatars''::text)'
         OR policy_check <> '' THEN
        RAISE EXCEPTION 'receipt_unexpected_storage_policy';
      END IF;
    ELSIF policy_record.polname = 'local_nightly_avatar_insert' THEN
      IF policy_record.polcmd <> 'a'
         OR policy_record.role_names IS DISTINCT FROM ARRAY['authenticated']::text[]
         OR policy_using <> ''
         OR policy_check <> '(bucket_id = ''avatars''::text)' THEN
        RAISE EXCEPTION 'receipt_unexpected_storage_policy';
      END IF;
    ELSIF policy_record.polname = 'tzudong_public_media_read' THEN
      IF policy_record.polcmd <> 'r'
         OR policy_record.role_names IS DISTINCT FROM ARRAY['anon', 'authenticated']::text[]
         OR policy_check <> ''
         OR position('profile-avatars' IN policy_using) = 0
         OR position('review-photos' IN policy_using) = 0
         OR position('ad-banner-images' IN policy_using) = 0 THEN
        RAISE EXCEPTION 'receipt_unexpected_storage_policy';
      END IF;
    ELSE
      expected_bucket := CASE
        WHEN policy_record.polname LIKE 'tzudong_profile_avatar_%' THEN 'profile-avatars'
        WHEN policy_record.polname LIKE 'tzudong_review_photo_%' THEN 'review-photos'
        WHEN policy_record.polname LIKE 'tzudong_ad_banner_%' THEN 'ad-banner-images'
        ELSE NULL
      END;
      IF expected_bucket IS NULL
         OR policy_record.role_names IS DISTINCT FROM ARRAY['authenticated']::text[]
         OR position(expected_bucket IN policy_using || policy_check) = 0
         OR position('foldername' IN policy_using || policy_check) = 0
         OR policy_record.uid_dependency_count <> (CASE
           WHEN policy_record.polcmd = 'w' THEN 2
           ELSE 1
         END)
         OR (
           policy_record.polname LIKE 'tzudong_ad_banner_%'
           AND (
             position('user_roles' IN policy_using || policy_check) = 0
             OR position('user_account_status' IN policy_using || policy_check) = 0
             OR position('admin' IN policy_using || policy_check) = 0
             OR position('active' IN policy_using || policy_check) = 0
           )
         )
         OR (
           policy_record.polname LIKE '%_insert_%'
           AND (policy_record.polcmd <> 'a' OR policy_using <> '' OR policy_check = '')
         )
         OR (
           policy_record.polname LIKE '%_update_%'
           AND (policy_record.polcmd <> 'w' OR policy_using = '' OR policy_check = '')
         )
         OR (
           policy_record.polname LIKE '%_delete_%'
           AND (policy_record.polcmd <> 'd' OR policy_using = '' OR policy_check <> '')
         ) THEN
        RAISE EXCEPTION 'receipt_unexpected_storage_policy';
      END IF;
    END IF;
  END LOOP;

  IF pg_catalog.to_regclass('public.youtube_channel_kpi_snapshots') IS NULL
     OR pg_catalog.to_regclass('public.youtube_video_kpi_snapshots') IS NULL
     OR pg_catalog.to_regclass('public.youtube_thumbnail_releases') IS NULL
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_class AS relation_row
        WHERE relation_row.oid IN (
          'public.youtube_channel_kpi_snapshots'::regclass,
          'public.youtube_video_kpi_snapshots'::regclass,
          'public.youtube_thumbnail_releases'::regclass
        )
          AND relation_row.relrowsecurity IS NOT TRUE
     )
     OR pg_catalog.has_table_privilege('anon', 'public.youtube_channel_kpi_snapshots', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.youtube_channel_kpi_snapshots', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.youtube_video_kpi_snapshots', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.youtube_video_kpi_snapshots', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.youtube_thumbnail_releases', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.youtube_thumbnail_releases', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.youtube_channel_kpi_snapshots', 'SELECT,INSERT,UPDATE,DELETE')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.youtube_video_kpi_snapshots', 'SELECT,INSERT,UPDATE,DELETE')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.youtube_thumbnail_releases', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'receipt_unexpected_youtube_runtime_contract';
  END IF;

  release_function := pg_catalog.to_regprocedure(
    'public.publish_youtube_thumbnail_release(uuid,text,text,text,text,text,text,text,text,numeric,jsonb,jsonb,jsonb,jsonb,uuid,timestamp with time zone)'
  );
  IF release_function IS NULL
     OR NOT pg_catalog.has_function_privilege('service_role', release_function, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', release_function, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', release_function, 'EXECUTE')
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_proc AS function_row
       WHERE function_row.oid = release_function
         AND (
           function_row.prosecdef IS TRUE
           OR function_row.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
         )
     ) THEN
    RAISE EXCEPTION 'receipt_unexpected_youtube_release_function';
  END IF;

  IF (
    SELECT count(*)
      FROM privacy_retention.g014_public_rpc_allowlist AS allowed
      JOIN pg_catalog.pg_proc AS function_row
        ON function_row.oid = release_function
      JOIN pg_catalog.pg_namespace AS function_schema
        ON function_schema.oid = function_row.pronamespace
     WHERE allowed.function_schema = function_schema.nspname
       AND allowed.function_name = function_row.proname
       AND allowed.identity_arguments = function_row.proargtypes::text
       AND allowed.grantee = 'service_role'::name
       AND allowed.source_signature =
         'public.publish_youtube_thumbnail_release(uuid,text,text,text,text,text,text,text,text,numeric,jsonb,jsonb,jsonb,jsonb,uuid,timestamp with time zone)'
  ) <> 1 THEN
    RAISE EXCEPTION 'receipt_unexpected_youtube_release_allowlist';
  END IF;

  PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
  PERFORM privacy_retention.assert_g014_catalog_contract();

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

-- G014 intentionally removes auth-schema access from the privacy RPC owner.
-- This independent readback proves the repaired map-overlay boundary uses only
-- bounded JWT claim GUCs and the exact effective table/RLS capabilities needed
-- by its SECURITY DEFINER implementation.
DO $$
DECLARE
  rpc_function regprocedure := pg_catalog.to_regprocedure(
    'public.apply_admin_restaurant_map_overlay_action(uuid,text,uuid,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,uuid,text,jsonb)'
  );
  rpc_source text;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(function_row.oid)
    INTO rpc_source
    FROM pg_catalog.pg_proc AS function_row
   WHERE function_row.oid = rpc_function;

  IF rpc_function IS NULL
     OR rpc_source IS NULL
     OR position('request.jwt.claims' IN rpc_source) = 0
     OR position('request.jwt.claim.role' IN rpc_source) = 0
     OR position('auth.role()' IN rpc_source) <> 0
     OR position('FOR SHARE' IN pg_catalog.upper(rpc_source)) <> 0
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS function_row
        WHERE function_row.oid = rpc_function
          AND (
            pg_catalog.pg_get_function_result(function_row.oid) <> 'jsonb'
            OR pg_catalog.pg_get_userbyid(function_row.proowner) <>
              'privacy_workflow_owner'
            OR function_row.prosecdef IS NOT TRUE
            OR function_row.provolatile <> 'v'
            OR function_row.proconfig IS DISTINCT FROM
              ARRAY['search_path=""']::text[]
          )
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', rpc_function, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('anon', rpc_function, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'authenticated', rpc_function, 'EXECUTE'
     )
     OR pg_catalog.has_schema_privilege(
       'privacy_workflow_owner', 'auth', 'USAGE'
     )
     OR NOT EXISTS (
       SELECT 1
         FROM privacy_retention.g014_public_rpc_allowlist AS allowed
        WHERE allowed.source_signature =
          'public.apply_admin_restaurant_map_overlay_action(uuid,text,uuid,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,uuid,text,jsonb)'
          AND allowed.grantee = 'service_role'
     ) THEN
    RAISE EXCEPTION 'receipt_unexpected_admin_map_overlay_rpc';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner',
       'public.admin_restaurant_map_overlays',
       'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner',
       'public.admin_restaurant_map_overlays',
       'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner',
       'public.admin_restaurant_map_overlays',
       'UPDATE'
     )
     OR pg_catalog.has_table_privilege(
       'privacy_workflow_owner',
       'public.admin_restaurant_map_overlays',
       'DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner',
       'public.admin_restaurant_map_overlay_audit_events',
       'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner',
       'public.admin_restaurant_map_overlay_audit_events',
       'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       'privacy_workflow_owner',
       'public.admin_restaurant_map_overlay_audit_events',
       'UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.restaurants', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'privacy_workflow_owner',
       'public.restaurants',
       'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.admin_restaurant_map_overlays', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'service_role',
       'public.admin_restaurant_map_overlays',
       'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     OR pg_catalog.has_table_privilege(
       'service_role',
       'public.admin_restaurant_map_overlay_audit_events',
       'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
     )
     OR EXISTS (
       SELECT 1
         FROM (VALUES ('anon'::name), ('authenticated'::name))
           AS denied(role_name)
        WHERE pg_catalog.has_table_privilege(
          denied.role_name,
          'public.admin_restaurant_map_overlays',
          'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
        )
           OR pg_catalog.has_table_privilege(
             denied.role_name,
             'public.admin_restaurant_map_overlay_audit_events',
             'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
           )
     ) THEN
    RAISE EXCEPTION 'receipt_unexpected_admin_map_overlay_table_grant';
  END IF;

  IF EXISTS (
    WITH expected(
      relation_name, policy_name, command, normalized_using, normalized_check
    ) AS (
      VALUES
        (
          'admin_restaurant_map_overlay_audit_events',
          'tzudong_admin_map_overlay_audit_owner_insert',
          'a'::"char", NULL::text, 'true'::text
        ),
        (
          'admin_restaurant_map_overlay_audit_events',
          'tzudong_admin_map_overlay_audit_owner_select',
          'r'::"char", 'true'::text, NULL::text
        ),
        (
          'admin_restaurant_map_overlays',
          'tzudong_admin_map_overlays_owner_insert',
          'a'::"char", NULL::text, 'true'::text
        ),
        (
          'admin_restaurant_map_overlays',
          'tzudong_admin_map_overlays_owner_select',
          'r'::"char", 'true'::text, NULL::text
        ),
        (
          'admin_restaurant_map_overlays',
          'tzudong_admin_map_overlays_owner_update',
          'w'::"char", 'true'::text, 'true'::text
        )
    ), actual AS (
      SELECT
        relation_row.relname AS relation_name,
        policy_row.polname AS policy_name,
        policy_row.polcmd AS command,
        policy_row.polroles,
        pg_catalog.pg_get_expr(
          policy_row.polqual, policy_row.polrelid
        ) AS normalized_using,
        pg_catalog.pg_get_expr(
          policy_row.polwithcheck, policy_row.polrelid
        ) AS normalized_check
        FROM pg_catalog.pg_policy AS policy_row
        JOIN pg_catalog.pg_class AS relation_row
          ON relation_row.oid = policy_row.polrelid
        JOIN pg_catalog.pg_namespace AS schema_row
          ON schema_row.oid = relation_row.relnamespace
       WHERE schema_row.nspname = 'public'
         AND relation_row.relname IN (
           'admin_restaurant_map_overlays',
           'admin_restaurant_map_overlay_audit_events'
         )
    )
    (SELECT
       relation_name, policy_name, command,
       ARRAY['privacy_workflow_owner'::regrole::oid],
       normalized_using, normalized_check
       FROM expected
     EXCEPT
     SELECT
       relation_name, policy_name, command, polroles,
       normalized_using, normalized_check
       FROM actual)
    UNION ALL
    (SELECT
       relation_name, policy_name, command, polroles,
       normalized_using, normalized_check
       FROM actual
     EXCEPT
     SELECT
       relation_name, policy_name, command,
       ARRAY['privacy_workflow_owner'::regrole::oid],
       normalized_using, normalized_check
       FROM expected)
  ) THEN
    RAISE EXCEPTION 'receipt_unexpected_admin_map_overlay_policy';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS sequence_row
      JOIN pg_catalog.pg_depend AS dependency
        ON dependency.objid = sequence_row.oid
       AND dependency.classid = 'pg_class'::regclass
       AND dependency.deptype IN ('a', 'i')
     WHERE sequence_row.relkind = 'S'
       AND dependency.refobjid IN (
         'public.admin_restaurant_map_overlays'::regclass,
         'public.admin_restaurant_map_overlay_audit_events'::regclass
       )
  ) THEN
    RAISE EXCEPTION 'receipt_unexpected_admin_map_overlay_sequence';
  END IF;
END
$$;

-- REVIEW_MEDIA_READBACK_BEGIN
-- The same independent catalog-only checks are embedded in canonical readback.
DO $review_media_catalog_readback$
DECLARE
  v_expected record; v_function record; v_relation record;
  v_owner oid := 'privacy_workflow_owner'::regrole;
  v_path text := current_setting('search_path');
BEGIN
  -- Existing G041 claim boundary: never restore auth-schema access for the
  -- workflow owner. Pin the unchanged helper before substituting auth.uid().
  IF has_schema_privilege(v_owner,'auth','USAGE,CREATE') OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='privacy_retention' AND p.proname='g041_current_claim_user_id'
      AND p.pronargs=0 AND p.proowner=v_owner AND p.prosecdef AND p.prokind='f'
      AND NOT p.proretset AND p.prorettype='uuid'::regtype AND p.provolatile='s'
      AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
      AND p.proconfig=ARRAY['search_path=""']::text[]
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='43f3ff2ed914944802555c4ffe3ff8ecece213e82288e2c1c47ae22efdf81585'
      AND has_function_privilege(v_owner,p.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
  ) THEN RAISE EXCEPTION 'review_media_catalog_claim_boundary_drift'; END IF;
  -- Fix pg_get_expr qualification before comparing the exact parsed predicates.
  PERFORM set_config('search_path','public, pg_catalog',true);
  FOR v_expected IN SELECT * FROM (VALUES
    ('public.finish_review_media_cleanup()','f6c4e71988ed2b789b887484af5fdf2e482bde98f1d1c5b5d4e7ad124c314bd1',true,'v','plpgsql','bigint',ARRAY[]::text[]),
    ('public.mutate_review_with_media(uuid,uuid,text,timestamp with time zone,text,text[],text[])','a47b34c81605a515df01a6a2da7c5503c0a7abfea6946028b51ed52bb31a8830',true,'v','plpgsql','text',ARRAY['p_operation_id','p_review_id','p_kind','p_expected_updated_at','p_content','p_categories','p_food_photos']::text[]),
    ('public.pending_review_media_cleanup()','5a92c8f282c895eabaa77f8cf3f452fb659bac33bd519ed8cf439dc1f2905c7b',true,'v','plpgsql','TABLE(path text, owner_id uuid, review_id uuid, purpose text)',ARRAY[]::text[]),
    ('public.queue_review_upload_cleanup(uuid,text[])','89c3b573891f598cac5df6ce9a3217639092801a7439ec0404f338f2097114a8',true,'v','plpgsql','text',ARRAY['p_review_id','p_paths']::text[]),
    ('public.read_review_media_commit(uuid,uuid,text)','2f14abfc04864f369467f5ac5f0603defa149b8023d7e6b04e2bb8535f8a268e',true,'v','sql','text',ARRAY['p_operation_id','p_review_id','p_kind']::text[]),
    ('public.review_media_delete_allowed(text)','a75dbd787dd388b0761bee11c82a56d5f410688e4cfd953181bce4d613062ae7',true,'v','plpgsql','boolean',ARRAY['p_path']::text[]),
    ('review_media_private.canonical(text,uuid,uuid,text)','87d8397c36cf4c7b986f75cbc2788979333a76be2cc26dc5522cd362f62414a9',false,'i','sql','boolean',ARRAY['p_path','p_owner','p_review','p_purpose']::text[]),
    ('review_media_private.guard_references()','846030547ffd76e17596755d7eee4279dcb9b563361435260826071d2f250d59',true,'v','plpgsql','trigger',ARRAY[]::text[]),
    ('review_media_private.lock_changes()','381d89aa6bbf5a59c2ee0fef2a7392ef705147252b324527201b8b6f74376250',true,'v','plpgsql','trigger',ARRAY[]::text[]),
    ('review_media_private.owned_legacy(text,uuid,text)','a2d55f09f03fcaeedd77461198511673da7342a6a4873d37227f9cf612090980',false,'i','sql','boolean',ARRAY['p_path','p_owner','p_purpose']::text[]),
    ('review_media_private.reference_key(text)','a8910cb09bfd959951045e8b0b8233b1e2a8bdc45073abeebdfc26b552b1dae7',false,'i','plpgsql','text',ARRAY['p_value']::text[]),
    ('review_media_private.referenced(text)','cc295115d85a3a11b380e1378e2ee91b0d9f7f587c68839653f54ed826c398ce',true,'v','sql','boolean',ARRAY['p_path']::text[])
  ) AS expected(signature,body_sha256,definer,volatility,language,result,argument_names) LOOP
    SELECT * INTO v_function FROM pg_proc WHERE oid=to_regprocedure(v_expected.signature);
    IF v_function.oid IS NULL OR v_function.proowner<>v_owner OR v_function.prokind<>'f'
       OR v_function.prosecdef IS DISTINCT FROM v_expected.definer OR v_function.provolatile::text<>v_expected.volatility
       OR v_function.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
       OR (SELECT lanname FROM pg_language WHERE oid=v_function.prolang)<>v_expected.language
       OR pg_get_function_result(v_function.oid) IS DISTINCT FROM v_expected.result
       OR coalesce(v_function.proargnames[1:v_function.pronargs],ARRAY[]::text[]) IS DISTINCT FROM v_expected.argument_names
       OR v_function.pronargdefaults<>(CASE WHEN v_function.proname='mutate_review_with_media' THEN 3 ELSE 0 END)
       OR (v_function.pronargdefaults=3 AND pg_get_expr(v_function.proargdefaults,0)<>'NULL::text, NULL::text[], NULL::text[]')
       OR encode(sha256(convert_to(v_function.prosrc,'UTF8')),'hex')<>v_expected.body_sha256
       OR (SELECT count(*) FROM pg_proc x WHERE x.pronamespace=v_function.pronamespace AND x.proname=v_function.proname)<>1
       OR NOT has_function_privilege(v_owner,v_function.oid,'EXECUTE')
       OR has_function_privilege('anon',v_function.oid,'EXECUTE')
       OR has_function_privilege('service_role',v_function.oid,'EXECUTE')
       OR has_function_privilege('authenticated',v_function.oid,'EXECUTE') IS DISTINCT FROM (v_expected.signature LIKE 'public.%')
       OR EXISTS (SELECT 1 FROM aclexplode(coalesce(v_function.proacl,acldefault('f',v_function.proowner))) a
         WHERE a.is_grantable OR a.privilege_type<>'EXECUTE'
         OR (a.grantee<>v_owner AND NOT (v_expected.signature LIKE 'public.%' AND a.grantee='authenticated'::regrole))) THEN
      RAISE EXCEPTION 'review_media_catalog_function_drift';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace='review_media_private'::regnamespace)<>6
     OR (SELECT count(*) FROM pg_class WHERE relnamespace='review_media_private'::regnamespace AND relkind IN ('r','p','v','m','f','S'))<>2
     OR NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='review_media_private' AND nspowner='postgres'::regrole)
     OR NOT has_schema_privilege(v_owner,'review_media_private','USAGE')
     OR has_schema_privilege(v_owner,'review_media_private','CREATE')
     OR EXISTS (SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
       WHERE n.nspname='review_media_private' AND a.grantee<>n.nspowner
         AND (a.grantee<>v_owner OR a.privilege_type<>'USAGE' OR a.is_grantable)) THEN
    RAISE EXCEPTION 'review_media_catalog_private_schema_drift';
  END IF;
  FOR v_expected IN SELECT * FROM (VALUES
    ('commits',ARRAY['INSERT','SELECT']::text[]),
    ('cleanup',ARRAY['INSERT','SELECT','UPDATE']::text[])
  ) AS expected(name,privileges) LOOP
    SELECT * INTO v_relation FROM pg_class WHERE oid=to_regclass('review_media_private.'||v_expected.name);
    IF v_relation.relkind<>'r' OR v_relation.relowner<>'postgres'::regrole OR NOT v_relation.relrowsecurity OR NOT v_relation.relforcerowsecurity
       OR (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type) FROM aclexplode(v_relation.relacl) a
           WHERE a.grantee=v_owner) IS DISTINCT FROM v_expected.privileges
       OR EXISTS (SELECT 1 FROM aclexplode(v_relation.relacl) a WHERE a.grantee<>v_relation.relowner AND (a.grantee<>v_owner OR a.is_grantable))
       OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=v_relation.oid AND attacl IS NOT NULL) THEN
      RAISE EXCEPTION 'review_media_catalog_private_table_drift';
    END IF;
  END LOOP;
  IF EXISTS (
    WITH expected(relation, name, cmd, using_expr, check_expr) AS (VALUES
      ('commits','review_media_commits_select','r','true'::text,NULL::text),
      ('commits','review_media_commits_insert','a',NULL::text,'true'),
      ('cleanup','review_media_cleanup_select','r','true',NULL::text),
      ('cleanup','review_media_cleanup_insert','a',NULL::text,'true'),
      ('cleanup','review_media_cleanup_update','w','true','true')
    ), actual AS (
      SELECT c.relname::text,p.polname::text,p.polcmd::text,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid),p.polpermissive,p.polroles
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='review_media_private'::regnamespace
    ), wanted AS (SELECT *,true,ARRAY[v_owner] FROM expected)
    (SELECT * FROM wanted EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM wanted)
  ) THEN RAISE EXCEPTION 'review_media_catalog_private_policy_drift'; END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) r(name)
    WHERE has_schema_privilege(r.name,'review_media_private','USAGE,CREATE')
       OR has_table_privilege(r.name,'review_media_private.commits','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_table_privilege(r.name,'review_media_private.cleanup','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  ) OR NOT has_table_privilege(v_owner,'public.reviews','SELECT')
     OR NOT has_table_privilege(v_owner,'public.reviews','DELETE')
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['content','categories','food_photos','is_verified','admin_note','updated_at']) c(name)
         WHERE NOT has_column_privilege(v_owner,'public.reviews',c.name,'UPDATE'))
     OR has_table_privilege(v_owner,'public.reviews','INSERT,UPDATE,TRUNCATE,REFERENCES,TRIGGER')
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.reviews'::regclass AND a.attnum>0 AND NOT a.attisdropped
         AND a.attname<>ALL(ARRAY['content','categories','food_photos','is_verified','admin_note','updated_at'])
         AND has_column_privilege(v_owner,a.attrelid,a.attnum,'UPDATE'))
     OR NOT has_table_privilege(v_owner,'storage.objects','SELECT')
     OR has_table_privilege(v_owner,'storage.objects','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'review_media_catalog_minimum_grant_drift';
  END IF;
  IF EXISTS (
    WITH expected(relation,ordinal,name,type,not_null,default_expr) AS (VALUES
      ('commits',1,'operation_id','uuid',true,NULL::text),
      ('commits',2,'owner_id','uuid',true,NULL::text),
      ('commits',3,'review_id','uuid',true,NULL::text),
      ('commits',4,'kind','text',true,NULL::text),
      ('commits',5,'request_hash','text',true,NULL::text),
      ('cleanup',1,'path','text',true,NULL::text),
      ('cleanup',2,'owner_id','uuid',true,NULL::text),
      ('cleanup',3,'review_id','uuid',true,NULL::text),
      ('cleanup',4,'purpose','text',true,NULL::text),
      ('cleanup',5,'retired','boolean',true,'false'),
      ('cleanup',6,'complete','boolean',true,'false')
    ), actual AS (
      SELECT c.relname::text,a.attnum::integer,a.attname::text,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,
        pg_catalog.pg_get_expr(d.adbin,d.adrelid)
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE c.relnamespace='review_media_private'::regnamespace AND c.relkind IN ('r','p')
    )
    (SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  ) THEN RAISE EXCEPTION 'review_media_catalog_column_shape_drift'; END IF;
  IF EXISTS (
    WITH expected(relation,name,definition) AS (VALUES
      ('commits','commits_pkey','PRIMARY KEY (operation_id)'),
      ('commits','commits_kind_check','CHECK ((kind = ANY (ARRAY[''edit''::text, ''delete''::text])))'),
      ('cleanup','cleanup_pkey','PRIMARY KEY (path)'),
      ('cleanup','cleanup_purpose_check','CHECK ((purpose = ANY (ARRAY[''food''::text, ''verification''::text])))')
    ), actual AS (
      SELECT c.relname::text,k.conname::text,pg_catalog.pg_get_constraintdef(k.oid)
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_constraint k ON k.conrelid=c.oid
      WHERE c.relnamespace='review_media_private'::regnamespace
    )
    (SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  ) OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
      WHERE c.relnamespace='review_media_private'::regnamespace AND NOT t.tgisinternal)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
      WHERE c.relnamespace='review_media_private'::regnamespace AND (NOT k.convalidated OR k.condeferrable OR k.condeferred))
    OR (SELECT count(*) FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
      WHERE c.relnamespace='review_media_private'::regnamespace)<>2
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
      WHERE c.relnamespace='review_media_private'::regnamespace AND (NOT i.indisprimary OR NOT i.indisvalid OR NOT i.indisready)) THEN
    RAISE EXCEPTION 'review_media_catalog_constraint_shape_drift';
  END IF;
  IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc
      WHERE pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='privacy_retention')
        AND proname='g014_catalog_protected_relations' AND pronargs=0) IS DISTINCT FROM '20acd5742d891cf8a33b265a3a1298c65dd9646402c58391cd17829951cf92f2' THEN
    RAISE EXCEPTION 'review_media_catalog_known_identity_post_drift';
  END IF;
  -- Exact allowlist and unchanged G014 assertions run through the owner bridge
  -- above; canonical readback also runs them before this catalog-only block.
  -- Compare command, role, permissive/restrictive bit and BOTH complete predicates.
  IF EXISTS (
    WITH expected(name,cmd,permissive,role_name,using_expr,check_expr) AS (VALUES
      ('review_media_safe_delete','d',false,'authenticated','((bucket_id <> ''review-photos''::text) OR review_media_delete_allowed(name))',NULL::text),
      ('review_media_workflow_read','r',true,'privacy_workflow_owner','(bucket_id = ANY (ARRAY[''review-photos''::text, ''review-verifications''::text]))',NULL::text),
      ('review_photos_food_insert','a',false,'authenticated',NULL::text,'((bucket_id <> ''review-photos''::text) OR ((split_part(name, ''/''::text, 4) = ''food''::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid))))'),
      ('review_photos_food_update','w',false,'authenticated','((bucket_id <> ''review-photos''::text) OR ((split_part(name, ''/''::text, 4) = ''food''::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid))))','((bucket_id <> ''review-photos''::text) OR ((split_part(name, ''/''::text, 4) = ''food''::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid))))'),
      ('review_verifications_owner_delete','d',true,'authenticated','((bucket_id = ''review-verifications''::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)))',NULL::text),
      ('review_verifications_owner_insert','a',true,'authenticated',NULL::text,'((bucket_id = ''review-verifications''::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)) AND (split_part(name, ''/''::text, 4) = ''verification''::text))'),
      ('review_verifications_owner_read','r',true,'authenticated','((bucket_id = ''review-verifications''::text) AND (((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)) OR has_role(( SELECT auth.uid() AS uid), ''admin''::app_role)))',NULL::text),
      ('review_verifications_safe_delete','d',false,'authenticated','((bucket_id <> ''review-verifications''::text) OR review_media_delete_allowed(name))',NULL::text)
    ), actual AS (
      SELECT p.polname::text,p.polcmd::text,p.polpermissive,p.polroles,
        regexp_replace(pg_get_expr(p.polqual,p.polrelid),'[[:space:]]+',' ','g'),
        regexp_replace(pg_get_expr(p.polwithcheck,p.polrelid),'[[:space:]]+',' ','g')
      FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass
        AND (p.polname LIKE 'review_media_%' OR p.polname LIKE 'review_photos_%' OR p.polname LIKE 'review_verifications_%')
    ), wanted AS (SELECT name,cmd,permissive,ARRAY[to_regrole(role_name)::oid],using_expr,check_expr FROM expected)
    (SELECT * FROM wanted EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM wanted)
  ) THEN RAISE EXCEPTION 'review_media_catalog_storage_policy_drift'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='review-verifications' AND name='review-verifications'
      AND public=false AND file_size_limit=5242880
      AND allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp','image/avif']::text[]) THEN
    RAISE EXCEPTION 'review_media_catalog_private_bucket_drift';
  END IF;
  -- Admit the strict canonical local read policy or the three exact deployed
  -- bucket read identities. All existing API-role reads must match a known
  -- predicate; the private verification bucket is never publicly readable.
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass
      AND p.polcmd='r' AND p.polpermissive AND p.polroles && ARRAY[0::oid,'anon'::regrole::oid,'authenticated'::regrole::oid]
      AND p.polname NOT IN ('tzudong_public_media_read','Anyone can view review photos','Public read access',
        'Public read access for profile-avatars','local_nightly_avatar_read','review_verifications_owner_read'))
    OR EXISTS (SELECT 1 FROM pg_policy p JOIN (VALUES
      ('Anyone can view review photos','(bucket_id = ''review-photos''::text)'),
      ('Public read access','(bucket_id = ''ad-banner-images''::text)'),
      ('Public read access for profile-avatars','(bucket_id = ''profile-avatars''::text)')
    ) e(name,predicate) ON p.polname=e.name
      WHERE p.polrelid='storage.objects'::regclass AND (p.polcmd<>'r' OR NOT p.polpermissive
        OR p.polroles<>ARRAY[0::oid] OR p.polwithcheck IS NOT NULL OR pg_get_expr(p.polqual,p.polrelid)<>e.predicate))
    OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass
      AND p.polname='tzudong_public_media_read' AND (p.polcmd<>'r' OR NOT p.polpermissive
        OR NOT p.polroles @> ARRAY['anon'::regrole::oid,'authenticated'::regrole::oid] OR cardinality(p.polroles)<>2
        OR p.polwithcheck IS NOT NULL OR pg_get_expr(p.polqual,p.polrelid)<>'(bucket_id = ANY (ARRAY[''profile-avatars''::text, ''review-photos''::text, ''ad-banner-images''::text]))'))
    OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass AND p.polname='local_nightly_avatar_read'
      AND (p.polcmd<>'r' OR NOT p.polpermissive OR NOT p.polroles @> ARRAY['anon'::regrole::oid,'authenticated'::regrole::oid]
        OR cardinality(p.polroles)<>2 OR p.polwithcheck IS NOT NULL OR pg_get_expr(p.polqual,p.polrelid)<>'(bucket_id = ''avatars''::text)')) THEN
    RAISE EXCEPTION 'review_media_catalog_public_read_drift';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='storage.objects'::regclass
      AND polname='tzudong_public_media_read' AND polcmd='r' AND polpermissive
      AND polroles @> ARRAY['anon'::regrole::oid,'authenticated'::regrole::oid]
      AND cardinality(polroles)=2 AND polwithcheck IS NULL
      AND pg_get_expr(polqual,polrelid)='(bucket_id = ANY (ARRAY[''profile-avatars''::text, ''review-photos''::text, ''ad-banner-images''::text]))')
    AND (SELECT count(*) FROM pg_policy WHERE polrelid='storage.objects'::regclass
      AND polname IN ('Anyone can view review photos','Public read access','Public read access for profile-avatars'))<>3 THEN
    RAISE EXCEPTION 'review_media_catalog_public_read_drift';
  END IF;
  -- The global reference scan must see all reviews under the trusted role.
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.reviews'::regclass
      AND polname='g014_account_deletion_source_access' AND polcmd='*' AND polpermissive
      AND polroles=ARRAY[v_owner] AND pg_get_expr(polqual,polrelid)='true' AND pg_get_expr(polwithcheck,polrelid)='true') THEN
    RAISE EXCEPTION 'review_media_catalog_reference_visibility_drift';
  END IF;
  PERFORM set_config('search_path',v_path,true);
END $review_media_catalog_readback$;
-- REVIEW_MEDIA_READBACK_END

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
                        regexp_replace(pg_catalog.pg_get_expr(policy_row.polwithcheck, policy_row.polrelid), '[[:space:]]+', ' ', 'g'),
                        policy_row.polpermissive)::text
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
                        regexp_replace(pg_catalog.pg_get_expr(policy_row.polwithcheck, policy_row.polrelid), '[[:space:]]+', ' ', 'g'),
                        policy_row.polpermissive)::text
  FROM pg_catalog.pg_policy AS policy_row
  JOIN pg_catalog.pg_class AS policy_relation ON policy_relation.oid = policy_row.polrelid
  JOIN pg_catalog.pg_namespace AS policy_schema ON policy_schema.oid = policy_relation.relnamespace
 WHERE policy_schema.nspname = 'storage'
 ORDER BY policy_schema.nspname, policy_relation.relname, policy_row.polname;

SELECT json_build_array('realtime_membership', publication_row.pubname, publication_table.schemaname,
                        publication_table.tablename)::text
  FROM pg_catalog.pg_publication_tables AS publication_table
  JOIN pg_catalog.pg_publication AS publication_row ON publication_row.pubname = publication_table.pubname
 WHERE publication_row.pubname = 'supabase_realtime'
 ORDER BY publication_table.pubname, publication_table.schemaname, publication_table.tablename;

WITH function_contract(function_oid, function_name) AS (
  VALUES
    (
      pg_catalog.to_regprocedure('public.is_current_user_active_admin()'),
      'is_current_user_active_admin()'
    ),
    (pg_catalog.to_regprocedure('public.is_user_admin(uuid)'), 'is_user_admin(uuid)')
), role_contract(role_name) AS (
  VALUES ('anon'), ('authenticated'), ('privacy_workflow_owner'), ('service_role')
)
SELECT json_build_array(
         'public_read_function_grants',
         function_contract.function_name,
         role_contract.role_name,
         pg_catalog.has_function_privilege(
           role_contract.role_name,
           function_contract.function_oid,
           'EXECUTE'
         )
       )::text
  FROM function_contract
 CROSS JOIN role_contract
 ORDER BY function_contract.function_name, role_contract.role_name;

WITH relation_contract(relation_name) AS (
  VALUES ('ad_banners'), ('announcements')
), role_contract(role_name) AS (
  VALUES ('anon'), ('authenticated'), ('service_role')
)
SELECT json_build_array(
         'public_read_table_grants',
         relation_contract.relation_name,
         role_contract.role_name,
         pg_catalog.has_table_privilege(
           role_contract.role_name,
           'public.' || relation_contract.relation_name,
           'SELECT'
         ),
         pg_catalog.has_table_privilege(
           role_contract.role_name,
           'public.' || relation_contract.relation_name,
           'INSERT'
         ),
         pg_catalog.has_table_privilege(
           role_contract.role_name,
           'public.' || relation_contract.relation_name,
           'UPDATE'
         ),
         pg_catalog.has_table_privilege(
           role_contract.role_name,
           'public.' || relation_contract.relation_name,
           'DELETE'
         )
       )::text
  FROM relation_contract
 CROSS JOIN role_contract
 ORDER BY relation_contract.relation_name, role_contract.role_name;

SELECT json_build_array(
         'public_read_policies',
         public_read_relation.relname,
         public_read_policy.polname,
         CASE public_read_policy.polcmd
           WHEN 'r' THEN 'SELECT'
           WHEN 'a' THEN 'INSERT'
           WHEN 'w' THEN 'UPDATE'
           WHEN 'd' THEN 'DELETE'
           ELSE 'ALL'
         END,
         COALESCE((
           SELECT array_agg(public_read_role.rolname ORDER BY public_read_role.rolname)
             FROM pg_catalog.unnest(public_read_policy.polroles)
               AS public_read_role_id(role_oid)
             JOIN pg_catalog.pg_roles AS public_read_role
               ON public_read_role.oid = public_read_role_id.role_oid
         ), ARRAY[]::text[]),
         regexp_replace(
           pg_catalog.pg_get_expr(public_read_policy.polqual, public_read_policy.polrelid),
           '[[:space:]]+', ' ', 'g'
         ),
         regexp_replace(
           pg_catalog.pg_get_expr(
             public_read_policy.polwithcheck,
             public_read_policy.polrelid
           ),
           '[[:space:]]+', ' ', 'g'
         )
       )::text
  FROM pg_catalog.pg_policy AS public_read_policy
  JOIN pg_catalog.pg_class AS public_read_relation
    ON public_read_relation.oid = public_read_policy.polrelid
  JOIN pg_catalog.pg_namespace AS public_read_schema
    ON public_read_schema.oid = public_read_relation.relnamespace
 WHERE public_read_schema.nspname = 'public'
   AND public_read_relation.relname IN ('announcements', 'ad_banners')
 ORDER BY public_read_relation.relname, public_read_policy.polname;

WITH expected_policy(relation_name, policy_name) AS (
  VALUES
    ('restaurant_refresh_candidates', 'restaurant_refresh_candidates_admin_insert'),
    ('restaurant_refresh_candidates', 'restaurant_refresh_candidates_admin_select'),
    ('restaurant_refresh_candidates', 'restaurant_refresh_candidates_admin_update'),
    ('restaurant_refresh_runs', 'restaurant_refresh_runs_admin_insert'),
    ('restaurant_refresh_runs', 'restaurant_refresh_runs_admin_select'),
    ('restaurant_refresh_runs', 'restaurant_refresh_runs_admin_update'),
    ('restaurant_request_review_audit', 'Admins can view request review audit'),
    ('restaurant_requests', 'Admins can update requests'),
    ('restaurant_requests', 'Admins can view all requests'),
    ('restaurant_requests', 'Restaurant requests select policy'),
    ('restaurant_submission_items', 'Admins can delete submission items'),
    ('restaurant_submission_items', 'Admins can update submission items'),
    ('restaurant_submission_items', 'Submission items insert policy'),
    ('restaurant_submission_items', 'Submission items select policy'),
    ('restaurant_submissions', 'Admins can update all submissions'),
    ('restaurant_submissions', 'Restaurant submissions select policy'),
    ('restaurants', 'restaurants_authenticated_admin_update'),
    ('short_urls', 'Admins can delete short URLs')
)
SELECT json_build_array(
         'caller_bound_admin_policies',
         relation_row.relname,
         policy_row.polname,
         CASE policy_row.polcmd
           WHEN 'r' THEN 'SELECT'
           WHEN 'a' THEN 'INSERT'
           WHEN 'w' THEN 'UPDATE'
           WHEN 'd' THEN 'DELETE'
           ELSE 'ALL'
         END,
         COALESCE((
           SELECT array_agg(role_row.rolname ORDER BY role_row.rolname)
             FROM pg_catalog.unnest(policy_row.polroles) AS role_id(oid)
             JOIN pg_catalog.pg_roles AS role_row ON role_row.oid = role_id.oid
         ), ARRAY[]::text[]),
         (
           SELECT count(*)
             FROM pg_catalog.pg_depend AS dependency
            WHERE dependency.classid = 'pg_policy'::regclass
              AND dependency.objid = policy_row.oid
              AND dependency.refclassid = 'pg_proc'::regclass
              AND dependency.refobjid =
                'public.is_current_user_active_admin()'::regprocedure
         ),
         (
           SELECT count(*)
             FROM pg_catalog.pg_depend AS dependency
            WHERE dependency.classid = 'pg_policy'::regclass
              AND dependency.objid = policy_row.oid
              AND dependency.refclassid = 'pg_proc'::regclass
              AND dependency.refobjid = 'auth.uid()'::regprocedure
         ),
         (
           SELECT count(*)
             FROM pg_catalog.pg_depend AS dependency
            WHERE dependency.classid = 'pg_policy'::regclass
              AND dependency.objid = policy_row.oid
              AND dependency.refclassid = 'pg_proc'::regclass
              AND dependency.refobjid = 'public.is_user_admin(uuid)'::regprocedure
         )
       )::text
  FROM expected_policy
  JOIN pg_catalog.pg_namespace AS schema_row ON schema_row.nspname = 'public'
  JOIN pg_catalog.pg_class AS relation_row
    ON relation_row.relnamespace = schema_row.oid
   AND relation_row.relname = expected_policy.relation_name
  JOIN pg_catalog.pg_policy AS policy_row
    ON policy_row.polrelid = relation_row.oid
   AND policy_row.polname = expected_policy.policy_name
 ORDER BY relation_row.relname, policy_row.polname;

WITH function_contract(signature) AS (
  VALUES
    ('public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)'),
    ('public.read_admin_user_audit_events(integer)'),
    ('public.read_admin_user_ids_for_management()'),
    ('public.read_admin_user_management_metadata(uuid[])')
)
SELECT json_build_array(
         'admin_data_rpcs',
         function_contract.signature,
         pg_catalog.pg_get_function_result(function_row.oid),
         pg_catalog.pg_get_userbyid(function_row.proowner),
         function_row.prosecdef,
         CASE function_row.provolatile
           WHEN 'i' THEN 'immutable'
           WHEN 's' THEN 'stable'
           ELSE 'volatile'
         END,
         COALESCE((
           SELECT array_agg(setting.value ORDER BY setting.ordinality)
             FROM pg_catalog.unnest(
               COALESCE(function_row.proconfig, ARRAY[]::text[])
             ) WITH ORDINALITY AS setting(value, ordinality)
            WHERE setting.value LIKE 'search_path=%'
         ), ARRAY[]::text[]),
         pg_catalog.has_function_privilege(
           'service_role', function_row.oid, 'EXECUTE'
         ),
         pg_catalog.has_function_privilege('anon', function_row.oid, 'EXECUTE'),
         pg_catalog.has_function_privilege(
           'authenticated', function_row.oid, 'EXECUTE'
         ),
         EXISTS (
           SELECT 1
             FROM privacy_retention.g014_public_rpc_allowlist AS allowed
            WHERE allowed.source_signature = function_contract.signature
              AND allowed.grantee = 'service_role'
         )
       )::text
  FROM function_contract
 CROSS JOIN LATERAL pg_catalog.to_regprocedure(function_contract.signature)
   AS resolved(function_oid)
 JOIN pg_catalog.pg_proc AS function_row ON function_row.oid = resolved.function_oid
 ORDER BY function_contract.signature;

WITH relation_contract(relation_name) AS (
  VALUES ('admin_audit_events'), ('profiles'), ('user_account_status'), ('user_roles')
)
SELECT json_build_array(
         'admin_data_table_grants',
         relation_contract.relation_name,
         pg_catalog.has_table_privilege(
           'service_role', 'public.' || relation_contract.relation_name, 'SELECT'
         ),
         pg_catalog.has_table_privilege(
           'service_role', 'public.' || relation_contract.relation_name, 'INSERT'
         ),
         pg_catalog.has_table_privilege(
           'service_role', 'public.' || relation_contract.relation_name, 'UPDATE'
         ),
         pg_catalog.has_table_privilege(
           'service_role', 'public.' || relation_contract.relation_name, 'DELETE'
         )
       )::text
  FROM relation_contract
 ORDER BY relation_contract.relation_name;

WITH function_contract(resolve_signature, receipt_signature) AS (
  VALUES (
    'public.apply_admin_restaurant_map_overlay_action(uuid,text,uuid,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,uuid,text,jsonb)',
    'public.apply_admin_restaurant_map_overlay_action(uuid,text,uuid,text,text,text,timestamp with time zone,timestamp with time zone,jsonb,text,text,text,uuid,text,jsonb)'
  )
), function_catalog AS (
  SELECT
    function_contract.receipt_signature,
    function_row.*,
    pg_catalog.pg_get_functiondef(function_row.oid) AS definition
    FROM function_contract
   CROSS JOIN LATERAL pg_catalog.to_regprocedure(
     function_contract.resolve_signature
   ) AS resolved(function_oid)
    JOIN pg_catalog.pg_proc AS function_row
      ON function_row.oid = resolved.function_oid
)
SELECT json_build_array(
         'admin_map_overlay_rpc',
         function_catalog.receipt_signature,
         pg_catalog.pg_get_function_result(function_catalog.oid),
         pg_catalog.pg_get_userbyid(function_catalog.proowner),
         function_catalog.prosecdef,
         CASE function_catalog.provolatile
           WHEN 'i' THEN 'immutable'
           WHEN 's' THEN 'stable'
           ELSE 'volatile'
         END,
         COALESCE((
           SELECT array_agg(setting.value ORDER BY setting.ordinality)
             FROM pg_catalog.unnest(
               COALESCE(function_catalog.proconfig, ARRAY[]::text[])
             ) WITH ORDINALITY AS setting(value, ordinality)
            WHERE setting.value LIKE 'search_path=%'
         ), ARRAY[]::text[]),
         pg_catalog.has_function_privilege(
           'service_role', function_catalog.oid, 'EXECUTE'
         ),
         pg_catalog.has_function_privilege(
           'anon', function_catalog.oid, 'EXECUTE'
         ),
         pg_catalog.has_function_privilege(
           'authenticated', function_catalog.oid, 'EXECUTE'
         ),
         position('request.jwt.claims' IN function_catalog.definition) > 0,
         position('request.jwt.claim.role' IN function_catalog.definition) > 0,
         position('auth.role()' IN function_catalog.definition) > 0,
         position(
           'FOR SHARE' IN pg_catalog.upper(function_catalog.definition)
         ) > 0,
         pg_catalog.has_schema_privilege(
           'privacy_workflow_owner', 'auth', 'USAGE'
         ),
         EXISTS (
           SELECT 1
             FROM privacy_retention.g014_public_rpc_allowlist AS allowed
            WHERE allowed.source_signature =
              'public.apply_admin_restaurant_map_overlay_action(uuid,text,uuid,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,uuid,text,jsonb)'
              AND allowed.grantee = 'service_role'
         )
       )::text
  FROM function_catalog
 ORDER BY function_catalog.receipt_signature;

WITH relation_role_contract(relation_name, role_name) AS (
  VALUES
    ('admin_restaurant_map_overlay_audit_events', 'anon'),
    ('admin_restaurant_map_overlay_audit_events', 'authenticated'),
    ('admin_restaurant_map_overlay_audit_events', 'privacy_workflow_owner'),
    ('admin_restaurant_map_overlay_audit_events', 'service_role'),
    ('admin_restaurant_map_overlays', 'anon'),
    ('admin_restaurant_map_overlays', 'authenticated'),
    ('admin_restaurant_map_overlays', 'privacy_workflow_owner'),
    ('admin_restaurant_map_overlays', 'service_role'),
    ('restaurants', 'privacy_workflow_owner')
)
SELECT json_build_array(
         'admin_map_overlay_table_grants',
         relation_role_contract.relation_name,
         relation_role_contract.role_name,
         pg_catalog.has_table_privilege(
           relation_role_contract.role_name,
           'public.' || relation_role_contract.relation_name,
           'SELECT'
         ),
         pg_catalog.has_table_privilege(
           relation_role_contract.role_name,
           'public.' || relation_role_contract.relation_name,
           'INSERT'
         ),
         pg_catalog.has_table_privilege(
           relation_role_contract.role_name,
           'public.' || relation_role_contract.relation_name,
           'UPDATE'
         ),
         pg_catalog.has_table_privilege(
           relation_role_contract.role_name,
           'public.' || relation_role_contract.relation_name,
           'DELETE'
         ),
         pg_catalog.has_table_privilege(
           relation_role_contract.role_name,
           'public.' || relation_role_contract.relation_name,
           'TRUNCATE'
         ),
         pg_catalog.has_table_privilege(
           relation_role_contract.role_name,
           'public.' || relation_role_contract.relation_name,
           'REFERENCES'
         ),
         pg_catalog.has_table_privilege(
           relation_role_contract.role_name,
           'public.' || relation_role_contract.relation_name,
           'TRIGGER'
         )
       )::text
  FROM relation_role_contract
 ORDER BY relation_role_contract.relation_name,
          relation_role_contract.role_name;

SELECT json_build_array(
         'admin_map_overlay_policies',
         relation_row.relname,
         policy_row.polname,
         CASE policy_row.polcmd
           WHEN 'r' THEN 'SELECT'
           WHEN 'a' THEN 'INSERT'
           WHEN 'w' THEN 'UPDATE'
           WHEN 'd' THEN 'DELETE'
           ELSE 'ALL'
         END,
         COALESCE((
           SELECT array_agg(role_row.rolname ORDER BY role_row.rolname)
             FROM pg_catalog.unnest(policy_row.polroles) AS role_id(oid)
             JOIN pg_catalog.pg_roles AS role_row ON role_row.oid = role_id.oid
         ), ARRAY[]::text[]),
         regexp_replace(
           pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid),
           '[[:space:]]+', ' ', 'g'
         ),
         regexp_replace(
           pg_catalog.pg_get_expr(
             policy_row.polwithcheck, policy_row.polrelid
           ),
           '[[:space:]]+', ' ', 'g'
         )
       )::text
  FROM pg_catalog.pg_policy AS policy_row
  JOIN pg_catalog.pg_class AS relation_row
    ON relation_row.oid = policy_row.polrelid
  JOIN pg_catalog.pg_namespace AS schema_row
    ON schema_row.oid = relation_row.relnamespace
 WHERE schema_row.nspname = 'public'
   AND relation_row.relname IN (
     'admin_restaurant_map_overlays',
     'admin_restaurant_map_overlay_audit_events'
   )
 ORDER BY relation_row.relname, policy_row.polname;

WITH expected(signature) AS (VALUES
  ('public.finish_review_media_cleanup()'),
  ('public.mutate_review_with_media(uuid,uuid,text,timestamp with time zone,text,text[],text[])'),
  ('public.pending_review_media_cleanup()'),
  ('public.queue_review_upload_cleanup(uuid,text[])'),
  ('public.read_review_media_commit(uuid,uuid,text)'),
  ('public.review_media_delete_allowed(text)'),
  ('review_media_private.canonical(text,uuid,uuid,text)'),
  ('review_media_private.guard_references()'),
  ('review_media_private.lock_changes()'),
  ('review_media_private.owned_legacy(text,uuid,text)'),
  ('review_media_private.reference_key(text)'),
  ('review_media_private.referenced(text)')
)
SELECT json_build_array('review_media_functions', e.signature, pg_get_userbyid(p.proowner),
  pg_get_function_result(p.oid), p.prosecdef, p.provolatile::text, p.proconfig,
  encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),
  has_function_privilege('anon',p.oid,'EXECUTE'), has_function_privilege('authenticated',p.oid,'EXECUTE'),
  has_function_privilege('service_role',p.oid,'EXECUTE'),
  coalesce((SELECT array_agg(a.grantee::text ORDER BY a.grantee) FROM privacy_retention.g014_public_rpc_allowlist a
    WHERE a.source_signature=e.signature),ARRAY[]::text[]))::text
FROM expected e JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
ORDER BY e.signature;

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

SELECT json_build_array('user_roles', 'nightly-ci', role_row.role::text)::text
  FROM public.user_roles AS role_row
  JOIN auth.users AS user_row ON user_row.id = role_row.user_id
 WHERE user_row.email = 'nightly-ci@local.invalid'
 ORDER BY role_row.role::text;

SELECT json_build_array('user_account_status', 'nightly-ci', status_row.account_status,
                        (status_row.disabled_at IS NULL))::text
  FROM public.user_account_status AS status_row
  JOIN auth.users AS user_row ON user_row.id = status_row.user_id
 WHERE user_row.email = 'nightly-ci@local.invalid'
 ORDER BY status_row.account_status;

-- Synthetic local eligibility only. The stored operator reference is included
-- so receipt admission cannot erase or reinterpret its NOT_PRODUCTION scope.
SELECT json_build_array(
         'privacy_policy_fixture',
         'local-nightly-policy',
         policy_row.version,
         policy_row.locale,
         policy_row.status,
         policy_row.content_sha256,
         to_char(policy_row.effective_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         to_char(policy_row.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         policy_row.operator_approval_ref,
         (policy_row.supersedes_id IS NULL)
       )::text
  FROM privacy_retention.privacy_policy_versions AS policy_row
 ORDER BY policy_row.version;

SELECT json_build_array(
         'privacy_age_profile',
         'nightly-ci',
         age_row.age_band,
         age_row.method,
         age_row.status,
         policy_row.version,
         to_char(age_row.attested_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
         to_char(age_row.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
       )::text
  FROM privacy_retention.privacy_age_profiles AS age_row
  JOIN privacy_retention.privacy_policy_versions AS policy_row
    ON policy_row.id = age_row.policy_version_id
  JOIN auth.users AS user_row ON user_row.id = age_row.user_id
 WHERE user_row.email = 'nightly-ci@local.invalid'
 ORDER BY user_row.email;

SELECT json_build_array(
         'youtube_channel_snapshot',
         'local-nightly-channel-snapshot',
         channel_row.channel_id,
         channel_row.channel_title,
         channel_row.channel_handle,
         channel_row.subscriber_count,
         channel_row.view_count,
         channel_row.video_count,
         channel_row.hidden_subscriber_count,
         (channel_row.previous_bucket_started_at IS NULL),
         channel_row.subscriber_delta,
         channel_row.view_delta,
         channel_row.video_delta,
         to_char(
           channel_row.bucket_started_at AT TIME ZONE 'UTC',
           'YYYY-MM-DD"T"HH24:MI:SS"Z"'
         ),
         to_char(
           channel_row.fetched_at AT TIME ZONE 'UTC',
           'YYYY-MM-DD"T"HH24:MI:SS"Z"'
         ),
         channel_row.source
       )::text
  FROM public.youtube_channel_kpi_snapshots AS channel_row
 ORDER BY channel_row.id;

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
 ORDER BY publication_table.pubname, publication_table.schemaname, publication_table.tablename;

COMMIT;
