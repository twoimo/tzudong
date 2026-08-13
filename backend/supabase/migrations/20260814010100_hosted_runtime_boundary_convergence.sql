-- Converge only runtime objects that exist in the canonical local chain but
-- were never applied to the exact 50-row hosted predecessor.  Existing applied
-- migrations and provider-owned history remain immutable.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('tzudong:hosted-runtime-boundary-convergence:v1', 0)
);

DO $ledger_preflight$
DECLARE
  v_predecessor_statements text[];
BEGIN
  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL
     OR (SELECT pg_catalog.count(*) FROM supabase_migrations.schema_migrations) <> 51
     OR NOT EXISTS (
       SELECT 1
       FROM supabase_migrations.schema_migrations
       WHERE version::text = '20260814010000'
         AND name::text = 'hosted_g016_g041_catalog_reconciliation'
     )
     OR EXISTS (
       SELECT 1
       FROM supabase_migrations.schema_migrations
       WHERE version::text > '20260814010000'
     ) THEN
    RAISE EXCEPTION 'hosted_runtime_exact_51_ledger_drift';
  END IF;

  SELECT statements INTO v_predecessor_statements
  FROM supabase_migrations.schema_migrations
  WHERE version::text = '20260814010000'
    AND name::text = 'hosted_g016_g041_catalog_reconciliation';

  IF pg_catalog.cardinality(v_predecessor_statements) <> 41
     OR pg_catalog.encode(
       pg_catalog.sha256(
         pg_catalog.convert_to(
           pg_catalog.to_json(v_predecessor_statements)::text,
           'UTF8'
         )
       ),
       'hex'
     ) IS DISTINCT FROM
       'e6e5f5152719f4c7cad308be0f95eebe1944ed8a7986b144a01b7878542ac2c8' THEN
    RAISE EXCEPTION 'hosted_runtime_predecessor_statement_vector_drift';
  END IF;
END
$ledger_preflight$;

DO $runtime_preflight$
DECLARE
  v_overlay oid := pg_catalog.to_regprocedure(
    'public.apply_admin_restaurant_map_overlay_action(uuid,text,uuid,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,uuid,text,jsonb)'
  );
  v_incident oid := pg_catalog.to_regprocedure(
    'public.privacy_incident_require_admin(uuid)'
  );
  v_expected record;
BEGIN
  IF pg_catalog.to_regrole('privacy_workflow_owner') IS NULL
     OR pg_catalog.to_regrole('service_role') IS NULL
     OR pg_catalog.to_regrole('anon') IS NULL
     OR pg_catalog.to_regrole('authenticated') IS NULL
     OR pg_catalog.to_regrole('privacy_auth_bridge') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.g014_public_rpc_allowlist') IS NULL
     OR pg_catalog.to_regprocedure('privacy_retention.assert_g014_public_rpc_allowlist()') IS NULL
     OR pg_catalog.to_regprocedure('privacy_retention.assert_g014_definer_contract()') IS NULL
     OR pg_catalog.to_regprocedure('privacy_retention.assert_g014_catalog_contract()') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.reviews') IS NULL
     OR pg_catalog.to_regclass('public.user_roles') IS NULL
     OR pg_catalog.to_regclass('public.user_account_status') IS NULL
     OR pg_catalog.to_regclass('public.admin_audit_events') IS NULL
     OR pg_catalog.to_regclass('public.announcements') IS NULL
     OR pg_catalog.to_regclass('public.ad_banners') IS NULL
     OR pg_catalog.to_regclass('public.admin_restaurant_map_overlays') IS NULL
     OR pg_catalog.to_regclass('public.admin_restaurant_map_overlay_audit_events') IS NULL
     OR pg_catalog.to_regclass('public.restaurants') IS NULL
     OR pg_catalog.to_regclass('provider_budget_private.admin_provider_budget_policies') IS NULL
     OR pg_catalog.to_regclass('storage.buckets') IS NULL
     OR pg_catalog.to_regclass('storage.objects') IS NULL
     OR pg_catalog.to_regprocedure('public.admin_user_audit_event_is_safe(text,text,text,text,jsonb,jsonb,jsonb,jsonb,text,text,text)') IS NULL
     OR pg_catalog.to_regprocedure('public.is_user_admin(uuid)') IS NULL
     OR v_overlay IS NULL
     OR v_incident IS NULL THEN
    RAISE EXCEPTION 'hosted_runtime_prerequisite_missing';
  END IF;

  IF pg_catalog.to_regclass('public.admin_storyboard_jobs') IS NOT NULL
     OR pg_catalog.to_regclass('public.youtube_thumbnail_releases') IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.publish_youtube_thumbnail_release(uuid,text,text,text,text,text,text,text,text,numeric,jsonb,jsonb,jsonb,jsonb,uuid,timestamptz)'
     ) IS NOT NULL
     OR pg_catalog.to_regprocedure('public.is_current_user_active_admin()') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.read_admin_user_management_metadata(uuid[])') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.read_admin_user_ids_for_management()') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.read_admin_user_audit_events(integer)') IS NOT NULL
     OR pg_catalog.to_regprocedure(
       'public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamptz,text,uuid,text,text)'
     ) IS NOT NULL THEN
    RAISE EXCEPTION 'hosted_runtime_new_identity_already_exists';
  END IF;

  FOR v_expected IN
    SELECT expected.function_oid,
           expected.source_sha256,
           expected.grantees,
           expected.return_type,
           expected.returns_set
    FROM (
      VALUES
        (
          v_overlay,
          'f5b6b36fd8394c8151406b42cabbd47301d23c092828129262cfc8ccab4f36d3'::text,
          ARRAY['privacy_workflow_owner', 'service_role']::name[],
          'jsonb'::pg_catalog.regtype,
          false
        ),
        (
          v_incident,
          '40e35587fad6e34c4f124d41d536bdc6c8a39f31686c33fb308256b6c110e409'::text,
          ARRAY['postgres', 'privacy_workflow_owner']::name[],
          'void'::pg_catalog.regtype,
          false
        )
    ) AS expected(
      function_oid, source_sha256, grantees, return_type, returns_set
    )
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      WHERE procedure.oid = v_expected.function_oid
        AND procedure.proowner = 'privacy_workflow_owner'::pg_catalog.regrole
        AND procedure.prosecdef
        AND procedure.provolatile = 'v'
        AND procedure.prokind = 'f'
        AND NOT procedure.proleakproof
        AND procedure.proparallel = 'u'
        AND procedure.prolang = (
          SELECT language.oid
          FROM pg_catalog.pg_language AS language
          WHERE language.lanname = 'plpgsql'
        )
        AND procedure.prorettype = v_expected.return_type
        AND procedure.proretset = v_expected.returns_set
        AND procedure.proconfig IS NOT DISTINCT FROM
          ARRAY['search_path=""']::text[]
        AND pg_catalog.encode(
          pg_catalog.sha256(
            pg_catalog.convert_to(procedure.prosrc, 'UTF8')
          ),
          'hex'
        ) = v_expected.source_sha256
    ) OR EXISTS (
      WITH expected(grantee, is_grantable) AS (
        SELECT grantee, false AS is_grantable
        FROM pg_catalog.unnest(v_expected.grantees) AS grantee
      ), actual(grantee, is_grantable) AS (
        SELECT
          CASE WHEN acl.grantee = 0 THEN 'PUBLIC'::name
               ELSE pg_catalog.pg_get_userbyid(acl.grantee)::name END,
          acl.is_grantable
        FROM pg_catalog.pg_proc AS procedure
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
        WHERE procedure.oid = v_expected.function_oid
          AND acl.privilege_type = 'EXECUTE'
      )
      SELECT 1
      FROM (
        (SELECT * FROM expected EXCEPT SELECT * FROM actual)
        UNION ALL
        (SELECT * FROM actual EXCEPT SELECT * FROM expected)
      ) AS difference
    ) THEN
      RAISE EXCEPTION 'hosted_runtime_existing_function_identity_drift: %',
        v_expected.function_oid::pg_catalog.regprocedure;
    END IF;
  END LOOP;

  IF (
    SELECT pg_catalog.pg_get_constraintdef(constraint_row.oid, true)
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid =
      'provider_budget_private.admin_provider_budget_policies'::pg_catalog.regclass
      AND constraint_row.conname =
        'admin_provider_budget_policies_provider_check'
  ) IS DISTINCT FROM
    'CHECK ((provider = ANY (ARRAY[''naver_local_search''::text, ''naver_geocode''::text, ''youtube_metadata''::text])))'
     OR (SELECT pg_catalog.count(*) FROM provider_budget_private.admin_provider_budget_policies) <> 3
     OR EXISTS (
       SELECT 1
       FROM provider_budget_private.admin_provider_budget_policies
       WHERE (provider, actor_per_minute, global_per_minute, global_per_day)
         NOT IN (
           ('naver_local_search', 30, 300, 20000),
           ('naver_geocode', 60, 600, 20000),
           ('youtube_metadata', 30, 300, 9000)
         )
     ) THEN
    RAISE EXCEPTION 'hosted_runtime_provider_budget_prerequisite_drift';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.profiles', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.reviews', 'SELECT'
     )
     OR pg_catalog.has_table_privilege('anon', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('service_role', 'public.profiles', 'SELECT') THEN
    RAISE EXCEPTION 'hosted_runtime_profile_acl_prerequisite_drift';
  END IF;
END
$runtime_preflight$;

DO $profile_relation_preflight$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_class AS relation_row
    WHERE relation_row.oid IN (
      'public.profiles'::pg_catalog.regclass,
      'public.reviews'::pg_catalog.regclass
    )
      AND relation_row.relkind = 'r'
      AND relation_row.relowner = 'postgres'::pg_catalog.regrole
      AND relation_row.relrowsecurity
      AND relation_row.relforcerowsecurity
  ) <> 2
     OR EXISTS (
       WITH expected(relation_oid, grantee, privileges) AS (
         VALUES
           (
             'public.profiles'::pg_catalog.regclass::oid,
             'postgres'::name,
             ARRAY[
               'DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES',
               'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'
             ]::text[]
           ),
           (
             'public.profiles'::pg_catalog.regclass::oid,
             'privacy_workflow_owner'::name,
             ARRAY['SELECT', 'UPDATE']::text[]
           ),
           (
             'public.reviews'::pg_catalog.regclass::oid,
             'anon'::name,
             ARRAY['SELECT']::text[]
           ),
           (
             'public.reviews'::pg_catalog.regclass::oid,
             'authenticated'::name,
             ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]
           ),
           (
             'public.reviews'::pg_catalog.regclass::oid,
             'postgres'::name,
             ARRAY[
               'DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES',
               'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'
             ]::text[]
           ),
           (
             'public.reviews'::pg_catalog.regclass::oid,
             'privacy_workflow_owner'::name,
             ARRAY['DELETE', 'SELECT']::text[]
           ),
           (
             'public.reviews'::pg_catalog.regclass::oid,
             'service_role'::name,
             ARRAY[
               'DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES',
               'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'
             ]::text[]
           )
       ), expected_acl(
         relation_oid, grantee, privilege_type, is_grantable
       ) AS (
         SELECT expected.relation_oid,
                expected.grantee,
                privilege.privilege_type,
                false
         FROM expected
         CROSS JOIN LATERAL pg_catalog.unnest(expected.privileges)
           AS privilege(privilege_type)
       ), actual_acl(
         relation_oid, grantee, privilege_type, is_grantable
       ) AS (
         SELECT relation_row.oid,
                CASE WHEN acl.grantee = 0 THEN 'PUBLIC'::name
                     ELSE pg_catalog.pg_get_userbyid(acl.grantee)::name END,
                acl.privilege_type,
                acl.is_grantable
         FROM pg_catalog.pg_class AS relation_row
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             relation_row.relacl,
             pg_catalog.acldefault('r', relation_row.relowner)
           )
         ) AS acl
         WHERE relation_row.oid IN (
           'public.profiles'::pg_catalog.regclass,
           'public.reviews'::pg_catalog.regclass
         )
       )
       SELECT 1
       FROM (
         (SELECT * FROM expected_acl EXCEPT SELECT * FROM actual_acl)
         UNION ALL
         (SELECT * FROM actual_acl EXCEPT SELECT * FROM expected_acl)
       ) AS difference
     ) THEN
    RAISE EXCEPTION 'hosted_runtime_profile_relation_prerequisite_drift';
  END IF;
END
$profile_relation_preflight$;

