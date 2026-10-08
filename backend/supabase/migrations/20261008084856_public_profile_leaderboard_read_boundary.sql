-- Restore the existing bounded public leaderboard contract on hosted databases.
-- The client already calls this cursor RPC. Keep private profiles and all other RPCs unchanged.
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tzudong:public-profile-leaderboard-read:v1',0));

-- PostgreSQL 17 tracks grants separately by grantor. Preserve every existing row.
DO $membership_acquire$
DECLARE
  v_self_set boolean;
  v_self_inherit boolean;
  v_self_admin boolean;
BEGIN
  PERFORM pg_catalog.set_config('public_profile_leaderboard.remove_legacy_grant','false',true);
  IF pg_catalog.current_setting('server_version_num')::integer < 170000 THEN
    IF NOT pg_catalog.pg_has_role(session_user,'privacy_workflow_owner','MEMBER') THEN
      EXECUTE pg_catalog.format('GRANT privacy_workflow_owner TO %I',session_user);
      PERFORM pg_catalog.set_config('public_profile_leaderboard.remove_legacy_grant','true',true);
    END IF;
    RETURN;
  END IF;
  PERFORM pg_catalog.set_config('public_profile_leaderboard.remove_self_grant','false',true);
  PERFORM pg_catalog.set_config('public_profile_leaderboard.restore_self_set','false',true);
  IF NOT pg_catalog.pg_has_role(session_user,'privacy_workflow_owner','SET') THEN
    SELECT m.set_option,m.inherit_option,m.admin_option
      INTO v_self_set,v_self_inherit,v_self_admin
      FROM pg_catalog.pg_auth_members m
     WHERE m.roleid='privacy_workflow_owner'::pg_catalog.regrole
       AND m.member=pg_catalog.to_regrole(session_user)
       AND m.grantor=pg_catalog.to_regrole(session_user);
    IF FOUND THEN
      EXECUTE pg_catalog.format(
        'GRANT privacy_workflow_owner TO %I WITH ADMIN %s, INHERIT %s, SET TRUE GRANTED BY %I',
        session_user,v_self_admin,v_self_inherit,session_user);
      PERFORM pg_catalog.set_config('public_profile_leaderboard.restore_self_set','true',true);
    ELSE
      EXECUTE pg_catalog.format(
        'GRANT privacy_workflow_owner TO %I WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY %I',
        session_user,session_user);
      PERFORM pg_catalog.set_config('public_profile_leaderboard.remove_self_grant','true',true);
    END IF;
  END IF;
END
$membership_acquire$;

SET LOCAL ROLE privacy_workflow_owner;

DO $prerequisites$
BEGIN
  IF pg_catalog.to_regrole('privacy_workflow_owner') IS NULL
     OR pg_catalog.to_regrole('anon') IS NULL
     OR pg_catalog.to_regrole('authenticated') IS NULL
     OR pg_catalog.to_regrole('service_role') IS NULL
     OR pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.reviews') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.g014_public_rpc_allowlist') IS NULL THEN
    RAISE EXCEPTION 'public_profile_leaderboard_prerequisite_missing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
             WHERE n.nspname='public' AND p.proname='read_public_profile_leaderboard_page'
               AND (p.oid IS DISTINCT FROM pg_catalog.to_regprocedure('public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)')
                    OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex') <> 'e8a132569e5ea419609003fdbeb2dcad6c8233d35584e850954e1d4488a62d19'
                    OR pg_catalog.pg_get_function_result(p.oid) <> 'TABLE(user_id uuid, nickname text, review_count bigint, verified_review_count bigint, total_likes bigint, avg_likes_per_review numeric, quality_score numeric)'
                    OR pg_catalog.pg_get_function_arguments(p.oid) <> 'p_period text, p_limit integer, p_after_quality_score numeric, p_after_user_id uuid')) THEN
    RAISE EXCEPTION 'public_profile_leaderboard_existing_contract_drift';
  END IF;
  IF pg_catalog.has_table_privilege('anon','public.profiles','SELECT')
     OR pg_catalog.has_table_privilege('authenticated','public.profiles','SELECT')
     OR pg_catalog.has_table_privilege('service_role','public.profiles','SELECT')
     OR NOT pg_catalog.has_table_privilege('privacy_workflow_owner','public.profiles','SELECT')
     OR NOT pg_catalog.has_table_privilege('privacy_workflow_owner','public.reviews','SELECT') THEN
    RAISE EXCEPTION 'public_profile_leaderboard_table_acl_drift';
  END IF;
