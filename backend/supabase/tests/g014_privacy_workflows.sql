\set ON_ERROR_STOP on

BEGIN;

DO $catalog_contract$
DECLARE
  v_signature text;
  v_oid oid;
  v_search_path text;
  v_candidate record;
BEGIN
  FOR v_signature IN
    SELECT signature
    FROM (VALUES
      ('public.append_privacy_audit_event(text,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb)'),
      ('public.publish_privacy_policy_version(text,text,text,timestamptz,uuid,text,text)'),
      ('public.transition_privacy_onboarding_challenge(uuid,text,text,uuid,text)'),
      ('public.submit_guardian_privacy_consent(text,text,text,uuid,text,uuid,text,uuid)'),
      ('public.get_current_privacy_policy_version()'),
      ('public.create_privacy_onboarding_challenge(text,uuid,text,jsonb,text,timestamptz)'),
      ('public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)'),
      ('public.submit_privacy_consent(text,text,text,uuid,text,text,uuid,text,uuid)'),
      ('public.privacy_append_audit_event(text,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb)'),
      ('public.record_privacy_guardian_verification(uuid,uuid,text,text,text,timestamptz,timestamptz)'),
      ('public.privacy_under_14_is_eligible(uuid,uuid)'),
      ('public.read_privacy_guardian_status(uuid)'),
      ('privacy_retention.g014_privacy_eligibility_receipt(uuid)'),
      ('public.hold_privacy_onboarding_compensation(uuid,uuid,text,text)'),
      ('public.get_current_privacy_eligibility()'),
      ('public.get_privacy_eligibility_for_user(uuid)')
    ) AS expected(signature)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL
       OR NOT (SELECT procedure.prosecdef FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_oid)
       OR pg_catalog.pg_get_userbyid((SELECT procedure.proowner FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_oid)) <> 'privacy_workflow_owner' THEN
      RAISE EXCEPTION 'G014-02 privacy RPC owner/definer contract failed for %', v_signature;
    END IF;
    SELECT setting.value INTO v_search_path
    FROM pg_catalog.unnest((SELECT procedure.proconfig FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_oid)) AS setting(value)
    WHERE setting.value LIKE 'search_path=%';
    IF v_search_path IS DISTINCT FROM 'search_path='
       AND v_search_path IS DISTINCT FROM 'search_path=""' THEN
      RAISE EXCEPTION 'G014-02 privacy RPC search_path is not empty for %', v_signature;
    END IF;
  END LOOP;

  IF pg_catalog.has_function_privilege('anon', 'public.submit_privacy_consent(text,text,text,uuid,text,text,uuid,text,uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.submit_privacy_consent(text,text,text,uuid,text,text,uuid,text,uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.submit_privacy_consent(text,text,text,uuid,text,text,uuid,text,uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.publish_privacy_policy_version(text,text,text,timestamptz,uuid,text,text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.publish_privacy_policy_version(text,text,text,timestamptz,uuid,text,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.transition_privacy_onboarding_challenge(uuid,text,text,uuid,text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.transition_privacy_onboarding_challenge(uuid,text,text,uuid,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.submit_guardian_privacy_consent(text,text,text,uuid,text,uuid,text,uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.submit_guardian_privacy_consent(text,text,text,uuid,text,uuid,text,uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.append_privacy_audit_event(text,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.append_privacy_audit_event(text,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.get_current_privacy_eligibility()', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.get_current_privacy_eligibility()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.get_current_privacy_eligibility()', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.get_privacy_eligibility_for_user(uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.get_privacy_eligibility_for_user(uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.get_privacy_eligibility_for_user(uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'privacy_retention.g014_privacy_eligibility_receipt(uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'privacy_retention.g014_privacy_eligibility_receipt(uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'privacy_retention.g014_privacy_eligibility_receipt(uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.hold_privacy_onboarding_compensation(uuid,uuid,text,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.hold_privacy_onboarding_compensation(uuid,uuid,text,text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.hold_privacy_onboarding_compensation(uuid,uuid,text,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.privacy_append_audit_event(text,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'G014-02 privacy RPC grants are not fail closed';
  END IF;

  IF pg_catalog.to_regprocedure('public.append_privacy_audit_event(text,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb,timestamptz)') IS NOT NULL
     OR position(
       'retention_until' IN pg_catalog.pg_get_functiondef(
         'public.append_privacy_audit_event(text,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb)'::regprocedure
       )
     ) <> 0 THEN
    RAISE EXCEPTION 'G014-02 public audit append must not accept or expose retention_until';
  END IF;
  IF pg_catalog.to_regprocedure('public.get_current_privacy_eligibility(uuid)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.get_privacy_eligibility_for_user()') IS NOT NULL THEN
    RAISE EXCEPTION 'G014-02 self eligibility identity must not accept a caller-selected user';
  END IF;
  IF pg_catalog.to_regprocedure('public.hold_privacy_onboarding_compensation(uuid,uuid,text,text,timestamptz)') IS NOT NULL
     OR position(
       'retention_until' IN pg_catalog.pg_get_functiondef(
         'public.hold_privacy_onboarding_compensation(uuid,uuid,text,text)'::regprocedure
       )
     ) <> 0 THEN
    RAISE EXCEPTION 'G014-02 compensation hold must not accept or expose retention_until';
  END IF;
  PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
  FOR v_candidate IN
    SELECT expected.source_signature,
           roles.role_name,
           roles.role_name = ANY (expected.allowed_roles) AS should_execute
    FROM (
      VALUES
        ('public.get_current_privacy_policy_version()'::text, ARRAY['authenticated'::name, 'service_role'::name]),
        ('public.create_privacy_onboarding_challenge(text,uuid,text,jsonb,text,timestamptz)'::text, ARRAY['service_role'::name]),
        ('public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)'::text, ARRAY['service_role'::name]),
        ('public.submit_privacy_consent(text,text,text,uuid,text,text,uuid,text,uuid)'::text, ARRAY['authenticated'::name]),
        ('public.record_privacy_guardian_verification(uuid,uuid,text,text,text,timestamptz,timestamptz)'::text, ARRAY['service_role'::name]),
        ('public.read_privacy_guardian_status(uuid)'::text, ARRAY['service_role'::name]),
        ('public.append_privacy_audit_event(text,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb)'::text, ARRAY['service_role'::name]),
        ('public.privacy_append_audit_event(text,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb)'::text, ARRAY[]::name[]),
        ('public.publish_privacy_policy_version(text,text,text,timestamptz,uuid,text,text)'::text, ARRAY['service_role'::name]),
        ('public.transition_privacy_onboarding_challenge(uuid,text,text,uuid,text)'::text, ARRAY['service_role'::name]),
        ('public.submit_guardian_privacy_consent(text,text,text,uuid,text,uuid,text,uuid)'::text, ARRAY['service_role'::name]),
        ('public.hold_privacy_onboarding_compensation(uuid,uuid,text,text)'::text, ARRAY['service_role'::name]),
        ('public.get_current_privacy_eligibility()'::text, ARRAY['authenticated'::name]),
        ('public.get_privacy_eligibility_for_user(uuid)'::text, ARRAY['service_role'::name]),
        ('public.privacy_under_14_is_eligible(uuid,uuid)'::text, ARRAY[]::name[]),
        ('privacy_retention.g014_privacy_eligibility_receipt(uuid)'::text, ARRAY[]::name[])
    ) AS expected(source_signature, allowed_roles)
    CROSS JOIN (VALUES ('anon'::name), ('authenticated'::name), ('service_role'::name)) AS roles(role_name)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_candidate.source_signature);
    IF pg_catalog.has_function_privilege(v_candidate.role_name, v_oid, 'EXECUTE')
       IS DISTINCT FROM v_candidate.should_execute THEN
      RAISE EXCEPTION 'G014-02 RPC EXECUTE matrix mismatch for % as %', v_candidate.source_signature, v_candidate.role_name;
    END IF;
  END LOOP;

  FOR v_candidate IN
    SELECT roles.role_name,
           relations.schema_name,
           relations.relation_name,
           privileges.privilege_name
    FROM (VALUES ('anon'::name), ('authenticated'::name), ('service_role'::name)) AS roles(role_name)
    CROSS JOIN (
      SELECT namespace.nspname AS schema_name, relation.relname AS relation_name
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'privacy_retention'
        AND relation.relkind = 'r'
      UNION ALL
      SELECT 'public'::name, 'privacy_consent_state'::name
    ) AS relations(schema_name, relation_name)
    CROSS JOIN (VALUES ('INSERT'::text), ('UPDATE'::text), ('DELETE'::text), ('TRUNCATE'::text)) AS privileges(privilege_name)
  LOOP
    IF pg_catalog.has_table_privilege(
      v_candidate.role_name,
      pg_catalog.format('%I.%I', v_candidate.schema_name, v_candidate.relation_name),
      v_candidate.privilege_name
    ) THEN
      RAISE EXCEPTION 'G014-02 table DML matrix unexpectedly permits % on %.% for %',
        v_candidate.privilege_name,
        v_candidate.schema_name,
        v_candidate.relation_name,
        v_candidate.role_name;
    END IF;
  END LOOP;
  IF pg_catalog.to_regclass('privacy_retention.privacy_onboarding_compensation_holds') IS NULL
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_class AS relation
       JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       WHERE relation.oid = 'privacy_retention.privacy_onboarding_compensation_holds'::regclass
         AND (
           namespace.nspname <> 'privacy_retention'
           OR pg_catalog.pg_get_userbyid(relation.relowner) <> 'privacy_workflow_owner'
           OR NOT relation.relrowsecurity
           OR NOT relation.relforcerowsecurity
         )
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = 'privacy_retention.privacy_onboarding_compensation_holds'::regclass
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND attribute.attname IN ('expires_at', 'retention_until', 'released_at')
     ) THEN
    RAISE EXCEPTION 'G014-02 compensation hold relation is not private FORCE-RLS state-only evidence';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)'::text),
      ('public.submit_privacy_consent(text,text,text,uuid,text,text,uuid,text,uuid)'::text),
      ('public.submit_guardian_privacy_consent(text,text,text,uuid,text,uuid,text,uuid)'::text)
    ) AS expected(source_signature)
    WHERE position(
      'g014-policy-publication-state'
      IN pg_catalog.pg_get_functiondef(pg_catalog.to_regprocedure(expected.source_signature))
    ) = 0
  ) THEN
    RAISE EXCEPTION 'G014-02 current-policy workflow write lacks publication serialization';
  END IF;
END;
$catalog_contract$;

-- Every Data API role is denied direct retained-table DML, including service_role.
SET LOCAL ROLE service_role;
DO $direct_service_dml_denied$
DECLARE
  v_relation text;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'privacy_policy_versions',
    'privacy_onboarding_challenges',
    'privacy_guardian_verifications',
    'privacy_age_profiles',
    'privacy_consent_events',
    'privacy_audit_events',
    'privacy_onboarding_compensation_holds'
  ] LOOP
    BEGIN
      EXECUTE pg_catalog.format('DELETE FROM privacy_retention.%I WHERE false', v_relation);
      RAISE EXCEPTION 'service_role direct DML unexpectedly succeeded on %', v_relation;
    EXCEPTION
      WHEN insufficient_privilege THEN NULL;
    END;
    BEGIN
      EXECUTE pg_catalog.format('TRUNCATE TABLE privacy_retention.%I', v_relation);
      RAISE EXCEPTION 'service_role direct TRUNCATE unexpectedly succeeded on %', v_relation;
    EXCEPTION
      WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
END;
$direct_service_dml_denied$;
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"14000000-0000-4000-8000-000000000001"}', true);
DO $direct_browser_compensation_hold_denied$
BEGIN
  BEGIN
    DELETE FROM privacy_retention.privacy_onboarding_compensation_holds WHERE false;
    RAISE EXCEPTION 'authenticated direct compensation hold DML unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    TRUNCATE TABLE privacy_retention.privacy_onboarding_compensation_holds;
    RAISE EXCEPTION 'authenticated direct compensation hold TRUNCATE unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$direct_browser_compensation_hold_denied$;
