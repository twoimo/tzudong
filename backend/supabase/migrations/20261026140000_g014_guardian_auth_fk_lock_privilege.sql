-- Auth DELETE runs RESTRICT FK checks against this child relation using its
-- owner. The internal SELECT ... FOR KEY SHARE needs UPDATE even with no rows.
-- Keep the G014 zero-column-ACL baseline: UPDATE(id) is not contract-compatible.
-- Grant only the existing NOLOGIN workflow owner, as in the G041 lock repairs;
-- retain owner, FORCE RLS, FK/retention guards and the direct API denial boundary.

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regrole('privacy_workflow_owner') IS NULL THEN
    RAISE EXCEPTION 'g014_guardian_fk_owner_missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='privacy_workflow_owner'
                 AND NOT rolcanlogin AND NOT rolsuper AND NOT rolinherit AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'g014_guardian_fk_owner_attributes_drift';
  END IF;
  IF pg_catalog.to_regclass('privacy_retention.privacy_guardian_verifications') IS NULL THEN
    RAISE EXCEPTION 'g014_guardian_fk_relation_missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = 'privacy_retention.privacy_guardian_verifications'::regclass
      AND relation.relowner = 'privacy_workflow_owner'::regrole
      AND relation.relrowsecurity AND relation.relforcerowsecurity
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS fk
    WHERE fk.conrelid = 'privacy_retention.privacy_guardian_verifications'::regclass
      AND fk.confrelid = (
        SELECT parent.oid
        FROM pg_catalog.pg_class AS parent
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid=parent.relnamespace
        WHERE namespace.nspname='auth' AND parent.relname='users'
          AND parent.relkind IN ('r','p')
      )
      AND fk.conname = 'privacy_guardian_verifications_child_user_id_fkey'
      AND fk.contype = 'f' AND fk.confdeltype = 'r' AND fk.convalidated
  ) THEN
    RAISE EXCEPTION 'g014_guardian_fk_boundary_missing';
  END IF;
  -- Preserve the source-declared zero-column-ACL contract. UPDATE(id) can
  -- satisfy row locking, but would fail assert_g014_catalog_security_baseline().
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
    WHERE attribute.attrelid = 'privacy_retention.privacy_guardian_verifications'::regclass
      AND attribute.attnum > 0 AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'g014_guardian_fk_column_acl_drift';
  END IF;
END
$preflight$;

DO $membership$
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
    -- PG17 can have several grantors for the same role/member. Lease and
    -- restore only this executor's row; never alter a bootstrap grantor's row.
    EXECUTE
      'SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members AS membership '
      || 'WHERE membership.roleid = ''privacy_workflow_owner''::pg_catalog.regrole '
      || 'AND membership.member = pg_catalog.to_regrole(session_user) '
      || 'AND membership.grantor = pg_catalog.to_regrole(session_user))'
    INTO v_membership_exists;
    IF v_membership_exists THEN
      EXECUTE
        'SELECT membership.set_option FROM pg_catalog.pg_auth_members AS membership '
        || 'WHERE membership.roleid = ''privacy_workflow_owner''::pg_catalog.regrole '
        || 'AND membership.member = pg_catalog.to_regrole(session_user) '
        || 'AND membership.grantor = pg_catalog.to_regrole(session_user)'
      INTO v_set_option;
    END IF;
  END IF;

  IF NOT v_membership_exists THEN
    EXECUTE pg_catalog.format(
      CASE WHEN v_supports_set_option
        THEN 'GRANT privacy_workflow_owner TO %I WITH SET TRUE GRANTED BY %I'
        ELSE 'GRANT privacy_workflow_owner TO %I'
      END,
      session_user, session_user
    );
    PERFORM pg_catalog.set_config('g014_guardian_fk.remove_membership', 'true', true);
    PERFORM pg_catalog.set_config('g014_guardian_fk.restore_set_false', 'false', true);
  ELSIF v_supports_set_option AND NOT v_set_option THEN
    EXECUTE pg_catalog.format(
      'GRANT privacy_workflow_owner TO %I WITH SET TRUE GRANTED BY %I',
      session_user, session_user
    );
    PERFORM pg_catalog.set_config('g014_guardian_fk.remove_membership', 'false', true);
    PERFORM pg_catalog.set_config('g014_guardian_fk.restore_set_false', 'true', true);
  ELSE
    PERFORM pg_catalog.set_config('g014_guardian_fk.remove_membership', 'false', true);
    PERFORM pg_catalog.set_config('g014_guardian_fk.restore_set_false', 'false', true);
  END IF;
