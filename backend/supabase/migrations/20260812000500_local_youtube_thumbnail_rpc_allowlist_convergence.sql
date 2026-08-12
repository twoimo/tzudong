-- Register the already-hardened thumbnail publication RPC in the exact G014
-- Data API matrix. Applied migrations are immutable; this migration changes no
-- RPC grant, converges ownership to the trusted workflow owner, and refuses to
-- infer around signature, implementation, ACL, or catalog drift.

BEGIN;

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended(
    'tzudong:local-youtube-thumbnail-rpc-allowlist:v1',
    0
  )
);

DO $prerequisites$
DECLARE
  v_signature constant text :=
    'public.publish_youtube_thumbnail_release(uuid,text,text,text,text,text,text,text,text,numeric,jsonb,jsonb,jsonb,jsonb,uuid,timestamp with time zone)';
  v_function_oid oid;
  v_function record;
  v_named_overloads integer;
  v_service_role oid;
  v_postgres oid;
BEGIN
  IF pg_catalog.to_regrole('postgres') IS NULL
     OR pg_catalog.to_regrole('service_role') IS NULL
     OR pg_catalog.to_regrole('anon') IS NULL
     OR pg_catalog.to_regrole('authenticated') IS NULL
     OR pg_catalog.to_regclass(
       'privacy_retention.g014_public_rpc_allowlist'
     ) IS NULL
     OR pg_catalog.to_regclass('public.youtube_thumbnail_releases') IS NULL
     OR pg_catalog.to_regprocedure(
       'privacy_retention.assert_g014_public_rpc_allowlist()'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'privacy_retention.assert_g014_catalog_contract()'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'privacy_retention.assert_g014_definer_contract()'
     ) IS NULL THEN
    RAISE EXCEPTION 'local_youtube_thumbnail_rpc_allowlist_prerequisite_missing';
  END IF;

  v_function_oid := pg_catalog.to_regprocedure(v_signature);
  v_service_role := pg_catalog.to_regrole('service_role');
  v_postgres := pg_catalog.to_regrole('postgres');

  SELECT count(*)
    INTO v_named_overloads
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = 'publish_youtube_thumbnail_release';

  SELECT
    procedure.pronargs,
    procedure.proargnames,
    procedure.proargtypes::text AS identity_arguments,
    procedure.prorettype,
    procedure.proretset,
    procedure.prokind,
    language.lanname,
    procedure.provolatile,
    procedure.prosecdef,
    procedure.proconfig,
    procedure.prosrc,
    pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name
    INTO v_function
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
   WHERE procedure.oid = v_function_oid;

  IF v_function_oid IS NULL
     OR v_named_overloads <> 1
     OR v_function.pronargs <> 16
     OR v_function.proargnames IS DISTINCT FROM ARRAY[
       'p_id',
       'p_release_key',
       'p_candidate_id',
       'p_source_manifest_id',
       'p_source_image_id',
       'p_storage_bucket',
       'p_storage_object_path',
       'p_browser_image_path',
       'p_sha256',
       'p_score',
       'p_issue_tags',
       'p_text_layers',
       'p_canvas',
       'p_source_quality_gate',
       'p_published_by',
       'p_published_at'
     ]::text[]
     OR v_function.prorettype IS DISTINCT FROM
       'public.youtube_thumbnail_releases'::pg_catalog.regtype
     OR v_function.proretset IS DISTINCT FROM false
     OR v_function.prokind IS DISTINCT FROM 'f'::"char"
     OR v_function.lanname IS DISTINCT FROM 'plpgsql'
     OR v_function.provolatile IS DISTINCT FROM 'v'::"char"
     OR v_function.prosecdef IS DISTINCT FROM false
     OR v_function.proconfig IS DISTINCT FROM
       ARRAY['search_path=""']::text[]
     OR pg_catalog.encode(
       pg_catalog.sha256(
         pg_catalog.convert_to(v_function.prosrc, 'UTF8')
       ),
       'hex'
     ) IS DISTINCT FROM
       'c66d8c05ab53df5547301e5fb8af1929cf716a9e7e5d4747db45ae00577310ea'
     OR v_function.owner_name NOT IN (
       'postgres',
       'supabase_admin'
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', v_function_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'anon', v_function_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'authenticated', v_function_oid, 'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS procedure
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE procedure.oid = v_function_oid
          AND acl.privilege_type = 'EXECUTE'
          AND (
            acl.grantee NOT IN (
              procedure.proowner,
              v_postgres,
              v_service_role
            )
            OR (
              acl.grantee IN (v_postgres, v_service_role)
              AND acl.grantee <> procedure.proowner
              AND acl.is_grantable
            )
          )
     )
     OR (
       SELECT count(*)
         FROM pg_catalog.pg_proc AS procedure
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE procedure.oid = v_function_oid
          AND acl.grantee = v_service_role
          AND acl.privilege_type = 'EXECUTE'
          AND NOT acl.is_grantable
     ) <> 1
     OR (
       SELECT count(*)
         FROM pg_catalog.pg_proc AS procedure
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE procedure.oid = v_function_oid
          AND acl.grantee = procedure.proowner
          AND acl.privilege_type = 'EXECUTE'
          AND NOT acl.is_grantable
     ) <> 1 THEN
    RAISE EXCEPTION 'local_youtube_thumbnail_rpc_catalog_contract_drift';
  END IF;

  IF EXISTS (
    SELECT
      allowed.function_schema,
      allowed.function_name,
      allowed.identity_arguments,
      allowed.grantee,
      allowed.source_signature
      FROM privacy_retention.g014_public_rpc_allowlist AS allowed
     WHERE (
       allowed.function_schema = 'public'
       AND allowed.function_name = 'publish_youtube_thumbnail_release'
     )
        OR allowed.source_signature = v_signature
     EXCEPT
    SELECT
      'public'::name,
      'publish_youtube_thumbnail_release'::name,
      v_function.identity_arguments,
      'service_role'::name,
      v_signature
  ) THEN
    RAISE EXCEPTION 'local_youtube_thumbnail_rpc_allowlist_conflict';
  END IF;