RESET ROLE;

UPDATE privacy_retention.privacy_retention_classes
SET data_class = 'privacy_identity_audit',
    basis_code = 'test.g014-02.identity-audit',
    trigger_type = 'event_occurred',
    retention_period = interval '90 days',
    status = 'active',
    approved_evidence_ref = 'G014-02-TEST-IDENTITY-AUDIT',
    version = 'g014-02-test-v1',
    activated_at = pg_catalog.clock_timestamp()
WHERE code = 'privacy_identity_audit';

CREATE TEMPORARY TABLE pg_temp.g014_privacy_fixture (
  fixture text PRIMARY KEY,
  id uuid NOT NULL
) ON COMMIT DROP;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('14000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'g014-adult@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'g014-unknown@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'g014-blocked@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'g014-child@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'g014-expired-child@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'g014-withdrawn-child@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14000000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'g014-not-child@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14000000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'g014-challenge@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14000000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'g014-missing-profile@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14000000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'g014-onboarding-valid@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14000000-0000-4000-8000-000000000011', 'authenticated', 'authenticated', 'g014-onboarding-expired@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14000000-0000-4000-8000-000000000012', 'authenticated', 'authenticated', 'g014-onboarding-withdrawn@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14000000-0000-4000-8000-000000000013', 'authenticated', 'authenticated', 'g014-onboarding-pending@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14000000-0000-4000-8000-000000000014', 'authenticated', 'authenticated', 'g014-onboarding-cross-child@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

-- Publication is service-only, records a retention-derived audit row, and
-- returns byte-equivalent idempotent replays.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $policy_publish$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp() - interval '1 minute';
  v_first jsonb;
  v_replay jsonb;
  v_policy_id uuid;
BEGIN
  v_first := public.publish_privacy_policy_version(
    'g014-02-policy-v1', 'ko-KR', repeat('a', 64), v_now, NULL,
    'G014-02-TEST-APPROVAL-1', 'g014-policy-publish-replay-0001'
  );
  v_replay := public.publish_privacy_policy_version(
    'g014-02-policy-v1', 'ko-KR', repeat('a', 64), v_now, NULL,
    'G014-02-TEST-APPROVAL-1', 'g014-policy-publish-replay-0001'
  );
  IF v_first IS DISTINCT FROM v_replay OR v_first ->> 'status' <> 'applied' THEN
    RAISE EXCEPTION 'policy publication replay was not exact';
  END IF;
  v_policy_id := (v_first ->> 'policyVersionId')::uuid;
  INSERT INTO pg_temp.g014_privacy_fixture (fixture, id) VALUES ('policy_current', v_policy_id);

  BEGIN
    PERFORM public.publish_privacy_policy_version(
      'g014-02-policy-v1', 'ko-KR', repeat('b', 64), v_now, NULL,
      'G014-02-TEST-APPROVAL-1', 'g014-policy-publish-replay-0001'
    );
    RAISE EXCEPTION 'policy idempotency hash mismatch unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.publish_privacy_policy_version(
      'g014-02-policy-illegal', 'ko-KR', repeat('c', 64), v_now + interval '1 minute',
      '14000000-0000-4000-8000-000000000099', 'G014-02-TEST-APPROVAL-2',
      'g014-policy-publish-illegal-0001'
    );
    RAISE EXCEPTION 'illegal policy supersession unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$policy_publish$;

RESET ROLE;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $audit_append$
DECLARE
  v_audit_id uuid;
BEGIN
  v_audit_id := public.append_privacy_audit_event(
    'policy_published', NULL, NULL,
    '14000000-0000-4000-8000-000000000091',
    '14000000-0000-4000-8000-000000000092',
    'applied', 'PRIVACY_POLICY_AUDIT_TEST',
    '{"created":1}'::jsonb,
    '{"requestId":"g014-audit-append-0001","route":"/api/privacy/policy"}'::jsonb
  );
  PERFORM pg_catalog.set_config('g014.test.audit_id', v_audit_id::text, true);
  BEGIN
    PERFORM public.append_privacy_audit_event(
      'not_an_allowed_privacy_event', NULL, NULL,
      '14000000-0000-4000-8000-000000000093',
      '14000000-0000-4000-8000-000000000094',
      'applied', 'PRIVACY_AUDIT_TEST', '{}'::jsonb,
      '{"requestId":"g014-audit-invalid-0001","route":"/api/privacy/policy"}'::jsonb
    );
    RAISE EXCEPTION 'illegal audit event unexpectedly succeeded';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;
  END;
END;
$audit_append$;
RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claims', '{}', true);

DO $audit_retention_and_immutability$
DECLARE
  v_audit_id uuid := pg_catalog.current_setting('g014.test.audit_id', true)::uuid;
  v_occurred_at timestamptz;
  v_retention_until timestamptz;
BEGIN
  SELECT audit.occurred_at, audit.retention_until
  INTO v_occurred_at, v_retention_until
  FROM privacy_retention.privacy_audit_events AS audit
  WHERE audit.id = v_audit_id;
  IF v_retention_until <= v_occurred_at THEN
    RAISE EXCEPTION 'audit retention was not resolved internally';
  END IF;
  BEGIN
    UPDATE privacy_retention.privacy_audit_events
    SET reason_code = 'MUTATED'
    WHERE id = v_audit_id;
    RAISE EXCEPTION 'historical audit mutation unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;
END;
$audit_retention_and_immutability$;

