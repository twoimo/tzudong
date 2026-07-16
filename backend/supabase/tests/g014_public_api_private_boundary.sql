\set ON_ERROR_STOP on

BEGIN;
-- Reapplying a canonical G014 must retain every moved relation, dependent
-- catalog object, and hardened definition without source-text drift.
CREATE TEMPORARY TABLE pg_temp.g014_rerun_relations AS
SELECT relation.oid,
       namespace.nspname,
       relation.relname,
       relation.relowner,
       relation.relrowsecurity,
       relation.relforcerowsecurity,
       (
         SELECT count(*)
         FROM pg_catalog.pg_index AS index_row
         WHERE index_row.indrelid = relation.oid
       ) AS index_count,
       (
         SELECT count(*)
         FROM pg_catalog.pg_constraint AS constraint_row
         WHERE constraint_row.conrelid = relation.oid
       ) AS constraint_count,
       (
         SELECT count(*)
         FROM pg_catalog.pg_trigger AS trigger_row
         WHERE trigger_row.tgrelid = relation.oid
           AND NOT trigger_row.tgisinternal
       ) AS trigger_count
FROM pg_catalog.pg_class AS relation
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
WHERE namespace.nspname = 'privacy_retention'
  AND relation.relkind = 'r'
  AND relation.relname IN (
    'privacy_policy_versions',
    'privacy_onboarding_challenges',
    'privacy_guardian_verifications',
    'privacy_age_profiles',
    'privacy_consent_events',
    'privacy_audit_events'
  );

CREATE TEMPORARY TABLE pg_temp.g014_rerun_dependencies AS
SELECT constraint_row.oid,
       constraint_row.conrelid,
       constraint_row.confrelid,
       constraint_row.conkey,
       constraint_row.confkey,
       constraint_row.confupdtype,
       constraint_row.confdeltype
FROM pg_catalog.pg_constraint AS constraint_row
WHERE constraint_row.contype = 'f'
  AND (
    constraint_row.conrelid IN (
      'privacy_retention.privacy_policy_versions'::regclass,
      'privacy_retention.privacy_onboarding_challenges'::regclass,
      'privacy_retention.privacy_guardian_verifications'::regclass,
      'privacy_retention.privacy_age_profiles'::regclass,
      'privacy_retention.privacy_consent_events'::regclass,
      'privacy_retention.privacy_audit_events'::regclass
    )
    OR constraint_row.confrelid IN (
      'privacy_retention.privacy_policy_versions'::regclass,
      'privacy_retention.privacy_onboarding_challenges'::regclass,
      'privacy_retention.privacy_guardian_verifications'::regclass,
      'privacy_retention.privacy_age_profiles'::regclass,
      'privacy_retention.privacy_consent_events'::regclass,
      'privacy_retention.privacy_audit_events'::regclass
    )
  );

CREATE TEMPORARY TABLE pg_temp.g014_rerun_functions AS
SELECT procedure.oid,
       procedure.proowner,
       procedure.prosecdef,
       procedure.proconfig,
       pg_catalog.pg_get_functiondef(procedure.oid) AS definition
FROM pg_catalog.pg_proc AS procedure
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
WHERE namespace.nspname IN ('public', 'privacy_retention')
  AND procedure.prokind IN ('f', 'p');

CREATE TEMPORARY TABLE pg_temp.g014_rerun_view AS
SELECT view_relation.oid,
       pg_catalog.pg_get_viewdef(view_relation.oid) AS definition
FROM pg_catalog.pg_class AS view_relation
WHERE view_relation.oid = 'public.privacy_consent_state'::regclass;

\ir ../migrations/20260713002000_g014_public_api_private_boundary.sql

DO $repeat_safe$
BEGIN
  IF EXISTS (
    (SELECT * FROM pg_temp.g014_rerun_relations)
    EXCEPT
    (
      SELECT relation.oid,
             namespace.nspname,
             relation.relname,
             relation.relowner,
             relation.relrowsecurity,
             relation.relforcerowsecurity,
             (
               SELECT count(*)
               FROM pg_catalog.pg_index AS index_row
               WHERE index_row.indrelid = relation.oid
             ),
             (
               SELECT count(*)
               FROM pg_catalog.pg_constraint AS constraint_row
               WHERE constraint_row.conrelid = relation.oid
             ),
             (
               SELECT count(*)
               FROM pg_catalog.pg_trigger AS trigger_row
               WHERE trigger_row.tgrelid = relation.oid
                 AND NOT trigger_row.tgisinternal
             )
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'privacy_retention'
        AND relation.relkind = 'r'
        AND relation.relname IN (
          'privacy_policy_versions',
          'privacy_onboarding_challenges',
          'privacy_guardian_verifications',
          'privacy_age_profiles',
          'privacy_consent_events',
          'privacy_audit_events'
        )
    )
  ) OR EXISTS (
    (
      SELECT relation.oid,
             namespace.nspname,
             relation.relname,
             relation.relowner,
             relation.relrowsecurity,
             relation.relforcerowsecurity,
             (
               SELECT count(*)
               FROM pg_catalog.pg_index AS index_row
               WHERE index_row.indrelid = relation.oid
             ),
             (
               SELECT count(*)
               FROM pg_catalog.pg_constraint AS constraint_row
               WHERE constraint_row.conrelid = relation.oid
             ),
             (
               SELECT count(*)
               FROM pg_catalog.pg_trigger AS trigger_row
               WHERE trigger_row.tgrelid = relation.oid
                 AND NOT trigger_row.tgisinternal
             )
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'privacy_retention'
        AND relation.relkind = 'r'
        AND relation.relname IN (
          'privacy_policy_versions',
          'privacy_onboarding_challenges',
          'privacy_guardian_verifications',
          'privacy_age_profiles',
          'privacy_consent_events',
          'privacy_audit_events'
        )
    )
    EXCEPT
    (SELECT * FROM pg_temp.g014_rerun_relations)
  ) THEN
    RAISE EXCEPTION 'G014 repeat apply changed a moved relation catalog contract';
  END IF;

  IF EXISTS (
    (SELECT * FROM pg_temp.g014_rerun_dependencies)
    EXCEPT
    (
      SELECT constraint_row.oid,
             constraint_row.conrelid,
             constraint_row.confrelid,
             constraint_row.conkey,
             constraint_row.confkey,
             constraint_row.confupdtype,
             constraint_row.confdeltype
      FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.contype = 'f'
        AND (
          constraint_row.conrelid IN (
            'privacy_retention.privacy_policy_versions'::regclass,
            'privacy_retention.privacy_onboarding_challenges'::regclass,
            'privacy_retention.privacy_guardian_verifications'::regclass,
            'privacy_retention.privacy_age_profiles'::regclass,
            'privacy_retention.privacy_consent_events'::regclass,
            'privacy_retention.privacy_audit_events'::regclass
          )
          OR constraint_row.confrelid IN (
            'privacy_retention.privacy_policy_versions'::regclass,
            'privacy_retention.privacy_onboarding_challenges'::regclass,
            'privacy_retention.privacy_guardian_verifications'::regclass,
            'privacy_retention.privacy_age_profiles'::regclass,
            'privacy_retention.privacy_consent_events'::regclass,
            'privacy_retention.privacy_audit_events'::regclass
          )
        )
    )
  ) OR EXISTS (
    (
      SELECT constraint_row.oid,
             constraint_row.conrelid,
             constraint_row.confrelid,
             constraint_row.conkey,
             constraint_row.confkey,
             constraint_row.confupdtype,
             constraint_row.confdeltype
      FROM pg_catalog.pg_constraint AS constraint_row
      WHERE constraint_row.contype = 'f'
        AND (
          constraint_row.conrelid IN (
            'privacy_retention.privacy_policy_versions'::regclass,
            'privacy_retention.privacy_onboarding_challenges'::regclass,
            'privacy_retention.privacy_guardian_verifications'::regclass,
            'privacy_retention.privacy_age_profiles'::regclass,
            'privacy_retention.privacy_consent_events'::regclass,
            'privacy_retention.privacy_audit_events'::regclass
          )
          OR constraint_row.confrelid IN (
            'privacy_retention.privacy_policy_versions'::regclass,
            'privacy_retention.privacy_onboarding_challenges'::regclass,
            'privacy_retention.privacy_guardian_verifications'::regclass,
            'privacy_retention.privacy_age_profiles'::regclass,
            'privacy_retention.privacy_consent_events'::regclass,
            'privacy_retention.privacy_audit_events'::regclass
          )
        )
    )
    EXCEPT
    (SELECT * FROM pg_temp.g014_rerun_dependencies)
  ) THEN
    RAISE EXCEPTION 'G014 repeat apply changed a moved relation dependency';
  END IF;

  IF EXISTS (
    (SELECT * FROM pg_temp.g014_rerun_functions)
    EXCEPT
    (
      SELECT procedure.oid,
             procedure.proowner,
             procedure.prosecdef,
             procedure.proconfig,
             pg_catalog.pg_get_functiondef(procedure.oid)
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname IN ('public', 'privacy_retention')
        AND procedure.prokind IN ('f', 'p')
    )
  ) OR EXISTS (
    (
      SELECT procedure.oid,
             procedure.proowner,
             procedure.prosecdef,
             procedure.proconfig,
             pg_catalog.pg_get_functiondef(procedure.oid)
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname IN ('public', 'privacy_retention')
        AND procedure.prokind IN ('f', 'p')
    )
    EXCEPT
    (SELECT * FROM pg_temp.g014_rerun_functions)
  ) THEN
    RAISE EXCEPTION 'G014 repeat apply changed a function catalog contract';
  END IF;

  IF EXISTS (
    (SELECT * FROM pg_temp.g014_rerun_view)
    EXCEPT
    (
      SELECT view_relation.oid,
             pg_catalog.pg_get_viewdef(view_relation.oid)
      FROM pg_catalog.pg_class AS view_relation
      WHERE view_relation.oid = 'public.privacy_consent_state'::regclass
    )
  ) OR EXISTS (
    (
      SELECT view_relation.oid,
             pg_catalog.pg_get_viewdef(view_relation.oid)
      FROM pg_catalog.pg_class AS view_relation
      WHERE view_relation.oid = 'public.privacy_consent_state'::regclass
    )
    EXCEPT
    (SELECT * FROM pg_temp.g014_rerun_view)
  ) THEN
    RAISE EXCEPTION 'G014 repeat apply changed the consent projection';
  END IF;
