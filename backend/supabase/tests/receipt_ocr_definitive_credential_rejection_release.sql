-- Run only against a disposable PostgreSQL 15/17 database after the held OCR
-- and G014 chain plus the compiled successor's private catalog seal and ledger
-- registration have made the recovery capability ready.
\set ON_ERROR_STOP on

DO $disposable_target_required$
BEGIN
  IF pg_catalog.current_setting(
       'tzudong.receipt_ocr_disposable_fixture',
       true
     ) IS DISTINCT FROM 'authorized-v1' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_DISPOSABLE_TARGET_REQUIRED';
  END IF;
END;
$disposable_target_required$;

BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '91c00000-0000-4000-8000-000000000001',
  'authenticated',
  'authenticated',
  'receipt-credential-release@example.invalid',
  'not-a-real-password',
  pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{}'::jsonb,
  pg_catalog.clock_timestamp(),
  pg_catalog.clock_timestamp()
);

SET LOCAL ROLE service_role;
DO $capability_ready$
DECLARE
  capability jsonb;
BEGIN
  capability := public.get_receipt_ocr_credential_release_capability();
  IF capability <> '{"schema_version":1,"status":"ready","capability_version":"receipt-ocr-definitive-credential-release-v1"}'::jsonb
    OR (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.jsonb_object_keys(capability)
    ) <> 3
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_CAPABILITY_DRIFT';
  END IF;
END;
$capability_ready$;
RESET ROLE;

INSERT INTO ocr_private.receipt_results (
  id, user_id, image_hash, input_context_hash, provider, model_policy,
  generation, prompt_version, preprocess_version, normalization_version,
  status, dispatch_stage, claim_token
) VALUES (
  '91c10000-0000-4000-8000-000000000001',
  '91c00000-0000-4000-8000-000000000001',
  repeat('a', 64),
  repeat('b', 64),
  'gemini',
  '["gemini-3.6-flash"]'::jsonb,
  '91c20000-0000-4000-8000-000000000001',
  'credential-release-fixture-v1',
  'credential-release-fixture-v1',
  'receipt-normalization-v1',
  'processing',
  'possibly_dispatched',
  '91c30000-0000-4000-8000-000000000001'
);

SET LOCAL ROLE service_role;
DO $deleted_release$
DECLARE
  result jsonb;
BEGIN
  result := public.release_receipt_ocr_definitive_credential_rejection(
    '91c10000-0000-4000-8000-000000000001',
    '91c30000-0000-4000-8000-000000000001'
  );
  IF result->>'status' <> 'released'
    OR result->>'disposition' <> 'deleted'
    OR (result->>'idempotent')::boolean
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_DELETE_RESULT_DRIFT';
  END IF;

  result := public.release_receipt_ocr_definitive_credential_rejection(
    '91c10000-0000-4000-8000-000000000001',
    '91c30000-0000-4000-8000-000000000001'
  );
  IF result->>'disposition' <> 'deleted'
    OR NOT (result->>'idempotent')::boolean
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_DELETE_IDEMPOTENCY_DRIFT';
  END IF;

  BEGIN
    PERFORM public.release_receipt_ocr_definitive_credential_rejection(
      '91c10000-0000-4000-8000-000000000001',
      '91c30000-0000-4000-8000-000000000099'
    );
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_WRONG_TOKEN_ACCEPTED';
  EXCEPTION
    WHEN SQLSTATE '42501' THEN NULL;
  END;
END;
$deleted_release$;
RESET ROLE;

DO $deleted_readback$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM ocr_private.receipt_results
    WHERE id = '91c10000-0000-4000-8000-000000000001'
  ) OR (
    SELECT pg_catalog.count(*)
    FROM ocr_private.receipt_credential_rejection_releases
    WHERE result_id = '91c10000-0000-4000-8000-000000000001'
      AND claim_token = '91c30000-0000-4000-8000-000000000001'
      AND disposition = 'deleted'
      AND result_revision IS NULL
  ) <> 1 THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_DELETE_READBACK_DRIFT';
  END IF;
END;
$deleted_readback$;

