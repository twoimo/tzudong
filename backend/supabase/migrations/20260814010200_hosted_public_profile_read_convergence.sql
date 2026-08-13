-- Add bounded public-profile read RPCs against the exact reconciled hosted predecessor without reopening direct profiles access.

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'tzudong:hosted-public-profile-read:v1',
    0
  )
);

DO $prerequisites$
DECLARE
  v_predecessor_statements text[];
  v_definer_source_sha256 constant text :=
    '7633f1fc0b4748b00f2b2890f273ebeb7f2a8cd8cf5f5fd581efe54010a1b599';
  v_catalog_source_sha256 constant text :=
    'b82ac1cecc89fb5bebf07b55c1edaca9df31f5762f2cd6ab7373117e2a5390f5';
BEGIN
  IF (
    SELECT pg_catalog.count(*)
      FROM supabase_migrations.schema_migrations
  ) <> 52
     OR (
       SELECT pg_catalog.count(*)
         FROM supabase_migrations.schema_migrations AS migration
        WHERE (migration.version, migration.name) IN (
          ('20260814010000', 'hosted_g016_g041_catalog_reconciliation'),
          ('20260814010100', 'hosted_runtime_boundary_convergence')
        )
     ) <> 2
     OR EXISTS (
       SELECT 1
         FROM supabase_migrations.schema_migrations AS migration
        WHERE migration.version >= '20260814010000'
          AND (migration.version, migration.name) NOT IN (
            ('20260814010000', 'hosted_g016_g041_catalog_reconciliation'),
            ('20260814010100', 'hosted_runtime_boundary_convergence')
          )
  ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_predecessor_ledger_drift';
  END IF;

  SELECT migration.statements
    INTO v_predecessor_statements
    FROM supabase_migrations.schema_migrations AS migration
   WHERE migration.version::text = '20260814010000'
     AND migration.name::text = 'hosted_g016_g041_catalog_reconciliation';

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
    RAISE EXCEPTION
      'hosted_public_profile_read_predecessor_statement_vector_drift';
  END IF;

  SELECT migration.statements
    INTO v_predecessor_statements
    FROM supabase_migrations.schema_migrations AS migration
   WHERE migration.version::text = '20260814010100'
     AND migration.name::text = 'hosted_runtime_boundary_convergence';

  IF pg_catalog.cardinality(v_predecessor_statements) <> 140
     OR pg_catalog.encode(
       pg_catalog.sha256(
         pg_catalog.convert_to(
           pg_catalog.to_json(v_predecessor_statements)::text,
           'UTF8'
         )
       ),
       'hex'
     ) IS DISTINCT FROM
       'f1531c8479a872791a96ff5595459ef0adfa2f9b3104890d820c1fe4bea7dd07' THEN
    RAISE EXCEPTION
      'hosted_public_profile_read_predecessor_statement_vector_drift';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles AS role_row
     WHERE role_row.rolname = 'privacy_workflow_owner'
       AND NOT role_row.rolsuper
       AND NOT role_row.rolinherit
       AND NOT role_row.rolcreaterole
       AND NOT role_row.rolcreatedb
       AND NOT role_row.rolcanlogin
       AND NOT role_row.rolreplication
       AND NOT role_row.rolbypassrls
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid IN (
       'privacy_retention.assert_g014_public_rpc_allowlist()'::pg_catalog.regprocedure,
       'privacy_retention.assert_g014_definer_contract()'::pg_catalog.regprocedure,
       'privacy_retention.assert_g014_catalog_contract()'::pg_catalog.regprocedure
     )
       AND (
         procedure.proowner IS DISTINCT FROM
           'privacy_workflow_owner'::pg_catalog.regrole
         OR procedure.prosecdef IS DISTINCT FROM true
         OR procedure.proleakproof
         OR procedure.proparallel IS DISTINCT FROM 'u'::"char"
         OR procedure.provolatile IS DISTINCT FROM 'v'::"char"
         OR procedure.prokind IS DISTINCT FROM 'f'::"char"
         OR procedure.proretset
         OR procedure.prorettype IS DISTINCT FROM
           'void'::pg_catalog.regtype
         OR procedure.prolang IS DISTINCT FROM (
           SELECT language.oid
           FROM pg_catalog.pg_language AS language
           WHERE language.lanname = 'plpgsql'
         )
         OR procedure.proconfig IS DISTINCT FROM
           ARRAY['search_path=""']::text[]
       )
  ) OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) AS acl
    WHERE procedure.oid IN (
      'privacy_retention.assert_g014_definer_contract()'::pg_catalog.regprocedure,
      'privacy_retention.assert_g014_catalog_contract()'::pg_catalog.regprocedure
    )
      AND acl.privilege_type = 'EXECUTE'
      AND (
        acl.grantee IS DISTINCT FROM
          'privacy_workflow_owner'::pg_catalog.regrole
        OR acl.is_grantable
      )
  ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_predecessor_contract_drift';
  END IF;
  IF pg_catalog.to_regrole('postgres') IS NULL
     OR pg_catalog.to_regrole('service_role') IS NULL
     OR pg_catalog.to_regrole('anon') IS NULL
     OR pg_catalog.to_regrole('authenticated') IS NULL
     OR pg_catalog.to_regrole('privacy_workflow_owner') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.reviews') IS NULL
     OR pg_catalog.to_regclass(
       'privacy_retention.g014_public_rpc_allowlist'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'privacy_retention.assert_g014_public_rpc_allowlist()'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'privacy_retention.assert_g014_definer_contract()'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'privacy_retention.assert_g014_catalog_contract()'
     ) IS NULL THEN
    RAISE EXCEPTION 'hosted_public_profile_read_prerequisite_missing';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname IN (
         'read_public_profile_summaries',
         'read_public_profile_leaderboard'
       )
  ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_identity_already_exists';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM privacy_retention.g014_public_rpc_allowlist AS allowed
     WHERE allowed.function_schema = 'public'
       AND allowed.function_name IN (
         'read_public_profile_summaries',
         'read_public_profile_leaderboard'
       )
  ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_allowlist_conflict';
  END IF;


  IF (
    SELECT pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(procedure.prosrc, 'UTF8')
      ),
      'hex'
    )
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid =
       'privacy_retention.assert_g014_definer_contract()'::pg_catalog.regprocedure
  ) IS DISTINCT FROM v_definer_source_sha256
     OR (
       SELECT pg_catalog.encode(
         pg_catalog.sha256(
           pg_catalog.convert_to(procedure.prosrc, 'UTF8')
         ),
         'hex'
       )
         FROM pg_catalog.pg_proc AS procedure
        WHERE procedure.oid =
          'privacy_retention.assert_g014_catalog_contract()'::pg_catalog.regprocedure
     ) IS DISTINCT FROM v_catalog_source_sha256 THEN
    RAISE EXCEPTION 'local_profile_read_boundary_g014_source_drift';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) AS acl
    WHERE procedure.oid IN (
      'privacy_retention.assert_g014_definer_contract()'::pg_catalog.regprocedure,
      'privacy_retention.assert_g014_catalog_contract()'::pg_catalog.regprocedure
    )
      AND acl.privilege_type = 'EXECUTE'
      AND (
        acl.grantee IS DISTINCT FROM
          'privacy_workflow_owner'::pg_catalog.regrole
        OR acl.is_grantable
      )
  ) THEN
    RAISE EXCEPTION 'local_profile_read_boundary_g014_acl_drift';
  END IF;

  IF pg_catalog.has_table_privilege(
       'anon', 'public.profiles', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.profiles', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.profiles', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.reviews', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_table_acl_drift';
  END IF;

  IF EXISTS (
    WITH expected(relation_name, column_name, type_name) AS (
      VALUES
        ('profiles'::name, 'user_id'::name, 'uuid'::text),
        ('profiles'::name, 'nickname'::name, 'text'::text),
        ('profiles'::name, 'avatar_url'::name, 'text'::text),
        ('reviews'::name, 'id'::name, 'uuid'::text),
        ('reviews'::name, 'user_id'::name, 'uuid'::text),
        ('reviews'::name, 'is_verified'::name, 'boolean'::text),
        ('reviews'::name, 'created_at'::name, 'timestamp with time zone'::text),
        ('reviews'::name, 'like_count'::name, 'integer'::text)
    )
    SELECT 1
      FROM expected
      LEFT JOIN pg_catalog.pg_class AS relation
        ON relation.relname = expected.relation_name
       AND relation.relnamespace = 'public'::pg_catalog.regnamespace
      LEFT JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = relation.oid
       AND attribute.attname = expected.column_name
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
     WHERE attribute.attname IS NULL
        OR pg_catalog.format_type(
             attribute.atttypid, attribute.atttypmod
           ) IS DISTINCT FROM expected.type_name
  ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_column_drift';
  END IF;
END
$prerequisites$;

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
    RAISE EXCEPTION 'hosted_public_profile_read_relation_prerequisite_drift';
  END IF;
END
$profile_relation_preflight$;


DO $membership_acquire$
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
             'postgres'::name,
             false, true, false
           ),
           (
             'privacy_workflow_owner'::name,
             'postgres'::name,
             'supabase_admin'::name,
             true, false, false
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
    RAISE EXCEPTION 'hosted_public_profile_read_owner_membership_drift';
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
          'postgres'::name,
          false, true, true
        ),
        (
          'privacy_workflow_owner'::name,
          'postgres'::name,
          'supabase_admin'::name,
          true, false, false
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
    RAISE EXCEPTION 'hosted_public_profile_read_owner_membership_drift';
  END IF;
END
$membership_acquire$;

SET LOCAL ROLE privacy_workflow_owner;

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

CREATE FUNCTION public.read_public_profile_leaderboard(
  p_period text,
  p_limit integer
)
RETURNS TABLE (
  user_id uuid,
  nickname text,
  review_count bigint,
  verified_review_count bigint,
  total_likes bigint,
  avg_likes_per_review numeric,
  quality_score numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $profile_leaderboard$
BEGIN
  IF p_period IS NULL
     OR p_period NOT IN ('all', 'monthly') THEN
    RAISE EXCEPTION 'public_profile_leaderboard_period_invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL
     OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'public_profile_leaderboard_limit_invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH profile_rows AS (
    SELECT profile.user_id, profile.nickname
      FROM public.profiles AS profile
     WHERE profile.user_id IS NOT NULL
       AND profile.nickname IS NOT NULL
       AND profile.nickname <> '탈퇴한 사용자'
  ),
  review_rollup AS (
    SELECT
      profile.user_id,
      profile.nickname,
      pg_catalog.count(review_row.id)::bigint AS review_count,
      pg_catalog.count(review_row.id) FILTER (
        WHERE review_row.is_verified IS TRUE
      )::bigint AS verified_review_count,
      COALESCE(
        pg_catalog.sum(review_row.like_count::bigint),
        0::numeric
      )::bigint AS total_likes
      FROM profile_rows AS profile
      LEFT JOIN public.reviews AS review_row
        ON review_row.user_id = profile.user_id
       AND (
         p_period = 'all'
         OR review_row.created_at >= pg_catalog.timezone(
           'Asia/Seoul',
           pg_catalog.date_trunc(
             'month',
             pg_catalog.timezone(
               'Asia/Seoul', pg_catalog.statement_timestamp()
             )
           )
         )
       )
     GROUP BY profile.user_id, profile.nickname
  ),
  scored AS (
    SELECT
      rollup.user_id,
      rollup.nickname,
      rollup.review_count,
      rollup.verified_review_count,
      rollup.total_likes,
      CASE
        WHEN rollup.verified_review_count = 0 THEN 0::numeric
        ELSE pg_catalog.round(
          rollup.total_likes::numeric
          / rollup.verified_review_count::numeric,
          1
        )
      END AS avg_likes_per_review,
      CASE
        WHEN rollup.verified_review_count = 0 THEN 0::numeric
        ELSE pg_catalog.round(
          rollup.verified_review_count::numeric * (
            1::numeric
            + (
              rollup.total_likes::numeric
              / rollup.verified_review_count::numeric
            ) * 0.1::numeric
          ),
          1
        )
      END AS quality_score
      FROM review_rollup AS rollup
  )
  SELECT
    scored.user_id,
    scored.nickname,
    scored.review_count,
    scored.verified_review_count,
    scored.total_likes,
    scored.avg_likes_per_review,
    scored.quality_score
    FROM scored
   ORDER BY scored.quality_score DESC, scored.user_id ASC
   LIMIT p_limit;
END
$profile_leaderboard$;

REVOKE ALL ON FUNCTION public.read_public_profile_summaries(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_public_profile_leaderboard(text, integer)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_public_profile_summaries(uuid[])
  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_public_profile_leaderboard(text, integer)
  TO anon, authenticated;

DO $allowlist_insert$
DECLARE
  v_rows integer;
BEGIN
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
    signature.source_signature
    FROM (
      VALUES
        ('public.read_public_profile_summaries(uuid[])'::text),
        ('public.read_public_profile_leaderboard(text,integer)'::text)
    ) AS signature(source_signature)
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid =
        pg_catalog.to_regprocedure(signature.source_signature)
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    CROSS JOIN (
      VALUES ('anon'::name), ('authenticated'::name)
    ) AS grantee(name);

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 4 THEN
    RAISE EXCEPTION 'hosted_public_profile_read_allowlist_insert_drift';
  END IF;
END
$allowlist_insert$;



DO $definer_contract$
DECLARE
  v_function_oid constant oid :=
    'privacy_retention.assert_g014_definer_contract()'::pg_catalog.regprocedure;
  v_expected_source_sha256_before constant text :=
    '7633f1fc0b4748b00f2b2890f273ebeb7f2a8cd8cf5f5fd581efe54010a1b599';
  v_expected_source_sha256_after constant text :=
    'c65db3611c0ad2a54ea149cd64fe468d06cbc8e89474166b516a2f5ad6845025';
  v_anchor constant text := $definer_anchor$    IF NOT v_is_definer THEN
      RAISE EXCEPTION 'G014 required SECURITY DEFINER identity is SECURITY INVOKER: %', v_signature;
    END IF;
$definer_anchor$;
  v_replacement constant text := $definer_replacement$    IF v_signature IN (
      'public.read_public_profile_summaries(uuid[])',
      'public.read_public_profile_leaderboard(text,integer)'
    ) AND NOT v_is_definer THEN
      RAISE EXCEPTION 'G014 public profile read boundary became SECURITY INVOKER: %',
        v_signature;
    END IF;
    IF NOT v_is_definer THEN
      RAISE EXCEPTION 'G014 required SECURITY DEFINER identity is SECURITY INVOKER: %', v_signature;
    END IF;
$definer_replacement$;
  v_definition text;
  v_source text;
  v_anchor_count integer;
  v_owner oid;
  v_acl pg_catalog.aclitem[];
  v_security_definer boolean;
  v_config text[];
  v_volatility "char";
  v_kind "char";
  v_returns_set boolean;
  v_return_type oid;
  v_language oid;
BEGIN
  SELECT
    pg_catalog.pg_get_functiondef(procedure.oid),
    procedure.prosrc,
    procedure.proowner,
    procedure.proacl,
    procedure.prosecdef,
    procedure.proconfig,
    procedure.provolatile,
    procedure.prokind,
    procedure.proretset,
    procedure.prorettype,
    procedure.prolang
    INTO
      v_definition,
      v_source,
      v_owner,
      v_acl,
      v_security_definer,
      v_config,
      v_volatility,
      v_kind,
      v_returns_set,
      v_return_type,
      v_language
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = v_function_oid
     AND procedure.proowner =
       'privacy_workflow_owner'::pg_catalog.regrole
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.proparallel = 'u'
     AND procedure.provolatile = 'v'
     AND procedure.prokind = 'f'
     AND NOT procedure.proretset
     AND procedure.prorettype = 'void'::pg_catalog.regtype
     AND procedure.prolang = (
       SELECT language.oid
       FROM pg_catalog.pg_language AS language
       WHERE language.lanname = 'plpgsql'
     )
     AND procedure.proconfig IS NOT DISTINCT FROM
       ARRAY['search_path=""']::text[]
     AND NOT EXISTS (
       WITH expected(grantee, is_grantable) AS (
         VALUES ('privacy_workflow_owner'::name, false)
       ), actual(grantee, is_grantable) AS (
         SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC'::name
                     ELSE pg_catalog.pg_get_userbyid(acl.grantee)::name END,
                acl.is_grantable
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
         WHERE acl.privilege_type = 'EXECUTE'
       )
       SELECT 1 FROM (
         (SELECT * FROM expected EXCEPT SELECT * FROM actual)
         UNION ALL
         (SELECT * FROM actual EXCEPT SELECT * FROM expected)
       ) AS difference
     );

  v_anchor_count := (
    pg_catalog.length(v_source)
    - pg_catalog.length(pg_catalog.replace(v_source, v_anchor, ''))
  ) / pg_catalog.length(v_anchor);
  IF v_definition IS NULL
     OR pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_source, 'UTF8')),
       'hex'
     ) IS DISTINCT FROM v_expected_source_sha256_before
     OR v_anchor_count <> 1 THEN
    RAISE EXCEPTION 'local_profile_read_boundary_definer_source_drift';
  END IF;

  EXECUTE pg_catalog.replace(v_definition, v_anchor, v_replacement);

  SELECT procedure.prosrc
    INTO v_source
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = v_function_oid
     AND procedure.proowner = v_owner
     AND procedure.proacl IS NOT DISTINCT FROM v_acl
     AND procedure.prosecdef IS NOT DISTINCT FROM v_security_definer
     AND NOT procedure.proleakproof
     AND procedure.proparallel = 'u'
     AND procedure.proconfig IS NOT DISTINCT FROM v_config
     AND procedure.provolatile IS NOT DISTINCT FROM v_volatility
     AND procedure.prokind IS NOT DISTINCT FROM v_kind
     AND procedure.proretset IS NOT DISTINCT FROM v_returns_set
     AND procedure.prorettype IS NOT DISTINCT FROM v_return_type
     AND procedure.prolang IS NOT DISTINCT FROM v_language;

  IF v_source IS NULL
     OR pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_source, 'UTF8')),
       'hex'
     ) IS DISTINCT FROM v_expected_source_sha256_after
     OR (
       pg_catalog.length(v_source)
       - pg_catalog.length(
         pg_catalog.replace(v_source, v_replacement, '')
       )
     ) / pg_catalog.length(v_replacement) <> 1 THEN
    RAISE EXCEPTION 'local_profile_read_boundary_definer_readback_drift';
  END IF;
