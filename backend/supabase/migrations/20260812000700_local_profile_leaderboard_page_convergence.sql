-- Add bounded cursor pagination without changing the immutable profile-read boundary.

BEGIN;

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'tzudong:local-profile-leaderboard-page:v1',
    0
  )
);

DO $prerequisites$
DECLARE
  v_definer_source_sha256 constant text :=
    'c65db3611c0ad2a54ea149cd64fe468d06cbc8e89474166b516a2f5ad6845025';
  v_catalog_source_sha256 constant text :=
    '3a5c799d38a35e2c702b7ba0ee69cb291d483f5094a76568d4c92e490eb5b003';
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
    RAISE EXCEPTION 'local_profile_leaderboard_page_prerequisite_missing';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname = 'read_public_profile_leaderboard_page'
  ) THEN
    RAISE EXCEPTION 'local_profile_leaderboard_page_identity_already_exists';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM privacy_retention.g014_public_rpc_allowlist AS allowed
     WHERE allowed.function_schema = 'public'
       AND allowed.function_name = 'read_public_profile_leaderboard_page'
  ) THEN
    RAISE EXCEPTION 'local_profile_leaderboard_page_allowlist_conflict';
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
    RAISE EXCEPTION 'local_profile_leaderboard_page_table_acl_drift';
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
    RAISE EXCEPTION 'local_profile_leaderboard_page_column_drift';
  END IF;
END
$prerequisites$;

DO $membership_acquire$
DECLARE
  v_membership_exists boolean;
  v_set_option boolean := true;
  v_supports_set_option boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
     WHERE membership.roleid =
       'privacy_workflow_owner'::pg_catalog.regrole
       AND membership.member = pg_catalog.to_regrole(session_user)
       AND NOT membership.admin_option
  ) INTO v_membership_exists;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
     WHERE membership.roleid =
       'privacy_workflow_owner'::pg_catalog.regrole
       AND membership.member = pg_catalog.to_regrole(session_user)
       AND membership.admin_option
  ) THEN
    RAISE EXCEPTION 'local_profile_leaderboard_page_owner_membership_drift';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid =
       'pg_catalog.pg_auth_members'::pg_catalog.regclass
       AND attribute.attname = 'set_option'
       AND NOT attribute.attisdropped
  ) INTO v_supports_set_option;

  IF v_membership_exists AND v_supports_set_option THEN
    EXECUTE
      'SELECT membership.set_option '
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
      'g014_007.remove_owner_membership', 'true', true
    );
    PERFORM pg_catalog.set_config(
      'g014_007.restore_owner_set_false', 'false', true
    );
  ELSIF v_supports_set_option AND NOT v_set_option THEN
    EXECUTE pg_catalog.format(
      'GRANT privacy_workflow_owner TO %I WITH SET TRUE',
      session_user
    );
    PERFORM pg_catalog.set_config(
      'g014_007.remove_owner_membership', 'false', true
    );
    PERFORM pg_catalog.set_config(
      'g014_007.restore_owner_set_false', 'true', true
    );
  ELSE
    PERFORM pg_catalog.set_config(
      'g014_007.remove_owner_membership', 'false', true
    );
    PERFORM pg_catalog.set_config(
      'g014_007.restore_owner_set_false', 'false', true
    );
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
    RAISE EXCEPTION 'local_profile_leaderboard_page_allowlist_insert_drift';
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
     AND procedure.proconfig IS NOT DISTINCT FROM
       ARRAY['search_path=""']::text[];

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
    '3a5c799d38a35e2c702b7ba0ee69cb291d483f5094a76568d4c92e490eb5b003';
  v_expected_source_sha256_after constant text :=
    'addca083161250234a8378713dbc07074bfff248f5d0f02f4a8f3772a5b951e6';
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
     AND procedure.proconfig IS NOT DISTINCT FROM
       ARRAY['search_path=""']::text[];

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
            OR procedure.provolatile IS DISTINCT FROM 's'::"char"
            OR procedure.prosecdef IS DISTINCT FROM true
            OR procedure.proconfig IS DISTINCT FROM
              ARRAY['search_path=""']::text[]
            OR procedure.prolang IS DISTINCT FROM (
              SELECT language.oid
                FROM pg_catalog.pg_language AS language
               WHERE language.lanname = 'plpgsql'
            )
          )
     ) THEN
    RAISE EXCEPTION 'local_profile_leaderboard_page_function_metadata_drift';
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
    RAISE EXCEPTION 'local_profile_leaderboard_page_result_shape_drift';
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
    RAISE EXCEPTION 'local_profile_leaderboard_page_function_acl_drift';
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
    RAISE EXCEPTION 'local_profile_leaderboard_page_allowlist_readback_drift';
  END IF;
END
$rpc_contract_readback$;

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
  IF pg_catalog.current_setting(
    'g014_007.restore_owner_set_false',
    true
  ) = 'true' THEN
    EXECUTE pg_catalog.format(
      'GRANT privacy_workflow_owner TO %I WITH SET FALSE',
      session_user
    );
  ELSIF pg_catalog.current_setting(
    'g014_007.remove_owner_membership',
    true
  ) = 'true' THEN
    EXECUTE pg_catalog.format(
      'REVOKE privacy_workflow_owner FROM %I',
      session_user
    );
  END IF;
END
$membership_restore$;

DO $membership_postcondition$
DECLARE
  v_membership_exists boolean;
  v_set_option boolean := true;
  v_supports_set_option boolean;
  v_remove boolean := pg_catalog.current_setting(
    'g014_007.remove_owner_membership',
    true
  ) = 'true';
  v_restore_set_false boolean := pg_catalog.current_setting(
    'g014_007.restore_owner_set_false',
    true
  ) = 'true';
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
     WHERE membership.roleid =
       'privacy_workflow_owner'::pg_catalog.regrole
       AND membership.member = pg_catalog.to_regrole(session_user)
       AND NOT membership.admin_option
  ) INTO v_membership_exists;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
     WHERE membership.roleid =
       'privacy_workflow_owner'::pg_catalog.regrole
       AND membership.member = pg_catalog.to_regrole(session_user)
       AND membership.admin_option
  ) THEN
    RAISE EXCEPTION 'local_profile_leaderboard_page_owner_membership_cleanup_drift';
  END IF;

  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid =
       'pg_catalog.pg_auth_members'::pg_catalog.regclass
       AND attribute.attname = 'set_option'
       AND NOT attribute.attisdropped
  ) INTO v_supports_set_option;

  IF v_membership_exists AND v_supports_set_option THEN
    EXECUTE
      'SELECT membership.set_option '
      || 'FROM pg_catalog.pg_auth_members AS membership '
      || 'WHERE membership.roleid = '
      || '''privacy_workflow_owner''::pg_catalog.regrole '
      || 'AND membership.member = pg_catalog.to_regrole(session_user)'
      INTO v_set_option;
  END IF;

  IF (v_remove AND v_membership_exists)
     OR (NOT v_remove AND NOT v_membership_exists)
     OR (
       NOT v_remove
       AND v_supports_set_option
       AND v_set_option IS DISTINCT FROM (NOT v_restore_set_false)
     ) THEN
    RAISE EXCEPTION 'local_profile_leaderboard_page_owner_membership_cleanup_drift';
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
    RAISE EXCEPTION 'local_profile_leaderboard_page_catalog_assertion_failed';
  END IF;
END
$catalog_assertion_readback$;

NOTIFY pgrst, 'reload schema';

COMMIT;
