\set ON_ERROR_STOP on

BEGIN;

UPDATE privacy_retention.privacy_retention_classes
SET
  data_class = 'privacy_identity_audit',
  basis_code = 'test.operator_approved_identity_audit',
  trigger_type = 'event_occurred',
  retention_period = interval '90 days',
  status = 'active',
  approved_evidence_ref = 'G010-TEST-IDENTITY-AUDIT',
  version = 'test-v1'
WHERE code = 'privacy_identity_audit';

DO $$
BEGIN
  IF EXISTS (
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
      AND (NOT relation.relrowsecurity OR NOT relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'G010 privacy tables must enable and force RLS';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('anon'::name, 'privacy_policy_versions'::text, 'SELECT'::text),
      ('anon'::name, 'privacy_onboarding_challenges'::text, 'SELECT'::text),
      ('anon'::name, 'privacy_guardian_verifications'::text, 'SELECT'::text),
      ('anon'::name, 'privacy_age_profiles'::text, 'SELECT'::text),
      ('anon'::name, 'privacy_consent_events'::text, 'SELECT'::text),
      ('anon'::name, 'privacy_audit_events'::text, 'SELECT'::text),
      ('authenticated'::name, 'privacy_policy_versions'::text, 'SELECT'::text),
      ('authenticated'::name, 'privacy_onboarding_challenges'::text, 'SELECT'::text),
      ('authenticated'::name, 'privacy_guardian_verifications'::text, 'SELECT'::text),
      ('authenticated'::name, 'privacy_consent_events'::text, 'SELECT'::text),
      ('authenticated'::name, 'privacy_audit_events'::text, 'SELECT'::text),
      ('authenticated'::name, 'privacy_consent_events'::text, 'INSERT'::text),
      ('authenticated'::name, 'privacy_audit_events'::text, 'INSERT'::text)
    ) AS grant_check(role_name, relation_name, privilege_name)
    WHERE pg_catalog.has_table_privilege(role_name, 'public.' || relation_name, privilege_name)
  ) THEN
    RAISE EXCEPTION 'G010 privacy ledgers must not have direct anon/authenticated grants';
  END IF;

  IF NOT pg_catalog.has_table_privilege('authenticated', 'public.privacy_age_profiles', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('authenticated', 'public.privacy_consent_state', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated users need only their derived consent and age read paths';
  END IF;

  IF pg_catalog.has_function_privilege('anon', 'public.submit_privacy_consent(text,text,text,uuid,text,text,uuid,text,uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.submit_privacy_consent(text,text,text,uuid,text,text,uuid,text,uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.read_privacy_guardian_status(uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.read_privacy_guardian_status(uuid)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.read_privacy_guardian_status(uuid)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.privacy_resolve_audit_retention_until(text,timestamptz)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.privacy_resolve_audit_retention_until(text,timestamptz)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', 'public.privacy_resolve_audit_retention_until(text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'G010 RPC grants do not preserve the auth/service boundary';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'privacy_under_14_is_eligible',
        'privacy_validate_age_profile',
        'privacy_validate_consent_event',
        'privacy_refresh_age_profile',
        'privacy_refresh_age_profile_after_consent',
        'privacy_refresh_age_profile_after_guardian',
        'privacy_append_audit_event',
        'get_current_privacy_policy_version',
        'create_privacy_onboarding_challenge',
        'confirm_privacy_onboarding',
        'submit_privacy_consent',
        'record_privacy_guardian_verification',
        'read_privacy_guardian_status'
      )
      AND (
        NOT procedure.prosecdef
        OR COALESCE(pg_catalog.array_to_string(procedure.proconfig, ','), '') NOT LIKE '%search_path=pg_catalog, public%'
      )
  ) THEN
    RAISE EXCEPTION 'G010 SECURITY DEFINER functions must use a fixed search path';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname = 'privacy_resolve_audit_retention_until'
      AND procedure.prosecdef
      AND COALESCE(pg_catalog.array_to_string(procedure.proconfig, ','), '') LIKE '%search_path=pg_catalog, privacy_retention%'
  ) THEN
    RAISE EXCEPTION 'audit retention resolver must be internal and use its exact fixed search path';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
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
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attname ~* '(^|_)(dob|date_of_birth|birth|rrn|resident)($|_)'
  ) THEN
    RAISE EXCEPTION 'G010 privacy schema must not contain DOB or RRN fields';
  END IF;