DO $membership$
BEGIN
  IF session_user IS DISTINCT FROM 'postgres'
     OR current_user IS DISTINCT FROM 'postgres'
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_roles AS role_row
       WHERE role_row.rolname = 'postgres'
         AND NOT role_row.rolsuper
         AND role_row.rolcreaterole
     )
     OR pg_catalog.pg_has_role('postgres', 'supabase_admin', 'MEMBER')
     OR pg_catalog.pg_has_role('postgres', 'supabase_admin', 'USAGE')
     OR pg_catalog.pg_has_role('postgres', 'supabase_admin', 'SET')
     OR EXISTS (
       WITH expected(
         role_name, member_name, grantor_name,
         admin_option, inherit_option, set_option
       ) AS (
         VALUES
           (
             'privacy_workflow_owner'::name,
             'postgres'::name,
             'supabase_admin'::name,
             true, false, false
           ),
           (
             'privacy_workflow_owner'::name,
             'postgres'::name,
             'postgres'::name,
             false, true, false
           ),
           (
             'privacy_workflow_owner'::name,
             'privacy_auth_bridge'::name,
             'postgres'::name,
             false, true, true
           )
       ), actual AS (
         SELECT pg_catalog.pg_get_userbyid(membership.roleid)::name,
                pg_catalog.pg_get_userbyid(membership.member)::name,
                pg_catalog.pg_get_userbyid(membership.grantor)::name,
                membership.admin_option,
                membership.inherit_option,
                membership.set_option
         FROM pg_catalog.pg_auth_members AS membership
         WHERE membership.roleid =
                 'privacy_workflow_owner'::pg_catalog.regrole
            OR membership.member =
                 'privacy_workflow_owner'::pg_catalog.regrole
       )
       SELECT 1
       FROM (
         (SELECT * FROM expected EXCEPT SELECT * FROM actual)
         UNION ALL
         (SELECT * FROM actual EXCEPT SELECT * FROM expected)
       ) AS difference
     ) THEN
    RAISE EXCEPTION 'hosted_runtime_membership_prerequisite_drift';
  END IF;

  EXECUTE pg_catalog.format(
    'GRANT privacy_workflow_owner TO %I '
    || 'WITH ADMIN FALSE, INHERIT TRUE, SET TRUE GRANTED BY %I',
    session_user,
    session_user
  );

  IF EXISTS (
    WITH expected(
      role_name, member_name, grantor_name,
      admin_option, inherit_option, set_option
    ) AS (
      VALUES
        (
          'privacy_workflow_owner'::name,
          'postgres'::name,
          'supabase_admin'::name,
          true, false, false
        ),
        (
          'privacy_workflow_owner'::name,
          'postgres'::name,
          'postgres'::name,
          false, true, true
        ),
        (
          'privacy_workflow_owner'::name,
          'privacy_auth_bridge'::name,
          'postgres'::name,
          false, true, true
        )
    ), actual AS (
      SELECT pg_catalog.pg_get_userbyid(membership.roleid)::name,
             pg_catalog.pg_get_userbyid(membership.member)::name,
             pg_catalog.pg_get_userbyid(membership.grantor)::name,
             membership.admin_option,
             membership.inherit_option,
             membership.set_option
      FROM pg_catalog.pg_auth_members AS membership
      WHERE membership.roleid =
              'privacy_workflow_owner'::pg_catalog.regrole
         OR membership.member =
              'privacy_workflow_owner'::pg_catalog.regrole
    )
    SELECT 1
    FROM (
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    ) AS difference
  ) THEN
    RAISE EXCEPTION 'hosted_runtime_membership_acquire_drift';
  END IF;
END
$membership$;

CREATE TABLE public.admin_storyboard_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_by_admin_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'claimed', 'succeeded', 'failed', 'cancelled')),
  stage text NOT NULL DEFAULT 'queued',
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_payload jsonb,
  error_code text,
  readiness jsonb NOT NULL DEFAULT
    '{"status":"queued","providerCache":"bypass","fallbackReasonCode":"storyboard_async_worker_pending"}'::jsonb,
  claimed_by text,
  claimed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.timezone('utc', pg_catalog.now()),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.timezone('utc', pg_catalog.now())
);
CREATE INDEX admin_storyboard_jobs_requested_created_idx
  ON public.admin_storyboard_jobs (requested_by_admin_id, created_at DESC, id DESC);
CREATE INDEX admin_storyboard_jobs_status_created_idx
  ON public.admin_storyboard_jobs (status, created_at ASC, id ASC);
ALTER TABLE public.admin_storyboard_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_storyboard_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.admin_storyboard_jobs TO service_role;
CREATE POLICY admin_storyboard_jobs_service_role_all
  ON public.admin_storyboard_jobs FOR ALL TO service_role
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

ALTER TABLE provider_budget_private.admin_provider_budget_policies
  DROP CONSTRAINT admin_provider_budget_policies_provider_check;
ALTER TABLE provider_budget_private.admin_provider_budget_policies
  ADD CONSTRAINT admin_provider_budget_policies_provider_check CHECK (
    provider IN (
      'naver_local_search', 'naver_geocode', 'youtube_metadata',
      'naver_directions', 'openai_sponsor_analysis'
    )
  );
ALTER TABLE provider_budget_private.admin_provider_budget_policies
  DISABLE TRIGGER admin_provider_budget_policies_immutable;
INSERT INTO provider_budget_private.admin_provider_budget_policies (
  provider, actor_per_minute, global_per_minute, global_per_day
) VALUES
  ('naver_directions', 20, 200, 10000),
  ('openai_sponsor_analysis', 10, 100, 1000);
ALTER TABLE provider_budget_private.admin_provider_budget_policies
  ENABLE TRIGGER admin_provider_budget_policies_immutable;

CREATE TABLE public.youtube_thumbnail_releases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  release_key text NOT NULL DEFAULT 'youtube-thumbnail-generator/current',
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'superseded', 'revoked')),
  candidate_id text NOT NULL,
  source_manifest_id text NOT NULL,
  source_image_id text NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'youtube-thumbnail-releases'
    CHECK (storage_bucket = 'youtube-thumbnail-releases'),
  storage_object_path text NOT NULL,
  browser_image_path text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  width integer NOT NULL DEFAULT 1280 CHECK (width = 1280),
  height integer NOT NULL DEFAULT 720 CHECK (height = 720),
  mime_type text NOT NULL DEFAULT 'image/png' CHECK (mime_type = 'image/png'),
  provider_id text NOT NULL DEFAULT 'local-codex' CHECK (provider_id = 'local-codex'),
  model text NOT NULL DEFAULT 'gpt-image-2' CHECK (model = 'gpt-image-2'),
  model_provenance text NOT NULL DEFAULT 'exact' CHECK (model_provenance = 'exact'),
  score numeric NOT NULL CHECK (score >= 90),
  issue_tags jsonb NOT NULL DEFAULT '["none"]'::jsonb
    CHECK (issue_tags = '["none"]'::jsonb),
  text_layers jsonb NOT NULL DEFAULT '[]'::jsonb,
  canvas jsonb NOT NULL DEFAULT '{"width":1280,"height":720}'::jsonb,
  source_quality_gate jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  published_at timestamptz NOT NULL DEFAULT pg_catalog.timezone('utc', pg_catalog.now()),
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.timezone('utc', pg_catalog.now()),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.timezone('utc', pg_catalog.now()),
  CONSTRAINT youtube_thumbnail_releases_browser_proxy CHECK (
    browser_image_path ~ '^/api/admin/youtube-thumbnail-generator/releases/assets/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT youtube_thumbnail_releases_storage_object_path CHECK (
    storage_object_path ~ '^youtube-thumbnail-generator/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.png$'
  ),
  CONSTRAINT youtube_thumbnail_releases_no_raw_paths CHECK (
    storage_object_path NOT LIKE '%.omx/%'
    AND storage_object_path NOT LIKE '%/public/%'
    AND browser_image_path NOT LIKE '%.omx/%'
    AND browser_image_path NOT LIKE '%/public/%'
  )
);
CREATE UNIQUE INDEX youtube_thumbnail_releases_active_key_idx
  ON public.youtube_thumbnail_releases (release_key) WHERE status = 'active';
CREATE INDEX youtube_thumbnail_releases_key_published_idx
  ON public.youtube_thumbnail_releases (release_key, published_at DESC);
CREATE INDEX youtube_thumbnail_releases_candidate_idx
  ON public.youtube_thumbnail_releases (candidate_id);
ALTER TABLE public.youtube_thumbnail_releases ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.youtube_thumbnail_releases FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.youtube_thumbnail_releases TO service_role;

CREATE FUNCTION public.publish_youtube_thumbnail_release(
  p_id uuid,
  p_release_key text,
  p_candidate_id text,
  p_source_manifest_id text,
  p_source_image_id text,
  p_storage_bucket text,
  p_storage_object_path text,
  p_browser_image_path text,
  p_sha256 text,
  p_score numeric,
  p_issue_tags jsonb,
  p_text_layers jsonb,
  p_canvas jsonb,
  p_source_quality_gate jsonb,
  p_published_by uuid,
  p_published_at timestamptz
)
RETURNS public.youtube_thumbnail_releases
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_release public.youtube_thumbnail_releases;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_release_key, 0)
  );
  UPDATE public.youtube_thumbnail_releases
  SET status = 'superseded', superseded_at = p_published_at,
      updated_at = p_published_at
  WHERE release_key = p_release_key AND status = 'active';
  INSERT INTO public.youtube_thumbnail_releases (
    id, release_key, status, candidate_id, source_manifest_id, source_image_id,
    storage_bucket, storage_object_path, browser_image_path, sha256,
    width, height, mime_type, provider_id, model, model_provenance,
    score, issue_tags, text_layers, canvas, source_quality_gate,
    published_by, published_at, created_at, updated_at
  ) VALUES (
    p_id, p_release_key, 'active', p_candidate_id, p_source_manifest_id,
    p_source_image_id, p_storage_bucket, p_storage_object_path,
    p_browser_image_path, p_sha256, 1280, 720, 'image/png', 'local-codex',
    'gpt-image-2', 'exact', p_score, p_issue_tags, p_text_layers, p_canvas,
    p_source_quality_gate, p_published_by, p_published_at,
    p_published_at, p_published_at
  ) RETURNING * INTO v_release;
  RETURN v_release;
END;
$function$;
ALTER FUNCTION public.publish_youtube_thumbnail_release(
  uuid, text, text, text, text, text, text, text, text, numeric,
  jsonb, jsonb, jsonb, jsonb, uuid, timestamptz
) OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.publish_youtube_thumbnail_release(
  uuid, text, text, text, text, text, text, text, text, numeric,
  jsonb, jsonb, jsonb, jsonb, uuid, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_youtube_thumbnail_release(
  uuid, text, text, text, text, text, text, text, text, numeric,
  jsonb, jsonb, jsonb, jsonb, uuid, timestamptz
) TO service_role;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('profile-avatars', 'profile-avatars', true, 2097152, ARRAY['image/*']::text[]),
  ('review-photos', 'review-photos', true, 5242880, ARRAY['image/*']::text[]),
  ('ad-banner-images', 'ad-banner-images', true, 52428800, ARRAY['image/*', 'video/*']::text[]),
  ('youtube-thumbnail-releases', 'youtube-thumbnail-releases', false, 10485760, ARRAY['image/png']::text[])
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types,
  updated_at = pg_catalog.timezone('utc', pg_catalog.now());

DO $drop_storage_policies$
DECLARE
  v_policy text;
BEGIN
  FOREACH v_policy IN ARRAY ARRAY[
    'Admin delete access', 'Admin upload access',
    'Anyone can view review photos',
    'Authenticated users can upload review photos',
    'Public read access', 'Public read access for profile-avatars',
    'Users can delete own avatar', 'Users can delete own review photos',
    'Users can update own review photos', 'Users can upload own avatar',
    'tzudong_public_media_read', 'tzudong_profile_avatar_insert_own',
    'tzudong_profile_avatar_update_own', 'tzudong_profile_avatar_delete_own',
    'tzudong_review_photo_insert_own', 'tzudong_review_photo_update_own',
    'tzudong_review_photo_delete_own', 'tzudong_ad_banner_insert_admin',
    'tzudong_ad_banner_update_admin', 'tzudong_ad_banner_delete_admin'
  ] LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS %I ON storage.objects', v_policy
    );
  END LOOP;
END
$drop_storage_policies$;

CREATE POLICY tzudong_public_media_read
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id IN ('profile-avatars', 'review-photos', 'ad-banner-images'));
CREATE POLICY tzudong_profile_avatar_insert_own
  ON storage.objects FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'profile-avatars'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  );
CREATE POLICY tzudong_profile_avatar_update_own
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'profile-avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text))
  WITH CHECK (bucket_id = 'profile-avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text));
CREATE POLICY tzudong_profile_avatar_delete_own
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'profile-avatars' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text));
CREATE POLICY tzudong_review_photo_insert_own
  ON storage.objects FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'review-photos'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
  );
