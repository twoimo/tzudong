-- Align the receipt OCR indeterminate recovery path with the canonical model
-- policy contract. The recovery table CHECK and the RPC guard were written
-- against a 1..3 / 120-character policy, while ocr_private.valid_model_policy
-- (the definition the durable OCR result path and both TypeScript resolvers
-- use) allows 1..8 distinct, trimmed names of 1..160 characters. A policy with
-- four or more models therefore passed the application checks and failed here
-- with 503, and the retry path returned 409 OCR_RECOVERY_REQUIRED.
--
-- Both constraints now delegate to ocr_private.valid_model_policy so the SQL
-- and TypeScript contracts cannot drift apart again. Issue #3351.

ALTER TABLE ocr_private.receipt_ocr_indeterminate_recoveries
  DROP CONSTRAINT IF EXISTS receipt_ocr_indeterminate_recoveries_model_policy_check;

ALTER TABLE ocr_private.receipt_ocr_indeterminate_recoveries
  ADD CONSTRAINT receipt_ocr_indeterminate_recoveries_model_policy_check
  CHECK (ocr_private.valid_model_policy(model_policy));

COMMENT ON CONSTRAINT receipt_ocr_indeterminate_recoveries_model_policy_check
  ON ocr_private.receipt_ocr_indeterminate_recoveries IS
  'Model policies follow ocr_private.valid_model_policy (1..8 distinct trimmed names of 1..160 characters).';