END
$prerequisites$;

-- Both supported migration executors own the post-001 function but are not
-- durably members of the protected owner role. Acquire only transaction-local
-- SET authority and remember the exact prior state for restoration before any
-- G014 assertion observes role membership.
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
    RAISE EXCEPTION 'local_youtube_thumbnail_rpc_owner_membership_drift';
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
      'g014_005.remove_owner_membership', 'true', true
    );
    PERFORM pg_catalog.set_config(
      'g014_005.restore_owner_set_false', 'false', true
    );
  ELSIF v_supports_set_option AND NOT v_set_option THEN
    EXECUTE pg_catalog.format(
      'GRANT privacy_workflow_owner TO %I WITH SET TRUE',
      session_user
    );
    PERFORM pg_catalog.set_config(
      'g014_005.remove_owner_membership', 'false', true
    );
    PERFORM pg_catalog.set_config(
      'g014_005.restore_owner_set_false', 'true', true
    );
  ELSE
    PERFORM pg_catalog.set_config(
      'g014_005.remove_owner_membership', 'false', true
    );
    PERFORM pg_catalog.set_config(
      'g014_005.restore_owner_set_false', 'false', true
    );
  END IF;
END
$membership_acquire$;

ALTER FUNCTION public.publish_youtube_thumbnail_release(
  uuid, text, text, text, text, text, text, text, text, numeric,
  jsonb, jsonb, jsonb, jsonb, uuid, timestamptz
) OWNER TO privacy_workflow_owner;

SET LOCAL ROLE privacy_workflow_owner;

DO $owner_readback$
DECLARE
  v_function_oid constant oid := pg_catalog.to_regprocedure(
    'public.publish_youtube_thumbnail_release(uuid,text,text,text,text,text,text,text,text,numeric,jsonb,jsonb,jsonb,jsonb,uuid,timestamp with time zone)'
  );
