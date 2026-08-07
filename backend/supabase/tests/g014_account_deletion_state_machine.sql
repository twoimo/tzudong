\set ON_ERROR_STOP on

-- Run only in a disposable local Supabase database after G014-01..04.
-- This script intentionally emits no subject, storage locator, or provider receipt.
BEGIN;

DO $catalog_contract$
DECLARE
  v_signature text;
  v_oid oid;
  v_search_path text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('privacy_retention.account_deletion_external_jobs'),
      ('privacy_retention.account_deletion_external_job_attempts'),
      ('privacy_retention.account_deletion_external_job_checkpoints'),
      ('privacy_retention.account_deletion_external_job_provider_proofs')
    ) AS expected(relation_name)
    WHERE pg_catalog.to_regclass(expected.relation_name) IS NULL
  ) THEN
    RAISE EXCEPTION 'G014-05 durable external-job relation is missing';
  END IF;
  IF (
    SELECT count(*)
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'privacy_retention.account_deletion_external_job_attempts'::regclass
      AND attname IN ('storage_object_locator_hash', 'storage_object_version_hash')
      AND NOT attisdropped
  ) <> 2
  OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('g014_account_deletion_attempt_storage_object_binding'),
      ('g014_account_deletion_attempt_storage_object_fk'),
      ('g014_account_deletion_storage_object_locator_version_key')
    ) AS expected(constraint_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint
      WHERE conname = expected.constraint_name
    )
  ) THEN
    RAISE EXCEPTION 'G014-06 object-granular attempt binding is missing';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'privacy_retention.account_deletion_storage_objects'::regclass
      AND attname IN ('bucket_id', 'object_name')
      AND NOT attisdropped
  )
  OR (
    SELECT count(*)
    FROM pg_catalog.pg_attribute
    WHERE attrelid = 'privacy_retention.account_deletion_storage_objects'::regclass
      AND attname IN ('object_id', 'object_version', 'object_locator_hash', 'object_version_hash')
      AND NOT attisdropped
  ) <> 4 THEN
    RAISE EXCEPTION 'G014-09 captured storage evidence is not opaque';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.claim_account_deletion_external_job(uuid,uuid,uuid,text,text,text,text,uuid)',
    'public.prepare_account_deletion_external_egress(uuid,uuid,uuid,text,text,text,text,uuid)',
    'public.read_account_deletion_external_job(uuid,uuid,uuid,text,text,text,text,uuid)',
    'public.run_account_deletion_session_family_cleanup(uuid,uuid,uuid,text,text,text,uuid)',
    'public.get_account_deletion_storage_work(uuid,uuid,uuid,text,text,text,uuid)',
    'public.record_account_deletion_external_provider_proof(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text)',
    'public.reconcile_account_deletion_storage_job(uuid,uuid,uuid,text,text,text,uuid)',
    'public.reconcile_account_deletion_auth_job(uuid,uuid,uuid,text,text,text,uuid)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    SELECT setting.value INTO v_search_path
    FROM pg_catalog.unnest((
      SELECT procedure.proconfig FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_oid
    )) AS setting(value)
    WHERE setting.value LIKE 'search_path=%';

    IF v_oid IS NULL
       OR NOT (SELECT procedure.prosecdef FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_oid)
       OR pg_catalog.pg_get_userbyid((SELECT procedure.proowner FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_oid))
          IS DISTINCT FROM 'privacy_workflow_owner'
       OR (v_search_path IS DISTINCT FROM 'search_path=' AND v_search_path IS DISTINCT FROM 'search_path=""')
       OR NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'G014-05 RPC owner/path/grant contract failed for %', v_signature;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('privacy_retention.account_deletion_external_jobs'),
      ('privacy_retention.account_deletion_external_job_attempts'),
      ('privacy_retention.account_deletion_external_job_checkpoints'),
      ('privacy_retention.account_deletion_external_job_provider_proofs')
    ) AS private_relation(relation_name)
    JOIN pg_catalog.pg_class AS relation_row
      ON relation_row.oid = pg_catalog.to_regclass(private_relation.relation_name)
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = relation_row.relowner
    WHERE owner_role.rolname IS DISTINCT FROM 'privacy_workflow_owner'
       OR NOT relation_row.relrowsecurity
       OR NOT relation_row.relforcerowsecurity
       OR pg_catalog.has_table_privilege('service_role', private_relation.relation_name, 'INSERT')
       OR pg_catalog.has_table_privilege('service_role', private_relation.relation_name, 'UPDATE')
       OR pg_catalog.has_table_privilege('service_role', private_relation.relation_name, 'DELETE')
  ) THEN
    RAISE EXCEPTION 'G014-05 private job RLS/direct-DML contract failed';
  END IF;

  IF pg_catalog.has_function_privilege(
       'service_role',
       'public.claim_account_deletion_external_phase(uuid,uuid,uuid,text,text,text,text)'::regprocedure,
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role',
       'public.finalize_account_deletion_storage(uuid,uuid,uuid,text,text,text,uuid,jsonb)'::regprocedure,
       'EXECUTE'
     )
     OR pg_catalog.has_function_privilege(
       'service_role',
       'public.finalize_account_deletion_auth(uuid,uuid,uuid,text,text,text,uuid,text)'::regprocedure,
       'EXECUTE'
     )
     OR pg_catalog.has_table_privilege('service_role', 'auth.sessions', 'DELETE')
     OR pg_catalog.has_table_privilege('service_role', 'auth.refresh_tokens', 'DELETE')
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger AS trigger_row
       WHERE trigger_row.tgrelid = 'privacy_retention.privacy_legal_holds'::regclass
         AND trigger_row.tgname = 'g014_account_deletion_hold_subject_lock'
         AND pg_catalog.pg_get_triggerdef(trigger_row.oid)
             ~ 'UPDATE OF status, expires_at, subject_ref_hash, data_class'
     ) THEN
    RAISE EXCEPTION 'G014-05 legacy egress or legal-hold update fence remains exposed';
  END IF;
END;
$catalog_contract$;

CREATE OR REPLACE FUNCTION pg_temp.g014_deletion_state_hash(p_request_id uuid)
RETURNS jsonb
LANGUAGE sql
SET search_path = ''
AS $state_hash$
  SELECT pg_catalog.jsonb_build_object(
    'request', pg_catalog.encode(extensions.digest(COALESCE((
      SELECT pg_catalog.to_jsonb(request_row)::text
      FROM public.account_deletion_requests AS request_row WHERE request_row.id = p_request_id
    ), ''), 'sha256'), 'hex'),
    'items', pg_catalog.encode(extensions.digest(COALESCE((
      SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(item_row) ORDER BY item_row.data_class_code)::text
      FROM public.account_deletion_request_items AS item_row WHERE item_row.request_id = p_request_id
    ), '[]'), 'sha256'), 'hex')
  );
$state_hash$;