END
$membership$;

SET LOCAL ROLE privacy_workflow_owner;

GRANT UPDATE ON TABLE privacy_retention.privacy_guardian_verifications
  TO privacy_workflow_owner;

REVOKE ALL ON TABLE privacy_retention.privacy_guardian_verifications
  FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO privacy_retention.g014_catalog_contract_manifest (
  manifest_kind,
  manifest_key,
  manifest_value
)
SELECT
  manifest_kind,
  manifest_key,
  manifest_value
FROM privacy_retention.g014_catalog_manifest_rows()
WHERE manifest_kind = 'grant'
  AND manifest_key = pg_catalog.jsonb_build_object(
    'schema', 'privacy_retention',
    'grantee', 'privacy_workflow_owner',
    'grantor', 'privacy_workflow_owner',
    'relation', 'privacy_guardian_verifications',
    'privilege', 'UPDATE'
  )
ON CONFLICT (manifest_kind, manifest_key) DO NOTHING;

RESET ROLE;

DO $readback$
BEGIN
  IF NOT pg_catalog.has_table_privilege(
    'privacy_workflow_owner',
    'privacy_retention.privacy_guardian_verifications',
    'UPDATE'
  ) THEN
    RAISE EXCEPTION 'g014_guardian_fk_update_lock_privilege_missing';
  END IF;
  IF pg_catalog.has_table_privilege(
    'service_role',
    'privacy_retention.privacy_guardian_verifications',
    'UPDATE'
  ) THEN
    RAISE EXCEPTION 'g014_guardian_fk_service_role_direct_update_privilege_detected';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(relation.relacl) AS acl
    WHERE relation.oid='privacy_retention.privacy_guardian_verifications'::regclass
      AND (acl.grantee=0 OR acl.grantee IN (SELECT oid FROM pg_catalog.pg_roles
                                           WHERE rolname IN ('anon','authenticated','service_role')))
  ) THEN
    RAISE EXCEPTION 'g014_guardian_fk_api_acl_drift';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM privacy_retention.g014_catalog_contract_manifest AS manifest
    WHERE manifest.manifest_kind = 'grant'
      AND manifest.manifest_key = pg_catalog.jsonb_build_object(
        'schema', 'privacy_retention',
        'grantee', 'privacy_workflow_owner',
        'grantor', 'privacy_workflow_owner',
        'relation', 'privacy_guardian_verifications',
        'privilege', 'UPDATE'
      )
  ) THEN
    RAISE EXCEPTION 'g014_guardian_fk_update_manifest_missing';
  END IF;
END
$readback$;

DO $membership$
BEGIN
  IF pg_catalog.current_setting('g014_guardian_fk.restore_set_false', true) = 'true' THEN
    EXECUTE pg_catalog.format(
      'GRANT privacy_workflow_owner TO %I WITH SET FALSE GRANTED BY %I',
      session_user, session_user
    );
  ELSIF pg_catalog.current_setting('g014_guardian_fk.remove_membership', true) = 'true' THEN
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute
               WHERE attrelid='pg_catalog.pg_auth_members'::regclass AND attname='set_option' AND NOT attisdropped) THEN
      EXECUTE pg_catalog.format('REVOKE privacy_workflow_owner FROM %I GRANTED BY %I', session_user, session_user);
    ELSE
      EXECUTE pg_catalog.format('REVOKE privacy_workflow_owner FROM %I', session_user);
    END IF;
  END IF;
END
$membership$;

COMMIT;