END;
$repeat_safe$;

-- Public schema shadowing is denied to every Data API browser role.
DO $public_create$
BEGIN
  IF pg_catalog.has_schema_privilege('anon', 'public', 'CREATE')
     OR pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE')
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_namespace AS namespace
       CROSS JOIN LATERAL pg_catalog.aclexplode(
         COALESCE(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))
       ) AS acl
       WHERE namespace.nspname = 'public'
         AND acl.grantee = 0
         AND acl.privilege_type = 'CREATE'
     ) THEN
    RAISE EXCEPTION 'G014 public CREATE is still available to a Data API role';
  END IF;
END;
$public_create$;

SET LOCAL ROLE anon;
DO $anon_create$
BEGIN
  BEGIN
    EXECUTE 'CREATE TABLE public.g014_anon_shadow (id integer)';
    RAISE EXCEPTION 'anon unexpectedly created a public table';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;

  BEGIN
    EXECUTE 'CREATE FUNCTION public.g014_anon_shadow() RETURNS boolean LANGUAGE sql AS ''SELECT true''';
    RAISE EXCEPTION 'anon unexpectedly created a public function';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$anon_create$;
RESET ROLE;

-- The default ACL is denied for both verified local object creators.
CREATE FUNCTION public.g014_default_acl_postgres()
RETURNS boolean
LANGUAGE sql
AS $function$
  SELECT true;
$function$;

DO $postgres_default_acl$
BEGIN
  IF pg_catalog.has_function_privilege('anon', 'public.g014_default_acl_postgres()'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.g014_default_acl_postgres()'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.g014_default_acl_postgres()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'postgres default function ACL remains Data API executable';
  END IF;
END;
$postgres_default_acl$;
DROP FUNCTION public.g014_default_acl_postgres();

SET LOCAL ROLE privacy_workflow_owner;
CREATE FUNCTION privacy_retention.g014_default_acl_workflow_owner()
RETURNS boolean
LANGUAGE sql
AS $function$
  SELECT true;
$function$;
RESET ROLE;

DO $workflow_default_acl$
BEGIN
  IF pg_catalog.has_function_privilege('anon', 'privacy_retention.g014_default_acl_workflow_owner()'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'privacy_retention.g014_default_acl_workflow_owner()'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'privacy_retention.g014_default_acl_workflow_owner()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'privacy_workflow_owner default function ACL remains Data API executable';
  END IF;
END;
$workflow_default_acl$;
DROP FUNCTION privacy_retention.g014_default_acl_workflow_owner();

-- Independently compare every public overload's effective Data API grantees with
-- the checked-in persisted matrix. PUBLIC execute is inspected separately.
DO $rpc_matrix$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    CROSS JOIN (VALUES ('anon'::name), ('authenticated'::name), ('service_role'::name)) AS roles(grantee)
    WHERE namespace.nspname = 'public'
      AND pg_catalog.has_function_privilege(roles.grantee, procedure.oid, 'EXECUTE')
        IS DISTINCT FROM EXISTS (
          SELECT 1
          FROM privacy_retention.g014_public_rpc_allowlist AS allowed
          WHERE allowed.function_schema = namespace.nspname
            AND allowed.function_name = procedure.proname
            AND allowed.identity_arguments = procedure.proargtypes::text
            AND allowed.grantee = roles.grantee
        )
  ) THEN
    RAISE EXCEPTION 'public RPC grantee matrix differs from the G014 allowlist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) AS acl
    WHERE namespace.nspname = 'public'
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'PUBLIC retains EXECUTE on a public function';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM privacy_retention.g014_public_rpc_allowlist AS allowed
    WHERE pg_catalog.to_regprocedure(allowed.source_signature) IS NULL
  ) THEN
    RAISE EXCEPTION 'allowlist contains a missing required RPC identity';
  END IF;
END;
$rpc_matrix$;
-- This service-only approval consumer must remain in the frozen public surface:
-- no anonymous/browser execution and no owner or search-path drift are allowed.
DO $address_approval_rpc_catalog$
DECLARE
  v_procedure record;
  v_search_path text;
BEGIN
  SELECT procedure.prosecdef,
         pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
         procedure.proconfig
    INTO v_procedure
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = 'public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamptz,timestamptz)'::regprocedure;

  IF NOT FOUND
     OR NOT v_procedure.prosecdef
     OR v_procedure.owner_name <> 'privacy_workflow_owner' THEN
    RAISE EXCEPTION 'G014 address approval consumer owner or SECURITY DEFINER contract is incorrect';
  END IF;

  SELECT setting.value INTO v_search_path
    FROM pg_catalog.unnest(v_procedure.proconfig) AS setting(value)
   WHERE setting.value LIKE 'search_path=%';
  IF v_search_path IS DISTINCT FROM 'search_path='
     AND v_search_path IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION 'G014 address approval consumer search_path is not empty';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM privacy_retention.g014_public_rpc_allowlist AS allowed
     WHERE allowed.source_signature = 'public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamptz,timestamptz)'
       AND allowed.grantee = 'service_role'::name
  ) OR EXISTS (
    SELECT 1
      FROM privacy_retention.g014_public_rpc_allowlist AS allowed
     WHERE allowed.source_signature = 'public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamptz,timestamptz)'
       AND allowed.grantee <> 'service_role'::name
  ) OR pg_catalog.has_function_privilege(
    'anon',
    'public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamptz,timestamptz)'::regprocedure,
    'EXECUTE'
  ) OR pg_catalog.has_function_privilege(
    'authenticated',
    'public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamptz,timestamptz)'::regprocedure,
    'EXECUTE'
  ) OR NOT pg_catalog.has_function_privilege(
    'service_role',
    'public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamptz,timestamptz)'::regprocedure,
    'EXECUTE'
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
      ) AS acl
     WHERE procedure.oid = 'public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamptz,timestamptz)'::regprocedure
       AND acl.grantee = 0
       AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'G014 address approval consumer allowlist or grant matrix is incorrect';
  END IF;
