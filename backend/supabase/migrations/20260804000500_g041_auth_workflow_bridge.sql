-- G041-005: the G041-004 Auth-ACL closure remains in force. Managed Auth
-- access crosses narrow postgres-owned views; workflow routines use a non-login bridge.
BEGIN;

DO $bridge_role$
BEGIN
  IF pg_catalog.to_regrole('privacy_auth_bridge') IS NULL THEN
    CREATE ROLE privacy_auth_bridge NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE INHERIT NOBYPASSRLS;
  END IF;
END $bridge_role$;


DO $membership$
DECLARE
  v_membership_exists boolean;
  v_set_option boolean := true;
  v_supports_set_option boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members AS membership
    WHERE membership.roleid = 'privacy_workflow_owner'::pg_catalog.regrole
      AND membership.member = pg_catalog.to_regrole(session_user)
  ) INTO v_membership_exists;
  SELECT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'pg_catalog.pg_auth_members'::pg_catalog.regclass
      AND attribute.attname = 'set_option' AND NOT attribute.attisdropped
  ) INTO v_supports_set_option;
  IF v_membership_exists AND v_supports_set_option THEN
    EXECUTE 'SELECT membership.set_option FROM pg_catalog.pg_auth_members AS membership '
      || 'WHERE membership.roleid = ''privacy_workflow_owner''::pg_catalog.regrole '
      || 'AND membership.member = pg_catalog.to_regrole(session_user)' INTO v_set_option;
  END IF;
  IF NOT v_membership_exists THEN
    EXECUTE pg_catalog.format(CASE WHEN v_supports_set_option
      THEN 'GRANT privacy_workflow_owner TO %I WITH SET TRUE'
      ELSE 'GRANT privacy_workflow_owner TO %I' END, session_user);
    PERFORM pg_catalog.set_config('g041_bridge.remove_owner_membership', 'true', true);
    PERFORM pg_catalog.set_config('g041_bridge.restore_owner_set_false', 'false', true);
  ELSIF v_supports_set_option AND NOT v_set_option THEN
    EXECUTE pg_catalog.format('GRANT privacy_workflow_owner TO %I WITH SET TRUE', session_user);
    PERFORM pg_catalog.set_config('g041_bridge.remove_owner_membership', 'false', true);
    PERFORM pg_catalog.set_config('g041_bridge.restore_owner_set_false', 'true', true);
  ELSE
    PERFORM pg_catalog.set_config('g041_bridge.remove_owner_membership', 'false', true);
    PERFORM pg_catalog.set_config('g041_bridge.restore_owner_set_false', 'false', true);
  END IF;
  EXECUTE pg_catalog.format(
    CASE WHEN v_supports_set_option
      THEN 'GRANT privacy_auth_bridge TO %I WITH SET TRUE'
      ELSE 'GRANT privacy_auth_bridge TO %I'
    END,
    session_user
  );
END $membership$;
CREATE OR REPLACE VIEW privacy_retention.g041_auth_users
WITH (security_barrier = true) AS
SELECT id, email, last_sign_in_at FROM auth.users;
CREATE OR REPLACE VIEW privacy_retention.g041_auth_sessions
WITH (security_barrier = true) AS
SELECT id, user_id FROM auth.sessions;
CREATE OR REPLACE VIEW privacy_retention.g041_auth_identities
WITH (security_barrier = true) AS
SELECT user_id FROM auth.identities;
CREATE OR REPLACE VIEW privacy_retention.g041_auth_refresh_tokens
WITH (security_barrier = true) AS
SELECT user_id, session_id, token FROM auth.refresh_tokens;
REVOKE ALL ON TABLE
  privacy_retention.g041_auth_users,
  privacy_retention.g041_auth_sessions,
  privacy_retention.g041_auth_identities,
  privacy_retention.g041_auth_refresh_tokens
FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE
  privacy_retention.g041_auth_users,
  privacy_retention.g041_auth_sessions,
  privacy_retention.g041_auth_identities,
  privacy_retention.g041_auth_refresh_tokens