END
$definer_contract$;

DO $catalog_contract$
DECLARE
  v_function_oid constant oid :=
    'privacy_retention.assert_g014_catalog_contract()'::pg_catalog.regprocedure;
  v_expected_source_sha256_before constant text :=
    'b82ac1cecc89fb5bebf07b55c1edaca9df31f5762f2cd6ab7373117e2a5390f5';
  v_expected_source_sha256_after constant text :=
    '8691f4c440fd563552a8ab38f91a19e19595722e0de077ff6016c7033afd3b55';
  v_anchor constant text := $catalog_anchor$    IF v_expected.source_signature IN (
      'public.match_storyboard_documents_hybrid(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)',
$catalog_anchor$;
  v_replacement constant text := $catalog_replacement$    IF v_expected.source_signature IN (
      'public.read_public_profile_summaries(uuid[])',
      'public.read_public_profile_leaderboard(text,integer)'
    ) AND NOT v_is_definer THEN
      RAISE EXCEPTION 'G014 public profile read boundary became SECURITY INVOKER: %',
        v_expected.source_signature;
    END IF;
    IF v_expected.source_signature IN (
      'public.match_storyboard_documents_hybrid(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)',
$catalog_replacement$;
  v_definition text;
  v_source text;
  v_anchor_count integer;
  v_owner oid;
  v_acl pg_catalog.aclitem[];
  v_security_definer boolean;
  v_config text[];
  v_volatility "char";
  v_kind "char";
  v_returns_set boolean;
  v_return_type oid;
  v_language oid;
BEGIN
  SELECT
    pg_catalog.pg_get_functiondef(procedure.oid),
    procedure.prosrc,
    procedure.proowner,
    procedure.proacl,
    procedure.prosecdef,
    procedure.proconfig,
    procedure.provolatile,
    procedure.prokind,
    procedure.proretset,
    procedure.prorettype,
    procedure.prolang
    INTO
      v_definition,
      v_source,
      v_owner,
      v_acl,
      v_security_definer,
      v_config,
      v_volatility,
      v_kind,
      v_returns_set,
      v_return_type,
      v_language
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = v_function_oid
     AND procedure.proowner =
       'privacy_workflow_owner'::pg_catalog.regrole
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.proparallel = 'u'
     AND procedure.provolatile = 'v'
     AND procedure.prokind = 'f'
     AND NOT procedure.proretset
     AND procedure.prorettype = 'void'::pg_catalog.regtype
     AND procedure.prolang = (
       SELECT language.oid
       FROM pg_catalog.pg_language AS language
       WHERE language.lanname = 'plpgsql'
     )
     AND procedure.proconfig IS NOT DISTINCT FROM
       ARRAY['search_path=""']::text[]
     AND NOT EXISTS (
       WITH expected(grantee, is_grantable) AS (
         VALUES ('privacy_workflow_owner'::name, false)
       ), actual(grantee, is_grantable) AS (
         SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC'::name
                     ELSE pg_catalog.pg_get_userbyid(acl.grantee)::name END,
                acl.is_grantable
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
         WHERE acl.privilege_type = 'EXECUTE'
       )
       SELECT 1 FROM (
         (SELECT * FROM expected EXCEPT SELECT * FROM actual)
         UNION ALL
         (SELECT * FROM actual EXCEPT SELECT * FROM expected)
       ) AS difference
     );

  v_anchor_count := (
    pg_catalog.length(v_source)
    - pg_catalog.length(pg_catalog.replace(v_source, v_anchor, ''))
  ) / pg_catalog.length(v_anchor);
  IF v_definition IS NULL
     OR pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_source, 'UTF8')),
       'hex'
     ) IS DISTINCT FROM v_expected_source_sha256_before
     OR v_anchor_count <> 1 THEN
    RAISE EXCEPTION 'local_profile_read_boundary_catalog_source_drift';
  END IF;

  EXECUTE pg_catalog.replace(v_definition, v_anchor, v_replacement);

  SELECT procedure.prosrc
    INTO v_source
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = v_function_oid
     AND procedure.proowner = v_owner
     AND procedure.proacl IS NOT DISTINCT FROM v_acl
     AND procedure.prosecdef IS NOT DISTINCT FROM v_security_definer
     AND NOT procedure.proleakproof
     AND procedure.proparallel = 'u'
     AND procedure.proconfig IS NOT DISTINCT FROM v_config
     AND procedure.provolatile IS NOT DISTINCT FROM v_volatility
     AND procedure.prokind IS NOT DISTINCT FROM v_kind
     AND procedure.proretset IS NOT DISTINCT FROM v_returns_set
     AND procedure.prorettype IS NOT DISTINCT FROM v_return_type
     AND procedure.prolang IS NOT DISTINCT FROM v_language;

  IF v_source IS NULL
     OR pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_source, 'UTF8')),
       'hex'
     ) IS DISTINCT FROM v_expected_source_sha256_after
     OR (
       pg_catalog.length(v_source)
       - pg_catalog.length(
         pg_catalog.replace(v_source, v_replacement, '')
       )
     ) / pg_catalog.length(v_replacement) <> 1 THEN
    RAISE EXCEPTION 'local_profile_read_boundary_catalog_readback_drift';
  END IF;
