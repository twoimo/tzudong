-- Close the live auth-boundary ACL/RLS state after g041 runtime repairs.
-- The workflow-owner guard only needs to read dedicated identity/lease rows and lock a lease.

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regrole('privacy_workflow_owner') IS NULL
     OR pg_catalog.to_regclass('public.release_auth_identities') IS NULL
     OR pg_catalog.to_regclass('public.release_auth_session_leases') IS NULL THEN
    RAISE EXCEPTION 'g041_auth_boundary_closure_prerequisite_missing';
  END IF;
END
$preflight$;

-- Undo every direct auth ACL introduced by g014 predecessors.  The SECURITY DEFINER
-- entry points retain their owners; this role never receives platform auth access.
REVOKE ALL PRIVILEGES ON SCHEMA auth FROM privacy_workflow_owner;
REVOKE ALL PRIVILEGES ON TABLE auth.users, auth.sessions, auth.identities, auth.refresh_tokens
  FROM privacy_workflow_owner;
REVOKE SELECT (id, last_sign_in_at) ON TABLE auth.users FROM privacy_workflow_owner;

DROP POLICY IF EXISTS g041_release_auth_identities_owner_select ON public.release_auth_identities;
DROP POLICY IF EXISTS g041_release_auth_session_leases_owner_select ON public.release_auth_session_leases;
DROP POLICY IF EXISTS g041_release_auth_session_leases_owner_update ON public.release_auth_session_leases;

CREATE POLICY g041_release_auth_identities_owner_select
  ON public.release_auth_identities
  FOR SELECT
  TO privacy_workflow_owner
  USING (true);

CREATE POLICY g041_release_auth_session_leases_owner_select
  ON public.release_auth_session_leases
  FOR SELECT
  TO privacy_workflow_owner
  USING (true);

CREATE POLICY g041_release_auth_session_leases_owner_update
  ON public.release_auth_session_leases
  FOR UPDATE
  TO privacy_workflow_owner
  USING (true)
  WITH CHECK (true);

REVOKE ALL PRIVILEGES ON TABLE public.release_auth_identities, public.release_auth_session_leases
  FROM privacy_workflow_owner;
GRANT SELECT ON TABLE public.release_auth_identities TO privacy_workflow_owner;
-- PostgreSQL requires an UPDATE privilege for SELECT ... FOR UPDATE.  Limiting it to
-- created_at permits that lock while column ACLs prohibit lease binding mutations.
GRANT SELECT, UPDATE (created_at) ON TABLE public.release_auth_session_leases
  TO privacy_workflow_owner;

DO $readback$
DECLARE
  v_owner oid := 'privacy_workflow_owner'::pg_catalog.regrole;
BEGIN
  IF pg_catalog.has_schema_privilege('privacy_workflow_owner', 'auth', 'USAGE')
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
    RAISE EXCEPTION 'g041_auth_direct_acl_remains';
  END IF;

  IF NOT pg_catalog.has_table_privilege('privacy_workflow_owner', 'public.release_auth_identities', 'SELECT')
     OR pg_catalog.has_table_privilege('privacy_workflow_owner', 'public.release_auth_identities', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR NOT pg_catalog.has_table_privilege('privacy_workflow_owner', 'public.release_auth_session_leases', 'SELECT')
     OR pg_catalog.has_table_privilege('privacy_workflow_owner', 'public.release_auth_session_leases', 'INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR NOT pg_catalog.has_column_privilege('privacy_workflow_owner', 'public.release_auth_session_leases', 'created_at', 'UPDATE')
     OR pg_catalog.has_column_privilege('privacy_workflow_owner', 'public.release_auth_session_leases', 'operation_id', 'UPDATE')
     OR pg_catalog.has_column_privilege('privacy_workflow_owner', 'public.release_auth_session_leases', 'user_id', 'UPDATE')
     OR pg_catalog.has_column_privilege('privacy_workflow_owner', 'public.release_auth_session_leases', 'session_id', 'UPDATE')
     OR pg_catalog.has_column_privilege('privacy_workflow_owner', 'public.release_auth_session_leases', 'refresh_sha256', 'UPDATE')
     OR pg_catalog.has_column_privilege('privacy_workflow_owner', 'public.release_auth_session_leases', 'expires_at', 'UPDATE') THEN
    RAISE EXCEPTION 'g041_release_auth_guard_grant_invalid';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_policy AS policy
      WHERE policy.polrelid = 'public.release_auth_identities'::pg_catalog.regclass
        AND policy.polname = 'g041_release_auth_identities_owner_select'
        AND policy.polcmd = 'r'
        AND policy.polroles = ARRAY[v_owner]
        AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) = 'true'
        AND policy.polwithcheck IS NULL) <> 1
     OR (SELECT count(*) FROM pg_catalog.pg_policy AS policy
         WHERE policy.polrelid = 'public.release_auth_session_leases'::pg_catalog.regclass
           AND policy.polname = 'g041_release_auth_session_leases_owner_select'
           AND policy.polcmd = 'r'
           AND policy.polroles = ARRAY[v_owner]
           AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) = 'true'
           AND policy.polwithcheck IS NULL) <> 1
     OR (SELECT count(*) FROM pg_catalog.pg_policy AS policy
         WHERE policy.polrelid = 'public.release_auth_session_leases'::pg_catalog.regclass
           AND policy.polname = 'g041_release_auth_session_leases_owner_update'
           AND policy.polcmd = 'w'
           AND policy.polroles = ARRAY[v_owner]
           AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) = 'true'
           AND pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) = 'true') <> 1
     OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_policy AS policy
       WHERE policy.polrelid = 'public.release_auth_session_leases'::pg_catalog.regclass
         AND policy.polroles = ARRAY[v_owner]
         AND policy.polcmd IN ('a', 'd', '*')
     ) THEN
    RAISE EXCEPTION 'g041_release_auth_guard_rls_invalid';
  END IF;
END
$readback$;

NOTIFY pgrst, 'reload schema';
COMMIT;