CREATE POLICY tzudong_review_photo_update_own
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'review-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text))
  WITH CHECK (bucket_id = 'review-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text));
CREATE POLICY tzudong_review_photo_delete_own
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'review-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid()::text));

CREATE POLICY tzudong_ad_banner_insert_admin
  ON storage.objects FOR INSERT TO authenticated WITH CHECK (
    bucket_id = 'ad-banner-images'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
    AND EXISTS (
      SELECT 1 FROM public.user_roles AS role_row
      JOIN public.user_account_status AS status_row USING (user_id)
      WHERE role_row.user_id = (SELECT auth.uid())
        AND role_row.role::text = 'admin'
        AND status_row.account_status = 'active'
        AND status_row.disabled_at IS NULL
    )
  );
CREATE POLICY tzudong_ad_banner_update_admin
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'ad-banner-images'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
    AND EXISTS (
      SELECT 1 FROM public.user_roles AS role_row
      JOIN public.user_account_status AS status_row USING (user_id)
      WHERE role_row.user_id = (SELECT auth.uid())
        AND role_row.role::text = 'admin'
        AND status_row.account_status = 'active'
        AND status_row.disabled_at IS NULL
    )
  )
  WITH CHECK (
    bucket_id = 'ad-banner-images'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
    AND EXISTS (
      SELECT 1 FROM public.user_roles AS role_row
      JOIN public.user_account_status AS status_row USING (user_id)
      WHERE role_row.user_id = (SELECT auth.uid())
        AND role_row.role::text = 'admin'
        AND status_row.account_status = 'active'
        AND status_row.disabled_at IS NULL
    )
  );
CREATE POLICY tzudong_ad_banner_delete_admin
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'ad-banner-images'
    AND (storage.foldername(name))[1] = (SELECT auth.uid()::text)
    AND EXISTS (
      SELECT 1 FROM public.user_roles AS role_row
      JOIN public.user_account_status AS status_row USING (user_id)
      WHERE role_row.user_id = (SELECT auth.uid())
        AND role_row.role::text = 'admin'
        AND status_row.account_status = 'active'
        AND status_row.disabled_at IS NULL
    )
  );

DO $realtime_convergence$
DECLARE
  v_table text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_publication
    WHERE pubname = 'supabase_realtime'
  ) THEN
    RAISE EXCEPTION 'hosted_runtime_supabase_realtime_missing';
  END IF;
  FOREACH v_table IN ARRAY ARRAY['notifications', 'review_likes', 'reviews']
  LOOP
    IF pg_catalog.to_regclass(pg_catalog.format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'hosted_runtime_realtime_table_missing: %', v_table;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public' AND tablename = v_table
    ) THEN
      EXECUTE pg_catalog.format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table
      );
    END IF;
  END LOOP;
END
$realtime_convergence$;

SET LOCAL ROLE privacy_workflow_owner;

CREATE FUNCTION public.is_current_user_active_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $function$
  SELECT (SELECT auth.uid()) IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.user_roles AS role_row
       JOIN public.user_account_status AS status_row USING (user_id)
       WHERE role_row.user_id = (SELECT auth.uid())
         AND role_row.role::text = 'admin'
         AND status_row.account_status = 'active'
         AND status_row.disabled_at IS NULL
     )
$function$;
REVOKE ALL ON FUNCTION public.is_current_user_active_admin()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_current_user_active_admin() TO authenticated;
REVOKE ALL ON FUNCTION public.is_user_admin(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_user_admin(uuid) TO privacy_workflow_owner;

RESET ROLE;

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_banners ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.announcements FROM anon, authenticated;
GRANT SELECT ON TABLE public.announcements TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.announcements TO authenticated;
REVOKE ALL ON TABLE public.ad_banners FROM anon, authenticated;
GRANT SELECT ON TABLE public.ad_banners TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.ad_banners TO authenticated;

DO $drop_public_admin_policies$
DECLARE
  v_target record;
BEGIN
  FOR v_target IN SELECT * FROM (VALUES
    ('announcements', 'Announcements select policy'),
    ('announcements', 'Admins can insert announcements'),
    ('announcements', 'Admins can update announcements'),
    ('announcements', 'Admins can delete announcements'),
    ('announcements', 'announcements_select_policy'),
    ('announcements', 'announcements_select_active'),
    ('announcements', 'announcements_select_admin'),
    ('announcements', 'announcements_insert_admin'),
    ('announcements', 'announcements_update_admin'),
    ('announcements', 'announcements_delete_admin'),
    ('announcements', 'tzudong_announcements_select_active'),
    ('announcements', 'tzudong_announcements_select_admin'),
    ('announcements', 'tzudong_announcements_insert_admin'),
    ('announcements', 'tzudong_announcements_update_admin'),
    ('announcements', 'tzudong_announcements_delete_admin'),
    ('ad_banners', 'ad_banners_select_combined'),
    ('ad_banners', 'ad_banners_select_active'),
    ('ad_banners', 'ad_banners_select_admin'),
    ('ad_banners', 'ad_banners_insert_admin'),
    ('ad_banners', 'ad_banners_update_admin'),
    ('ad_banners', 'ad_banners_delete_admin'),
    ('ad_banners', 'tzudong_ad_banners_select_active'),
    ('ad_banners', 'tzudong_ad_banners_select_admin'),
    ('ad_banners', 'tzudong_ad_banners_insert_admin'),
    ('ad_banners', 'tzudong_ad_banners_update_admin'),
    ('ad_banners', 'tzudong_ad_banners_delete_admin')
  ) AS target(relation_name, policy_name) LOOP
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS %I ON public.%I',
      v_target.policy_name, v_target.relation_name
    );
  END LOOP;
END
$drop_public_admin_policies$;

CREATE POLICY tzudong_announcements_select_active
  ON public.announcements FOR SELECT TO anon, authenticated USING (is_active = true);
CREATE POLICY tzudong_announcements_select_admin
  ON public.announcements FOR SELECT TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));
CREATE POLICY tzudong_announcements_insert_admin
  ON public.announcements FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_current_user_active_admin()));
CREATE POLICY tzudong_announcements_update_admin
  ON public.announcements FOR UPDATE TO authenticated
  USING ((SELECT public.is_current_user_active_admin()))
  WITH CHECK ((SELECT public.is_current_user_active_admin()));
CREATE POLICY tzudong_announcements_delete_admin
  ON public.announcements FOR DELETE TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));
CREATE POLICY tzudong_ad_banners_select_active
  ON public.ad_banners FOR SELECT TO anon, authenticated USING (is_active = true);
CREATE POLICY tzudong_ad_banners_select_admin
  ON public.ad_banners FOR SELECT TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));
CREATE POLICY tzudong_ad_banners_insert_admin
  ON public.ad_banners FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_current_user_active_admin()));
CREATE POLICY tzudong_ad_banners_update_admin
  ON public.ad_banners FOR UPDATE TO authenticated
  USING ((SELECT public.is_current_user_active_admin()))
  WITH CHECK ((SELECT public.is_current_user_active_admin()));
CREATE POLICY tzudong_ad_banners_delete_admin
  ON public.ad_banners FOR DELETE TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));

ALTER POLICY restaurant_refresh_candidates_admin_insert
  ON public.restaurant_refresh_candidates TO authenticated
  WITH CHECK ((SELECT public.is_current_user_active_admin()));
ALTER POLICY restaurant_refresh_candidates_admin_select
  ON public.restaurant_refresh_candidates TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));
ALTER POLICY restaurant_refresh_candidates_admin_update
  ON public.restaurant_refresh_candidates TO authenticated
  USING ((SELECT public.is_current_user_active_admin()))
  WITH CHECK ((SELECT public.is_current_user_active_admin()));
ALTER POLICY restaurant_refresh_runs_admin_insert
  ON public.restaurant_refresh_runs TO authenticated
  WITH CHECK ((SELECT public.is_current_user_active_admin()));
ALTER POLICY restaurant_refresh_runs_admin_select
  ON public.restaurant_refresh_runs TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));
ALTER POLICY restaurant_refresh_runs_admin_update
  ON public.restaurant_refresh_runs TO authenticated
  USING ((SELECT public.is_current_user_active_admin()))
  WITH CHECK ((SELECT public.is_current_user_active_admin()));
ALTER POLICY "Admins can view request review audit"
  ON public.restaurant_request_review_audit TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));
ALTER POLICY "Admins can update requests"
  ON public.restaurant_requests TO authenticated
  USING ((SELECT public.is_current_user_active_admin()))
  WITH CHECK ((SELECT public.is_current_user_active_admin()));
ALTER POLICY "Admins can view all requests"
  ON public.restaurant_requests TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));
ALTER POLICY "Restaurant requests select policy"
  ON public.restaurant_requests TO authenticated
  USING ((SELECT auth.uid()) = user_id OR (SELECT public.is_current_user_active_admin()));
ALTER POLICY "Admins can delete submission items"
  ON public.restaurant_submission_items TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));
ALTER POLICY "Admins can update submission items"
  ON public.restaurant_submission_items TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));
ALTER POLICY "Submission items insert policy"
  ON public.restaurant_submission_items TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.restaurant_submissions AS submission_row
      WHERE submission_row.id = submission_id
        AND submission_row.user_id = (SELECT auth.uid()))
    OR (SELECT public.is_current_user_active_admin())
  );
ALTER POLICY "Submission items select policy"
  ON public.restaurant_submission_items TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.restaurant_submissions AS submission_row
      WHERE submission_row.id = submission_id
        AND submission_row.user_id = (SELECT auth.uid()))
    OR (SELECT public.is_current_user_active_admin())
  );
ALTER POLICY "Admins can update all submissions"
  ON public.restaurant_submissions TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));
ALTER POLICY "Restaurant submissions select policy"
  ON public.restaurant_submissions TO authenticated
  USING ((SELECT auth.uid()) = user_id OR (SELECT public.is_current_user_active_admin()));
ALTER POLICY restaurants_authenticated_admin_update
  ON public.restaurants TO authenticated
  USING ((SELECT public.is_current_user_active_admin()))
  WITH CHECK ((SELECT public.is_current_user_active_admin()));
ALTER POLICY "Admins can delete short URLs"
  ON public.short_urls TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));

SET LOCAL ROLE privacy_workflow_owner;

