-- Disposable PostgreSQL 17 fixture for the admitted 107 -> 108 recovery
-- successor. The source-only draft stays held and must not run this fixture
-- until the compiler verifies predecessor 107 and seals the 108 capability.
\set ON_ERROR_STOP on

DO $disposable_target_required$
BEGIN
  IF pg_catalog.current_setting('tzudong.receipt_ocr_disposable_fixture', true)
    IS DISTINCT FROM 'authorized-v1'
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_DISPOSABLE_TARGET_REQUIRED';
  END IF;
END;
$disposable_target_required$;

BEGIN;

SET LOCAL ROLE service_role;
DO $capability_ready$
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_CAPABILITY_ROLE_DRIFT';
  END IF;
  IF public.get_receipt_ocr_indeterminate_recovery_capability() IS DISTINCT FROM
    '{"schema_version":1,"status":"ready","capability_version":"receipt-ocr-indeterminate-recovery-v1"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_CAPABILITY_NOT_READY';
  END IF;
END;
$capability_ready$;
RESET ROLE;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  'a8100000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'recovery108@example.invalid',
  NULL, pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
), (
  'a8100000-0000-4000-8000-000000000002',
  'authenticated', 'authenticated', 'recovery108-replay@example.invalid',
  NULL, pg_catalog.clock_timestamp(),
  '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
);

INSERT INTO public.restaurants (id, approved_name)
VALUES ('a8110000-0000-4000-8000-000000000001', 'recovery-108-fixture');

INSERT INTO public.reviews (
  id, user_id, restaurant_id, title, content, visited_at,
  verification_photo, food_photos, categories, is_verified,
  receipt_hash, receipt_data, is_duplicate, ocr_processed_at
) VALUES
(
  'a8120000-0000-4000-8000-000000000001',
  'a8100000-0000-4000-8000-000000000001',
  'a8110000-0000-4000-8000-000000000001',
  'indeterminate', 'fixture content', pg_catalog.now(),
  'a8100000-0000-4000-8000-000000000001/reviews/a8120000-0000-4000-8000-000000000001/verification/receipt.jpg',
  ARRAY['a8100000-0000-4000-8000-000000000001/reviews/a8120000-0000-4000-8000-000000000001/food/food.jpg'],
  ARRAY['fixture'], false, NULL, NULL, false, NULL
),
(
  'a8120000-0000-4000-8000-000000000002',
  'a8100000-0000-4000-8000-000000000001',
  'a8110000-0000-4000-8000-000000000001',
  'processing', 'fixture content', pg_catalog.now(),
  'a8100000-0000-4000-8000-000000000001/reviews/a8120000-0000-4000-8000-000000000002/verification/receipt.jpg',
  ARRAY['a8100000-0000-4000-8000-000000000001/reviews/a8120000-0000-4000-8000-000000000002/food/food.jpg'],
  ARRAY['fixture'], false, NULL, NULL, false, NULL
);

DO $seed_durable_rows$
DECLARE
  indeterminate_generation uuid;
  processing_generation uuid;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_SEED_ROLE_DRIFT';
  END IF;
  SELECT generation INTO indeterminate_generation
  FROM ocr_private.review_generations
  WHERE review_id = 'a8120000-0000-4000-8000-000000000001';
  SELECT generation INTO processing_generation
  FROM ocr_private.review_generations
  WHERE review_id = 'a8120000-0000-4000-8000-000000000002';

  INSERT INTO ocr_private.receipt_results (
    id, user_id, image_hash, input_context_hash, provider, model_policy,
    generation, prompt_version, preprocess_version, normalization_version,
    status, dispatch_stage, claim_token, completed_at, updated_at
  ) VALUES (
    'a8130000-0000-4000-8000-000000000001',
    'a8100000-0000-4000-8000-000000000001', repeat('a', 64), repeat('b', 64),
    'gemini', '["gemini-3.6-flash"]'::jsonb, indeterminate_generation,
    'recovery108-prompt-v1', 'recovery108-preprocess-v1', 'receipt-normalization-v1',
    'indeterminate', 'uncertain', NULL, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
  );

  INSERT INTO ocr_private.receipt_results (
    id, user_id, image_hash, input_context_hash, provider, model_policy,
    generation, prompt_version, preprocess_version, normalization_version,
    status, dispatch_stage, claim_token
  ) VALUES (
    'a8130000-0000-4000-8000-000000000002',
    'a8100000-0000-4000-8000-000000000001', repeat('c', 64), repeat('d', 64),
    'gemini', '["gemini-3.6-flash"]'::jsonb, processing_generation,
    'recovery108-prompt-v1', 'recovery108-preprocess-v1', 'receipt-normalization-v1',
    'processing', 'possibly_dispatched', 'a8140000-0000-4000-8000-000000000001'
  );