INSERT INTO privacy_retention.privacy_age_profiles (
  user_id, age_band, attested_at, method, status, policy_version_id
)
SELECT subject.user_id, subject.age_band, pg_catalog.clock_timestamp(), 'self_attestation', subject.status, fixture.id
FROM (VALUES
  ('14000000-0000-4000-8000-000000000001'::uuid, 'age_14_plus'::text, 'eligible'::text),
  ('14000000-0000-4000-8000-000000000002'::uuid, 'unknown'::text, 'pending'::text),
  ('14000000-0000-4000-8000-000000000003'::uuid, 'age_14_plus'::text, 'blocked'::text),
  ('14000000-0000-4000-8000-000000000004'::uuid, 'under_14'::text, 'guardian_pending'::text),
  ('14000000-0000-4000-8000-000000000005'::uuid, 'under_14'::text, 'guardian_pending'::text),
  ('14000000-0000-4000-8000-000000000006'::uuid, 'under_14'::text, 'guardian_pending'::text),
  ('14000000-0000-4000-8000-000000000007'::uuid, 'age_14_plus'::text, 'eligible'::text),
  ('14000000-0000-4000-8000-000000000008'::uuid, 'age_14_plus'::text, 'eligible'::text),
  ('14000000-0000-4000-8000-000000000014'::uuid, 'under_14'::text, 'guardian_pending'::text)
) AS subject(user_id, age_band, status)
CROSS JOIN pg_temp.g014_privacy_fixture AS fixture
WHERE fixture.fixture = 'policy_current';

INSERT INTO privacy_retention.privacy_guardian_verifications (
  id, child_user_id, status, provider, provider_reference_hash, verified_at, expires_at, withdrawn_at
) VALUES
  ('14000000-0000-4000-8000-000000000041', '14000000-0000-4000-8000-000000000004', 'verified', 'g014-test-provider', repeat('1', 64), pg_catalog.clock_timestamp() - interval '1 hour', pg_catalog.clock_timestamp() + interval '1 day', NULL),
  ('14000000-0000-4000-8000-000000000042', '14000000-0000-4000-8000-000000000005', 'verified', 'g014-test-provider', repeat('2', 64), pg_catalog.clock_timestamp() - interval '2 days', pg_catalog.clock_timestamp() - interval '1 day', NULL),
  ('14000000-0000-4000-8000-000000000043', '14000000-0000-4000-8000-000000000006', 'verified', 'g014-test-provider', repeat('3', 64), pg_catalog.clock_timestamp() - interval '1 hour', pg_catalog.clock_timestamp() + interval '1 day', NULL),
  ('14000000-0000-4000-8000-000000000044', '14000000-0000-4000-8000-000000000007', 'verified', 'g014-test-provider', repeat('4', 64), pg_catalog.clock_timestamp() - interval '1 hour', pg_catalog.clock_timestamp() + interval '1 day', NULL),
  ('14000000-0000-4000-8000-000000000045', '14000000-0000-4000-8000-000000000010', 'verified', 'g014-onboarding-provider', repeat('5', 64), pg_catalog.clock_timestamp() - interval '1 hour', pg_catalog.clock_timestamp() + interval '1 day', NULL),
  ('14000000-0000-4000-8000-000000000046', '14000000-0000-4000-8000-000000000011', 'verified', 'g014-onboarding-provider', repeat('6', 64), pg_catalog.clock_timestamp() - interval '2 days', pg_catalog.clock_timestamp() - interval '1 day', NULL),
  ('14000000-0000-4000-8000-000000000047', '14000000-0000-4000-8000-000000000012', 'withdrawn', 'g014-onboarding-provider', repeat('7', 64), NULL, NULL, pg_catalog.clock_timestamp()),
  ('14000000-0000-4000-8000-000000000048', '14000000-0000-4000-8000-000000000013', 'pending', 'g014-onboarding-provider', repeat('8', 64), NULL, NULL, NULL),
  ('14000000-0000-4000-8000-000000000049', '14000000-0000-4000-8000-000000000014', 'verified', 'g014-onboarding-provider', repeat('9', 64), pg_catalog.clock_timestamp() + interval '1 hour', pg_catalog.clock_timestamp() + interval '1 day', NULL);
INSERT INTO privacy_retention.privacy_consent_events (
  user_id,
  subject_kind,
  guardian_verification_id,
  purpose,
  channel,
  decision,
  policy_version_id,
  notice_sha256,
  source,
  correlation_id,
  idempotency_key
)
SELECT
  '14000000-0000-4000-8000-000000000014'::uuid,
  'child',
  '14000000-0000-4000-8000-000000000049'::uuid,
  'privacy_required',
  'none',
  'granted',
  fixture.id,
  repeat('a', 64),
  'guardian',
  '14000000-0000-4000-8000-000000000083'::uuid,
  'g014-future-guardian-consent-01'
FROM pg_temp.g014_privacy_fixture AS fixture
WHERE fixture.fixture = 'policy_current';
-- Simulate an age profile that was marked guardian_verified before a guardian
-- expired. Read-time eligibility must not trust that persisted status.
ALTER TABLE privacy_retention.privacy_age_profiles
  DISABLE TRIGGER privacy_age_profiles_guardian_invariant;
UPDATE privacy_retention.privacy_age_profiles
SET status = 'guardian_verified'
WHERE user_id IN (
  '14000000-0000-4000-8000-000000000005',
  '14000000-0000-4000-8000-000000000014'
);
ALTER TABLE privacy_retention.privacy_age_profiles
  ENABLE TRIGGER privacy_age_profiles_guardian_invariant;
DO $future_guardian_internal_eligibility$
DECLARE
  v_policy_id uuid := (SELECT id FROM pg_temp.g014_privacy_fixture WHERE fixture = 'policy_current');
BEGIN
  IF public.privacy_under_14_is_eligible(
    '14000000-0000-4000-8000-000000000014',
    v_policy_id
  ) THEN
    RAISE EXCEPTION 'future guardian verification satisfied the internal eligibility predicate';
  END IF;
END;
$future_guardian_internal_eligibility$;

INSERT INTO privacy_retention.privacy_onboarding_challenges (
  id, token_hash, policy_version_id, age_band, requested_consents, expires_at
)
SELECT challenge.id, challenge.token_hash, fixture.id, 'age_14_plus', '{}'::jsonb, challenge.expires_at
FROM (VALUES
  ('14000000-0000-4000-8000-000000000051'::uuid, repeat('5', 64), pg_catalog.clock_timestamp() + interval '1 hour'),
  ('14000000-0000-4000-8000-000000000052'::uuid, repeat('6', 64), pg_catalog.clock_timestamp() - interval '1 hour')
) AS challenge(id, token_hash, expires_at)
CROSS JOIN pg_temp.g014_privacy_fixture AS fixture
WHERE fixture.fixture = 'policy_current';
INSERT INTO privacy_retention.privacy_onboarding_challenges (
  id, token_hash, policy_version_id, age_band, requested_consents, expires_at
)
SELECT challenge.id,
       pg_catalog.encode(extensions.digest(challenge.token, 'sha256'), 'hex'),
       fixture.id,
       'under_14',
       '{}'::jsonb,
       pg_catalog.clock_timestamp() + interval '1 hour'
FROM (VALUES
  ('14000000-0000-4000-8000-000000000053'::uuid, 'g014-under14-valid-token-0001'::text),
  ('14000000-0000-4000-8000-000000000054'::uuid, 'g014-under14-expired-token-0001'::text),
  ('14000000-0000-4000-8000-000000000055'::uuid, 'g014-under14-withdrawn-token-01'::text),
  ('14000000-0000-4000-8000-000000000056'::uuid, 'g014-under14-pending-token-0001'::text),
  ('14000000-0000-4000-8000-000000000057'::uuid, 'g014-under14-future-token-0001'::text),
  ('14000000-0000-4000-8000-000000000058'::uuid, 'g014-under14-cross-child-token-1'::text),
  ('14000000-0000-4000-8000-000000000059'::uuid, 'g014-under14-transition-only-01'::text)
) AS challenge(id, token)
CROSS JOIN pg_temp.g014_privacy_fixture AS fixture
WHERE fixture.fixture = 'policy_current';

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $onboarding_transition$
DECLARE
  v_first jsonb;
  v_replay jsonb;