CREATE OR REPLACE FUNCTION ocr_private.recover_review_receipt_ocr_indeterminate(
  p_actor_user_id uuid,
  p_review_id uuid,
  p_recovery_operation_id uuid,
  p_expected_generation uuid,
  p_input_snapshot_hash text,
  p_model_policy jsonb,
  p_thinking_level text,
  p_prompt_version text,
  p_preprocess_version text,
  p_normalization_version text
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  review_row public.reviews%ROWTYPE;
  current_generation uuid;
  recovery_generation uuid;
  durable_result ocr_private.receipt_results%ROWTYPE;
  prior_operation ocr_private.receipt_ocr_indeterminate_recoveries%ROWTYPE;
  result_row ocr_private.receipt_results%ROWTYPE;
  processing_count integer := 0;
  indeterminate_count integer := 0;
  snapshot_hash text;
  verification_photo_hash text;
BEGIN
  IF p_actor_user_id IS NULL
    OR p_review_id IS NULL
    OR p_recovery_operation_id IS NULL
    OR p_expected_generation IS NULL
    OR p_input_snapshot_hash !~ '^[0-9a-f]{64}$'
    OR NOT ocr_private.valid_model_policy(p_model_policy)
    OR p_thinking_level NOT IN ('LOW', 'MEDIUM', 'HIGH')
    OR p_prompt_version IS DISTINCT FROM 'admin-receipt-summary-v1'
    OR p_preprocess_version IS DISTINCT FROM 'admin-canonical-jpeg-v2'
    OR p_normalization_version IS DISTINCT FROM 'receipt-normalization-v1'
  THEN
    RAISE EXCEPTION 'receipt_ocr_recovery_invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('receipt-ocr-recovery-operation:' || p_recovery_operation_id::text, 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('receipt-ocr-recovery-review:' || p_review_id::text, 0)
  );

  -- Keep the established publish/reset order: review row, generation row, then
  -- durable result rows. This makes a concurrent late publish either win first
  -- or observe a stale generation, never a half-rotated recovery.
  SELECT * INTO review_row
  FROM public.reviews AS review
  WHERE review.id = p_review_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'schema_version', 1, 'status', 'conflict', 'review_id', p_review_id,
      'operation_id', p_recovery_operation_id
    );
  END IF;

  SELECT generation INTO current_generation
  FROM ocr_private.review_generations AS generation_row
  WHERE generation_row.review_id = review_row.id
    AND generation_row.user_id = review_row.user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'schema_version', 1, 'status', 'conflict', 'review_id', p_review_id,
      'operation_id', p_recovery_operation_id
    );
  END IF;

  SELECT * INTO prior_operation
  FROM ocr_private.receipt_ocr_indeterminate_recoveries AS operation_row
  WHERE operation_row.operation_id = p_recovery_operation_id;
  IF FOUND THEN
    IF prior_operation.review_id IS DISTINCT FROM p_review_id
      OR prior_operation.expected_generation IS DISTINCT FROM p_expected_generation
      OR prior_operation.input_snapshot_hash IS DISTINCT FROM p_input_snapshot_hash
    THEN
      RETURN pg_catalog.jsonb_build_object(
        'schema_version', 1, 'status', 'conflict', 'review_id', p_review_id,
        'operation_id', p_recovery_operation_id
      );
    END IF;
    IF current_generation IS DISTINCT FROM prior_operation.recovery_generation THEN
      RETURN pg_catalog.jsonb_build_object(
        'schema_version', 1, 'status', 'stale_operation', 'review_id', p_review_id,
        'operation_id', p_recovery_operation_id
      );
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'schema_version', 1,
      'status', 'rotated',
      'review_id', p_review_id,
      'operation_id', p_recovery_operation_id,
      'previous_generation', prior_operation.expected_generation,
      'generation', prior_operation.recovery_generation,
      'input_snapshot_hash', prior_operation.input_snapshot_hash,
      'idempotent', true,
      'provider_outcome_certain', false,
      'model_policy', prior_operation.model_policy,
      'thinking_level', prior_operation.thinking_level
    );
  END IF;

  IF review_row.verification_photo IS NULL
    OR review_row.ocr_processed_at IS NOT NULL
    OR review_row.receipt_data IS NOT NULL
    OR review_row.receipt_hash IS NOT NULL
    OR review_row.is_duplicate IS DISTINCT FROM false
    OR current_generation IS DISTINCT FROM p_expected_generation
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'schema_version', 1, 'status', 'conflict', 'review_id', p_review_id,
      'operation_id', p_recovery_operation_id
    );
  END IF;

  FOR result_row IN
    SELECT *
    FROM ocr_private.receipt_results AS locked_result
    WHERE locked_result.user_id = review_row.user_id
      AND locked_result.generation = current_generation
    ORDER BY locked_result.id
    FOR UPDATE
  LOOP
    IF result_row.status = 'processing' THEN
      processing_count := processing_count + 1;
    ELSIF result_row.status = 'indeterminate' AND result_row.dispatch_stage = 'uncertain' THEN
      indeterminate_count := indeterminate_count + 1;
      durable_result := result_row;
    END IF;
  END LOOP;

  IF processing_count > 0 THEN
    RETURN pg_catalog.jsonb_build_object(
      'schema_version', 1, 'status', 'processing', 'review_id', p_review_id,
      'operation_id', p_recovery_operation_id
    );
  END IF;
  IF indeterminate_count = 0 THEN
    RETURN pg_catalog.jsonb_build_object(
      'schema_version', 1, 'status', 'not_indeterminate', 'review_id', p_review_id,
      'operation_id', p_recovery_operation_id
    );
  END IF;
  IF indeterminate_count <> 1 THEN
    RETURN pg_catalog.jsonb_build_object(
      'schema_version', 1, 'status', 'conflict', 'review_id', p_review_id,
      'operation_id', p_recovery_operation_id
    );
  END IF;

  snapshot_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.convert_to(
        pg_catalog.jsonb_build_array(
          'receipt-ocr-indeterminate-recovery-snapshot-v1',
          review_row.id,
          review_row.user_id,
          review_row.verification_photo,
          current_generation,
          durable_result.id,
          durable_result.image_hash,
          durable_result.input_context_hash,
          durable_result.provider,
          durable_result.model_policy,
          durable_result.prompt_version,
          durable_result.preprocess_version,
          durable_result.normalization_version,
          durable_result.status,
          durable_result.dispatch_stage,
          durable_result.completed_at,
          durable_result.updated_at
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
  IF snapshot_hash IS DISTINCT FROM p_input_snapshot_hash THEN
    RETURN pg_catalog.jsonb_build_object(
      'schema_version', 1, 'status', 'conflict', 'review_id', p_review_id,
      'operation_id', p_recovery_operation_id
    );
  END IF;

  verification_photo_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(review_row.verification_photo, 'UTF8'), 'sha256'),
    'hex'
  );

  recovery_generation := extensions.gen_random_uuid();
  UPDATE ocr_private.review_generations AS generation_row
  SET generation = recovery_generation,
      updated_at = pg_catalog.clock_timestamp()
  WHERE generation_row.review_id = review_row.id
    AND generation_row.user_id = review_row.user_id
    AND generation_row.generation = current_generation;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'schema_version', 1, 'status', 'conflict', 'review_id', p_review_id,
      'operation_id', p_recovery_operation_id
    );
  END IF;

  INSERT INTO ocr_private.receipt_ocr_indeterminate_recoveries (
    operation_id,
    review_id,
    actor_user_id,
    expected_generation,
    recovery_generation,
    input_snapshot_hash,
    verification_photo_hash,
    expected_image_hash,
    model_policy,
    thinking_level,
    prompt_version,
    preprocess_version,
    normalization_version
  ) VALUES (
    p_recovery_operation_id,
    review_row.id,
    p_actor_user_id,
    current_generation,
    recovery_generation,
    snapshot_hash,
    verification_photo_hash,
    durable_result.image_hash,
    p_model_policy,
    p_thinking_level,
    p_prompt_version,
    p_preprocess_version,
    p_normalization_version
  );

  RETURN pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'status', 'rotated',
    'review_id', p_review_id,
    'operation_id', p_recovery_operation_id,
    'previous_generation', current_generation,
    'generation', recovery_generation,
    'input_snapshot_hash', snapshot_hash,
    'idempotent', false,
    'provider_outcome_certain', false,
    'model_policy', p_model_policy,
    'thinking_level', p_thinking_level
  );
END;
$function$;