END
$catalog_contract$;

DO $rpc_contract_readback$
DECLARE
  v_summary oid := pg_catalog.to_regprocedure(
    'public.read_public_profile_summaries(uuid[])'
  );
  v_leaderboard oid := pg_catalog.to_regprocedure(
    'public.read_public_profile_leaderboard(text,integer)'
  );
BEGIN
  IF v_summary IS NULL
     OR v_leaderboard IS NULL
     OR (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_proc AS procedure
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname IN (
            'read_public_profile_summaries',
            'read_public_profile_leaderboard'
          )
     ) <> 2
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS procedure
        WHERE procedure.oid IN (v_summary, v_leaderboard)
          AND (
            procedure.proowner IS DISTINCT FROM
              'privacy_workflow_owner'::pg_catalog.regrole
            OR procedure.prorettype IS DISTINCT FROM
              'record'::pg_catalog.regtype
            OR procedure.proretset IS DISTINCT FROM true
            OR procedure.prokind IS DISTINCT FROM 'f'::"char"
            OR procedure.proleakproof
            OR procedure.proparallel IS DISTINCT FROM 'u'::"char"
            OR procedure.provolatile IS DISTINCT FROM 's'::"char"
            OR procedure.prosecdef IS DISTINCT FROM true
            OR procedure.proconfig IS DISTINCT FROM
              ARRAY['search_path=""']::text[]
            OR procedure.prolang IS DISTINCT FROM (
              SELECT language.oid
                FROM pg_catalog.pg_language AS language
               WHERE language.lanname = 'plpgsql'
            )
            OR pg_catalog.encode(
              pg_catalog.sha256(
                pg_catalog.convert_to(procedure.prosrc, 'UTF8')
              ),
              'hex'
            ) IS DISTINCT FROM CASE procedure.oid
              WHEN v_summary THEN
                '4cb8958c9c9324fcd16aa9264fdebf6ef4e5e91493770ddf10d4c5c91d2e79f7'
              WHEN v_leaderboard THEN
                '23197c61bc37e7ba8366a3b6d99ea30f47812b520bcc0eaeb6712e54ea85a87e'
            END
          )
     ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_function_metadata_drift';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = v_summary
       AND (
         procedure.proargnames IS DISTINCT FROM ARRAY[
           'p_user_ids', 'user_id', 'nickname', 'avatar_url'
         ]::text[]
         OR procedure.proargmodes IS DISTINCT FROM
           ARRAY['i', 't', 't', 't']::"char"[]
         OR procedure.proallargtypes IS DISTINCT FROM ARRAY[
           'uuid[]'::pg_catalog.regtype,
           'uuid'::pg_catalog.regtype,
           'text'::pg_catalog.regtype,
           'text'::pg_catalog.regtype
         ]::oid[]
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = v_leaderboard
       AND (
         procedure.proargnames IS DISTINCT FROM ARRAY[
           'p_period', 'p_limit', 'user_id', 'nickname', 'review_count',
           'verified_review_count', 'total_likes',
           'avg_likes_per_review', 'quality_score'
         ]::text[]
         OR procedure.proargmodes IS DISTINCT FROM ARRAY[
           'i', 'i', 't', 't', 't', 't', 't', 't', 't'
         ]::"char"[]
         OR procedure.proallargtypes IS DISTINCT FROM ARRAY[
           'text'::pg_catalog.regtype,
           'integer'::pg_catalog.regtype,
           'uuid'::pg_catalog.regtype,
           'text'::pg_catalog.regtype,
           'bigint'::pg_catalog.regtype,
           'bigint'::pg_catalog.regtype,
           'bigint'::pg_catalog.regtype,
           'numeric'::pg_catalog.regtype,
           'numeric'::pg_catalog.regtype
         ]::oid[]
       )
  ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_result_shape_drift';
  END IF;

  IF pg_catalog.has_function_privilege(
       'service_role', v_summary, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role', v_leaderboard, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'anon', v_summary, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', v_summary, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'anon', v_leaderboard, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', v_leaderboard, 'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS procedure
         CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
        WHERE procedure.oid IN (v_summary, v_leaderboard)
          AND acl.privilege_type = 'EXECUTE'
          AND (
            acl.grantee NOT IN (
              procedure.proowner,
              'anon'::pg_catalog.regrole,
              'authenticated'::pg_catalog.regrole
            )
            OR (
              acl.grantee <> procedure.proowner
              AND acl.is_grantable
            )
          )
     ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_function_acl_drift';
  END IF;

  IF EXISTS (
    WITH expected(function_oid, grantee, is_grantable) AS (
      VALUES
        (v_summary, 'anon'::name, false),
        (v_summary, 'authenticated'::name, false),
        (v_leaderboard, 'anon'::name, false),
        (v_leaderboard, 'authenticated'::name, false)
    ), actual AS (
      SELECT
        procedure.oid AS function_oid,
        CASE
          WHEN acl.grantee = 0 THEN 'PUBLIC'::name
          ELSE pg_catalog.pg_get_userbyid(acl.grantee)::name
        END AS grantee,
        acl.is_grantable
        FROM pg_catalog.pg_proc AS procedure
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
       WHERE procedure.oid IN (v_summary, v_leaderboard)
         AND acl.privilege_type = 'EXECUTE'
         AND acl.grantee <> procedure.proowner
    )
    SELECT 1
      FROM (
        (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
        UNION ALL
        (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
      ) AS difference
  ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_function_acl_drift';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM privacy_retention.g014_public_rpc_allowlist AS allowed
     WHERE allowed.source_signature IN (
       'public.read_public_profile_summaries(uuid[])',
       'public.read_public_profile_leaderboard(text,integer)'
     )
       AND allowed.grantee IN ('anon'::name, 'authenticated'::name)
       AND pg_catalog.to_regprocedure(allowed.source_signature) IS NOT NULL
       AND allowed.identity_arguments = (
         SELECT procedure.proargtypes::text
           FROM pg_catalog.pg_proc AS procedure
          WHERE procedure.oid =
            pg_catalog.to_regprocedure(allowed.source_signature)
       )
  ) <> 4
     OR pg_catalog.has_table_privilege(
       'anon', 'public.profiles', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.profiles', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_allowlist_readback_drift';
  END IF;
END
$rpc_contract_readback$;

DO $profile_relation_stage_readback$
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
    RAISE EXCEPTION 'hosted_public_profile_read_relation_stage_drift';
  END IF;
END
$profile_relation_stage_readback$;


SELECT privacy_retention.assert_g014_public_rpc_allowlist();
SELECT privacy_retention.assert_g014_definer_contract();

CREATE TEMPORARY TABLE g014_006_catalog_assertion_guard (
  asserted boolean NOT NULL CHECK (asserted)
) ON COMMIT DROP;

REVOKE ALL ON TABLE pg_temp.g014_006_catalog_assertion_guard
  FROM PUBLIC, anon, authenticated, service_role, postgres, supabase_admin;

CREATE FUNCTION pg_temp.g014_006_catalog_assertion_bridge()
RETURNS pg_temp.g014_006_catalog_assertion_guard
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $bridge$
DECLARE
  v_result pg_temp.g014_006_catalog_assertion_guard;
BEGIN
  PERFORM privacy_retention.assert_g014_catalog_contract();
  v_result.asserted := true;
  RETURN v_result;
END
$bridge$;

REVOKE ALL ON FUNCTION pg_temp.g014_006_catalog_assertion_bridge()
  FROM PUBLIC, anon, authenticated, service_role, postgres, supabase_admin;

DO $grant_bridge_execute$
BEGIN
  EXECUTE pg_catalog.format(
    'GRANT EXECUTE ON FUNCTION '
    || 'pg_temp.g014_006_catalog_assertion_bridge() TO %I',
    session_user
  );
END
$grant_bridge_execute$;

RESET ROLE;

DO $membership_restore$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE SET OPTION FOR privacy_workflow_owner FROM %I GRANTED BY %I',
    session_user,
    session_user
  );
END
$membership_restore$;

DO $membership_postcondition$
BEGIN
  IF session_user IS DISTINCT FROM 'postgres'
     OR current_user IS DISTINCT FROM 'postgres'
     OR EXISTS (
       WITH expected(
         role_name, member_name, grantor_name,
         admin_option, inherit_option, set_option
       ) AS (
         VALUES
           (
             'privacy_workflow_owner'::name,
             'postgres'::name,
             'postgres'::name,
             false, true, false
           ),
           (
             'privacy_workflow_owner'::name,
             'postgres'::name,
             'supabase_admin'::name,
             true, false, false
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
    RAISE EXCEPTION 'hosted_public_profile_read_owner_membership_cleanup_drift';
  END IF;
END
$membership_postcondition$;

SELECT privacy_retention.assert_g014_public_rpc_allowlist();

DO $catalog_assertion_readback$
DECLARE
  v_asserted boolean;
BEGIN
  SELECT (pg_temp.g014_006_catalog_assertion_bridge()).asserted
    INTO v_asserted;
  IF v_asserted IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'hosted_public_profile_read_catalog_assertion_failed';
  END IF;
END
$catalog_assertion_readback$;

NOTIFY pgrst, 'reload schema';

-- Add bounded cursor pagination in the same atomic hosted transaction.

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'tzudong:hosted-public-profile-read-page:v1',
    0
  )
);

DO $prerequisites$
DECLARE
  v_definer_source_sha256 constant text :=
    'c65db3611c0ad2a54ea149cd64fe468d06cbc8e89474166b516a2f5ad6845025';
  v_catalog_source_sha256 constant text :=
    '8691f4c440fd563552a8ab38f91a19e19595722e0de077ff6016c7033afd3b55';
BEGIN
  IF pg_catalog.to_regrole('postgres') IS NULL
     OR pg_catalog.to_regrole('service_role') IS NULL
     OR pg_catalog.to_regrole('anon') IS NULL
     OR pg_catalog.to_regrole('authenticated') IS NULL
     OR pg_catalog.to_regrole('privacy_workflow_owner') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.reviews') IS NULL
     OR pg_catalog.to_regclass(
       'privacy_retention.g014_public_rpc_allowlist'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.read_public_profile_summaries(uuid[])'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.read_public_profile_leaderboard(text,integer)'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'privacy_retention.assert_g014_public_rpc_allowlist()'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'privacy_retention.assert_g014_definer_contract()'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'privacy_retention.assert_g014_catalog_contract()'
     ) IS NULL THEN
    RAISE EXCEPTION 'hosted_public_profile_read_page_prerequisite_missing';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname = 'read_public_profile_leaderboard_page'
  ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_page_identity_already_exists';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM privacy_retention.g014_public_rpc_allowlist AS allowed
     WHERE allowed.function_schema = 'public'
       AND allowed.function_name = 'read_public_profile_leaderboard_page'
  ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_page_allowlist_conflict';
  END IF;


  IF (
    SELECT pg_catalog.encode(
      pg_catalog.sha256(
        pg_catalog.convert_to(procedure.prosrc, 'UTF8')
      ),
      'hex'
    )
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid =
       'privacy_retention.assert_g014_definer_contract()'::pg_catalog.regprocedure
  ) IS DISTINCT FROM v_definer_source_sha256
     OR (
       SELECT pg_catalog.encode(
         pg_catalog.sha256(
           pg_catalog.convert_to(procedure.prosrc, 'UTF8')
         ),
         'hex'
       )
         FROM pg_catalog.pg_proc AS procedure
        WHERE procedure.oid =
          'privacy_retention.assert_g014_catalog_contract()'::pg_catalog.regprocedure
     ) IS DISTINCT FROM v_catalog_source_sha256 THEN
    RAISE EXCEPTION 'local_profile_leaderboard_page_g014_source_drift';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) AS acl
    WHERE procedure.oid IN (
      'privacy_retention.assert_g014_definer_contract()'::pg_catalog.regprocedure,
      'privacy_retention.assert_g014_catalog_contract()'::pg_catalog.regprocedure
    )
      AND acl.privilege_type = 'EXECUTE'
      AND (
        acl.grantee IS DISTINCT FROM
          'privacy_workflow_owner'::pg_catalog.regrole
        OR acl.is_grantable
      )
  ) THEN
    RAISE EXCEPTION 'local_profile_leaderboard_page_g014_acl_drift';
  END IF;

  IF pg_catalog.has_table_privilege(
       'anon', 'public.profiles', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.profiles', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'service_role', 'public.profiles', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.profiles', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.reviews', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_page_table_acl_drift';
  END IF;

  IF EXISTS (
    WITH expected(relation_name, column_name, type_name) AS (
      VALUES
        ('profiles'::name, 'user_id'::name, 'uuid'::text),
        ('profiles'::name, 'nickname'::name, 'text'::text),
        ('reviews'::name, 'id'::name, 'uuid'::text),
        ('reviews'::name, 'user_id'::name, 'uuid'::text),
        ('reviews'::name, 'is_verified'::name, 'boolean'::text),
        ('reviews'::name, 'created_at'::name, 'timestamp with time zone'::text),
        ('reviews'::name, 'like_count'::name, 'integer'::text)
    )
    SELECT 1
      FROM expected
      LEFT JOIN pg_catalog.pg_class AS relation
        ON relation.relname = expected.relation_name
       AND relation.relnamespace = 'public'::pg_catalog.regnamespace
      LEFT JOIN pg_catalog.pg_attribute AS attribute
        ON attribute.attrelid = relation.oid
       AND attribute.attname = expected.column_name
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
     WHERE attribute.attname IS NULL
        OR pg_catalog.format_type(
             attribute.atttypid, attribute.atttypmod
           ) IS DISTINCT FROM expected.type_name
  ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_page_column_drift';
  END IF;
END
$prerequisites$;

DO $membership_acquire$
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
             'postgres'::name,
             false, true, false
           ),
           (
             'privacy_workflow_owner'::name,
             'postgres'::name,
             'supabase_admin'::name,
             true, false, false
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
    RAISE EXCEPTION 'hosted_public_profile_read_page_owner_membership_drift';
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
          'postgres'::name,
          false, true, true
        ),
        (
          'privacy_workflow_owner'::name,
          'postgres'::name,
          'supabase_admin'::name,
          true, false, false
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
    RAISE EXCEPTION 'hosted_public_profile_read_page_owner_membership_drift';
  END IF;
END
$membership_acquire$;

SET LOCAL ROLE privacy_workflow_owner;

CREATE FUNCTION public.read_public_profile_leaderboard_page(
  p_period text,
  p_limit integer,
  p_after_quality_score numeric,
  p_after_user_id uuid
)
RETURNS TABLE (
  user_id uuid,
  nickname text,
  review_count bigint,
  verified_review_count bigint,
  total_likes bigint,
  avg_likes_per_review numeric,
  quality_score numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $profile_leaderboard_page$
BEGIN
  IF p_period IS NULL
     OR p_period NOT IN ('all', 'monthly') THEN
    RAISE EXCEPTION 'public_profile_leaderboard_page_period_invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_limit IS NULL
     OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'public_profile_leaderboard_page_limit_invalid'
      USING ERRCODE = '22023';
  END IF;
  IF (p_after_quality_score IS NULL)
       IS DISTINCT FROM (p_after_user_id IS NULL) THEN
    RAISE EXCEPTION 'public_profile_leaderboard_page_cursor_pair_invalid'
      USING ERRCODE = '22023';
  END IF;
  IF p_after_quality_score IS NOT NULL
     AND (
       p_after_quality_score < 0::numeric
       OR p_after_quality_score = 'NaN'::numeric
       OR p_after_quality_score = 'Infinity'::numeric
       OR p_after_quality_score = '-Infinity'::numeric
     ) THEN
    RAISE EXCEPTION 'public_profile_leaderboard_page_cursor_score_invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  WITH profile_rows AS (
    SELECT profile.user_id, profile.nickname
      FROM public.profiles AS profile
     WHERE profile.user_id IS NOT NULL
       AND profile.nickname IS NOT NULL
       AND profile.nickname <> '탈퇴한 사용자'
  ),
  review_rollup AS (
    SELECT
      profile.user_id,
      profile.nickname,
      pg_catalog.count(review_row.id)::bigint AS review_count,
      pg_catalog.count(review_row.id) FILTER (
        WHERE review_row.is_verified IS TRUE
      )::bigint AS verified_review_count,
      COALESCE(
        pg_catalog.sum(review_row.like_count::bigint),
        0::numeric
      )::bigint AS total_likes
      FROM profile_rows AS profile
      LEFT JOIN public.reviews AS review_row
        ON review_row.user_id = profile.user_id
       AND (
         p_period = 'all'
         OR review_row.created_at >= pg_catalog.timezone(
           'Asia/Seoul',
           pg_catalog.date_trunc(
             'month',
             pg_catalog.timezone(
               'Asia/Seoul', pg_catalog.statement_timestamp()
             )
           )
         )
       )
     GROUP BY profile.user_id, profile.nickname
  ),
  scored AS (
    SELECT
      rollup.user_id,
      rollup.nickname,
      rollup.review_count,
      rollup.verified_review_count,
      rollup.total_likes,
      CASE
        WHEN rollup.verified_review_count = 0 THEN 0::numeric
        ELSE pg_catalog.round(
          rollup.total_likes::numeric
          / rollup.verified_review_count::numeric,
          1
        )
      END AS avg_likes_per_review,
      CASE
        WHEN rollup.verified_review_count = 0 THEN 0::numeric
        ELSE pg_catalog.round(
          rollup.verified_review_count::numeric * (
            1::numeric
            + (
              rollup.total_likes::numeric
              / rollup.verified_review_count::numeric
            ) * 0.1::numeric
          ),
          1
        )
      END AS quality_score
      FROM review_rollup AS rollup
  )
  SELECT
    scored.user_id,
    scored.nickname,
    scored.review_count,
    scored.verified_review_count,
    scored.total_likes,
    scored.avg_likes_per_review,
    scored.quality_score
    FROM scored
   WHERE p_after_quality_score IS NULL
      OR scored.quality_score < p_after_quality_score
      OR (
        scored.quality_score = p_after_quality_score
        AND scored.user_id > p_after_user_id
      )
   ORDER BY scored.quality_score DESC, scored.user_id ASC
   LIMIT p_limit;
END
$profile_leaderboard_page$;

REVOKE ALL ON FUNCTION public.read_public_profile_leaderboard_page(
  text, integer, numeric, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_public_profile_leaderboard_page(
  text, integer, numeric, uuid
) TO anon, authenticated;

DO $allowlist_insert$
DECLARE
  v_rows integer;
BEGIN
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
    signature.source_signature
    FROM (
      VALUES (
        'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)'::text
      )
    ) AS signature(source_signature)
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid =
        pg_catalog.to_regprocedure(signature.source_signature)
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    CROSS JOIN (
      VALUES ('anon'::name), ('authenticated'::name)
    ) AS grantee(name);

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 2 THEN
    RAISE EXCEPTION 'hosted_public_profile_read_page_allowlist_insert_drift';
  END IF;
END
$allowlist_insert$;



DO $definer_contract$
DECLARE
  v_function_oid constant oid :=
    'privacy_retention.assert_g014_definer_contract()'::pg_catalog.regprocedure;
  v_expected_source_sha256_before constant text :=
    'c65db3611c0ad2a54ea149cd64fe468d06cbc8e89474166b516a2f5ad6845025';
  v_expected_source_sha256_after constant text :=
    'ee9f485a3ea2a0cc7368fff4230aa7cdbec4d20b2f27e5dabf29129e6f1605c9';
  v_anchor constant text := $definer_anchor$    IF v_signature IN (
      'public.read_public_profile_summaries(uuid[])',
      'public.read_public_profile_leaderboard(text,integer)'
    ) AND NOT v_is_definer THEN
      RAISE EXCEPTION 'G014 public profile read boundary became SECURITY INVOKER: %',
        v_signature;
    END IF;
$definer_anchor$;
  v_replacement constant text := $definer_replacement$    IF v_signature IN (
      'public.read_public_profile_summaries(uuid[])',
      'public.read_public_profile_leaderboard(text,integer)',
      'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)'
    ) AND NOT v_is_definer THEN
      RAISE EXCEPTION 'G014 public profile read boundary became SECURITY INVOKER: %',
        v_signature;
    END IF;
$definer_replacement$;
  v_definition text;
  v_source text;
  v_anchor_count integer;
  v_owner oid;
  v_acl pg_catalog.aclitem[];
  v_security_definer boolean;
  v_config text[];
  v_volatility "char";
  v_kind "char";
  v_returns_set boolean;
  v_return_type oid;
  v_language oid;
BEGIN
  SELECT
    pg_catalog.pg_get_functiondef(procedure.oid),
    procedure.prosrc,
    procedure.proowner,
    procedure.proacl,
    procedure.prosecdef,
    procedure.proconfig,
    procedure.provolatile,
    procedure.prokind,
    procedure.proretset,
    procedure.prorettype,
    procedure.prolang
    INTO
      v_definition,
      v_source,
      v_owner,
      v_acl,
      v_security_definer,
      v_config,
      v_volatility,
      v_kind,
      v_returns_set,
      v_return_type,
      v_language
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = v_function_oid
     AND procedure.proowner =
       'privacy_workflow_owner'::pg_catalog.regrole
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.proparallel = 'u'
     AND procedure.provolatile = 'v'
     AND procedure.prokind = 'f'
     AND NOT procedure.proretset
     AND procedure.prorettype = 'void'::pg_catalog.regtype
     AND procedure.prolang = (
       SELECT language.oid
       FROM pg_catalog.pg_language AS language
       WHERE language.lanname = 'plpgsql'
     )
     AND procedure.proconfig IS NOT DISTINCT FROM
       ARRAY['search_path=""']::text[]
     AND NOT EXISTS (
       WITH expected(grantee, is_grantable) AS (
         VALUES ('privacy_workflow_owner'::name, false)
       ), actual(grantee, is_grantable) AS (
         SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC'::name
                     ELSE pg_catalog.pg_get_userbyid(acl.grantee)::name END,
                acl.is_grantable
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
         WHERE acl.privilege_type = 'EXECUTE'
       )
       SELECT 1 FROM (
         (SELECT * FROM expected EXCEPT SELECT * FROM actual)
         UNION ALL
         (SELECT * FROM actual EXCEPT SELECT * FROM expected)
       ) AS difference
     );

  v_anchor_count := (
    pg_catalog.length(v_source)
    - pg_catalog.length(pg_catalog.replace(v_source, v_anchor, ''))
  ) / pg_catalog.length(v_anchor);
  IF v_definition IS NULL
     OR pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_source, 'UTF8')),
       'hex'
     ) IS DISTINCT FROM v_expected_source_sha256_before
     OR v_anchor_count <> 1 THEN
    RAISE EXCEPTION 'local_profile_leaderboard_page_definer_source_drift';
  END IF;

  EXECUTE pg_catalog.replace(v_definition, v_anchor, v_replacement);

  SELECT procedure.prosrc
    INTO v_source
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = v_function_oid
     AND procedure.proowner = v_owner
     AND procedure.proacl IS NOT DISTINCT FROM v_acl
     AND procedure.prosecdef IS NOT DISTINCT FROM v_security_definer
     AND NOT procedure.proleakproof
     AND procedure.proparallel = 'u'
     AND procedure.proconfig IS NOT DISTINCT FROM v_config
     AND procedure.provolatile IS NOT DISTINCT FROM v_volatility
     AND procedure.prokind IS NOT DISTINCT FROM v_kind
     AND procedure.proretset IS NOT DISTINCT FROM v_returns_set
     AND procedure.prorettype IS NOT DISTINCT FROM v_return_type
     AND procedure.prolang IS NOT DISTINCT FROM v_language;

  IF v_source IS NULL
     OR pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_source, 'UTF8')),
       'hex'
     ) IS DISTINCT FROM v_expected_source_sha256_after
     OR (
       pg_catalog.length(v_source)
       - pg_catalog.length(
         pg_catalog.replace(v_source, v_replacement, '')
       )
     ) / pg_catalog.length(v_replacement) <> 1 THEN
    RAISE EXCEPTION 'local_profile_leaderboard_page_definer_readback_drift';
  END IF;