BEGIN
  v_first := public.transition_privacy_onboarding_challenge(
    '14000000-0000-4000-8000-000000000051', 'pending', 'consumed',
    '14000000-0000-4000-8000-000000000008', 'g014-onboarding-transition-0001'
  );
  v_replay := public.transition_privacy_onboarding_challenge(
    '14000000-0000-4000-8000-000000000051', 'pending', 'consumed',
    '14000000-0000-4000-8000-000000000008', 'g014-onboarding-transition-0001'
  );
  IF v_first IS DISTINCT FROM v_replay OR v_first ->> 'state' <> 'consumed' THEN
    RAISE EXCEPTION 'onboarding transition replay was not exact';
  END IF;
  BEGIN
    PERFORM public.transition_privacy_onboarding_challenge(
      '14000000-0000-4000-8000-000000000051', 'pending', 'consumed',
      '14000000-0000-4000-8000-000000000001', 'g014-onboarding-transition-0001'
    );
    RAISE EXCEPTION 'onboarding transition actor mismatch unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.transition_privacy_onboarding_challenge(
      '14000000-0000-4000-8000-000000000051', 'consumed', 'pending',
      '14000000-0000-4000-8000-000000000008', 'g014-onboarding-transition-bad-01'
    );
    RAISE EXCEPTION 'illegal onboarding state transition unexpectedly succeeded';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.transition_privacy_onboarding_challenge(
      '14000000-0000-4000-8000-000000000052', 'pending', 'consumed',
      '14000000-0000-4000-8000-000000000008', 'g014-onboarding-transition-expired'
    );
    RAISE EXCEPTION 'expired onboarding transition unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$onboarding_transition$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $onboarding_compensation_hold$
DECLARE
  v_policy_id uuid := (SELECT id FROM pg_temp.g014_privacy_fixture WHERE fixture = 'policy_current');
  v_first jsonb;
  v_replay jsonb;
  v_eligibility jsonb;
  v_hold_count integer;
  v_audit_count integer;
BEGIN
  v_first := public.hold_privacy_onboarding_compensation(
    '14000000-0000-4000-8000-000000000051',
    '14000000-0000-4000-8000-000000000008',
    'PRIVACY_AUTH_CLEANUP_UNPROVEN',
    'g014-compensation-hold-0001'
  );
  v_replay := public.hold_privacy_onboarding_compensation(
    '14000000-0000-4000-8000-000000000051',
    '14000000-0000-4000-8000-000000000008',
    'PRIVACY_AUTH_CLEANUP_UNPROVEN',
    'g014-compensation-hold-0001'
  );
  IF v_first IS DISTINCT FROM v_replay
     OR v_first ->> 'status' <> 'held'
     OR v_first ->> 'reasonCode' <> 'PRIVACY_AUTH_CLEANUP_UNPROVEN'
     OR (v_first #>> '{readback,passed}')::boolean IS DISTINCT FROM true
     OR (v_first #>> '{readback,active}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'onboarding compensation hold replay was not an exact active receipt';
  END IF;

  BEGIN
    PERFORM public.hold_privacy_onboarding_compensation(
      '14000000-0000-4000-8000-000000000051',
      '14000000-0000-4000-8000-000000000001',
      'PRIVACY_AUTH_CLEANUP_UNPROVEN',
      'g014-compensation-hold-0001'
    );
    RAISE EXCEPTION 'onboarding compensation hold user mismatch unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.hold_privacy_onboarding_compensation(
      '14000000-0000-4000-8000-000000000051',
      '14000000-0000-4000-8000-000000000008',
      'PRIVACY_AUTH_CLEANUP_FAILED',
      'g014-compensation-hold-0001'
    );
    RAISE EXCEPTION 'onboarding compensation hold reason mismatch unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.hold_privacy_onboarding_compensation(
      '14000000-0000-4000-8000-000000000051',
      '14000000-0000-4000-8000-000000000008',
      'PRIVACY_AUTH_CLEANUP_UNPROVEN',
      'g014-compensation-hold-0002'
    );
    RAISE EXCEPTION 'onboarding compensation hold operation idempotency mismatch unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.hold_privacy_onboarding_compensation(
      '14000000-0000-4000-8000-000000000051',
      '14000000-0000-4000-8000-000000000001',
      'PRIVACY_AUTH_CLEANUP_UNPROVEN',
      'g014-compensation-hold-user-02'
    );
    RAISE EXCEPTION 'onboarding compensation hold challenge/user binding mismatch unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.hold_privacy_onboarding_compensation(
      '14000000-0000-4000-8000-000000000051',
      '14000000-0000-4000-8000-000000000008',
      NULL,
      'g014-compensation-hold-invalid'
    );
    RAISE EXCEPTION 'onboarding compensation hold missing reason unexpectedly succeeded';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;
  END;

  SELECT count(*) INTO v_hold_count
  FROM privacy_retention.privacy_onboarding_compensation_holds AS hold
  WHERE hold.operation_id = (v_first ->> 'operationId')::uuid
    AND hold.audit_event_id = (v_first ->> 'auditId')::uuid
    AND hold.challenge_id = '14000000-0000-4000-8000-000000000051'
    AND hold.user_id = '14000000-0000-4000-8000-000000000008'
    AND hold.operation_code = 'onboarding_compensation_hold'
    AND hold.idempotency_key = 'g014-compensation-hold-0001'
    AND hold.reason_code = 'PRIVACY_AUTH_CLEANUP_UNPROVEN'
    AND hold.state = 'active';
  SELECT count(*) INTO v_audit_count
  FROM privacy_retention.privacy_audit_events AS audit
  WHERE audit.id = (v_first ->> 'auditId')::uuid
    AND audit.event_type = 'onboarding_compensation_held'
    AND audit.operation_id = (v_first ->> 'operationId')::uuid
    AND audit.correlation_id = '14000000-0000-4000-8000-000000000051'
    AND audit.status = 'held'
    AND audit.reason_code = 'PRIVACY_AUTH_CLEANUP_UNPROVEN'
    AND audit.actor_user_id IS NULL
    AND audit.subject_ref_hash = pg_catalog.encode(
      extensions.digest(
        'privacy-subject:v1:14000000-0000-4000-8000-000000000008',
        'sha256'
      ),
      'hex'
    )
    AND audit.request_metadata = pg_catalog.jsonb_build_object(
      'requestId', 'g014-compensation-hold-0001',
      'route', '/api/privacy/onboarding'
    );
  IF v_hold_count <> 1 OR v_audit_count <> 1 THEN
    RAISE EXCEPTION 'onboarding compensation hold did not persist one bounded immutable evidence pair';
  END IF;
  PERFORM pg_catalog.set_config(
    'g014.test.compensation_operation_id',
    v_first ->> 'operationId',
    true
  );

  v_eligibility := public.get_privacy_eligibility_for_user(
    '14000000-0000-4000-8000-000000000008'
  );
  IF v_eligibility IS DISTINCT FROM pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'eligible', false,
    'reasonCode', 'PRIVACY_AGE_BLOCKED',
    'policyVersionId', v_policy_id::text,
    'contentSha256', repeat('a', 64)
  ) THEN
    RAISE EXCEPTION 'service eligibility did not fail closed for an active onboarding compensation hold';
  END IF;
END;
$onboarding_compensation_hold$;
RESET ROLE;

DO $onboarding_compensation_hold_immutable$
DECLARE
  v_operation_id uuid := pg_catalog.current_setting('g014.test.compensation_operation_id', true)::uuid;
BEGIN
  BEGIN
    UPDATE privacy_retention.privacy_onboarding_compensation_holds
    SET state = 'active'
    WHERE operation_id = v_operation_id;
    RAISE EXCEPTION 'onboarding compensation hold mutation unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    DELETE FROM privacy_retention.privacy_onboarding_compensation_holds
    WHERE operation_id = v_operation_id;
    RAISE EXCEPTION 'onboarding compensation hold deletion unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    UPDATE privacy_retention.privacy_audit_events
    SET reason_code = 'MUTATED'
    WHERE operation_id = v_operation_id
      AND event_type = 'onboarding_compensation_held';
    RAISE EXCEPTION 'onboarding compensation hold audit evidence mutation unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;
END;
$onboarding_compensation_hold_immutable$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"14000000-0000-4000-8000-000000000008"}', true);
DO $current_eligibility_compensation_hold$
DECLARE
  v_policy_id uuid := (SELECT id FROM pg_temp.g014_privacy_fixture WHERE fixture = 'policy_current');
  v_eligibility jsonb;
BEGIN
  v_eligibility := public.get_current_privacy_eligibility();
  IF v_eligibility IS DISTINCT FROM pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'eligible', false,
    'reasonCode', 'PRIVACY_AGE_BLOCKED',
    'policyVersionId', v_policy_id::text,
    'contentSha256', repeat('a', 64)
  ) THEN
    RAISE EXCEPTION 'self eligibility did not fail closed for an active onboarding compensation hold';
  END IF;
END;
$current_eligibility_compensation_hold$;
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $under_14_onboarding_guardian_boundary$
DECLARE
  v_first jsonb;
  v_replay jsonb;
  v_consent_count integer;
  v_challenge_id uuid;
  v_user_id uuid;
  v_token text;
  v_guardian_id uuid;