END;
$seed_durable_rows$;

SET LOCAL ROLE service_role;
DO $processing_never_rotates$
DECLARE
  preview jsonb;
  attempted jsonb;
  before_generation uuid;
  after_generation uuid;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_PROCESSING_ROLE_DRIFT';
  END IF;
  SELECT (public.get_review_receipt_ocr_generation(
    'a8100000-0000-4000-8000-000000000001',
    'a8120000-0000-4000-8000-000000000002'
  )->>'generation')::uuid INTO before_generation;
  preview := public.preview_review_receipt_ocr_indeterminate_recovery(
    'a8120000-0000-4000-8000-000000000002'
  );
  IF preview->>'status' <> 'processing' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_PROCESSING_PREVIEW_DRIFT';
  END IF;
  attempted := public.recover_review_receipt_ocr_indeterminate(
    'a8100000-0000-4000-8000-000000000001',
    'a8120000-0000-4000-8000-000000000002',
    'a8150000-0000-4000-8000-000000000001',
    before_generation,
    repeat('0', 64),
    '["gemini-3.8-flash","gemini-3.6-flash"]'::jsonb,
    'HIGH', 'admin-receipt-summary-v1', 'admin-canonical-jpeg-v2', 'receipt-normalization-v1'
  );
  SELECT (public.get_review_receipt_ocr_generation(
    'a8100000-0000-4000-8000-000000000001',
    'a8120000-0000-4000-8000-000000000002'
  )->>'generation')::uuid INTO after_generation;
  IF attempted->>'status' <> 'processing'
    OR after_generation IS DISTINCT FROM before_generation
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_PROCESSING_ROTATED';
  END IF;
END;
$processing_never_rotates$;
RESET ROLE;