BEGIN
  IF v_function_oid IS NULL
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS procedure
        WHERE procedure.oid = v_function_oid
          AND (
            procedure.proowner IS DISTINCT FROM
              'privacy_workflow_owner'::pg_catalog.regrole
            OR procedure.prosecdef IS DISTINCT FROM false
            OR procedure.proconfig IS DISTINCT FROM
              ARRAY['search_path=""']::text[]
            OR pg_catalog.encode(
              pg_catalog.sha256(
                pg_catalog.convert_to(procedure.prosrc, 'UTF8')
              ),
              'hex'
            ) IS DISTINCT FROM
              'c66d8c05ab53df5547301e5fb8af1929cf716a9e7e5d4747db45ae00577310ea'
          )
     )
     OR NOT pg_catalog.has_function_privilege(
       'service_role', v_function_oid, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('anon', v_function_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege(
       'authenticated', v_function_oid, 'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS procedure
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE procedure.oid = v_function_oid
          AND acl.privilege_type = 'EXECUTE'
          AND (
            acl.grantee NOT IN (
              procedure.proowner,
              'postgres'::pg_catalog.regrole,
              'service_role'::pg_catalog.regrole
            )
            OR (
              acl.grantee IN (
                'postgres'::pg_catalog.regrole,
                'service_role'::pg_catalog.regrole
              )
              AND acl.grantee <> procedure.proowner
              AND acl.is_grantable
            )
          )
     )
     OR (
       SELECT count(*)
         FROM pg_catalog.pg_proc AS procedure
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE procedure.oid = v_function_oid
          AND acl.grantee = 'service_role'::pg_catalog.regrole
          AND acl.privilege_type = 'EXECUTE'
          AND NOT acl.is_grantable
     ) <> 1
     OR (
       SELECT count(*)
         FROM pg_catalog.pg_proc AS procedure
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE procedure.oid = v_function_oid
          AND acl.grantee = procedure.proowner
          AND acl.privilege_type = 'EXECUTE'
          AND NOT acl.is_grantable
     ) <> 1 THEN
    RAISE EXCEPTION 'local_youtube_thumbnail_rpc_owner_readback_drift';
  END IF;
END
$owner_readback$;

DO $allowlist_upsert$
DECLARE
  v_signature constant text :=
    'public.publish_youtube_thumbnail_release(uuid,text,text,text,text,text,text,text,text,numeric,jsonb,jsonb,jsonb,jsonb,uuid,timestamp with time zone)';
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
    'service_role'::name,
    v_signature
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE procedure.oid = pg_catalog.to_regprocedure(v_signature)
  ON CONFLICT (source_signature, grantee) DO UPDATE
  SET function_schema = EXCLUDED.function_schema,
      function_name = EXCLUDED.function_name,
      identity_arguments = EXCLUDED.identity_arguments;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'local_youtube_thumbnail_rpc_allowlist_upsert_count_drift';
  END IF;

  IF (
    SELECT count(*)
      FROM privacy_retention.g014_public_rpc_allowlist AS allowed
      JOIN pg_catalog.pg_proc AS procedure
        ON procedure.oid = pg_catalog.to_regprocedure(v_signature)
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE allowed.function_schema = namespace.nspname
       AND allowed.function_name = procedure.proname
       AND allowed.identity_arguments = procedure.proargtypes::text
       AND allowed.grantee = 'service_role'::name
       AND allowed.source_signature = v_signature
  ) <> 1 THEN
    RAISE EXCEPTION 'local_youtube_thumbnail_rpc_allowlist_readback_drift';
  END IF;
END
$allowlist_upsert$;

-- The earlier definer assertion has its own deliberately smaller list of the
-- three concrete SECURITY INVOKER identities that existed at G014. Patch that
-- complete post-G041 source before the final catalog assertion can call it.
DO $definer_contract$
DECLARE
  v_function_oid constant oid :=
    'privacy_retention.assert_g014_definer_contract()'::pg_catalog.regprocedure;
  v_expected_source_sha256_before_extensions constant text :=
    'fae34d72db537f15f2e87c304ef2c06e960068942908551fa39bb7dbe2655277';
  v_expected_source_sha256_before_public constant text :=
    'e319cb3d15d43cf40ddafd705e2832f506ca82af8f04f5a221cf774ae58b7b67';
  v_expected_source_sha256_after constant text :=
    '7633f1fc0b4748b00f2b2890f273ebeb7f2a8cd8cf5f5fd581efe54010a1b599';
  v_invoker_anchor_extensions constant text := $definer_invoker_anchor_extensions$    IF v_signature IN (
      'public.match_storyboard_documents_hybrid(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)',
      'public.match_storyboard_documents_hybrid_v2(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)',
      'public.ocr_log_metadata_is_safe(jsonb)'
    ) THEN
      IF v_is_definer THEN
        RAISE EXCEPTION 'G014 declared SECURITY INVOKER RPC became SECURITY DEFINER: %', v_signature;
      END IF;
      CONTINUE;
$definer_invoker_anchor_extensions$;
  v_invoker_anchor_public constant text := $definer_invoker_anchor_public$    IF v_signature IN (
      'public.match_storyboard_documents_hybrid(uuid,public.vector,jsonb,double precision,integer,integer,jsonb)',
      'public.match_storyboard_documents_hybrid_v2(uuid,public.vector,jsonb,double precision,integer,integer,jsonb)',
      'public.ocr_log_metadata_is_safe(jsonb)'
    ) THEN
      IF v_is_definer THEN
        RAISE EXCEPTION 'G014 declared SECURITY INVOKER RPC became SECURITY DEFINER: %', v_signature;
      END IF;
      CONTINUE;
$definer_invoker_anchor_public$;
  v_invoker_replacement constant text := $definer_invoker_replacement$    IF v_signature IN (
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
$definer_invoker_replacement$;
  v_definition text;
  v_source text;
  v_source_sha256 text;
  v_invoker_anchor text;
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

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'local_g014_definer_contract_identity_drift';
  END IF;

  v_source_sha256 := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_source, 'UTF8')),
    'hex'
  );
  IF v_source_sha256 = v_expected_source_sha256_before_extensions THEN
    v_invoker_anchor := v_invoker_anchor_extensions;
  ELSIF v_source_sha256 = v_expected_source_sha256_before_public THEN
    v_invoker_anchor := v_invoker_anchor_public;
  ELSE
    RAISE EXCEPTION 'local_g014_definer_contract_source_drift';
  END IF;
  v_anchor_count := (
    pg_catalog.length(v_source)
    - pg_catalog.length(pg_catalog.replace(v_source, v_invoker_anchor, ''))
  ) / pg_catalog.length(v_invoker_anchor);

  IF v_anchor_count <> 1 THEN
    RAISE EXCEPTION 'local_g014_definer_contract_source_drift';
  END IF;

  EXECUTE pg_catalog.replace(
    v_definition,
    v_invoker_anchor,
    v_invoker_replacement
  );

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
         pg_catalog.replace(v_source, v_invoker_replacement, '')
       )
     ) / pg_catalog.length(v_invoker_replacement) <> 1 THEN
    RAISE EXCEPTION 'local_g014_definer_contract_readback_drift';
  END IF;