END;
$$;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
VALUES
  ('00000000-0000-0000-0000-000000000201', 'authenticated', 'authenticated', 'g010-adult@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('00000000-0000-0000-0000-000000000202', 'authenticated', 'authenticated', 'g010-child@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('00000000-0000-0000-0000-000000000203', 'authenticated', 'authenticated', 'g010-other@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

INSERT INTO public.privacy_policy_versions (
  id, version, locale, status, content_sha256, effective_at, published_at, operator_approval_ref
)
VALUES (
  '00000000-0000-0000-0000-000000000101', 'g010-test-v1', 'ko-KR', 'published', repeat('a', 64),
  pg_catalog.clock_timestamp() - interval '1 minute', pg_catalog.clock_timestamp(), 'G010-TEST-APPROVAL'
);

DO $$
BEGIN
  BEGIN
    UPDATE public.privacy_policy_versions
    SET version = 'g010-test-v1-mutated'
    WHERE id = '00000000-0000-0000-0000-000000000101';
    RAISE EXCEPTION 'published policy mutation unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;
END;
$$;

INSERT INTO public.privacy_audit_events (
  id, event_type, operation_id, correlation_id, status, reason_code,
  count_summary, request_metadata, occurred_at, retention_until
)
VALUES (
  '00000000-0000-0000-0000-000000000501', 'foundation_test',
  '00000000-0000-0000-0000-000000000502', '00000000-0000-0000-0000-000000000503',
  'applied', 'FOUNDATION_TEST', '{"requested":1}'::jsonb,
  '{"requestId":"g010-test-request","userAgentFamily":"G010 Test","route":"/test"}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp() + interval '1 minute'
);

DO $$
BEGIN
  BEGIN
    UPDATE public.privacy_audit_events
    SET reason_code = 'MUTATED'
    WHERE id = '00000000-0000-0000-0000-000000000501';
    RAISE EXCEPTION 'audit mutation unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.privacy_audit_events (
      event_type, operation_id, correlation_id, status, reason_code,
      count_summary, request_metadata, retention_until
    ) VALUES (
      'unsafe_audit_test', '00000000-0000-0000-0000-000000000504', '00000000-0000-0000-0000-000000000505',
      'applied', 'UNSAFE_AUDIT_TEST', '{"requested":1}'::jsonb,
      '{"email":"g010-adult@example.invalid"}'::jsonb, pg_catalog.clock_timestamp() + interval '1 minute'
    );
    RAISE EXCEPTION 'unsafe audit metadata unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;

  BEGIN
    INSERT INTO public.privacy_audit_events (
      event_type, operation_id, correlation_id, status, reason_code,
      count_summary, request_metadata, retention_until
    ) VALUES (
      'unsafe_audit_test', '00000000-0000-0000-0000-000000000506', '00000000-0000-0000-0000-000000000507',
      'applied', 'UNSAFE_AUDIT_TEST', '{"requested":1}'::jsonb,
      '{"request_id":"legacy-snake-case"}'::jsonb, pg_catalog.clock_timestamp() + interval '1 minute'
    );
    RAISE EXCEPTION 'legacy snake-case audit metadata unexpectedly succeeded';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT public.create_privacy_onboarding_challenge(
  pg_catalog.encode(extensions.digest('g010-test-challenge-token', 'sha256'), 'hex'),
  '00000000-0000-0000-0000-000000000101',
  'age_14_plus',
  '{"email":true}'::jsonb
);
RESET ROLE;

SELECT pg_catalog.set_config('g010.challenge_id', id::text, true)
FROM public.privacy_onboarding_challenges
WHERE token_hash = pg_catalog.encode(extensions.digest('g010-test-challenge-token', 'sha256'), 'hex');

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT public.confirm_privacy_onboarding(
  pg_catalog.current_setting('g010.challenge_id')::uuid,
  'g010-test-challenge-token',
  '00000000-0000-0000-0000-000000000201',
  'password_signup'
);
SELECT public.confirm_privacy_onboarding(
  pg_catalog.current_setting('g010.challenge_id')::uuid,
  'g010-test-challenge-token',
  '00000000-0000-0000-0000-000000000201',
  'password_signup'
);
RESET ROLE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.privacy_onboarding_challenges
    WHERE id = pg_catalog.current_setting('g010.challenge_id')::uuid
      AND consumed_at IS NOT NULL
      AND consumed_by_user_id = '00000000-0000-0000-0000-000000000201'
  ) THEN
    RAISE EXCEPTION 'onboarding challenge was not consumed exactly once';
  END IF;
END;
$$;

INSERT INTO public.privacy_age_profiles (
  user_id, age_band, attested_at, method, status, policy_version_id
)
VALUES (
  '00000000-0000-0000-0000-000000000203', 'age_14_plus', pg_catalog.clock_timestamp(),
  'self_attestation', 'eligible', '00000000-0000-0000-0000-000000000101'
);

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated","sub":"00000000-0000-0000-0000-000000000201"}', true);
DO $$
DECLARE
  v_age_count integer;
  v_state_count integer;
BEGIN
  SELECT count(*) INTO v_age_count FROM public.privacy_age_profiles;
  SELECT count(*) INTO v_state_count FROM public.privacy_consent_state;
  IF v_age_count <> 1 OR v_state_count < 1 THEN
    RAISE EXCEPTION 'owner RLS did not isolate current privacy state';
  END IF;

  BEGIN
    PERFORM 1 FROM public.privacy_consent_events;
    RAISE EXCEPTION 'direct consent-ledger read unexpectedly succeeded';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END;