DO $processing_private_readback$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_PROCESSING_READBACK_ROLE_DRIFT';
  END IF;
  IF EXISTS (
    SELECT 1 FROM ocr_private.receipt_ocr_indeterminate_recoveries
    WHERE operation_id = 'a8150000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_PROCESSING_ROTATED';
  END IF;
END;
$processing_private_readback$;

SET LOCAL ROLE service_role;
DO $snapshot_and_ack_loss_idempotency$
DECLARE
  preview jsonb;
  wrong_snapshot jsonb;
  first_apply jsonb;
  ack_loss_retry jsonb;
  admin_swap_retry jsonb;
  stale_apply jsonb;
  initial_generation uuid;
  recovery_generation uuid;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_SNAPSHOT_ROLE_DRIFT';
  END IF;
  preview := public.preview_review_receipt_ocr_indeterminate_recovery(
    'a8120000-0000-4000-8000-000000000001'
  );
  IF preview->>'status' <> 'eligible' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_ELIGIBLE_PREVIEW_DRIFT';
  END IF;
  initial_generation := (preview->>'expected_generation')::uuid;

  wrong_snapshot := public.recover_review_receipt_ocr_indeterminate(
    'a8100000-0000-4000-8000-000000000001',
    'a8120000-0000-4000-8000-000000000001',
    'a8150000-0000-4000-8000-000000000002',
    initial_generation,
    repeat('0', 64),
    '["gemini-3.8-flash","gemini-3.6-flash"]'::jsonb,
    'HIGH', 'admin-receipt-summary-v1', 'admin-canonical-jpeg-v2', 'receipt-normalization-v1'
  );
  IF wrong_snapshot->>'status' <> 'conflict' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_SNAPSHOT_ACCEPTED';
  END IF;

  first_apply := public.recover_review_receipt_ocr_indeterminate(
    'a8100000-0000-4000-8000-000000000001',
    'a8120000-0000-4000-8000-000000000001',
    'a8150000-0000-4000-8000-000000000003',
    initial_generation,
    preview->>'input_snapshot_hash',
    '["gemini-3.8-flash","gemini-3.6-flash"]'::jsonb,
    'HIGH', 'admin-receipt-summary-v1', 'admin-canonical-jpeg-v2', 'receipt-normalization-v1'
  );
  recovery_generation := (first_apply->>'generation')::uuid;
  IF first_apply->>'status' <> 'rotated'
    OR (first_apply->>'idempotent')::boolean
    OR (first_apply->>'provider_outcome_certain')::boolean
    OR recovery_generation IS NOT DISTINCT FROM initial_generation
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_FIRST_ROTATION_DRIFT';
  END IF;

  -- Simulate loss of the first RPC/dispatch acknowledgement: the exact same
  -- operation must read back the committed generation without rotating again.
  ack_loss_retry := public.recover_review_receipt_ocr_indeterminate(
    'a8100000-0000-4000-8000-000000000001',
    'a8120000-0000-4000-8000-000000000001',
    'a8150000-0000-4000-8000-000000000003',
    initial_generation,
    preview->>'input_snapshot_hash',
    '["gemini-3.8-flash"]'::jsonb,
    'LOW', 'admin-receipt-summary-v1', 'admin-canonical-jpeg-v2', 'receipt-normalization-v1'
  );
  IF ack_loss_retry->>'status' <> 'rotated'
    OR NOT (ack_loss_retry->>'idempotent')::boolean
    OR (ack_loss_retry->>'generation')::uuid IS DISTINCT FROM recovery_generation
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_ACK_LOSS_REPLAY_DRIFT';
  END IF;

  -- A different currently authenticated administrator may resume the same
  -- persisted operation after a reload; the original actor remains the audit
  -- owner and no second generation may be created.
  admin_swap_retry := public.recover_review_receipt_ocr_indeterminate(
    'a8100000-0000-4000-8000-000000000002',
    'a8120000-0000-4000-8000-000000000001',
    'a8150000-0000-4000-8000-000000000003',
    initial_generation,
    preview->>'input_snapshot_hash',
    '["gemini-3.8-flash"]'::jsonb,
    'LOW', 'admin-receipt-summary-v1', 'admin-canonical-jpeg-v2', 'receipt-normalization-v1'
  );
  IF admin_swap_retry->>'status' <> 'rotated'
    OR NOT (admin_swap_retry->>'idempotent')::boolean
    OR (admin_swap_retry->>'generation')::uuid IS DISTINCT FROM recovery_generation
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_ADMIN_SWAP_REPLAY_DRIFT';
  END IF;

  stale_apply := public.recover_review_receipt_ocr_indeterminate(
    'a8100000-0000-4000-8000-000000000001',
    'a8120000-0000-4000-8000-000000000001',
    'a8150000-0000-4000-8000-000000000004',
    initial_generation,
    preview->>'input_snapshot_hash',
    '["gemini-3.8-flash","gemini-3.6-flash"]'::jsonb,
    'HIGH', 'admin-receipt-summary-v1', 'admin-canonical-jpeg-v2', 'receipt-normalization-v1'
  );
  IF stale_apply->>'status' <> 'conflict' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_STALE_GENERATION_ACCEPTED';
  END IF;
END;
$snapshot_and_ack_loss_idempotency$;
RESET ROLE;

DO $snapshot_private_readback$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_SNAPSHOT_READBACK_ROLE_DRIFT';
  END IF;
  IF (
    SELECT actor_user_id
    FROM ocr_private.receipt_ocr_indeterminate_recoveries
    WHERE operation_id = 'a8150000-0000-4000-8000-000000000003'
  ) IS DISTINCT FROM 'a8100000-0000-4000-8000-000000000001'::uuid THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_ADMIN_SWAP_REPLAY_DRIFT';
  END IF;
END;
$snapshot_private_readback$;

SET LOCAL ROLE service_role;
DO $bound_execution_public_claim$
DECLARE
  recovery_generation uuid;
  processing_generation uuid;
  recovery_photo_hash text;
  processing_photo_hash text;
  first_admission jsonb;
  replay_admission jsonb;
  normal_admission jsonb;
  first_claim jsonb;
  duplicate_claim jsonb;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_BOUND_CLAIM_ROLE_DRIFT';
  END IF;
  SELECT (public.get_review_receipt_ocr_generation(
    'a8100000-0000-4000-8000-000000000001',
    'a8120000-0000-4000-8000-000000000001'
  )->>'generation')::uuid INTO recovery_generation;
  SELECT (public.get_review_receipt_ocr_generation(
    'a8100000-0000-4000-8000-000000000001',
    'a8120000-0000-4000-8000-000000000002'
  )->>'generation')::uuid INTO processing_generation;
  recovery_photo_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'a8100000-0000-4000-8000-000000000001/reviews/a8120000-0000-4000-8000-000000000001/verification/receipt.jpg',
    'UTF8'
  ), 'sha256'), 'hex');
  processing_photo_hash := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(
    'a8100000-0000-4000-8000-000000000001/reviews/a8120000-0000-4000-8000-000000000002/verification/receipt.jpg',
    'UTF8'
  ), 'sha256'), 'hex');

  BEGIN
    PERFORM public.authorize_review_receipt_ocr_execution(
      'a8100000-0000-4000-8000-000000000001',
      'a8120000-0000-4000-8000-000000000001', recovery_generation, NULL,
      recovery_photo_hash, repeat('a', 64), repeat('1', 64),
      '["gemini-3.8-flash","gemini-3.6-flash"]'::jsonb,
      'HIGH', 'admin-receipt-summary-v1', 'admin-canonical-jpeg-v2', 'receipt-normalization-v1'
    );
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_LEGACY_JOB_ADMITTED';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  BEGIN
    UPDATE public.reviews
    SET verification_photo = 'a8100000-0000-4000-8000-000000000001/reviews/a8120000-0000-4000-8000-000000000001/verification/replaced.jpg'
    WHERE id = 'a8120000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_PHOTO_REPLACEMENT_ACCEPTED';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  first_admission := public.authorize_review_receipt_ocr_execution(
    'a8100000-0000-4000-8000-000000000001',
    'a8120000-0000-4000-8000-000000000001', recovery_generation,
    'a8150000-0000-4000-8000-000000000003',
    recovery_photo_hash, repeat('a', 64), repeat('1', 64),
    '["gemini-3.8-flash","gemini-3.6-flash"]'::jsonb,
    'HIGH', 'admin-receipt-summary-v1', 'admin-canonical-jpeg-v2', 'receipt-normalization-v1'
  );
  replay_admission := public.authorize_review_receipt_ocr_execution(
    'a8100000-0000-4000-8000-000000000001',
    'a8120000-0000-4000-8000-000000000001', recovery_generation,
    'a8150000-0000-4000-8000-000000000003',
    recovery_photo_hash, repeat('a', 64), repeat('1', 64),
    '["gemini-3.8-flash","gemini-3.6-flash"]'::jsonb,
    'HIGH', 'admin-receipt-summary-v1', 'admin-canonical-jpeg-v2', 'receipt-normalization-v1'
  );
  IF first_admission->>'status' <> 'allowed_recovery'
    OR replay_admission IS DISTINCT FROM first_admission
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_BOUND_REPLAY_DRIFT';
  END IF;

  BEGIN
    PERFORM public.authorize_review_receipt_ocr_execution(
      'a8100000-0000-4000-8000-000000000001',
      'a8120000-0000-4000-8000-000000000001', recovery_generation,
      'a8150000-0000-4000-8000-000000000003',
      recovery_photo_hash, repeat('a', 64), repeat('2', 64),
      '["gemini-3.8-flash"]'::jsonb,
      'LOW', 'admin-receipt-summary-v1', 'admin-canonical-jpeg-v2', 'receipt-normalization-v1'
    );
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_POLICY_DRIFT_ADMITTED';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  normal_admission := public.authorize_review_receipt_ocr_execution(
    'a8100000-0000-4000-8000-000000000001',
    'a8120000-0000-4000-8000-000000000002', processing_generation, NULL,
    processing_photo_hash, repeat('c', 64), repeat('3', 64),
    '["gemini-3.8-flash"]'::jsonb,
    'HIGH', 'admin-receipt-summary-v1', 'admin-canonical-jpeg-v2', 'receipt-normalization-v1'
  );
  IF normal_admission->>'status' <> 'allowed_normal' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_NORMAL_JOB_REJECTED';
  END IF;

  BEGIN
    PERFORM public.claim_receipt_ocr_result(
      'a8100000-0000-4000-8000-000000000001', repeat('a', 64), repeat('9', 64),
      'gemini', '["gemini-3.6-flash"]'::jsonb, recovery_generation,
      'admin-receipt-summary-v1', 'admin-canonical-jpeg-v2', 'receipt-normalization-v1',
      'a8170000-0000-4000-8000-000000000001', false
    );
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_OLD_CLAIM_ADMITTED';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;

  first_claim := public.claim_receipt_ocr_recovery_result(
    'a8150000-0000-4000-8000-000000000003',
    'a8100000-0000-4000-8000-000000000001', repeat('a', 64), repeat('1', 64),
    'gemini', '["gemini-3.8-flash","gemini-3.6-flash"]'::jsonb, recovery_generation,
    'admin-receipt-summary-v1', 'admin-canonical-jpeg-v2', 'receipt-normalization-v1',
    'a8170000-0000-4000-8000-000000000002', false
  );
  duplicate_claim := public.claim_receipt_ocr_recovery_result(
    'a8150000-0000-4000-8000-000000000003',
    'a8100000-0000-4000-8000-000000000001', repeat('a', 64), repeat('1', 64),
    'gemini', '["gemini-3.8-flash","gemini-3.6-flash"]'::jsonb, recovery_generation,
    'admin-receipt-summary-v1', 'admin-canonical-jpeg-v2', 'receipt-normalization-v1',
    'a8170000-0000-4000-8000-000000000003', false
  );
  IF first_claim->>'status' <> 'claimed'
    OR duplicate_claim->>'status' <> 'processing'
    OR duplicate_claim->>'result_ref' IS DISTINCT FROM first_claim->>'result_ref'
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_BOUND_CLAIM_MULTIPLIED';
  END IF;
  PERFORM pg_catalog.set_config(
    'tzudong.receipt_ocr_recovery108_fixture_result_ref',
    first_claim->>'result_ref',
    true
  );
  PERFORM pg_catalog.set_config(
    'tzudong.receipt_ocr_recovery108_fixture_claim_token',
    first_claim->>'claim_token',
    true
  );
  PERFORM pg_catalog.set_config(
    'tzudong.receipt_ocr_recovery108_fixture_generation',
    recovery_generation::text,
    true
  );