INSERT INTO ocr_private.receipt_results (
  id, user_id, image_hash, input_context_hash, provider, model_policy,
  generation, prompt_version, preprocess_version, normalization_version,
  status, dispatch_stage, claim_token, result_payload, result_revision
) VALUES (
  '91c10000-0000-4000-8000-000000000002',
  '91c00000-0000-4000-8000-000000000001',
  repeat('c', 64),
  repeat('d', 64),
  'gemini',
  '["gemini-3.6-flash"]'::jsonb,
  '91c20000-0000-4000-8000-000000000002',
  'credential-release-fixture-v1',
  'credential-release-fixture-v1',
  'receipt-normalization-v1',
  'processing',
  'possibly_dispatched',
  '91c30000-0000-4000-8000-000000000002',
  '{"schema_version":"receipt-public-ocr-v1","provider":"gemini","model":"gemini-3.6-flash","normalized":{},"field_trust":[],"confidence":1,"needs_review":[],"normalization_version":"receipt-normalization-v1"}'::jsonb,
  '91c40000-0000-4000-8000-000000000002'
);

SET LOCAL ROLE service_role;
DO $restored_release$
DECLARE
  result jsonb;
BEGIN
  result := public.release_receipt_ocr_definitive_credential_rejection(
    '91c10000-0000-4000-8000-000000000002',
    '91c30000-0000-4000-8000-000000000002'
  );
  IF result->>'status' <> 'released'
    OR result->>'disposition' <> 'restored'
    OR result->>'result_revision' <> '91c40000-0000-4000-8000-000000000002'
    OR (result->>'idempotent')::boolean
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_RESTORE_RESULT_DRIFT';
  END IF;

  result := public.release_receipt_ocr_definitive_credential_rejection(
    '91c10000-0000-4000-8000-000000000002',
    '91c30000-0000-4000-8000-000000000002'
  );
  IF result->>'disposition' <> 'restored'
    OR NOT (result->>'idempotent')::boolean
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_RESTORE_IDEMPOTENCY_DRIFT';
  END IF;
END;
$restored_release$;
RESET ROLE;

DO $restore_readback$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM ocr_private.receipt_results
    WHERE id = '91c10000-0000-4000-8000-000000000002'
      AND status = 'succeeded'
      AND dispatch_stage = 'completed'
      AND claim_token IS NULL
      AND result_revision = '91c40000-0000-4000-8000-000000000002'
      AND result_payload->>'model' = 'gemini-3.6-flash'
  ) THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_RESTORE_READBACK_DRIFT';
  END IF;

END;
$restore_readback$;

SET LOCAL ROLE service_role;
DO $actual_force_refresh_claim_dispatch$
DECLARE
  claim jsonb;
  dispatched jsonb;
BEGIN
  claim := public.claim_receipt_ocr_result(
    '91c00000-0000-4000-8000-000000000001',
    repeat('c', 64),
    repeat('d', 64),
    'gemini',
    '["gemini-3.6-flash"]'::jsonb,
    '91c20000-0000-4000-8000-000000000002',
    'credential-release-fixture-v1',
    'credential-release-fixture-v1',
    'receipt-normalization-v1',
    '91c30000-0000-4000-8000-000000000003',
    true
  );
  IF claim->>'status' <> 'claimed'
    OR claim->>'result_ref' <> '91c10000-0000-4000-8000-000000000002'
    OR claim->>'claim_token' <> '91c30000-0000-4000-8000-000000000003'
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_FORCE_REFRESH_CLAIM_DRIFT';
  END IF;

  dispatched := public.mark_receipt_ocr_dispatched(
    '91c10000-0000-4000-8000-000000000002',
    '91c30000-0000-4000-8000-000000000003'
  );
  IF dispatched->>'status' <> 'dispatched'
    OR dispatched->>'result_ref' <> '91c10000-0000-4000-8000-000000000002'
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_FORCE_REFRESH_DISPATCH_DRIFT';
  END IF;
END;
$actual_force_refresh_claim_dispatch$;
RESET ROLE;

-- A delayed acknowledgement replay for the first release must resolve only its
-- own idempotency receipt and must never touch the active second claim.
SET LOCAL ROLE service_role;
DO $stale_ack_and_second_release$
DECLARE
  result jsonb;