$$;
SELECT public.submit_privacy_consent(
  'email_marketing', 'email', 'granted', '00000000-0000-0000-0000-000000000101', repeat('a', 64),
  'settings', NULL, 'g010-consent-idempotency-0001', '00000000-0000-0000-0000-000000000601'
);
SELECT public.submit_privacy_consent(
  'email_marketing', 'email', 'granted', '00000000-0000-0000-0000-000000000101', repeat('a', 64),
  'settings', NULL, 'g010-consent-idempotency-0001', '00000000-0000-0000-0000-000000000601'
);
RESET ROLE;

DO $$
BEGIN
  IF (
    SELECT count(*)
    FROM public.privacy_consent_events
    WHERE idempotency_key = 'g010-consent-idempotency-0001'
  ) <> 1 THEN
    RAISE EXCEPTION 'consent idempotency did not return the original event';
  END IF;

  BEGIN
    UPDATE public.privacy_consent_events
    SET decision = 'withdrawn'
    WHERE idempotency_key = 'g010-consent-idempotency-0001';
    RAISE EXCEPTION 'consent mutation unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    INSERT INTO public.privacy_age_profiles (
      user_id, age_band, attested_at, method, status, policy_version_id
    ) VALUES (
      '00000000-0000-0000-0000-000000000202', 'under_14', pg_catalog.clock_timestamp(),
      'verified_provider', 'guardian_verified', '00000000-0000-0000-0000-000000000101'
    );
    RAISE EXCEPTION 'under-14 eligibility unexpectedly bypassed guardian proof';
  EXCEPTION
    WHEN check_violation THEN NULL;
  END;
END;
$$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT public.record_privacy_guardian_verification(
  '00000000-0000-0000-0000-000000000301',
  '00000000-0000-0000-0000-000000000202',
  'verified',
  'g010-test-provider',
  repeat('b', 64),
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp() + interval '1 day'
);
RESET ROLE;

INSERT INTO public.privacy_age_profiles (
  user_id, age_band, attested_at, method, status, policy_version_id
)
VALUES (
  '00000000-0000-0000-0000-000000000202', 'under_14', pg_catalog.clock_timestamp(),
  'verified_provider', 'guardian_pending', '00000000-0000-0000-0000-000000000101'
);
INSERT INTO public.privacy_consent_events (
  user_id, subject_kind, guardian_verification_id, purpose, channel, decision,
  policy_version_id, notice_sha256, source, correlation_id, idempotency_key
)
VALUES (
  '00000000-0000-0000-0000-000000000202', 'child', '00000000-0000-0000-0000-000000000301',
  'privacy_required', 'none', 'granted', '00000000-0000-0000-0000-000000000101', repeat('a', 64),
  'guardian', '00000000-0000-0000-0000-000000000701', 'g010-guardian-consent-granted-01'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.privacy_age_profiles
    WHERE user_id = '00000000-0000-0000-0000-000000000202'
      AND status = 'guardian_verified'
  ) THEN
    RAISE EXCEPTION 'verified guardian plus matching consent did not unlock under-14 state';
  END IF;
END;
$$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $$
DECLARE
  v_status jsonb;
BEGIN
  v_status := public.read_privacy_guardian_status('00000000-0000-0000-0000-000000000202');
  IF v_status ->> 'guardianStatus' <> 'verified'
     OR v_status ->> 'ageStatus' <> 'guardian_verified'
     OR (v_status ->> 'eligible')::boolean IS DISTINCT FROM true
     OR v_status ->> 'verificationId' <> '00000000-0000-0000-0000-000000000301' THEN
    RAISE EXCEPTION 'service-role guardian status readback did not preserve eligibility invariants';
  END IF;
END;
$$;
RESET ROLE;

INSERT INTO public.privacy_consent_events (
  user_id, subject_kind, guardian_verification_id, purpose, channel, decision,
  policy_version_id, notice_sha256, source, correlation_id, idempotency_key
)
VALUES (
  '00000000-0000-0000-0000-000000000202', 'child', '00000000-0000-0000-0000-000000000301',
  'privacy_required', 'none', 'withdrawn', '00000000-0000-0000-0000-000000000101', repeat('a', 64),
  'guardian', '00000000-0000-0000-0000-000000000702', 'g010-guardian-consent-withdrawn-01'
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.privacy_age_profiles
    WHERE user_id = '00000000-0000-0000-0000-000000000202'
      AND status = 'guardian_pending'
  ) THEN
    RAISE EXCEPTION 'withdrawn guardian consent did not remove under-14 eligibility';
  END IF;
END;
$$;

ROLLBACK;
