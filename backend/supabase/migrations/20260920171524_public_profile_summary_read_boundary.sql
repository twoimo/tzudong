-- Expose only the bounded public profile summary needed by the public feed.
-- Direct SELECT on profiles stays private; the RPC is the read boundary.

BEGIN;

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'tzudong:public-profile-summary-read:v1',
    0
  )
);

DO $membership_acquire$
DECLARE
  v_membership_exists boolean;
  v_set_option boolean := true;
  v_supports_set_option boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
     WHERE membership.roleid = 'privacy_workflow_owner'::pg_catalog.regrole
       AND membership.member = pg_catalog.to_regrole(session_user)
  ) INTO v_membership_exists;

  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = 'pg_catalog.pg_auth_members'::pg_catalog.regclass
       AND attribute.attname = 'set_option'
       AND NOT attribute.attisdropped
  ) INTO v_supports_set_option;

  IF v_membership_exists AND v_supports_set_option THEN
    EXECUTE
      'SELECT COALESCE(bool_or(membership.set_option), false) '
      || 'FROM pg_catalog.pg_auth_members AS membership '
      || 'WHERE membership.roleid = '
      || '''privacy_workflow_owner''::pg_catalog.regrole '
      || 'AND membership.member = pg_catalog.to_regrole(session_user)'
      INTO v_set_option;
  END IF;

  IF NOT v_membership_exists THEN
    EXECUTE pg_catalog.format(
      CASE
        WHEN v_supports_set_option
          THEN 'GRANT privacy_workflow_owner TO %I WITH SET TRUE'
        ELSE 'GRANT privacy_workflow_owner TO %I'
      END,
      session_user
    );
    PERFORM pg_catalog.set_config(
      'public_profile_summary.remove_owner_membership', 'true', true
    );
    PERFORM pg_catalog.set_config(
      'public_profile_summary.restore_owner_set_false', 'false', true
    );
  ELSIF v_supports_set_option AND NOT v_set_option THEN
    EXECUTE pg_catalog.format(
      'GRANT privacy_workflow_owner TO %I WITH SET TRUE',
      session_user
    );
    PERFORM pg_catalog.set_config(
      'public_profile_summary.remove_owner_membership', 'false', true
    );
    PERFORM pg_catalog.set_config(
      'public_profile_summary.restore_owner_set_false', 'true', true
    );
  ELSE
    PERFORM pg_catalog.set_config(
      'public_profile_summary.remove_owner_membership', 'false', true
    );
    PERFORM pg_catalog.set_config(
      'public_profile_summary.restore_owner_set_false', 'false', true
    );
  END IF;
END
$membership_acquire$;

SET LOCAL ROLE privacy_workflow_owner;

DO $prerequisites$
BEGIN
  IF pg_catalog.to_regrole('anon') IS NULL
     OR pg_catalog.to_regrole('authenticated') IS NULL
     OR pg_catalog.to_regrole('service_role') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.reviews') IS NULL
     OR pg_catalog.to_regclass(
       'privacy_retention.g014_public_rpc_allowlist'
     ) IS NULL THEN
    RAISE EXCEPTION 'public_profile_summary_read_prerequisite_missing';
  END IF;

  IF pg_catalog.has_table_privilege('anon', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('service_role', 'public.profiles', 'SELECT')
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.profiles', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'public_profile_summary_read_profile_acl_drift';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('user_id'::name, 'uuid'::text),
        ('nickname'::name, 'text'::text),
        ('avatar_url'::name, 'text'::text)
      ) AS expected(column_name, type_name)
      LEFT JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = 'public.profiles'::pg_catalog.regclass
       AND attribute.attname = expected.column_name
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
     WHERE attribute.attname IS NULL
        OR pg_catalog.format_type(
             attribute.atttypid, attribute.atttypmod
           ) IS DISTINCT FROM expected.type_name
  ) THEN
    RAISE EXCEPTION 'public_profile_summary_read_profile_shape_drift';
  END IF;

END
$prerequisites$;

DO $create_profile_summary$
BEGIN
  IF pg_catalog.to_regprocedure(
       'public.read_public_profile_summaries(uuid[])'
     ) IS NULL THEN
    EXECUTE $function$
      CREATE FUNCTION public.read_public_profile_summaries(
        p_user_ids uuid[]
      )
      RETURNS TABLE (
        user_id uuid,
        nickname text,
        avatar_url text
      )
      LANGUAGE plpgsql
      STABLE
      SECURITY DEFINER
      SET search_path = ''
      AS $profile_summaries$
      DECLARE
        v_input_count bigint;
        v_nonnull_count bigint;
        v_distinct_count bigint;
      BEGIN
        IF p_user_ids IS NULL
           OR pg_catalog.array_ndims(p_user_ids) IS DISTINCT FROM 1
           OR pg_catalog.array_lower(p_user_ids, 1) IS DISTINCT FROM 1
           OR pg_catalog.cardinality(p_user_ids) NOT BETWEEN 1 AND 100 THEN
          RAISE EXCEPTION 'public_profile_summary_request_invalid'
            USING ERRCODE = '22023';
        END IF;

        SELECT
          pg_catalog.count(*),
          pg_catalog.count(requested.requested_user_id),
          pg_catalog.count(DISTINCT requested.requested_user_id)
          INTO v_input_count, v_nonnull_count, v_distinct_count
          FROM pg_catalog.unnest(p_user_ids)
            AS requested(requested_user_id);

        IF v_input_count <> v_nonnull_count
           OR v_input_count <> v_distinct_count THEN
          RAISE EXCEPTION 'public_profile_summary_request_invalid'
            USING ERRCODE = '22023';
        END IF;

        RETURN QUERY
        SELECT
          profile.user_id,
          profile.nickname,
          profile.avatar_url
          FROM pg_catalog.unnest(p_user_ids) WITH ORDINALITY
            AS requested(requested_user_id, input_ordinal)
          JOIN public.profiles AS profile
            ON profile.user_id = requested.requested_user_id
         WHERE profile.user_id IS NOT NULL
           AND profile.nickname IS NOT NULL
           AND profile.nickname <> '탈퇴한 사용자'
         ORDER BY requested.input_ordinal;
      END
      $profile_summaries$;
    $function$;
  END IF;
END
$create_profile_summary$;

ALTER FUNCTION public.read_public_profile_summaries(uuid[])
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.read_public_profile_summaries(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_public_profile_summaries(uuid[])
  TO anon, authenticated;

INSERT INTO privacy_retention.g014_public_rpc_allowlist (
  function_schema,
  function_name,
  identity_arguments,
  grantee,
  source_signature
)
SELECT
  namespace.nspname,
  procedure.proname,
  procedure.proargtypes::text,
  grantee.name,
  'public.read_public_profile_summaries(uuid[])'
FROM pg_catalog.pg_proc AS procedure
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = procedure.pronamespace
CROSS JOIN (VALUES ('anon'::name), ('authenticated'::name)) AS grantee(name)
WHERE procedure.oid = 'public.read_public_profile_summaries(uuid[])'::regprocedure
ON CONFLICT (source_signature, grantee) DO UPDATE
SET function_schema = EXCLUDED.function_schema,
    function_name = EXCLUDED.function_name,
    identity_arguments = EXCLUDED.identity_arguments;

DO $readback$
DECLARE
  v_oid oid := 'public.read_public_profile_summaries(uuid[])'::pg_catalog.regprocedure;
  v_owner text;
  v_search_path text[];
  v_acl pg_catalog.aclitem[];
  v_allowlist_rows integer;
BEGIN
  SELECT
    pg_catalog.pg_get_userbyid(procedure.proowner),
    procedure.proconfig,
    procedure.proacl
    INTO v_owner, v_search_path, v_acl
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = v_oid
     AND procedure.prosecdef
     AND procedure.provolatile = 's'::"char";

  IF v_owner IS DISTINCT FROM 'privacy_workflow_owner'
     OR v_search_path IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR v_acl IS NULL THEN
    RAISE EXCEPTION 'public_profile_summary_read_function_contract_drift';
  END IF;

  IF NOT pg_catalog.has_function_privilege(
       'anon', v_oid, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', v_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(v_acl) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'public_profile_summary_read_function_acl_drift';
  END IF;

  SELECT count(*)
    INTO v_allowlist_rows
    FROM privacy_retention.g014_public_rpc_allowlist AS allowed
   WHERE allowed.source_signature =
     'public.read_public_profile_summaries(uuid[])'
     AND allowed.grantee IN ('anon'::name, 'authenticated'::name)
     AND allowed.function_schema = 'public'
     AND allowed.function_name = 'read_public_profile_summaries'
     AND allowed.identity_arguments = (
       SELECT procedure.proargtypes::text
         FROM pg_catalog.pg_proc AS procedure
        WHERE procedure.oid = v_oid
     );

  IF v_allowlist_rows <> 2
     OR pg_catalog.has_table_privilege('anon', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('service_role', 'public.profiles', 'SELECT') THEN
    RAISE EXCEPTION 'public_profile_summary_read_allowlist_readback_drift';
  END IF;
END
$readback$;

RESET ROLE;

DO $membership_cleanup$
DECLARE
  v_remove boolean := pg_catalog.current_setting(
    'public_profile_summary.remove_owner_membership', true
  ) = 'true';
  v_restore_set_false boolean := pg_catalog.current_setting(
    'public_profile_summary.restore_owner_set_false', true
  ) = 'true';
BEGIN
  IF v_remove THEN
    EXECUTE pg_catalog.format(
      'REVOKE privacy_workflow_owner FROM %I',
      session_user
    );
  ELSIF v_restore_set_false THEN
    EXECUTE pg_catalog.format(
      'GRANT privacy_workflow_owner TO %I WITH SET FALSE',
      session_user
    );
  END IF;
END
$membership_cleanup$;

NOTIFY pgrst, 'reload schema';

COMMIT;
