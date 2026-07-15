\set ON_ERROR_STOP on

BEGIN;

-- G014-03 catalog, privilege, and state-machine contract.
DO $catalog_contract$
DECLARE
  v_signature text;
  v_oid oid;
  v_search_path text;
BEGIN
  IF pg_catalog.to_regclass('privacy_retention.marketing_campaign_batch_recipients') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.marketing_campaign_consent_evidence_keys') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.marketing_campaign_provider_attempts') IS NULL THEN
    RAISE EXCEPTION 'G014-03 private marketing state relations are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'privacy_retention.marketing_campaign_batch_recipients'::regclass
      AND constraint_row.conname = 'g014_marketing_batch_recipients_batch_operation_fk'
      AND constraint_row.contype = 'f'
      AND NOT constraint_row.convalidated
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'privacy_retention.marketing_campaign_batch_recipients'::regclass
      AND constraint_row.conname = 'g014_marketing_batch_recipients_operation_recipient_fk'
      AND constraint_row.contype = 'f'
      AND NOT constraint_row.convalidated
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'privacy_retention.marketing_campaign_batch_recipients'::regclass
      AND constraint_row.conname = 'g014_marketing_batch_recipients_ordinary_consent_binding_fk'
      AND constraint_row.contype = 'f'
      AND NOT constraint_row.convalidated
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'privacy_retention.marketing_campaign_consent_evidence_keys'::regclass
      AND constraint_row.conname = 'g014_marketing_consent_evidence_exact_consent_fk'
      AND constraint_row.contype = 'f'
      AND NOT constraint_row.convalidated
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'privacy_retention.marketing_campaign_provider_attempts'::regclass
      AND constraint_row.conname = 'g014_marketing_provider_attempt_receipt_check'
      AND constraint_row.contype = 'c'
      AND NOT constraint_row.convalidated
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'privacy_retention.marketing_campaign_provider_attempts'::regclass
      AND trigger_row.tgname = 'g014_marketing_provider_attempt_no_delete'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'G014-03 named NOT VALID and append-only provider-attempt constraints are missing';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'privacy_retention.marketing_campaign_batch_recipients'::regclass
      AND constraint_row.conname = 'g014_marketing_batch_recipients_transport_notification_shape_check'
      AND constraint_row.contype = 'c'
      AND NOT constraint_row.convalidated
  ) THEN
    RAISE EXCEPTION 'G014-03 provider-accepted transport/notification shape constraint is missing';
  END IF;

  v_oid := pg_catalog.to_regprocedure('privacy_retention.g014_require_active_admin_actor(uuid)');
  SELECT setting.value INTO v_search_path
  FROM pg_catalog.unnest(
    (SELECT procedure.proconfig FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_oid)
  ) AS setting(value)
  WHERE setting.value LIKE 'search_path=%';
  IF v_oid IS NULL
     OR NOT (SELECT procedure.prosecdef FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_oid)
     OR pg_catalog.pg_get_userbyid(
       (SELECT procedure.proowner FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_oid)
     ) IS DISTINCT FROM 'privacy_workflow_owner'
     OR (v_search_path IS DISTINCT FROM 'search_path=' AND v_search_path IS DISTINCT FROM 'search_path=""')
     OR pg_catalog.has_function_privilege(
       'service_role',
       'privacy_retention.g014_require_active_admin_actor(uuid)',
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'G014-03 active-admin helper contract is not private and definer-locked';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_index AS index_row
    WHERE index_row.indexrelid = 'public.g014_marketing_campaign_one_active_batch_idx'::regclass
      AND index_row.indpred IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'G014-03 one-active-batch partial index is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.claim_marketing_campaign_dispatch(uuid,uuid,uuid,text,text,text)'),
      ('public.fail_marketing_campaign_provider_attempt(uuid,uuid,uuid,text,uuid,uuid,text,text,text,text)'),
      ('public.finalize_marketing_campaign_batch(uuid,uuid,uuid,text,uuid,uuid,text,text,text,uuid[],text)'),
      ('public.evaluate_notification_marketing_permission(uuid,text,timestamptz,text)')
    ) AS expected(signature)
    WHERE pg_catalog.to_regprocedure(expected.signature) IS NULL
  ) THEN
    RAISE EXCEPTION 'G014-03 required public RPC identity is missing';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.claim_marketing_campaign_dispatch(uuid,uuid,uuid,text,text,text)',
    'public.fail_marketing_campaign_provider_attempt(uuid,uuid,uuid,text,uuid,uuid,text,text,text,text)',
    'public.finalize_marketing_campaign_batch(uuid,uuid,uuid,text,uuid,uuid,text,text,text,uuid[],text)',
    'public.prepare_marketing_campaign_batch(uuid,uuid,text,text,integer,text)',
    'public.fail_marketing_campaign_batch(uuid,uuid,uuid,text,text)',
    'public.evaluate_notification_marketing_permission(uuid,text,timestamptz,text)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    SELECT setting.value INTO v_search_path
    FROM pg_catalog.unnest((SELECT procedure.proconfig FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_oid)) AS setting(value)
    WHERE setting.value LIKE 'search_path=%';
    IF NOT (SELECT procedure.prosecdef FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_oid)
       OR pg_catalog.pg_get_userbyid((SELECT procedure.proowner FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_oid)) IS DISTINCT FROM 'privacy_workflow_owner'
       OR (v_search_path IS DISTINCT FROM 'search_path=' AND v_search_path IS DISTINCT FROM 'search_path=""') THEN
      RAISE EXCEPTION 'G014-03 owner/definer/empty search_path contract failed for %', v_signature;
    END IF;
  END LOOP;

  IF pg_catalog.has_function_privilege('authenticated', 'public.claim_marketing_campaign_dispatch(uuid,uuid,uuid,text,text,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', 'public.claim_marketing_campaign_dispatch(uuid,uuid,uuid,text,text,text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.claim_marketing_campaign_dispatch(uuid,uuid,uuid,text,text,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.fail_marketing_campaign_provider_attempt(uuid,uuid,uuid,text,uuid,uuid,text,text,text,text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.fail_marketing_campaign_provider_attempt(uuid,uuid,uuid,text,uuid,uuid,text,text,text,text)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.finalize_marketing_campaign_batch(uuid,uuid,uuid,text,uuid,uuid,text,text,text,uuid[],text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.finalize_marketing_campaign_batch(uuid,uuid,uuid,text,uuid,uuid,text,text,text,uuid[],text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'G014-03 marketing RPC grant matrix is not fail closed';
  END IF;

  IF pg_catalog.has_table_privilege('service_role', 'public.notifications', 'INSERT')
     OR pg_catalog.has_table_privilege('service_role', 'public.notifications', 'UPDATE')
     OR pg_catalog.has_table_privilege('service_role', 'public.notifications', 'DELETE')
     OR pg_catalog.has_table_privilege('service_role', 'public.notifications', 'TRUNCATE')
     OR pg_catalog.has_table_privilege('service_role', 'public.marketing_campaign_operations', 'INSERT')
     OR pg_catalog.has_table_privilege('service_role', 'public.marketing_campaign_recipients', 'UPDATE')
     OR pg_catalog.has_table_privilege('service_role', 'public.marketing_campaign_batches', 'TRUNCATE')
     OR pg_catalog.has_table_privilege('service_role', 'privacy_retention.marketing_campaign_batch_recipients', 'DELETE')
     OR pg_catalog.has_table_privilege('service_role', 'privacy_retention.marketing_campaign_consent_evidence_keys', 'TRUNCATE')
     OR pg_catalog.has_table_privilege('service_role', 'privacy_retention.marketing_campaign_provider_attempts', 'INSERT')
     OR pg_catalog.has_table_privilege('service_role', 'privacy_retention.marketing_campaign_provider_attempts', 'UPDATE')
     OR pg_catalog.has_table_privilege('service_role', 'privacy_retention.marketing_campaign_provider_attempts', 'TRUNCATE') THEN
    RAISE EXCEPTION 'G014-03 service direct marketing DML/TRUNCATE is unexpectedly allowed';
  END IF;
  PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
END;
$catalog_contract$;


CREATE TEMPORARY TABLE pg_temp.g014_marketing_fixture (
  fixture text PRIMARY KEY,
  id uuid NOT NULL
) ON COMMIT DROP;
CREATE FUNCTION pg_temp.g014_marketing_state_hash(p_operation_id uuid)
RETURNS jsonb
LANGUAGE sql
SET search_path = ''
AS $state_hash$
  SELECT pg_catalog.jsonb_build_object(
    'operations', pg_catalog.encode(extensions.digest(COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(operation) ORDER BY operation.id)::text
      FROM public.marketing_campaign_operations AS operation
      WHERE operation.id = p_operation_id
    ), '[]'), 'sha256'), 'hex'),
    'batches', pg_catalog.encode(extensions.digest(COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(batch) ORDER BY batch.id)::text
      FROM public.marketing_campaign_batches AS batch
      WHERE batch.operation_id = p_operation_id
    ), '[]'), 'sha256'), 'hex'),
    'recipients', pg_catalog.encode(extensions.digest(COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(recipient) ORDER BY recipient.user_id)::text
      FROM public.marketing_campaign_recipients AS recipient
      WHERE recipient.operation_id = p_operation_id
    ), '[]'), 'sha256'), 'hex'),
    'batchRecipients', pg_catalog.encode(extensions.digest(COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(mapping) ORDER BY mapping.batch_id, mapping.user_id)::text
      FROM privacy_retention.marketing_campaign_batch_recipients AS mapping
      WHERE mapping.operation_id = p_operation_id
    ), '[]'), 'sha256'), 'hex'),
    'notifications', pg_catalog.encode(extensions.digest(COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(notification) ORDER BY notification.id)::text
      FROM public.notifications AS notification
      WHERE notification.campaign_operation_id = p_operation_id
    ), '[]'), 'sha256'), 'hex'),
    'attempts', pg_catalog.encode(extensions.digest(COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(attempt) ORDER BY attempt.id)::text
      FROM privacy_retention.marketing_campaign_provider_attempts AS attempt
      WHERE attempt.operation_id = p_operation_id
    ), '[]'), 'sha256'), 'hex'),
    'evidence', pg_catalog.encode(extensions.digest(COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(evidence) ORDER BY evidence.id)::text
      FROM privacy_retention.marketing_campaign_consent_evidence_keys AS evidence
      WHERE evidence.operation_id = p_operation_id
    ), '[]'), 'sha256'), 'hex'),
    'audit', pg_catalog.encode(extensions.digest(COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(audit) ORDER BY audit.id)::text
      FROM privacy_retention.privacy_audit_events AS audit
      WHERE audit.operation_id = p_operation_id
    ), '[]'), 'sha256'), 'hex')
  );
$state_hash$;