BEGIN
  v_first := public.confirm_privacy_onboarding(
    '14000000-0000-4000-8000-000000000053',
    'g014-under14-valid-token-0001',
    '14000000-0000-4000-8000-000000000010',
    'password_signup',
    '14000000-0000-4000-8000-000000000045'
  );
  PERFORM pg_catalog.set_config('g014.test.under14_onboarding_receipt', v_first::text, true);
  v_replay := public.confirm_privacy_onboarding(
    '14000000-0000-4000-8000-000000000053',
    'g014-under14-valid-token-0001',
    '14000000-0000-4000-8000-000000000010',
    'password_signup',
    '14000000-0000-4000-8000-000000000045'
  );
  SELECT count(*) INTO v_consent_count
  FROM privacy_retention.privacy_consent_events AS event
  WHERE event.user_id = '14000000-0000-4000-8000-000000000010'
    AND event.subject_kind = 'child';
  IF v_first IS DISTINCT FROM v_replay
     OR v_first ->> 'status' <> 'held'
     OR v_first ->> 'errorCode' <> 'PRIVACY_GUARDIAN_REQUIRED'
     OR v_first ->> 'ageStatus' <> 'guardian_pending'
     OR (v_first #>> '{readback,checks,requiredConsentRecorded}')::boolean
     OR v_consent_count <> 0 THEN
    RAISE EXCEPTION 'under-14 onboarding minted consent or lost its held replay receipt';
  END IF;

  PERFORM public.transition_privacy_onboarding_challenge(
    '14000000-0000-4000-8000-000000000059',
    'pending',
    'consumed',
    '14000000-0000-4000-8000-000000000014',
    'g014-under14-transition-only-0001'
  );
  BEGIN
    PERFORM public.confirm_privacy_onboarding(
      '14000000-0000-4000-8000-000000000059',
      'g014-under14-transition-only-01',
      '14000000-0000-4000-8000-000000000014',
      'password_signup',
      NULL
    );
    RAISE EXCEPTION 'transition-only challenge consumption replay unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_audit_events AS audit
    WHERE audit.operation_id = '14000000-0000-4000-8000-000000000059'
      AND audit.event_type = 'onboarding_confirmed'
  ) THEN
    RAISE EXCEPTION 'transition-only challenge fabricated an onboarding confirmation audit';
  END IF;

  FOR v_challenge_id, v_user_id, v_token, v_guardian_id IN
    SELECT *
    FROM (VALUES
      ('14000000-0000-4000-8000-000000000054'::uuid, '14000000-0000-4000-8000-000000000011'::uuid, 'g014-under14-expired-token-0001'::text, '14000000-0000-4000-8000-000000000046'::uuid),
      ('14000000-0000-4000-8000-000000000055'::uuid, '14000000-0000-4000-8000-000000000012'::uuid, 'g014-under14-withdrawn-token-01'::text, '14000000-0000-4000-8000-000000000047'::uuid),
      ('14000000-0000-4000-8000-000000000056'::uuid, '14000000-0000-4000-8000-000000000013'::uuid, 'g014-under14-pending-token-0001'::text, '14000000-0000-4000-8000-000000000048'::uuid),
      ('14000000-0000-4000-8000-000000000057'::uuid, '14000000-0000-4000-8000-000000000014'::uuid, 'g014-under14-future-token-0001'::text, '14000000-0000-4000-8000-000000000049'::uuid),
      ('14000000-0000-4000-8000-000000000058'::uuid, '14000000-0000-4000-8000-000000000014'::uuid, 'g014-under14-cross-child-token-1'::text, '14000000-0000-4000-8000-000000000045'::uuid)
    ) AS invalid_guardian(challenge_id, user_id, token, guardian_id)
  LOOP
    BEGIN
      PERFORM public.confirm_privacy_onboarding(
        v_challenge_id,
        v_token,
        v_user_id,
        'password_signup',
        v_guardian_id
      );
      RAISE EXCEPTION 'invalid guardian onboarding confirmation unexpectedly succeeded for %', v_challenge_id;
    EXCEPTION
      WHEN check_violation THEN NULL;
    END;
    IF EXISTS (
      SELECT 1
      FROM privacy_retention.privacy_consent_events AS event
      WHERE event.user_id = v_user_id
        AND event.correlation_id = v_challenge_id
    ) OR EXISTS (
      SELECT 1
      FROM privacy_retention.privacy_audit_events AS audit
      WHERE audit.operation_id = v_challenge_id
        AND audit.event_type = 'onboarding_confirmed'
    ) OR EXISTS (
      SELECT 1
      FROM privacy_retention.privacy_onboarding_challenges AS challenge
      WHERE challenge.id = v_challenge_id
        AND challenge.consumed_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'invalid guardian onboarding confirmation mutated consent, audit, or challenge state for %', v_challenge_id;
    END IF;
  END LOOP;
END;
$under_14_onboarding_guardian_boundary$;
RESET ROLE;

-- The settings RPC has a single authenticated adult path. Unknown, blocked,
-- and under-14 profiles cannot turn browser requests into child grants.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"14000000-0000-4000-8000-000000000001"}', true);
DO $adult_consent$
DECLARE
  v_policy_id uuid := (SELECT id FROM pg_temp.g014_privacy_fixture WHERE fixture = 'policy_current');
  v_first jsonb;
  v_replay jsonb;
  v_interleaved jsonb;
BEGIN
  v_first := public.submit_privacy_consent(
    'email_marketing', 'email', 'granted', v_policy_id, repeat('a', 64), 'settings', NULL,
    'g014-adult-consent-replay-0001', '14000000-0000-4000-8000-000000000061'
  );
  v_replay := public.submit_privacy_consent(
    'email_marketing', 'email', 'granted', v_policy_id, repeat('a', 64), 'settings', NULL,
    'g014-adult-consent-replay-0001', '14000000-0000-4000-8000-000000000061'
  );
  IF v_first IS DISTINCT FROM v_replay OR v_first ->> 'status' <> 'applied' THEN
    RAISE EXCEPTION 'adult consent replay was not exact';
  END IF;
  v_interleaved := public.submit_privacy_consent(
    'sms_marketing', 'sms', 'granted', v_policy_id, repeat('a', 64), 'settings', NULL,
    'g014-adult-shared-correlation-01', '14000000-0000-4000-8000-000000000061'
  );
  v_replay := public.submit_privacy_consent(
    'email_marketing', 'email', 'granted', v_policy_id, repeat('a', 64), 'settings', NULL,
    'g014-adult-consent-replay-0001', '14000000-0000-4000-8000-000000000061'
  );
  IF v_interleaved ->> 'status' <> 'applied' OR v_replay IS DISTINCT FROM v_first THEN
    RAISE EXCEPTION 'shared-correlation adult replay was not bound to its exact consent event';
  END IF;
  BEGIN
    PERFORM public.submit_privacy_consent(
      'email_marketing', 'email', 'granted', v_policy_id, repeat('b', 64), 'settings', NULL,
      'g014-adult-consent-replay-0001', '14000000-0000-4000-8000-000000000061'
    );
    RAISE EXCEPTION 'adult consent hash mismatch unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.submit_privacy_consent(
      'email_marketing', 'email', 'granted', v_policy_id, repeat('a', 64), 'settings', NULL,
      'g014-adult-consent-null-correlation', NULL
    );
    RAISE EXCEPTION 'adult consent NULL correlation unexpectedly succeeded';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.submit_privacy_consent(
      'marketing', 'email', 'granted', v_policy_id, repeat('a', 64), 'settings', NULL,
      'g014-adult-generic-purpose-denial', '14000000-0000-4000-8000-000000000066'
    );
    RAISE EXCEPTION 'generic marketing purpose unexpectedly succeeded';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.submit_privacy_consent(
      'email_marketing', 'push', 'granted', v_policy_id, repeat('a', 64), 'settings', NULL,
      'g014-adult-purpose-channel-denial', '14000000-0000-4000-8000-000000000067'
    );
    RAISE EXCEPTION 'mismatched marketing purpose/channel unexpectedly succeeded';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;
  END;
END;
$adult_consent$;

DO $self_grant_denials$
DECLARE
  v_policy_id uuid := (SELECT id FROM pg_temp.g014_privacy_fixture WHERE fixture = 'policy_current');
  v_user_id uuid;
  v_key text;
  v_correlation_id uuid;