CREATE OR REPLACE FUNCTION public.privacy_incident_require_admin(p_actor_user_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_claims jsonb;
  v_role text;
BEGIN
  BEGIN
    v_claims := COALESCE(
      NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb,
      '{}'::jsonb
    );
    v_role := COALESCE(
      NULLIF(v_claims ->> 'role', ''),
      NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
      ''
    );
  EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value THEN
    RAISE EXCEPTION 'privacy_incident_service_role_required' USING ERRCODE = 'P0001';
  END;
  IF v_role <> 'service_role' THEN
    RAISE EXCEPTION 'privacy_incident_service_role_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.user_roles AS role_row
    JOIN public.user_account_status AS status_row USING (user_id)
    WHERE role_row.user_id = p_actor_user_id
      AND role_row.role::text = 'admin'
      AND status_row.account_status = 'active'
      AND status_row.disabled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'privacy_incident_privacy_admin_required' USING ERRCODE = 'P0001';
  END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.privacy_incident_require_admin(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.privacy_incident_require_admin(uuid)
  TO privacy_workflow_owner;

CREATE FUNCTION public.read_admin_user_management_metadata(p_user_ids uuid[])
RETURNS TABLE (
  user_id uuid, username text, nickname text, avatar_url text,
  profile_role text, profile_created_at timestamptz,
  profile_updated_at timestamptz, is_admin boolean, account_status text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE
  v_count integer := pg_catalog.cardinality(p_user_ids);
BEGIN
  IF p_user_ids IS NULL OR v_count NOT BETWEEN 1 AND 200
     OR pg_catalog.array_position(p_user_ids, NULL::uuid) IS NOT NULL
     OR (SELECT count(DISTINCT requested.user_id)
         FROM pg_catalog.unnest(p_user_ids) AS requested(user_id)) <> v_count THEN
    RAISE EXCEPTION 'admin_user_metadata_request_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT requested.user_id, profile_row.username,
    profile_row.nickname, profile_row.avatar_url, profile_row.role,
    profile_row.created_at, profile_row.updated_at,
    EXISTS (SELECT 1 FROM public.user_roles AS role_row
      WHERE role_row.user_id = requested.user_id AND role_row.role::text = 'admin'),
    status_row.account_status
  FROM pg_catalog.unnest(p_user_ids) WITH ORDINALITY AS requested(user_id, request_ordinal)
  LEFT JOIN public.profiles AS profile_row ON profile_row.user_id = requested.user_id
  LEFT JOIN public.user_account_status AS status_row ON status_row.user_id = requested.user_id
  ORDER BY requested.request_ordinal;
END;
$function$;

CREATE FUNCTION public.read_admin_user_ids_for_management()
RETURNS TABLE (user_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_count integer;
BEGIN
  SELECT count(*) INTO v_count FROM public.user_roles WHERE role::text = 'admin';
  IF v_count > 200 THEN
    RAISE EXCEPTION 'admin_user_id_count_exceeded' USING ERRCODE = '54000';
  END IF;
  RETURN QUERY SELECT role_row.user_id FROM public.user_roles AS role_row
    WHERE role_row.role::text = 'admin' ORDER BY role_row.user_id;
END;
$function$;

CREATE FUNCTION public.read_admin_user_audit_events(p_limit integer)
RETURNS TABLE (
  id uuid, actor_user_id uuid, target_user_id uuid, action text, reason text,
  status text, correlation_id uuid, applied_at timestamptz, error_code text,
  created_at timestamptz, audit_counts jsonb, audit_flags jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $function$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'admin_user_audit_limit_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT audit_row.id, audit_row.actor_user_id,
    audit_row.target_user_id, audit_row.action, audit_row.reason,
    audit_row.status, audit_row.correlation_id, audit_row.applied_at,
    audit_row.error_code, audit_row.created_at, audit_row.audit_counts,
    audit_row.audit_flags
  FROM public.admin_audit_events AS audit_row
  ORDER BY audit_row.created_at DESC, audit_row.id DESC LIMIT p_limit;
END;
$function$;

CREATE FUNCTION public.append_admin_user_audit_event(
  p_actor_user_id uuid, p_target_user_id uuid, p_action text, p_reason text,
  p_status text, p_correlation_id uuid, p_audit_counts jsonb,
  p_audit_flags jsonb, p_applied_at timestamptz, p_error_code text,
  p_request_id uuid, p_ip_hash text, p_user_agent_hash text
)
RETURNS uuid
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = ''
AS $function$
DECLARE v_audit_id uuid;
BEGIN
  IF p_actor_user_id IS NULL OR p_request_id IS NULL
     OR p_audit_counts IS NULL OR p_audit_flags IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM public.user_roles AS role_row
       JOIN public.user_account_status AS status_row USING (user_id)
       WHERE role_row.user_id = p_actor_user_id
         AND role_row.role::text = 'admin'
         AND status_row.account_status = 'active'
         AND status_row.disabled_at IS NULL
     )
     OR (p_status = 'applied') IS DISTINCT FROM (p_applied_at IS NOT NULL)
     OR NOT public.admin_user_audit_event_is_safe(
       p_action, p_status, p_reason, p_error_code, '{}'::jsonb, '{}'::jsonb,
       p_audit_counts, p_audit_flags, p_request_id::text,
       p_ip_hash, p_user_agent_hash
     ) THEN
    RAISE EXCEPTION 'admin_user_audit_event_invalid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.admin_audit_events (
    actor_user_id, target_user_id, action, reason, before_state, after_state,
    audit_counts, audit_flags, status, correlation_id, applied_at, error_code,
    request_id, ip_hash, user_agent_hash
  ) VALUES (
    p_actor_user_id, p_target_user_id, p_action, p_reason, '{}'::jsonb,
    '{}'::jsonb, p_audit_counts, p_audit_flags, p_status, p_correlation_id,
    p_applied_at, p_error_code, p_request_id::text, p_ip_hash, p_user_agent_hash
  ) RETURNING admin_audit_events.id INTO v_audit_id;
  RETURN v_audit_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.read_admin_user_management_metadata(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_admin_user_ids_for_management()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_admin_user_audit_events(integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.append_admin_user_audit_event(
  uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamptz,text,uuid,text,text
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_admin_user_management_metadata(uuid[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.read_admin_user_ids_for_management() TO service_role;
GRANT EXECUTE ON FUNCTION public.read_admin_user_audit_events(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.append_admin_user_audit_event(
  uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamptz,text,uuid,text,text
) TO service_role;

RESET ROLE;

-- Replace the hosted overlay body with the no-auth-schema canonical body by
-- sourcing the immutable local forward implementation.  Its full definition is
-- inserted below by this migration, never replayed as a prior migration.
DO $overlay_replacement_guard$
BEGIN
  IF pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to((
         SELECT procedure.prosrc FROM pg_catalog.pg_proc AS procedure
         WHERE procedure.oid =
           'public.apply_admin_restaurant_map_overlay_action(uuid,text,uuid,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,uuid,text,jsonb)'::pg_catalog.regprocedure
       ), 'UTF8')),
       'hex'
     ) IS DISTINCT FROM
       'f5b6b36fd8394c8151406b42cabbd47301d23c092828129262cfc8ccab4f36d3' THEN
    RAISE EXCEPTION 'hosted_runtime_overlay_replace_guard_drift';
  END IF;
END
$overlay_replacement_guard$;

SET LOCAL ROLE privacy_workflow_owner;

CREATE OR REPLACE FUNCTION public.apply_admin_restaurant_map_overlay_action(
  p_actor_user_id uuid,
  p_action text,
  p_restaurant_id uuid,
  p_overlay_type text,
  p_label text,
  p_description text,
  p_active_from timestamptz,
  p_active_until timestamptz,
  p_evidence jsonb,
  p_reason text,
  p_preview_hash text,
  p_payload_hash text,
  p_correlation_id uuid,
  p_idempotency_key text,
  p_request_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_claims jsonb;
  v_claims_role text;
  v_legacy_role text;
  v_restaurant public.restaurants%ROWTYPE;
  v_overlay_before public.admin_restaurant_map_overlays%ROWTYPE;
  v_overlay_after public.admin_restaurant_map_overlays%ROWTYPE;
  v_audit public.admin_restaurant_map_overlay_audit_events%ROWTYPE;
  v_before_snapshot jsonb := '{}'::jsonb;
  v_after_snapshot jsonb := '{}'::jsonb;
  v_request_metadata jsonb := '{}'::jsonb;
  v_now timestamptz := pg_catalog.timezone('utc'::text, pg_catalog.now());
BEGIN
  BEGIN
    v_claims := COALESCE(
      NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb,
      '{}'::jsonb
    );
    v_claims_role := NULLIF(v_claims ->> 'role', '');
    v_legacy_role := NULLIF(
      pg_catalog.current_setting('request.jwt.claim.role', true), ''
    );
  EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value THEN
    RAISE EXCEPTION 'overlay_service_role_required' USING ERRCODE = '42501';
  END;
  IF COALESCE(v_claims_role, v_legacy_role, '') <> 'service_role'
     OR (v_claims_role IS NOT NULL AND v_legacy_role IS NOT NULL
         AND v_claims_role <> v_legacy_role) THEN
    RAISE EXCEPTION 'overlay_service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_actor_user_id IS NULL THEN RAISE EXCEPTION 'overlay_actor_required'; END IF;
  IF p_action IS NULL OR p_action NOT IN ('upsert_overlay', 'deactivate_overlay') THEN
    RAISE EXCEPTION 'overlay_action_invalid';
  END IF;
  IF p_restaurant_id IS NULL THEN RAISE EXCEPTION 'overlay_restaurant_not_found'; END IF;
  IF p_overlay_type IS NULL OR p_overlay_type NOT IN ('trend', 'seasonal') THEN
    RAISE EXCEPTION 'overlay_type_invalid';
  END IF;
  IF p_action = 'upsert_overlay' AND (
    p_label IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_label)) < 1
    OR pg_catalog.char_length(pg_catalog.btrim(p_label)) > 80
  ) THEN RAISE EXCEPTION 'overlay_label_invalid'; END IF;
  IF p_description IS NOT NULL AND pg_catalog.char_length(p_description) > 500 THEN
    RAISE EXCEPTION 'overlay_description_invalid';
  END IF;
  IF p_active_from IS NOT NULL AND p_active_until IS NOT NULL
     AND p_active_from > p_active_until THEN
    RAISE EXCEPTION 'overlay_active_window_invalid';
  END IF;
  IF p_reason IS NULL OR pg_catalog.char_length(pg_catalog.btrim(p_reason)) < 1 THEN
    RAISE EXCEPTION 'overlay_reason_required';
  END IF;
  IF p_preview_hash IS NULL OR p_preview_hash !~ '^[0-9a-f]{64}$'
     OR p_payload_hash IS NULL OR p_payload_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'overlay_hash_invalid';
  END IF;
  IF p_correlation_id IS NULL OR p_idempotency_key IS NULL
     OR pg_catalog.char_length(pg_catalog.btrim(p_idempotency_key)) < 1 THEN
    RAISE EXCEPTION 'overlay_idempotency_invalid';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_actor_user_id::text || ':' || p_idempotency_key, 0)
  );
  SELECT * INTO v_audit
  FROM public.admin_restaurant_map_overlay_audit_events AS audit_row
  WHERE audit_row.actor_user_id = p_actor_user_id
    AND audit_row.idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_audit.payload_hash = p_payload_hash
       AND v_audit.correlation_id = p_correlation_id
       AND v_audit.restaurant_id = p_restaurant_id
       AND v_audit.overlay_type = p_overlay_type
       AND v_audit.action = p_action THEN
      RETURN pg_catalog.jsonb_build_object(
        'status', v_audit.status, 'replayed', true,
        'overlay', v_audit.after_snapshot, 'audit', pg_catalog.to_jsonb(v_audit),
        'readback', pg_catalog.jsonb_build_object(
          'matchedPayloadHash', true,
          'matchedPreviewHash', COALESCE(v_audit.request_metadata ->> 'previewHash', '') = p_preview_hash,
          'restaurantId', v_audit.restaurant_id, 'overlayType', v_audit.overlay_type
        )
      );
    END IF;
    RAISE EXCEPTION 'overlay_idempotency_conflict';
  END IF;
  SELECT * INTO v_restaurant FROM public.restaurants AS restaurant_row
  WHERE restaurant_row.id = p_restaurant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'overlay_restaurant_not_found'; END IF;
  SELECT * INTO v_overlay_before
  FROM public.admin_restaurant_map_overlays AS overlay_row
  WHERE overlay_row.restaurant_id = p_restaurant_id
    AND overlay_row.overlay_type = p_overlay_type FOR UPDATE;
  IF FOUND THEN
    v_before_snapshot := pg_catalog.to_jsonb(v_overlay_before);
  ELSIF p_action = 'deactivate_overlay' THEN
    RAISE EXCEPTION 'overlay_not_found_for_deactivate';
  END IF;
  IF p_action = 'upsert_overlay' THEN
    IF v_before_snapshot = '{}'::jsonb THEN
      INSERT INTO public.admin_restaurant_map_overlays (
        restaurant_id, overlay_type, label, description, active_from,
        active_until, evidence, is_active, created_by_admin_id, updated_by_admin_id
      ) VALUES (
        p_restaurant_id, p_overlay_type, pg_catalog.btrim(p_label), p_description,
        p_active_from, p_active_until, COALESCE(p_evidence, '{}'::jsonb), true,
        p_actor_user_id, p_actor_user_id
      ) RETURNING * INTO v_overlay_after;
    ELSE
      UPDATE public.admin_restaurant_map_overlays AS overlay_row SET
        label = pg_catalog.btrim(p_label), description = p_description,
        active_from = p_active_from, active_until = p_active_until,
        evidence = COALESCE(p_evidence, '{}'::jsonb), is_active = true,
        updated_by_admin_id = p_actor_user_id
      WHERE overlay_row.restaurant_id = p_restaurant_id
        AND overlay_row.overlay_type = p_overlay_type
      RETURNING * INTO v_overlay_after;
    END IF;
  ELSE
    UPDATE public.admin_restaurant_map_overlays AS overlay_row SET
      is_active = false,
      evidence = COALESCE(overlay_row.evidence, '{}'::jsonb)
        || pg_catalog.jsonb_build_object(
          'deactivatedAt', v_now, 'deactivationReason', pg_catalog.btrim(p_reason),
          'deactivationPreviewHash', p_preview_hash,
          'deactivationPayloadHash', p_payload_hash
        ),
      updated_by_admin_id = p_actor_user_id
    WHERE overlay_row.restaurant_id = p_restaurant_id
      AND overlay_row.overlay_type = p_overlay_type
    RETURNING * INTO v_overlay_after;
  END IF;
  v_after_snapshot := pg_catalog.to_jsonb(v_overlay_after);
  v_request_metadata := COALESCE(p_request_metadata, '{}'::jsonb)
    || pg_catalog.jsonb_build_object('previewHash', p_preview_hash);
  INSERT INTO public.admin_restaurant_map_overlay_audit_events (
    actor_user_id, action, restaurant_id, overlay_type, reason, before_snapshot,
    after_snapshot, correlation_id, idempotency_key, payload_hash,
    request_metadata, status
  ) VALUES (
    p_actor_user_id, p_action, p_restaurant_id, p_overlay_type,
    pg_catalog.btrim(p_reason), v_before_snapshot, v_after_snapshot,
    p_correlation_id, p_idempotency_key, p_payload_hash, v_request_metadata, 'applied'
  ) RETURNING * INTO v_audit;
  RETURN pg_catalog.jsonb_build_object(
    'status', 'applied', 'replayed', false, 'overlay', v_after_snapshot,
    'audit', pg_catalog.to_jsonb(v_audit),
    'readback', pg_catalog.jsonb_build_object(
      'matchedPayloadHash', v_audit.payload_hash = p_payload_hash,
      'matchedPreviewHash', COALESCE(v_audit.request_metadata ->> 'previewHash', '') = p_preview_hash,
      'restaurantId', v_overlay_after.restaurant_id,
      'overlayType', v_overlay_after.overlay_type
    )
  );
END;
$function$;
REVOKE ALL ON FUNCTION public.apply_admin_restaurant_map_overlay_action(
  uuid,text,uuid,text,text,text,timestamptz,timestamptz,jsonb,
  text,text,text,uuid,text,jsonb
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_admin_restaurant_map_overlay_action(
  uuid,text,uuid,text,text,text,timestamptz,timestamptz,jsonb,
  text,text,text,uuid,text,jsonb
) TO service_role;

RESET ROLE;

-- Exact owner-side table closure needed by the existing service-role-only RPC.
REVOKE ALL ON TABLE public.admin_restaurant_map_overlays
  FROM PUBLIC, anon, authenticated, privacy_workflow_owner;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON TABLE public.admin_restaurant_map_overlays FROM service_role;
GRANT SELECT ON TABLE public.admin_restaurant_map_overlays TO service_role;
GRANT SELECT, INSERT, UPDATE
  ON TABLE public.admin_restaurant_map_overlays TO privacy_workflow_owner;
REVOKE ALL ON TABLE public.admin_restaurant_map_overlay_audit_events
  FROM PUBLIC, anon, authenticated, service_role, privacy_workflow_owner;
GRANT SELECT, INSERT ON TABLE public.admin_restaurant_map_overlay_audit_events
  TO privacy_workflow_owner;

DROP POLICY IF EXISTS tzudong_admin_map_overlays_owner_select
  ON public.admin_restaurant_map_overlays;
DROP POLICY IF EXISTS tzudong_admin_map_overlays_owner_insert
  ON public.admin_restaurant_map_overlays;
DROP POLICY IF EXISTS tzudong_admin_map_overlays_owner_update
  ON public.admin_restaurant_map_overlays;
DROP POLICY IF EXISTS tzudong_admin_map_overlay_audit_owner_select
  ON public.admin_restaurant_map_overlay_audit_events;
DROP POLICY IF EXISTS tzudong_admin_map_overlay_audit_owner_insert
  ON public.admin_restaurant_map_overlay_audit_events;
CREATE POLICY tzudong_admin_map_overlays_owner_select
  ON public.admin_restaurant_map_overlays FOR SELECT TO privacy_workflow_owner USING (true);
CREATE POLICY tzudong_admin_map_overlays_owner_insert
  ON public.admin_restaurant_map_overlays FOR INSERT TO privacy_workflow_owner WITH CHECK (true);
CREATE POLICY tzudong_admin_map_overlays_owner_update
  ON public.admin_restaurant_map_overlays FOR UPDATE TO privacy_workflow_owner
  USING (true) WITH CHECK (true);
CREATE POLICY tzudong_admin_map_overlay_audit_owner_select
  ON public.admin_restaurant_map_overlay_audit_events FOR SELECT TO privacy_workflow_owner USING (true);
CREATE POLICY tzudong_admin_map_overlay_audit_owner_insert
  ON public.admin_restaurant_map_overlay_audit_events FOR INSERT TO privacy_workflow_owner WITH CHECK (true);

WITH expected(source_signature, grantee) AS (
  VALUES
    ('public.is_current_user_active_admin()', 'authenticated'::name),
    ('public.publish_youtube_thumbnail_release(uuid,text,text,text,text,text,text,text,text,numeric,jsonb,jsonb,jsonb,jsonb,uuid,timestamp with time zone)', 'service_role'::name),
    ('public.read_admin_user_management_metadata(uuid[])', 'service_role'::name),
    ('public.read_admin_user_ids_for_management()', 'service_role'::name),
    ('public.read_admin_user_audit_events(integer)', 'service_role'::name),
    ('public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)', 'service_role'::name)
)
INSERT INTO privacy_retention.g014_public_rpc_allowlist (
  function_schema, function_name, identity_arguments, grantee, source_signature
)
SELECT namespace.nspname, procedure.proname, procedure.proargtypes::text,
  expected.grantee, expected.source_signature
FROM expected
JOIN LATERAL pg_catalog.to_regprocedure(expected.source_signature)
  AS resolved(function_oid) ON true
JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = resolved.function_oid
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
ON CONFLICT (source_signature, grantee) DO UPDATE SET
  function_schema = EXCLUDED.function_schema,
  function_name = EXCLUDED.function_name,
  identity_arguments = EXCLUDED.identity_arguments;

-- Admit the two new SECURITY INVOKER identities into the private G014
-- assertion.  The complete predecessor body, metadata and ACL are pinned.
SET LOCAL ROLE privacy_workflow_owner;

DO $definer_contract_convergence$
DECLARE
  v_oid constant oid :=
    'privacy_retention.assert_g014_definer_contract()'::pg_catalog.regprocedure;
  v_before constant text :=
    'e319cb3d15d43cf40ddafd705e2832f506ca82af8f04f5a221cf774ae58b7b67';
  v_after constant text :=
    '7633f1fc0b4748b00f2b2890f273ebeb7f2a8cd8cf5f5fd581efe54010a1b599';
  v_anchor constant text := $definer_anchor$    IF v_signature IN (
      'public.match_storyboard_documents_hybrid(uuid,public.vector,jsonb,double precision,integer,integer,jsonb)',
      'public.match_storyboard_documents_hybrid_v2(uuid,public.vector,jsonb,double precision,integer,integer,jsonb)',
      'public.ocr_log_metadata_is_safe(jsonb)'
    ) THEN
      IF v_is_definer THEN
        RAISE EXCEPTION 'G014 declared SECURITY INVOKER RPC became SECURITY DEFINER: %', v_signature;
      END IF;
      CONTINUE;
$definer_anchor$;
  v_replacement constant text := $definer_replacement$    IF v_signature IN (
      'public.match_storyboard_documents_hybrid(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)',
      'public.match_storyboard_documents_hybrid(uuid,public.vector,jsonb,double precision,integer,integer,jsonb)',
      'public.match_storyboard_documents_hybrid_v2(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)',
      'public.match_storyboard_documents_hybrid_v2(uuid,public.vector,jsonb,double precision,integer,integer,jsonb)',
      'public.ocr_log_metadata_is_safe(jsonb)',
      'public.is_current_user_active_admin()',
      'public.publish_youtube_thumbnail_release(uuid,text,text,text,text,text,text,text,text,numeric,jsonb,jsonb,jsonb,jsonb,uuid,timestamp with time zone)'
    ) THEN
      IF v_is_definer THEN
        RAISE EXCEPTION 'G014 declared SECURITY INVOKER RPC became SECURITY DEFINER: %', v_signature;
      END IF;
      IF v_signature IN (
        'public.is_current_user_active_admin()',
        'public.publish_youtube_thumbnail_release(uuid,text,text,text,text,text,text,text,text,numeric,jsonb,jsonb,jsonb,jsonb,uuid,timestamp with time zone)'
      ) THEN
        SELECT pg_catalog.pg_get_userbyid(procedure.proowner), setting.value
        INTO v_owner, v_search_path
        FROM pg_catalog.pg_proc AS procedure
        LEFT JOIN LATERAL pg_catalog.unnest(procedure.proconfig) AS setting(value)
          ON setting.value LIKE 'search_path=%'
        WHERE procedure.oid = v_oid;
        IF v_owner IS DISTINCT FROM 'privacy_workflow_owner'
           OR (v_search_path IS DISTINCT FROM 'search_path='
               AND v_search_path IS DISTINCT FROM 'search_path=""') THEN
          RAISE EXCEPTION 'G014 post-contract SECURITY INVOKER RPC owner/path mismatch: %',
            v_signature;
        END IF;
      END IF;
      CONTINUE;
$definer_replacement$;
  v_definition text;
  v_source text;
  v_owner oid;
  v_acl aclitem[];
  v_secdef boolean;
  v_config text[];
  v_volatility "char";
  v_kind "char";
  v_retset boolean;
  v_rettype oid;
  v_language oid;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(oid), prosrc, proowner, proacl,
         prosecdef, proconfig, provolatile, prokind, proretset, prorettype, prolang
  INTO v_definition, v_source, v_owner, v_acl, v_secdef, v_config,
       v_volatility, v_kind, v_retset, v_rettype, v_language
  FROM pg_catalog.pg_proc
  WHERE oid = v_oid AND proowner = 'privacy_workflow_owner'::regrole
    AND prosecdef
    AND NOT proleakproof
    AND proparallel = 'u'
    AND provolatile = 'v'
    AND prokind = 'f'
    AND NOT proretset
    AND prorettype = 'void'::pg_catalog.regtype
    AND prolang = (
      SELECT language.oid FROM pg_catalog.pg_language AS language
      WHERE language.lanname = 'plpgsql'
    )
    AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=""']::text[]
    AND NOT EXISTS (
      WITH expected(grantee, is_grantable) AS (
        VALUES ('privacy_workflow_owner'::name, false)
      ), actual(grantee, is_grantable) AS (
        SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC'::name
                    ELSE pg_catalog.pg_get_userbyid(acl.grantee)::name END,
               acl.is_grantable
        FROM pg_catalog.aclexplode(
          COALESCE(proacl, pg_catalog.acldefault('f', proowner))
        ) AS acl
        WHERE acl.privilege_type = 'EXECUTE'
      )
      SELECT 1 FROM (
        (SELECT * FROM expected EXCEPT SELECT * FROM actual)
        UNION ALL
        (SELECT * FROM actual EXCEPT SELECT * FROM expected)
      ) AS difference
    );
  IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_source, 'UTF8')), 'hex')
       IS DISTINCT FROM v_before
     OR (pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_anchor, '')))
        / pg_catalog.length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'hosted_runtime_g014_definer_source_drift';
  END IF;
  EXECUTE pg_catalog.replace(v_definition, v_anchor, v_replacement);
  SELECT prosrc INTO v_source FROM pg_catalog.pg_proc
  WHERE oid = v_oid AND proowner = v_owner AND proacl IS NOT DISTINCT FROM v_acl
    AND prosecdef IS NOT DISTINCT FROM v_secdef
    AND NOT proleakproof
    AND proparallel = 'u'
    AND proconfig IS NOT DISTINCT FROM v_config
    AND provolatile IS NOT DISTINCT FROM v_volatility
    AND prokind IS NOT DISTINCT FROM v_kind
    AND proretset IS NOT DISTINCT FROM v_retset
    AND prorettype IS NOT DISTINCT FROM v_rettype
    AND prolang IS NOT DISTINCT FROM v_language;
  IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_source, 'UTF8')), 'hex')
       IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION 'hosted_runtime_g014_definer_readback_drift';
  END IF;
  IF EXISTS (
    WITH expected(grantee, is_grantable) AS (
      VALUES ('privacy_workflow_owner'::name, false)
    ), actual(grantee, is_grantable) AS (
      SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC'::name
                  ELSE pg_catalog.pg_get_userbyid(acl.grantee)::name END,
             acl.is_grantable
      FROM pg_catalog.pg_proc AS procedure
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          procedure.proacl,
          pg_catalog.acldefault('f', procedure.proowner)
        )
      ) AS acl
      WHERE procedure.oid = v_oid AND acl.privilege_type = 'EXECUTE'
    )
    SELECT 1 FROM (
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    ) AS difference
  ) THEN
    RAISE EXCEPTION 'hosted_runtime_g014_definer_acl_readback_drift';
  END IF;