END;
$address_approval_rpc_catalog$;
-- Nested helpers are a frozen closure, not Data API endpoints. Cross-schema
-- helpers retain postgres ownership, while every persisted helper grants
-- EXECUTE exactly to both trusted implementation owners.
DO $nested_helper_contract$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM privacy_retention.g014_nested_helper_allowlist
  ) OR NOT EXISTS (
    SELECT 1
    FROM privacy_retention.g014_nested_helper_allowlist AS helper
    WHERE helper.source_signature = 'public.privacy_resolve_audit_retention_until(text,timestamptz)'
  ) OR EXISTS (
    SELECT 1
    FROM privacy_retention.g014_nested_helper_allowlist AS helper
    JOIN privacy_retention.g014_public_rpc_allowlist AS rpc
      ON rpc.source_signature = helper.source_signature
  ) OR EXISTS (
    SELECT 1
    FROM privacy_retention.g014_nested_helper_allowlist AS helper
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(helper.source_signature)
    CROSS JOIN (VALUES ('anon'::name), ('authenticated'::name), ('service_role'::name)) AS roles(role_name)
    WHERE pg_catalog.pg_get_userbyid(procedure.proowner) IS DISTINCT FROM CASE
      WHEN helper.source_signature IN (
        'public.account_deletion_require_service_role()',
        'public.account_deletion_is_active_admin(uuid)',
        'public.account_deletion_write_audit(public.account_deletion_requests,text,text)',
        'privacy_retention.require_service_role()',
        'privacy_retention.write_run_audit(privacy_retention.privacy_retention_runs,text,text)'
      ) THEN 'postgres'
      ELSE 'privacy_workflow_owner'
    END
       OR pg_catalog.has_function_privilege(roles.role_name, procedure.oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('postgres', procedure.oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('privacy_workflow_owner', procedure.oid, 'EXECUTE')
  ) OR EXISTS (
    SELECT 1
    FROM privacy_retention.g014_nested_helper_allowlist AS helper
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(helper.source_signature)
    WHERE (
      SELECT count(*)
      FROM pg_catalog.aclexplode(
        COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
      ) AS acl
    ) <> 2
      OR EXISTS (
        (SELECT pg_catalog.pg_get_userbyid(acl.grantee)::name,
                acl.privilege_type,
                acl.is_grantable
         FROM pg_catalog.aclexplode(
           COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
         ) AS acl)
        EXCEPT
        (VALUES
          ('postgres'::name, 'EXECUTE'::text, false),
          ('privacy_workflow_owner'::name, 'EXECUTE'::text, false)
        )
      )
      OR EXISTS (
        (VALUES
          ('postgres'::name, 'EXECUTE'::text, false),
          ('privacy_workflow_owner'::name, 'EXECUTE'::text, false)
        )
        EXCEPT
        (SELECT pg_catalog.pg_get_userbyid(acl.grantee)::name,
                acl.privilege_type,
                acl.is_grantable
         FROM pg_catalog.aclexplode(
           COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
         ) AS acl)
      )
  ) THEN
    RAISE EXCEPTION 'nested helper closure has an unexpected Data API grant, owner, or EXECUTE ACL';
  END IF;
END;
$nested_helper_contract$;

CREATE ROLE g014_temporary_untrusted_role
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS;
GRANT EXECUTE ON FUNCTION public.privacy_resolve_audit_retention_until(text, timestamptz)
  TO g014_temporary_untrusted_role;
\ir ../migrations/20260713002000_g014_public_api_private_boundary.sql

DO $nested_helper_reconciliation$
BEGIN
  IF pg_catalog.has_function_privilege(
    'g014_temporary_untrusted_role',
    'public.privacy_resolve_audit_retention_until(text,timestamptz)'::regprocedure,
    'EXECUTE'
  ) OR EXISTS (
    SELECT 1
    FROM privacy_retention.g014_nested_helper_allowlist AS helper
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(helper.source_signature)
    WHERE (
      SELECT count(*)
      FROM pg_catalog.aclexplode(
        COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
      ) AS acl
    ) <> 2
      OR EXISTS (
        (SELECT pg_catalog.pg_get_userbyid(acl.grantee)::name,
                acl.privilege_type,
                acl.is_grantable
         FROM pg_catalog.aclexplode(
           COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
         ) AS acl)
        EXCEPT
        (VALUES
          ('postgres'::name, 'EXECUTE'::text, false),
          ('privacy_workflow_owner'::name, 'EXECUTE'::text, false)
        )
      )
      OR EXISTS (
        (VALUES
          ('postgres'::name, 'EXECUTE'::text, false),
          ('privacy_workflow_owner'::name, 'EXECUTE'::text, false)
        )
        EXCEPT
        (SELECT pg_catalog.pg_get_userbyid(acl.grantee)::name,
                acl.privilege_type,
                acl.is_grantable
         FROM pg_catalog.aclexplode(
           COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
         ) AS acl)
      )
  ) THEN
    RAISE EXCEPTION 'nested helper ACL reconciliation retained an untrusted EXECUTE grantee';
  END IF;
END;
$nested_helper_reconciliation$;

DO $workflow_owner_drift$
BEGIN
  PERFORM privacy_retention.assert_g014_workflow_owner_contract();

  EXECUTE 'ALTER ROLE privacy_workflow_owner CREATEROLE';
  BEGIN
    PERFORM privacy_retention.assert_g014_workflow_owner_contract();
    RAISE EXCEPTION 'elevated privacy_workflow_owner attributes were accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'privacy_workflow_owner role attributes are incompatible' THEN
      RAISE;
    END IF;
  END;
  EXECUTE 'ALTER ROLE privacy_workflow_owner NOCREATEROLE';

  EXECUTE 'GRANT g014_temporary_untrusted_role TO privacy_workflow_owner';
  BEGIN
    PERFORM privacy_retention.assert_g014_workflow_owner_contract();
    RAISE EXCEPTION 'privacy_workflow_owner inherited an untrusted role';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'privacy_workflow_owner has unexpected role membership or effective access' THEN
      RAISE;
    END IF;
  END;
  EXECUTE 'REVOKE g014_temporary_untrusted_role FROM privacy_workflow_owner';

  EXECUTE 'GRANT privacy_workflow_owner TO g014_temporary_untrusted_role';
  BEGIN
    PERFORM privacy_retention.assert_g014_workflow_owner_contract();
    RAISE EXCEPTION 'an untrusted role could assume privacy_workflow_owner';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'privacy_workflow_owner has unexpected role membership or effective access' THEN
      RAISE;
    END IF;
  END;
  EXECUTE 'REVOKE privacy_workflow_owner FROM g014_temporary_untrusted_role';

  PERFORM privacy_retention.assert_g014_workflow_owner_contract();
END;
$workflow_owner_drift$;

-- A rewritten canonical function may retain its exact ordered input-type OID
-- vector while argument names change. The validator must ignore names.
DROP FUNCTION public.apply_privacy_incident_transition(
  uuid, uuid, uuid, public.privacy_incident_status, timestamptz, text, text, text, jsonb, uuid, text
);
CREATE FUNCTION public.apply_privacy_incident_transition(
  p_renamed_actor uuid,
  p_renamed_operation uuid,
  p_renamed_incident uuid,
  p_renamed_status public.privacy_incident_status,
  p_renamed_updated_at timestamptz,
  p_renamed_preview_hash text,
  p_renamed_confirmation text,
  p_renamed_reason text,
  p_renamed_input jsonb,
  p_renamed_correlation uuid,
  p_renamed_idempotency text
)
RETURNS jsonb
LANGUAGE sql
AS $function$
  SELECT jsonb_build_object('rewritten', true);
$function$;
GRANT EXECUTE ON FUNCTION public.apply_privacy_incident_transition(
  uuid, uuid, uuid, public.privacy_incident_status, timestamptz, text, text, text, jsonb, uuid, text
) TO service_role;

DO $renamed_canonical_identity$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM privacy_retention.g014_public_rpc_allowlist AS allowed
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(allowed.source_signature)
    WHERE allowed.source_signature = 'public.apply_privacy_incident_transition(uuid,uuid,uuid,public.privacy_incident_status,timestamptz,text,text,text,jsonb,uuid,text)'
      AND allowed.grantee = 'service_role'::name
      AND allowed.identity_arguments = procedure.proargtypes::text
      AND procedure.proargnames = ARRAY[
        'p_renamed_actor',
        'p_renamed_operation',
        'p_renamed_incident',
        'p_renamed_status',
        'p_renamed_updated_at',
        'p_renamed_preview_hash',
        'p_renamed_confirmation',
        'p_renamed_reason',
        'p_renamed_input',
        'p_renamed_correlation',
        'p_renamed_idempotency'
      ]::text[]
  ) THEN
    RAISE EXCEPTION 'renamed canonical RPC identity is not represented by its exact type vector';
  END IF;

  PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
END;
$renamed_canonical_identity$;
-- Extra overloads of an allowlisted name are a deployment failure, not an
-- implicitly accessible fallback. text sorts before uuid, proving the diagnostic
-- identifies the first unexpected identity deterministically.
CREATE FUNCTION public.allocate_short_url(p_probe text)
RETURNS boolean
LANGUAGE sql
AS $function$
  SELECT p_probe IS NOT NULL;
$function$;
CREATE FUNCTION public.allocate_short_url(p_probe uuid)
RETURNS boolean
LANGUAGE sql
AS $function$
  SELECT p_probe IS NOT NULL;
$function$;

DO $extra_overload$
BEGIN
  BEGIN
    PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
    RAISE EXCEPTION 'unexpected allowlisted RPC overload was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'G014 found an unexpected overload of an allowlisted RPC: public.allocate_short_url(text)' THEN
      RAISE;
    END IF;
  END;
END;
$extra_overload$;
DROP FUNCTION public.allocate_short_url(text);
DO $distinct_type_overload$
BEGIN
  BEGIN
    PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
    RAISE EXCEPTION 'distinct allowlisted RPC type overload was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'G014 found an unexpected overload of an allowlisted RPC: public.allocate_short_url(uuid)' THEN
      RAISE;
    END IF;
  END;
END;
$distinct_type_overload$;
DROP FUNCTION public.allocate_short_url(uuid);

-- The six retained relations are private tables only. No Data API role can use
-- their schema or select/mutate them directly.
DO $private_catalog$
BEGIN
  IF (
    SELECT count(*)
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'privacy_retention'
      AND relation.relkind = 'r'
      AND relation.relname IN (
        'privacy_policy_versions',
        'privacy_onboarding_challenges',
        'privacy_guardian_verifications',
        'privacy_age_profiles',
        'privacy_consent_events',
        'privacy_audit_events'
      )
  ) <> 6 OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'privacy_policy_versions',
        'privacy_onboarding_challenges',
        'privacy_guardian_verifications',
        'privacy_age_profiles',
        'privacy_consent_events',
        'privacy_audit_events'
      )
  ) THEN
    RAISE EXCEPTION 'retained privacy relation placement is not private-only';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'::name), ('authenticated'::name), ('service_role'::name)) AS roles(role_name)
    WHERE pg_catalog.has_schema_privilege(roles.role_name, 'privacy_retention', 'USAGE')
  ) THEN
    RAISE EXCEPTION 'a Data API role has private-schema usage';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'::name), ('authenticated'::name), ('service_role'::name)) AS roles(role_name)
    CROSS JOIN (VALUES
      ('privacy_policy_versions'::text),
      ('privacy_onboarding_challenges'::text),
      ('privacy_guardian_verifications'::text),
      ('privacy_age_profiles'::text),
      ('privacy_consent_events'::text),
      ('privacy_audit_events'::text)
    ) AS relations(relation_name)
    WHERE pg_catalog.has_table_privilege(roles.role_name, 'privacy_retention.' || relations.relation_name, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
  ) THEN
    RAISE EXCEPTION 'a Data API role has direct private privacy-table access';
  END IF;