BEGIN
  FOR v_user_id, v_key, v_correlation_id IN
    SELECT *
    FROM (VALUES
      ('14000000-0000-4000-8000-000000000002'::uuid, 'g014-unknown-self-denial-0001'::text, '14000000-0000-4000-8000-000000000062'::uuid),
      ('14000000-0000-4000-8000-000000000003'::uuid, 'g014-blocked-self-denial-0001'::text, '14000000-0000-4000-8000-000000000063'::uuid),
      ('14000000-0000-4000-8000-000000000004'::uuid, 'g014-under14-self-denial-0001'::text, '14000000-0000-4000-8000-000000000064'::uuid)
    ) AS denied(user_id, idempotency_key, correlation_id)
  LOOP
    PERFORM pg_catalog.set_config(
      'request.jwt.claims',
      pg_catalog.jsonb_build_object('role', 'authenticated', 'sub', v_user_id::text)::text,
      true
    );
    BEGIN
      PERFORM public.submit_privacy_consent(
        'email_marketing', 'email', 'granted', v_policy_id, repeat('a', 64), 'settings', NULL,
        v_key, v_correlation_id
      );
      RAISE EXCEPTION 'ineligible self grant unexpectedly succeeded for %', v_user_id;
    EXCEPTION
      WHEN insufficient_privilege THEN NULL;
    END;
  END LOOP;
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  BEGIN
    PERFORM public.submit_privacy_consent(
      'email_marketing', 'email', 'granted', v_policy_id, repeat('a', 64), 'settings', NULL,
      'g014-null-auth-uid-denial-0001', '14000000-0000-4000-8000-000000000065'
    );
    RAISE EXCEPTION 'NULL auth.uid self grant unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$self_grant_denials$;
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $guardian_consent$
DECLARE
  v_policy_id uuid := (SELECT id FROM pg_temp.g014_privacy_fixture WHERE fixture = 'policy_current');
  v_eligibility jsonb;
  v_first jsonb;
  v_replay jsonb;
  v_latest_decision text;
  v_missing_profile uuid := '14000000-0000-4000-8000-000000000009';
  v_stale_profile_status text;
  v_interleaved jsonb;
  v_onboarding_replay jsonb;
  v_guardian_status jsonb;