END
$definer_contract_convergence$;

DO $catalog_contract_convergence$
DECLARE
  v_oid constant oid :=
    'privacy_retention.assert_g014_catalog_contract()'::pg_catalog.regprocedure;
  v_before constant text :=
    '9f5b15cc3d0c0b11d39053759409ce359ae8acda3669ed0b1dc40ee6612ef73d';
  v_after constant text :=
    'b82ac1cecc89fb5bebf07b55c1edaca9df31f5762f2cd6ab7373117e2a5390f5';
  v_anchor constant text := $catalog_anchor$      'public.ocr_log_metadata_is_safe(jsonb)'
    ) THEN
      IF v_is_definer THEN
        RAISE EXCEPTION 'G014 declared SECURITY INVOKER public RPC became SECURITY DEFINER: %',
          v_expected.source_signature;
      END IF;
$catalog_anchor$;
  v_replacement constant text := $catalog_replacement$      'public.ocr_log_metadata_is_safe(jsonb)',
      'public.is_current_user_active_admin()',
      'public.publish_youtube_thumbnail_release(uuid,text,text,text,text,text,text,text,text,numeric,jsonb,jsonb,jsonb,jsonb,uuid,timestamp with time zone)'
    ) THEN
      IF v_is_definer THEN
        RAISE EXCEPTION 'G014 declared SECURITY INVOKER public RPC became SECURITY DEFINER: %',
          v_expected.source_signature;
      END IF;
      IF v_expected.source_signature IN (
        'public.is_current_user_active_admin()',
        'public.publish_youtube_thumbnail_release(uuid,text,text,text,text,text,text,text,text,numeric,jsonb,jsonb,jsonb,jsonb,uuid,timestamp with time zone)'
      ) THEN
        v_search_path := NULL;
        SELECT setting.value INTO v_search_path
        FROM pg_catalog.unnest((SELECT procedure.proconfig
          FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_procedure))
          AS setting(value)
        WHERE setting.value LIKE 'search_path=%';
        IF pg_catalog.pg_get_userbyid((SELECT procedure.proowner
             FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_procedure))
             IS DISTINCT FROM 'privacy_workflow_owner'
           OR (v_search_path IS DISTINCT FROM 'search_path='
               AND v_search_path IS DISTINCT FROM 'search_path=""') THEN
          RAISE EXCEPTION 'G014 post-contract SECURITY INVOKER public RPC owner/path mismatch: %',
            v_expected.source_signature;
        END IF;
      END IF;