END
$definer_contract$;

DO $catalog_contract$
DECLARE
  v_function_oid constant oid :=
    'privacy_retention.assert_g014_catalog_contract()'::pg_catalog.regprocedure;
  v_expected_source_sha256_before constant text :=
    '8691f4c440fd563552a8ab38f91a19e19595722e0de077ff6016c7033afd3b55';
  v_expected_source_sha256_after constant text :=
    '9d015ecd1afa1814a8c8139675e7e2fa7e45851c207faf37fa25a7c65e9103da';
  v_anchor constant text := $catalog_anchor$    IF v_expected.source_signature IN (
      'public.read_public_profile_summaries(uuid[])',
      'public.read_public_profile_leaderboard(text,integer)'
    ) AND NOT v_is_definer THEN
      RAISE EXCEPTION 'G014 public profile read boundary became SECURITY INVOKER: %',
        v_expected.source_signature;
    END IF;
$catalog_anchor$;
  v_replacement constant text := $catalog_replacement$    IF v_expected.source_signature IN (
      'public.read_public_profile_summaries(uuid[])',
      'public.read_public_profile_leaderboard(text,integer)',
      'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)'
    ) AND NOT v_is_definer THEN
      RAISE EXCEPTION 'G014 public profile read boundary became SECURITY INVOKER: %',
        v_expected.source_signature;
    END IF;
