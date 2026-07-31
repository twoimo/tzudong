-- Restore the workflow owner's audited access to the FORCE-RLS audit ledger.
-- The owner role is NOLOGIN and is reached only by reviewed SECURITY DEFINER
-- functions. No browser, API, or service role receives table privileges here.

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regrole('privacy_workflow_owner') IS NULL THEN
    RAISE EXCEPTION 'g016_privacy_workflow_owner_missing';
  END IF;
  IF pg_catalog.to_regclass('privacy_retention.privacy_audit_events') IS NULL THEN
    RAISE EXCEPTION 'g016_privacy_audit_events_missing';
  END IF;
END
$preflight$;

-- Hosted Supabase's postgres role can assume supabase_admin but is intentionally
-- not a direct member of application-owned NOLOGIN roles.
SET LOCAL ROLE supabase_admin;

DO $membership$
BEGIN
  IF NOT pg_catalog.pg_has_role(
    session_user,
    'privacy_workflow_owner',
    'MEMBER'
  ) THEN
    EXECUTE pg_catalog.format(
      'GRANT privacy_workflow_owner TO %I',
      session_user
    );
    PERFORM pg_catalog.set_config('g016.temporary_membership', 'true', true);
  ELSE
    PERFORM pg_catalog.set_config('g016.temporary_membership', 'false', true);
  END IF;
END
$membership$;
RESET ROLE;

SET LOCAL ROLE privacy_workflow_owner;

ALTER TABLE privacy_retention.privacy_audit_events
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_retention.privacy_audit_events
  FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS g016_privacy_workflow_owner_access
  ON privacy_retention.privacy_audit_events;
CREATE POLICY g016_privacy_workflow_owner_access
  ON privacy_retention.privacy_audit_events
  FOR ALL
  TO privacy_workflow_owner
  USING (true)
  WITH CHECK (true);

-- The catalog manifest is append-only. Append exactly the row produced by the
-- canonical catalog projector for this new policy so later drift checks remain
-- bidirectional and fail closed.
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
WHERE manifest_kind = 'policy'
  AND manifest_key = pg_catalog.jsonb_build_object(
    'schema', 'privacy_retention',
    'relation', 'privacy_audit_events',
    'policy', 'g016_privacy_workflow_owner_access'
  )
ON CONFLICT (manifest_kind, manifest_key) DO NOTHING;

-- Reassert the closed direct-ACL boundary after policy creation.
REVOKE ALL ON TABLE privacy_retention.privacy_audit_events
  FROM PUBLIC, anon, authenticated, service_role;

RESET ROLE;

SET LOCAL ROLE supabase_admin;
DO $membership$
BEGIN
  IF pg_catalog.current_setting('g016.temporary_membership', true) = 'true' THEN
    EXECUTE pg_catalog.format(
      'REVOKE privacy_workflow_owner FROM %I',
      session_user
    );
  END IF;
END
$membership$;
RESET ROLE;

COMMIT;