END;
$private_catalog$;
-- Public G010 workflow tables retain only the explicit read surfaces.
DO $workflow_table_acl$
DECLARE
  v_relation text;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'notifications',
    'marketing_campaign_operations',
    'marketing_campaign_recipients',
    'marketing_campaign_batches',
    'account_deletion_policies',
    'account_deletion_data_classes',
    'account_deletion_requests',
    'account_deletion_request_items',
    'privacy_incidents',
    'privacy_incident_transition_previews',
    'privacy_incident_notices',
    'privacy_incident_actions',
    'profiles',
    'user_roles',
    'user_account_status',
    'admin_audit_events'
  ] LOOP
    IF pg_catalog.has_table_privilege('anon', 'public.' || v_relation, 'INSERT')
       OR pg_catalog.has_table_privilege('anon', 'public.' || v_relation, 'UPDATE')
       OR pg_catalog.has_table_privilege('anon', 'public.' || v_relation, 'DELETE')
       OR pg_catalog.has_table_privilege('anon', 'public.' || v_relation, 'TRUNCATE')
       OR pg_catalog.has_table_privilege('authenticated', 'public.' || v_relation, 'INSERT')
       OR pg_catalog.has_table_privilege('authenticated', 'public.' || v_relation, 'UPDATE')
       OR pg_catalog.has_table_privilege('authenticated', 'public.' || v_relation, 'DELETE')
       OR pg_catalog.has_table_privilege('authenticated', 'public.' || v_relation, 'TRUNCATE')
       OR pg_catalog.has_table_privilege('service_role', 'public.' || v_relation, 'INSERT')
       OR pg_catalog.has_table_privilege('service_role', 'public.' || v_relation, 'UPDATE')
       OR pg_catalog.has_table_privilege('service_role', 'public.' || v_relation, 'DELETE')
       OR pg_catalog.has_table_privilege('service_role', 'public.' || v_relation, 'TRUNCATE') THEN
      RAISE EXCEPTION 'a Data API role retains direct workflow mutation on public.%', v_relation;
    END IF;

    IF (
      pg_catalog.has_table_privilege('anon', 'public.' || v_relation, 'SELECT')
      OR (
        pg_catalog.has_table_privilege('authenticated', 'public.' || v_relation, 'SELECT')
        AND v_relation <> 'notifications'
      )
      OR (
        pg_catalog.has_table_privilege('service_role', 'public.' || v_relation, 'SELECT')
        AND v_relation NOT IN ('privacy_incidents', 'privacy_incident_notices', 'privacy_incident_actions')
      )
    ) THEN
      RAISE EXCEPTION 'an undocumented direct workflow read grant remains on public.%', v_relation;
    END IF;
  END LOOP;

  IF NOT pg_catalog.has_table_privilege('authenticated', 'public.notifications', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.privacy_incidents', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.privacy_incident_notices', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('service_role', 'public.privacy_incident_actions', 'SELECT') THEN
    RAISE EXCEPTION 'an explicit G010 workflow read grant is missing';
  END IF;
END;
$workflow_table_acl$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $service_dml$
DECLARE
  v_relation text;
  v_column text;
  v_statement text;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'privacy_policy_versions',
    'privacy_onboarding_challenges',
    'privacy_guardian_verifications',
    'privacy_age_profiles',
    'privacy_consent_events',
    'privacy_audit_events'
  ] LOOP
    FOREACH v_statement IN ARRAY ARRAY[
      format('INSERT INTO privacy_retention.%I DEFAULT VALUES', v_relation),
      format('DELETE FROM privacy_retention.%I WHERE false', v_relation),
      format('TRUNCATE TABLE privacy_retention.%I', v_relation)
    ] LOOP
      BEGIN
        EXECUTE v_statement;
        RAISE EXCEPTION 'service_role unexpectedly issued private DML against %', v_relation;
      EXCEPTION WHEN insufficient_privilege THEN
        NULL;
      END;
    END LOOP;
  END LOOP;

  FOREACH v_relation IN ARRAY ARRAY[
    'notifications',
    'marketing_campaign_operations',
    'marketing_campaign_recipients',
    'marketing_campaign_batches',
    'account_deletion_policies',
    'account_deletion_data_classes',
    'account_deletion_requests',
    'account_deletion_request_items',
    'privacy_incidents',
    'privacy_incident_transition_previews',
    'privacy_incident_notices',
    'privacy_incident_actions',
    'profiles',
    'user_roles',
    'user_account_status',
    'admin_audit_events'
  ] LOOP
    SELECT attribute.attname INTO v_column
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = pg_catalog.to_regclass('public.' || v_relation)
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attgenerated = ''
    ORDER BY attribute.attnum
    LIMIT 1;

    FOREACH v_statement IN ARRAY ARRAY[
      format('INSERT INTO public.%I DEFAULT VALUES', v_relation),
      format('UPDATE public.%I SET %I = %I WHERE false', v_relation, v_column, v_column),
      format('DELETE FROM public.%I WHERE false', v_relation),
      format('TRUNCATE TABLE public.%I', v_relation)
    ] LOOP
      BEGIN
        EXECUTE v_statement;
        RAISE EXCEPTION 'service_role unexpectedly issued direct workflow DML against public.%', v_relation;
      EXCEPTION WHEN insufficient_privilege THEN
        NULL;
      END;
    END LOOP;
  END LOOP;

  FOREACH v_statement IN ARRAY ARRAY[
    'SELECT public.assert_notification_content_safe(''G014'', ''boundary'', ''{}''::jsonb)',
    'SELECT public.record_marketing_campaign_audit(NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL)',
    'SELECT public.account_deletion_require_service_role()',
    'SELECT privacy_retention.require_service_role()',
    'SELECT public.privacy_incident_require_admin(NULL)',
    'SELECT public.admin_user_audit_reason_code(''x'', ''x'')'
  ] LOOP
    BEGIN
      EXECUTE v_statement;
      RAISE EXCEPTION 'service_role unexpectedly executed a nested helper: %', v_statement;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END LOOP;
END;
$service_dml$;
RESET ROLE;

-- Fixture an owner-scoped policy and adult age profile. The active audit class
-- makes the approved consent RPC append its immutable audit event.
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('14141414-1414-4141-8141-141414141401', 'authenticated', 'authenticated', 'g014-owner@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14141414-1414-4141-8141-141414141402', 'authenticated', 'authenticated', 'g014-other@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

UPDATE privacy_retention.privacy_retention_classes
SET data_class = 'privacy_identity_audit',
    basis_code = 'test.g014_identity_audit',
    trigger_type = 'event_occurred',
    retention_period = interval '90 days',
    status = 'active',
    approved_evidence_ref = 'G014-TEST-IDENTITY-AUDIT',
    version = 'g014-test-v1',
    activated_at = pg_catalog.clock_timestamp()
WHERE code = 'privacy_identity_audit';

INSERT INTO privacy_retention.privacy_policy_versions (
  id, version, locale, status, content_sha256, effective_at, published_at, operator_approval_ref
) VALUES (
  '14141414-1414-4141-8141-141414141411',
  'g014-test-v1',
  'ko-KR',
  'published',
  repeat('a', 64),
  pg_catalog.clock_timestamp() - interval '1 minute',
  pg_catalog.clock_timestamp(),
  'G014-TEST-APPROVAL'
);

INSERT INTO privacy_retention.privacy_age_profiles (
  user_id, age_band, attested_at, method, status, policy_version_id
) VALUES
  (
    '14141414-1414-4141-8141-141414141401',
    'age_14_plus', pg_catalog.clock_timestamp(), 'self_attestation', 'eligible', '14141414-1414-4141-8141-141414141411'
  ),
  (
    '14141414-1414-4141-8141-141414141402',
    'age_14_plus', pg_catalog.clock_timestamp(), 'self_attestation', 'eligible', '14141414-1414-4141-8141-141414141411'
  );

-- An untrusted public same-signature helper cannot shadow the fully qualified
-- extensions.digest path used by the consent/audit workflow.
SET LOCAL ROLE anon;
DO $shadow_create_denied$
BEGIN
  BEGIN
    EXECUTE 'CREATE FUNCTION public.digest(text,text) RETURNS bytea LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION ''shadow called''; END $$';
    RAISE EXCEPTION 'anon unexpectedly created a digest shadow';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$shadow_create_denied$;
RESET ROLE;

CREATE FUNCTION public.digest(text, text)
RETURNS bytea
LANGUAGE plpgsql
AS $function$
BEGIN
  RAISE EXCEPTION 'g014 public digest shadow was resolved';
END;
$function$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"14141414-1414-4141-8141-141414141401"}',
  true
);

DO $owner_rpc$
DECLARE
  v_policy jsonb;
  v_result jsonb;
  v_visible integer;
  v_other_visible integer;
BEGIN
  v_policy := public.get_current_privacy_policy_version();
  IF v_policy ->> 'policyVersionId' <> '14141414-1414-4141-8141-141414141411' THEN
    RAISE EXCEPTION 'approved policy RPC did not read private policy state';
  END IF;

  v_result := public.submit_privacy_consent(
    'email_marketing',
    'email',
    'granted',
    '14141414-1414-4141-8141-141414141411',
    repeat('a', 64),
    'settings',
    NULL,
    'g014-public-boundary-consent-0001',
    '14141414-1414-4141-8141-141414141421'
  );
  IF v_result ->> 'status' <> 'applied' THEN
    RAISE EXCEPTION 'approved consent RPC did not append its private event';
  END IF;
  v_result := public.submit_privacy_consent(
    'email_marketing',
    'email',
    'withdrawn',
    '14141414-1414-4141-8141-141414141411',
    repeat('a', 64),
    'settings',
    NULL,
    'g014-public-boundary-consent-0002',
    '14141414-1414-4141-8141-141414141422'
  );
  IF v_result ->> 'status' <> 'applied' THEN
    RAISE EXCEPTION 'withdrawn consent RPC did not append its private event';
  END IF;

  PERFORM public.create_user_notification(
    '14141414-1414-4141-8141-141414141401',
    'g014_test',
    'G014 test',
    'Owner RPC boundary fixture',
    '{}'::jsonb
  );

  SELECT count(*) INTO v_visible FROM public.privacy_consent_state;
  SELECT count(*) INTO v_other_visible
  FROM public.privacy_consent_state
  WHERE user_id = '14141414-1414-4141-8141-141414141402';
  IF v_visible <> 1 OR v_other_visible <> 0 THEN
    RAISE EXCEPTION 'owner-scoped consent compatibility view leaked or omitted rows';
  END IF;
END;
$owner_rpc$;
RESET ROLE;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"authenticated","sub":"14141414-1414-4141-8141-141414141402"}',
  true
);
DO $other_owner_rpc$
DECLARE
  v_result jsonb;
BEGIN
  v_result := public.submit_privacy_consent(
    'email_marketing', 'email', 'granted',
    '14141414-1414-4141-8141-141414141411', repeat('a', 64), 'settings', NULL,
    'g014-other-email-consent-0001', '14141414-1414-4141-8141-141414141423'
  );
  IF v_result ->> 'status' <> 'applied' THEN
    RAISE EXCEPTION 'unrelated-user email consent RPC did not apply';
  END IF;

  v_result := public.submit_privacy_consent(
    'push_marketing', 'push', 'granted',
    '14141414-1414-4141-8141-141414141411', repeat('a', 64), 'settings', NULL,
    'g014-other-push-consent-0001', '14141414-1414-4141-8141-141414141424'
  );
  IF v_result ->> 'status' <> 'applied' THEN
    RAISE EXCEPTION 'ordinary push consent RPC did not apply';
  END IF;

  v_result := public.submit_privacy_consent(
    'night_marketing', 'push', 'granted',
    '14141414-1414-4141-8141-141414141411', repeat('a', 64), 'settings', NULL,
    'g014-other-night-consent-0001', '14141414-1414-4141-8141-141414141425'
  );
  IF v_result ->> 'status' <> 'applied' THEN
    RAISE EXCEPTION 'night marketing grant RPC did not apply';
  END IF;

  v_result := public.submit_privacy_consent(
    'night_marketing', 'push', 'withdrawn',
    '14141414-1414-4141-8141-141414141411', repeat('a', 64), 'settings', NULL,
    'g014-other-night-consent-0002', '14141414-1414-4141-8141-141414141426'
  );
  IF v_result ->> 'status' <> 'applied' THEN
    RAISE EXCEPTION 'night marketing withdrawal RPC did not apply';
  END IF;