BEGIN
  result := public.release_receipt_ocr_definitive_credential_rejection(
    '91c10000-0000-4000-8000-000000000002',
    '91c30000-0000-4000-8000-000000000002'
  );
  IF NOT (result->>'idempotent')::boolean THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_STALE_ACK_NOT_IDEMPOTENT';
  END IF;

  result := public.release_receipt_ocr_definitive_credential_rejection(
    '91c10000-0000-4000-8000-000000000002',
    '91c30000-0000-4000-8000-000000000003'
  );
  IF result->>'disposition' <> 'restored'
    OR (result->>'idempotent')::boolean
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_SECOND_REFRESH_DRIFT';
  END IF;
END;
$stale_ack_and_second_release$;
RESET ROLE;

DO $repeat_refresh_readback$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM ocr_private.receipt_credential_rejection_releases
    WHERE result_id = '91c10000-0000-4000-8000-000000000002'
      AND disposition = 'restored'
  ) <> 2 OR NOT EXISTS (
    SELECT 1
    FROM ocr_private.receipt_results
    WHERE id = '91c10000-0000-4000-8000-000000000002'
      AND status = 'succeeded'
      AND dispatch_stage = 'completed'
      AND result_revision = '91c40000-0000-4000-8000-000000000002'
  ) THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_REPEAT_REFRESH_READBACK_DRIFT';
  END IF;
END;
$repeat_refresh_readback$;

INSERT INTO ocr_private.receipt_results (
  id, user_id, image_hash, input_context_hash, provider, model_policy,
  generation, prompt_version, preprocess_version, normalization_version,
  status, dispatch_stage, claim_token, completed_at
) VALUES
  (
    '91c10000-0000-4000-8000-000000000003',
    '91c00000-0000-4000-8000-000000000001',
    repeat('e', 64), repeat('f', 64), 'gemini', '["gemini-3.6-flash"]'::jsonb,
    '91c20000-0000-4000-8000-000000000003',
    'credential-release-fixture-v1', 'credential-release-fixture-v1', 'receipt-normalization-v1',
    'indeterminate', 'uncertain', NULL, pg_catalog.clock_timestamp()
  ),
  (
    '91c10000-0000-4000-8000-000000000004',
    '91c00000-0000-4000-8000-000000000001',
    repeat('1', 64), repeat('2', 64), 'gemini', '["gemini-3.6-flash"]'::jsonb,
    '91c20000-0000-4000-8000-000000000004',
    'credential-release-fixture-v1', 'credential-release-fixture-v1', 'receipt-normalization-v1',
    'processing', 'possibly_dispatched', '91c30000-0000-4000-8000-000000000004', NULL
  );

INSERT INTO ocr_private.receipt_results (
  id, user_id, image_hash, input_context_hash, provider, model_policy,
  generation, prompt_version, preprocess_version, normalization_version,
  status, dispatch_stage, claim_token, result_payload, result_revision
) VALUES
  (
    '91c10000-0000-4000-8000-000000000006',
    '91c00000-0000-4000-8000-000000000001',
    repeat('5', 64), repeat('6', 64), 'gemini', '["gemini-other"]'::jsonb,
    '91c20000-0000-4000-8000-000000000006',
    'credential-release-fixture-v1', 'credential-release-fixture-v1', 'receipt-normalization-v1',
    'processing', 'possibly_dispatched', '91c30000-0000-4000-8000-000000000006',
    '{"schema_version":"receipt-public-ocr-v1","provider":"gemini","model":"gemini-3.6-flash","normalized":{},"field_trust":[],"confidence":1,"needs_review":[],"normalization_version":"receipt-normalization-v1"}'::jsonb,
    '91c40000-0000-4000-8000-000000000006'
  ),
  (
    '91c10000-0000-4000-8000-000000000007',
    '91c00000-0000-4000-8000-000000000001',
    repeat('7', 64), repeat('8', 64), 'gemini', '["gemini-3.6-flash"]'::jsonb,
    '91c20000-0000-4000-8000-000000000007',
    'credential-release-fixture-v1', 'credential-release-fixture-v1', 'receipt-normalization-v1',
    'processing', 'possibly_dispatched', '91c30000-0000-4000-8000-000000000007',
    '{"schema_version":"receipt-public-ocr-v1","provider":"gemini","model":"gemini-3.6-flash","normalized":{},"field_trust":[],"confidence":1,"needs_review":[],"normalization_version":"receipt-normalization-v1","unexpected":true}'::jsonb,
    '91c40000-0000-4000-8000-000000000007'
  );