BEGIN
  v_first := public.submit_guardian_privacy_consent(
    'privacy_required', 'none', 'granted', v_policy_id, repeat('a', 64),
    '14000000-0000-4000-8000-000000000041', 'g014-guardian-consent-replay-0001',
    '14000000-0000-4000-8000-000000000071'
  );
  v_replay := public.submit_guardian_privacy_consent(
    'privacy_required', 'none', 'granted', v_policy_id, repeat('a', 64),
    '14000000-0000-4000-8000-000000000041', 'g014-guardian-consent-replay-0001',
    '14000000-0000-4000-8000-000000000071'
  );
  IF v_first IS DISTINCT FROM v_replay OR v_first ->> 'status' <> 'applied' THEN
    RAISE EXCEPTION 'guardian consent replay was not exact';
  END IF;
  BEGIN
    PERFORM public.submit_guardian_privacy_consent(
      'privacy_required', 'none', 'granted', v_policy_id, repeat('b', 64),
      '14000000-0000-4000-8000-000000000041', 'g014-guardian-consent-replay-0001',
      '14000000-0000-4000-8000-000000000071'
    );
    RAISE EXCEPTION 'guardian consent hash mismatch unexpectedly succeeded';
  EXCEPTION
    WHEN unique_violation THEN NULL;
  END;
  v_interleaved := public.submit_guardian_privacy_consent(
    'privacy_required', 'none', 'granted', v_policy_id, repeat('a', 64),
    '14000000-0000-4000-8000-000000000045', 'g014-guardian-cross-child-replay', 
    '14000000-0000-4000-8000-000000000071'
  );
  v_replay := public.submit_guardian_privacy_consent(
    'privacy_required', 'none', 'granted', v_policy_id, repeat('a', 64),
    '14000000-0000-4000-8000-000000000041', 'g014-guardian-consent-replay-0001',
    '14000000-0000-4000-8000-000000000071'
  );
  IF v_interleaved ->> 'status' <> 'applied' OR v_replay IS DISTINCT FROM v_first THEN
    RAISE EXCEPTION 'cross-child guardian replay was not bound to its exact consent event';
  END IF;
  v_guardian_status := public.read_privacy_guardian_status('14000000-0000-4000-8000-000000000004');
  IF (v_guardian_status ->> 'eligible')::boolean IS DISTINCT FROM true
     OR v_guardian_status ->> 'guardianStatus' <> 'verified'
     OR v_guardian_status ->> 'ageStatus' <> 'guardian_verified' THEN
    RAISE EXCEPTION 'live guardian status did not share the eligible predicate';
  END IF;
  v_onboarding_replay := public.confirm_privacy_onboarding(
    '14000000-0000-4000-8000-000000000053',
    'g014-under14-valid-token-0001',
    '14000000-0000-4000-8000-000000000010',
    'password_signup',
    '14000000-0000-4000-8000-000000000045'
  );
  IF v_onboarding_replay IS DISTINCT FROM pg_catalog.current_setting(
    'g014.test.under14_onboarding_receipt',
    true
  )::jsonb THEN
    RAISE EXCEPTION 'consumed onboarding replay did not retain its immutable original receipt';
  END IF;
  v_eligibility := public.get_privacy_eligibility_for_user('14000000-0000-4000-8000-000000000004');
  IF v_eligibility IS DISTINCT FROM pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'eligible', true,
    'reasonCode', 'PRIVACY_ELIGIBLE',
    'policyVersionId', v_policy_id::text,
    'contentSha256', repeat('a', 64)
  )
     OR v_eligibility ? 'userId'
     OR v_eligibility ? 'guardianVerificationId' THEN
    RAISE EXCEPTION 'current verified guardian eligibility receipt was not bounded and live';
  END IF;

  v_eligibility := public.get_privacy_eligibility_for_user(v_missing_profile);
  IF v_eligibility ->> 'reasonCode' <> 'PRIVACY_AGE_ATTESTATION_REQUIRED'
     OR (v_eligibility ->> 'eligible')::boolean THEN
    RAISE EXCEPTION 'missing profile was not fail closed';
  END IF;
  v_replay := public.submit_guardian_privacy_consent(
    'privacy_required', 'none', 'withdrawn', v_policy_id, repeat('a', 64),
    '14000000-0000-4000-8000-000000000041', 'g014-guardian-withdrawal-0001',
    '14000000-0000-4000-8000-000000000081'
  );
  SELECT event.decision INTO v_latest_decision
  FROM privacy_retention.privacy_consent_events AS event
  WHERE event.user_id = '14000000-0000-4000-8000-000000000004'
    AND event.subject_kind = 'child'
    AND event.guardian_verification_id = '14000000-0000-4000-8000-000000000041'
    AND event.purpose = 'privacy_required'
    AND event.channel = 'none'
  ORDER BY event.occurred_at DESC, event.id DESC
  LIMIT 1;
  IF v_replay ->> 'status' <> 'applied' OR v_latest_decision <> 'withdrawn' THEN
    RAISE EXCEPTION 'guardian withdrawal did not bind to the child purpose and channel';
  END IF;
  -- Withdrawal invalidates the historical verification and its bound consent.
  v_first := public.submit_guardian_privacy_consent(
    'privacy_required', 'none', 'granted', v_policy_id, repeat('a', 64),
    '14000000-0000-4000-8000-000000000043', 'g014-old-guardian-consent-0001',
    '14000000-0000-4000-8000-000000000084'
  );
  IF v_first ->> 'status' <> 'applied' THEN
    RAISE EXCEPTION 'historical guardian consent setup did not apply';
  END IF;
  v_replay := public.record_privacy_guardian_verification(
    '14000000-0000-4000-8000-000000000043',
    '14000000-0000-4000-8000-000000000006',
    'withdrawn',
    'g014-test-provider',
    repeat('3', 64),
    NULL,
    NULL
  );
  IF v_replay ->> 'status' <> 'applied'
     OR v_replay ->> 'guardianStatus' <> 'withdrawn' THEN
    RAISE EXCEPTION 'guardian verification withdrawal did not apply';
  END IF;
  SELECT profile.status INTO v_stale_profile_status
  FROM privacy_retention.privacy_age_profiles AS profile
  WHERE profile.user_id = '14000000-0000-4000-8000-000000000006';
  IF v_stale_profile_status <> 'guardian_withdrawn' THEN
    RAISE EXCEPTION 'withdrawn guardian did not materialize guardian_withdrawn';
  END IF;
  v_eligibility := public.get_privacy_eligibility_for_user('14000000-0000-4000-8000-000000000006');
  IF (v_eligibility ->> 'eligible')::boolean
     OR v_eligibility ->> 'reasonCode' <> 'PRIVACY_GUARDIAN_REQUIRED' THEN
    RAISE EXCEPTION 'withdrawn guardian verification revived historical consent';
  END IF;

  -- A distinct current verification may recover only to pending; its own consent
  -- must be recorded before it can establish eligibility.
  v_first := public.record_privacy_guardian_verification(
    '14000000-0000-4000-8000-000000000060',
    '14000000-0000-4000-8000-000000000006',
    'verified',
    'g014-replacement-provider',
    repeat('d', 64),
    pg_catalog.clock_timestamp() - interval '1 hour',
    pg_catalog.clock_timestamp() + interval '1 day'
  );
  IF v_first ->> 'status' <> 'applied'
     OR v_first ->> 'guardianStatus' <> 'verified' THEN
    RAISE EXCEPTION 'replacement guardian verification did not apply';
  END IF;
  SELECT profile.status INTO v_stale_profile_status
  FROM privacy_retention.privacy_age_profiles AS profile
  WHERE profile.user_id = '14000000-0000-4000-8000-000000000006';
  IF v_stale_profile_status <> 'guardian_pending' THEN
    RAISE EXCEPTION 'replacement guardian verification did not recover to pending';
  END IF;
  v_eligibility := public.get_privacy_eligibility_for_user('14000000-0000-4000-8000-000000000006');
  IF (v_eligibility ->> 'eligible')::boolean
     OR v_eligibility ->> 'reasonCode' <> 'PRIVACY_GUARDIAN_CONSENT_REQUIRED' THEN
    RAISE EXCEPTION 'historical guardian consent revived after replacement verification';
  END IF;
  BEGIN
    PERFORM public.submit_guardian_privacy_consent(
      'privacy_required', 'none', 'granted', v_policy_id, repeat('a', 64),
      '14000000-0000-4000-8000-000000000042', 'g014-guardian-expired-denial-0001',
      '14000000-0000-4000-8000-000000000072'
    );
    RAISE EXCEPTION 'expired guardian grant unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.submit_guardian_privacy_consent(
      'privacy_required', 'none', 'granted', v_policy_id, repeat('a', 64),
      '14000000-0000-4000-8000-000000000049', 'g014-guardian-future-denial-0001',
      '14000000-0000-4000-8000-000000000082'
    );
    RAISE EXCEPTION 'future guardian grant unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.record_privacy_guardian_verification(
      '14000000-0000-4000-8000-000000000050',
      '14000000-0000-4000-8000-000000000014',
      'verified',
      'g014-future-provider',
      repeat('f', 64),
      pg_catalog.clock_timestamp() + interval '1 hour',
      pg_catalog.clock_timestamp() + interval '2 days'
    );
    RAISE EXCEPTION 'future guardian verification unexpectedly recorded';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.submit_guardian_privacy_consent(
      'privacy_required', 'none', 'granted', v_policy_id, repeat('a', 64),
      '14000000-0000-4000-8000-000000000043', 'g014-guardian-withdrawn-denial-01',
      '14000000-0000-4000-8000-000000000073'
    );
    RAISE EXCEPTION 'withdrawn guardian grant unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  v_first := public.submit_guardian_privacy_consent(
    'privacy_required', 'none', 'granted', v_policy_id, repeat('a', 64),
    '14000000-0000-4000-8000-000000000060', 'g014-replacement-guardian-consent-01',
    '14000000-0000-4000-8000-000000000085'
  );
  v_replay := public.submit_guardian_privacy_consent(
    'privacy_required', 'none', 'granted', v_policy_id, repeat('a', 64),
    '14000000-0000-4000-8000-000000000060', 'g014-replacement-guardian-consent-01',
    '14000000-0000-4000-8000-000000000085'
  );
  IF v_first IS DISTINCT FROM v_replay
     OR v_first ->> 'status' <> 'applied' THEN
    RAISE EXCEPTION 'replacement guardian consent replay was not exact';
  END IF;
  SELECT profile.status INTO v_stale_profile_status
  FROM privacy_retention.privacy_age_profiles AS profile
  WHERE profile.user_id = '14000000-0000-4000-8000-000000000006';
  IF v_stale_profile_status <> 'guardian_verified' THEN
    RAISE EXCEPTION 'replacement guardian consent did not make the child guardian_verified';
  END IF;
  v_eligibility := public.get_privacy_eligibility_for_user('14000000-0000-4000-8000-000000000006');
  IF v_eligibility IS DISTINCT FROM pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'eligible', true,
    'reasonCode', 'PRIVACY_ELIGIBLE',
    'policyVersionId', v_policy_id::text,
    'contentSha256', repeat('a', 64)
  ) THEN
    RAISE EXCEPTION 'replacement guardian consent did not produce an exact eligible receipt';
  END IF;
  v_guardian_status := public.read_privacy_guardian_status('14000000-0000-4000-8000-000000000006');
  IF (v_guardian_status ->> 'eligible')::boolean IS DISTINCT FROM true
     OR v_guardian_status ->> 'guardianStatus' <> 'verified'
     OR v_guardian_status ->> 'ageStatus' <> 'guardian_verified'
     OR v_guardian_status ->> 'verificationId' <> '14000000-0000-4000-8000-000000000060' THEN
    RAISE EXCEPTION 'replacement guardian status was not current and eligible';
  END IF;
  BEGIN
    PERFORM public.submit_guardian_privacy_consent(
      'privacy_required', 'none', 'granted', v_policy_id, repeat('a', 64),
      '14000000-0000-4000-8000-000000000044', 'g014-guardian-wrong-child-denial-01',
      '14000000-0000-4000-8000-000000000074'
    );
    RAISE EXCEPTION 'guardian wrong-child grant unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.submit_guardian_privacy_consent(
      'privacy_required', 'none', 'granted', '14000000-0000-4000-8000-000000000099', repeat('b', 64),
      '14000000-0000-4000-8000-000000000041', 'g014-guardian-wrong-policy-denial-01',
      '14000000-0000-4000-8000-000000000075'
    );
    RAISE EXCEPTION 'guardian wrong-policy grant unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
  BEGIN
    PERFORM public.submit_guardian_privacy_consent(
      'email_marketing', 'email', 'granted', v_policy_id, repeat('a', 64),
      '14000000-0000-4000-8000-000000000041', 'g014-guardian-wrong-purpose-denial',
      '14000000-0000-4000-8000-000000000076'
    );
    RAISE EXCEPTION 'guardian wrong-purpose grant unexpectedly succeeded';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.submit_guardian_privacy_consent(
      'privacy_required', 'email', 'granted', v_policy_id, repeat('a', 64),
      '14000000-0000-4000-8000-000000000041', 'g014-guardian-wrong-channel-denial',
      '14000000-0000-4000-8000-000000000077'
    );
    RAISE EXCEPTION 'guardian wrong-channel grant unexpectedly succeeded';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.submit_guardian_privacy_consent(
      'privacy_required', 'none', 'withdrawn', v_policy_id, repeat('a', 64), NULL,
      'g014-guardian-null-evidence-denial-01', '14000000-0000-4000-8000-000000000078'
    );
    RAISE EXCEPTION 'guardian NULL evidence withdrawal unexpectedly succeeded';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;
  END;
  SELECT profile.status INTO v_stale_profile_status
  FROM privacy_retention.privacy_age_profiles AS profile
  WHERE profile.user_id = '14000000-0000-4000-8000-000000000005';
  IF v_stale_profile_status IS DISTINCT FROM 'guardian_verified' THEN
    RAISE EXCEPTION 'expired guardian stale eligibility fixture was not persisted';
  END IF;
  v_eligibility := public.get_privacy_eligibility_for_user('14000000-0000-4000-8000-000000000005');
  IF (v_eligibility ->> 'eligible')::boolean
     OR v_eligibility ->> 'reasonCode' <> 'PRIVACY_GUARDIAN_REQUIRED' THEN
    RAISE EXCEPTION 'expired guardian was treated as currently eligible';
  END IF;
  v_eligibility := public.get_privacy_eligibility_for_user('14000000-0000-4000-8000-000000000004');
  IF (v_eligibility ->> 'eligible')::boolean
     OR v_eligibility ->> 'reasonCode' <> 'PRIVACY_GUARDIAN_CONSENT_REQUIRED' THEN
    RAISE EXCEPTION 'guardian withdrawal was treated as an active consent grant';
  END IF;
  v_guardian_status := public.read_privacy_guardian_status('14000000-0000-4000-8000-000000000005');
  IF (v_guardian_status ->> 'eligible')::boolean
     OR v_guardian_status ->> 'guardianStatus' = 'verified'
     OR v_guardian_status ->> 'ageStatus' = 'guardian_verified' THEN
    RAISE EXCEPTION 'expired guardian status reported verified eligibility';
  END IF;
  SELECT profile.status INTO v_stale_profile_status
  FROM privacy_retention.privacy_age_profiles AS profile
  WHERE profile.user_id = '14000000-0000-4000-8000-000000000014';
  IF v_stale_profile_status IS DISTINCT FROM 'guardian_verified' THEN
    RAISE EXCEPTION 'future guardian stale eligibility fixture was not persisted';
  END IF;
  v_guardian_status := public.read_privacy_guardian_status('14000000-0000-4000-8000-000000000014');
  IF (v_guardian_status ->> 'eligible')::boolean
     OR v_guardian_status ->> 'guardianStatus' = 'verified'
     OR v_guardian_status ->> 'ageStatus' = 'guardian_verified' THEN
    RAISE EXCEPTION 'future guardian status reported verified eligibility';
  END IF;
  v_guardian_status := public.read_privacy_guardian_status('14000000-0000-4000-8000-000000000004');
  IF (v_guardian_status ->> 'eligible')::boolean
     OR v_guardian_status ->> 'guardianStatus' = 'verified'
     OR v_guardian_status ->> 'ageStatus' = 'guardian_verified' THEN
    RAISE EXCEPTION 'withdrawn guardian consent status reported verified eligibility';
  END IF;