END;
$other_owner_rpc$;
RESET ROLE;

-- A real service-role RPC must consult the latest exact event even when its
-- JWT has no subject. NULL user input remains fail-closed.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $service_marketing_null_uid$
DECLARE
  v_permission record;
  v_deletion record;
  v_admin_audit_id uuid;
  v_retention_preview jsonb;
BEGIN
  SELECT * INTO v_permission
  FROM public.evaluate_notification_marketing_permission(
    '14141414-1414-4141-8141-141414141401',
    'email',
    '2026-07-12 12:30:00+00'::timestamptz,
    'Asia/Seoul'
  );
  IF v_permission.allowed IS DISTINCT FROM false
     OR v_permission.reason_code <> 'ordinary_consent_missing'
     OR v_permission.consent_event_id IS NOT NULL
     OR v_permission.night_consent_event_id IS NOT NULL THEN
    RAISE EXCEPTION 'latest ordinary withdrawal was not fail-closed with NULL auth.uid';
  END IF;
  SELECT * INTO v_deletion
  FROM public.preview_account_deletion(NULL, NULL, NULL);
  IF v_deletion.status <> 'failed'
     OR v_deletion.reason_code <> 'ACTOR_OR_TARGET_REQUIRED' THEN
    RAISE EXCEPTION 'service deletion RPC did not execute its owner-only helper closure';
  END IF;
  v_retention_preview := public.preview_privacy_retention_run(
    'privacy_identity_audit',
    pg_catalog.clock_timestamp(),
    1,
    1000
  );
  IF v_retention_preview ->> 'operationId' IS NULL
     OR v_retention_preview ->> 'previewHash' IS NULL THEN
    RAISE EXCEPTION 'retention preview did not execute its postgres-owned nested helper closure successfully';
  END IF;

  BEGIN
    PERFORM public.preview_privacy_retention_run(
      NULL, pg_catalog.clock_timestamp(), 0, 1000
    );
    RAISE EXCEPTION 'invalid retention preview was accepted';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'privacy_retention_batch_or_timeout_invalid' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    PERFORM public.preview_privacy_incident_transition(
      NULL,
      NULL,
      NULL::public.privacy_incident_status,
      NULL,
      NULL,
      '{}'::jsonb,
      NULL
    );
    RAISE EXCEPTION 'unauthorized incident preview was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'privacy_incident_privacy_admin_required' THEN
      RAISE;
    END IF;
  END;

  v_admin_audit_id := public.apply_admin_user_db_mutation(
    '14141414-1414-4141-8141-141414141401',
    '14141414-1414-4141-8141-141414141401',
    'admin_user_profile_updated',
    'ADMIN_USER_PROFILE_UPDATE_APPLIED',
    '{}'::jsonb,
    '{}'::jsonb,
    '14141414-1414-4141-8141-141414141427',
    NULL,
    NULL,
    NULL,
    NULL,
    NULL,
    NULL
  );
  IF v_admin_audit_id IS NULL THEN
    RAISE EXCEPTION 'service admin mutation RPC did not execute its owner-only helper closure';
  END IF;

  BEGIN
    PERFORM public.evaluate_notification_marketing_permission(
      NULL, 'email', '2026-07-12 12:30:00+00'::timestamptz, 'Asia/Seoul'
    );
    RAISE EXCEPTION 'NULL marketing target user was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'marketing_permission_input_invalid' THEN
      RAISE;
    END IF;
  END;
END;
$service_marketing_null_uid$;
RESET ROLE;

-- A different service JWT subject must not substitute its own consent state for
-- the RPC target, and a later night withdrawal must beat an earlier grant.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config(
  'request.jwt.claims',
  '{"role":"service_role","sub":"14141414-1414-4141-8141-141414141402"}',
  true
);
DO $service_marketing_different_uid$
DECLARE
  v_permission record;
BEGIN
  SELECT * INTO v_permission
  FROM public.evaluate_notification_marketing_permission(
    '14141414-1414-4141-8141-141414141401',
    'email',
    '2026-07-12 12:30:00+00'::timestamptz,
    'Asia/Seoul'
  );
  IF v_permission.allowed IS DISTINCT FROM false
     OR v_permission.reason_code <> 'ordinary_consent_missing' THEN
    RAISE EXCEPTION 'an unrelated auth.uid supplied ordinary marketing consent';
  END IF;

  SELECT * INTO v_permission
  FROM public.evaluate_notification_marketing_permission(
    '14141414-1414-4141-8141-141414141402',
    'email',
    '2026-07-12 12:30:00+00'::timestamptz,
    'Asia/Seoul'
  );
  IF v_permission.allowed IS DISTINCT FROM true
     OR v_permission.consent_event_id IS NULL
     OR v_permission.night_consent_event_id IS NOT NULL THEN
    RAISE EXCEPTION 'service marketing RPC did not use the explicit target user';
  END IF;

  SELECT * INTO v_permission
  FROM public.evaluate_notification_marketing_permission(
    '14141414-1414-4141-8141-141414141402',
    'push',
    '2026-07-12 12:30:00+00'::timestamptz,
    'Asia/Seoul'
  );
  IF v_permission.allowed IS DISTINCT FROM false
     OR v_permission.reason_code <> 'night_consent_missing'
     OR v_permission.consent_event_id IS NOT NULL
     OR v_permission.night_consent_event_id IS NOT NULL THEN
    RAISE EXCEPTION 'latest night marketing withdrawal was not fail-closed';
  END IF;
END;
$service_marketing_different_uid$;
RESET ROLE;
DROP FUNCTION public.digest(text, text);

-- The audit trigger is explicitly SECURITY INVOKER with the workflow owner and
-- an empty search path; cross-schema account/retention definers retain postgres.
DO $invoker_and_cross_schema_contract$
BEGIN
  PERFORM privacy_retention.assert_g014_invoker_contract();
  PERFORM privacy_retention.assert_g014_cross_schema_contract();

  ALTER FUNCTION privacy_retention.g014_reject_audit_mutation() SECURITY DEFINER;
  BEGIN
    PERFORM privacy_retention.assert_g014_invoker_contract();
    RAISE EXCEPTION 'SECURITY DEFINER audit trigger drift was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'G014 audit trigger function must remain SECURITY INVOKER' THEN
      RAISE;
    END IF;
  END;
  ALTER FUNCTION privacy_retention.g014_reject_audit_mutation() SECURITY INVOKER;

  ALTER FUNCTION privacy_retention.g014_reject_audit_mutation() OWNER TO postgres;
  BEGIN
    PERFORM privacy_retention.assert_g014_invoker_contract();
    RAISE EXCEPTION 'audit trigger owner drift was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'G014 SECURITY INVOKER audit trigger owner mismatch' THEN
      RAISE;
    END IF;
  END;
  ALTER FUNCTION privacy_retention.g014_reject_audit_mutation() OWNER TO privacy_workflow_owner;

  ALTER FUNCTION privacy_retention.g014_reject_audit_mutation() SET search_path = pg_catalog;
  BEGIN
    PERFORM privacy_retention.assert_g014_invoker_contract();
    RAISE EXCEPTION 'nonempty audit trigger search_path was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'G014 SECURITY INVOKER audit trigger search_path is not empty' THEN
      RAISE;
    END IF;
  END;
  ALTER FUNCTION privacy_retention.g014_reject_audit_mutation() SET search_path = '';

  ALTER FUNCTION public.preview_account_deletion(uuid, uuid, timestamptz)
    OWNER TO privacy_workflow_owner;
  BEGIN
    PERFORM privacy_retention.assert_g014_cross_schema_contract();
    RAISE EXCEPTION 'cross-schema owner drift was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'G014 cross-schema function owner mismatch: public.preview_account_deletion(uuid,uuid,timestamptz)' THEN
      RAISE;
    END IF;
  END;
  ALTER FUNCTION public.preview_account_deletion(uuid, uuid, timestamptz) OWNER TO postgres;

  ALTER FUNCTION public.preview_account_deletion(uuid, uuid, timestamptz)
    SET search_path = pg_catalog;
  BEGIN
    PERFORM privacy_retention.assert_g014_cross_schema_contract();
    RAISE EXCEPTION 'nonempty cross-schema search_path was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'G014 cross-schema function search_path is not empty: public.preview_account_deletion(uuid,uuid,timestamptz)' THEN
      RAISE;
    END IF;
  END;
  ALTER FUNCTION public.preview_account_deletion(uuid, uuid, timestamptz)
    SET search_path = '';

  PERFORM privacy_retention.assert_g014_invoker_contract();
  PERFORM privacy_retention.assert_g014_cross_schema_contract();