$catalog_replacement$;
  v_definition text;
  v_source text;
  v_anchor_count integer;
  v_owner oid;
  v_acl pg_catalog.aclitem[];
  v_security_definer boolean;
  v_config text[];
  v_volatility "char";
  v_kind "char";
  v_returns_set boolean;
  v_return_type oid;
  v_language oid;
BEGIN
  SELECT
    pg_catalog.pg_get_functiondef(procedure.oid),
    procedure.prosrc,
    procedure.proowner,
    procedure.proacl,
    procedure.prosecdef,
    procedure.proconfig,
    procedure.provolatile,
    procedure.prokind,
    procedure.proretset,
    procedure.prorettype,
    procedure.prolang
    INTO
      v_definition,
      v_source,
      v_owner,
      v_acl,
      v_security_definer,
      v_config,
      v_volatility,
      v_kind,
      v_returns_set,
      v_return_type,
      v_language
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = v_function_oid
     AND procedure.proowner =
       'privacy_workflow_owner'::pg_catalog.regrole
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND procedure.proparallel = 'u'
     AND procedure.provolatile = 'v'
     AND procedure.prokind = 'f'
     AND NOT procedure.proretset
     AND procedure.prorettype = 'void'::pg_catalog.regtype
     AND procedure.prolang = (
       SELECT language.oid
       FROM pg_catalog.pg_language AS language
       WHERE language.lanname = 'plpgsql'
     )
     AND procedure.proconfig IS NOT DISTINCT FROM
       ARRAY['search_path=""']::text[]
     AND NOT EXISTS (
       WITH expected(grantee, is_grantable) AS (
         VALUES ('privacy_workflow_owner'::name, false)
       ), actual(grantee, is_grantable) AS (
         SELECT CASE WHEN acl.grantee = 0 THEN 'PUBLIC'::name
                     ELSE pg_catalog.pg_get_userbyid(acl.grantee)::name END,
                acl.is_grantable
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
         WHERE acl.privilege_type = 'EXECUTE'
       )
       SELECT 1 FROM (
         (SELECT * FROM expected EXCEPT SELECT * FROM actual)
         UNION ALL
         (SELECT * FROM actual EXCEPT SELECT * FROM expected)
       ) AS difference
     );

  v_anchor_count := (
    pg_catalog.length(v_source)
    - pg_catalog.length(pg_catalog.replace(v_source, v_anchor, ''))
  ) / pg_catalog.length(v_anchor);
  IF v_definition IS NULL
     OR pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_source, 'UTF8')),
       'hex'
     ) IS DISTINCT FROM v_expected_source_sha256_before
     OR v_anchor_count <> 1 THEN
    RAISE EXCEPTION 'local_profile_leaderboard_page_catalog_source_drift';
  END IF;

  EXECUTE pg_catalog.replace(v_definition, v_anchor, v_replacement);

  SELECT procedure.prosrc
    INTO v_source
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = v_function_oid
     AND procedure.proowner = v_owner
     AND procedure.proacl IS NOT DISTINCT FROM v_acl
     AND procedure.prosecdef IS NOT DISTINCT FROM v_security_definer
     AND NOT procedure.proleakproof
     AND procedure.proparallel = 'u'
     AND procedure.proconfig IS NOT DISTINCT FROM v_config
     AND procedure.provolatile IS NOT DISTINCT FROM v_volatility
     AND procedure.prokind IS NOT DISTINCT FROM v_kind
     AND procedure.proretset IS NOT DISTINCT FROM v_returns_set
     AND procedure.prorettype IS NOT DISTINCT FROM v_return_type
     AND procedure.prolang IS NOT DISTINCT FROM v_language;

  IF v_source IS NULL
     OR pg_catalog.encode(
       pg_catalog.sha256(pg_catalog.convert_to(v_source, 'UTF8')),
       'hex'
     ) IS DISTINCT FROM v_expected_source_sha256_after
     OR (
       pg_catalog.length(v_source)
       - pg_catalog.length(
         pg_catalog.replace(v_source, v_replacement, '')
       )
     ) / pg_catalog.length(v_replacement) <> 1 THEN
    RAISE EXCEPTION 'local_profile_leaderboard_page_catalog_readback_drift';
  END IF;