END;
$bound_execution_public_claim$;
RESET ROLE;

DO $bound_execution_private_claim_readback$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_BOUND_CLAIM_READBACK_ROLE_DRIFT';
  END IF;
  IF (
    SELECT pg_catalog.count(*)
    FROM ocr_private.receipt_ocr_recovery_execution_leases AS lease
    WHERE lease.recovery_operation_id = 'a8150000-0000-4000-8000-000000000003'
      AND lease.review_id = 'a8120000-0000-4000-8000-000000000001'
      AND lease.result_id = pg_catalog.current_setting(
        'tzudong.receipt_ocr_recovery108_fixture_result_ref'
      )::uuid
      AND lease.recovery_generation = pg_catalog.current_setting(
        'tzudong.receipt_ocr_recovery108_fixture_generation'
      )::uuid
  ) <> 1 THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_EXECUTION_LEASE_MISSING';
  END IF;
END;
$bound_execution_private_claim_readback$;

SET LOCAL ROLE service_role;
DO $bound_execution_public_release$
DECLARE
  first_result_ref uuid;
  first_claim_token uuid;
  release_result jsonb;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_BOUND_RELEASE_ROLE_DRIFT';
  END IF;
  first_result_ref := pg_catalog.current_setting(
    'tzudong.receipt_ocr_recovery108_fixture_result_ref'
  )::uuid;
  first_claim_token := pg_catalog.current_setting(
    'tzudong.receipt_ocr_recovery108_fixture_claim_token'
  )::uuid;
  BEGIN
    DELETE FROM public.reviews
    WHERE id = 'a8120000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_ACTIVE_DELETE_ACCEPTED';
  EXCEPTION WHEN foreign_key_violation THEN NULL;
  END;
  IF NOT EXISTS (
    SELECT 1 FROM public.reviews
    WHERE id = 'a8120000-0000-4000-8000-000000000001'
  ) THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_ACTIVE_DELETE_REMOVED_REVIEW';
  END IF;

  release_result := public.release_receipt_ocr_claim(first_result_ref, first_claim_token);
  IF release_result->>'status' <> 'released' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_EXECUTION_LEASE_RELEASE_DRIFT';
  END IF;