-- The guardian fixtures are otherwise identical eligible child records. At each
-- evaluator, prepare, claim, and finalize boundary, only expiry, withdrawal, or
-- future verification may explain their denial.
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('14300000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'g014-marketing-actor@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14300000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'g014-marketing-adult@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14300000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'g014-marketing-withdrawn@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14300000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'g014-marketing-unrelated@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14300000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'g014-marketing-guardian-live@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14300000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'g014-marketing-guardian-expired@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14300000-0000-4000-8000-000000000007', 'authenticated', 'authenticated', 'g014-marketing-guardian-withdrawn@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14300000-0000-4000-8000-000000000008', 'authenticated', 'authenticated', 'g014-marketing-guardian-future@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14300000-0000-4000-8000-000000000009', 'authenticated', 'authenticated', 'g014-marketing-guardian-finalize@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('14300000-0000-4000-8000-000000000010', 'authenticated', 'authenticated', 'g014-marketing-admin-fence@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

INSERT INTO public.user_roles (user_id, role)
VALUES
  ('14300000-0000-4000-8000-000000000001', 'admin'),
  ('14300000-0000-4000-8000-000000000010', 'admin')
ON CONFLICT (user_id, role) DO NOTHING;
INSERT INTO public.user_account_status (user_id, account_status, disabled_at)
VALUES
  ('14300000-0000-4000-8000-000000000001', 'active', NULL),
  ('14300000-0000-4000-8000-000000000010', 'active', NULL)
ON CONFLICT (user_id) DO UPDATE
SET account_status = EXCLUDED.account_status,
    disabled_at = EXCLUDED.disabled_at;

DO $seed_policy_and_evidence$
DECLARE
  v_policy privacy_retention.privacy_policy_versions%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  SELECT * INTO v_policy
  FROM privacy_retention.privacy_policy_versions AS policy
  WHERE policy.status = 'published' AND policy.effective_at <= v_now
  ORDER BY policy.effective_at DESC, policy.id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO privacy_retention.privacy_policy_versions (
      id, version, locale, status, content_sha256, effective_at, published_at, operator_approval_ref
    ) VALUES (
      '14300000-0000-4000-8000-000000000090', 'g014-marketing-fixture-v1', 'ko-KR', 'published',
      repeat('a', 64), v_now - interval '1 minute', v_now - interval '1 minute', 'G014-03-TEST-APPROVAL'
    ) RETURNING * INTO v_policy;
  END IF;
  INSERT INTO pg_temp.g014_marketing_fixture (fixture, id) VALUES ('policy', v_policy.id);

  INSERT INTO privacy_retention.privacy_age_profiles (user_id, age_band, attested_at, method, status, policy_version_id)
  VALUES
    ('14300000-0000-4000-8000-000000000002', 'age_14_plus', v_now, 'self_attestation', 'eligible', v_policy.id),
    ('14300000-0000-4000-8000-000000000003', 'age_14_plus', v_now, 'self_attestation', 'eligible', v_policy.id),
    ('14300000-0000-4000-8000-000000000004', 'age_14_plus', v_now, 'self_attestation', 'eligible', v_policy.id),
    ('14300000-0000-4000-8000-000000000005', 'under_14', v_now, 'verified_provider', 'guardian_verified', v_policy.id),
    ('14300000-0000-4000-8000-000000000006', 'under_14', v_now, 'verified_provider', 'guardian_verified', v_policy.id),
    ('14300000-0000-4000-8000-000000000007', 'under_14', v_now, 'verified_provider', 'guardian_verified', v_policy.id),
    ('14300000-0000-4000-8000-000000000008', 'under_14', v_now, 'verified_provider', 'guardian_verified', v_policy.id),
    ('14300000-0000-4000-8000-000000000009', 'under_14', v_now, 'verified_provider', 'guardian_verified', v_policy.id);
  INSERT INTO privacy_retention.privacy_guardian_verifications (
    id, child_user_id, status, provider, provider_reference_hash, verified_at, expires_at, withdrawn_at
  ) VALUES
    ('14300000-0000-4000-8000-000000000041', '14300000-0000-4000-8000-000000000005', 'verified', 'g014-test', repeat('1', 64), v_now - interval '1 day', v_now + interval '1 day', NULL),
    ('14300000-0000-4000-8000-000000000042', '14300000-0000-4000-8000-000000000006', 'verified', 'g014-test', repeat('2', 64), v_now - interval '1 day', v_now - interval '1 second', NULL),
    ('14300000-0000-4000-8000-000000000043', '14300000-0000-4000-8000-000000000007', 'verified', 'g014-test', repeat('3', 64), v_now - interval '1 day', v_now + interval '1 day', v_now - interval '1 second'),
    ('14300000-0000-4000-8000-000000000044', '14300000-0000-4000-8000-000000000008', 'verified', 'g014-test', repeat('4', 64), v_now + interval '1 day', v_now + interval '2 days', NULL),
    ('14300000-0000-4000-8000-000000000045', '14300000-0000-4000-8000-000000000009', 'verified', 'g014-test', repeat('5', 64), v_now - interval '1 day', v_now + interval '1 day', NULL);

  INSERT INTO privacy_retention.privacy_consent_events (
    user_id, subject_kind, guardian_verification_id, purpose, channel, decision,
    policy_version_id, notice_sha256, source, correlation_id, idempotency_key, occurred_at
  ) VALUES
    ('14300000-0000-4000-8000-000000000005', 'child', '14300000-0000-4000-8000-000000000041', 'privacy_required', 'none', 'granted', v_policy.id, v_policy.content_sha256, 'guardian', extensions.gen_random_uuid(), 'g014guardianliveprivacy001', v_now - interval '3 seconds'),
    ('14300000-0000-4000-8000-000000000006', 'child', '14300000-0000-4000-8000-000000000042', 'privacy_required', 'none', 'granted', v_policy.id, v_policy.content_sha256, 'guardian', extensions.gen_random_uuid(), 'g014guardianexpiredprivacy1', v_now - interval '3 seconds'),
    ('14300000-0000-4000-8000-000000000007', 'child', '14300000-0000-4000-8000-000000000043', 'privacy_required', 'none', 'granted', v_policy.id, v_policy.content_sha256, 'guardian', extensions.gen_random_uuid(), 'g014guardianwithdrawprivacy', v_now - interval '3 seconds'),
    ('14300000-0000-4000-8000-000000000008', 'child', '14300000-0000-4000-8000-000000000044', 'privacy_required', 'none', 'granted', v_policy.id, v_policy.content_sha256, 'guardian', extensions.gen_random_uuid(), 'g014guardianfutureprivacy01', v_now - interval '3 seconds'),
    ('14300000-0000-4000-8000-000000000009', 'child', '14300000-0000-4000-8000-000000000045', 'privacy_required', 'none', 'granted', v_policy.id, v_policy.content_sha256, 'guardian', extensions.gen_random_uuid(), 'g014guardianfinalprivacy01', v_now - interval '3 seconds');

  INSERT INTO privacy_retention.privacy_consent_events (
    user_id, subject_kind, guardian_verification_id, purpose, channel, decision,
    policy_version_id, notice_sha256, source, correlation_id, idempotency_key, occurred_at
  ) VALUES
    ('14300000-0000-4000-8000-000000000005', 'child', '14300000-0000-4000-8000-000000000041', 'sms_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256, 'guardian', extensions.gen_random_uuid(), 'g014guardianlivesms0001', v_now - interval '2 seconds'),
    ('14300000-0000-4000-8000-000000000005', 'child', '14300000-0000-4000-8000-000000000041', 'night_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256, 'guardian', extensions.gen_random_uuid(), 'g014guardianlivenight01', v_now - interval '1 second'),
    ('14300000-0000-4000-8000-000000000006', 'child', '14300000-0000-4000-8000-000000000042', 'sms_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256, 'guardian', extensions.gen_random_uuid(), 'g014guardianexpiredsms01', v_now - interval '2 seconds'),
    ('14300000-0000-4000-8000-000000000006', 'child', '14300000-0000-4000-8000-000000000042', 'night_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256, 'guardian', extensions.gen_random_uuid(), 'g014guardianexpirednight', v_now - interval '1 second'),
    ('14300000-0000-4000-8000-000000000007', 'child', '14300000-0000-4000-8000-000000000043', 'sms_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256, 'guardian', extensions.gen_random_uuid(), 'g014guardianwithdrawsms', v_now - interval '2 seconds'),
    ('14300000-0000-4000-8000-000000000007', 'child', '14300000-0000-4000-8000-000000000043', 'night_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256, 'guardian', extensions.gen_random_uuid(), 'g014guardianwithdrawnight', v_now - interval '1 second'),
    ('14300000-0000-4000-8000-000000000008', 'child', '14300000-0000-4000-8000-000000000044', 'sms_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256, 'guardian', extensions.gen_random_uuid(), 'g014guardianfuturesms001', v_now - interval '2 seconds'),
    ('14300000-0000-4000-8000-000000000008', 'child', '14300000-0000-4000-8000-000000000044', 'night_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256, 'guardian', extensions.gen_random_uuid(), 'g014guardianfuturenight1', v_now - interval '1 second'),
    ('14300000-0000-4000-8000-000000000009', 'child', '14300000-0000-4000-8000-000000000045', 'sms_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256, 'guardian', extensions.gen_random_uuid(), 'g014guardianfinalsms001', v_now - interval '2 seconds'),
    ('14300000-0000-4000-8000-000000000009', 'child', '14300000-0000-4000-8000-000000000045', 'night_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256, 'guardian', extensions.gen_random_uuid(), 'g014guardianfinalnight1', v_now - interval '1 second');

  INSERT INTO privacy_retention.privacy_consent_events (
    user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256,
    source, correlation_id, idempotency_key, occurred_at
  ) VALUES
    ('14300000-0000-4000-8000-000000000002', 'self', 'sms_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256, 'settings', extensions.gen_random_uuid(), 'g014marketingadultsms0001', v_now - interval '2 seconds'),
    ('14300000-0000-4000-8000-000000000002', 'self', 'night_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256, 'settings', extensions.gen_random_uuid(), 'g014marketingadultnight01', v_now - interval '1 second'),
    ('14300000-0000-4000-8000-000000000002', 'self', 'email_marketing', 'email', 'granted', v_policy.id, v_policy.content_sha256, 'settings', extensions.gen_random_uuid(), 'g014marketingadultemail1', v_now - interval '1 second'),
    ('14300000-0000-4000-8000-000000000003', 'self', 'sms_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256, 'settings', extensions.gen_random_uuid(), 'g014marketingwithdrawg01', v_now - interval '2 seconds'),
    ('14300000-0000-4000-8000-000000000003', 'self', 'sms_marketing', 'sms', 'withdrawn', v_policy.id, v_policy.content_sha256, 'settings', extensions.gen_random_uuid(), 'g014marketingwithdrawn01', v_now - interval '1 second'),
    ('14300000-0000-4000-8000-000000000004', 'self', 'push_marketing', 'push', 'granted', v_policy.id, v_policy.content_sha256, 'settings', extensions.gen_random_uuid(), 'g014marketingunrelated01', v_now - interval '1 second');
END;
$seed_policy_and_evidence$;

-- auth.uid is deliberately NULL and then a different user: the service evaluator
-- must consult the private immutable base ledger for the requested user, never
-- the owner-filtered public view.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT pg_catalog.set_config('request.jwt.claim.sub', '', true);
DO $permission_boundaries$
DECLARE
  v_allowed boolean;
  v_reason text;
  v_timezone text;
BEGIN
  SELECT allowed, reason_code INTO v_allowed, v_reason
  FROM public.evaluate_notification_marketing_permission(
    '14300000-0000-4000-8000-000000000002', 'sms', '2026-07-12 20:59:00+09', 'Asia/Seoul'
  );
  IF v_allowed IS DISTINCT FROM true OR v_reason IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION '20:59 ordinary consent should be allowed';
  END IF;
  SELECT allowed, reason_code INTO v_allowed, v_reason
  FROM public.evaluate_notification_marketing_permission(
    '14300000-0000-4000-8000-000000000002', 'sms', '2026-07-12 21:00:00+09', 'Asia/Seoul'
  );
  IF v_allowed IS DISTINCT FROM true OR v_reason IS DISTINCT FROM 'allowed' THEN
    RAISE EXCEPTION '21:00 exact night consent should be allowed';
  END IF;
  SELECT allowed, reason_code INTO v_allowed, v_reason
  FROM public.evaluate_notification_marketing_permission(
    '14300000-0000-4000-8000-000000000002', 'sms', '2026-07-13 07:59:00+09', 'Asia/Seoul'
  );
  IF v_allowed IS DISTINCT FROM true THEN
    RAISE EXCEPTION '07:59 exact night consent should be allowed';
  END IF;
  SELECT allowed, reason_code INTO v_allowed, v_reason
  FROM public.evaluate_notification_marketing_permission(
    '14300000-0000-4000-8000-000000000002', 'sms', '2026-07-13 08:00:00+09', 'Asia/Seoul'
  );
  IF v_allowed IS DISTINCT FROM true THEN
    RAISE EXCEPTION '08:00 ordinary consent should be allowed';
  END IF;
  SELECT allowed, reason_code INTO v_allowed, v_reason
  FROM public.evaluate_notification_marketing_permission(
    '14300000-0000-4000-8000-000000000003', 'sms', '2026-07-12 20:59:00+09', 'Asia/Seoul'
  );
  IF v_allowed IS DISTINCT FROM false OR v_reason IS DISTINCT FROM 'ordinary_consent_missing' THEN
    RAISE EXCEPTION 'withdrawn latest consent must fail closed';
  END IF;
  SELECT allowed, reason_code INTO v_allowed, v_reason
  FROM public.evaluate_notification_marketing_permission(
    '14300000-0000-4000-8000-000000000004', 'sms', '2026-07-12 20:59:00+09', 'Asia/Seoul'
  );
  IF v_allowed IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'unrelated channel/purpose evidence must fail closed';
  END IF;
  SELECT allowed INTO v_allowed
  FROM public.evaluate_notification_marketing_permission(
    '14300000-0000-4000-8000-000000000005', 'sms', '2026-07-12 21:00:00+09', 'Asia/Seoul'
  );
  IF v_allowed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'live guardian and child-bound consent should be allowed';
  END IF;
  FOREACH v_reason IN ARRAY ARRAY[
    '14300000-0000-4000-8000-000000000006',
    '14300000-0000-4000-8000-000000000007',
    '14300000-0000-4000-8000-000000000008'
  ] LOOP
    SELECT allowed INTO v_allowed
    FROM public.evaluate_notification_marketing_permission(
      v_reason::uuid, 'sms', '2026-07-12 21:00:00+09', 'Asia/Seoul'
    );
    IF v_allowed IS DISTINCT FROM false THEN
      RAISE EXCEPTION 'expired, withdrawn, or future guardian evidence must fail closed';
    END IF;
  END LOOP;
  PERFORM pg_catalog.set_config('request.jwt.claim.sub', '14300000-0000-4000-8000-000000000004', true);
  SELECT allowed INTO v_allowed
  FROM public.evaluate_notification_marketing_permission(
    '14300000-0000-4000-8000-000000000002', 'email', '2026-07-12 21:00:00+09', 'Asia/Seoul'
  );
  IF v_allowed IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'different auth.uid must not alter service evaluator target';
  END IF;
  BEGIN
    PERFORM public.evaluate_notification_marketing_permission(
      '14300000-0000-4000-8000-000000000002', 'sms', '2026-07-12 21:00:00+09', NULL
    );
    RAISE EXCEPTION USING ERRCODE = 'P9999', MESSAGE = 'marketing evaluator accepted NULL timezone';
  EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
  END;
  FOREACH v_timezone IN ARRAY ARRAY['UTC', 'ROK', 'Asia/Seoul '] LOOP
    BEGIN
      PERFORM public.evaluate_notification_marketing_permission(
        '14300000-0000-4000-8000-000000000002', 'sms', '2026-07-12 21:00:00+09', v_timezone
      );
      RAISE EXCEPTION USING ERRCODE = 'P9999', MESSAGE = 'marketing evaluator accepted non-Korea timezone';
    EXCEPTION WHEN SQLSTATE '22023' THEN NULL;
    END;
  END LOOP;
END;
$permission_boundaries$;
RESET ROLE;
-- Every direct mutator is denied to service_role. The permitted positive control is
-- the constrained preview RPC below, not an alternate table-write capability.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $direct_service_dml_denied$
DECLARE
  v_relation text;
  v_action text;
  v_code text;
  v_update text;
  v_preview jsonb;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'public.notifications',
    'public.marketing_campaign_operations',
    'public.marketing_campaign_recipients',
    'public.marketing_campaign_batches',
    'privacy_retention.marketing_campaign_batch_recipients',
    'privacy_retention.marketing_campaign_consent_evidence_keys',
    'privacy_retention.marketing_campaign_provider_attempts'
  ] LOOP
    FOREACH v_action IN ARRAY ARRAY['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE'] LOOP
      BEGIN
        IF v_action = 'INSERT' THEN
          EXECUTE pg_catalog.format('INSERT INTO %s DEFAULT VALUES', v_relation);
        ELSIF v_action = 'UPDATE' THEN
          v_update := CASE v_relation
            WHEN 'public.notifications' THEN 'is_read = is_read'
            WHEN 'privacy_retention.marketing_campaign_consent_evidence_keys' THEN 'evidence_kind = evidence_kind'
            ELSE 'status = status'
          END;
          EXECUTE pg_catalog.format('UPDATE %s SET %s WHERE false', v_relation, v_update);
        ELSIF v_action = 'DELETE' THEN
          EXECUTE pg_catalog.format('DELETE FROM %s WHERE false', v_relation);
        ELSE
          EXECUTE pg_catalog.format('TRUNCATE %s', v_relation);
        END IF;
        RAISE EXCEPTION 'service_role direct % on % unexpectedly succeeded', v_action, v_relation;
      EXCEPTION WHEN insufficient_privilege THEN
        NULL;
      WHEN OTHERS THEN
        GET STACKED DIAGNOSTICS v_code = RETURNED_SQLSTATE;
        RAISE EXCEPTION 'service_role direct % on % returned SQLSTATE %, expected 42501',
          v_action, v_relation, v_code;
      END;
    END LOOP;
  END LOOP;

  v_preview := public.preview_marketing_campaign(
    '14300000-0000-4000-8000-000000000001',
    'sms',
    ARRAY['14300000-0000-4000-8000-000000000002'::uuid],
    '테스트 안내',
    '동의한 사용자에게만 발송합니다.',
    '{}'::jsonb,
    repeat('0', 64),
    pg_catalog.clock_timestamp() + interval '10 minutes'
  );
  IF (v_preview ->> 'operationId') IS NULL THEN
    RAISE EXCEPTION 'narrow service_role preview RPC positive path did not return an operation';
  END IF;
END;
$direct_service_dml_denied$;
RESET ROLE;

-- Canonical recipient ordering is part of the durable provider outcome binding:
-- reordering an accepted set yields the same sorted IDs/digest; a changed set does not.
SET LOCAL ROLE privacy_workflow_owner;
DO $canonical_accepted_recipient_binding$
BEGIN
  IF privacy_retention.g014_marketing_canonical_recipient_ids(
    ARRAY[
      '14300000-0000-4000-8000-000000000009'::uuid,
      '14300000-0000-4000-8000-000000000002'::uuid
    ]
  ) IS DISTINCT FROM ARRAY[
    '14300000-0000-4000-8000-000000000002'::uuid,
    '14300000-0000-4000-8000-000000000009'::uuid
  ]
  OR privacy_retention.g014_marketing_accepted_recipient_digest(
    ARRAY[
      '14300000-0000-4000-8000-000000000009'::uuid,
      '14300000-0000-4000-8000-000000000002'::uuid
    ]
  ) IS DISTINCT FROM privacy_retention.g014_marketing_accepted_recipient_digest(
    ARRAY[
      '14300000-0000-4000-8000-000000000002'::uuid,
      '14300000-0000-4000-8000-000000000009'::uuid
    ]
  )
  OR privacy_retention.g014_marketing_accepted_recipient_digest(
    ARRAY['14300000-0000-4000-8000-000000000002'::uuid]
  ) IS NOT DISTINCT FROM privacy_retention.g014_marketing_accepted_recipient_digest(
    ARRAY[]::uuid[]
  ) THEN
    RAISE EXCEPTION 'accepted recipient canonical digest contract failed';
  END IF;
END;
$canonical_accepted_recipient_binding$;
RESET ROLE;
-- Each row changes exactly one binding. Its canonical row hashes are captured under
-- the workflow owner immediately before and after the service-role RPC rejection.
SET LOCAL ROLE privacy_workflow_owner;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $table_driven_rejection_matrix$
DECLARE
  v_preview jsonb;
  v_prepare jsonb;
  v_claim jsonb;
  v_prepare_operation_id uuid;
  v_claim_operation_id uuid;
  v_claim_batch_id uuid;
  v_final_operation_id uuid;
  v_final_batch_id uuid;
  v_final_claim jsonb;
  v_fail_operation_id uuid;
  v_fail_batch_id uuid;
  v_fail_claim jsonb;
  v_batch_fail_operation_id uuid;
  v_batch_fail_batch_id uuid;
  v_timezone_operation_id uuid;
  v_timezone_batch_id uuid;
  v_timezone_claim_operation_id uuid;
  v_timezone_claim_batch_id uuid;
  v_timezone_claim jsonb;
  v_default_operation_id uuid;
  v_default_batch_id uuid;
  v_default_actor_user_id uuid;
  v_default_preview_hash text;
  v_default_idempotency_key text;
  v_default_batch_limit integer;
  v_default_timezone text;
  v_default_claim_token uuid;
  v_default_attempt_id uuid;
  v_default_receipt_id text;
  v_default_receipt_hash text;
  v_default_payload_digest text;
  v_default_accepted_user_ids uuid[];
  v_case record;
  v_before jsonb;
  v_after jsonb;
  v_sqlstate text;
BEGIN
  SET LOCAL ROLE service_role;

  v_preview := public.preview_marketing_campaign(
    '14300000-0000-4000-8000-000000000001', 'sms',
    ARRAY['14300000-0000-4000-8000-000000000002'::uuid],
    '테스트 안내', '동의한 사용자에게만 발송합니다.', '{}'::jsonb,
    repeat('6', 64), pg_catalog.clock_timestamp() + interval '10 minutes'
  );
  v_prepare_operation_id := (v_preview ->> 'operationId')::uuid;
  v_preview := public.preview_marketing_campaign(
    '14300000-0000-4000-8000-000000000001', 'sms',
    ARRAY['14300000-0000-4000-8000-000000000002'::uuid],
    '테스트 안내', '동의한 사용자에게만 발송합니다.', '{}'::jsonb,
    repeat('5', 64), pg_catalog.clock_timestamp() + interval '10 minutes'
  );
  v_timezone_operation_id := (v_preview ->> 'operationId')::uuid;
  v_prepare := public.prepare_marketing_campaign_batch(
    v_timezone_operation_id, '14300000-0000-4000-8000-000000000001',
    repeat('5', 64), 'g014matrixtimezone01', 1, 'Asia/Seoul'
  );
  v_timezone_batch_id := (v_prepare ->> 'batchId')::uuid;
  IF v_prepare ->> 'status' IS DISTINCT FROM 'prepared' THEN
    RAISE EXCEPTION 'timezone mismatch fixture is not durably prepared';
  END IF;
  v_preview := public.preview_marketing_campaign(
    '14300000-0000-4000-8000-000000000001', 'sms',
    ARRAY['14300000-0000-4000-8000-000000000002'::uuid],
    '테스트 안내', '동의한 사용자에게만 발송합니다.', '{}'::jsonb,
    repeat('3', 64), pg_catalog.clock_timestamp() + interval '10 minutes'
  );
  v_timezone_claim_operation_id := (v_preview ->> 'operationId')::uuid;
  v_prepare := public.prepare_marketing_campaign_batch(
    v_timezone_claim_operation_id, '14300000-0000-4000-8000-000000000001',
    repeat('3', 64), 'g014matrixtimeclaim01', 1, 'Asia/Seoul'
  );
  v_timezone_claim_batch_id := (v_prepare ->> 'batchId')::uuid;
  v_timezone_claim := public.claim_marketing_campaign_dispatch(
    v_timezone_claim_operation_id, v_timezone_claim_batch_id,
    '14300000-0000-4000-8000-000000000001',
    repeat('3', 64), 'g014matrixtimeclaim01', 'Asia/Seoul'
  );
  IF v_timezone_claim ->> 'status' IS DISTINCT FROM 'claimed' THEN
    RAISE EXCEPTION 'timezone claim fixture is not durably claimed';
  END IF;

  v_preview := public.preview_marketing_campaign(
    '14300000-0000-4000-8000-000000000001', 'sms',
    ARRAY['14300000-0000-4000-8000-000000000002'::uuid],
    '테스트 안내', '동의한 사용자에게만 발송합니다.', '{}'::jsonb,
    repeat('4', 64), pg_catalog.clock_timestamp() + interval '10 minutes'
  );
  v_batch_fail_operation_id := (v_preview ->> 'operationId')::uuid;
  v_prepare := public.prepare_marketing_campaign_batch(
    v_batch_fail_operation_id, '14300000-0000-4000-8000-000000000001',
    repeat('4', 64), 'g014matrixbatchfail01', 1, 'Asia/Seoul'
  );
  v_batch_fail_batch_id := (v_prepare ->> 'batchId')::uuid;
  IF v_prepare ->> 'status' IS DISTINCT FROM 'prepared' THEN
    RAISE EXCEPTION 'fail batch fixture is not durably prepared';
  END IF;

  v_preview := public.preview_marketing_campaign(
    '14300000-0000-4000-8000-000000000001', 'sms',
    ARRAY['14300000-0000-4000-8000-000000000002'::uuid],
    '테스트 안내', '동의한 사용자에게만 발송합니다.', '{}'::jsonb,
    repeat('7', 64), pg_catalog.clock_timestamp() + interval '10 minutes'
  );
  v_claim_operation_id := (v_preview ->> 'operationId')::uuid;
  v_prepare := public.prepare_marketing_campaign_batch(
    v_claim_operation_id, '14300000-0000-4000-8000-000000000001',
    repeat('7', 64), 'g014matrixclaim001', 1, 'Asia/Seoul'
  );
  v_claim_batch_id := (v_prepare ->> 'batchId')::uuid;

  v_preview := public.preview_marketing_campaign(
    '14300000-0000-4000-8000-000000000001', 'sms',
    ARRAY['14300000-0000-4000-8000-000000000002'::uuid],
    '테스트 안내', '동의한 사용자에게만 발송합니다.', '{}'::jsonb,
    repeat('8', 64), pg_catalog.clock_timestamp() + interval '10 minutes'
  );
  v_final_operation_id := (v_preview ->> 'operationId')::uuid;
  v_prepare := public.prepare_marketing_campaign_batch(
    v_final_operation_id, '14300000-0000-4000-8000-000000000001',
    repeat('8', 64), 'g014matrixfinal001', 1, 'Asia/Seoul'
  );
  v_final_batch_id := (v_prepare ->> 'batchId')::uuid;
  v_final_claim := public.claim_marketing_campaign_dispatch(
    v_final_operation_id, v_final_batch_id, '14300000-0000-4000-8000-000000000001',
    repeat('8', 64), 'g014matrixfinal001', 'Asia/Seoul'
  );
  PERFORM public.finalize_marketing_campaign_batch(
    v_final_operation_id, v_final_batch_id, '14300000-0000-4000-8000-000000000001',
    repeat('8', 64), (v_final_claim ->> 'claimToken')::uuid,
    (v_final_claim ->> 'providerAttemptId')::uuid, 'receipt-matrix-final', repeat('9', 64),
    v_final_claim ->> 'payloadDigest',
    ARRAY['14300000-0000-4000-8000-000000000002'::uuid], 'Asia/Seoul'
  );
  IF (SELECT status FROM public.marketing_campaign_batches WHERE id = v_final_batch_id) IS DISTINCT FROM 'completed'
     OR (SELECT status FROM privacy_retention.marketing_campaign_provider_attempts
         WHERE id = (v_final_claim ->> 'providerAttemptId')::uuid) IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'timezone finalize fixture is not an accepted replay';
  END IF;

  v_preview := public.preview_marketing_campaign(
    '14300000-0000-4000-8000-000000000001', 'sms',
    ARRAY['14300000-0000-4000-8000-000000000002'::uuid],
    '테스트 안내', '동의한 사용자에게만 발송합니다.', '{}'::jsonb,
    repeat('a', 64), pg_catalog.clock_timestamp() + interval '10 minutes'
  );
  v_fail_operation_id := (v_preview ->> 'operationId')::uuid;
  v_prepare := public.prepare_marketing_campaign_batch(
    v_fail_operation_id, '14300000-0000-4000-8000-000000000001',
    repeat('a', 64), 'g014matrixfail0001', 1, 'Asia/Seoul'
  );
  v_fail_batch_id := (v_prepare ->> 'batchId')::uuid;
  v_fail_claim := public.claim_marketing_campaign_dispatch(
    v_fail_operation_id, v_fail_batch_id, '14300000-0000-4000-8000-000000000001',
    repeat('a', 64), 'g014matrixfail0001', 'Asia/Seoul'
  );
  PERFORM public.fail_marketing_campaign_provider_attempt(
    v_fail_operation_id, v_fail_batch_id, '14300000-0000-4000-8000-000000000001',
    repeat('a', 64), (v_fail_claim ->> 'claimToken')::uuid,
    (v_fail_claim ->> 'providerAttemptId')::uuid, 'receipt-matrix-failed', repeat('b', 64),
    v_fail_claim ->> 'payloadDigest', 'provider_rejected'
  );

  CREATE TEMPORARY TABLE pg_temp.g014_marketing_rejection_cases (
    case_name text PRIMARY KEY,
    rpc_name text NOT NULL,
    fixture text NOT NULL,
    snapshot_operation_id uuid NOT NULL,
    args jsonb NOT NULL,
    expected_sqlstate text NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.g014_marketing_rejection_cases (
    case_name, rpc_name, fixture, snapshot_operation_id, args, expected_sqlstate
  ) VALUES
    ('prepare.operation.null', 'prepare', 'prepare', v_prepare_operation_id, jsonb_build_object('operationId', NULL), '22023'),
    ('prepare.operation.mismatch', 'prepare', 'prepare', v_prepare_operation_id, jsonb_build_object('operationId', extensions.gen_random_uuid()), 'P0002'),
    ('prepare.actor.null', 'prepare', 'prepare', v_prepare_operation_id, jsonb_build_object('actorUserId', NULL), '22023'),
    ('prepare.actor.mismatch', 'prepare', 'prepare', v_prepare_operation_id, jsonb_build_object('actorUserId', '14300000-0000-4000-8000-000000000004'), '42501'),
    ('prepare.preview_hash.null', 'prepare', 'prepare', v_prepare_operation_id, jsonb_build_object('previewHash', NULL), '22023'),
    ('prepare.preview_hash.mismatch', 'prepare', 'prepare', v_prepare_operation_id, jsonb_build_object('previewHash', repeat('f', 64)), '42501'),
    ('prepare.idempotency_key.null', 'prepare', 'prepare', v_prepare_operation_id, jsonb_build_object('idempotencyKey', NULL), '22023'),
    ('prepare.idempotency_key.mismatch', 'prepare', 'claimed', v_claim_operation_id, jsonb_build_object('idempotencyKey', 'g014matrixclaimalt001'), '55000'),
    ('prepare.limit.null', 'prepare', 'prepare', v_prepare_operation_id, jsonb_build_object('batchLimit', NULL), '22023'),
    ('prepare.limit.mismatch', 'prepare', 'prepare', v_prepare_operation_id, jsonb_build_object('batchLimit', 101), '22023'),
    ('prepare.timezone.null', 'prepare', 'timezone', v_timezone_operation_id, jsonb_build_object('timezone', NULL), '22023'),
    ('prepare.timezone.mismatch', 'prepare', 'timezone', v_timezone_operation_id, jsonb_build_object('timezone', 'UTC'), '22023'),

    ('claim.operation.null', 'claim', 'claimed', v_claim_operation_id, jsonb_build_object('operationId', NULL), '22023'),
    ('claim.operation.mismatch', 'claim', 'claimed', v_claim_operation_id, jsonb_build_object('operationId', extensions.gen_random_uuid()), '42501'),
    ('claim.batch.null', 'claim', 'claimed', v_claim_operation_id, jsonb_build_object('batchId', NULL), '22023'),
    ('claim.batch.mismatch', 'claim', 'claimed', v_claim_operation_id, jsonb_build_object('batchId', extensions.gen_random_uuid()), '42501'),
    ('claim.actor.null', 'claim', 'claimed', v_claim_operation_id, jsonb_build_object('actorUserId', NULL), '22023'),
    ('claim.actor.mismatch', 'claim', 'claimed', v_claim_operation_id, jsonb_build_object('actorUserId', '14300000-0000-4000-8000-000000000004'), '42501'),
    ('claim.preview_hash.null', 'claim', 'claimed', v_claim_operation_id, jsonb_build_object('previewHash', NULL), '22023'),
    ('claim.preview_hash.mismatch', 'claim', 'claimed', v_claim_operation_id, jsonb_build_object('previewHash', repeat('f', 64)), '42501'),
    ('claim.idempotency_key.null', 'claim', 'claimed', v_claim_operation_id, jsonb_build_object('idempotencyKey', NULL), '22023'),
    ('claim.idempotency_key.mismatch', 'claim', 'claimed', v_claim_operation_id, jsonb_build_object('idempotencyKey', 'g014matrixclaimalt001'), '42501'),
    ('claim.timezone.null', 'claim', 'timezoneClaim', v_timezone_claim_operation_id, jsonb_build_object('timezone', NULL), '22023'),
    ('claim.timezone.mismatch', 'claim', 'timezoneClaim', v_timezone_claim_operation_id, jsonb_build_object('timezone', 'UTC'), '22023'),

    ('finalize.operation.null', 'finalize', 'final', v_final_operation_id, jsonb_build_object('operationId', NULL), '22023'),
    ('finalize.operation.mismatch', 'finalize', 'final', v_final_operation_id, jsonb_build_object('operationId', extensions.gen_random_uuid()), '42501'),
    ('finalize.batch.null', 'finalize', 'final', v_final_operation_id, jsonb_build_object('batchId', NULL), '22023'),
    ('finalize.batch.mismatch', 'finalize', 'final', v_final_operation_id, jsonb_build_object('batchId', extensions.gen_random_uuid()), '42501'),
    ('finalize.actor.null', 'finalize', 'final', v_final_operation_id, jsonb_build_object('actorUserId', NULL), '22023'),
    ('finalize.actor.mismatch', 'finalize', 'final', v_final_operation_id, jsonb_build_object('actorUserId', '14300000-0000-4000-8000-000000000004'), '42501'),
    ('finalize.preview_hash.null', 'finalize', 'final', v_final_operation_id, jsonb_build_object('previewHash', NULL), '22023'),
    ('finalize.preview_hash.mismatch', 'finalize', 'final', v_final_operation_id, jsonb_build_object('previewHash', repeat('f', 64)), '42501'),
    ('finalize.claim_token.null', 'finalize', 'final', v_final_operation_id, jsonb_build_object('claimToken', NULL), '22023'),
    ('finalize.claim_token.mismatch', 'finalize', 'final', v_final_operation_id, jsonb_build_object('claimToken', extensions.gen_random_uuid()), '42501'),
    ('finalize.provider_attempt_id.null', 'finalize', 'final', v_final_operation_id, jsonb_build_object('providerAttemptId', NULL), '22023'),
    ('finalize.provider_attempt_id.mismatch', 'finalize', 'final', v_final_operation_id, jsonb_build_object('providerAttemptId', extensions.gen_random_uuid()), '42501'),
    ('finalize.provider_receipt_id.null', 'finalize', 'final', v_final_operation_id, jsonb_build_object('providerReceiptId', NULL), '22023'),
    ('finalize.provider_receipt_id.mismatch', 'finalize', 'final', v_final_operation_id, jsonb_build_object('providerReceiptId', 'receipt-matrix-final-other'), '42501'),
    ('finalize.provider_receipt_hash.null', 'finalize', 'final', v_final_operation_id, jsonb_build_object('providerReceiptHash', NULL), '22023'),
    ('finalize.provider_receipt_hash.mismatch', 'finalize', 'final', v_final_operation_id, jsonb_build_object('providerReceiptHash', repeat('c', 64)), '42501'),
    ('finalize.payload_digest.null', 'finalize', 'final', v_final_operation_id, jsonb_build_object('payloadDigest', NULL), '22023'),
    ('finalize.payload_digest.mismatch', 'finalize', 'final', v_final_operation_id, jsonb_build_object('payloadDigest', repeat('d', 64)), '42501'),
    ('finalize.accepted_ids.null', 'finalize', 'final', v_final_operation_id, jsonb_build_object('acceptedUserIds', NULL), '22023'),
    ('finalize.accepted_ids.mismatch', 'finalize', 'final', v_final_operation_id, jsonb_build_object('acceptedUserIds', ARRAY[extensions.gen_random_uuid()]), '42501'),
    ('finalize.timezone.null', 'finalize', 'final', v_final_operation_id, jsonb_build_object('timezone', NULL), '22023'),
    ('finalize.timezone.mismatch', 'finalize', 'final', v_final_operation_id, jsonb_build_object('timezone', 'UTC'), '22023'),

    ('fail_batch.operation.null', 'failBatch', 'batchFail', v_batch_fail_operation_id, jsonb_build_object('operationId', NULL), '22023'),
    ('fail_batch.operation.mismatch', 'failBatch', 'batchFail', v_batch_fail_operation_id, jsonb_build_object('operationId', extensions.gen_random_uuid()), '42501'),
    ('fail_batch.batch.null', 'failBatch', 'batchFail', v_batch_fail_operation_id, jsonb_build_object('batchId', NULL), '22023'),
    ('fail_batch.batch.mismatch', 'failBatch', 'batchFail', v_batch_fail_operation_id, jsonb_build_object('batchId', extensions.gen_random_uuid()), '42501'),
    ('fail_batch.actor.null', 'failBatch', 'batchFail', v_batch_fail_operation_id, jsonb_build_object('actorUserId', NULL), '22023'),
    ('fail_batch.actor.mismatch', 'failBatch', 'batchFail', v_batch_fail_operation_id, jsonb_build_object('actorUserId', '14300000-0000-4000-8000-000000000004'), '42501'),
    ('fail_batch.preview_hash.null', 'failBatch', 'batchFail', v_batch_fail_operation_id, jsonb_build_object('previewHash', NULL), '22023'),
    ('fail_batch.preview_hash.mismatch', 'failBatch', 'batchFail', v_batch_fail_operation_id, jsonb_build_object('previewHash', repeat('f', 64)), '42501'),
    ('fail_batch.error_code.null', 'failBatch', 'batchFail', v_batch_fail_operation_id, jsonb_build_object('errorCode', NULL), '22023'),
    ('fail_batch.error_code.mismatch', 'failBatch', 'batchFail', v_batch_fail_operation_id, jsonb_build_object('errorCode', 'provider_rejected'), '22023'),

    ('fail_provider.operation.null', 'failProvider', 'failed', v_fail_operation_id, jsonb_build_object('operationId', NULL), '22023'),
    ('fail_provider.operation.mismatch', 'failProvider', 'failed', v_fail_operation_id, jsonb_build_object('operationId', extensions.gen_random_uuid()), '42501'),
    ('fail_provider.batch.null', 'failProvider', 'failed', v_fail_operation_id, jsonb_build_object('batchId', NULL), '22023'),
    ('fail_provider.batch.mismatch', 'failProvider', 'failed', v_fail_operation_id, jsonb_build_object('batchId', extensions.gen_random_uuid()), '42501'),
    ('fail_provider.actor.null', 'failProvider', 'failed', v_fail_operation_id, jsonb_build_object('actorUserId', NULL), '22023'),
    ('fail_provider.actor.mismatch', 'failProvider', 'failed', v_fail_operation_id, jsonb_build_object('actorUserId', '14300000-0000-4000-8000-000000000004'), '42501'),
    ('fail_provider.preview_hash.null', 'failProvider', 'failed', v_fail_operation_id, jsonb_build_object('previewHash', NULL), '22023'),
    ('fail_provider.preview_hash.mismatch', 'failProvider', 'failed', v_fail_operation_id, jsonb_build_object('previewHash', repeat('f', 64)), '42501'),
    ('fail_provider.claim_token.null', 'failProvider', 'failed', v_fail_operation_id, jsonb_build_object('claimToken', NULL), '22023'),
    ('fail_provider.claim_token.mismatch', 'failProvider', 'failed', v_fail_operation_id, jsonb_build_object('claimToken', extensions.gen_random_uuid()), '42501'),
    ('fail_provider.provider_attempt_id.null', 'failProvider', 'failed', v_fail_operation_id, jsonb_build_object('providerAttemptId', NULL), '22023'),
    ('fail_provider.provider_attempt_id.mismatch', 'failProvider', 'failed', v_fail_operation_id, jsonb_build_object('providerAttemptId', extensions.gen_random_uuid()), '42501'),
    ('fail_provider.provider_receipt_id.null', 'failProvider', 'failed', v_fail_operation_id, jsonb_build_object('providerReceiptId', NULL), '22023'),
    ('fail_provider.provider_receipt_id.mismatch', 'failProvider', 'failed', v_fail_operation_id, jsonb_build_object('providerReceiptId', 'receipt-matrix-failed-other'), '42501'),
    ('fail_provider.provider_receipt_hash.null', 'failProvider', 'failed', v_fail_operation_id, jsonb_build_object('providerReceiptHash', NULL), '22023'),
    ('fail_provider.provider_receipt_hash.mismatch', 'failProvider', 'failed', v_fail_operation_id, jsonb_build_object('providerReceiptHash', repeat('c', 64)), '42501'),
    ('fail_provider.payload_digest.null', 'failProvider', 'failed', v_fail_operation_id, jsonb_build_object('payloadDigest', NULL), '22023'),
    ('fail_provider.payload_digest.mismatch', 'failProvider', 'failed', v_fail_operation_id, jsonb_build_object('payloadDigest', repeat('d', 64)), '42501'),
    ('fail_provider.error_code.null', 'failProvider', 'failed', v_fail_operation_id, jsonb_build_object('errorCode', NULL), '22023'),
    ('fail_provider.error_code.mismatch', 'failProvider', 'failed', v_fail_operation_id, jsonb_build_object('errorCode', 'provider_invalid_request'), '42501');
  IF EXISTS (
    SELECT 1
    FROM pg_temp.g014_marketing_rejection_cases
    WHERE expected_sqlstate = 'P9999'
  ) THEN
    RAISE EXCEPTION 'unexpected-success sentinel must never be an accepted matrix SQLSTATE';
  END IF;

  FOR v_case IN
    SELECT *
    FROM pg_temp.g014_marketing_rejection_cases
    ORDER BY case_name
  LOOP
    IF v_case.fixture = 'prepare' THEN
      v_default_operation_id := v_prepare_operation_id;
      v_default_batch_id := NULL;
      v_default_actor_user_id := '14300000-0000-4000-8000-000000000001';
      v_default_preview_hash := repeat('6', 64);
      v_default_idempotency_key := 'g014matrixprepare001';
      v_default_batch_limit := 1;
      v_default_timezone := 'Asia/Seoul';
      v_default_claim_token := NULL;
      v_default_attempt_id := NULL;
      v_default_receipt_id := NULL;
      v_default_receipt_hash := NULL;
      v_default_payload_digest := NULL;
      v_default_accepted_user_ids := NULL;
    ELSIF v_case.fixture = 'timezone' THEN
      v_default_operation_id := v_timezone_operation_id;
      v_default_batch_id := v_timezone_batch_id;
      v_default_actor_user_id := '14300000-0000-4000-8000-000000000001';
      v_default_preview_hash := repeat('5', 64);
      v_default_idempotency_key := 'g014matrixtimezone01';
      v_default_batch_limit := 1;
      v_default_timezone := 'Asia/Seoul';
      v_default_claim_token := NULL;
      v_default_attempt_id := NULL;
      v_default_receipt_id := NULL;
      v_default_receipt_hash := NULL;
      v_default_payload_digest := NULL;
      v_default_accepted_user_ids := NULL;
    ELSIF v_case.fixture = 'timezoneClaim' THEN
      v_default_operation_id := v_timezone_claim_operation_id;
      v_default_batch_id := v_timezone_claim_batch_id;
      v_default_actor_user_id := '14300000-0000-4000-8000-000000000001';
      v_default_preview_hash := repeat('3', 64);
      v_default_idempotency_key := 'g014matrixtimeclaim01';
      v_default_batch_limit := 1;
      v_default_timezone := 'Asia/Seoul';
      v_default_claim_token := (v_timezone_claim ->> 'claimToken')::uuid;
      v_default_attempt_id := (v_timezone_claim ->> 'providerAttemptId')::uuid;
      v_default_receipt_id := NULL;
      v_default_receipt_hash := NULL;
      v_default_payload_digest := v_timezone_claim ->> 'payloadDigest';
      v_default_accepted_user_ids := NULL;
    ELSIF v_case.fixture = 'batchFail' THEN
      v_default_operation_id := v_batch_fail_operation_id;
      v_default_batch_id := v_batch_fail_batch_id;
      v_default_actor_user_id := '14300000-0000-4000-8000-000000000001';
      v_default_preview_hash := repeat('4', 64);
      v_default_idempotency_key := 'g014matrixbatchfail01';
      v_default_batch_limit := 1;
      v_default_timezone := 'Asia/Seoul';
      v_default_claim_token := NULL;
      v_default_attempt_id := NULL;
      v_default_receipt_id := NULL;
      v_default_receipt_hash := NULL;
      v_default_payload_digest := NULL;
      v_default_accepted_user_ids := NULL;
    ELSIF v_case.fixture = 'claimed' THEN
      v_default_operation_id := v_claim_operation_id;
      v_default_batch_id := v_claim_batch_id;
      v_default_actor_user_id := '14300000-0000-4000-8000-000000000001';
      v_default_preview_hash := repeat('7', 64);
      v_default_idempotency_key := 'g014matrixclaim001';
      v_default_batch_limit := 1;
      v_default_timezone := 'Asia/Seoul';
      v_default_claim_token := NULL;
      v_default_attempt_id := NULL;
      v_default_receipt_id := NULL;
      v_default_receipt_hash := NULL;
      v_default_payload_digest := NULL;
      v_default_accepted_user_ids := NULL;
    ELSIF v_case.fixture = 'final' THEN
      v_default_operation_id := v_final_operation_id;
      v_default_batch_id := v_final_batch_id;
      v_default_actor_user_id := '14300000-0000-4000-8000-000000000001';
      v_default_preview_hash := repeat('8', 64);
      v_default_idempotency_key := 'g014matrixfinal001';
      v_default_batch_limit := 1;
      v_default_timezone := 'Asia/Seoul';
      v_default_claim_token := (v_final_claim ->> 'claimToken')::uuid;
      v_default_attempt_id := (v_final_claim ->> 'providerAttemptId')::uuid;
      v_default_receipt_id := 'receipt-matrix-final';
      v_default_receipt_hash := repeat('9', 64);
      v_default_payload_digest := v_final_claim ->> 'payloadDigest';
      v_default_accepted_user_ids := ARRAY['14300000-0000-4000-8000-000000000002'::uuid];
    ELSE
      v_default_operation_id := v_fail_operation_id;
      v_default_batch_id := v_fail_batch_id;
      v_default_actor_user_id := '14300000-0000-4000-8000-000000000001';
      v_default_preview_hash := repeat('a', 64);
      v_default_idempotency_key := 'g014matrixfail0001';
      v_default_batch_limit := 1;
      v_default_timezone := 'Asia/Seoul';
      v_default_claim_token := (v_fail_claim ->> 'claimToken')::uuid;
      v_default_attempt_id := (v_fail_claim ->> 'providerAttemptId')::uuid;
      v_default_receipt_id := 'receipt-matrix-failed';
      v_default_receipt_hash := repeat('b', 64);
      v_default_payload_digest := v_fail_claim ->> 'payloadDigest';
      v_default_accepted_user_ids := ARRAY['14300000-0000-4000-8000-000000000002'::uuid];
    END IF;

    SET LOCAL ROLE privacy_workflow_owner;
    v_before := pg_temp.g014_marketing_state_hash(v_case.snapshot_operation_id);
    SET LOCAL ROLE service_role;
    BEGIN
      IF v_case.rpc_name = 'prepare' THEN
        PERFORM public.prepare_marketing_campaign_batch(
          CASE WHEN v_case.args ? 'operationId' THEN (v_case.args ->> 'operationId')::uuid ELSE v_default_operation_id END,
          CASE WHEN v_case.args ? 'actorUserId' THEN (v_case.args ->> 'actorUserId')::uuid ELSE v_default_actor_user_id END,
          CASE WHEN v_case.args ? 'previewHash' THEN v_case.args ->> 'previewHash' ELSE v_default_preview_hash END,
          CASE WHEN v_case.args ? 'idempotencyKey' THEN v_case.args ->> 'idempotencyKey' ELSE v_default_idempotency_key END,
          CASE WHEN v_case.args ? 'batchLimit' THEN (v_case.args ->> 'batchLimit')::integer ELSE v_default_batch_limit END,
          CASE WHEN v_case.args ? 'timezone' THEN v_case.args ->> 'timezone' ELSE v_default_timezone END
        );
      ELSIF v_case.rpc_name = 'claim' THEN
        PERFORM public.claim_marketing_campaign_dispatch(
          CASE WHEN v_case.args ? 'operationId' THEN (v_case.args ->> 'operationId')::uuid ELSE v_default_operation_id END,
          CASE WHEN v_case.args ? 'batchId' THEN (v_case.args ->> 'batchId')::uuid ELSE v_default_batch_id END,
          CASE WHEN v_case.args ? 'actorUserId' THEN (v_case.args ->> 'actorUserId')::uuid ELSE v_default_actor_user_id END,
          CASE WHEN v_case.args ? 'previewHash' THEN v_case.args ->> 'previewHash' ELSE v_default_preview_hash END,
          CASE WHEN v_case.args ? 'idempotencyKey' THEN v_case.args ->> 'idempotencyKey' ELSE v_default_idempotency_key END,
          CASE WHEN v_case.args ? 'timezone' THEN v_case.args ->> 'timezone' ELSE v_default_timezone END
        );
      ELSIF v_case.rpc_name = 'finalize' THEN
        PERFORM public.finalize_marketing_campaign_batch(
          CASE WHEN v_case.args ? 'operationId' THEN (v_case.args ->> 'operationId')::uuid ELSE v_default_operation_id END,
          CASE WHEN v_case.args ? 'batchId' THEN (v_case.args ->> 'batchId')::uuid ELSE v_default_batch_id END,
          CASE WHEN v_case.args ? 'actorUserId' THEN (v_case.args ->> 'actorUserId')::uuid ELSE v_default_actor_user_id END,
          CASE WHEN v_case.args ? 'previewHash' THEN v_case.args ->> 'previewHash' ELSE v_default_preview_hash END,
          CASE WHEN v_case.args ? 'claimToken' THEN (v_case.args ->> 'claimToken')::uuid ELSE v_default_claim_token END,
          CASE WHEN v_case.args ? 'providerAttemptId' THEN (v_case.args ->> 'providerAttemptId')::uuid ELSE v_default_attempt_id END,
          CASE WHEN v_case.args ? 'providerReceiptId' THEN v_case.args ->> 'providerReceiptId' ELSE v_default_receipt_id END,
          CASE WHEN v_case.args ? 'providerReceiptHash' THEN v_case.args ->> 'providerReceiptHash' ELSE v_default_receipt_hash END,
          CASE WHEN v_case.args ? 'payloadDigest' THEN v_case.args ->> 'payloadDigest' ELSE v_default_payload_digest END,
          CASE
            WHEN NOT (v_case.args ? 'acceptedUserIds') THEN v_default_accepted_user_ids
            WHEN v_case.args -> 'acceptedUserIds' = 'null'::jsonb THEN NULL
            ELSE ARRAY(
              SELECT accepted.user_id::uuid
              FROM pg_catalog.jsonb_array_elements_text(v_case.args -> 'acceptedUserIds') AS accepted(user_id)
            )
          END,
          CASE WHEN v_case.args ? 'timezone' THEN v_case.args ->> 'timezone' ELSE v_default_timezone END
        );
      ELSIF v_case.rpc_name = 'failBatch' THEN
        PERFORM public.fail_marketing_campaign_batch(
          CASE WHEN v_case.args ? 'operationId' THEN (v_case.args ->> 'operationId')::uuid ELSE v_default_operation_id END,
          CASE WHEN v_case.args ? 'batchId' THEN (v_case.args ->> 'batchId')::uuid ELSE v_default_batch_id END,
          CASE WHEN v_case.args ? 'actorUserId' THEN (v_case.args ->> 'actorUserId')::uuid ELSE v_default_actor_user_id END,
          CASE WHEN v_case.args ? 'previewHash' THEN v_case.args ->> 'previewHash' ELSE v_default_preview_hash END,
          CASE WHEN v_case.args ? 'errorCode' THEN v_case.args ->> 'errorCode' ELSE 'provider_unavailable' END
        );
      ELSE
        PERFORM public.fail_marketing_campaign_provider_attempt(
          CASE WHEN v_case.args ? 'operationId' THEN (v_case.args ->> 'operationId')::uuid ELSE v_default_operation_id END,
          CASE WHEN v_case.args ? 'batchId' THEN (v_case.args ->> 'batchId')::uuid ELSE v_default_batch_id END,
          CASE WHEN v_case.args ? 'actorUserId' THEN (v_case.args ->> 'actorUserId')::uuid ELSE v_default_actor_user_id END,
          CASE WHEN v_case.args ? 'previewHash' THEN v_case.args ->> 'previewHash' ELSE v_default_preview_hash END,
          CASE WHEN v_case.args ? 'claimToken' THEN (v_case.args ->> 'claimToken')::uuid ELSE v_default_claim_token END,
          CASE WHEN v_case.args ? 'providerAttemptId' THEN (v_case.args ->> 'providerAttemptId')::uuid ELSE v_default_attempt_id END,
          CASE WHEN v_case.args ? 'providerReceiptId' THEN v_case.args ->> 'providerReceiptId' ELSE v_default_receipt_id END,
          CASE WHEN v_case.args ? 'providerReceiptHash' THEN v_case.args ->> 'providerReceiptHash' ELSE v_default_receipt_hash END,
          CASE WHEN v_case.args ? 'payloadDigest' THEN v_case.args ->> 'payloadDigest' ELSE v_default_payload_digest END,
          CASE WHEN v_case.args ? 'errorCode' THEN v_case.args ->> 'errorCode' ELSE 'provider_rejected' END
        );
      END IF;
      RAISE EXCEPTION USING
        ERRCODE = 'P9999',
        MESSAGE = 'g014_rejection_matrix_unexpected_success';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE;
      IF v_sqlstate IS DISTINCT FROM v_case.expected_sqlstate THEN
        RAISE EXCEPTION 'matrix case % returned SQLSTATE %, expected %',
          v_case.case_name, v_sqlstate, v_case.expected_sqlstate;
      END IF;
    END;
    SET LOCAL ROLE privacy_workflow_owner;
    v_after := pg_temp.g014_marketing_state_hash(v_case.snapshot_operation_id);
    IF v_before IS DISTINCT FROM v_after THEN
      RAISE EXCEPTION 'matrix case % changed canonical durable state', v_case.case_name;
    END IF;
  END LOOP;
END;
$table_driven_rejection_matrix$;
RESET ROLE;
-- Revoking the actor after route authorization/prepare but before claim must
-- reject the claim transaction before it can create the durable unknown attempt.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $admin_revocation_before_claim$
DECLARE
  v_preview jsonb;
  v_prepare jsonb;
  v_operation_id uuid;
  v_batch_id uuid;
  v_before jsonb;
  v_after jsonb;
BEGIN
  v_preview := public.preview_marketing_campaign(
    '14300000-0000-4000-8000-000000000001', 'sms',
    ARRAY['14300000-0000-4000-8000-000000000002'::uuid],
    '테스트 안내', '동의한 사용자에게만 발송합니다.', '{}'::jsonb,
    repeat('e', 64), pg_catalog.clock_timestamp() + interval '10 minutes'
  );
  v_operation_id := (v_preview ->> 'operationId')::uuid;
  v_prepare := public.prepare_marketing_campaign_batch(
    v_operation_id, '14300000-0000-4000-8000-000000000001', repeat('e', 64),
    'g014adminrevoked001', 1, 'Asia/Seoul'
  );
  v_batch_id := (v_prepare ->> 'batchId')::uuid;

  SET LOCAL ROLE privacy_workflow_owner;
  DELETE FROM public.user_roles AS role_row
  WHERE role_row.user_id = '14300000-0000-4000-8000-000000000001'
    AND role_row.role = 'admin';
  SET LOCAL ROLE service_role;

  SELECT pg_catalog.jsonb_build_object(
    'batchStatus', (SELECT status FROM public.marketing_campaign_batches WHERE id = v_batch_id),
    'attemptCount', (
      SELECT count(*) FROM privacy_retention.marketing_campaign_provider_attempts
      WHERE operation_id = v_operation_id
    ),
    'recipientStatuses', (
      SELECT COALESCE(
        pg_catalog.jsonb_agg(recipient.status ORDER BY recipient.user_id),
        '[]'::jsonb
      )
      FROM privacy_retention.marketing_campaign_batch_recipients AS recipient
      WHERE recipient.batch_id = v_batch_id
    )
  ) INTO v_before;
  BEGIN
    PERFORM public.claim_marketing_campaign_dispatch(
      v_operation_id, v_batch_id, '14300000-0000-4000-8000-000000000001', repeat('e', 64),
      'g014adminrevoked001', 'Asia/Seoul'
    );
    RAISE EXCEPTION 'revoked admin claim unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  SELECT pg_catalog.jsonb_build_object(
    'batchStatus', (SELECT status FROM public.marketing_campaign_batches WHERE id = v_batch_id),
    'attemptCount', (
      SELECT count(*) FROM privacy_retention.marketing_campaign_provider_attempts
      WHERE operation_id = v_operation_id
    ),
    'recipientStatuses', (
      SELECT COALESCE(
        pg_catalog.jsonb_agg(recipient.status ORDER BY recipient.user_id),
        '[]'::jsonb
      )
      FROM privacy_retention.marketing_campaign_batch_recipients AS recipient
      WHERE recipient.batch_id = v_batch_id
    )
  ) INTO v_after;
  IF v_before IS DISTINCT FROM v_after
     OR (v_after ->> 'attemptCount') IS DISTINCT FROM '0'
     OR (v_after ->> 'batchStatus') IS DISTINCT FROM 'prepared' THEN
    RAISE EXCEPTION 'admin revocation before claim changed dispatch state or created an egress attempt';
  END IF;

  SET LOCAL ROLE privacy_workflow_owner;
  INSERT INTO public.user_roles (user_id, role)
  VALUES ('14300000-0000-4000-8000-000000000001', 'admin')
  ON CONFLICT (user_id, role) DO NOTHING;
  SET LOCAL ROLE service_role;
END;
$admin_revocation_before_claim$;
RESET ROLE;


-- Interleaved idempotency, bounded mapping, unknown-outbox replay, exact receipt
-- bindings, and no-terminal-pending are exercised below. Cross-session contention
-- is exercised by g014_marketing_state_machine_concurrency.test.mjs.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $dispatch_state_machine$
DECLARE
  v_preview jsonb;
  v_prepare jsonb;
  v_claim jsonb;
  v_final jsonb;
  v_operation_id uuid;
  v_batch_id uuid;
  v_claim_token uuid;
  v_attempt_id uuid;
  v_before_audit uuid;
  v_state jsonb;
BEGIN
  v_preview := public.preview_marketing_campaign(
    '14300000-0000-4000-8000-000000000001', 'sms',
    ARRAY['14300000-0000-4000-8000-000000000002'::uuid],
    '테스트 안내', '동의한 사용자에게만 발송합니다.', '{}'::jsonb,
    repeat('b', 64), pg_catalog.clock_timestamp() + interval '10 minutes'
  );
  v_operation_id := (v_preview ->> 'operationId')::uuid;
  v_prepare := public.prepare_marketing_campaign_batch(
    v_operation_id, '14300000-0000-4000-8000-000000000001', repeat('b', 64),
    'g014marketinginterleave01', 100, 'Asia/Seoul'
  );
  v_batch_id := (v_prepare ->> 'batchId')::uuid;
  IF v_prepare ->> 'status' IS DISTINCT FROM 'prepared' THEN
    RAISE EXCEPTION 'bounded prepare did not create a prepared batch';
  END IF;
  IF (SELECT count(*) FROM privacy_retention.marketing_campaign_batch_recipients WHERE batch_id = v_batch_id) > 100 THEN
    RAISE EXCEPTION 'prepare exceeded 100 recipient mapping cap';
  END IF;
  IF (public.prepare_marketing_campaign_batch(
    v_operation_id, '14300000-0000-4000-8000-000000000001', repeat('b', 64),
    'g014marketinginterleave01', 100, 'Asia/Seoul'
  ) ->> 'status') IS DISTINCT FROM 'prepared' THEN
    RAISE EXCEPTION 'same idempotency key did not replay the prepared bounded batch';
  END IF;
  BEGIN
    PERFORM public.prepare_marketing_campaign_batch(
      v_operation_id, '14300000-0000-4000-8000-000000000001', repeat('b', 64),
      'g014marketinginterleave02', 100, 'Asia/Seoul'
    );
    RAISE EXCEPTION 'interleaved idempotency key bypassed the active-batch guard';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    PERFORM public.prepare_marketing_campaign_batch(
      NULL, '14300000-0000-4000-8000-000000000001', repeat('b', 64),
      'g014marketinginterleave03', 1, 'Asia/Seoul'
    );
    RAISE EXCEPTION 'NULL operation prepare unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;

  SELECT audit_id INTO v_before_audit FROM public.marketing_campaign_operations WHERE id = v_operation_id;
  BEGIN
    PERFORM public.claim_marketing_campaign_dispatch(
      v_operation_id, v_batch_id, NULL, repeat('b', 64), 'g014marketinginterleave01', 'Asia/Seoul'
    );
    RAISE EXCEPTION 'NULL actor claim unexpectedly succeeded';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF (SELECT audit_id FROM public.marketing_campaign_operations WHERE id = v_operation_id) IS DISTINCT FROM v_before_audit THEN
    RAISE EXCEPTION 'NULL claim changed audit/state';
  END IF;

  v_claim := public.claim_marketing_campaign_dispatch(
    v_operation_id, v_batch_id, '14300000-0000-4000-8000-000000000001', repeat('b', 64),
    'g014marketinginterleave01', 'Asia/Seoul'
  );
  IF v_claim ->> 'status' IS DISTINCT FROM 'claimed' THEN
    RAISE EXCEPTION 'durable claim was not created';
  END IF;
  v_claim_token := (v_claim ->> 'claimToken')::uuid;
  v_attempt_id := (v_claim ->> 'providerAttemptId')::uuid;
  IF NOT EXISTS (
    SELECT 1 FROM privacy_retention.marketing_campaign_provider_attempts
    WHERE id = v_attempt_id AND status = 'unknown' AND claim_token = v_claim_token
  ) THEN
    RAISE EXCEPTION 'provider attempt was not durable before egress';
  END IF;
  SELECT pg_catalog.jsonb_build_object(
    'batchStatus', (SELECT status FROM public.marketing_campaign_batches WHERE id = v_batch_id),
    'attemptStatus', (SELECT status FROM privacy_retention.marketing_campaign_provider_attempts WHERE id = v_attempt_id),
    'claimedRecipients', (
      SELECT COALESCE(pg_catalog.jsonb_agg(recipient.user_id::text ORDER BY recipient.user_id), '[]'::jsonb)
      FROM privacy_retention.marketing_campaign_batch_recipients AS recipient
      WHERE recipient.batch_id = v_batch_id
    )
  ) INTO v_state;
  BEGIN
    PERFORM public.finalize_marketing_campaign_batch(
      v_operation_id, v_batch_id, '14300000-0000-4000-8000-000000000001', repeat('b', 64),
      v_claim_token, v_attempt_id, 'receipt-1', repeat('c', 64),
      v_claim ->> 'payloadDigest', NULL, 'Asia/Seoul'
    );
    RAISE EXCEPTION 'NULL accepted recipient set unexpectedly finalized';
  EXCEPTION WHEN invalid_parameter_value THEN NULL;
  END;
  IF v_state IS DISTINCT FROM pg_catalog.jsonb_build_object(
    'batchStatus', (SELECT status FROM public.marketing_campaign_batches WHERE id = v_batch_id),
    'attemptStatus', (SELECT status FROM privacy_retention.marketing_campaign_provider_attempts WHERE id = v_attempt_id),
    'claimedRecipients', (
      SELECT COALESCE(pg_catalog.jsonb_agg(recipient.user_id::text ORDER BY recipient.user_id), '[]'::jsonb)
      FROM privacy_retention.marketing_campaign_batch_recipients AS recipient
      WHERE recipient.batch_id = v_batch_id
    )
  ) THEN
    RAISE EXCEPTION 'NULL finalize changed durable attempt or recipient state';
  END IF;

  BEGIN
    PERFORM public.claim_marketing_campaign_dispatch(
      v_operation_id, v_batch_id, '14300000-0000-4000-8000-000000000001', repeat('b', 64),
      'g014marketinginterleave01', 'Asia/Seoul'
    );
    RAISE EXCEPTION 'unknown provider attempt replay unexpectedly produced a second claim';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    PERFORM public.finalize_marketing_campaign_batch(
      v_operation_id, v_batch_id, '14300000-0000-4000-8000-000000000001', repeat('b', 64),
      extensions.gen_random_uuid(), v_attempt_id, 'receipt-1', repeat('c', 64),
      v_claim ->> 'payloadDigest', ARRAY['14300000-0000-4000-8000-000000000002'::uuid], 'Asia/Seoul'
    );
    RAISE EXCEPTION 'wrong claim token unexpectedly finalized';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF v_state IS DISTINCT FROM pg_catalog.jsonb_build_object(
    'batchStatus', (SELECT status FROM public.marketing_campaign_batches WHERE id = v_batch_id),
    'attemptStatus', (SELECT status FROM privacy_retention.marketing_campaign_provider_attempts WHERE id = v_attempt_id),
    'claimedRecipients', (
      SELECT COALESCE(pg_catalog.jsonb_agg(recipient.user_id::text ORDER BY recipient.user_id), '[]'::jsonb)
      FROM privacy_retention.marketing_campaign_batch_recipients AS recipient
      WHERE recipient.batch_id = v_batch_id
    )
  ) THEN
    RAISE EXCEPTION 'mismatched claim token changed durable attempt or recipient state';
  END IF;

  v_final := public.finalize_marketing_campaign_batch(
    v_operation_id, v_batch_id, '14300000-0000-4000-8000-000000000001', repeat('b', 64),
    v_claim_token, v_attempt_id, 'receipt-1', repeat('c', 64),
    v_claim ->> 'payloadDigest', ARRAY['14300000-0000-4000-8000-000000000002'::uuid], 'Asia/Seoul'
  );
  IF (v_final -> 'readback' ->> 'passed') IS DISTINCT FROM 'true'
     OR (v_final -> 'counts' ->> 'sent') IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'exact receipt-bound finalize/readback failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM privacy_retention.marketing_campaign_provider_attempts AS attempt
    WHERE attempt.id = v_attempt_id
      AND attempt.status = 'accepted'
      AND attempt.accepted_recipient_ids IS NOT DISTINCT FROM ARRAY['14300000-0000-4000-8000-000000000002'::uuid]
      AND attempt.accepted_recipient_digest IS DISTINCT FROM NULL
      AND attempt.accepted_recipient_digest = privacy_retention.g014_marketing_accepted_recipient_digest(
        ARRAY['14300000-0000-4000-8000-000000000002'::uuid]
      )
  ) OR NOT EXISTS (
    SELECT 1
    FROM privacy_retention.marketing_campaign_consent_evidence_keys AS evidence
    JOIN privacy_retention.privacy_consent_events AS consent
      ON consent.id = evidence.consent_event_id
     AND consent.user_id IS NOT DISTINCT FROM evidence.user_id
     AND consent.subject_kind IS NOT DISTINCT FROM evidence.subject_kind
     AND consent.guardian_verification_id IS NOT DISTINCT FROM evidence.guardian_verification_id
     AND consent.purpose IS NOT DISTINCT FROM evidence.purpose
     AND consent.channel IS NOT DISTINCT FROM evidence.channel
     AND consent.decision IS NOT DISTINCT FROM evidence.decision
     AND consent.policy_version_id IS NOT DISTINCT FROM evidence.policy_version_id
     AND consent.notice_sha256 IS NOT DISTINCT FROM evidence.notice_sha256
    WHERE evidence.batch_id = v_batch_id
      AND evidence.user_id = '14300000-0000-4000-8000-000000000002'
      AND evidence.evidence_kind = 'finalize_ordinary'
  ) THEN
    RAISE EXCEPTION 'accepted receipt did not retain exact attempt and consent evidence bindings';
  END IF;
  v_final := public.finalize_marketing_campaign_batch(
    v_operation_id, v_batch_id, '14300000-0000-4000-8000-000000000001', repeat('b', 64),
    v_claim_token, v_attempt_id, 'receipt-1', repeat('c', 64),
    v_claim ->> 'payloadDigest', ARRAY['14300000-0000-4000-8000-000000000002'::uuid], 'Asia/Seoul'
  );
  IF (v_final -> 'readback' ->> 'passed') IS DISTINCT FROM 'true' THEN
    RAISE EXCEPTION 'exact accepted evidence replay did not return the durable receipt';
  END IF;
  SELECT pg_catalog.jsonb_build_object(
    'attemptStatus', (SELECT status FROM privacy_retention.marketing_campaign_provider_attempts WHERE id = v_attempt_id),
    'acceptedSet', (SELECT pg_catalog.to_jsonb(accepted_recipient_ids) FROM privacy_retention.marketing_campaign_provider_attempts WHERE id = v_attempt_id),
    'acceptedDigest', (SELECT accepted_recipient_digest FROM privacy_retention.marketing_campaign_provider_attempts WHERE id = v_attempt_id)
  ) INTO v_state;
  BEGIN
    PERFORM public.finalize_marketing_campaign_batch(
      v_operation_id, v_batch_id, '14300000-0000-4000-8000-000000000001', repeat('b', 64),
      v_claim_token, v_attempt_id, 'receipt-1', repeat('c', 64),
      v_claim ->> 'payloadDigest', ARRAY[]::uuid[], 'Asia/Seoul'
    );
    RAISE EXCEPTION 'changed accepted recipient set replay unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  BEGIN
    PERFORM public.finalize_marketing_campaign_batch(
      v_operation_id, extensions.gen_random_uuid(), '14300000-0000-4000-8000-000000000001', repeat('b', 64),
      v_claim_token, v_attempt_id, 'receipt-1', repeat('c', 64),
      v_claim ->> 'payloadDigest', ARRAY['14300000-0000-4000-8000-000000000002'::uuid], 'Asia/Seoul'
    );
    RAISE EXCEPTION 'cross-batch provider attempt unexpectedly finalized';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF v_state IS DISTINCT FROM pg_catalog.jsonb_build_object(
    'attemptStatus', (SELECT status FROM privacy_retention.marketing_campaign_provider_attempts WHERE id = v_attempt_id),
    'acceptedSet', (SELECT pg_catalog.to_jsonb(accepted_recipient_ids) FROM privacy_retention.marketing_campaign_provider_attempts WHERE id = v_attempt_id),
    'acceptedDigest', (SELECT accepted_recipient_digest FROM privacy_retention.marketing_campaign_provider_attempts WHERE id = v_attempt_id)
  ) THEN
    RAISE EXCEPTION 'changed/cross-batch provider replay changed the accepted durable binding';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.marketing_campaign_recipients
    WHERE operation_id = v_operation_id AND status IN ('pending', 'eligible')
  ) OR EXISTS (
    SELECT 1 FROM privacy_retention.marketing_campaign_batch_recipients
    WHERE operation_id = v_operation_id AND status = 'claimed'
  ) THEN
    RAISE EXCEPTION 'terminal operation retained pending/eligible/claimed recipients';
  END IF;
END;
$dispatch_state_machine$;
RESET ROLE;
-- Owner-only direct evidence writes cannot substitute a consent from another user or
-- rewrite any part of the immutable consent binding.
SET LOCAL ROLE privacy_workflow_owner;
DO $owner_consent_evidence_adversarial$
DECLARE
  v_evidence privacy_retention.marketing_campaign_consent_evidence_keys%ROWTYPE;
  v_other_consent_id uuid;
  v_case record;
  v_before jsonb;
  v_after jsonb;
  v_sqlstate text;
  v_message text;
BEGIN
  SELECT * INTO v_evidence
  FROM privacy_retention.marketing_campaign_consent_evidence_keys AS evidence
  WHERE evidence.user_id = '14300000-0000-4000-8000-000000000002'
    AND evidence.evidence_kind = 'finalize_ordinary'
  ORDER BY evidence.created_at, evidence.id
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner evidence fixture is missing';
  END IF;

  SELECT event.id INTO v_other_consent_id
  FROM privacy_retention.privacy_consent_events AS event
  WHERE event.user_id = '14300000-0000-4000-8000-000000000005'
    AND event.purpose = 'sms_marketing'
    AND event.channel = 'sms'
    AND event.decision = 'granted'
  ORDER BY event.occurred_at DESC, event.id DESC
  LIMIT 1;
  IF v_other_consent_id IS NULL THEN
    RAISE EXCEPTION 'cross-user consent fixture is missing';
  END IF;

  CREATE TEMPORARY TABLE pg_temp.g014_owner_evidence_tamper_cases (
    case_name text PRIMARY KEY,
    consent_event_id uuid NOT NULL,
    subject_kind text NOT NULL,
    purpose text NOT NULL,
    channel text NOT NULL,
    decision text NOT NULL,
    policy_version_id uuid NOT NULL,
    notice_sha256 text NOT NULL
  ) ON COMMIT DROP;
  INSERT INTO pg_temp.g014_owner_evidence_tamper_cases (
    case_name, consent_event_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256
  ) VALUES
    ('cross_user_consent_id', v_other_consent_id, v_evidence.subject_kind, v_evidence.purpose, v_evidence.channel, v_evidence.decision, v_evidence.policy_version_id, v_evidence.notice_sha256),
    ('wrong_subject_kind', v_evidence.consent_event_id, 'child', v_evidence.purpose, v_evidence.channel, v_evidence.decision, v_evidence.policy_version_id, v_evidence.notice_sha256),
    ('wrong_channel', v_evidence.consent_event_id, v_evidence.subject_kind, v_evidence.purpose, 'email', v_evidence.decision, v_evidence.policy_version_id, v_evidence.notice_sha256),
    ('wrong_purpose', v_evidence.consent_event_id, v_evidence.subject_kind, 'email_marketing', v_evidence.channel, v_evidence.decision, v_evidence.policy_version_id, v_evidence.notice_sha256),
    ('wrong_decision', v_evidence.consent_event_id, v_evidence.subject_kind, v_evidence.purpose, v_evidence.channel, 'withdrawn', v_evidence.policy_version_id, v_evidence.notice_sha256),
    ('wrong_policy', v_evidence.consent_event_id, v_evidence.subject_kind, v_evidence.purpose, v_evidence.channel, v_evidence.decision, extensions.gen_random_uuid(), v_evidence.notice_sha256),
    ('wrong_notice', v_evidence.consent_event_id, v_evidence.subject_kind, v_evidence.purpose, v_evidence.channel, v_evidence.decision, v_evidence.policy_version_id, repeat('f', 64)),
    ('wrong_guardian_verification_id', v_evidence.consent_event_id, v_evidence.subject_kind, v_evidence.purpose, v_evidence.channel, v_evidence.decision, v_evidence.policy_version_id, v_evidence.notice_sha256);

  FOR v_case IN
    SELECT * FROM pg_temp.g014_owner_evidence_tamper_cases ORDER BY case_name
  LOOP
    v_before := pg_temp.g014_marketing_state_hash(v_evidence.operation_id);
    BEGIN
      INSERT INTO privacy_retention.marketing_campaign_consent_evidence_keys (
        batch_id, operation_id, user_id, evidence_kind, consent_event_id, subject_kind,
        guardian_verification_id, purpose, channel, decision, policy_version_id, notice_sha256
      ) VALUES (
        v_evidence.batch_id, v_evidence.operation_id, v_evidence.user_id, v_evidence.evidence_kind,
        v_case.consent_event_id, v_case.subject_kind,
        CASE WHEN v_case.case_name = 'wrong_guardian_verification_id'
          THEN '14300000-0000-4000-8000-000000000041'::uuid
          ELSE v_evidence.guardian_verification_id
        END,
        v_case.purpose, v_case.channel, v_case.decision, v_case.policy_version_id, v_case.notice_sha256
      );
      RAISE EXCEPTION 'owner evidence insert tamper % unexpectedly succeeded', v_case.case_name;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
      IF v_sqlstate IS DISTINCT FROM '23514'
         OR v_message IS DISTINCT FROM 'marketing_consent_evidence_binding_invalid' THEN
        RAISE EXCEPTION 'owner evidence insert tamper % returned % %, expected 23514 marketing_consent_evidence_binding_invalid',
          v_case.case_name, v_sqlstate, v_message;
      END IF;
    END;
    v_after := pg_temp.g014_marketing_state_hash(v_evidence.operation_id);
    IF v_before IS DISTINCT FROM v_after THEN
      RAISE EXCEPTION 'owner evidence insert tamper % changed canonical durable state', v_case.case_name;
    END IF;

    v_before := pg_temp.g014_marketing_state_hash(v_evidence.operation_id);
    BEGIN
      UPDATE privacy_retention.marketing_campaign_consent_evidence_keys AS evidence
      SET consent_event_id = v_case.consent_event_id,
          subject_kind = v_case.subject_kind,
          guardian_verification_id = CASE WHEN v_case.case_name = 'wrong_guardian_verification_id'
            THEN '14300000-0000-4000-8000-000000000041'::uuid
            ELSE v_evidence.guardian_verification_id
          END,
          purpose = v_case.purpose,
          channel = v_case.channel,
          decision = v_case.decision,
          policy_version_id = v_case.policy_version_id,
          notice_sha256 = v_case.notice_sha256
      WHERE evidence.id = v_evidence.id;
      RAISE EXCEPTION 'owner evidence update tamper % unexpectedly succeeded', v_case.case_name;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
      IF v_sqlstate IS DISTINCT FROM '55000'
         OR v_message IS DISTINCT FROM 'marketing_consent_evidence_is_append_only' THEN
        RAISE EXCEPTION 'owner evidence update tamper % returned % %, expected 55000 marketing_consent_evidence_is_append_only',
          v_case.case_name, v_sqlstate, v_message;
      END IF;
    END;
    v_after := pg_temp.g014_marketing_state_hash(v_evidence.operation_id);
    IF v_before IS DISTINCT FROM v_after THEN
      RAISE EXCEPTION 'owner evidence update tamper % changed canonical durable state', v_case.case_name;
    END IF;
  END LOOP;
END;
$owner_consent_evidence_adversarial$;
RESET ROLE;
-- The owner can reach private mapping rows, so both ordinary and night consent
-- tuples must reject every substituted identity field before any FK-backed row moves.
SET LOCAL ROLE privacy_workflow_owner;
DO $owner_batch_recipient_evidence_adversarial$
DECLARE
  v_mapping privacy_retention.marketing_campaign_batch_recipients%ROWTYPE;
  v_insert_user_id uuid := '14300000-0000-4000-8000-000000000005';
  v_insert_ordinary privacy_retention.privacy_consent_events%ROWTYPE;
  v_insert_night privacy_retention.privacy_consent_events%ROWTYPE;
  v_update_ordinary privacy_retention.privacy_consent_events%ROWTYPE;
  v_update_night privacy_retention.privacy_consent_events%ROWTYPE;
  v_binding privacy_retention.privacy_consent_events%ROWTYPE;
  v_target_user_id uuid;
  v_other_consent_id uuid;
  v_consent_event_id uuid;
  v_subject_kind text;
  v_guardian_verification_id uuid;
  v_purpose text;
  v_channel text;
  v_decision text;
  v_policy_version_id uuid;
  v_notice_sha256 text;
  v_expected_message text;
  v_case record;
  v_before jsonb;
  v_after jsonb;
  v_sqlstate text;
  v_message text;
BEGIN
  SELECT * INTO v_mapping
  FROM privacy_retention.marketing_campaign_batch_recipients AS mapping
  WHERE mapping.user_id = '14300000-0000-4000-8000-000000000002'
    AND mapping.status = 'sent'
  ORDER BY mapping.created_at, mapping.batch_id
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'owner mapping evidence fixture is missing';
  END IF;

  INSERT INTO public.marketing_campaign_recipients (operation_id, user_id)
  VALUES (v_mapping.operation_id, v_insert_user_id)
  ON CONFLICT (operation_id, user_id) DO NOTHING;
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.marketing_campaign_batch_recipients AS mapping
    WHERE mapping.batch_id = v_mapping.batch_id
      AND mapping.user_id = v_insert_user_id
  ) THEN
    RAISE EXCEPTION 'owner mapping insert target is not independent';
  END IF;

  SELECT * INTO v_insert_ordinary
  FROM privacy_retention.privacy_consent_events AS event
  WHERE event.user_id = v_insert_user_id
    AND event.purpose = 'sms_marketing'
    AND event.channel = 'sms'
    AND event.decision = 'granted'
  ORDER BY event.occurred_at DESC, event.id DESC
  LIMIT 1;
  SELECT * INTO v_insert_night
  FROM privacy_retention.privacy_consent_events AS event
  WHERE event.user_id = v_insert_user_id
    AND event.purpose = 'night_marketing'
    AND event.channel = 'sms'
    AND event.decision = 'granted'
  ORDER BY event.occurred_at DESC, event.id DESC
  LIMIT 1;
  SELECT * INTO v_update_ordinary
  FROM privacy_retention.privacy_consent_events AS event
  WHERE event.user_id = v_mapping.user_id
    AND event.purpose = 'sms_marketing'
    AND event.channel = 'sms'
    AND event.decision = 'granted'
  ORDER BY event.occurred_at DESC, event.id DESC
  LIMIT 1;
  SELECT * INTO v_update_night
  FROM privacy_retention.privacy_consent_events AS event
  WHERE event.user_id = v_mapping.user_id
    AND event.purpose = 'night_marketing'
    AND event.channel = 'sms'
    AND event.decision = 'granted'
  ORDER BY event.occurred_at DESC, event.id DESC
  LIMIT 1;
  IF v_insert_ordinary.id IS NULL
     OR v_insert_night.id IS NULL
     OR v_update_ordinary.id IS NULL
     OR v_update_night.id IS NULL THEN
    RAISE EXCEPTION 'owner mapping consent source fixture is missing';
  END IF;

  CREATE TEMPORARY TABLE pg_temp.g014_owner_mapping_tamper_cases (
    case_name text PRIMARY KEY,
    mutation text NOT NULL,
    binding_kind text NOT NULL,
    mismatch_field text NOT NULL
  ) ON COMMIT DROP;
  INSERT INTO pg_temp.g014_owner_mapping_tamper_cases (
    case_name, mutation, binding_kind, mismatch_field
  )
  SELECT 'batch_recipient_' || mutation.value || '_' || binding.value || '_' || mismatch.value,
         mutation.value, binding.value, mismatch.value
  FROM (VALUES ('insert'::text), ('update'::text)) AS mutation(value)
  CROSS JOIN (VALUES ('ordinary'::text), ('night'::text)) AS binding(value)
  CROSS JOIN (VALUES
    ('cross_user_consent_id'::text),
    ('wrong_subject_kind'::text),
    ('wrong_channel'::text),
    ('wrong_purpose'::text),
    ('wrong_decision'::text),
    ('wrong_policy'::text),
    ('wrong_notice'::text),
    ('wrong_guardian_verification_id'::text)
  ) AS mismatch(value);

  FOR v_case IN
    SELECT *
    FROM pg_temp.g014_owner_mapping_tamper_cases
    ORDER BY case_name
  LOOP
    IF v_case.binding_kind = 'ordinary' THEN
      IF v_case.mutation = 'insert' THEN
        v_binding := v_insert_ordinary;
        v_other_consent_id := v_update_ordinary.id;
        v_target_user_id := v_insert_user_id;
      ELSE
        v_binding := v_update_ordinary;
        v_other_consent_id := v_insert_ordinary.id;
        v_target_user_id := v_mapping.user_id;
      END IF;
      v_expected_message := 'marketing_ordinary_consent_binding_invalid';
    ELSE
      IF v_case.mutation = 'insert' THEN
        v_binding := v_insert_night;
        v_other_consent_id := v_update_night.id;
        v_target_user_id := v_insert_user_id;
      ELSE
        v_binding := v_update_night;
        v_other_consent_id := v_insert_night.id;
        v_target_user_id := v_mapping.user_id;
      END IF;
      v_expected_message := 'marketing_night_consent_binding_invalid';
    END IF;

    v_consent_event_id := v_binding.id;
    v_subject_kind := v_binding.subject_kind;
    v_guardian_verification_id := v_binding.guardian_verification_id;
    v_purpose := v_binding.purpose;
    v_channel := v_binding.channel;
    v_decision := v_binding.decision;
    v_policy_version_id := v_binding.policy_version_id;
    v_notice_sha256 := v_binding.notice_sha256;
    CASE v_case.mismatch_field
      WHEN 'cross_user_consent_id' THEN
        v_consent_event_id := v_other_consent_id;
      WHEN 'wrong_subject_kind' THEN
        v_subject_kind := CASE WHEN v_subject_kind = 'self' THEN 'child' ELSE 'self' END;
      WHEN 'wrong_channel' THEN
        v_channel := 'email';
      WHEN 'wrong_purpose' THEN
        v_purpose := CASE
          WHEN v_case.binding_kind = 'ordinary' THEN 'email_marketing'
          ELSE 'sms_marketing'
        END;
      WHEN 'wrong_decision' THEN
        v_decision := 'withdrawn';
      WHEN 'wrong_policy' THEN
        v_policy_version_id := extensions.gen_random_uuid();
      WHEN 'wrong_notice' THEN
        v_notice_sha256 := CASE
          WHEN v_notice_sha256 = repeat('f', 64) THEN repeat('e', 64)
          ELSE repeat('f', 64)
        END;
      WHEN 'wrong_guardian_verification_id' THEN
        v_guardian_verification_id := CASE
          WHEN v_subject_kind = 'self' THEN '14300000-0000-4000-8000-000000000041'::uuid
          ELSE '14300000-0000-4000-8000-000000000045'::uuid
        END;
    END CASE;

    v_before := pg_temp.g014_marketing_state_hash(v_mapping.operation_id);
    BEGIN
      IF v_case.mutation = 'insert' AND v_case.binding_kind = 'ordinary' THEN
        INSERT INTO privacy_retention.marketing_campaign_batch_recipients (
          batch_id, operation_id, user_id, status,
          ordinary_consent_event_id, ordinary_subject_kind, ordinary_guardian_verification_id,
          ordinary_purpose, ordinary_channel, ordinary_decision, ordinary_policy_version_id, ordinary_notice_sha256
        ) VALUES (
          v_mapping.batch_id, v_mapping.operation_id, v_target_user_id, 'eligible',
          v_consent_event_id, v_subject_kind, v_guardian_verification_id,
          v_purpose, v_channel, v_decision, v_policy_version_id, v_notice_sha256
        );
      ELSIF v_case.mutation = 'insert' THEN
        INSERT INTO privacy_retention.marketing_campaign_batch_recipients (
          batch_id, operation_id, user_id, status,
          night_consent_event_id, night_subject_kind, night_guardian_verification_id,
          night_purpose, night_channel, night_decision, night_policy_version_id, night_notice_sha256
        ) VALUES (
          v_mapping.batch_id, v_mapping.operation_id, v_target_user_id, 'eligible',
          v_consent_event_id, v_subject_kind, v_guardian_verification_id,
          v_purpose, v_channel, v_decision, v_policy_version_id, v_notice_sha256
        );
      ELSIF v_case.binding_kind = 'ordinary' THEN
        UPDATE privacy_retention.marketing_campaign_batch_recipients AS mapping
        SET ordinary_consent_event_id = v_consent_event_id,
            ordinary_subject_kind = v_subject_kind,
            ordinary_guardian_verification_id = v_guardian_verification_id,
            ordinary_purpose = v_purpose,
            ordinary_channel = v_channel,
            ordinary_decision = v_decision,
            ordinary_policy_version_id = v_policy_version_id,
            ordinary_notice_sha256 = v_notice_sha256
        WHERE mapping.batch_id = v_mapping.batch_id
          AND mapping.user_id = v_mapping.user_id;
      ELSE
        UPDATE privacy_retention.marketing_campaign_batch_recipients AS mapping
        SET night_consent_event_id = v_consent_event_id,
            night_subject_kind = v_subject_kind,
            night_guardian_verification_id = v_guardian_verification_id,
            night_purpose = v_purpose,
            night_channel = v_channel,
            night_decision = v_decision,
            night_policy_version_id = v_policy_version_id,
            night_notice_sha256 = v_notice_sha256
        WHERE mapping.batch_id = v_mapping.batch_id
          AND mapping.user_id = v_mapping.user_id;
      END IF;
      RAISE EXCEPTION USING
        ERRCODE = 'P9999',
        MESSAGE = 'g014_owner_mapping_tamper_unexpected_success';
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_sqlstate = RETURNED_SQLSTATE, v_message = MESSAGE_TEXT;
      IF v_sqlstate IS DISTINCT FROM '23514'
         OR v_message IS DISTINCT FROM v_expected_message THEN
        RAISE EXCEPTION 'owner mapping tamper % returned % %, expected 23514 %',
          v_case.case_name, v_sqlstate, v_message, v_expected_message;
      END IF;
    END;

    v_after := pg_temp.g014_marketing_state_hash(v_mapping.operation_id);
    IF v_before IS DISTINCT FROM v_after THEN
      RAISE EXCEPTION 'owner mapping tamper % changed canonical durable state', v_case.case_name;
    END IF;
  END LOOP;
END;
$owner_batch_recipient_evidence_adversarial$;
RESET ROLE;
-- Bounded all-suppressed chunks must leave later recipients pending until a distinct
-- idempotency key prepares the next chunk; neither chunk may create provider evidence.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $bounded_suppression_and_guardian_prepare$
DECLARE
  v_preview jsonb;
  v_prepare jsonb;
  v_operation_id uuid;
BEGIN
  v_preview := public.preview_marketing_campaign(
    '14300000-0000-4000-8000-000000000001', 'sms',
    ARRAY[
      '14300000-0000-4000-8000-000000000003'::uuid,
      '14300000-0000-4000-8000-000000000004'::uuid
    ],
    '테스트 안내', '동의한 사용자에게만 발송합니다.', '{}'::jsonb,
    repeat('d', 64), pg_catalog.clock_timestamp() + interval '10 minutes'
  );
  v_operation_id := (v_preview ->> 'operationId')::uuid;
  v_prepare := public.prepare_marketing_campaign_batch(
    v_operation_id, '14300000-0000-4000-8000-000000000001', repeat('d', 64),
    'g014allsuppressed001', 1, 'Asia/Seoul'
  );
  IF v_prepare ->> 'status' IS DISTINCT FROM 'suppressed'
     OR (v_prepare ->> 'remainingRecipients')::integer IS DISTINCT FROM 1
     OR (SELECT count(*) FROM privacy_retention.marketing_campaign_batch_recipients
         WHERE operation_id = v_operation_id AND status = 'suppressed') IS DISTINCT FROM 1
     OR (SELECT count(*) FROM public.marketing_campaign_recipients
         WHERE operation_id = v_operation_id AND status = 'pending') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'all-suppressed bounded chunk did not retain the pending recipient';
  END IF;
  IF (public.prepare_marketing_campaign_batch(
    v_operation_id, '14300000-0000-4000-8000-000000000001', repeat('d', 64),
    'g014allsuppressed001', 1, 'Asia/Seoul'
  ) ->> 'status') IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'all-suppressed idempotency replay was not stable';
  END IF;
  v_prepare := public.prepare_marketing_campaign_batch(
    v_operation_id, '14300000-0000-4000-8000-000000000001', repeat('d', 64),
    'g014allsuppressed002', 1, 'Asia/Seoul'
  );
  IF v_prepare ->> 'status' IS DISTINCT FROM 'completed'
     OR EXISTS (
       SELECT 1 FROM public.marketing_campaign_recipients
       WHERE operation_id = v_operation_id AND status <> 'suppressed'
     )
     OR EXISTS (
       SELECT 1 FROM privacy_retention.marketing_campaign_provider_attempts
       WHERE operation_id = v_operation_id
     ) THEN
    RAISE EXCEPTION 'all-suppressed bounded chunks produced delivery evidence or unresolved rows';
  END IF;

  v_preview := public.preview_marketing_campaign(
    '14300000-0000-4000-8000-000000000001', 'sms',
    ARRAY[
      '14300000-0000-4000-8000-000000000006'::uuid,
      '14300000-0000-4000-8000-000000000007'::uuid,
      '14300000-0000-4000-8000-000000000008'::uuid
    ],
    '테스트 안내', '동의한 사용자에게만 발송합니다.', '{}'::jsonb,
    repeat('e', 64), pg_catalog.clock_timestamp() + interval '10 minutes'
  );
  v_operation_id := (v_preview ->> 'operationId')::uuid;
  v_prepare := public.prepare_marketing_campaign_batch(
    v_operation_id, '14300000-0000-4000-8000-000000000001', repeat('e', 64),
    'g014guardianprepare001', 3, 'Asia/Seoul'
  );
  IF v_prepare ->> 'status' IS DISTINCT FROM 'completed'
     OR EXISTS (
       SELECT 1 FROM public.marketing_campaign_recipients
       WHERE operation_id = v_operation_id AND status <> 'suppressed'
     ) THEN
    RAISE EXCEPTION 'expired, withdrawn, or future guardian was not suppressed during prepare';
  END IF;
END;
$bounded_suppression_and_guardian_prepare$;
RESET ROLE;

-- An existing but different claimed batch cannot consume another batch's provider
-- attempt. The winning cross-batch mismatch leaves the second attempt unknown until
-- its own explicit provider outcome is recorded.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $cross_batch_provider_binding$
DECLARE
  v_preview jsonb;
  v_prepare jsonb;
  v_claim jsonb;
  v_operation_id uuid;
  v_batch_id uuid;
  v_attempt_id uuid;
  v_before_status text;
BEGIN
  v_preview := public.preview_marketing_campaign(
    '14300000-0000-4000-8000-000000000001', 'sms',
    ARRAY['14300000-0000-4000-8000-000000000002'::uuid],
    '테스트 안내', '동의한 사용자에게만 발송합니다.', '{}'::jsonb,
    repeat('3', 64), pg_catalog.clock_timestamp() + interval '10 minutes'
  );
  v_operation_id := (v_preview ->> 'operationId')::uuid;
  v_prepare := public.prepare_marketing_campaign_batch(
    v_operation_id, '14300000-0000-4000-8000-000000000001', repeat('3', 64),
    'g014crossbatch001', 1, 'Asia/Seoul'
  );
  v_batch_id := (v_prepare ->> 'batchId')::uuid;
  v_claim := public.claim_marketing_campaign_dispatch(
    v_operation_id, v_batch_id, '14300000-0000-4000-8000-000000000001', repeat('3', 64),
    'g014crossbatch001', 'Asia/Seoul'
  );
  v_attempt_id := (v_claim ->> 'providerAttemptId')::uuid;
  SELECT status INTO v_before_status
  FROM privacy_retention.marketing_campaign_provider_attempts
  WHERE id = v_attempt_id;
  BEGIN
    PERFORM public.finalize_marketing_campaign_batch(
      v_operation_id, v_batch_id, '14300000-0000-4000-8000-000000000001', repeat('3', 64),
      (v_claim ->> 'claimToken')::uuid,
      (
        SELECT id
        FROM privacy_retention.marketing_campaign_provider_attempts
        WHERE status = 'accepted'
        ORDER BY created_at, id
        LIMIT 1
      ),
      'receipt-cross-batch', repeat('4', 64), v_claim ->> 'payloadDigest',
      ARRAY['14300000-0000-4000-8000-000000000002'::uuid], 'Asia/Seoul'
    );
    RAISE EXCEPTION 'existing cross-batch attempt unexpectedly finalized';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  IF v_before_status IS DISTINCT FROM (
    SELECT status FROM privacy_retention.marketing_campaign_provider_attempts WHERE id = v_attempt_id
  ) OR (SELECT status FROM public.marketing_campaign_batches WHERE id = v_batch_id) IS DISTINCT FROM 'claimed' THEN
    RAISE EXCEPTION 'cross-batch mismatch changed the second durable attempt';
  END IF;
  PERFORM public.fail_marketing_campaign_provider_attempt(
    v_operation_id, v_batch_id, '14300000-0000-4000-8000-000000000001', repeat('3', 64),
    (v_claim ->> 'claimToken')::uuid, v_attempt_id,
    'receipt-cross-batch-own', repeat('4', 64), v_claim ->> 'payloadDigest',
    'provider_rejected'
  );
END;
$cross_batch_provider_binding$;
RESET ROLE;
-- A guardian withdrawal after prepare blocks claim; after provider acceptance it
-- suppresses only the in-app artifact while retaining accepted transport truth.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $withdrawal_before_claim_and_finalize$
DECLARE
  v_preview jsonb;
  v_prepare jsonb;
  v_claim jsonb;
  v_final jsonb;
  v_operation_id uuid;
  v_batch_id uuid;
BEGIN
  v_preview := public.preview_marketing_campaign(
    '14300000-0000-4000-8000-000000000001', 'sms',
    ARRAY['14300000-0000-4000-8000-000000000005'::uuid],
    '테스트 안내', '동의한 사용자에게만 발송합니다.', '{}'::jsonb,
    repeat('f', 64), pg_catalog.clock_timestamp() + interval '10 minutes'
  );
  v_operation_id := (v_preview ->> 'operationId')::uuid;
  v_prepare := public.prepare_marketing_campaign_batch(
    v_operation_id, '14300000-0000-4000-8000-000000000001', repeat('f', 64),
    'g014withdrawclaim001', 1, 'Asia/Seoul'
  );
  v_batch_id := (v_prepare ->> 'batchId')::uuid;
  SET LOCAL ROLE privacy_workflow_owner;
  UPDATE privacy_retention.privacy_guardian_verifications
  SET status = 'withdrawn', withdrawn_at = pg_catalog.clock_timestamp()
  WHERE id = '14300000-0000-4000-8000-000000000041';
  SET LOCAL ROLE service_role;
  v_claim := public.claim_marketing_campaign_dispatch(
    v_operation_id, v_batch_id, '14300000-0000-4000-8000-000000000001', repeat('f', 64),
    'g014withdrawclaim001', 'Asia/Seoul'
  );
  IF v_claim ->> 'status' IS DISTINCT FROM 'completed'
     OR EXISTS (
       SELECT 1 FROM privacy_retention.marketing_campaign_provider_attempts
       WHERE operation_id = v_operation_id
     ) THEN
    RAISE EXCEPTION 'guardian withdrawal before claim did not prevent the durable provider attempt';
  END IF;

  v_preview := public.preview_marketing_campaign(
    '14300000-0000-4000-8000-000000000001', 'sms',
    ARRAY['14300000-0000-4000-8000-000000000009'::uuid],
    '테스트 안내', '동의한 사용자에게만 발송합니다.', '{}'::jsonb,
    repeat('1', 64), pg_catalog.clock_timestamp() + interval '10 minutes'
  );
  v_operation_id := (v_preview ->> 'operationId')::uuid;
  v_prepare := public.prepare_marketing_campaign_batch(
    v_operation_id, '14300000-0000-4000-8000-000000000001', repeat('1', 64),
    'g014withdrawfinal001', 1, 'Asia/Seoul'
  );
  v_batch_id := (v_prepare ->> 'batchId')::uuid;
  v_claim := public.claim_marketing_campaign_dispatch(
    v_operation_id, v_batch_id, '14300000-0000-4000-8000-000000000001', repeat('1', 64),
    'g014withdrawfinal001', 'Asia/Seoul'
  );
  IF v_claim ->> 'status' IS DISTINCT FROM 'claimed' THEN
    RAISE EXCEPTION 'live guardian did not produce a durable claim before final withdrawal';
  END IF;
  SET LOCAL ROLE privacy_workflow_owner;
  UPDATE privacy_retention.privacy_guardian_verifications
  SET status = 'withdrawn', withdrawn_at = pg_catalog.clock_timestamp()
  WHERE id = '14300000-0000-4000-8000-000000000045';
  SET LOCAL ROLE service_role;
  v_final := public.finalize_marketing_campaign_batch(
    v_operation_id, v_batch_id, '14300000-0000-4000-8000-000000000001', repeat('1', 64),
    (v_claim ->> 'claimToken')::uuid, (v_claim ->> 'providerAttemptId')::uuid,
    'receipt-withdrawn-final', repeat('2', 64), v_claim ->> 'payloadDigest',
    ARRAY['14300000-0000-4000-8000-000000000009'::uuid], 'Asia/Seoul'
  );
  IF (v_final -> 'readback' ->> 'passed') IS DISTINCT FROM 'true'
     OR (v_final -> 'counts' ->> 'sent') IS DISTINCT FROM '1'
     OR (v_final -> 'counts' ->> 'suppressed') IS DISTINCT FROM '0'
     OR EXISTS (
       SELECT 1 FROM public.notifications
       WHERE campaign_operation_id = v_operation_id
     )
     OR NOT EXISTS (
       SELECT 1
       FROM privacy_retention.marketing_campaign_provider_attempts AS attempt
       WHERE attempt.id = (v_claim ->> 'providerAttemptId')::uuid
         AND attempt.status = 'accepted'
         AND attempt.accepted_recipient_ids IS NOT DISTINCT FROM ARRAY[
           '14300000-0000-4000-8000-000000000009'::uuid
         ]
     )
     OR NOT EXISTS (
       SELECT 1
       FROM privacy_retention.marketing_campaign_batch_recipients AS recipient
       WHERE recipient.batch_id = v_batch_id
         AND recipient.user_id = '14300000-0000-4000-8000-000000000009'
         AND recipient.provider_accepted_at IS NOT NULL
         AND recipient.notification_eligibility_outcome = 'notification_suppressed_after_acceptance'
     )
     OR (
       SELECT recipient.status
       FROM public.marketing_campaign_recipients AS recipient
       WHERE recipient.operation_id = v_operation_id
         AND recipient.user_id = '14300000-0000-4000-8000-000000000009'
     ) IS DISTINCT FROM 'sent'
     OR (
       SELECT audit.count_summary ->> 'transportAccepted'
       FROM privacy_retention.privacy_audit_events AS audit
       JOIN public.marketing_campaign_operations AS operation
         ON operation.audit_id = audit.id
       WHERE operation.id = v_operation_id
     ) IS DISTINCT FROM '1'
     OR (
       SELECT audit.count_summary ->> 'notificationSuppressedAfterAcceptance'
       FROM privacy_retention.privacy_audit_events AS audit
       JOIN public.marketing_campaign_operations AS operation
         ON operation.audit_id = audit.id
       WHERE operation.id = v_operation_id
     ) IS DISTINCT FROM '1' THEN
    RAISE EXCEPTION 'guardian withdrawal after provider acceptance rewrote transport truth or omitted cleanup evidence';
  END IF;
END;
$withdrawal_before_claim_and_finalize$;
RESET ROLE;

-- Provider attempts are append/state-only even for their owning workflow role:
-- deletes, identity/creation rewrites, and any second outcome transition are rejected.
SET LOCAL ROLE privacy_workflow_owner;
DO $owner_provider_attempt_adversarial$
DECLARE
  v_attempt_id uuid := (
    SELECT id
    FROM privacy_retention.marketing_campaign_provider_attempts
    WHERE status = 'accepted'
    ORDER BY created_at, id
    LIMIT 1
  );
BEGIN
  BEGIN
    DELETE FROM privacy_retention.marketing_campaign_provider_attempts WHERE id = v_attempt_id;
    RAISE EXCEPTION 'owner path deleted provider attempt evidence';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
  BEGIN
    UPDATE privacy_retention.marketing_campaign_provider_attempts
    SET id = extensions.gen_random_uuid()
    WHERE id = v_attempt_id;
    RAISE EXCEPTION 'owner path rewrote immutable provider attempt id';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE privacy_retention.marketing_campaign_provider_attempts
    SET created_at = pg_catalog.clock_timestamp(),
        payload_digest = repeat('f', 64)
    WHERE id = v_attempt_id;
    RAISE EXCEPTION 'owner path rewrote immutable provider attempt bindings';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    UPDATE privacy_retention.marketing_campaign_provider_attempts
    SET provider_receipt_hash = repeat('f', 64)
    WHERE id = v_attempt_id;
    RAISE EXCEPTION 'owner path rewrote the recorded provider outcome';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
END;
$owner_provider_attempt_adversarial$;
RESET ROLE;


-- actor_user_id is nullable ON DELETE SET NULL, while actor_ref_hash is durable.
DO $actor_deletion$
DECLARE
  v_hash text;
BEGIN
  SELECT actor_ref_hash INTO v_hash
  FROM public.marketing_campaign_operations
  WHERE actor_user_id = '14300000-0000-4000-8000-000000000001';
  DELETE FROM auth.users WHERE id = '14300000-0000-4000-8000-000000000001';
  IF EXISTS (
    SELECT 1 FROM public.marketing_campaign_operations
    WHERE actor_ref_hash = v_hash AND actor_user_id IS NOT NULL
  ) OR v_hash IS NULL THEN
    RAISE EXCEPTION 'actor deletion was blocked or erased the durable actor hash';
  END IF;
END;
$actor_deletion$;

-- Behavioral route coverage is kept with the route itself, using injected DNS,
-- fetch, and RPC boundaries. SQL coverage here owns the durable state contract.

ROLLBACK;