END
$catalog_contract$;

DO $rpc_contract_readback$
DECLARE
  v_page oid := pg_catalog.to_regprocedure(
    'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)'
  );
BEGIN
  IF v_page IS NULL
     OR (
       SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_proc AS procedure
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = procedure.pronamespace
        WHERE namespace.nspname = 'public'
          AND procedure.proname = 'read_public_profile_leaderboard_page'
     ) <> 1
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS procedure
        WHERE procedure.oid = v_page
          AND (
            procedure.proowner IS DISTINCT FROM
              'privacy_workflow_owner'::pg_catalog.regrole
            OR procedure.prorettype IS DISTINCT FROM
              'record'::pg_catalog.regtype
            OR procedure.proretset IS DISTINCT FROM true
            OR procedure.prokind IS DISTINCT FROM 'f'::"char"
            OR procedure.proleakproof
            OR procedure.proparallel IS DISTINCT FROM 'u'::"char"
            OR procedure.provolatile IS DISTINCT FROM 's'::"char"
            OR procedure.prosecdef IS DISTINCT FROM true
            OR procedure.proconfig IS DISTINCT FROM
              ARRAY['search_path=""']::text[]
            OR procedure.prolang IS DISTINCT FROM (
              SELECT language.oid
                FROM pg_catalog.pg_language AS language
               WHERE language.lanname = 'plpgsql'
            )
            OR pg_catalog.encode(
              pg_catalog.sha256(
                pg_catalog.convert_to(procedure.prosrc, 'UTF8')
              ),
              'hex'
            ) IS DISTINCT FROM
              'e8a132569e5ea419609003fdbeb2dcad6c8233d35584e850954e1d4488a62d19'
          )
     ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_page_function_metadata_drift';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = v_page
       AND (
         procedure.proargnames IS DISTINCT FROM ARRAY[
           'p_period', 'p_limit', 'p_after_quality_score', 'p_after_user_id',
           'user_id', 'nickname', 'review_count', 'verified_review_count',
           'total_likes', 'avg_likes_per_review', 'quality_score'
         ]::text[]
         OR procedure.proargmodes IS DISTINCT FROM ARRAY[
           'i', 'i', 'i', 'i', 't', 't', 't', 't', 't', 't', 't'
         ]::"char"[]
         OR procedure.proallargtypes IS DISTINCT FROM ARRAY[
           'text'::pg_catalog.regtype,
           'integer'::pg_catalog.regtype,
           'numeric'::pg_catalog.regtype,
           'uuid'::pg_catalog.regtype,
           'uuid'::pg_catalog.regtype,
           'text'::pg_catalog.regtype,
           'bigint'::pg_catalog.regtype,
           'bigint'::pg_catalog.regtype,
           'bigint'::pg_catalog.regtype,
           'numeric'::pg_catalog.regtype,
           'numeric'::pg_catalog.regtype
         ]::oid[]
       )
  ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_page_result_shape_drift';
  END IF;

  IF pg_catalog.has_function_privilege(
       'service_role', v_page, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'anon', v_page, 'EXECUTE'
     )
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', v_page, 'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS procedure
         CROSS JOIN LATERAL pg_catalog.aclexplode(procedure.proacl) AS acl
        WHERE procedure.oid = v_page
          AND acl.privilege_type = 'EXECUTE'
          AND (
            acl.grantee NOT IN (
              procedure.proowner,
              'anon'::pg_catalog.regrole,
              'authenticated'::pg_catalog.regrole
            )
            OR (
              acl.grantee <> procedure.proowner
              AND acl.is_grantable
            )
          )
     ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_page_function_acl_drift';
  END IF;

  IF EXISTS (
    WITH expected(function_oid, grantee, is_grantable) AS (
      VALUES
        (v_page, 'anon'::name, false),
        (v_page, 'authenticated'::name, false)
    ), actual AS (
      SELECT
        procedure.oid AS function_oid,
        CASE
          WHEN acl.grantee = 0 THEN 'PUBLIC'::name
          ELSE pg_catalog.pg_get_userbyid(acl.grantee)::name
        END AS grantee,
        acl.is_grantable
        FROM pg_catalog.pg_proc AS procedure
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(
            procedure.proacl,
            pg_catalog.acldefault('f', procedure.proowner)
          )
        ) AS acl
       WHERE procedure.oid = v_page
         AND acl.privilege_type = 'EXECUTE'
         AND acl.grantee <> procedure.proowner
    )
    SELECT 1
      FROM (
        (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual)
        UNION ALL
        (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)
      ) AS difference
  ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_page_function_acl_drift';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM privacy_retention.g014_public_rpc_allowlist AS allowed
     WHERE allowed.source_signature =
       'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)'
       AND allowed.grantee IN ('anon'::name, 'authenticated'::name)
       AND pg_catalog.to_regprocedure(allowed.source_signature) IS NOT NULL
       AND allowed.identity_arguments = (
         SELECT procedure.proargtypes::text
           FROM pg_catalog.pg_proc AS procedure
          WHERE procedure.oid =
            pg_catalog.to_regprocedure(allowed.source_signature)
       )
  ) <> 2
     OR pg_catalog.has_table_privilege(
       'anon', 'public.profiles', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'authenticated', 'public.profiles', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'service_role', 'public.profiles', 'SELECT'
     ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_page_allowlist_readback_drift';
  END IF;
END
$rpc_contract_readback$;

DO $profile_relation_terminal$
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
           ('public.profiles'::pg_catalog.regclass::oid, 'postgres'::name,
             ARRAY['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']::text[]),
           ('public.profiles'::pg_catalog.regclass::oid, 'privacy_workflow_owner'::name,
             ARRAY['SELECT','UPDATE']::text[]),
           ('public.reviews'::pg_catalog.regclass::oid, 'anon'::name,
             ARRAY['SELECT']::text[]),
           ('public.reviews'::pg_catalog.regclass::oid, 'authenticated'::name,
             ARRAY['DELETE','INSERT','SELECT','UPDATE']::text[]),
           ('public.reviews'::pg_catalog.regclass::oid, 'postgres'::name,
             ARRAY['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']::text[]),
           ('public.reviews'::pg_catalog.regclass::oid, 'privacy_workflow_owner'::name,
             ARRAY['DELETE','SELECT']::text[]),
           ('public.reviews'::pg_catalog.regclass::oid, 'service_role'::name,
             ARRAY['DELETE','INSERT','MAINTAIN','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE']::text[])
       ), expected_acl(relation_oid, grantee, privilege_type, is_grantable) AS (
         SELECT expected.relation_oid, expected.grantee,
                privilege.privilege_type, false
         FROM expected
         CROSS JOIN LATERAL pg_catalog.unnest(expected.privileges)
           AS privilege(privilege_type)
       ), actual_acl(relation_oid, grantee, privilege_type, is_grantable) AS (
         SELECT relation_row.oid,
                CASE WHEN acl.grantee = 0 THEN 'PUBLIC'::name
                     ELSE pg_catalog.pg_get_userbyid(acl.grantee)::name END,
                acl.privilege_type, acl.is_grantable
         FROM pg_catalog.pg_class AS relation_row
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(relation_row.relacl,
                    pg_catalog.acldefault('r', relation_row.relowner))
         ) AS acl
         WHERE relation_row.oid IN (
           'public.profiles'::pg_catalog.regclass,
           'public.reviews'::pg_catalog.regclass
         )
       )
       SELECT 1 FROM (
         (SELECT * FROM expected_acl EXCEPT SELECT * FROM actual_acl)
         UNION ALL
         (SELECT * FROM actual_acl EXCEPT SELECT * FROM expected_acl)
       ) AS difference
     ) THEN
    RAISE EXCEPTION 'hosted_public_profile_read_relation_terminal_drift';
  END IF;