END;
$bound_execution_public_release$;
RESET ROLE;

DO $bound_execution_private_release_readback$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_BOUND_RELEASE_READBACK_ROLE_DRIFT';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM ocr_private.receipt_ocr_recovery_execution_leases AS lease
    WHERE lease.recovery_operation_id = 'a8150000-0000-4000-8000-000000000003'
  ) THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_EXECUTION_LEASE_RELEASE_DRIFT';
  END IF;
END;
$bound_execution_private_release_readback$;

DO $late_publish_private_seed$
DECLARE
  old_generation uuid;
  current_generation uuid;
  result_revision uuid := 'a8160000-0000-4000-8000-000000000001';
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_LATE_PUBLISH_SEED_ROLE_DRIFT';
  END IF;
  SELECT expected_generation, recovery_generation
  INTO old_generation, current_generation
  FROM ocr_private.receipt_ocr_indeterminate_recoveries
  WHERE operation_id = 'a8150000-0000-4000-8000-000000000003';

  INSERT INTO ocr_private.receipt_results (
    id, user_id, image_hash, input_context_hash, provider, model_policy,
    generation, prompt_version, preprocess_version, normalization_version,
    status, dispatch_stage, claim_token, result_payload, result_revision, completed_at
  ) VALUES (
    'a8130000-0000-4000-8000-000000000003',
    'a8100000-0000-4000-8000-000000000001', repeat('e', 64), repeat('f', 64),
    'gemini', '["gemini-3.6-flash"]'::jsonb, old_generation,
    'recovery108-late-v1', 'recovery108-late-v1', 'receipt-normalization-v1',
    'succeeded', 'completed', NULL,
    '{"schema_version":"receipt-public-ocr-v1","provider":"gemini","model":"gemini-3.6-flash","normalized":{},"field_trust":[],"confidence":1,"needs_review":[],"normalization_version":"receipt-normalization-v1"}'::jsonb,
    result_revision, pg_catalog.clock_timestamp()
  );

  PERFORM pg_catalog.set_config(
    'tzudong.receipt_ocr_recovery108_fixture_old_generation',
    old_generation::text,
    true
  );
  PERFORM pg_catalog.set_config(
    'tzudong.receipt_ocr_recovery108_fixture_current_generation',
    current_generation::text,
    true
  );