END
$prerequisites$;

DO $restore_leaderboard$
BEGIN
  IF pg_catalog.to_regprocedure('public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)') IS NULL THEN
    EXECUTE $definition$
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

    $definition$;
REVOKE ALL ON FUNCTION public.read_public_profile_leaderboard_page(
  text, integer, numeric, uuid
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_public_profile_leaderboard_page(
  text, integer, numeric, uuid
) TO anon, authenticated;

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
  'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)'
FROM pg_catalog.pg_proc AS procedure
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = procedure.pronamespace
CROSS JOIN (VALUES ('anon'::name), ('authenticated'::name)) AS grantee(name)
WHERE procedure.oid = 'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)'::regprocedure
ON CONFLICT (source_signature, grantee) DO UPDATE
SET function_schema = EXCLUDED.function_schema,
    function_name = EXCLUDED.function_name,
    identity_arguments = EXCLUDED.identity_arguments;

  END IF;
END
$restore_leaderboard$;

DO $readback$
DECLARE
  v_oid oid := 'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)'::pg_catalog.regprocedure;
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
    RAISE EXCEPTION 'public_profile_leaderboard_read_function_contract_drift';
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
        WHERE acl.grantee NOT IN (
                'privacy_workflow_owner'::pg_catalog.regrole,
                'anon'::pg_catalog.regrole, 'authenticated'::pg_catalog.regrole
              ) OR acl.is_grantable
     ) THEN
    RAISE EXCEPTION 'public_profile_leaderboard_read_function_acl_drift';
  END IF;

  SELECT count(*)
    INTO v_allowlist_rows
    FROM privacy_retention.g014_public_rpc_allowlist AS allowed
   WHERE allowed.source_signature =
     'public.read_public_profile_leaderboard_page(text,integer,numeric,uuid)'
     AND allowed.grantee IN ('anon'::name, 'authenticated'::name)
     AND allowed.function_schema = 'public'
     AND allowed.function_name = 'read_public_profile_leaderboard_page'
     AND allowed.identity_arguments = (
       SELECT procedure.proargtypes::text
         FROM pg_catalog.pg_proc AS procedure
        WHERE procedure.oid = v_oid
     );

  IF v_allowlist_rows <> 2
     OR pg_catalog.has_table_privilege('anon', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('service_role', 'public.profiles', 'SELECT') THEN
    RAISE EXCEPTION 'public_profile_leaderboard_read_allowlist_readback_drift';
  END IF;
END
$readback$;

SELECT privacy_retention.assert_g014_public_rpc_allowlist();
SELECT privacy_retention.assert_g014_definer_contract();
-- The catalog assertion checks the restored role-membership state after cleanup.
-- Run the unchanged full G014 assertions in the isolated replay after COMMIT.

RESET ROLE;

DO $membership_cleanup$
BEGIN
  IF pg_catalog.current_setting('public_profile_leaderboard.remove_legacy_grant',true)='true' THEN
    EXECUTE pg_catalog.format('REVOKE privacy_workflow_owner FROM %I',session_user);
  ELSIF pg_catalog.current_setting('public_profile_leaderboard.remove_self_grant',true)='true' THEN
    EXECUTE pg_catalog.format('REVOKE privacy_workflow_owner FROM %I GRANTED BY %I',session_user,session_user);
  ELSIF pg_catalog.current_setting('public_profile_leaderboard.restore_self_set',true)='true' THEN
    EXECUTE pg_catalog.format('GRANT privacy_workflow_owner TO %I WITH SET FALSE GRANTED BY %I',session_user,session_user);
  END IF;
END
$membership_cleanup$;

NOTIFY pgrst, 'reload schema';

COMMIT;