END
$profile_relation_terminal$;


SELECT privacy_retention.assert_g014_public_rpc_allowlist();
SELECT privacy_retention.assert_g014_definer_contract();

CREATE TEMPORARY TABLE g014_007_catalog_assertion_guard (
  asserted boolean NOT NULL CHECK (asserted)
) ON COMMIT DROP;

REVOKE ALL ON TABLE pg_temp.g014_007_catalog_assertion_guard
  FROM PUBLIC, anon, authenticated, service_role, postgres, supabase_admin;

CREATE FUNCTION pg_temp.g014_007_catalog_assertion_bridge()
RETURNS pg_temp.g014_007_catalog_assertion_guard
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $bridge$
DECLARE
  v_result pg_temp.g014_007_catalog_assertion_guard;
BEGIN
  PERFORM privacy_retention.assert_g014_catalog_contract();
  v_result.asserted := true;
  RETURN v_result;
END
$bridge$;

REVOKE ALL ON FUNCTION pg_temp.g014_007_catalog_assertion_bridge()
  FROM PUBLIC, anon, authenticated, service_role, postgres, supabase_admin;

DO $grant_bridge_execute$
BEGIN
  EXECUTE pg_catalog.format(
    'GRANT EXECUTE ON FUNCTION '
    || 'pg_temp.g014_007_catalog_assertion_bridge() TO %I',
    session_user
  );