TO privacy_auth_bridge;
GRANT DELETE ON TABLE
  privacy_retention.g041_auth_sessions,
  privacy_retention.g041_auth_refresh_tokens
TO privacy_auth_bridge;

SET LOCAL ROLE privacy_workflow_owner;

CREATE OR REPLACE FUNCTION privacy_retention.g041_current_claim_user_id()
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $function$
DECLARE v_claims jsonb; v_role text; v_subject uuid;
BEGIN
  BEGIN
    v_claims := COALESCE(NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
    v_role := COALESCE(NULLIF(v_claims ->> 'role', ''), pg_catalog.current_setting('request.jwt.claim.role', true), '');
    v_subject := NULLIF(COALESCE(NULLIF(v_claims ->> 'sub', ''), pg_catalog.current_setting('request.jwt.claim.sub', true)), '')::uuid;
  EXCEPTION WHEN invalid_text_representation OR invalid_parameter_value THEN
    RETURN NULL;
  END;
  IF v_role <> 'authenticated' THEN RETURN NULL; END IF;
  RETURN v_subject;
END $function$;
ALTER FUNCTION privacy_retention.g041_current_claim_user_id() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g041_current_claim_user_id() FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_workflow_owner_contract()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_owner pg_catalog.pg_roles%ROWTYPE;
  v_bridge pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO v_owner
  FROM pg_catalog.pg_roles
  WHERE rolname = 'privacy_workflow_owner';
  SELECT * INTO v_bridge
  FROM pg_catalog.pg_roles
  WHERE rolname = 'privacy_auth_bridge';

  IF v_owner.oid IS NULL OR v_bridge.oid IS NULL THEN
    RAISE EXCEPTION 'privacy workflow bridge roles are missing';
  END IF;
  IF v_owner.rolsuper OR v_owner.rolinherit OR v_owner.rolcreaterole
     OR v_owner.rolcreatedb OR v_owner.rolreplication
     OR v_owner.rolbypassrls OR v_owner.rolcanlogin
     OR v_bridge.rolsuper OR NOT v_bridge.rolinherit OR v_bridge.rolcreaterole
     OR v_bridge.rolcreatedb OR v_bridge.rolreplication
     OR v_bridge.rolbypassrls OR v_bridge.rolcanlogin THEN
    RAISE EXCEPTION 'privacy workflow bridge role attributes are incompatible';
  END IF;
  IF (SELECT count(*)
      FROM pg_catalog.pg_auth_members AS membership
      WHERE membership.member = v_owner.oid OR membership.roleid = v_owner.oid) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_auth_members AS membership
       WHERE membership.roleid = v_owner.oid
         AND membership.member = v_bridge.oid
         AND NOT membership.admin_option
     )
     OR NOT pg_catalog.pg_has_role(v_bridge.oid, v_owner.oid, 'USAGE') THEN
    RAISE EXCEPTION 'privacy_workflow_owner has unexpected role membership or effective access';
  END IF;
END;
$function$;

-- Replace only the exact claim-only routine set. CREATE OR REPLACE preserves
-- existing execute ACLs while the temporary owner role preserves ownership.
DO $claim_only_replacements$
DECLARE
  v_expected_signatures text[] := ARRAY[
    'public.approve_edit_submission_item(uuid,uuid,jsonb)',
    'public.approve_submission_item(uuid,uuid,jsonb)',
    'public.create_user_notification(uuid,text,text,text,jsonb)',
    'public.delete_notification(uuid)',
    'public.mark_all_notifications_read()',
    'public.mark_notification_read(uuid)',
    'public.merge_restaurant_records_for_admin_review(uuid,uuid,uuid,timestamptz,text,jsonb,text,text)',
    'public.read_current_account_deletion_status(uuid,text,text)',
    'public.submit_privacy_consent(text,text,text,uuid,text,text,uuid,text,uuid)'
  ];
  v_signature text;
  v_function_definition text;
  v_source text;
  v_occurrences integer;
