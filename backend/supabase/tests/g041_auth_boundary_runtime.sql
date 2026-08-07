BEGIN;

-- This runs as the migration/test administrator. Calls switch to the actual
-- authenticated caller; the target functions execute as privacy_workflow_owner.
DO $setup$
DECLARE
  v_ordinary uuid := '41000000-0000-4000-8000-000000000001';
  v_dedicated uuid := '41000000-0000-4000-8000-000000000002';
BEGIN
  INSERT INTO auth.users (id, aud, role, email, encrypted_password, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  VALUES
    (v_ordinary, 'authenticated', 'authenticated', 'g041-ordinary@example.invalid', 'disabled', '{}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
    (v_dedicated, 'authenticated', 'authenticated', 'g041-dedicated@example.invalid', 'disabled', '{}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());
END
$setup$;

SET LOCAL ROLE authenticated;
DO $ordinary$
DECLARE
  v_ordinary uuid := '41000000-0000-4000-8000-000000000001';
  v_session uuid := '42000000-0000-4000-8000-000000000001';
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('role', 'authenticated', 'sub', v_ordinary::text, 'session_id', v_session::text)::text, true);
  IF public.is_current_auth_session_active() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'g041 ordinary identity did not pass';
  END IF;
END
$ordinary$;

RESET ROLE;
INSERT INTO public.release_auth_identities (user_id) VALUES ('41000000-0000-4000-8000-000000000002');
SET LOCAL ROLE authenticated;
DO $missing_lease$
DECLARE
  v_dedicated uuid := '41000000-0000-4000-8000-000000000002';
  v_session uuid := '42000000-0000-4000-8000-000000000001';
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('role', 'authenticated', 'sub', v_dedicated::text, 'session_id', v_session::text)::text, true);
  IF public.is_current_auth_session_active() IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'g041 dedicated identity without lease did not fail closed';
  END IF;
END
$missing_lease$;

RESET ROLE;
INSERT INTO public.release_auth_session_leases (operation_id, user_id, session_id, refresh_sha256, expires_at)
VALUES ('43000000-0000-4000-8000-000000000002', '41000000-0000-4000-8000-000000000001', '42000000-0000-4000-8000-000000000001', repeat('1', 64), pg_catalog.clock_timestamp() + interval '5 minutes');
SET LOCAL ROLE authenticated;
DO $wrong_user_lease$
DECLARE
  v_dedicated uuid := '41000000-0000-4000-8000-000000000002';
  v_session uuid := '42000000-0000-4000-8000-000000000001';
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('role', 'authenticated', 'sub', v_dedicated::text, 'session_id', v_session::text)::text, true);
  IF public.is_current_auth_session_active() IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'g041 wrong-user lease did not fail closed';
  END IF;
END
$wrong_user_lease$;

RESET ROLE;
DELETE FROM public.release_auth_session_leases
WHERE operation_id = '43000000-0000-4000-8000-000000000002';

RESET ROLE;
INSERT INTO public.release_auth_session_leases (operation_id, user_id, session_id, refresh_sha256, expires_at)
VALUES ('43000000-0000-4000-8000-000000000001', '41000000-0000-4000-8000-000000000002', '42000000-0000-4000-8000-000000000001', repeat('0', 64), pg_catalog.clock_timestamp() + interval '5 minutes');
SET LOCAL ROLE authenticated;
DO $live_and_wrong_session$
DECLARE
  v_dedicated uuid := '41000000-0000-4000-8000-000000000002';
  v_live_session uuid := '42000000-0000-4000-8000-000000000001';
  v_other_session uuid := '42000000-0000-4000-8000-000000000002';
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('role', 'authenticated', 'sub', v_dedicated::text, 'session_id', v_live_session::text)::text, true);
  IF public.is_current_auth_session_active() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'g041 exact live lease did not pass';
  END IF;
  PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('role', 'authenticated', 'sub', v_dedicated::text, 'session_id', v_other_session::text)::text, true);
  IF public.is_current_auth_session_active() IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'g041 wrong session did not fail closed';
  END IF;
END
$live_and_wrong_session$;

RESET ROLE;
UPDATE public.release_auth_session_leases
SET expires_at = pg_catalog.clock_timestamp() - interval '1 second'
WHERE operation_id = '43000000-0000-4000-8000-000000000001';
SET LOCAL ROLE authenticated;
DO $expired_lease$
DECLARE
  v_dedicated uuid := '41000000-0000-4000-8000-000000000002';
  v_session uuid := '42000000-0000-4000-8000-000000000001';
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('role', 'authenticated', 'sub', v_dedicated::text, 'session_id', v_session::text)::text, true);
  IF public.is_current_auth_session_active() IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'g041 expired lease did not fail closed';
  END IF;
END
$expired_lease$;

RESET ROLE;
DO $membership$
DECLARE
  v_supports_set_option boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'pg_catalog.pg_auth_members'::pg_catalog.regclass
      AND attribute.attname = 'set_option'
      AND NOT attribute.attisdropped
  ) INTO v_supports_set_option;
  IF v_supports_set_option THEN
    EXECUTE pg_catalog.format('GRANT privacy_workflow_owner TO %I WITH SET TRUE', session_user);
  ELSIF NOT pg_catalog.pg_has_role(session_user, 'privacy_workflow_owner', 'MEMBER') THEN
    EXECUTE pg_catalog.format('GRANT privacy_workflow_owner TO %I', session_user);
  END IF;