END;
$late_publish_private_seed$;

SET LOCAL ROLE service_role;
DO $late_publish_public_rejection$
DECLARE
  old_generation uuid;
  result_revision uuid := 'a8160000-0000-4000-8000-000000000001';
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_LATE_PUBLISH_ROLE_DRIFT';
  END IF;
  old_generation := pg_catalog.current_setting(
    'tzudong.receipt_ocr_recovery108_fixture_old_generation'
  )::uuid;
  BEGIN
    PERFORM public.publish_review_receipt_ocr_result(
      'a8100000-0000-4000-8000-000000000001',
      'a8120000-0000-4000-8000-000000000001',
      old_generation,
      'a8130000-0000-4000-8000-000000000003',
      result_revision,
      NULL,
      '{"schema_version":"receipt_summary_v1","status":"processed"}'::jsonb,
      false
    );
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_LATE_PUBLISH_ACCEPTED';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL;
  END;
END;
$late_publish_public_rejection$;
RESET ROLE;

DO $late_publish_private_readback$
DECLARE
  current_generation uuid;
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_LATE_PUBLISH_READBACK_ROLE_DRIFT';
  END IF;
  current_generation := pg_catalog.current_setting(
    'tzudong.receipt_ocr_recovery108_fixture_current_generation'
  )::uuid;
  IF (
    SELECT generation FROM ocr_private.review_generations
    WHERE review_id = 'a8120000-0000-4000-8000-000000000001'
  ) IS DISTINCT FROM current_generation THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_GENERATION_READBACK_DRIFT';
  END IF;