BEGIN
  IF (SELECT count(*) FROM unnest(v_expected_signatures) AS expected(signature)
      WHERE pg_catalog.to_regprocedure(expected.signature) IS NOT NULL) <> array_length(v_expected_signatures, 1) THEN
    RAISE EXCEPTION 'g041_auth_workflow_claim_signature_drift';
  END IF;

  FOREACH v_signature IN ARRAY v_expected_signatures LOOP
    SELECT pg_catalog.pg_get_functiondef(procedure.oid), procedure.prosrc
    INTO v_function_definition, v_source
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid = pg_catalog.to_regprocedure(v_signature)
      AND procedure.proowner = 'privacy_workflow_owner'::pg_catalog.regrole
      AND procedure.prosecdef;

    v_occurrences := (length(v_source) - length(replace(v_source, 'auth.uid()', ''))) / length('auth.uid()');
    IF v_function_definition IS NULL
       OR v_occurrences < 1
       OR v_source ~ '\mauth\.(users|sessions|identities|refresh_tokens)\M' THEN
      RAISE EXCEPTION 'g041_auth_workflow_claim_replacement_drift: %', v_signature;
    END IF;

    EXECUTE replace(
      v_function_definition,
      'auth.uid()',
      'privacy_retention.g041_current_claim_user_id()'
    );
  END LOOP;
END
$claim_only_replacements$;

-- Exact, replay-safe manifest of every workflow-owner Auth-table routine.
DO $preflight$
DECLARE
  v_claim_only_after integer;
  v_bridge_signatures text[] := ARRAY[
    'public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)',
    'public.create_admin_transactional_notification(uuid,uuid,text,text,text,jsonb)',
    'public.create_review_like_notification(uuid,uuid,uuid)',
    'public.finalize_account_deletion_auth(uuid,uuid,uuid,text,text,text,uuid,text)',
    'public.hold_privacy_onboarding_compensation(uuid,uuid,text,text)',
    'public.make_user_admin(text)',
    'public.preflight_release_auth_session_family(uuid,uuid,uuid,text,bigint)',
    'public.prepare_account_deletion_external_egress(uuid,uuid,uuid,text,text,text,text,uuid)',
    'public.preview_account_deletion(uuid,uuid,timestamptz)',
    'privacy_retention.g014_account_deletion_reconcile_expired_attempt(uuid,text,uuid)',
    'privacy_retention.g014_retention_append_audit(privacy_retention.privacy_retention_runs,text,text)',
    'public.read_account_deletion_external_job(uuid,uuid,uuid,text,text,text,text,uuid)',
    'public.read_release_auth_revocation(uuid,uuid,uuid)',
    'public.read_release_auth_revocation_by_operation(uuid)',
    'public.reconcile_account_deletion_auth_job(uuid,uuid,uuid,text,text,text,uuid)',
    'public.revoke_release_auth_session_family(uuid,uuid,uuid,text)',
    'public.run_account_deletion_session_family_cleanup(uuid,uuid,uuid,text,text,text,uuid)',
    'privacy_retention.g014_account_deletion_apply_adapter(text,uuid,uuid)',
    'public.apply_account_deletion_database_cleanup(uuid,uuid,uuid,text,text,text)',
    'public.activate_account_deletion_policy(text,text)',
    'public.evaluate_notification_marketing_permission(uuid,text,timestamptz,text)'
  ];
BEGIN
  SELECT count(*) INTO v_claim_only_after
  FROM pg_catalog.pg_proc AS procedure
  WHERE procedure.proowner = 'privacy_workflow_owner'::pg_catalog.regrole
    AND pg_catalog.pg_get_functiondef(procedure.oid) ~ '\mauth\.uid\(\)\M'
    AND pg_catalog.pg_get_functiondef(procedure.oid) !~ '\mauth\.(users|sessions|identities|refresh_tokens)\M';
  IF v_claim_only_after <> 0 THEN
    RAISE EXCEPTION 'g041_auth_workflow_claim_only_replacement_count_drift: %', v_claim_only_after;
  END IF;
  IF pg_catalog.to_regrole('privacy_workflow_owner') IS NULL
     OR (SELECT count(*) FROM unnest(v_bridge_signatures) AS expected(signature)
         WHERE pg_catalog.to_regprocedure(expected.signature) IS NOT NULL) <> array_length(v_bridge_signatures, 1) THEN
    RAISE EXCEPTION 'g041_auth_workflow_bridge_expected_signature_drift';
  END IF;