END;
$guardian_consent$;
RESET ROLE;

-- The authenticated surface derives its own subject from auth.uid() and cannot
-- select another user's eligibility.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"14000000-0000-4000-8000-000000000001"}', true);
DO $current_eligibility_self_only$
DECLARE
  v_policy_id uuid := (SELECT id FROM pg_temp.g014_privacy_fixture WHERE fixture = 'policy_current');
  v_eligibility jsonb;
BEGIN
  v_eligibility := public.get_current_privacy_eligibility();
  IF v_eligibility IS DISTINCT FROM pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'eligible', true,
    'reasonCode', 'PRIVACY_ELIGIBLE',
    'policyVersionId', v_policy_id::text,
    'contentSha256', repeat('a', 64)
  )
     OR v_eligibility ? 'userId'
     OR v_eligibility ? 'ageBand'
     OR v_eligibility ? 'guardianStatus' THEN
    RAISE EXCEPTION 'authenticated adult eligibility receipt was not self-only and bounded';
  END IF;
  BEGIN
    PERFORM public.get_privacy_eligibility_for_user('14000000-0000-4000-8000-000000000004');
    RAISE EXCEPTION 'authenticated caller queried another user eligibility';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    '{"role":"authenticated","sub":"14000000-0000-4000-8000-000000000009"}',
    true
  );
  v_eligibility := public.get_current_privacy_eligibility();
  IF (v_eligibility ->> 'eligible')::boolean
     OR v_eligibility ->> 'reasonCode' <> 'PRIVACY_AGE_ATTESTATION_REQUIRED' THEN
    RAISE EXCEPTION 'authenticated missing-profile eligibility was not fail closed';
  END IF;
END;
$current_eligibility_self_only$;
RESET ROLE;

SET LOCAL ROLE anon;
DO $anon_eligibility_denied$
BEGIN
  BEGIN
    PERFORM public.get_current_privacy_eligibility();
    RAISE EXCEPTION 'anon current eligibility unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.get_privacy_eligibility_for_user('14000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'anon targeted eligibility unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$anon_eligibility_denied$;
RESET ROLE;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $service_eligibility_and_policy_drift$
DECLARE
  v_policy_id uuid := (SELECT id FROM pg_temp.g014_privacy_fixture WHERE fixture = 'policy_current');
  v_drift jsonb;
  v_eligibility jsonb;
  v_guardian_status jsonb;
BEGIN
  v_eligibility := public.get_privacy_eligibility_for_user('14000000-0000-4000-8000-000000000001');
  IF (v_eligibility ->> 'eligible')::boolean IS DISTINCT FROM true
     OR v_eligibility ->> 'reasonCode' <> 'PRIVACY_ELIGIBLE' THEN
    RAISE EXCEPTION 'service eligibility did not return the live adult result';
  END IF;
  BEGIN
    PERFORM public.get_privacy_eligibility_for_user(NULL);
    RAISE EXCEPTION 'NULL eligibility target unexpectedly succeeded';
  EXCEPTION
    WHEN invalid_parameter_value THEN NULL;
  END;
  BEGIN
    PERFORM public.get_privacy_eligibility_for_user('14000000-0000-4000-8000-000000000099');
    RAISE EXCEPTION 'nonexistent eligibility target unexpectedly succeeded';
  EXCEPTION
    WHEN no_data_found THEN NULL;
  END;

  v_drift := public.publish_privacy_policy_version(
    'g014-02-policy-v2', 'ko-KR', repeat('b', 64), pg_catalog.clock_timestamp(), v_policy_id,
    'G014-02-TEST-APPROVAL-DRIFT', 'g014-policy-publish-drift-0001'
  );
  IF v_drift ->> 'status' <> 'applied' THEN
    RAISE EXCEPTION 'legal current policy publication for drift did not apply';
  END IF;
  INSERT INTO pg_temp.g014_privacy_fixture (fixture, id)
  VALUES ('policy_drift', (v_drift ->> 'policyVersionId')::uuid);

  v_eligibility := public.get_privacy_eligibility_for_user('14000000-0000-4000-8000-000000000001');
  IF (v_eligibility ->> 'eligible')::boolean
     OR v_eligibility ->> 'reasonCode' <> 'PRIVACY_POLICY_REATTESTATION_REQUIRED'
     OR (v_eligibility ->> 'policyVersionId') <> (v_drift ->> 'policyVersionId')
     OR v_eligibility ->> 'contentSha256' <> repeat('b', 64) THEN
    RAISE EXCEPTION 'current policy drift did not invalidate the adult eligibility receipt';
  END IF;
  v_eligibility := public.get_privacy_eligibility_for_user('14000000-0000-4000-8000-000000000004');
  IF (v_eligibility ->> 'eligible')::boolean
     OR v_eligibility ->> 'reasonCode' <> 'PRIVACY_POLICY_REATTESTATION_REQUIRED' THEN
    RAISE EXCEPTION 'current policy drift did not invalidate child eligibility';
  END IF;
  v_guardian_status := public.read_privacy_guardian_status('14000000-0000-4000-8000-000000000010');
  IF (v_guardian_status ->> 'eligible')::boolean
     OR v_guardian_status ->> 'guardianStatus' = 'verified'
     OR v_guardian_status ->> 'ageStatus' = 'guardian_verified'
     OR v_guardian_status ->> 'reasonCode' <> 'PRIVACY_POLICY_REATTESTATION_REQUIRED' THEN
    RAISE EXCEPTION 'policy drift guardian status reported verified eligibility';
  END IF;
END;
$service_eligibility_and_policy_drift$;
RESET ROLE;

-- Browser identities have no access to service-only publication, guardian,
-- audit, or challenge-transition procedures.
SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"14000000-0000-4000-8000-000000000001"}', true);
DO $authenticated_service_rpc_denial$
DECLARE
  v_policy_id uuid := (SELECT id FROM pg_temp.g014_privacy_fixture WHERE fixture = 'policy_current');
  v_eligibility jsonb;
BEGIN
  v_eligibility := public.get_current_privacy_eligibility();
  IF (v_eligibility ->> 'eligible')::boolean
     OR v_eligibility ->> 'reasonCode' <> 'PRIVACY_POLICY_REATTESTATION_REQUIRED' THEN
    RAISE EXCEPTION 'authenticated self eligibility did not refresh after policy drift';
  END IF;
  BEGIN
    PERFORM public.publish_privacy_policy_version(
      'g014-auth-denied-policy', 'ko-KR', repeat('f', 64), pg_catalog.clock_timestamp() + interval '3 days',
      v_policy_id, 'G014-02-TEST-AUTH-DENIED', 'g014-auth-denied-publish-0001'
    );
    RAISE EXCEPTION 'authenticated policy publication unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.transition_privacy_onboarding_challenge(
      '14000000-0000-4000-8000-000000000052', 'pending', 'consumed',
      '14000000-0000-4000-8000-000000000008', 'g014-auth-denied-transition-01'
    );
    RAISE EXCEPTION 'authenticated challenge transition unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.submit_guardian_privacy_consent(
      'privacy_required', 'none', 'granted', v_policy_id, repeat('a', 64),
      '14000000-0000-4000-8000-000000000041', 'g014-auth-denied-guardian-0001',
      '14000000-0000-4000-8000-000000000079'
    );
    RAISE EXCEPTION 'authenticated guardian consent unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.append_privacy_audit_event(
      'policy_published', NULL, NULL,
      '14000000-0000-4000-8000-000000000095',
      '14000000-0000-4000-8000-000000000096',
      'applied', 'PRIVACY_AUTH_DENIED', '{}'::jsonb,
      '{"requestId":"g014-auth-denied-audit-0001","route":"/api/privacy/policy"}'::jsonb
    );
    RAISE EXCEPTION 'authenticated audit append unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$authenticated_service_rpc_denial$;
RESET ROLE;

ROLLBACK;