END;
$invoker_and_cross_schema_contract$;
-- The exact frozen identity set must fail independently for missing functions,
-- SECURITY INVOKER drift, owner drift, and a nonempty search_path.
DO $definer_contract$
BEGIN
  PERFORM privacy_retention.assert_g014_definer_contract();

  ALTER FUNCTION public.privacy_resolve_audit_retention_until(text, timestamptz)
    RENAME TO g014_privacy_resolve_audit_retention_until;
  BEGIN
    PERFORM privacy_retention.assert_g014_definer_contract();
    RAISE EXCEPTION 'missing audit-retention resolver identity was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'G014 required SECURITY DEFINER identity is missing: public.privacy_resolve_audit_retention_until(text,timestamptz)' THEN
      RAISE;
    END IF;
  END;
  ALTER FUNCTION public.g014_privacy_resolve_audit_retention_until(text, timestamptz)
    RENAME TO privacy_resolve_audit_retention_until;

  ALTER FUNCTION public.privacy_resolve_audit_retention_until(text, timestamptz)
    OWNER TO postgres;
  BEGIN
    PERFORM privacy_retention.assert_g014_definer_contract();
    RAISE EXCEPTION 'audit-retention resolver owner drift was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'G014 SECURITY DEFINER owner mismatch: public.privacy_resolve_audit_retention_until(text,timestamptz)' THEN
      RAISE;
    END IF;
  END;
  ALTER FUNCTION public.privacy_resolve_audit_retention_until(text, timestamptz)
    OWNER TO privacy_workflow_owner;

  ALTER FUNCTION public.privacy_resolve_audit_retention_until(text, timestamptz)
    SET search_path = pg_catalog;
  BEGIN
    PERFORM privacy_retention.assert_g014_definer_contract();
    RAISE EXCEPTION 'audit-retention resolver search_path drift was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'G014 SECURITY DEFINER search_path is not empty: public.privacy_resolve_audit_retention_until(text,timestamptz)' THEN
      RAISE;
    END IF;
  END;
  ALTER FUNCTION public.privacy_resolve_audit_retention_until(text, timestamptz)
    SET search_path = '';

  PERFORM privacy_retention.assert_g014_definer_contract();

  ALTER FUNCTION public.assert_marketing_service_role()
    RENAME TO g014_assert_marketing_service_role;
  BEGIN
    PERFORM privacy_retention.assert_g014_definer_contract();
    RAISE EXCEPTION 'missing SECURITY DEFINER identity was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'G014 required SECURITY DEFINER identity is missing: public.assert_marketing_service_role()' THEN
      RAISE;
    END IF;
  END;
  ALTER FUNCTION public.g014_assert_marketing_service_role()
    RENAME TO assert_marketing_service_role;

  ALTER FUNCTION public.assert_marketing_service_role() SECURITY INVOKER;
  BEGIN
    PERFORM privacy_retention.assert_g014_definer_contract();
    RAISE EXCEPTION 'SECURITY INVOKER drift was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'G014 required SECURITY DEFINER identity is SECURITY INVOKER: public.assert_marketing_service_role()' THEN
      RAISE;
    END IF;
  END;
  ALTER FUNCTION public.assert_marketing_service_role() SECURITY DEFINER;

  ALTER FUNCTION public.assert_marketing_service_role() OWNER TO postgres;
  BEGIN
    PERFORM privacy_retention.assert_g014_definer_contract();
    RAISE EXCEPTION 'SECURITY DEFINER owner drift was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'G014 SECURITY DEFINER owner mismatch: public.assert_marketing_service_role()' THEN
      RAISE;
    END IF;
  END;
  ALTER FUNCTION public.assert_marketing_service_role() OWNER TO privacy_workflow_owner;

  ALTER FUNCTION public.assert_marketing_service_role() SET search_path = pg_catalog;
  BEGIN
    PERFORM privacy_retention.assert_g014_definer_contract();
    RAISE EXCEPTION 'nonempty SECURITY DEFINER search_path was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'G014 SECURITY DEFINER search_path is not empty: public.assert_marketing_service_role()' THEN
      RAISE;
    END IF;
  END;
  ALTER FUNCTION public.assert_marketing_service_role() SET search_path = '';

  PERFORM privacy_retention.assert_g014_definer_contract();
  CREATE FUNCTION public.g014_definition_scan_accumulate(bigint, bigint)
  RETURNS bigint
  LANGUAGE sql
  IMMUTABLE
  AS $g014_scan_accumulate$
    SELECT $1 + $2
  $g014_scan_accumulate$;
  CREATE AGGREGATE public.g014_definition_scan_aggregate(bigint) (
    SFUNC = public.g014_definition_scan_accumulate,
    STYPE = bigint,
    INITCOND = '0'
  );
  CREATE FUNCTION public.g014_definition_scan_unsafe()
  RETURNS void
  LANGUAGE plpgsql
  AS $g014_scan_unsafe$
  BEGIN
    EXECUTE 'SELECT 1 FROM public.privacy_policy_versions';
  END;
  $g014_scan_unsafe$;

  BEGIN
    PERFORM privacy_retention.assert_g014_definer_contract();
    RAISE EXCEPTION 'unsafe ordinary function definition was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'G014 function definition still has stale or doubled qualification: public.g014_definition_scan_unsafe() [stale_public_privacy_policy_versions]' THEN
      RAISE;
    END IF;
  END;

  DROP FUNCTION public.g014_definition_scan_unsafe();
  PERFORM privacy_retention.assert_g014_definer_contract();

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname IN ('public', 'privacy_retention')
      AND procedure.prokind IN ('f', 'p')
      AND (
        position('public.privacy_policy_versions' IN pg_catalog.pg_get_functiondef(procedure.oid)) <> 0
        OR position('public.privacy_onboarding_challenges' IN pg_catalog.pg_get_functiondef(procedure.oid)) <> 0
        OR position('public.privacy_guardian_verifications' IN pg_catalog.pg_get_functiondef(procedure.oid)) <> 0
        OR position('public.privacy_age_profiles' IN pg_catalog.pg_get_functiondef(procedure.oid)) <> 0
        OR position('public.privacy_consent_events' IN pg_catalog.pg_get_functiondef(procedure.oid)) <> 0
        OR position('public.privacy_audit_events' IN pg_catalog.pg_get_functiondef(procedure.oid)) <> 0
        OR (
          pg_catalog.pg_get_userbyid(procedure.proowner) = 'privacy_workflow_owner'
          AND (
            position('extensions.extensions.' IN pg_catalog.pg_get_functiondef(procedure.oid)) <> 0
            OR position('pg_catalog.pg_catalog.' IN pg_catalog.pg_get_functiondef(procedure.oid)) <> 0
            OR position('public.public.' IN pg_catalog.pg_get_functiondef(procedure.oid)) <> 0
            OR (
              position('gen_random_uuid()' IN pg_catalog.pg_get_functiondef(procedure.oid)) <> 0
              AND position('extensions.gen_random_uuid()' IN pg_catalog.pg_get_functiondef(procedure.oid)) = 0
            )
            OR position(' encode(digest(' IN pg_catalog.pg_get_functiondef(procedure.oid)) <> 0
            OR position(' digest(' IN pg_catalog.pg_get_functiondef(procedure.oid)) <> 0
          )
        )
      )
  ) THEN
    RAISE EXCEPTION 'stale private-table or doubled function qualification remains';
  END IF;
  IF position(
       'public.privacy_consent_state' IN pg_catalog.pg_get_functiondef(
         'public.evaluate_notification_marketing_permission(uuid,text,timestamptz,text)'::regprocedure
       )
     ) <> 0 THEN
    RAISE EXCEPTION 'service marketing evaluator still resolves the owner view';
  END IF;
END;
$definer_contract$;

-- Immutable privacy/admin ledger bytes do not change under denied UPDATE or
-- DELETE attempts. The hash includes the complete JSON row representation.
INSERT INTO privacy_retention.privacy_audit_events (
  id, event_type, actor_user_id, operation_id, correlation_id, status, reason_code,
  count_summary, request_metadata, occurred_at, retention_until
) VALUES (
  '14141414-1414-4141-8141-141414141431',
  'g014_audit_fixture',
  '14141414-1414-4141-8141-141414141401',
  '14141414-1414-4141-8141-141414141432',
  '14141414-1414-4141-8141-141414141433',
  'applied',
  'G014_AUDIT_FIXTURE',
  '{"created":1}'::jsonb,
  '{"requestId":"g014-audit-fixture","route":"/test"}'::jsonb,
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp() + interval '90 days'
);

INSERT INTO public.admin_audit_events (
  id, actor_user_id, action, reason, before_state, after_state, status,
  correlation_id, applied_at, audit_counts, audit_flags
) VALUES (
  '14141414-1414-4141-8141-141414141441',
  '14141414-1414-4141-8141-141414141401',
  'admin_user_profile_updated',
  'ADMIN_USER_PROFILE_UPDATE_APPLIED',
  '{}'::jsonb,
  '{}'::jsonb,
  'applied',
  '14141414-1414-4141-8141-141414141442',
  pg_catalog.clock_timestamp(),
  '{}'::jsonb,
  '{}'::jsonb
);

DO $append_only$
DECLARE
  v_privacy_before text;
  v_privacy_after text;
  v_admin_before text;
  v_admin_after text;
BEGIN
  SELECT pg_catalog.encode(extensions.digest(pg_catalog.to_jsonb(audit)::text, 'sha256'), 'hex')
    INTO v_privacy_before
  FROM privacy_retention.privacy_audit_events AS audit
  WHERE audit.id = '14141414-1414-4141-8141-141414141431';
  SELECT pg_catalog.encode(extensions.digest(pg_catalog.to_jsonb(audit)::text, 'sha256'), 'hex')
    INTO v_admin_before
  FROM public.admin_audit_events AS audit
  WHERE audit.id = '14141414-1414-4141-8141-141414141441';

  BEGIN
    UPDATE privacy_retention.privacy_audit_events
    SET reason_code = 'MUTATED'
    WHERE id = '14141414-1414-4141-8141-141414141431';
    RAISE EXCEPTION 'privacy audit UPDATE unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    DELETE FROM privacy_retention.privacy_audit_events
    WHERE id = '14141414-1414-4141-8141-141414141431';
    RAISE EXCEPTION 'privacy audit DELETE unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    UPDATE public.admin_audit_events
    SET reason = 'MUTATED'
    WHERE id = '14141414-1414-4141-8141-141414141441';
    RAISE EXCEPTION 'admin audit UPDATE unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    DELETE FROM public.admin_audit_events
    WHERE id = '14141414-1414-4141-8141-141414141441';
    RAISE EXCEPTION 'admin audit DELETE unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  SELECT pg_catalog.encode(extensions.digest(pg_catalog.to_jsonb(audit)::text, 'sha256'), 'hex')
    INTO v_privacy_after
  FROM privacy_retention.privacy_audit_events AS audit
  WHERE audit.id = '14141414-1414-4141-8141-141414141431';
  SELECT pg_catalog.encode(extensions.digest(pg_catalog.to_jsonb(audit)::text, 'sha256'), 'hex')
    INTO v_admin_after
  FROM public.admin_audit_events AS audit
  WHERE audit.id = '14141414-1414-4141-8141-141414141441';

  IF v_privacy_before IS DISTINCT FROM v_privacy_after
     OR v_admin_before IS DISTINCT FROM v_admin_after THEN
    RAISE EXCEPTION 'denied audit mutations changed historical row bytes';
  END IF;