END;
$late_publish_private_readback$;

SET LOCAL ROLE service_role;
DO $deleted_review_generation_stays_recovery_only$
DECLARE
  deleted_generation uuid;
BEGIN
  IF current_user <> 'service_role' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_DELETED_REVIEW_ROLE_DRIFT';
  END IF;
  SELECT (public.get_review_receipt_ocr_generation(
    'a8100000-0000-4000-8000-000000000001',
    'a8120000-0000-4000-8000-000000000001'
  )->>'generation')::uuid INTO deleted_generation;
  DELETE FROM public.reviews
  WHERE id = 'a8120000-0000-4000-8000-000000000001';
  BEGIN
    PERFORM public.claim_receipt_ocr_result(
      'a8100000-0000-4000-8000-000000000001', repeat('a', 64), repeat('8', 64),
      'gemini', '["gemini-3.6-flash"]'::jsonb, deleted_generation,
      'admin-receipt-summary-v1', 'admin-canonical-jpeg-v2', 'receipt-normalization-v1',
      'a8170000-0000-4000-8000-000000000004', false
    );
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_DELETED_REVIEW_CLAIM_ADMITTED';
  EXCEPTION WHEN SQLSTATE '55000' THEN NULL;
  END;
END;
$deleted_review_generation_stays_recovery_only$;
RESET ROLE;

DO $final_role_readback$
BEGIN
  IF current_user <> 'postgres' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_FINAL_ROLE_DRIFT';
  END IF;
END;
$final_role_readback$;

ROLLBACK;

\echo RECEIPT_OCR_RECOVERY108_PROCESSING_ROTATIONS=0
\echo RECEIPT_OCR_RECOVERY108_ACK_LOSS_EXTRA_ROTATIONS=0
\echo RECEIPT_OCR_RECOVERY108_ADMIN_SWAP_EXTRA_ROTATIONS=0
\echo RECEIPT_OCR_RECOVERY108_LEGACY_RECOVERY_JOB=denied
\echo RECEIPT_OCR_RECOVERY108_BOUND_POLICY_DRIFT=denied
\echo RECEIPT_OCR_RECOVERY108_OLD_CLAIM=denied
\echo RECEIPT_OCR_RECOVERY108_BOUND_CLAIMS=1
\echo RECEIPT_OCR_RECOVERY108_ACTIVE_DELETE=blocked_until_claim_release
\echo RECEIPT_OCR_RECOVERY108_PROVIDER_CALLS_AFTER_DELETE=0
\echo RECEIPT_OCR_RECOVERY108_PHOTO_REPLACEMENT=denied
\echo RECEIPT_OCR_RECOVERY108_DELETED_REVIEW_CLAIM=denied
\echo RECEIPT_OCR_RECOVERY108_LATE_PUBLISH=stale_rejected