$catalog_replacement$;
  v_definition text;
  v_source text;
  v_owner oid;
  v_acl aclitem[];
  v_secdef boolean;
  v_config text[];
  v_volatility "char";
  v_kind "char";
  v_retset boolean;
  v_rettype oid;
  v_language oid;
BEGIN
  SELECT pg_catalog.pg_get_functiondef(oid), prosrc, proowner, proacl,
         prosecdef, proconfig, provolatile, prokind, proretset, prorettype, prolang
  INTO v_definition, v_source, v_owner, v_acl, v_secdef, v_config,
       v_volatility, v_kind, v_retset, v_rettype, v_language
  FROM pg_catalog.pg_proc
  WHERE oid = v_oid AND proowner = 'privacy_workflow_owner'::regrole
    AND prosecdef
    AND NOT proleakproof
    AND proparallel = 'u'
    AND provolatile = 'v'
    AND prokind = 'f'
    AND NOT proretset
    AND prorettype = 'void'::pg_catalog.regtype
    AND prolang = (
      SELECT language.oid FROM pg_catalog.pg_language AS language
      WHERE language.lanname = 'plpgsql'
    )
    AND proconfig IS NOT DISTINCT FROM ARRAY['search_path=""']::text[]
    AND NOT EXISTS (
      WITH expected(grantee, is_grantable) AS (
        VALUES ('privacy_workflow_owner'::name, false)
      ), actual(grantee, is_grantable) AS (
        SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC'::name
                    ELSE pg_catalog.pg_get_userbyid(acl.grantee)::name END,
               acl.is_grantable
        FROM pg_catalog.aclexplode(
          COALESCE(proacl, pg_catalog.acldefault('f', proowner))
        ) AS acl
        WHERE acl.privilege_type = 'EXECUTE'
      )
      SELECT 1 FROM (
        (SELECT * FROM expected EXCEPT SELECT * FROM actual)
        UNION ALL
        (SELECT * FROM actual EXCEPT SELECT * FROM expected)
      ) AS difference
    );
  IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_source, 'UTF8')), 'hex')
       IS DISTINCT FROM v_before
     OR (pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_anchor, '')))
        / pg_catalog.length(v_anchor) <> 1 THEN
    RAISE EXCEPTION 'hosted_runtime_g014_catalog_source_drift';
  END IF;
  EXECUTE pg_catalog.replace(v_definition, v_anchor, v_replacement);
  SELECT prosrc INTO v_source FROM pg_catalog.pg_proc
  WHERE oid = v_oid AND proowner = v_owner AND proacl IS NOT DISTINCT FROM v_acl
    AND prosecdef IS NOT DISTINCT FROM v_secdef
    AND NOT proleakproof
    AND proparallel = 'u'
    AND proconfig IS NOT DISTINCT FROM v_config
    AND provolatile IS NOT DISTINCT FROM v_volatility
    AND prokind IS NOT DISTINCT FROM v_kind
    AND proretset IS NOT DISTINCT FROM v_retset
    AND prorettype IS NOT DISTINCT FROM v_rettype
    AND prolang IS NOT DISTINCT FROM v_language;
  IF v_source IS NULL
     OR pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_source, 'UTF8')), 'hex'
     ) IS DISTINCT FROM v_after
     OR (pg_catalog.length(v_source) - pg_catalog.length(pg_catalog.replace(v_source, v_replacement, '')))
        / pg_catalog.length(v_replacement) <> 1 THEN
    RAISE EXCEPTION 'hosted_runtime_g014_catalog_readback_drift';
  END IF;
  IF EXISTS (
    WITH expected(grantee, is_grantable) AS (
      VALUES ('privacy_workflow_owner'::name, false)
    ), actual(grantee, is_grantable) AS (
      SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC'::name
                  ELSE pg_catalog.pg_get_userbyid(acl.grantee)::name END,
             acl.is_grantable
      FROM pg_catalog.pg_proc AS procedure
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          procedure.proacl,
          pg_catalog.acldefault('f', procedure.proowner)
        )
      ) AS acl
      WHERE procedure.oid = v_oid AND acl.privilege_type = 'EXECUTE'
    )
    SELECT 1 FROM (
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    ) AS difference
  ) THEN
    RAISE EXCEPTION 'hosted_runtime_g014_catalog_acl_readback_drift';
  END IF;
END
$catalog_contract_convergence$;

RESET ROLE;

SELECT privacy_retention.assert_g014_public_rpc_allowlist();
SELECT privacy_retention.assert_g014_definer_contract();

SET LOCAL ROLE privacy_workflow_owner;
SELECT privacy_retention.assert_g014_catalog_contract();
RESET ROLE;