END;
$append_only$;
-- Exercise the non-null Auth, storage, product, and retained-audit path. The
-- external storage deletion remains operator work; the SQL receipt records its
-- successful provider readback only after this fixture proves the listed object.
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.objects (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  bucket_id text NOT NULL,
  name text NOT NULL,
  owner_id text
);
DO $storage_bucket_fixture$
BEGIN
  IF pg_catalog.to_regclass('storage.buckets') IS NOT NULL THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('g014-private', 'g014-private', false)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$storage_bucket_fixture$;


SELECT pg_catalog.set_config(
  'g014_deletion.reauthenticated_at',
  pg_catalog.clock_timestamp()::text,
  true
);

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '14141414-1414-4141-8141-141414141451',
  'authenticated',
  'authenticated',
  'g014-deletion-target@example.invalid',
  'not-a-real-password',
  pg_catalog.current_setting('g014_deletion.reauthenticated_at')::timestamptz,
  pg_catalog.current_setting('g014_deletion.reauthenticated_at')::timestamptz,
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  pg_catalog.current_setting('g014_deletion.reauthenticated_at')::timestamptz,
  pg_catalog.current_setting('g014_deletion.reauthenticated_at')::timestamptz
);

INSERT INTO public.profiles (user_id, username, nickname, avatar_url)
VALUES (
  '14141414-1414-4141-8141-141414141451',
  'g014-deletion-target',
  'G014 deletion target',
  'g014/deletion-target.png'
);

INSERT INTO privacy_retention.privacy_age_profiles (
  user_id, age_band, attested_at, method, status, policy_version_id
) VALUES (
  '14141414-1414-4141-8141-141414141451',
  'age_14_plus',
  pg_catalog.clock_timestamp(),
  'self_attestation',
  'eligible',
  '14141414-1414-4141-8141-141414141411'
);
INSERT INTO privacy_retention.privacy_consent_events (
  id,
  user_id,
  subject_kind,
  purpose,
  channel,
  decision,
  policy_version_id,
  notice_sha256,
  source,
  correlation_id,
  idempotency_key
) VALUES (
  '14141414-1414-4141-8141-141414141456',
  '14141414-1414-4141-8141-141414141451',
  'self',
  'email_marketing',
  'email',
  'granted',
  '14141414-1414-4141-8141-141414141411',
  repeat('a', 64),
  'settings',
  '14141414-1414-4141-8141-141414141457',
  'g014-deletion-target-consent-0001'
);
INSERT INTO public.notifications (
  id,
  user_id,
  type,
  title,
  message,
  data,
  classification,
  channel,
  consent_event_id,
  retention_class,
  delivered_at
) VALUES (
  '14141414-1414-4141-8141-141414141458',
  '14141414-1414-4141-8141-141414141451',
  'g014_marketing',
  'G014 marketing',
  'Consent-bound notification fixture',
  '{}'::jsonb,
  'marketing',
  'email',
  '14141414-1414-4141-8141-141414141456',
  'notifications_operational',
  pg_catalog.clock_timestamp()
);


UPDATE privacy_retention.privacy_retention_classes
SET data_class = 'privacy_account_deletion_audit',
    basis_code = 'test.g014_account_deletion_audit',
    trigger_type = 'event_occurred',
    retention_period = interval '90 days',
    status = 'active',
    approved_evidence_ref = 'G014-TEST-ACCOUNT-DELETION-AUDIT',
    version = 'g014-test-v1'
WHERE code = 'privacy_account_deletion_audit';

INSERT INTO privacy_retention.privacy_audit_events (
  id, event_type, actor_user_id, operation_id, correlation_id, status, reason_code,
  count_summary, request_metadata, occurred_at, retention_until
) VALUES (
  '14141414-1414-4141-8141-141414141452',
  'g014_account_deletion_actor_fixture',
  '14141414-1414-4141-8141-141414141451',
  '14141414-1414-4141-8141-141414141453',
  '14141414-1414-4141-8141-141414141454',
  'applied',
  'G014_ACCOUNT_DELETION_ACTOR_FIXTURE',
  '{"created":1}'::jsonb,
  '{"requestId":"g014-account-deletion-actor","route":"/test"}'::jsonb,
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp() + interval '90 days'
);

INSERT INTO storage.objects (id, bucket_id, name, owner_id)
VALUES (
  '14141414-1414-4141-8141-141414141455',
  'g014-private',
  'account-deletion-target.bin',
  '14141414-1414-4141-8141-141414141451'
);

SELECT pg_catalog.set_config(
  'g014_deletion.audit_count',
  (
    SELECT count(*)::text
    FROM privacy_retention.privacy_audit_events AS audit
    WHERE audit.actor_user_id = '14141414-1414-4141-8141-141414141451'
  ),
  true
);
SELECT pg_catalog.set_config(
  'g014_deletion.audit_hash',
  (
    SELECT pg_catalog.encode(
      extensions.digest(
        COALESCE(
          pg_catalog.jsonb_agg(pg_catalog.to_jsonb(audit) ORDER BY audit.id),
          '[]'::jsonb
        )::text,
        'sha256'
      ),
      'hex'
    )
    FROM privacy_retention.privacy_audit_events AS audit
    WHERE audit.actor_user_id = '14141414-1414-4141-8141-141414141451'
  ),
  true
);
UPDATE auth.users
SET last_sign_in_at = pg_catalog.clock_timestamp()
WHERE id = '14141414-1414-4141-8141-141414141451';

SELECT pg_catalog.set_config(
  'g014_deletion.reauthenticated_at',
  (
    SELECT user_row.last_sign_in_at::text
    FROM auth.users AS user_row
    WHERE user_row.id = '14141414-1414-4141-8141-141414141451'
  ),
  true
);

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $account_deletion_apply$
DECLARE
  v_preview record;
  v_apply record;
  v_cleanup record;
  v_storage record;
  v_storage_final record;
BEGIN
  SELECT * INTO v_preview
  FROM public.preview_account_deletion(
    '14141414-1414-4141-8141-141414141451',
    '14141414-1414-4141-8141-141414141451',
    pg_catalog.current_setting('g014_deletion.reauthenticated_at')::timestamptz
  );

  IF v_preview.request_id IS NULL
     OR v_preview.status <> 'previewed'
     OR v_preview.separate_count <> 1
     OR v_preview.anonymize_count <> 1
     OR v_preview.delete_count < 3 THEN
    RAISE EXCEPTION 'non-null account-deletion preview did not reach Auth, product, storage, and retained-audit dependencies';
  END IF;

  PERFORM pg_catalog.set_config('g014_deletion.request_id', v_preview.request_id::text, true);
  PERFORM pg_catalog.set_config('g014_deletion.preview_hash', v_preview.preview_hash, true);

  SELECT * INTO v_apply
  FROM public.begin_account_deletion_apply(
    '14141414-1414-4141-8141-141414141451',
    '14141414-1414-4141-8141-141414141451',
    v_preview.request_id,
    v_preview.preview_hash,
    '계정 삭제',
    'g014-deletion-apply-0001',
    pg_catalog.current_setting('g014_deletion.reauthenticated_at')::timestamptz
  );

  IF v_apply.status <> 'applying'
     OR v_apply.separate_count <> 1 THEN
    RAISE EXCEPTION 'non-null account-deletion apply did not preserve the separated audit class';
  END IF;

  SELECT * INTO v_cleanup
  FROM public.apply_account_deletion_database_cleanup(
    '14141414-1414-4141-8141-141414141451',
    v_preview.request_id
  );

  IF v_cleanup.status <> 'applying'
     OR NOT v_cleanup.db_readback_passed
     OR NOT v_cleanup.session_readback_passed THEN
    RAISE EXCEPTION 'account-deletion database cleanup did not complete its independent readback';
  END IF;

  SELECT * INTO v_storage
  FROM public.list_account_deletion_storage_objects(
    '14141414-1414-4141-8141-141414141451',
    v_preview.request_id
  );

  IF v_storage.bucket_id <> 'g014-private'
     OR v_storage.object_name <> 'account-deletion-target.bin' THEN
    RAISE EXCEPTION 'account-deletion storage listing did not reach the non-null storage dependency';
  END IF;

  SELECT * INTO v_storage_final
  FROM public.finalize_account_deletion_storage(
    '14141414-1414-4141-8141-141414141451',
    v_preview.request_id,
    true
  );

  IF v_storage_final.status <> 'applying'
     OR NOT v_storage_final.storage_readback_passed THEN
    RAISE EXCEPTION 'account-deletion storage readback was not recorded';
  END IF;
END;
$account_deletion_apply$;
RESET ROLE;

DO $account_deletion_cleanup_readback$
DECLARE
  v_request_id uuid := pg_catalog.current_setting('g014_deletion.request_id')::uuid;
  v_target_id uuid := '14141414-1414-4141-8141-141414141451';
  v_hash_after text;
