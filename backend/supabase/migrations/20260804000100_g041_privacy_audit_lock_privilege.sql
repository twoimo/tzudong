-- Restore the workflow owner's UPDATE table privilege used only for row locks.
-- The audit ledger remains append-only: the immutable-row trigger still rejects
-- every actual UPDATE or DELETE, and no API role receives direct table access.

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regrole('privacy_workflow_owner') IS NULL THEN
    RAISE EXCEPTION 'g041_privacy_workflow_owner_missing';
  END IF;
  IF pg_catalog.to_regclass('privacy_retention.privacy_audit_events') IS NULL THEN
    RAISE EXCEPTION 'g041_privacy_audit_events_missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = 'privacy_retention.privacy_audit_events'::pg_catalog.regclass
      AND tgname = 'g014_privacy_audit_events_append_only'
      AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'g041_privacy_audit_immutability_trigger_missing';
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
    EXECUTE
      'SELECT membership.set_option FROM pg_catalog.pg_auth_members AS membership '
      || 'WHERE membership.roleid = ''privacy_workflow_owner''::pg_catalog.regrole '
      || 'AND membership.member = pg_catalog.to_regrole(session_user)'
    INTO v_set_option;
  END IF;

  IF NOT v_membership_exists THEN
    EXECUTE pg_catalog.format(
      CASE WHEN v_supports_set_option
        THEN 'GRANT privacy_workflow_owner TO %I WITH SET TRUE'
        ELSE 'GRANT privacy_workflow_owner TO %I'
      END,
      session_user
    );
    PERFORM pg_catalog.set_config('g041.remove_membership', 'true', true);
    PERFORM pg_catalog.set_config('g041.restore_set_false', 'false', true);
  ELSIF v_supports_set_option AND NOT v_set_option THEN
    EXECUTE pg_catalog.format(
      'GRANT privacy_workflow_owner TO %I WITH SET TRUE',
      session_user
    );
    PERFORM pg_catalog.set_config('g041.remove_membership', 'false', true);
    PERFORM pg_catalog.set_config('g041.restore_set_false', 'true', true);
  ELSE
    PERFORM pg_catalog.set_config('g041.remove_membership', 'false', true);
    PERFORM pg_catalog.set_config('g041.restore_set_false', 'false', true);
  END IF;
END
$membership$;

SET LOCAL ROLE privacy_workflow_owner;

GRANT UPDATE ON TABLE privacy_retention.privacy_audit_events
  TO privacy_workflow_owner;

REVOKE ALL ON TABLE privacy_retention.privacy_audit_events
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
    'relation', 'privacy_audit_events',
    'privilege', 'UPDATE'
  )
ON CONFLICT (manifest_kind, manifest_key) DO NOTHING;

RESET ROLE;

DO $readback$
BEGIN
  IF NOT pg_catalog.has_table_privilege(
    'privacy_workflow_owner',
    'privacy_retention.privacy_audit_events',
    'UPDATE'
  ) THEN
    RAISE EXCEPTION 'g041_privacy_audit_update_lock_privilege_missing';
  END IF;
  IF pg_catalog.has_table_privilege(
    'service_role',
    'privacy_retention.privacy_audit_events',
    'UPDATE'
  ) THEN
    RAISE EXCEPTION 'g041_service_role_direct_update_privilege_detected';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM privacy_retention.g014_catalog_contract_manifest AS manifest
    WHERE manifest.manifest_kind = 'grant'
      AND manifest.manifest_key = pg_catalog.jsonb_build_object(
        'schema', 'privacy_retention',
        'grantee', 'privacy_workflow_owner',
        'grantor', 'privacy_workflow_owner',
        'relation', 'privacy_audit_events',
        'privilege', 'UPDATE'
      )
  ) THEN
    RAISE EXCEPTION 'g041_privacy_audit_update_manifest_missing';
  END IF;
END
$readback$;

DO $membership$
BEGIN
  IF pg_catalog.current_setting('g041.restore_set_false', true) = 'true' THEN
    EXECUTE pg_catalog.format(
      'GRANT privacy_workflow_owner TO %I WITH SET FALSE',
      session_user
    );
  ELSIF pg_catalog.current_setting('g041.remove_membership', true) = 'true' THEN
    EXECUTE pg_catalog.format(
      'REVOKE privacy_workflow_owner FROM %I',
      session_user
    );
  END IF;
END
$membership$;

COMMIT;