END $preflight$;
DO $auth_view_replacements$
DECLARE
  v_signatures text[] := ARRAY[
    'public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)',
    'public.create_admin_transactional_notification(uuid,uuid,text,text,text,jsonb)',
    'public.create_review_like_notification(uuid,uuid,uuid)',
    'public.finalize_account_deletion_auth(uuid,uuid,uuid,text,text,text,uuid,text)',
    'public.hold_privacy_onboarding_compensation(uuid,uuid,text,text)',
    'public.make_user_admin(text)',
    'public.preflight_release_auth_session_family(uuid,uuid,uuid,text,bigint)',
    'public.prepare_account_deletion_external_egress(uuid,uuid,uuid,text,text,text,text,uuid)',
    'public.preview_account_deletion(uuid,uuid,timestamptz)',
    'privacy_retention.g014_account_deletion_reconcile_expired_attempt(uuid,text,uuid)',
    'privacy_retention.g014_retention_append_audit(privacy_retention.privacy_retention_runs,text,text)',
    'public.read_account_deletion_external_job(uuid,uuid,uuid,text,text,text,text,uuid)',
    'public.read_release_auth_revocation(uuid,uuid,uuid)',
    'public.read_release_auth_revocation_by_operation(uuid)',
    'public.reconcile_account_deletion_auth_job(uuid,uuid,uuid,text,text,text,uuid)',
    'public.revoke_release_auth_session_family(uuid,uuid,uuid,text)',
    'public.run_account_deletion_session_family_cleanup(uuid,uuid,uuid,text,text,text,uuid)',
    'privacy_retention.g014_account_deletion_apply_adapter(text,uuid,uuid)'
  ];
  v_signature text;
  v_definition text;
  v_rewritten text;
BEGIN
  FOREACH v_signature IN ARRAY v_signatures LOOP
    SELECT pg_catalog.pg_get_functiondef(procedure.oid)
    INTO v_definition
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid = pg_catalog.to_regprocedure(v_signature)
      AND procedure.proowner = 'privacy_workflow_owner'::pg_catalog.regrole
      AND procedure.prosecdef;

    IF v_definition IS NULL THEN
      RAISE EXCEPTION 'g041_auth_workflow_view_replacement_drift: %', v_signature;
    END IF;

    v_rewritten := replace(v_definition, 'auth.users', 'privacy_retention.g041_auth_users');
    v_rewritten := replace(v_rewritten, 'auth.sessions', 'privacy_retention.g041_auth_sessions');
    v_rewritten := replace(v_rewritten, 'auth.identities', 'privacy_retention.g041_auth_identities');
    v_rewritten := replace(v_rewritten, 'auth.refresh_tokens', 'privacy_retention.g041_auth_refresh_tokens');
    v_rewritten := replace(v_rewritten, 'auth.uid()', 'privacy_retention.g041_current_claim_user_id()');
    IF v_rewritten ~ '\mauth\.(uid|users|sessions|identities|refresh_tokens)\M' THEN
      RAISE EXCEPTION 'g041_auth_workflow_view_replacement_incomplete: %', v_signature;
    END IF;
    IF v_rewritten IS DISTINCT FROM v_definition THEN
      EXECUTE v_rewritten;
    END IF;
  END LOOP;
END
$auth_view_replacements$;