CREATE OR REPLACE FUNCTION pg_temp.g014_expect_failure(p_sql text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $expect_failure$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;
  RAISE EXCEPTION 'expected fail-closed SQL rejection';
END;
$expect_failure$;

-- Manifest source drift is detected from real catalog contracts; no fixture-only
-- foreign keys are added anywhere in this script.
DO $manifest_drift$
DECLARE
  v_active public.account_deletion_policies%ROWTYPE;
  v_clone text := 'g014-manifest-drift-v1';
BEGIN
  SELECT * INTO v_active FROM public.account_deletion_policies WHERE status = 'active';
  INSERT INTO public.account_deletion_policies (version, status, preview_ttl, reauth_max_age, confirmation_text)
  VALUES (v_clone, 'disabled', v_active.preview_ttl, v_active.reauth_max_age, v_active.confirmation_text);
  INSERT INTO public.account_deletion_data_classes (policy_version, code, disposition, mandatory)
  SELECT v_clone, code, disposition, mandatory
  FROM public.account_deletion_data_classes WHERE policy_version = v_active.version;
  INSERT INTO privacy_retention.account_deletion_source_manifest (
    policy_version, code, relation_name, subject_column, adapter_name, required, ordinal, contract_hash
  )
  SELECT
    v_clone, manifest.code, manifest.relation_name, manifest.subject_column,
    manifest.adapter_name, manifest.required, manifest.ordinal,
    privacy_retention.g014_account_deletion_manifest_contract_hash(
      v_clone, manifest.code, manifest.relation_name, manifest.subject_column,
      manifest.adapter_name, manifest.required, manifest.ordinal
    )
  FROM privacy_retention.account_deletion_source_manifest AS manifest
  WHERE manifest.policy_version = v_active.version;

  UPDATE privacy_retention.account_deletion_source_manifest
  SET relation_name = 'public.g014_missing_source_relation',
      contract_hash = privacy_retention.g014_account_deletion_manifest_contract_hash(
        v_clone, code, 'public.g014_missing_source_relation', subject_column,
        adapter_name, required, ordinal
      )
  WHERE policy_version = v_clone AND code = 'submission_drafts';
  PERFORM pg_temp.g014_expect_failure(format(
    'SELECT privacy_retention.g014_account_deletion_validate_manifest(%L)', v_clone
  ));
END;
$manifest_drift$;

UPDATE privacy_retention.privacy_retention_classes
SET data_class = 'privacy_account_deletion_audit',
    basis_code = 'g014.test.account_deletion_audit',
    trigger_type = 'event_occurred',
    retention_period = interval '30 days',
    status = 'active',
    approved_evidence_ref = 'G014-04-TEST-ACCOUNT-DELETION-AUDIT',
    version = 'g014-04-test-v1'
WHERE code = 'privacy_account_deletion_audit';

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at, last_sign_in_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('14400000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'g014-delete-target@example.invalid', 'disabled', clock_timestamp(), clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
  ('14400000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'g014-delete-admin-one@example.invalid', 'disabled', clock_timestamp(), clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp()),
  ('14400000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'g014-delete-admin-two@example.invalid', 'disabled', clock_timestamp(), clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, clock_timestamp(), clock_timestamp());
INSERT INTO public.user_roles (user_id, role) VALUES
  ('14400000-0000-4000-8000-000000000002', 'admin'),
  ('14400000-0000-4000-8000-000000000003', 'admin');
INSERT INTO public.user_account_status (user_id, account_status) VALUES
  ('14400000-0000-4000-8000-000000000002', 'active'),
  ('14400000-0000-4000-8000-000000000003', 'active');
INSERT INTO public.profiles (user_id, username, nickname, avatar_url, role)
VALUES ('14400000-0000-4000-8000-000000000001', 'g014-delete-target', 'G014 target', NULL, 'user');
INSERT INTO public.restaurant_submissions (
  id, user_id, submission_type, status, restaurant_name, restaurant_phone, restaurant_address, restaurant_categories
) VALUES (
  '14400000-0000-4000-8000-000000000011', '14400000-0000-4000-8000-000000000001',
  'new', 'pending', 'G014 server draft', '010-1440-0001', 'Seoul', ARRAY['한식']::text[]
);
INSERT INTO storage.buckets (id, name, public)
VALUES ('g014-test', 'g014-test', false)
ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.objects (id, bucket_id, name, owner_id, version)
VALUES
  (
    '14400000-0000-4000-8000-000000000012', 'g014-test', 'deletion-draft-one.bin',
    '14400000-0000-4000-8000-000000000001', 'g014-version-0001'
  ),
  (
    '14400000-0000-4000-8000-000000000020', 'g014-test', 'deletion-draft-two.bin',
    '14400000-0000-4000-8000-000000000001', 'g014-version-0002'
  );
INSERT INTO public.marketing_campaign_operations (
  id, actor_user_id, actor_ref_hash, channel, title, message, data, preview_hash, expires_at, status
) VALUES (
  '14400000-0000-4000-8000-000000000013',
  '14400000-0000-4000-8000-000000000001',
  pg_catalog.encode(extensions.digest('marketing-actor:v1:14400000-0000-4000-8000-000000000001', 'sha256'), 'hex'),
  'email', 'G014', 'fixture', '{}'::jsonb, repeat('a', 64), clock_timestamp() + interval '1 hour', 'previewed'
);
INSERT INTO privacy_retention.privacy_consent_events (
  id, user_id, subject_kind, guardian_verification_id, purpose, channel, decision,
  policy_version_id, notice_sha256, source, correlation_id, idempotency_key
)
SELECT
  '14400000-0000-4000-8000-000000000014',
  '14400000-0000-4000-8000-000000000001', 'self', NULL, 'email_marketing', 'email', 'granted',
  policy.id, repeat('b', 64), 'settings', '14400000-0000-4000-8000-000000000015', 'g014consentfixture0001'
FROM privacy_retention.privacy_policy_versions AS policy
ORDER BY policy.created_at
LIMIT 1;
SELECT privacy_retention.append_privacy_audit_event_internal(
  'account_deletion',
  '14400000-0000-4000-8000-000000000001',
  '14400000-0000-4000-8000-000000000001',
  '14400000-0000-4000-8000-000000000018',
  '14400000-0000-4000-8000-000000000019',
  'confirmed',
  'AUDIT_SEED',
  pg_catalog.jsonb_build_object('requested', 0),
  pg_catalog.jsonb_build_object('route', '/api/account/delete')
);
SELECT pg_temp.g014_expect_failure(
  'UPDATE privacy_retention.privacy_audit_events
   SET actor_user_id = NULL
   WHERE operation_id = ''14400000-0000-4000-8000-000000000018'''
);
INSERT INTO public.marketing_campaign_recipients (
  operation_id, user_id, status, consent_event_id
) VALUES (
  '14400000-0000-4000-8000-000000000013',
  '14400000-0000-4000-8000-000000000001',
  'eligible',
  '14400000-0000-4000-8000-000000000014'
);
INSERT INTO public.marketing_campaign_batches (
  id, operation_id, idempotency_key, status, eligible_count
) VALUES (
  '14400000-0000-4000-8000-000000000016',
  '14400000-0000-4000-8000-000000000013',
  'g014-batch-fixture-0001', 'prepared', 1
);
INSERT INTO privacy_retention.marketing_campaign_batch_recipients (
  batch_id, operation_id, user_id, status,
  ordinary_consent_event_id, ordinary_subject_kind, ordinary_guardian_verification_id,
  ordinary_purpose, ordinary_channel, ordinary_decision,
  ordinary_policy_version_id, ordinary_notice_sha256
)
SELECT
  '14400000-0000-4000-8000-000000000016',
  '14400000-0000-4000-8000-000000000013',
  consent.user_id, 'eligible',
  consent.id, consent.subject_kind, consent.guardian_verification_id,
  consent.purpose, consent.channel, consent.decision,
  consent.policy_version_id, consent.notice_sha256
FROM privacy_retention.privacy_consent_events AS consent
WHERE consent.id = '14400000-0000-4000-8000-000000000014';
INSERT INTO privacy_retention.marketing_campaign_consent_evidence_keys (
  id, batch_id, operation_id, user_id, evidence_kind, consent_event_id,
  subject_kind, guardian_verification_id, purpose, channel, decision,
  policy_version_id, notice_sha256
)
SELECT
  '14400000-0000-4000-8000-000000000017',
  '14400000-0000-4000-8000-000000000016',
  '14400000-0000-4000-8000-000000000013',
  consent.user_id, 'claim_ordinary', consent.id,
  consent.subject_kind, consent.guardian_verification_id, consent.purpose,
  consent.channel, consent.decision, consent.policy_version_id, consent.notice_sha256
FROM privacy_retention.privacy_consent_events AS consent
WHERE consent.id = '14400000-0000-4000-8000-000000000014';
SELECT pg_temp.g014_expect_failure(
  'DELETE FROM privacy_retention.marketing_campaign_consent_evidence_keys WHERE id = ''14400000-0000-4000-8000-000000000017'''
);

CREATE TEMPORARY TABLE pg_temp.g014_fixture (
  name text PRIMARY KEY,
  value text NOT NULL
) ON COMMIT DROP;
INSERT INTO pg_temp.g014_fixture (name, value)
SELECT
  'reauthenticated_at:' || user_row.id::text,
  user_row.last_sign_in_at::text
FROM auth.users AS user_row
WHERE user_row.id IN (
  '14400000-0000-4000-8000-000000000001',
  '14400000-0000-4000-8000-000000000002'
);
GRANT ALL ON TABLE pg_temp.g014_fixture TO service_role;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $durable_external_job_recovery_matrix$
DECLARE
  v_admin_preview record;
  v_preview record;
  v_session_claim record;
  v_session_busy record;
  v_session_replay record;
  v_storage_claim record;
  v_storage_second_claim record;
  v_storage_work record;
  v_storage_second_work record;
  v_auth_claim record;
  v_result record;
  v_recovery_storage_work record;
  v_auth_busy record;
  v_admin_reauth timestamptz := (
    SELECT value::timestamptz FROM pg_temp.g014_fixture
    WHERE name = 'reauthenticated_at:14400000-0000-4000-8000-000000000002'
  );
  v_target_reauth timestamptz := (
    SELECT value::timestamptz FROM pg_temp.g014_fixture
    WHERE name = 'reauthenticated_at:14400000-0000-4000-8000-000000000001'
  );
  v_storage_receipt_hash text := repeat('c', 64);
  v_storage_second_receipt_hash text := repeat('d', 64);
BEGIN
  -- Database cleanup now deliberately leaves the durable session job pending;
  -- resumption needs no end-user authentication.
  SELECT * INTO v_admin_preview FROM public.preview_account_deletion(
    '14400000-0000-4000-8000-000000000002',
    '14400000-0000-4000-8000-000000000002',
    v_admin_reauth
  );
  PERFORM * FROM public.begin_account_deletion_apply(
    '14400000-0000-4000-8000-000000000002',
    '14400000-0000-4000-8000-000000000002',
    v_admin_preview.request_id, v_admin_preview.preview_hash, '계정 삭제',
    'g014-admin-session-pending-0001', v_admin_reauth, v_admin_preview.source_manifest_hash
  );
  PERFORM * FROM public.apply_account_deletion_database_cleanup(
    '14400000-0000-4000-8000-000000000002',
    '14400000-0000-4000-8000-000000000002',
    v_admin_preview.request_id, v_admin_preview.preview_hash,
    'g014-admin-session-pending-0001', v_admin_preview.source_manifest_hash
  );
  SELECT * INTO v_session_claim FROM public.claim_account_deletion_external_job(
    '14400000-0000-4000-8000-000000000002',
    '14400000-0000-4000-8000-000000000002',
    v_admin_preview.request_id, v_admin_preview.preview_hash,
    'g014-admin-session-pending-0001', v_admin_preview.source_manifest_hash, 'session', NULL
  );
  IF v_session_claim.claim_status IS DISTINCT FROM 'claimed'
     OR v_session_claim.attempt_token IS NULL
     OR (SELECT db_readback_passed FROM public.account_deletion_requests WHERE id = v_admin_preview.request_id) IS NOT TRUE
     OR (SELECT session_readback_passed FROM public.account_deletion_requests WHERE id = v_admin_preview.request_id) IS NOT FALSE THEN
    RAISE EXCEPTION 'database-complete/session-pending durable resume fixture failed';
  END IF;

  -- A different worker cannot obtain a second token; the exact token replays.
  SELECT * INTO v_session_busy FROM public.claim_account_deletion_external_job(
    '14400000-0000-4000-8000-000000000002',
    '14400000-0000-4000-8000-000000000002',
    v_admin_preview.request_id, v_admin_preview.preview_hash,
    'g014-admin-session-pending-0001', v_admin_preview.source_manifest_hash, 'session', NULL
  );
  SELECT * INTO v_session_replay FROM public.claim_account_deletion_external_job(
    '14400000-0000-4000-8000-000000000002',
    '14400000-0000-4000-8000-000000000002',
    v_admin_preview.request_id, v_admin_preview.preview_hash,
    'g014-admin-session-pending-0001', v_admin_preview.source_manifest_hash, 'session',
    v_session_claim.attempt_token
  );
  IF v_session_busy.claim_status IS DISTINCT FROM 'busy'
     OR v_session_busy.attempt_token IS NOT NULL
     OR v_session_replay.claim_status IS DISTINCT FROM 'replayed'
     OR v_session_replay.attempt_token IS DISTINCT FROM v_session_claim.attempt_token THEN
    RAISE EXCEPTION 'same-request competing claim received an egress token';
  END IF;
  PERFORM pg_temp.g014_expect_failure(format(
    'SELECT public.fail_account_deletion(%L,%L,%L,%L,%L,%L,''SESSION_READBACK_REQUIRED'')',
    '14400000-0000-4000-8000-000000000002',
    '14400000-0000-4000-8000-000000000002',
    v_admin_preview.request_id,
    v_admin_preview.preview_hash,
    'g014-admin-session-pending-0001',
    v_admin_preview.source_manifest_hash
  ));

  -- Completed receipts bind the original attempt and replay before the
  -- predecessor is evaluated.  This request owns no storage objects, so its
  -- zero-storage preparation must complete with the sole canonical state.
  PERFORM * FROM public.prepare_account_deletion_external_egress(
    '14400000-0000-4000-8000-000000000002',
    '14400000-0000-4000-8000-000000000002',
    v_admin_preview.request_id, v_admin_preview.preview_hash,
    'g014-admin-session-pending-0001', v_admin_preview.source_manifest_hash, 'session',
    v_session_claim.attempt_token
  );
  SELECT * INTO v_session_replay FROM public.claim_account_deletion_external_job(
    '14400000-0000-4000-8000-000000000002',
    '14400000-0000-4000-8000-000000000002',
    v_admin_preview.request_id, v_admin_preview.preview_hash,
    'g014-admin-session-pending-0001', v_admin_preview.source_manifest_hash, 'session', NULL
  );
  IF v_session_replay.claim_status IS DISTINCT FROM 'replayed'
     OR v_session_replay.attempt_token IS DISTINCT FROM v_session_claim.attempt_token
     OR v_session_replay.lease_expires_at IS NOT NULL
     OR v_session_replay.job_state IS DISTINCT FROM 'egress_unknown'
     OR v_session_replay.checkpoint_state IS DISTINCT FROM 'verify_absence_only' THEN
    RAISE EXCEPTION 'live egress-unknown session replay renewed delete authority';
  END IF;
  PERFORM * FROM public.run_account_deletion_session_family_cleanup(
    '14400000-0000-4000-8000-000000000002',
    '14400000-0000-4000-8000-000000000002',
    v_admin_preview.request_id, v_admin_preview.preview_hash,
    'g014-admin-session-pending-0001', v_admin_preview.source_manifest_hash,
    v_session_claim.attempt_token
  );
  SELECT * INTO v_session_replay FROM public.claim_account_deletion_external_job(
    '14400000-0000-4000-8000-000000000002',
    '14400000-0000-4000-8000-000000000002',
    v_admin_preview.request_id, v_admin_preview.preview_hash,
    'g014-admin-session-pending-0001', v_admin_preview.source_manifest_hash, 'session', NULL
  );
  IF v_session_replay.claim_status IS DISTINCT FROM 'completed'
     OR v_session_replay.attempt_token IS DISTINCT FROM v_session_claim.attempt_token
     OR v_session_replay.job_state IS DISTINCT FROM 'completed'
     OR v_session_replay.checkpoint_state IS DISTINCT FROM 'authoritative_absent' THEN
    RAISE EXCEPTION 'completed session receipt did not replay durably';
  END IF;
  PERFORM pg_temp.g014_expect_failure(format(
    'SELECT * FROM public.claim_account_deletion_external_job(%L,%L,%L,%L,%L,%L,%L,%L)',
    '14400000-0000-4000-8000-000000000002',
    '14400000-0000-4000-8000-000000000002',
    v_admin_preview.request_id,
    v_admin_preview.preview_hash,
    'g014-admin-session-pending-0001',
    v_admin_preview.source_manifest_hash,
    'session',
    '14400000-0000-4000-8000-000000000099'
  ));

  SELECT * INTO v_storage_claim FROM public.claim_account_deletion_external_job(
    '14400000-0000-4000-8000-000000000002',
    '14400000-0000-4000-8000-000000000002',
    v_admin_preview.request_id, v_admin_preview.preview_hash,
    'g014-admin-session-pending-0001', v_admin_preview.source_manifest_hash, 'storage', NULL
  );
  SELECT * INTO v_result FROM public.prepare_account_deletion_external_egress(
    '14400000-0000-4000-8000-000000000002',
    '14400000-0000-4000-8000-000000000002',
    v_admin_preview.request_id, v_admin_preview.preview_hash,
    'g014-admin-session-pending-0001', v_admin_preview.source_manifest_hash, 'storage',
    v_storage_claim.attempt_token
  );
  IF v_result.egress_state IS DISTINCT FROM 'authoritative_absent'
     OR v_result.provider_idempotency_key IS NOT NULL
     OR (SELECT storage_readback_passed
         FROM public.account_deletion_requests
         WHERE id = v_admin_preview.request_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'zero-storage preparation was not canonically completed';
  END IF;
  SELECT * INTO v_result FROM public.claim_account_deletion_external_job(
    '14400000-0000-4000-8000-000000000002',
    '14400000-0000-4000-8000-000000000002',
    v_admin_preview.request_id, v_admin_preview.preview_hash,
    'g014-admin-session-pending-0001', v_admin_preview.source_manifest_hash, 'storage', NULL
  );
  IF v_result.claim_status IS DISTINCT FROM 'completed'
     OR v_result.attempt_token IS DISTINCT FROM v_storage_claim.attempt_token
     OR v_result.checkpoint_state IS DISTINCT FROM 'authoritative_absent' THEN
    RAISE EXCEPTION 'completed storage receipt did not replay durably';
  END IF;

  -- One Auth delete authority exists at a time; a second worker gets no token.
  SELECT * INTO v_auth_claim FROM public.claim_account_deletion_external_job(
    '14400000-0000-4000-8000-000000000002',
    '14400000-0000-4000-8000-000000000002',
    v_admin_preview.request_id, v_admin_preview.preview_hash,
    'g014-admin-session-pending-0001', v_admin_preview.source_manifest_hash, 'auth', NULL
  );
  SELECT * INTO v_auth_busy FROM public.claim_account_deletion_external_job(
    '14400000-0000-4000-8000-000000000002',
    '14400000-0000-4000-8000-000000000002',
    v_admin_preview.request_id, v_admin_preview.preview_hash,
    'g014-admin-session-pending-0001', v_admin_preview.source_manifest_hash, 'auth', NULL
  );
  IF v_auth_claim.claim_status IS DISTINCT FROM 'claimed'
     OR v_auth_claim.checkpoint_state IS DISTINCT FROM 'delete_then_verify'
     OR v_auth_busy.claim_status IS DISTINCT FROM 'busy'
     OR v_auth_busy.attempt_token IS NOT NULL
     OR (SELECT count(*)
         FROM privacy_retention.account_deletion_external_job_attempts
         WHERE request_id = v_admin_preview.request_id AND phase = 'auth') <> 1 THEN
    RAISE EXCEPTION 'duplicate Auth delete authority was issued';
  END IF;

  -- A released-to-active update, an expiry extension, and a subject/class move
  -- are all blocked while a mapped subject has a live worker attempt.
  RESET ROLE;
  INSERT INTO privacy_retention.privacy_legal_holds (
    subject_ref_hash, data_class, reason_code, status, released_at, approved_by, approved_evidence_ref
  ) VALUES (
    privacy_retention.g014_account_deletion_subject_hash('14400000-0000-4000-8000-000000000002'),
    'account_deletion', 'g014.test.hold', 'released', clock_timestamp(),
    '14400000-0000-4000-8000-000000000003', 'G014-05-HOLD-UPDATE'
  );
  PERFORM pg_temp.g014_expect_failure(
    'UPDATE privacy_retention.privacy_legal_holds
     SET status = ''active'', released_at = NULL, expires_at = clock_timestamp() + interval ''1 hour''
     WHERE approved_evidence_ref = ''G014-05-HOLD-UPDATE'''
  );
  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

  SELECT * INTO v_preview FROM public.preview_account_deletion(
    '14400000-0000-4000-8000-000000000001',
    '14400000-0000-4000-8000-000000000001',
    v_target_reauth
  );
  PERFORM * FROM public.begin_account_deletion_apply(
    '14400000-0000-4000-8000-000000000001',
    '14400000-0000-4000-8000-000000000001',
    v_preview.request_id, v_preview.preview_hash, '계정 삭제',
    'g014-recovery-owner-0001', v_target_reauth, v_preview.source_manifest_hash
  );
  PERFORM * FROM public.apply_account_deletion_database_cleanup(
    '14400000-0000-4000-8000-000000000001',
    '14400000-0000-4000-8000-000000000001',
    v_preview.request_id, v_preview.preview_hash,
    'g014-recovery-owner-0001', v_preview.source_manifest_hash
  );

  SELECT * INTO v_session_claim FROM public.claim_account_deletion_external_job(
    '14400000-0000-4000-8000-000000000001',
    '14400000-0000-4000-8000-000000000001',
    v_preview.request_id, v_preview.preview_hash,
    'g014-recovery-owner-0001', v_preview.source_manifest_hash, 'session', NULL
  );
  SELECT * INTO v_result FROM public.run_account_deletion_session_family_cleanup(
    '14400000-0000-4000-8000-000000000001',
    '14400000-0000-4000-8000-000000000001',
    v_preview.request_id, v_preview.preview_hash,
    'g014-recovery-owner-0001', v_preview.source_manifest_hash,
    v_session_claim.attempt_token
  );
  IF v_result.session_readback_passed IS NOT TRUE THEN
    RAISE EXCEPTION 'target-scoped session-family authoritative readback failed';
  END IF;

  SELECT * INTO v_storage_claim FROM public.claim_account_deletion_external_job(
    '14400000-0000-4000-8000-000000000001',
    '14400000-0000-4000-8000-000000000001',
    v_preview.request_id, v_preview.preview_hash,
    'g014-recovery-owner-0001', v_preview.source_manifest_hash, 'storage', NULL
  );
SELECT * INTO v_storage_work FROM public.get_account_deletion_storage_work(
  '14400000-0000-4000-8000-000000000001',
  '14400000-0000-4000-8000-000000000001',
  v_preview.request_id, v_preview.preview_hash,
  'g014-recovery-owner-0001', v_preview.source_manifest_hash,
  v_storage_claim.attempt_token
);
IF v_storage_work.object_locator_hash IS NULL
   OR v_storage_work.work_mode IS DISTINCT FROM 'delete_then_verify' THEN
  RAISE EXCEPTION 'fresh storage lease did not bind delete-and-verify provider work';
END IF;

PERFORM * FROM public.prepare_account_deletion_external_egress(
  '14400000-0000-4000-8000-000000000001',
  '14400000-0000-4000-8000-000000000001',
  v_preview.request_id, v_preview.preview_hash,
  'g014-recovery-owner-0001', v_preview.source_manifest_hash, 'storage',
  v_storage_claim.attempt_token
);
SELECT * INTO v_result FROM public.claim_account_deletion_external_job(
  '14400000-0000-4000-8000-000000000001',
  '14400000-0000-4000-8000-000000000001',
  v_preview.request_id, v_preview.preview_hash,
  'g014-recovery-owner-0001', v_preview.source_manifest_hash, 'storage', NULL
);
IF v_result.claim_status IS DISTINCT FROM 'replayed'
   OR v_result.attempt_token IS DISTINCT FROM v_storage_claim.attempt_token
   OR v_result.lease_expires_at IS NOT NULL
   OR v_result.job_state IS DISTINCT FROM 'egress_unknown'
   OR v_result.checkpoint_state IS DISTINCT FROM 'verify_absence_only' THEN
  RAISE EXCEPTION 'tokenless egress-unknown storage recovery exposed delete authority';
END IF;

SELECT * INTO v_recovery_storage_work FROM public.get_account_deletion_storage_work(
  '14400000-0000-4000-8000-000000000001',
  '14400000-0000-4000-8000-000000000001',
  v_preview.request_id, v_preview.preview_hash,
  'g014-recovery-owner-0001', v_preview.source_manifest_hash,
  v_result.attempt_token
);
IF v_recovery_storage_work.work_mode IS DISTINCT FROM 'verify_absence_only'
   OR v_recovery_storage_work.work_state IS DISTINCT FROM 'verify_absence_only'
   OR v_recovery_storage_work.object_locator_hash
      IS DISTINCT FROM v_storage_work.object_locator_hash
   OR v_recovery_storage_work.object_version_hash
      IS DISTINCT FROM v_storage_work.object_version_hash
   OR v_recovery_storage_work.provider_idempotency_key
      IS DISTINCT FROM v_storage_work.provider_idempotency_key THEN
  RAISE EXCEPTION 'egress-unknown storage state emitted delete-shaped work';
END IF;

-- Object one has been deleted, but object two remains.  The first attempt
-- cannot complete the storage phase or authorize object two.
RESET ROLE;
DELETE FROM storage.objects
WHERE bucket_id = v_storage_work.bucket_id
  AND name = v_storage_work.object_name;
SET LOCAL ROLE service_role;
PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

SELECT * INTO v_result FROM public.reconcile_account_deletion_storage_job(
  '14400000-0000-4000-8000-000000000001',
  '14400000-0000-4000-8000-000000000001',
  v_preview.request_id, v_preview.preview_hash,
  'g014-recovery-owner-0001', v_preview.source_manifest_hash,
  v_storage_claim.attempt_token
);
IF v_result.storage_readback_passed IS NOT FALSE
   OR v_result.job_state IS DISTINCT FROM 'reconciliation_required'
   OR v_result.provider_proof_count <> 0 THEN
  RAISE EXCEPTION 'object-one crash escaped verifier-only reconciliation';
END IF;
-- An uncaptured path must be rejected while storage reconciliation holds the
-- owner lifecycle open; it cannot slip past the global absence proof.
PERFORM pg_temp.g014_expect_failure(
  'INSERT INTO storage.objects (id, bucket_id, name, owner_id, version)
   VALUES (
     ''14400000-0000-4000-8000-000000000023'',
     ''g014-test'',
     ''uncaptured-during-storage-reconcile.bin'',
     ''14400000-0000-4000-8000-000000000001'',
     ''g014-version-uncaptured-reconcile''
   )'
);
IF EXISTS (
  SELECT 1
  FROM storage.objects
  WHERE id = '14400000-0000-4000-8000-000000000023'
) THEN
  RAISE EXCEPTION 'uncaptured storage write survived reconciliation fence';
END IF;

PERFORM * FROM public.record_account_deletion_external_provider_proof(
  '14400000-0000-4000-8000-000000000001',
  '14400000-0000-4000-8000-000000000001',
  v_preview.request_id, v_preview.preview_hash,
  'g014-recovery-owner-0001', v_preview.source_manifest_hash, 'storage',
  v_storage_claim.attempt_token, 'g014-storage-recovery-proof-0001',
  v_storage_receipt_hash, v_recovery_storage_work.object_locator_hash,
  v_recovery_storage_work.object_version_hash
);
SELECT * INTO v_result FROM public.reconcile_account_deletion_storage_job(
  '14400000-0000-4000-8000-000000000001',
  '14400000-0000-4000-8000-000000000001',
  v_preview.request_id, v_preview.preview_hash,
  'g014-recovery-owner-0001', v_preview.source_manifest_hash,
  v_storage_claim.attempt_token
);
IF v_result.storage_readback_passed IS NOT FALSE
   OR v_result.job_state IS DISTINCT FROM 'pending'
   OR v_result.provider_proof_count <> 1
   OR NOT EXISTS (
     SELECT 1 FROM storage.objects
     WHERE owner_id = '14400000-0000-4000-8000-000000000001'
   ) THEN
  RAISE EXCEPTION 'object-one proof completed the phase before object two';
END IF;

SELECT * INTO v_storage_second_claim FROM public.claim_account_deletion_external_job(
  '14400000-0000-4000-8000-000000000001',
  '14400000-0000-4000-8000-000000000001',
  v_preview.request_id, v_preview.preview_hash,
  'g014-recovery-owner-0001', v_preview.source_manifest_hash, 'storage', NULL
);
SELECT * INTO v_storage_second_work FROM public.get_account_deletion_storage_work(
  '14400000-0000-4000-8000-000000000001',
  '14400000-0000-4000-8000-000000000001',
  v_preview.request_id, v_preview.preview_hash,
  'g014-recovery-owner-0001', v_preview.source_manifest_hash,
  v_storage_second_claim.attempt_token
);
IF v_storage_second_claim.claim_status IS DISTINCT FROM 'claimed'
   OR v_storage_second_claim.attempt_token = v_storage_claim.attempt_token
   OR v_storage_second_work.work_mode IS DISTINCT FROM 'delete_then_verify'
   OR v_storage_second_work.object_locator_hash IS NOT DISTINCT FROM v_storage_work.object_locator_hash
   OR v_storage_second_work.object_version_hash IS NOT DISTINCT FROM v_storage_work.object_version_hash THEN
  RAISE EXCEPTION 'object-two fresh delete authority was not distinct and manifest-bound';
END IF;

PERFORM * FROM public.prepare_account_deletion_external_egress(
  '14400000-0000-4000-8000-000000000001',
  '14400000-0000-4000-8000-000000000001',
  v_preview.request_id, v_preview.preview_hash,
  'g014-recovery-owner-0001', v_preview.source_manifest_hash, 'storage',
  v_storage_second_claim.attempt_token
);
SELECT * INTO v_result FROM public.claim_account_deletion_external_job(
  '14400000-0000-4000-8000-000000000001',
  '14400000-0000-4000-8000-000000000001',
  v_preview.request_id, v_preview.preview_hash,
  'g014-recovery-owner-0001', v_preview.source_manifest_hash, 'storage', NULL
);
IF v_result.claim_status IS DISTINCT FROM 'replayed'
   OR v_result.attempt_token IS DISTINCT FROM v_storage_second_claim.attempt_token
   OR v_result.lease_expires_at IS NOT NULL
   OR v_result.checkpoint_state IS DISTINCT FROM 'verify_absence_only' THEN
  RAISE EXCEPTION 'object-two tokenless recovery renewed delete authority';
END IF;

RESET ROLE;
DELETE FROM storage.objects
WHERE bucket_id = v_storage_second_work.bucket_id
  AND name = v_storage_second_work.object_name;
SET LOCAL ROLE service_role;
PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

PERFORM * FROM public.record_account_deletion_external_provider_proof(
  '14400000-0000-4000-8000-000000000001',
  '14400000-0000-4000-8000-000000000001',
  v_preview.request_id, v_preview.preview_hash,
  'g014-recovery-owner-0001', v_preview.source_manifest_hash, 'storage',
  v_result.attempt_token, 'g014-storage-recovery-proof-0002',
  v_storage_second_receipt_hash, v_storage_second_work.object_locator_hash,
  v_storage_second_work.object_version_hash
);
SELECT * INTO v_result FROM public.reconcile_account_deletion_storage_job(
  '14400000-0000-4000-8000-000000000001',
  '14400000-0000-4000-8000-000000000001',
  v_preview.request_id, v_preview.preview_hash,
  'g014-recovery-owner-0001', v_preview.source_manifest_hash,
  v_storage_second_claim.attempt_token
);
IF v_result.storage_readback_passed IS NOT TRUE
   OR v_result.job_state IS DISTINCT FROM 'completed'
   OR v_result.provider_proof_count <> 2
   OR EXISTS (
     SELECT 1 FROM storage.objects
     WHERE owner_id = '14400000-0000-4000-8000-000000000001'
   ) THEN
  RAISE EXCEPTION 'storage phase completed without both object proofs and absence';
END IF;
-- Storage completion does not release the owner fence: Auth completion must
-- still prove global storage absence before the request can become applied.
PERFORM pg_temp.g014_expect_failure(
  'INSERT INTO storage.objects (id, bucket_id, name, owner_id, version)
   VALUES (
     ''14400000-0000-4000-8000-000000000024'',
     ''g014-test'',
     ''uncaptured-between-storage-and-auth.bin'',
     ''14400000-0000-4000-8000-000000000001'',
     ''g014-version-between-storage-and-auth''
   )'
);
IF EXISTS (
  SELECT 1
  FROM storage.objects
  WHERE id = '14400000-0000-4000-8000-000000000024'
) THEN
  RAISE EXCEPTION 'storage-complete/Auth-pending write survived owner fence';
END IF;

  SELECT * INTO v_auth_claim FROM public.claim_account_deletion_external_job(
    '14400000-0000-4000-8000-000000000001',
    '14400000-0000-4000-8000-000000000001',
    v_preview.request_id, v_preview.preview_hash,
    'g014-recovery-owner-0001', v_preview.source_manifest_hash, 'auth', NULL
  );
  PERFORM * FROM public.prepare_account_deletion_external_egress(
    '14400000-0000-4000-8000-000000000001',
    '14400000-0000-4000-8000-000000000001',
    v_preview.request_id, v_preview.preview_hash,
    'g014-recovery-owner-0001', v_preview.source_manifest_hash, 'auth',
    v_auth_claim.attempt_token
  );
  SELECT * INTO v_result FROM public.claim_account_deletion_external_job(
    '14400000-0000-4000-8000-000000000001',
    '14400000-0000-4000-8000-000000000001',
    v_preview.request_id, v_preview.preview_hash,
    'g014-recovery-owner-0001', v_preview.source_manifest_hash, 'auth', NULL
  );
  IF v_result.claim_status IS DISTINCT FROM 'replayed'
     OR v_result.attempt_token IS DISTINCT FROM v_auth_claim.attempt_token
     OR v_result.lease_expires_at IS NOT NULL
     OR v_result.job_state IS DISTINCT FROM 'egress_unknown'
     OR v_result.checkpoint_state IS DISTINCT FROM 'verify_absence_only' THEN
    RAISE EXCEPTION 'live egress-unknown Auth replay renewed delete authority';
  END IF;

  -- Simulate a lost Auth delete response.  No caller-supplied absence flag can
  -- complete this phase: the RPC reads every authoritative Auth family table.
  RESET ROLE;
  DELETE FROM auth.users WHERE id = '14400000-0000-4000-8000-000000000001';
  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT * INTO v_result FROM public.reconcile_account_deletion_auth_job(
    '14400000-0000-4000-8000-000000000001',
    '14400000-0000-4000-8000-000000000001',
    v_preview.request_id, v_preview.preview_hash,
    'g014-recovery-owner-0001', v_preview.source_manifest_hash,
    v_auth_claim.attempt_token
  );
  IF v_result.auth_readback_passed IS NOT TRUE
     OR v_result.status IS DISTINCT FROM 'applied'
     OR EXISTS (SELECT 1 FROM auth.users WHERE id = '14400000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'Auth response-loss reconciliation did not require authoritative absence';
  END IF;
  RESET ROLE;
  INSERT INTO storage.objects (id, bucket_id, name, owner_id, version)
  VALUES (
    '14400000-0000-4000-8000-000000000027',
    'g014-test',
    'post-applied-write-is-not-fenced.bin',
    '14400000-0000-4000-8000-000000000001',
    'g014-post-applied-version-0001'
  );
  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
  IF NOT EXISTS (
    SELECT 1
    FROM storage.objects
    WHERE id = '14400000-0000-4000-8000-000000000027'
  ) THEN
    RAISE EXCEPTION 'post-applied storage write was incorrectly fenced';
  END IF;
  SELECT * INTO v_result FROM public.claim_account_deletion_external_job(
    '14400000-0000-4000-8000-000000000001',
    '14400000-0000-4000-8000-000000000001',
    v_preview.request_id, v_preview.preview_hash,
    'g014-recovery-owner-0001', v_preview.source_manifest_hash, 'auth', NULL
  );
  IF v_result.claim_status IS DISTINCT FROM 'completed'
     OR v_result.attempt_token IS DISTINCT FROM v_auth_claim.attempt_token
     OR v_result.job_state IS DISTINCT FROM 'completed'
     OR v_result.checkpoint_state IS DISTINCT FROM 'authoritative_absent' THEN
    RAISE EXCEPTION 'completed Auth receipt did not replay durably';
  END IF;
END;
$durable_external_job_recovery_matrix$;
DO $pre_egress_expiry_recovery$
DECLARE
  v_user_id uuid := '14400000-0000-4000-8000-000000000021';
  v_reauth timestamptz;
  v_confirmation_text text;
  v_preview record;
  v_session_old record;
  v_session_fresh record;
  v_storage_old record;
  v_storage_fresh record;
  v_auth_old record;
  v_auth_fresh record;
  v_old_state text;
  v_current_token uuid;
  v_storage_reconciliation_work record;
  v_storage_reconcile record;
  v_storage_receipt_hash text := repeat('e', 64);
  v_dispatch record;
BEGIN
  RESET ROLE;
  INSERT INTO auth.users (
    id, aud, role, email, encrypted_password, email_confirmed_at, last_sign_in_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) VALUES (
    v_user_id, 'authenticated', 'authenticated', 'g014-pre-egress-expiry@example.invalid',
    'disabled', clock_timestamp(), clock_timestamp(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    clock_timestamp(), clock_timestamp()
  );
  INSERT INTO storage.objects (id, bucket_id, name, owner_id, version)
  VALUES (
    '14400000-0000-4000-8000-000000000026',
    'g014-test',
    'pre-egress-disappeared.bin',
    v_user_id,
    'g014-pre-egress-version-0001'
  );
  SELECT user_row.last_sign_in_at, policy.confirmation_text
  INTO v_reauth, v_confirmation_text
  FROM auth.users AS user_row
  CROSS JOIN (
    SELECT confirmation_text
    FROM public.account_deletion_policies
    WHERE status = 'active'
    ORDER BY version
    LIMIT 1
  ) AS policy
  WHERE user_row.id = v_user_id;

  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT * INTO v_preview FROM public.preview_account_deletion(
    v_user_id, v_user_id, v_reauth
  );
  PERFORM * FROM public.begin_account_deletion_apply(
    v_user_id, v_user_id, v_preview.request_id, v_preview.preview_hash,
    v_confirmation_text, 'g014-pre-egress-expiry-0001', v_reauth,
    v_preview.source_manifest_hash
  );
  PERFORM * FROM public.apply_account_deletion_database_cleanup(
    v_user_id, v_user_id, v_preview.request_id, v_preview.preview_hash,
    'g014-pre-egress-expiry-0001', v_preview.source_manifest_hash
  );

  -- Model reader/verifier/deadline failure by intentionally never preparing egress.
  SELECT * INTO v_session_old FROM public.claim_account_deletion_external_job(
    v_user_id, v_user_id, v_preview.request_id, v_preview.preview_hash,
    'g014-pre-egress-expiry-0001', v_preview.source_manifest_hash, 'session', NULL
  );
  PERFORM * FROM public.read_account_deletion_external_job(
    v_user_id, v_user_id, v_preview.request_id, v_preview.preview_hash,
    'g014-pre-egress-expiry-0001', v_preview.source_manifest_hash, 'session',
    v_session_old.attempt_token
  );
  RESET ROLE;
  ALTER TABLE privacy_retention.account_deletion_external_job_attempts
    DISABLE TRIGGER g014_account_deletion_external_attempt_binding_guard;
  UPDATE privacy_retention.account_deletion_external_job_attempts
  SET claimed_at = clock_timestamp() - interval '10 minutes',
      lease_expires_at = clock_timestamp() - interval '5 minutes'
  WHERE attempt_token = v_session_old.attempt_token;
  ALTER TABLE privacy_retention.account_deletion_external_job_attempts
    ENABLE TRIGGER g014_account_deletion_external_attempt_binding_guard;
  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT * INTO v_session_fresh FROM public.claim_account_deletion_external_job(
    v_user_id, v_user_id, v_preview.request_id, v_preview.preview_hash,
    'g014-pre-egress-expiry-0001', v_preview.source_manifest_hash, 'session', NULL
  );
  RESET ROLE;
  SELECT attempt.state, job.current_attempt_token
  INTO v_old_state, v_current_token
  FROM privacy_retention.account_deletion_external_job_attempts AS attempt
  JOIN privacy_retention.account_deletion_external_jobs AS job
    ON job.request_id = attempt.request_id AND job.phase = attempt.phase
  WHERE attempt.attempt_token = v_session_old.attempt_token;
  IF v_session_fresh.claim_status IS DISTINCT FROM 'claimed'
     OR v_session_fresh.attempt_token = v_session_old.attempt_token
     OR v_old_state IS DISTINCT FROM 'released'
     OR v_current_token IS DISTINCT FROM v_session_fresh.attempt_token THEN
    RAISE EXCEPTION 'expired pre-egress session lease did not restore one fresh claim';
  END IF;
  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
  PERFORM * FROM public.run_account_deletion_session_family_cleanup(
    v_user_id, v_user_id, v_preview.request_id, v_preview.preview_hash,
    'g014-pre-egress-expiry-0001', v_preview.source_manifest_hash,
    v_session_fresh.attempt_token
  );

  SELECT * INTO v_storage_old FROM public.claim_account_deletion_external_job(
    v_user_id, v_user_id, v_preview.request_id, v_preview.preview_hash,
    'g014-pre-egress-expiry-0001', v_preview.source_manifest_hash, 'storage', NULL
  );
  PERFORM * FROM public.read_account_deletion_external_job(
    v_user_id, v_user_id, v_preview.request_id, v_preview.preview_hash,
    'g014-pre-egress-expiry-0001', v_preview.source_manifest_hash, 'storage',
    v_storage_old.attempt_token
  );
  RESET ROLE;
  ALTER TABLE privacy_retention.account_deletion_external_job_attempts
    DISABLE TRIGGER g014_account_deletion_external_attempt_binding_guard;
  UPDATE privacy_retention.account_deletion_external_job_attempts
  SET claimed_at = clock_timestamp() - interval '10 minutes',
      lease_expires_at = clock_timestamp() - interval '5 minutes'
  WHERE attempt_token = v_storage_old.attempt_token;
  DELETE FROM storage.objects
  WHERE id = '14400000-0000-4000-8000-000000000026';
  ALTER TABLE privacy_retention.account_deletion_external_job_attempts
    ENABLE TRIGGER g014_account_deletion_external_attempt_binding_guard;
  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT * INTO v_dispatch FROM public.claim_next_account_deletion_external_job();
  IF v_dispatch.request_id IS DISTINCT FROM v_preview.request_id
     OR v_dispatch.phase IS DISTINCT FROM 'storage'
     OR v_dispatch.attempt_token IS NULL THEN
    RAISE EXCEPTION 'queue dispatch did not isolate disappeared-object verifier recovery';
  END IF;
  SELECT * INTO v_storage_fresh FROM public.claim_account_deletion_external_job(
    v_dispatch.actor_user_id, v_dispatch.target_user_id, v_dispatch.request_id,
    v_dispatch.preview_hash, v_dispatch.idempotency_key, v_dispatch.source_manifest_hash,
    v_dispatch.phase, v_dispatch.attempt_token
  );
  RESET ROLE;
  SELECT attempt.state, job.current_attempt_token
  INTO v_old_state, v_current_token
  FROM privacy_retention.account_deletion_external_job_attempts AS attempt
  JOIN privacy_retention.account_deletion_external_jobs AS job
    ON job.request_id = attempt.request_id AND job.phase = attempt.phase
  WHERE attempt.attempt_token = v_storage_old.attempt_token;
  IF v_storage_fresh.claim_status IS DISTINCT FROM 'replayed'
     OR v_storage_fresh.attempt_token = v_storage_old.attempt_token
     OR v_storage_fresh.checkpoint_state IS DISTINCT FROM 'verify_absence_only'
     OR v_old_state IS DISTINCT FROM 'released'
     OR v_current_token IS DISTINCT FROM v_storage_fresh.attempt_token THEN
    RAISE EXCEPTION 'disappeared pre-egress storage object did not become verifier-only recovery';
  END IF;

  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT * INTO v_storage_reconciliation_work FROM public.get_account_deletion_storage_work(
    v_user_id, v_user_id, v_preview.request_id, v_preview.preview_hash,
    'g014-pre-egress-expiry-0001', v_preview.source_manifest_hash,
    v_storage_fresh.attempt_token
  );
  IF v_storage_reconciliation_work.work_mode IS DISTINCT FROM 'verify_absence_only'
     OR v_storage_reconciliation_work.bucket_id IS NOT NULL
     OR v_storage_reconciliation_work.object_name IS NOT NULL THEN
    RAISE EXCEPTION 'verifier-only storage recovery exposed a raw locator';
  END IF;
  PERFORM * FROM public.record_account_deletion_external_provider_proof(
    v_user_id, v_user_id, v_preview.request_id, v_preview.preview_hash,
    'g014-pre-egress-expiry-0001', v_preview.source_manifest_hash, 'storage',
    v_storage_fresh.attempt_token, 'g014-pre-egress-absence-proof-0001',
    v_storage_receipt_hash, v_storage_reconciliation_work.object_locator_hash,
    v_storage_reconciliation_work.object_version_hash
  );
  SELECT * INTO v_storage_reconcile FROM public.reconcile_account_deletion_storage_job(
    v_user_id, v_user_id, v_preview.request_id, v_preview.preview_hash,
    'g014-pre-egress-expiry-0001', v_preview.source_manifest_hash,
    v_storage_fresh.attempt_token
  );
  IF v_storage_reconcile.storage_readback_passed IS NOT TRUE
     OR v_storage_reconcile.job_state IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'verifier-only disappeared-object recovery did not complete storage readback';
  END IF;

  SELECT * INTO v_auth_old FROM public.claim_account_deletion_external_job(
    v_user_id, v_user_id, v_preview.request_id, v_preview.preview_hash,
    'g014-pre-egress-expiry-0001', v_preview.source_manifest_hash, 'auth', NULL
  );
  PERFORM * FROM public.read_account_deletion_external_job(
    v_user_id, v_user_id, v_preview.request_id, v_preview.preview_hash,
    'g014-pre-egress-expiry-0001', v_preview.source_manifest_hash, 'auth',
    v_auth_old.attempt_token
  );
  RESET ROLE;
  ALTER TABLE privacy_retention.account_deletion_external_job_attempts
    DISABLE TRIGGER g014_account_deletion_external_attempt_binding_guard;
  UPDATE privacy_retention.account_deletion_external_job_attempts
  SET claimed_at = clock_timestamp() - interval '10 minutes',
      lease_expires_at = clock_timestamp() - interval '5 minutes'
  WHERE attempt_token = v_auth_old.attempt_token;
  ALTER TABLE privacy_retention.account_deletion_external_job_attempts
    ENABLE TRIGGER g014_account_deletion_external_attempt_binding_guard;
  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT * INTO v_auth_fresh FROM public.claim_account_deletion_external_job(
    v_user_id, v_user_id, v_preview.request_id, v_preview.preview_hash,
    'g014-pre-egress-expiry-0001', v_preview.source_manifest_hash, 'auth', NULL
  );
  RESET ROLE;
  SELECT attempt.state, job.current_attempt_token
  INTO v_old_state, v_current_token
  FROM privacy_retention.account_deletion_external_job_attempts AS attempt
  JOIN privacy_retention.account_deletion_external_jobs AS job
    ON job.request_id = attempt.request_id AND job.phase = attempt.phase
  WHERE attempt.attempt_token = v_auth_old.attempt_token;
  IF v_auth_fresh.claim_status IS DISTINCT FROM 'claimed'
     OR v_auth_fresh.attempt_token = v_auth_old.attempt_token
     OR v_old_state IS DISTINCT FROM 'released'
     OR v_current_token IS DISTINCT FROM v_auth_fresh.attempt_token THEN
    RAISE EXCEPTION 'expired pre-egress Auth lease did not restore one fresh claim';
  END IF;
  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
END;
$pre_egress_expiry_recovery$;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $policy_publish_activate_replay$
DECLARE
  v_active_policy public.account_deletion_policies%ROWTYPE;
  v_new_version text := 'g014-publish-fixture-v1';
  v_publish_key text := 'g014-publish-fixture-0001';
  v_activate_key text := 'g014-activate-fixture-0001';
  v_approval_ref text := 'g014-approval-fixture-0001';
  v_manifest jsonb;
  v_result text;
  v_failed boolean;
BEGIN
  SELECT * INTO v_active_policy
  FROM public.account_deletion_policies
  WHERE status = 'active'
  FOR SHARE;
  SELECT pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'code', manifest.code,
      'relation_name', manifest.relation_name,
      'subject_column', manifest.subject_column,
      'adapter_name', manifest.adapter_name,
      'required', manifest.required,
      'ordinal', manifest.ordinal,
      'contract_hash', privacy_retention.g014_account_deletion_manifest_contract_hash(
        v_new_version, manifest.code, manifest.relation_name, manifest.subject_column,
        manifest.adapter_name, manifest.required, manifest.ordinal
      )
    )
    ORDER BY manifest.ordinal
  ) INTO v_manifest
  FROM privacy_retention.account_deletion_source_manifest AS manifest
  WHERE manifest.policy_version = v_active_policy.version;

  SELECT public.publish_account_deletion_policy(
    v_new_version, v_active_policy.preview_ttl, v_active_policy.reauth_max_age,
    v_active_policy.confirmation_text, v_manifest, v_approval_ref, v_publish_key
  ) INTO v_result;
  IF v_result IS DISTINCT FROM v_new_version THEN
    RAISE EXCEPTION 'policy publication did not return the exact version';
  END IF;
  SELECT public.publish_account_deletion_policy(
    v_new_version, v_active_policy.preview_ttl, v_active_policy.reauth_max_age,
    v_active_policy.confirmation_text, v_manifest, v_approval_ref, v_publish_key
  ) INTO v_result;
  IF v_result IS DISTINCT FROM v_new_version THEN
    RAISE EXCEPTION 'policy publication exact replay failed';
  END IF;
  v_failed := false;
  BEGIN
    PERFORM public.publish_account_deletion_policy(
      v_new_version, v_active_policy.preview_ttl, v_active_policy.reauth_max_age,
      v_active_policy.confirmation_text, v_manifest, 'g014-approval-mismatch-0001', v_publish_key
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_failed := SQLERRM = 'account_deletion_policy_publication_replay_mismatch';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'policy publication mismatch replay was accepted';
  END IF;

  SELECT public.activate_account_deletion_policy(v_new_version, v_activate_key) INTO v_result;
  IF v_result IS DISTINCT FROM v_new_version
     OR (SELECT count(*) FROM public.account_deletion_policies WHERE status = 'active') <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM public.account_deletion_policies
       WHERE version = v_new_version
         AND status = 'active'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM privacy_retention.account_deletion_policy_activation_history AS history
       JOIN privacy_retention.account_deletion_policy_publications AS publication
         ON publication.policy_version = history.policy_version
       WHERE history.policy_version = v_new_version
         AND history.activation_idempotency_key = v_activate_key
         AND history.operator_approval_ref = v_approval_ref
         AND publication.source_manifest_hash =
             privacy_retention.g014_account_deletion_validate_manifest(v_new_version)
     ) THEN
    RAISE EXCEPTION 'policy activation exact manifest/single-active contract failed';
  END IF;
  SELECT public.activate_account_deletion_policy(v_new_version, v_activate_key) INTO v_result;
  IF v_result IS DISTINCT FROM v_new_version THEN
    RAISE EXCEPTION 'policy activation exact replay failed';
  END IF;
  v_failed := false;
  BEGIN
    PERFORM public.activate_account_deletion_policy(
      v_new_version, 'g014-activate-mismatch-0001'
    );
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_failed := SQLERRM = 'account_deletion_policy_activation_replay_mismatch';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'policy activation mismatch replay was accepted';
  END IF;
  v_failed := false;
  RESET ROLE;
  BEGIN
    UPDATE public.account_deletion_policies
    SET confirmation_text = '변조'
    WHERE version = v_new_version;
  EXCEPTION WHEN SQLSTATE '55000' THEN
    v_failed := SQLERRM = 'ever_activated_account_deletion_policy_is_immutable';
  END;
  IF NOT v_failed THEN
    RAISE EXCEPTION 'activated policy history was mutable';
  END IF;
END;
$policy_publish_activate_replay$;

DO $expired_preview_replacement$
DECLARE
  v_user_id uuid := '14400000-0000-4000-8000-000000000003';
  v_reauth timestamptz;
  v_policy public.account_deletion_policies%ROWTYPE;
  v_expired_request_id uuid := '14400000-0000-4000-8000-000000000028';
  v_replacement record;
BEGIN
  RESET ROLE;
  UPDATE auth.users
  SET last_sign_in_at = pg_catalog.clock_timestamp()
  WHERE id = v_user_id;
  SELECT user_row.last_sign_in_at INTO v_reauth
  FROM auth.users AS user_row
  WHERE user_row.id = v_user_id;
  SELECT * INTO v_policy
  FROM public.account_deletion_policies
  WHERE status = 'active'
  FOR SHARE;

  INSERT INTO public.account_deletion_requests (
    id, actor_user_id, target_user_id, policy_version, preview_hash,
    preview_expires_at, reauthenticated_at, status, reason_code,
    count_summary, source_manifest_hash
  ) VALUES (
    v_expired_request_id, v_user_id, v_user_id, v_policy.version, repeat('f', 64),
    pg_catalog.clock_timestamp() + interval '0.001 seconds', v_reauth,
    'previewed', 'PREVIEW_READY', '{}'::jsonb,
    privacy_retention.g014_account_deletion_validate_manifest(v_policy.version)
  );
  PERFORM pg_catalog.pg_sleep(0.01);

  SET LOCAL ROLE service_role;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
  SELECT * INTO v_replacement
  FROM public.preview_account_deletion(v_user_id, v_user_id, v_reauth);

  RESET ROLE;
  IF v_replacement.request_id IS NULL
     OR v_replacement.request_id = v_expired_request_id
     OR v_replacement.status IS DISTINCT FROM 'previewed'
     OR (SELECT status FROM public.account_deletion_requests WHERE id = v_expired_request_id)
          IS DISTINCT FROM 'expired'
     OR NOT EXISTS (
       SELECT 1
       FROM privacy_retention.privacy_audit_events AS audit_row
       WHERE audit_row.operation_id = v_expired_request_id
         AND audit_row.event_type = 'expired'
         AND audit_row.reason_code = 'PREVIEW_EXPIRED'
     ) THEN
    RAISE EXCEPTION 'expired preview did not transition terminally before replacement';
  END IF;
  IF NOT privacy_retention.g014_account_deletion_transition_preview_terminal(
    v_user_id, v_replacement.request_id, 'cancelled'
  )
  OR (SELECT status FROM public.account_deletion_requests WHERE id = v_replacement.request_id)
       IS DISTINCT FROM 'cancelled'
  OR NOT EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_audit_events AS audit_row
    WHERE audit_row.operation_id = v_replacement.request_id
      AND audit_row.event_type = 'cancelled'
      AND audit_row.reason_code = 'PREVIEW_CANCELLED'
  ) THEN
    RAISE EXCEPTION 'preview cancellation did not transition terminally with audit';
  END IF;
END;
$expired_preview_replacement$;
ROLLBACK;