BEGIN
  SELECT pg_catalog.encode(
    extensions.digest(
      COALESCE(
        pg_catalog.jsonb_agg(pg_catalog.to_jsonb(audit) ORDER BY audit.id),
        '[]'::jsonb
      )::text,
      'sha256'
    ),
    'hex'
  )
  INTO v_hash_after
  FROM privacy_retention.privacy_audit_events AS audit
  WHERE audit.actor_user_id = v_target_id;

  IF (
    SELECT count(*)
    FROM privacy_retention.privacy_audit_events AS audit
    WHERE audit.actor_user_id = v_target_id
  )::text <> pg_catalog.current_setting('g014_deletion.audit_count')
     OR v_hash_after <> pg_catalog.current_setting('g014_deletion.audit_hash')
     OR EXISTS (
       SELECT 1
       FROM privacy_retention.privacy_age_profiles AS age_profile
       WHERE age_profile.user_id = v_target_id
    )
     OR EXISTS (
       SELECT 1
       FROM privacy_retention.privacy_consent_events AS consent
       WHERE consent.user_id = v_target_id
    )
     OR EXISTS (
       SELECT 1
       FROM privacy_retention.privacy_guardian_verifications AS guardian
       WHERE guardian.child_user_id = v_target_id
    )
     OR EXISTS (
       SELECT 1
       FROM privacy_retention.privacy_onboarding_challenges AS challenge
       WHERE challenge.consumed_by_user_id = v_target_id
    )
     OR EXISTS (
       SELECT 1
       FROM public.notifications AS notification
       WHERE notification.id = '14141414-1414-4141-8141-141414141458'
          OR notification.consent_event_id = '14141414-1414-4141-8141-141414141456'
    )
     OR NOT EXISTS (
       SELECT 1
       FROM public.profiles AS profile
       WHERE profile.user_id = v_target_id
         AND profile.nickname = '탈퇴한 사용자'
         AND profile.username IS NULL
         AND profile.avatar_url IS NULL
     )
     OR NOT EXISTS (
       SELECT 1
       FROM public.account_deletion_request_items AS request_item
       WHERE request_item.request_id = v_request_id
         AND request_item.data_class_code = 'privacy_audit_actor_references'
         AND request_item.disposition = 'separate'
         AND request_item.status = 'separated'
         AND request_item.reason_code = 'DB_READBACK_PASSED'
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint AS constraint_row
       WHERE constraint_row.conrelid = 'privacy_retention.privacy_audit_events'::regclass
         AND constraint_row.contype = 'f'
         AND constraint_row.confrelid = 'auth.users'::regclass
     ) THEN
    RAISE EXCEPTION 'account-deletion cleanup did not retain immutable detached audit bytes and separate receipt state';
  END IF;
END;
$account_deletion_cleanup_readback$;

DELETE FROM auth.users
WHERE id = '14141414-1414-4141-8141-141414141451';

DO $auth_delete_readback$
DECLARE
  v_target_id uuid := '14141414-1414-4141-8141-141414141451';
BEGIN
  IF EXISTS (
    SELECT 1 FROM auth.users AS user_row WHERE user_row.id = v_target_id
  ) OR (
    SELECT count(*)
    FROM privacy_retention.privacy_audit_events AS audit
    WHERE audit.actor_user_id = v_target_id
  )::text <> pg_catalog.current_setting('g014_deletion.audit_count')
     OR (
       SELECT pg_catalog.encode(
         extensions.digest(
           COALESCE(
             pg_catalog.jsonb_agg(pg_catalog.to_jsonb(audit) ORDER BY audit.id),
             '[]'::jsonb
           )::text,
           'sha256'
         ),
         'hex'
       )
       FROM privacy_retention.privacy_audit_events AS audit
       WHERE audit.actor_user_id = v_target_id
     ) <> pg_catalog.current_setting('g014_deletion.audit_hash') THEN
    RAISE EXCEPTION 'detached retained audit blocked Auth deletion or changed historical bytes';
  END IF;
END;
$auth_delete_readback$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $account_deletion_auth_finalize$
DECLARE
  v_final record;
BEGIN
  SELECT * INTO v_final
  FROM public.finalize_account_deletion_auth(
    '14141414-1414-4141-8141-141414141451',
    pg_catalog.current_setting('g014_deletion.request_id')::uuid,
    true
  );

  IF v_final.status <> 'applied'
     OR v_final.reason_code <> 'APPLIED'
     OR NOT v_final.auth_readback_passed
     OR v_final.separate_count <> 1 THEN
    RAISE EXCEPTION 'Auth-last account-deletion receipt did not finalize the separated audit workflow';
  END IF;
END;
$account_deletion_auth_finalize$;
RESET ROLE;

DO $account_deletion_final_readback$
DECLARE
  v_request_id uuid := pg_catalog.current_setting('g014_deletion.request_id')::uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.account_deletion_requests AS request
    WHERE request.id = v_request_id
      AND request.status = 'applied'
      AND request.db_readback_passed
      AND request.storage_readback_passed
      AND request.session_readback_passed
      AND request.auth_readback_passed
  ) OR (
    SELECT count(*)
    FROM privacy_retention.privacy_audit_events AS audit
    WHERE audit.event_type = 'account_deletion'
      AND audit.operation_id = v_request_id
      AND audit.correlation_id = v_request_id
  ) <> 4 OR NOT EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_audit_events AS audit
    WHERE audit.event_type = 'account_deletion'
      AND audit.operation_id = v_request_id
      AND audit.status = 'applied'
      AND audit.reason_code = 'APPLIED'
  ) THEN
    RAISE EXCEPTION 'account-deletion retained-audit append/readback contract failed';
  END IF;
END;
$account_deletion_final_readback$;

CREATE TEMPORARY TABLE pg_temp.g014_post_deletion_audit_snapshot AS
SELECT audit.id,
       audit.actor_user_id,
       pg_catalog.encode(
         extensions.digest(pg_catalog.to_jsonb(audit)::text, 'sha256'),
         'hex'
       ) AS row_hash
FROM privacy_retention.privacy_audit_events AS audit
ORDER BY audit.id;

CREATE TEMPORARY TABLE pg_temp.g014_post_deletion_runtime_snapshot AS
SELECT procedure.oid,
       procedure.proowner,
       procedure.prosecdef,
       procedure.proconfig
FROM pg_catalog.pg_proc AS procedure
WHERE procedure.oid IN (
  'privacy_retention.g014_reject_audit_mutation()'::regprocedure,
  'public.preview_account_deletion(uuid,uuid,timestamptz)'::regprocedure,
  'public.apply_account_deletion_database_cleanup(uuid,uuid)'::regprocedure,
  'public.list_account_deletion_storage_objects(uuid,uuid)'::regprocedure,
  'public.privacy_resolve_audit_retention_until(text,timestamptz)'::regprocedure,
  'privacy_retention.write_run_audit(privacy_retention.privacy_retention_runs,text,text)'::regprocedure
);

\ir ../migrations/20260713002000_g014_public_api_private_boundary.sql

DO $post_deletion_repeat_apply$
BEGIN
  IF EXISTS (
    (SELECT * FROM pg_temp.g014_post_deletion_audit_snapshot)
    EXCEPT
    (
      SELECT audit.id,
             audit.actor_user_id,
             pg_catalog.encode(
               extensions.digest(pg_catalog.to_jsonb(audit)::text, 'sha256'),
               'hex'
             )
      FROM privacy_retention.privacy_audit_events AS audit
    )
  ) OR EXISTS (
    (
      SELECT audit.id,
             audit.actor_user_id,
             pg_catalog.encode(
               extensions.digest(pg_catalog.to_jsonb(audit)::text, 'sha256'),
               'hex'
             )
      FROM privacy_retention.privacy_audit_events AS audit
    )
    EXCEPT
    (SELECT * FROM pg_temp.g014_post_deletion_audit_snapshot)
  ) OR EXISTS (
    (SELECT * FROM pg_temp.g014_post_deletion_runtime_snapshot)
    EXCEPT
    (
      SELECT procedure.oid,
             procedure.proowner,
             procedure.prosecdef,
             procedure.proconfig
      FROM pg_catalog.pg_proc AS procedure
      WHERE procedure.oid IN (
        'privacy_retention.g014_reject_audit_mutation()'::regprocedure,
        'public.preview_account_deletion(uuid,uuid,timestamptz)'::regprocedure,
        'public.apply_account_deletion_database_cleanup(uuid,uuid)'::regprocedure,
        'public.list_account_deletion_storage_objects(uuid,uuid)'::regprocedure,
        'public.privacy_resolve_audit_retention_until(text,timestamptz)'::regprocedure,
        'privacy_retention.write_run_audit(privacy_retention.privacy_retention_runs,text,text)'::regprocedure
      )
    )
  ) OR EXISTS (
    (
      SELECT procedure.oid,
             procedure.proowner,
             procedure.prosecdef,
             procedure.proconfig
      FROM pg_catalog.pg_proc AS procedure
      WHERE procedure.oid IN (
        'privacy_retention.g014_reject_audit_mutation()'::regprocedure,
        'public.preview_account_deletion(uuid,uuid,timestamptz)'::regprocedure,
        'public.apply_account_deletion_database_cleanup(uuid,uuid)'::regprocedure,
        'public.list_account_deletion_storage_objects(uuid,uuid)'::regprocedure,
        'public.privacy_resolve_audit_retention_until(text,timestamptz)'::regprocedure,
        'privacy_retention.write_run_audit(privacy_retention.privacy_retention_runs,text,text)'::regprocedure
      )
    )
    EXCEPT
    (SELECT * FROM pg_temp.g014_post_deletion_runtime_snapshot)
  ) THEN
    RAISE EXCEPTION 'repeat G014 apply changed retained audit bytes or hardened runtime configuration';
  END IF;

  PERFORM privacy_retention.assert_g014_invoker_contract();
  PERFORM privacy_retention.assert_g014_cross_schema_contract();
  PERFORM privacy_retention.assert_g014_definer_contract();
END;
$post_deletion_repeat_apply$;

-- A missing required identity must hard-fail validation in the rollback fixture.
DROP FUNCTION public.reserve_admin_provider_budget(uuid, text, uuid);
DO $missing_identity$
BEGIN
  BEGIN
    PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
    RAISE EXCEPTION 'missing required RPC identity was accepted';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    IF SQLERRM <> 'G014 required public RPC identity is missing' THEN
      RAISE;
    END IF;
  END;
END;
$missing_identity$;

ROLLBACK;