END
$definer_contract$;

-- G041 already made two exact owner-predicate substitutions in this function.
-- Bind those complete source bytes before adding the only two post-G014
-- SECURITY INVOKER identities. CREATE OR REPLACE preserves its OID, owner, ACL,
-- security mode, volatility, return type, and empty search_path; all are read
-- back after the exact single-anchor replacement.
DO $catalog_contract$
DECLARE
  v_function_oid constant oid :=
    'privacy_retention.assert_g014_catalog_contract()'::pg_catalog.regprocedure;
  v_expected_source_sha256_before constant text :=
    '8446731d59f1efcd41e6a58c8b253a9308b314bf3d6f35af4999f408c6a25be4';
  v_expected_source_sha256_after constant text :=
    '9aa3bd25e13e3b5eb896a19363e0be2e8356031cf121a39d836cf2efdb214efa';
  v_invoker_anchor constant text := $invoker_anchor$      'public.ocr_log_metadata_is_safe(jsonb)'
    ) THEN
      IF v_is_definer THEN
        RAISE EXCEPTION 'G014 declared SECURITY INVOKER public RPC became SECURITY DEFINER: %',
          v_expected.source_signature;
      END IF;
$invoker_anchor$;
  v_invoker_replacement constant text := $invoker_replacement$      'public.ocr_log_metadata_is_safe(jsonb)',
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
        FROM pg_catalog.unnest((
          SELECT procedure.proconfig
          FROM pg_catalog.pg_proc AS procedure
          WHERE procedure.oid = v_procedure
        )) AS setting(value)
        WHERE setting.value LIKE 'search_path=%';
        IF pg_catalog.pg_get_userbyid((
             SELECT procedure.proowner
             FROM pg_catalog.pg_proc AS procedure
             WHERE procedure.oid = v_procedure
           )) IS DISTINCT FROM 'privacy_workflow_owner'
           OR (v_search_path IS DISTINCT FROM 'search_path='
               AND v_search_path IS DISTINCT FROM 'search_path=""') THEN
          RAISE EXCEPTION 'G014 post-contract SECURITY INVOKER public RPC owner/path mismatch: %',
            v_expected.source_signature;
        END IF;
      END IF;