END
$membership$;
SET LOCAL ROLE privacy_workflow_owner;
DO $owner_visibility$
DECLARE
  v_dedicated uuid := '41000000-0000-4000-8000-000000000002';
  v_live_session uuid := '42000000-0000-4000-8000-000000000001';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.release_auth_identities WHERE user_id = v_dedicated) THEN
    RAISE EXCEPTION 'g041 owner RLS cannot see dedicated identity';
  END IF;
  PERFORM 1 FROM public.release_auth_session_leases WHERE user_id = v_dedicated AND session_id = v_live_session FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'g041 owner RLS cannot lock exact lease';
  END IF;
  BEGIN
    UPDATE public.release_auth_session_leases SET expires_at = pg_catalog.clock_timestamp() WHERE user_id = v_dedicated;
    RAISE EXCEPTION 'g041 sensitive lease update unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$owner_visibility$;

RESET ROLE;
DO $catalog$
DECLARE
  v_owner oid := 'privacy_workflow_owner'::pg_catalog.regrole;
BEGIN
  IF (SELECT procedure.proowner FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = 'public.is_current_auth_session_active()'::pg_catalog.regprocedure) <> v_owner
     OR NOT (SELECT procedure.prosecdef FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = 'public.is_current_auth_session_active()'::pg_catalog.regprocedure)
     OR pg_catalog.has_schema_privilege('privacy_workflow_owner', 'auth', 'USAGE')
     OR pg_catalog.has_table_privilege('privacy_workflow_owner', 'auth.users', 'SELECT')
     OR pg_catalog.has_table_privilege('privacy_workflow_owner', 'auth.sessions', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR pg_catalog.has_table_privilege('privacy_workflow_owner', 'auth.identities', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR pg_catalog.has_table_privilege('privacy_workflow_owner', 'auth.refresh_tokens', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR pg_catalog.has_column_privilege('privacy_workflow_owner', 'auth.users', 'id', 'SELECT')
     OR pg_catalog.has_column_privilege('privacy_workflow_owner', 'auth.users', 'last_sign_in_at', 'SELECT')
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_namespace AS namespace
       CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))) AS acl
       WHERE namespace.oid = 'auth'::pg_catalog.regnamespace
         AND acl.grantee = v_owner
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class AS relation
       CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))) AS acl
       WHERE relation.oid IN ('auth.users'::pg_catalog.regclass, 'auth.sessions'::pg_catalog.regclass, 'auth.identities'::pg_catalog.regclass, 'auth.refresh_tokens'::pg_catalog.regclass)
         AND acl.grantee = v_owner
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute AS attribute
       CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
       WHERE attribute.attrelid = 'auth.users'::pg_catalog.regclass
         AND attribute.attname IN ('id', 'last_sign_in_at')
         AND NOT attribute.attisdropped
         AND attribute.attacl IS NOT NULL
         AND acl.grantee = v_owner
     ) THEN
    RAISE EXCEPTION 'g041 caller-definer or auth ACL contract failed';
  END IF;
END
$catalog$;

-- Signed-claim parsing must fail closed before any workflow can act.
SET LOCAL ROLE authenticated;
DO $claims$
DECLARE
  v_other uuid := '41000000-0000-4000-8000-000000000002';
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims', '{}'::jsonb::text, true);
  IF public.get_current_auth_session_id() IS NOT NULL OR public.is_current_auth_session_active() IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'g041 missing claims did not fail closed';
  END IF;
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"not-a-uuid","session_id":"not-a-uuid"}', true);
  IF public.get_current_auth_session_id() IS NOT NULL OR public.is_current_auth_session_active() IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'g041 malformed claims did not fail closed';
  END IF;
  PERFORM pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('role','authenticated','sub',v_other::text)::text, true);
  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id <> v_other)
     OR EXISTS (SELECT 1 FROM public.user_account_status WHERE user_id <> v_other) THEN
    RAISE EXCEPTION 'g041 cross-user authenticated read succeeded';
  END IF;
  BEGIN
    UPDATE public.user_roles SET role = role WHERE user_id = v_other;
    RAISE EXCEPTION 'g041 user_roles mutation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    UPDATE public.user_account_status SET account_status = account_status WHERE user_id = v_other;
    RAISE EXCEPTION 'g041 user_account_status mutation unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END
$claims$;
RESET ROLE;

-- These are non-destructive boundary probes: invalid inputs must reach each
-- SECURITY DEFINER workflow without an Auth permission-denied regression.
SET LOCAL ROLE authenticated;
DO $workflow_boundary$
BEGIN
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN PERFORM public.get_current_account_deletion_status();
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE EXCEPTION 'g041 account-deletion status auth permission denied';
  WHEN others THEN NULL; END;
END
$workflow_boundary$;
RESET ROLE;
ROLLBACK;