END
$grant_bridge_execute$;

RESET ROLE;

DO $membership_restore$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE SET OPTION FOR privacy_workflow_owner FROM %I GRANTED BY %I',
    session_user,
    session_user
  );
END
$membership_restore$;

DO $membership_postcondition$
BEGIN
  IF session_user IS DISTINCT FROM 'postgres'
     OR current_user IS DISTINCT FROM 'postgres'
     OR EXISTS (
       WITH expected(
         role_name, member_name, grantor_name,
         admin_option, inherit_option, set_option
       ) AS (
         VALUES
           (
             'privacy_workflow_owner'::name,
             'postgres'::name,
             'postgres'::name,
             false, true, false
           ),
           (
             'privacy_workflow_owner'::name,
             'postgres'::name,
             'supabase_admin'::name,
             true, false, false
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
    RAISE EXCEPTION 'hosted_public_profile_read_page_owner_membership_cleanup_drift';
  END IF;
END
$membership_postcondition$;

SELECT privacy_retention.assert_g014_public_rpc_allowlist();

DO $catalog_assertion_readback$
DECLARE
  v_asserted boolean;
BEGIN
  SELECT (pg_temp.g014_007_catalog_assertion_bridge()).asserted
    INTO v_asserted;
  IF v_asserted IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'hosted_public_profile_read_page_catalog_assertion_failed';
  END IF;
END
$catalog_assertion_readback$;

NOTIFY pgrst, 'reload schema';