$invoker_replacement$;
  v_definition text;
  v_source text;
  v_source_sha256 text;
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

  IF v_definition IS NULL THEN
    RAISE EXCEPTION 'local_g014_catalog_contract_identity_drift';
  END IF;

  v_source_sha256 := pg_catalog.encode(
    pg_catalog.sha256(pg_catalog.convert_to(v_source, 'UTF8')),
    'hex'
  );
  v_anchor_count := (
    pg_catalog.length(v_source)
    - pg_catalog.length(pg_catalog.replace(v_source, v_invoker_anchor, ''))
  ) / pg_catalog.length(v_invoker_anchor);

  IF v_source_sha256 IS DISTINCT FROM v_expected_source_sha256_before
     OR v_anchor_count <> 1 THEN
    RAISE EXCEPTION 'local_g014_catalog_contract_source_drift';
  END IF;

  EXECUTE pg_catalog.replace(
    v_definition,
    v_invoker_anchor,
    v_invoker_replacement
  );

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
         pg_catalog.replace(v_source, v_invoker_replacement, '')
       )
     ) / pg_catalog.length(v_invoker_replacement) <> 1 THEN
    RAISE EXCEPTION 'local_g014_catalog_contract_readback_drift';
  END IF;
END
$catalog_contract$;

RESET ROLE;

DO $membership_restore$
BEGIN
  IF pg_catalog.current_setting(
    'g014_005.restore_owner_set_false',
    true
  ) = 'true' THEN
    EXECUTE pg_catalog.format(
      'GRANT privacy_workflow_owner TO %I WITH SET FALSE',
      session_user
    );
  ELSIF pg_catalog.current_setting(
    'g014_005.remove_owner_membership',
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
    'g014_005.remove_owner_membership',
    true
  ) = 'true';
  v_restore_set_false boolean := pg_catalog.current_setting(
    'g014_005.restore_owner_set_false',
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
    RAISE EXCEPTION 'local_youtube_thumbnail_rpc_owner_membership_cleanup_drift';
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
    RAISE EXCEPTION 'local_youtube_thumbnail_rpc_owner_membership_cleanup_drift';
  END IF;
END
$membership_postcondition$;

SELECT privacy_retention.assert_g014_public_rpc_allowlist();
SELECT privacy_retention.assert_g014_catalog_contract();

NOTIFY pgrst, 'reload schema';

COMMIT;