RESET ROLE;
GRANT privacy_workflow_owner TO privacy_auth_bridge;
REVOKE ALL PRIVILEGES ON SCHEMA auth FROM privacy_workflow_owner;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth FROM privacy_workflow_owner;
ALTER FUNCTION public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.create_admin_transactional_notification(uuid,uuid,text,text,text,jsonb) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.create_review_like_notification(uuid,uuid,uuid) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.finalize_account_deletion_auth(uuid,uuid,uuid,text,text,text,uuid,text) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.hold_privacy_onboarding_compensation(uuid,uuid,text,text) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.make_user_admin(text) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.preflight_release_auth_session_family(uuid,uuid,uuid,text,bigint) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.prepare_account_deletion_external_egress(uuid,uuid,uuid,text,text,text,text,uuid) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.preview_account_deletion(uuid,uuid,timestamptz) OWNER TO privacy_auth_bridge;
ALTER FUNCTION privacy_retention.g014_account_deletion_reconcile_expired_attempt(uuid,text,uuid) OWNER TO privacy_auth_bridge;
ALTER FUNCTION privacy_retention.g014_retention_append_audit(privacy_retention.privacy_retention_runs,text,text) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.read_account_deletion_external_job(uuid,uuid,uuid,text,text,text,text,uuid) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.read_release_auth_revocation(uuid,uuid,uuid) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.read_release_auth_revocation_by_operation(uuid) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.reconcile_account_deletion_auth_job(uuid,uuid,uuid,text,text,text,uuid) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.revoke_release_auth_session_family(uuid,uuid,uuid,text) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.run_account_deletion_session_family_cleanup(uuid,uuid,uuid,text,text,text,uuid) OWNER TO privacy_auth_bridge;
ALTER FUNCTION privacy_retention.g014_account_deletion_apply_adapter(text,uuid,uuid) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.apply_account_deletion_database_cleanup(uuid,uuid,uuid,text,text,text) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.activate_account_deletion_policy(text,text) OWNER TO privacy_auth_bridge;
ALTER FUNCTION public.evaluate_notification_marketing_permission(uuid,text,timestamptz,text) OWNER TO privacy_auth_bridge;