SET LOCAL ROLE service_role;
DO $negative_states$
BEGIN
  BEGIN
    PERFORM public.release_receipt_ocr_definitive_credential_rejection(
      '91c10000-0000-4000-8000-000000000003',
      '91c30000-0000-4000-8000-000000000003'
    );
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_UNCERTAIN_ACCEPTED';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;

  BEGIN
    PERFORM public.release_receipt_ocr_definitive_credential_rejection(
      '91c10000-0000-4000-8000-000000000004',
      '91c30000-0000-4000-8000-000000000099'
    );
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_ACTIVE_WRONG_TOKEN_ACCEPTED';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;

  BEGIN
    PERFORM public.release_receipt_ocr_definitive_credential_rejection(
      '91c10000-0000-4000-8000-000000000006',
      '91c30000-0000-4000-8000-000000000006'
    );
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_MODEL_BINDING_ACCEPTED';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;

  BEGIN
    PERFORM public.release_receipt_ocr_definitive_credential_rejection(
      '91c10000-0000-4000-8000-000000000007',
      '91c30000-0000-4000-8000-000000000007'
    );
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_INVALID_PAYLOAD_ACCEPTED';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;
END;
$negative_states$;
RESET ROLE;

DO $negative_state_readback$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ocr_private.receipt_results
    WHERE id = '91c10000-0000-4000-8000-000000000003'
      AND status = 'indeterminate' AND dispatch_stage = 'uncertain'
  ) OR NOT EXISTS (
    SELECT 1 FROM ocr_private.receipt_results
    WHERE id = '91c10000-0000-4000-8000-000000000004'
      AND status = 'processing' AND dispatch_stage = 'possibly_dispatched'
      AND claim_token = '91c30000-0000-4000-8000-000000000004'
  ) THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_NEGATIVE_STATE_MUTATED';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
    FROM ocr_private.receipt_results
    WHERE id IN (
      '91c10000-0000-4000-8000-000000000006',
      '91c10000-0000-4000-8000-000000000007'
    )
      AND status = 'processing'
      AND dispatch_stage = 'possibly_dispatched'
      AND claim_token IS NOT NULL
  ) <> 2 OR EXISTS (
    SELECT 1
    FROM ocr_private.receipt_credential_rejection_releases
    WHERE result_id IN (
      '91c10000-0000-4000-8000-000000000006',
      '91c10000-0000-4000-8000-000000000007'
    )
  ) THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_PRESERVED_PAYLOAD_VALIDATION_MUTATED';
  END IF;

  IF pg_catalog.has_function_privilege(
       'anon',
       'public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)',
       'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'authenticated',
       'public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)',
       'EXECUTE'
     ) OR NOT pg_catalog.has_function_privilege(
       'service_role',
       'public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)',
       'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'anon',
       'public.get_receipt_ocr_credential_release_capability()',
       'EXECUTE'
     ) OR pg_catalog.has_function_privilege(
       'authenticated',
       'public.get_receipt_ocr_credential_release_capability()',
       'EXECUTE'
     ) OR NOT pg_catalog.has_function_privilege(
       'service_role',
       'public.get_receipt_ocr_credential_release_capability()',
       'EXECUTE'
     ) OR pg_catalog.has_table_privilege(
       'service_role',
       'ocr_private.receipt_credential_rejection_releases',
       'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_PRIVILEGE_DRIFT';
  END IF;
END;
$negative_state_readback$;

ROLLBACK;

-- The inter-session race uses committed synthetic rows in a disposable DB.
-- The losing definitive release must not overwrite an uncertainty decision.
CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;

BEGIN;
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '91c00000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'receipt-credential-race@example.invalid',
  'not-a-real-password', pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
);
INSERT INTO ocr_private.receipt_results (
  id, user_id, image_hash, input_context_hash, provider, model_policy,
  generation, prompt_version, preprocess_version, normalization_version,
  status, dispatch_stage, claim_token
) VALUES (
  '91c10000-0000-4000-8000-000000000005',
  '91c00000-0000-4000-8000-000000000002',
  repeat('3', 64), repeat('4', 64), 'gemini', '["gemini-3.6-flash"]'::jsonb,
  '91c20000-0000-4000-8000-000000000005',
  'credential-release-fixture-v1', 'credential-release-fixture-v1', 'receipt-normalization-v1',
  'processing', 'possibly_dispatched', '91c30000-0000-4000-8000-000000000005'
);
COMMIT;