DO $readback$
DECLARE
  v_expected record;
  v_oid regprocedure;
  v_overlay regprocedure :=
    'public.apply_admin_restaurant_map_overlay_action(uuid,text,uuid,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,uuid,text,jsonb)'::regprocedure;
  v_policy record;
  v_roles text[];
  v_using text;
  v_check text;
  v_helper_dependency_count bigint;
  v_legacy_dependency_count bigint;
  v_helper_policy_count bigint;
  v_admin_expression constant text :=
    '( SELECT is_current_user_active_admin() AS is_current_user_active_admin)';
  v_helper regprocedure := 'public.is_current_user_active_admin()'::regprocedure;
  v_legacy regprocedure := 'public.is_user_admin(uuid)'::regprocedure;
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_class AS relation_row
    WHERE relation_row.oid IN (
      'public.profiles'::pg_catalog.regclass,
      'public.reviews'::pg_catalog.regclass
    )
      AND relation_row.relkind = 'r'
      AND relation_row.relowner = 'postgres'::pg_catalog.regrole
      AND relation_row.relrowsecurity
      AND relation_row.relforcerowsecurity
  ) <> 2
     OR EXISTS (
       WITH expected(relation_oid, grantee, privileges) AS (
         VALUES
           (
             'public.profiles'::pg_catalog.regclass::oid,
             'postgres'::name,
             ARRAY[
               'DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES',
               'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'
             ]::text[]
           ),
           (
             'public.profiles'::pg_catalog.regclass::oid,
             'privacy_workflow_owner'::name,
             ARRAY['SELECT', 'UPDATE']::text[]
           ),
           (
             'public.reviews'::pg_catalog.regclass::oid,
             'anon'::name,
             ARRAY['SELECT']::text[]
           ),
           (
             'public.reviews'::pg_catalog.regclass::oid,
             'authenticated'::name,
             ARRAY['DELETE', 'INSERT', 'SELECT', 'UPDATE']::text[]
           ),
           (
             'public.reviews'::pg_catalog.regclass::oid,
             'postgres'::name,
             ARRAY[
               'DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES',
               'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'
             ]::text[]
           ),
           (
             'public.reviews'::pg_catalog.regclass::oid,
             'privacy_workflow_owner'::name,
             ARRAY['DELETE', 'SELECT']::text[]
           ),
           (
             'public.reviews'::pg_catalog.regclass::oid,
             'service_role'::name,
             ARRAY[
               'DELETE', 'INSERT', 'MAINTAIN', 'REFERENCES',
               'SELECT', 'TRIGGER', 'TRUNCATE', 'UPDATE'
             ]::text[]
           )
       ), expected_acl(
         relation_oid, grantee, privilege_type, is_grantable
       ) AS (
         SELECT expected.relation_oid,
                expected.grantee,
                privilege.privilege_type,
                false
         FROM expected
         CROSS JOIN LATERAL pg_catalog.unnest(expected.privileges)
           AS privilege(privilege_type)
       ), actual_acl(
         relation_oid, grantee, privilege_type, is_grantable
       ) AS (
         SELECT relation_row.oid,
                CASE WHEN acl.grantee = 0 THEN 'PUBLIC'::name
                     ELSE pg_catalog.pg_get_userbyid(acl.grantee)::name END,
                acl.privilege_type,
                acl.is_grantable
         FROM pg_catalog.pg_class AS relation_row
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             relation_row.relacl,
             pg_catalog.acldefault('r', relation_row.relowner)
           )
         ) AS acl
         WHERE relation_row.oid IN (
           'public.profiles'::pg_catalog.regclass,
           'public.reviews'::pg_catalog.regclass
         )
       )
       SELECT 1
       FROM (
         (SELECT * FROM expected_acl EXCEPT SELECT * FROM actual_acl)
         UNION ALL
         (SELECT * FROM actual_acl EXCEPT SELECT * FROM expected_acl)
       ) AS difference
     ) THEN
    RAISE EXCEPTION 'hosted_runtime_profile_relation_readback_drift';
  END IF;

  IF pg_catalog.to_regclass('public.admin_storyboard_jobs') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class AS relation_row
       WHERE relation_row.oid =
         'public.admin_storyboard_jobs'::pg_catalog.regclass
         AND relation_row.relowner = 'postgres'::pg_catalog.regrole
         AND relation_row.relrowsecurity
         AND NOT relation_row.relforcerowsecurity
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.admin_storyboard_jobs', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.admin_storyboard_jobs', 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.admin_storyboard_jobs', 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.admin_storyboard_jobs', 'DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'anon', 'public.admin_storyboard_jobs', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'anon', 'public.admin_storyboard_jobs', 'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       'anon', 'public.admin_storyboard_jobs', 'UPDATE'
     )
     OR pg_catalog.has_table_privilege(
       'anon', 'public.admin_storyboard_jobs', 'DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.admin_storyboard_jobs', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.admin_storyboard_jobs', 'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.admin_storyboard_jobs', 'UPDATE'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.admin_storyboard_jobs', 'DELETE'
     )
     OR pg_catalog.to_regclass('public.youtube_thumbnail_releases') IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class AS relation_row
       WHERE relation_row.oid =
         'public.youtube_thumbnail_releases'::pg_catalog.regclass
         AND relation_row.relowner = 'postgres'::pg_catalog.regrole
         AND relation_row.relrowsecurity
         AND NOT relation_row.relforcerowsecurity
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.youtube_thumbnail_releases', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.youtube_thumbnail_releases', 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.youtube_thumbnail_releases', 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.youtube_thumbnail_releases', 'DELETE'
     ) THEN
    RAISE EXCEPTION 'hosted_runtime_table_readback_drift';
  END IF;

  IF EXISTS (
    WITH expected(
      relation_oid, policy_name, command, role_names, using_expression,
      check_expression, permissive
    ) AS (
      VALUES (
        'public.admin_storyboard_jobs'::pg_catalog.regclass::oid,
        'admin_storyboard_jobs_service_role_all'::name,
        '*'::"char",
        ARRAY['service_role']::name[],
        '(auth.role() = ''service_role''::text)'::text,
        '(auth.role() = ''service_role''::text)'::text,
        true
      )
    ), actual AS (
      SELECT
        policy_row.polrelid AS relation_oid,
        policy_row.polname AS policy_name,
        policy_row.polcmd AS command,
        COALESCE((
          SELECT pg_catalog.array_agg(
            role_row.rolname ORDER BY role_row.rolname
          )
          FROM pg_catalog.unnest(policy_row.polroles) AS role_id(oid)
          JOIN pg_catalog.pg_roles AS role_row ON role_row.oid = role_id.oid
        ), ARRAY[]::name[]) AS role_names,
        pg_catalog.pg_get_expr(
          policy_row.polqual, policy_row.polrelid
        ) AS using_expression,
        pg_catalog.pg_get_expr(
          policy_row.polwithcheck, policy_row.polrelid
        ) AS check_expression,
        policy_row.polpermissive AS permissive
      FROM pg_catalog.pg_policy AS policy_row
      WHERE policy_row.polrelid IN (
        'public.admin_storyboard_jobs'::pg_catalog.regclass,
        'public.youtube_thumbnail_releases'::pg_catalog.regclass
      )
    )
    SELECT 1
    FROM (
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    ) AS difference
  ) THEN
    RAISE EXCEPTION 'hosted_runtime_new_table_policy_readback_drift';
  END IF;

  IF EXISTS (
    WITH target(relation_oid, grantee, privileges) AS (
      VALUES
        (
          'public.admin_storyboard_jobs'::pg_catalog.regclass::oid,
          'service_role'::pg_catalog.regrole::oid,
          ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]
        ),
        (
          'public.youtube_thumbnail_releases'::pg_catalog.regclass::oid,
          'service_role'::pg_catalog.regrole::oid,
          ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']::text[]
        ),
        (
          'public.admin_restaurant_map_overlays'::pg_catalog.regclass::oid,
          'service_role'::pg_catalog.regrole::oid,
          ARRAY['SELECT']::text[]
        ),
        (
          'public.admin_restaurant_map_overlays'::pg_catalog.regclass::oid,
          'privacy_workflow_owner'::pg_catalog.regrole::oid,
          ARRAY['SELECT', 'INSERT', 'UPDATE']::text[]
        ),
        (
          'public.admin_restaurant_map_overlay_audit_events'::pg_catalog.regclass::oid,
          'privacy_workflow_owner'::pg_catalog.regrole::oid,
          ARRAY['SELECT', 'INSERT']::text[]
        )
    ), expected(relation_oid, grantee, privilege_type, is_grantable) AS (
      SELECT relation_row.oid,
             acl.grantee,
             acl.privilege_type,
             acl.is_grantable
      FROM pg_catalog.pg_class AS relation_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        pg_catalog.acldefault('r', relation_row.relowner)
      ) AS acl
      WHERE relation_row.oid IN (
        'public.admin_storyboard_jobs'::pg_catalog.regclass,
        'public.youtube_thumbnail_releases'::pg_catalog.regclass,
        'public.admin_restaurant_map_overlays'::pg_catalog.regclass,
        'public.admin_restaurant_map_overlay_audit_events'::pg_catalog.regclass
      )
      UNION ALL
      SELECT target.relation_oid,
             target.grantee,
             privilege_row.privilege_type,
             false
      FROM target
      CROSS JOIN LATERAL pg_catalog.unnest(target.privileges)
        AS privilege_row(privilege_type)
    ), actual(relation_oid, grantee, privilege_type, is_grantable) AS (
      SELECT relation_row.oid,
             acl.grantee,
             acl.privilege_type,
             acl.is_grantable
      FROM pg_catalog.pg_class AS relation_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(
          relation_row.relacl,
          pg_catalog.acldefault('r', relation_row.relowner)
        )
      ) AS acl
      WHERE relation_row.oid IN (
        'public.admin_storyboard_jobs'::pg_catalog.regclass,
        'public.youtube_thumbnail_releases'::pg_catalog.regclass,
        'public.admin_restaurant_map_overlays'::pg_catalog.regclass,
        'public.admin_restaurant_map_overlay_audit_events'::pg_catalog.regclass
      )
    )
    SELECT 1
    FROM (
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    ) AS difference
  ) THEN
    RAISE EXCEPTION 'hosted_runtime_exact_table_acl_readback_drift';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM storage.buckets
    WHERE (id, public, file_size_limit, allowed_mime_types) IN (
      ('profile-avatars', true, 2097152, ARRAY['image/*']::text[]),
      ('review-photos', true, 5242880, ARRAY['image/*']::text[]),
      ('ad-banner-images', true, 52428800, ARRAY['image/*', 'video/*']::text[]),
      ('youtube-thumbnail-releases', false, 10485760, ARRAY['image/png']::text[])
    )
  ) <> 4 THEN
    RAISE EXCEPTION 'hosted_runtime_storage_readback_drift';
  END IF;

  IF EXISTS (
    WITH expected(
      policy_name, command, role_names, using_sha256, check_sha256,
      permissive
    ) AS (
      VALUES
        ('tzudong_ad_banner_delete_admin', 'd'::"char", ARRAY['authenticated']::name[], 'c13b66bec94eb7fedaae8796692ca4b6203a6dd07fe7059345ce295f44c87bdb', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', true),
        ('tzudong_ad_banner_insert_admin', 'a'::"char", ARRAY['authenticated']::name[], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'c13b66bec94eb7fedaae8796692ca4b6203a6dd07fe7059345ce295f44c87bdb', true),
        ('tzudong_ad_banner_update_admin', 'w'::"char", ARRAY['authenticated']::name[], 'c13b66bec94eb7fedaae8796692ca4b6203a6dd07fe7059345ce295f44c87bdb', 'c13b66bec94eb7fedaae8796692ca4b6203a6dd07fe7059345ce295f44c87bdb', true),
        ('tzudong_profile_avatar_delete_own', 'd'::"char", ARRAY['authenticated']::name[], '5b93b69ec67fe24f5884d4483a16a3a388a1fd58ee81f397ac5169c6e4d48c07', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', true),
        ('tzudong_profile_avatar_insert_own', 'a'::"char", ARRAY['authenticated']::name[], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '5b93b69ec67fe24f5884d4483a16a3a388a1fd58ee81f397ac5169c6e4d48c07', true),
        ('tzudong_profile_avatar_update_own', 'w'::"char", ARRAY['authenticated']::name[], '5b93b69ec67fe24f5884d4483a16a3a388a1fd58ee81f397ac5169c6e4d48c07', '5b93b69ec67fe24f5884d4483a16a3a388a1fd58ee81f397ac5169c6e4d48c07', true),
        ('tzudong_public_media_read', 'r'::"char", ARRAY['anon', 'authenticated']::name[], '8fa3aaf48874ee4ea016ad6b6371ab0c3ba13d0f3c68cc8286ce10cd3d7b5920', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', true),
        ('tzudong_review_photo_delete_own', 'd'::"char", ARRAY['authenticated']::name[], '1750cb7027fc3774ebcfad9b2159da5b9025ac6dea6c662b06c95050b1fb731e', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', true),
        ('tzudong_review_photo_insert_own', 'a'::"char", ARRAY['authenticated']::name[], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '1750cb7027fc3774ebcfad9b2159da5b9025ac6dea6c662b06c95050b1fb731e', true),
        ('tzudong_review_photo_update_own', 'w'::"char", ARRAY['authenticated']::name[], '1750cb7027fc3774ebcfad9b2159da5b9025ac6dea6c662b06c95050b1fb731e', '1750cb7027fc3774ebcfad9b2159da5b9025ac6dea6c662b06c95050b1fb731e', true)
    ), actual AS (
      SELECT
        policy_row.polname AS policy_name,
        policy_row.polcmd AS command,
        COALESCE((
          SELECT pg_catalog.array_agg(
            role_row.rolname ORDER BY role_row.rolname
          )
          FROM pg_catalog.unnest(policy_row.polroles) AS role_id(oid)
          JOIN pg_catalog.pg_roles AS role_row ON role_row.oid = role_id.oid
        ), ARRAY[]::name[]) AS role_names,
        pg_catalog.encode(
          pg_catalog.sha256(
            pg_catalog.convert_to(
              COALESCE(
                pg_catalog.pg_get_expr(
                  policy_row.polqual, policy_row.polrelid
                ),
                ''
              ),
              'UTF8'
            )
          ),
          'hex'
        ) AS using_sha256,
        pg_catalog.encode(
          pg_catalog.sha256(
            pg_catalog.convert_to(
              COALESCE(
                pg_catalog.pg_get_expr(
                  policy_row.polwithcheck, policy_row.polrelid
                ),
                ''
              ),
              'UTF8'
            )
          ),
          'hex'
        ) AS check_sha256,
        policy_row.polpermissive AS permissive
      FROM pg_catalog.pg_policy AS policy_row
      WHERE policy_row.polrelid = 'storage.objects'::pg_catalog.regclass
    )
    SELECT 1
    FROM (
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    ) AS difference
  ) THEN
    RAISE EXCEPTION 'hosted_runtime_storage_policy_definition_drift';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename IN ('notifications', 'review_likes', 'reviews')
  ) <> 3 THEN
    RAISE EXCEPTION 'hosted_runtime_realtime_readback_drift';
  END IF;

  IF (SELECT pg_catalog.count(*) FROM provider_budget_private.admin_provider_budget_policies) <> 5
     OR NOT EXISTS (
       SELECT 1 FROM provider_budget_private.admin_provider_budget_policies
       WHERE provider = 'naver_directions'
         AND (actor_per_minute, global_per_minute, global_per_day) = (20, 200, 10000)
     )
     OR NOT EXISTS (
       SELECT 1 FROM provider_budget_private.admin_provider_budget_policies
       WHERE provider = 'openai_sponsor_analysis'
         AND (actor_per_minute, global_per_minute, global_per_day) = (10, 100, 1000)
     ) THEN
    RAISE EXCEPTION 'hosted_runtime_provider_budget_readback_drift';
  END IF;

  FOR v_expected IN
    SELECT expected.signature,
           expected.security_definer,
           expected.volatility,
           expected.source_sha256,
           expected.grantees,
           expected.language_name,
           expected.return_type,
           expected.returns_set
    FROM (
      VALUES
        (
          'public.is_current_user_active_admin()'::text,
          false,
          's'::"char",
          '15c1bb46db8620bfac36004dfbcef653a288daf51b864223de6112f5eac92521'::text,
          ARRAY['privacy_workflow_owner', 'authenticated']::name[],
          'sql'::name,
          'boolean'::pg_catalog.regtype,
          false
        ),
        (
          'public.publish_youtube_thumbnail_release(uuid,text,text,text,text,text,text,text,text,numeric,jsonb,jsonb,jsonb,jsonb,uuid,timestamptz)'::text,
          false,
          'v'::"char",
          '8e26866583fbc55cb15c6b916bb7d0fa19397660393380dd06dfdb6b5eb57e09'::text,
          ARRAY['privacy_workflow_owner', 'service_role']::name[],
          'plpgsql'::name,
          'public.youtube_thumbnail_releases'::pg_catalog.regtype,
          false
        ),
        (
          'public.privacy_incident_require_admin(uuid)'::text,
          true,
          'v'::"char",
          '9879b4b5f2e0aec97a1725bf31f565a07a28eadec0c1100716f5b545b4ebcfdb'::text,
          ARRAY['postgres', 'privacy_workflow_owner']::name[],
          'plpgsql'::name,
          'void'::pg_catalog.regtype,
          false
        ),
        (
          'public.read_admin_user_management_metadata(uuid[])'::text,
          true,
          's'::"char",
          '3b8496725033f1e785b6f35739a4cfe7a0a0d72f51f5089faede61aa39f70d8a'::text,
          ARRAY['privacy_workflow_owner', 'service_role']::name[],
          'plpgsql'::name,
          'record'::pg_catalog.regtype,
          true
        ),
        (
          'public.read_admin_user_ids_for_management()'::text,
          true,
          's'::"char",
          'd9e432b58fa728fce8a12fa1cb6f670d4f5175957f1bf8d4814db1ab2565b7a3'::text,
          ARRAY['privacy_workflow_owner', 'service_role']::name[],
          'plpgsql'::name,
          'record'::pg_catalog.regtype,
          true
        ),
        (
          'public.read_admin_user_audit_events(integer)'::text,
          true,
          's'::"char",
          '714dbcc44aa918270ff742f837287407be7af98df48d4598037c9fbcaf279d61'::text,
          ARRAY['privacy_workflow_owner', 'service_role']::name[],
          'plpgsql'::name,
          'record'::pg_catalog.regtype,
          true
        ),
        (
          'public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamptz,text,uuid,text,text)'::text,
          true,
          'v'::"char",
          '054fc22e57851ddb50935b75db9cd96e7224f5418a22da806de0b27c761999b0'::text,
          ARRAY['privacy_workflow_owner', 'service_role']::name[],
          'plpgsql'::name,
          'uuid'::pg_catalog.regtype,
          false
        ),
        (
          'public.apply_admin_restaurant_map_overlay_action(uuid,text,uuid,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,uuid,text,jsonb)'::text,
          true,
          'v'::"char",
          'fa01f64f3bbe45c244fa018e1cac140004b195f9de2dcfb6a617552bd4dd592b'::text,
          ARRAY['privacy_workflow_owner', 'service_role']::name[],
          'plpgsql'::name,
          'jsonb'::pg_catalog.regtype,
          false
        )
    ) AS expected(
      signature, security_definer, volatility, source_sha256, grantees,
      language_name, return_type, returns_set
    )
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_expected.signature);
    IF v_oid IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_proc AS procedure
         WHERE procedure.oid = v_oid
           AND procedure.proowner =
             'privacy_workflow_owner'::pg_catalog.regrole
           AND procedure.prosecdef = v_expected.security_definer
           AND procedure.provolatile = v_expected.volatility
           AND procedure.prokind = 'f'
           AND NOT procedure.proleakproof
           AND procedure.proparallel = 'u'
           AND procedure.prolang = (
             SELECT language.oid
             FROM pg_catalog.pg_language AS language
             WHERE language.lanname = v_expected.language_name
           )
           AND procedure.prorettype = v_expected.return_type
           AND procedure.proretset = v_expected.returns_set
           AND procedure.proconfig IS NOT DISTINCT FROM
             ARRAY['search_path=""']::text[]
           AND pg_catalog.encode(
             pg_catalog.sha256(
               pg_catalog.convert_to(procedure.prosrc, 'UTF8')
             ),
             'hex'
           ) = v_expected.source_sha256
       )
       OR EXISTS (
         WITH expected(grantee, is_grantable) AS (
           SELECT grantee, false AS is_grantable
           FROM pg_catalog.unnest(v_expected.grantees) AS grantee
         ), actual(grantee, is_grantable) AS (
           SELECT
             CASE WHEN acl.grantee = 0 THEN 'PUBLIC'::name
                  ELSE pg_catalog.pg_get_userbyid(acl.grantee)::name END,
             acl.is_grantable
           FROM pg_catalog.pg_proc AS procedure
           CROSS JOIN LATERAL pg_catalog.aclexplode(
             COALESCE(
               procedure.proacl,
               pg_catalog.acldefault('f', procedure.proowner)
             )
           ) AS acl
           WHERE procedure.oid = v_oid
             AND acl.privilege_type = 'EXECUTE'
         )
         SELECT 1
         FROM (
           (SELECT * FROM expected EXCEPT SELECT * FROM actual)
           UNION ALL
           (SELECT * FROM actual EXCEPT SELECT * FROM expected)
         ) AS difference
       ) THEN
      RAISE EXCEPTION 'hosted_runtime_function_readback_drift: %',
        v_expected.signature;
    END IF;
  END LOOP;

  IF position('request.jwt.claims' IN pg_catalog.pg_get_functiondef(v_overlay)) = 0
     OR position('auth.role()' IN pg_catalog.pg_get_functiondef(v_overlay)) <> 0
     OR NOT pg_catalog.has_function_privilege('service_role', v_overlay, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_overlay, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_overlay, 'EXECUTE')
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.admin_restaurant_map_overlays',
       'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.admin_restaurant_map_overlays',
       'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.admin_restaurant_map_overlays',
       'UPDATE'
     )
     OR pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.admin_restaurant_map_overlays', 'DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.admin_restaurant_map_overlays', 'TRUNCATE'
     )
     OR pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.admin_restaurant_map_overlays', 'REFERENCES'
     )
     OR pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.admin_restaurant_map_overlays', 'TRIGGER'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.admin_restaurant_map_overlay_audit_events',
       'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.admin_restaurant_map_overlay_audit_events',
       'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       'service_role', 'public.admin_restaurant_map_overlay_audit_events', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'service_role', 'public.admin_restaurant_map_overlay_audit_events', 'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       'service_role', 'public.admin_restaurant_map_overlay_audit_events', 'UPDATE'
     )
     OR pg_catalog.has_table_privilege(
       'service_role', 'public.admin_restaurant_map_overlay_audit_events', 'DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'service_role', 'public.admin_restaurant_map_overlay_audit_events', 'TRUNCATE'
     )
     OR pg_catalog.has_table_privilege(
       'service_role', 'public.admin_restaurant_map_overlay_audit_events', 'REFERENCES'
     )
     OR pg_catalog.has_table_privilege(
       'service_role', 'public.admin_restaurant_map_overlay_audit_events', 'TRIGGER'
     ) THEN
    RAISE EXCEPTION 'hosted_runtime_overlay_readback_drift';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_policy AS policy_row
    WHERE policy_row.polrelid IN (
      'public.announcements'::regclass, 'public.ad_banners'::regclass
    )
  ) <> 10
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy_row
       WHERE policy_row.polrelid IN (
         'public.announcements'::regclass, 'public.ad_banners'::regclass
       )
         AND policy_row.polname NOT IN (
           'tzudong_announcements_select_active',
           'tzudong_announcements_select_admin',
           'tzudong_announcements_insert_admin',
           'tzudong_announcements_update_admin',
           'tzudong_announcements_delete_admin',
           'tzudong_ad_banners_select_active',
           'tzudong_ad_banners_select_admin',
           'tzudong_ad_banners_insert_admin',
           'tzudong_ad_banners_update_admin',
           'tzudong_ad_banners_delete_admin'
         )
     )
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_depend AS dependency
       WHERE dependency.classid = 'pg_policy'::regclass
         AND dependency.refclassid = 'pg_proc'::regclass
         AND dependency.refobjid = 'public.is_user_admin(uuid)'::regprocedure
     ) THEN
    RAISE EXCEPTION 'hosted_runtime_public_policy_readback_drift';
  END IF;

  FOR v_policy IN
    SELECT policy_row.*, relation_row.relname
    FROM pg_catalog.pg_policy AS policy_row
    JOIN pg_catalog.pg_class AS relation_row ON relation_row.oid = policy_row.polrelid
    WHERE policy_row.polrelid IN (
      'public.announcements'::regclass, 'public.ad_banners'::regclass
    )
  LOOP
    SELECT pg_catalog.array_agg(role_row.rolname ORDER BY role_row.rolname)
      INTO v_roles
    FROM pg_catalog.unnest(v_policy.polroles) AS role_id(oid)
    JOIN pg_catalog.pg_roles AS role_row ON role_row.oid = role_id.oid;
    v_using := COALESCE(
      pg_catalog.pg_get_expr(v_policy.polqual, v_policy.polrelid), ''
    );
    v_check := COALESCE(
      pg_catalog.pg_get_expr(v_policy.polwithcheck, v_policy.polrelid), ''
    );
    SELECT pg_catalog.count(*)
      INTO v_helper_dependency_count
    FROM pg_catalog.pg_depend AS dependency
    WHERE dependency.classid = 'pg_policy'::regclass
      AND dependency.objid = v_policy.oid
      AND dependency.refclassid = 'pg_proc'::regclass
      AND dependency.refobjid = v_helper;
    SELECT pg_catalog.count(*)
      INTO v_legacy_dependency_count
    FROM pg_catalog.pg_depend AS dependency
    WHERE dependency.classid = 'pg_policy'::regclass
      AND dependency.objid = v_policy.oid
      AND dependency.refclassid = 'pg_proc'::regclass
      AND dependency.refobjid = v_legacy;
    IF NOT v_policy.polpermissive
       OR v_legacy_dependency_count <> 0
       OR (v_policy.polname LIKE '%_select_active' AND (
         v_policy.polcmd <> 'r'
         OR v_roles IS DISTINCT FROM ARRAY['anon', 'authenticated']::text[]
         OR v_using <> '(is_active = true)' OR v_check <> ''
         OR v_helper_dependency_count <> 0
       ))
       OR (v_policy.polname LIKE '%_select_admin' AND (
         v_policy.polcmd <> 'r'
         OR v_roles IS DISTINCT FROM ARRAY['authenticated']::text[]
         OR v_using <> v_admin_expression OR v_check <> ''
         OR v_helper_dependency_count <> 1
       ))
       OR (v_policy.polname LIKE '%_insert_admin' AND (
         v_policy.polcmd <> 'a'
         OR v_roles IS DISTINCT FROM ARRAY['authenticated']::text[]
         OR v_using <> '' OR v_check <> v_admin_expression
         OR v_helper_dependency_count <> 1
       ))
       OR (v_policy.polname LIKE '%_update_admin' AND (
         v_policy.polcmd <> 'w'
         OR v_roles IS DISTINCT FROM ARRAY['authenticated']::text[]
         OR v_using <> v_admin_expression OR v_check <> v_admin_expression
         OR v_helper_dependency_count <> 2
       ))
       OR (v_policy.polname LIKE '%_delete_admin' AND (
         v_policy.polcmd <> 'd'
         OR v_roles IS DISTINCT FROM ARRAY['authenticated']::text[]
         OR v_using <> v_admin_expression OR v_check <> ''
         OR v_helper_dependency_count <> 1
       )) THEN
      RAISE EXCEPTION 'hosted_runtime_public_policy_definition_drift: %',
        v_policy.polname;
    END IF;
  END LOOP;

  SELECT pg_catalog.count(DISTINCT dependency.objid)
    INTO v_helper_policy_count
  FROM pg_catalog.pg_depend AS dependency
  WHERE dependency.classid = 'pg_policy'::regclass
    AND dependency.refclassid = 'pg_proc'::regclass
    AND dependency.refobjid = v_helper;
  IF v_helper_policy_count <> 26 THEN
    RAISE EXCEPTION 'hosted_runtime_helper_policy_count_drift';
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
          SELECT pg_catalog.array_agg(
            role_row.rolname ORDER BY role_row.rolname
          )::text[]
          FROM pg_catalog.unnest(policy_row.polroles) AS role_id(oid)
          JOIN pg_catalog.pg_roles AS role_row ON role_row.oid = role_id.oid
        ), ARRAY[]::text[]) AS role_names,
        (
          SELECT pg_catalog.count(*)
          FROM pg_catalog.pg_depend AS dependency
          WHERE dependency.classid = 'pg_policy'::regclass
            AND dependency.objid = policy_row.oid
            AND dependency.refclassid = 'pg_proc'::regclass
            AND dependency.refobjid = v_helper
        ) AS helper_dependency_count,
        (
          SELECT pg_catalog.count(*)
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
       OR actual.helper_dependency_count <>
         expected.helper_dependency_count
       OR actual.uid_dependency_count <> expected.uid_dependency_count
  ) THEN
    RAISE EXCEPTION 'hosted_runtime_caller_policy_contract_drift';
  END IF;

  IF pg_catalog.has_table_privilege('service_role', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('service_role', 'public.user_roles', 'SELECT')
     OR pg_catalog.has_table_privilege('service_role', 'public.user_account_status', 'SELECT')
     OR pg_catalog.has_table_privilege(
       'service_role', 'public.admin_audit_events', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'service_role', 'public.admin_audit_events', 'INSERT'
     )
     OR pg_catalog.has_table_privilege(
       'service_role', 'public.admin_audit_events', 'UPDATE'
     )
     OR pg_catalog.has_table_privilege(
       'service_role', 'public.admin_audit_events', 'DELETE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', 'public.privacy_incident_require_admin(uuid)', 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'privacy_workflow_owner', 'public.privacy_incident_require_admin(uuid)', 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'hosted_runtime_direct_service_role_grant_drift';
  END IF;

  IF NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.profiles', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.reviews', 'SELECT'
     )
     OR pg_catalog.has_table_privilege('anon', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('service_role', 'public.profiles', 'SELECT')
     OR pg_catalog.has_schema_privilege('privacy_workflow_owner', 'auth', 'USAGE') THEN
    RAISE EXCEPTION 'hosted_runtime_profile_or_auth_boundary_drift';
  END IF;
END
$readback$;

DO $membership_restore$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE SET OPTION FOR privacy_workflow_owner FROM %I GRANTED BY %I',
    session_user,
    session_user
  );

  IF current_user IS DISTINCT FROM 'postgres'
     OR session_user IS DISTINCT FROM 'postgres'
     OR EXISTS (
       WITH expected(
         role_name, member_name, grantor_name,
         admin_option, inherit_option, set_option
       ) AS (
         VALUES
           (
             'privacy_workflow_owner'::name,
             'postgres'::name,
             'supabase_admin'::name,
             true, false, false
           ),
           (
             'privacy_workflow_owner'::name,
             'postgres'::name,
             'postgres'::name,
             false, true, false
           ),
           (
             'privacy_workflow_owner'::name,
             'privacy_auth_bridge'::name,
             'postgres'::name,
             false, true, true
           )
       ), actual AS (
         SELECT pg_catalog.pg_get_userbyid(membership.roleid)::name,
                pg_catalog.pg_get_userbyid(membership.member)::name,
                pg_catalog.pg_get_userbyid(membership.grantor)::name,
                membership.admin_option,
                membership.inherit_option,
                membership.set_option
         FROM pg_catalog.pg_auth_members AS membership
         WHERE membership.roleid =
                 'privacy_workflow_owner'::pg_catalog.regrole
            OR membership.member =
                 'privacy_workflow_owner'::pg_catalog.regrole
       )
       SELECT 1
       FROM (
         (SELECT * FROM expected EXCEPT SELECT * FROM actual)
         UNION ALL
         (SELECT * FROM actual EXCEPT SELECT * FROM expected)
       ) AS difference
     ) THEN
    RAISE EXCEPTION 'hosted_runtime_membership_restore_drift';
  END IF;
END
$membership_restore$;

NOTIFY pgrst, 'reload schema';