DO $readback$
DECLARE
  v_bridge oid := 'privacy_auth_bridge'::regrole;
  v_owner oid := 'privacy_workflow_owner'::regrole;
  v_actor oid := pg_catalog.to_regrole(session_user);
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'privacy_auth_bridge' AND (rolcanlogin OR rolbypassrls))
     OR NOT pg_catalog.has_table_privilege('privacy_auth_bridge','privacy_retention.g041_auth_users','SELECT')
     OR NOT pg_catalog.has_table_privilege('privacy_auth_bridge','privacy_retention.g041_auth_sessions','SELECT,DELETE')
     OR NOT pg_catalog.has_table_privilege('privacy_auth_bridge','privacy_retention.g041_auth_identities','SELECT')
     OR NOT pg_catalog.has_table_privilege('privacy_auth_bridge','privacy_retention.g041_auth_refresh_tokens','SELECT,DELETE')
     OR pg_catalog.has_schema_privilege('privacy_workflow_owner','auth','USAGE')
     OR pg_catalog.has_schema_privilege('privacy_auth_bridge','auth','USAGE')
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_namespace AS namespace
       CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))) AS acl
       WHERE namespace.oid = 'auth'::pg_catalog.regnamespace
         AND acl.grantee IN (v_owner, v_bridge)
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class AS relation
       CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))) AS acl
       WHERE relation.oid IN (
         'auth.users'::pg_catalog.regclass,
         'auth.sessions'::pg_catalog.regclass,
         'auth.identities'::pg_catalog.regclass,
         'auth.refresh_tokens'::pg_catalog.regclass
       )
         AND acl.grantee IN (v_owner, v_bridge)
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute AS attribute
       CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
       WHERE attribute.attrelid IN (
         'auth.users'::pg_catalog.regclass,
         'auth.sessions'::pg_catalog.regclass,
         'auth.identities'::pg_catalog.regclass,
         'auth.refresh_tokens'::pg_catalog.regclass
       )
         AND attribute.attacl IS NOT NULL
         AND acl.grantee IN (v_owner, v_bridge)
     )
     OR (SELECT count(*)
         FROM pg_catalog.pg_class AS relation
         WHERE relation.oid = ANY (ARRAY[
           'privacy_retention.g041_auth_users'::pg_catalog.regclass,
           'privacy_retention.g041_auth_sessions'::pg_catalog.regclass,
           'privacy_retention.g041_auth_identities'::pg_catalog.regclass,
           'privacy_retention.g041_auth_refresh_tokens'::pg_catalog.regclass
         ])
           AND relation.relkind = 'v'
           AND relation.relowner = v_actor
           AND relation.reloptions @> ARRAY['security_barrier=true']) <> 4
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc AS procedure
       WHERE procedure.proowner IN (v_owner, v_bridge)
         AND procedure.oid <> 'privacy_retention.assert_g014_catalog_contract()'::pg_catalog.regprocedure
         AND procedure.prosrc ~ '\mauth\.(uid|users|sessions|identities|refresh_tokens)\M'
     ) THEN
    RAISE EXCEPTION 'g041_auth_workflow_bridge_acl_invalid';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc WHERE proowner=v_bridge AND oid = ANY (ARRAY[
    'public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)'::regprocedure,
    'public.create_admin_transactional_notification(uuid,uuid,text,text,text,jsonb)'::regprocedure,
    'public.create_review_like_notification(uuid,uuid,uuid)'::regprocedure,
    'public.finalize_account_deletion_auth(uuid,uuid,uuid,text,text,text,uuid,text)'::regprocedure,
    'public.hold_privacy_onboarding_compensation(uuid,uuid,text,text)'::regprocedure,
    'public.make_user_admin(text)'::regprocedure,
    'public.preflight_release_auth_session_family(uuid,uuid,uuid,text,bigint)'::regprocedure,
    'public.prepare_account_deletion_external_egress(uuid,uuid,uuid,text,text,text,text,uuid)'::regprocedure,
    'public.preview_account_deletion(uuid,uuid,timestamptz)'::regprocedure,
    'privacy_retention.g014_account_deletion_reconcile_expired_attempt(uuid,text,uuid)'::regprocedure,
    'privacy_retention.g014_retention_append_audit(privacy_retention.privacy_retention_runs,text,text)'::regprocedure,
    'public.read_account_deletion_external_job(uuid,uuid,uuid,text,text,text,text,uuid)'::regprocedure,
    'public.read_release_auth_revocation(uuid,uuid,uuid)'::regprocedure,
    'public.read_release_auth_revocation_by_operation(uuid)'::regprocedure,
    'public.reconcile_account_deletion_auth_job(uuid,uuid,uuid,text,text,text,uuid)'::regprocedure,
    'public.revoke_release_auth_session_family(uuid,uuid,uuid,text)'::regprocedure,
    'public.run_account_deletion_session_family_cleanup(uuid,uuid,uuid,text,text,text,uuid)'::regprocedure,
    'privacy_retention.g014_account_deletion_apply_adapter(text,uuid,uuid)'::regprocedure,
    'public.apply_account_deletion_database_cleanup(uuid,uuid,uuid,text,text,text)'::regprocedure,
    'public.activate_account_deletion_policy(text,text)'::regprocedure,
    'public.evaluate_notification_marketing_permission(uuid,text,timestamptz,text)'::regprocedure])) <> 21 THEN
    RAISE EXCEPTION 'g041_auth_workflow_bridge_replacement_coverage_invalid';
  END IF;
END $readback$;
RESET ROLE;
DO $bridge_membership_restore$
BEGIN
  EXECUTE pg_catalog.format('REVOKE privacy_auth_bridge FROM %I', session_user);
END
$bridge_membership_restore$;
DO $membership_restore$
BEGIN
  IF pg_catalog.current_setting('g041_bridge.restore_owner_set_false', true) = 'true' THEN
    EXECUTE pg_catalog.format('GRANT privacy_workflow_owner TO %I WITH SET FALSE', session_user);
  ELSIF pg_catalog.current_setting('g041_bridge.remove_owner_membership', true) = 'true' THEN
    EXECUTE pg_catalog.format('REVOKE privacy_workflow_owner FROM %I', session_user);
  END IF;
END $membership_restore$;

NOTIFY pgrst, 'reload schema';
COMMIT;
