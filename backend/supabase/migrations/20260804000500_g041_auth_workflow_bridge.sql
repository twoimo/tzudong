-- G041-005: isolate the remaining managed-auth reads behind a non-login bridge.
BEGIN;

DO $preflight$
DECLARE
  v_expected text[] := ARRAY[
    'public.submit_privacy_consent(uuid,text,text,text,uuid,text)',
    'public.hold_privacy_onboarding_compensation(uuid,text)',
    'public.preview_account_deletion(uuid,uuid,text)',
    'public.begin_account_deletion(uuid,uuid,text,text)',
    'public.finalize_account_deletion(uuid,uuid,text,text)',
    'public.prepare_account_deletion_external_egress(uuid,uuid,uuid,text,text,text,text,uuid)',
    'public.reconcile_account_deletion_auth_job(uuid,uuid,uuid,text,text,text,uuid)',
    'public.get_current_account_deletion_status()'
  ];
BEGIN
  IF pg_catalog.to_regrole('privacy_workflow_owner') IS NULL
     OR (SELECT count(*) FROM unnest(v_expected) AS x(signature)
         WHERE pg_catalog.to_regprocedure(x.signature) IS NOT NULL) <> array_length(v_expected, 1) THEN
    RAISE EXCEPTION 'g041_auth_workflow_bridge_expected_signature_drift';
  END IF;
END $preflight$;

DO $bridge$
BEGIN
  IF pg_catalog.to_regrole('privacy_auth_bridge') IS NULL THEN
    CREATE ROLE privacy_auth_bridge NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;
  END IF;
END $bridge$;
GRANT privacy_workflow_owner TO privacy_auth_bridge;
GRANT USAGE ON SCHEMA auth TO privacy_auth_bridge;
GRANT SELECT (id) ON auth.users TO privacy_auth_bridge;
GRANT SELECT (user_id) ON auth.sessions, auth.identities, auth.refresh_tokens TO privacy_auth_bridge;

-- The helper is private: it intentionally exposes only an existence predicate,
-- never Auth rows.  It is the sole approved managed-auth surface.
CREATE OR REPLACE FUNCTION privacy_retention.g041_auth_subject_exists(p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id)
$$;
ALTER FUNCTION privacy_retention.g041_auth_subject_exists(uuid) OWNER TO privacy_auth_bridge;
REVOKE ALL ON FUNCTION privacy_retention.g041_auth_subject_exists(uuid) FROM PUBLIC, anon, authenticated, service_role, privacy_workflow_owner;

-- These established entry points contain the legacy Auth accesses.  Their exact
-- signatures are asserted above; moving their definer identity preserves their
-- bodies/ACLs while making managed-auth authority unreachable from the workflow
-- owner.  They retain their existing public execute ACLs, not bridge-helper ACLs.
ALTER FUNCTION public.submit_privacy_consent(uuid,text,text,text,uuid,text) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.hold_privacy_onboarding_compensation(uuid,text) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.preview_account_deletion(uuid,uuid,text) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.begin_account_deletion(uuid,uuid,text,text) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.finalize_account_deletion(uuid,uuid,text,text) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.prepare_account_deletion_external_egress(uuid,uuid,uuid,text,text,text,text,uuid) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.reconcile_account_deletion_auth_job(uuid,uuid,uuid,text,text,text,uuid) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.get_current_account_deletion_status() OWNER TO privacy_auth_bridge;

REVOKE ALL PRIVILEGES ON SCHEMA auth FROM privacy_workflow_owner;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth FROM privacy_workflow_owner;

DO $readback$
DECLARE v_bridge oid := 'privacy_auth_bridge'::regrole; v_owner oid := 'privacy_workflow_owner'::regrole;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='privacy_auth_bridge' AND (rolcanlogin OR rolbypassrls))
     OR NOT has_schema_privilege('privacy_auth_bridge','auth','USAGE')
     OR NOT has_column_privilege('privacy_auth_bridge','auth.users','id','SELECT')
     OR has_schema_privilege('privacy_workflow_owner','auth','USAGE')
     OR has_table_privilege('privacy_workflow_owner','auth.users','SELECT,INSERT,UPDATE,DELETE')
     OR has_function_privilege('authenticated','privacy_retention.g041_auth_subject_exists(uuid)','EXECUTE')
     OR has_function_privilege('privacy_workflow_owner','privacy_retention.g041_auth_subject_exists(uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'g041_auth_workflow_bridge_acl_invalid';
  END IF;
  IF (SELECT count(*) FROM pg_proc WHERE oid = ANY (ARRAY[
    'public.submit_privacy_consent(uuid,text,text,text,uuid,text)'::regprocedure,
    'public.hold_privacy_onboarding_compensation(uuid,text)'::regprocedure,
    'public.preview_account_deletion(uuid,uuid,text)'::regprocedure,
    'public.begin_account_deletion(uuid,uuid,text,text)'::regprocedure,
    'public.finalize_account_deletion(uuid,uuid,text,text)'::regprocedure,
    'public.prepare_account_deletion_external_egress(uuid,uuid,uuid,text,text,text,text,uuid)'::regprocedure,
    'public.reconcile_account_deletion_auth_job(uuid,uuid,uuid,text,text,text,uuid)'::regprocedure,
    'public.get_current_account_deletion_status()'::regprocedure] ) AND proowner=v_bridge AND prosecdef) <> 8 THEN
    RAISE EXCEPTION 'g041_auth_workflow_bridge_replacement_coverage_invalid';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
             WHERE p.proowner=v_owner AND pg_get_functiondef(p.oid) ~ '\mauth\.(uid|users|sessions|identities|refresh_tokens)\M') THEN
    RAISE EXCEPTION 'g041_auth_workflow_owner_direct_auth_dependency_remains';
  END IF;
END $readback$;
NOTIFY pgrst, 'reload schema';
COMMIT;
