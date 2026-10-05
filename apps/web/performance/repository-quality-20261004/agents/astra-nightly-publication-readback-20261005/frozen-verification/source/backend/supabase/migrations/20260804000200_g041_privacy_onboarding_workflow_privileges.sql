-- Restore the workflow-owner table privileges required by the password onboarding RPCs.
-- Browser and Data API roles retain no direct access to the private workflow tables.

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regrole('privacy_workflow_owner') IS NULL THEN
    RAISE EXCEPTION 'g041_privacy_workflow_owner_missing';
  END IF;
  IF pg_catalog.to_regclass('privacy_retention.privacy_onboarding_challenges') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.privacy_age_profiles') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.privacy_consent_events') IS NULL THEN
    RAISE EXCEPTION 'g041_privacy_onboarding_table_missing';
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
    PERFORM pg_catalog.set_config('g041_onboarding.remove_membership', 'true', true);
    PERFORM pg_catalog.set_config('g041_onboarding.restore_set_false', 'false', true);
  ELSIF v_supports_set_option AND NOT v_set_option THEN
    EXECUTE pg_catalog.format('GRANT privacy_workflow_owner TO %I WITH SET TRUE', session_user);
    PERFORM pg_catalog.set_config('g041_onboarding.remove_membership', 'false', true);
    PERFORM pg_catalog.set_config('g041_onboarding.restore_set_false', 'true', true);
  ELSE
    PERFORM pg_catalog.set_config('g041_onboarding.remove_membership', 'false', true);
    PERFORM pg_catalog.set_config('g041_onboarding.restore_set_false', 'false', true);
  END IF;
END
$membership$;

SET LOCAL ROLE privacy_workflow_owner;

GRANT INSERT, UPDATE ON TABLE privacy_retention.privacy_onboarding_challenges
  TO privacy_workflow_owner;
GRANT INSERT, UPDATE ON TABLE privacy_retention.privacy_age_profiles
  TO privacy_workflow_owner;
GRANT INSERT ON TABLE privacy_retention.privacy_consent_events
  TO privacy_workflow_owner;

REVOKE ALL ON TABLE
  privacy_retention.privacy_onboarding_challenges,
  privacy_retention.privacy_age_profiles,
  privacy_retention.privacy_consent_events
FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO privacy_retention.g014_catalog_contract_manifest (
  manifest_kind,
  manifest_key,
  manifest_value
)
SELECT rows.manifest_kind, rows.manifest_key, rows.manifest_value
FROM privacy_retention.g014_catalog_manifest_rows() AS rows
WHERE rows.manifest_kind = 'grant'
  AND rows.manifest_key IN (
    pg_catalog.jsonb_build_object(
      'schema', 'privacy_retention', 'grantee', 'privacy_workflow_owner',
      'grantor', 'privacy_workflow_owner', 'relation', 'privacy_onboarding_challenges',
      'privilege', 'INSERT'
    ),
    pg_catalog.jsonb_build_object(
      'schema', 'privacy_retention', 'grantee', 'privacy_workflow_owner',
      'grantor', 'privacy_workflow_owner', 'relation', 'privacy_onboarding_challenges',
      'privilege', 'UPDATE'
    ),
    pg_catalog.jsonb_build_object(
      'schema', 'privacy_retention', 'grantee', 'privacy_workflow_owner',
      'grantor', 'privacy_workflow_owner', 'relation', 'privacy_age_profiles',
      'privilege', 'INSERT'
    ),
    pg_catalog.jsonb_build_object(
      'schema', 'privacy_retention', 'grantee', 'privacy_workflow_owner',
      'grantor', 'privacy_workflow_owner', 'relation', 'privacy_age_profiles',
      'privilege', 'UPDATE'
    ),
    pg_catalog.jsonb_build_object(
      'schema', 'privacy_retention', 'grantee', 'privacy_workflow_owner',
      'grantor', 'privacy_workflow_owner', 'relation', 'privacy_consent_events',
      'privilege', 'INSERT'
    )
  )
ON CONFLICT (manifest_kind, manifest_key) DO NOTHING;

RESET ROLE;

DO $readback$
DECLARE
  v_role name;
BEGIN
  IF NOT pg_catalog.has_table_privilege('privacy_workflow_owner', 'privacy_retention.privacy_onboarding_challenges', 'INSERT, UPDATE')
     OR NOT pg_catalog.has_table_privilege('privacy_workflow_owner', 'privacy_retention.privacy_age_profiles', 'INSERT, UPDATE')
     OR NOT pg_catalog.has_table_privilege('privacy_workflow_owner', 'privacy_retention.privacy_consent_events', 'INSERT') THEN
    RAISE EXCEPTION 'g041_privacy_onboarding_workflow_privilege_missing';
  END IF;

  FOREACH v_role IN ARRAY ARRAY['anon'::name, 'authenticated'::name, 'service_role'::name] LOOP
    IF pg_catalog.has_table_privilege(v_role, 'privacy_retention.privacy_onboarding_challenges', 'SELECT, INSERT, UPDATE, DELETE')
       OR pg_catalog.has_table_privilege(v_role, 'privacy_retention.privacy_age_profiles', 'SELECT, INSERT, UPDATE, DELETE')
       OR pg_catalog.has_table_privilege(v_role, 'privacy_retention.privacy_consent_events', 'SELECT, INSERT, UPDATE, DELETE') THEN
      RAISE EXCEPTION 'g041_privacy_onboarding_api_role_privilege_detected: %', v_role;
    END IF;
  END LOOP;

  IF (
    SELECT pg_catalog.count(*)
    FROM privacy_retention.g014_catalog_contract_manifest AS manifest
    WHERE manifest.manifest_kind = 'grant'
      AND manifest.manifest_key ->> 'schema' = 'privacy_retention'
      AND manifest.manifest_key ->> 'grantee' = 'privacy_workflow_owner'
      AND (
        (manifest.manifest_key ->> 'relation' = 'privacy_onboarding_challenges' AND manifest.manifest_key ->> 'privilege' IN ('INSERT', 'UPDATE'))
        OR (manifest.manifest_key ->> 'relation' = 'privacy_age_profiles' AND manifest.manifest_key ->> 'privilege' IN ('INSERT', 'UPDATE'))
        OR (manifest.manifest_key ->> 'relation' = 'privacy_consent_events' AND manifest.manifest_key ->> 'privilege' = 'INSERT')
      )
  ) <> 5 THEN
    RAISE EXCEPTION 'g041_privacy_onboarding_grant_manifest_missing';
  END IF;
END
$readback$;

DO $membership$
BEGIN
  IF pg_catalog.current_setting('g041_onboarding.restore_set_false', true) = 'true' THEN
    EXECUTE pg_catalog.format('GRANT privacy_workflow_owner TO %I WITH SET FALSE', session_user);
  ELSIF pg_catalog.current_setting('g041_onboarding.remove_membership', true) = 'true' THEN
    EXECUTE pg_catalog.format('REVOKE privacy_workflow_owner FROM %I', session_user);
  END IF;
END
$membership$;

COMMIT;