SELECT extensions.dblink_connect(
  'credential_release_locker',
  pg_catalog.format(
    'host=%s port=%s dbname=%I user=%I',
    pg_catalog.current_setting('unix_socket_directories'),
    pg_catalog.current_setting('port'),
    pg_catalog.current_database(),
    current_user
  )
);
SELECT extensions.dblink_connect(
  'credential_release_runner',
  pg_catalog.format(
    'host=%s port=%s dbname=%I user=%I',
    pg_catalog.current_setting('unix_socket_directories'),
    pg_catalog.current_setting('port'),
    pg_catalog.current_database(),
    current_user
  )
);
SELECT extensions.dblink_exec('credential_release_locker', 'BEGIN');
SELECT * FROM extensions.dblink(
  'credential_release_locker',
  'SELECT id::text FROM ocr_private.receipt_results WHERE id = ''91c10000-0000-4000-8000-000000000005'' FOR UPDATE'
) AS locked(id text);

SELECT extensions.dblink_send_query(
  'credential_release_runner',
  $remote$
    SELECT public.release_receipt_ocr_definitive_credential_rejection(
      '91c10000-0000-4000-8000-000000000005',
      '91c30000-0000-4000-8000-000000000005'
    )::text
  $remote$
);

SELECT extensions.dblink_exec(
  'credential_release_locker',
  $remote$
    UPDATE ocr_private.receipt_results
    SET status = 'indeterminate',
        dispatch_stage = 'uncertain',
        claim_token = NULL,
        completed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = '91c10000-0000-4000-8000-000000000005';
    COMMIT
  $remote$
);

DO $race_result$
BEGIN
  BEGIN
    PERFORM *
    FROM extensions.dblink_get_result('credential_release_runner') AS result(value text);
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_RACE_UNEXPECTEDLY_SUCCEEDED';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%receipt_ocr_claim_mismatch%' THEN
        RAISE;
      END IF;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM ocr_private.receipt_results
    WHERE id = '91c10000-0000-4000-8000-000000000005'
      AND status = 'indeterminate'
      AND dispatch_stage = 'uncertain'
      AND claim_token IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM ocr_private.receipt_credential_rejection_releases
    WHERE result_id = '91c10000-0000-4000-8000-000000000005'
  ) THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_RACE_OVERWROTE_UNCERTAIN_STATE';
  END IF;
END;
$race_result$;

SELECT extensions.dblink_disconnect('credential_release_locker');
SELECT extensions.dblink_disconnect('credential_release_runner');

-- The race requires rows committed before two independent sessions can observe
-- them. Do not weaken the production Auth/privacy boundary to remove those rows.
-- The authorized harness must tear down this exact disposable database after it
-- records the bounded residual state below.
DO $disposable_teardown_handoff$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS user_row
    WHERE user_row.id = '91c00000-0000-4000-8000-000000000002'
  ) OR NOT EXISTS (
    SELECT 1
    FROM ocr_private.receipt_results AS result_row
    WHERE result_row.id = '91c10000-0000-4000-8000-000000000005'
      AND result_row.user_id = '91c00000-0000-4000-8000-000000000002'
      AND result_row.status = 'indeterminate'
      AND result_row.dispatch_stage = 'uncertain'
      AND result_row.claim_token IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM ocr_private.receipt_credential_rejection_releases AS release_row
    WHERE release_row.result_id = '91c10000-0000-4000-8000-000000000005'
  ) THEN
    RAISE EXCEPTION 'RECEIPT_OCR_DISPOSABLE_TEARDOWN_HANDOFF_INVALID';
  END IF;
END;
$disposable_teardown_handoff$;
\echo RECEIPT_OCR_DISPOSABLE_TEARDOWN_HANDOFF=verified
