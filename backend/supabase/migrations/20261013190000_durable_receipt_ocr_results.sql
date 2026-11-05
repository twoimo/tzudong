-- Durable, server-owned OCR result claims. The table stores normalized receipt
-- fields only; images, raw provider output and provider diagnostics stay out.
CREATE SCHEMA IF NOT EXISTS ocr_private;
REVOKE ALL ON SCHEMA ocr_private FROM PUBLIC, anon, authenticated;

-- These four review columns already exist in the operating catalog, but their
-- original creation was never captured by a repository migration. Reconstruct
-- that exact nullable/default contract before any OCR trigger or function
-- references it. IF NOT EXISTS keeps the operating transition additive; the
-- immediate catalog assertion rejects a same-name object with another shape.
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS receipt_hash text,
  ADD COLUMN IF NOT EXISTS receipt_data jsonb,
  ADD COLUMN IF NOT EXISTS is_duplicate boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS ocr_processed_at timestamptz;

DO $review_ocr_column_contract$
DECLARE
  v_ready boolean;
BEGIN
  SELECT pg_catalog.count(*) = 4
    AND pg_catalog.bool_and(
      NOT attribute.attnotnull
      AND attribute.atttypmod = -1
      AND attribute.attidentity = ''
      AND attribute.attgenerated = ''
      AND CASE attribute.attname
        WHEN 'receipt_hash' THEN
          attribute.atttypid = 'text'::pg_catalog.regtype
          AND default_value.oid IS NULL
        WHEN 'receipt_data' THEN
          attribute.atttypid = 'jsonb'::pg_catalog.regtype
          AND default_value.oid IS NULL
        WHEN 'is_duplicate' THEN
          attribute.atttypid = 'boolean'::pg_catalog.regtype
          AND pg_catalog.pg_get_expr(
            default_value.adbin,
            default_value.adrelid
          ) = 'false'
        WHEN 'ocr_processed_at' THEN
          attribute.atttypid = 'timestamp with time zone'::pg_catalog.regtype
          AND default_value.oid IS NULL
        ELSE false
      END
    )
  INTO v_ready
  FROM pg_catalog.pg_attribute AS attribute
  LEFT JOIN pg_catalog.pg_attrdef AS default_value
    ON default_value.adrelid = attribute.attrelid
   AND default_value.adnum = attribute.attnum
  WHERE attribute.attrelid = 'public.reviews'::regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND attribute.attname = ANY (ARRAY[
      'receipt_hash',
      'receipt_data',
      'is_duplicate',
      'ocr_processed_at'
    ]::name[]);

  IF NOT coalesce(v_ready, false) THEN
    RAISE EXCEPTION 'REVIEW_OCR_COLUMN_CONTRACT_DRIFT';
  END IF;
END;
$review_ocr_column_contract$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_receipt_hash
  ON public.reviews USING btree (receipt_hash)
  WHERE receipt_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS reviews_ocr_pending_idx
  ON public.reviews USING btree (ocr_processed_at)
  WHERE verification_photo IS NOT NULL;
CREATE INDEX IF NOT EXISTS reviews_duplicate_idx
  ON public.reviews USING btree (is_duplicate);

DO $review_ocr_index_contract$
DECLARE
  v_ready boolean;
BEGIN
  SELECT pg_catalog.count(*) = 3
    AND pg_catalog.bool_and(
      index_relation.relkind = 'i'
      AND index_row.indrelid = 'public.reviews'::regclass
      AND access_method.amname = 'btree'
      AND index_row.indnkeyatts = 1
      AND index_row.indnatts = 1
      AND index_row.indexprs IS NULL
      AND index_row.indisvalid
      AND index_row.indisready
      AND index_row.indislive
      AND NOT index_row.indisprimary
      AND NOT index_row.indisexclusion
      AND CASE index_relation.relname
        WHEN 'idx_reviews_receipt_hash' THEN
          index_row.indisunique
          AND pg_catalog.pg_get_indexdef(index_relation.oid, 1, true) = 'receipt_hash'
          AND pg_catalog.pg_get_expr(
            index_row.indpred,
            index_row.indrelid
          ) = '(receipt_hash IS NOT NULL)'
        WHEN 'reviews_ocr_pending_idx' THEN
          NOT index_row.indisunique
          AND pg_catalog.pg_get_indexdef(index_relation.oid, 1, true) = 'ocr_processed_at'
          AND pg_catalog.pg_get_expr(
            index_row.indpred,
            index_row.indrelid
          ) = '(verification_photo IS NOT NULL)'
        WHEN 'reviews_duplicate_idx' THEN
          NOT index_row.indisunique
          AND pg_catalog.pg_get_indexdef(index_relation.oid, 1, true) = 'is_duplicate'
          AND index_row.indpred IS NULL
        ELSE false
      END
    )
  INTO v_ready
  FROM pg_catalog.pg_class AS index_relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = index_relation.relnamespace
  JOIN pg_catalog.pg_index AS index_row
    ON index_row.indexrelid = index_relation.oid
  JOIN pg_catalog.pg_am AS access_method
    ON access_method.oid = index_relation.relam
  WHERE namespace.nspname = 'public'
    AND index_relation.relname = ANY (ARRAY[
      'idx_reviews_receipt_hash',
      'reviews_ocr_pending_idx',
      'reviews_duplicate_idx'
    ]::name[]);

  IF NOT coalesce(v_ready, false) THEN
    RAISE EXCEPTION 'REVIEW_OCR_INDEX_CONTRACT_DRIFT';
  END IF;
END;
$review_ocr_index_contract$;

CREATE TABLE ocr_private.receipt_results (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  image_hash text NOT NULL CHECK (image_hash ~ '^[0-9a-f]{64}$'),
  input_context_hash text NOT NULL CHECK (input_context_hash ~ '^[0-9a-f]{64}$'),
  provider text NOT NULL CHECK (provider = 'gemini'),
  model_policy jsonb NOT NULL CHECK (
    jsonb_typeof(model_policy) = 'array'
    AND jsonb_array_length(model_policy) BETWEEN 1 AND 8
  ),
  generation uuid NOT NULL,
  prompt_version text NOT NULL CHECK (length(prompt_version) BETWEEN 1 AND 160),
  preprocess_version text NOT NULL CHECK (length(preprocess_version) BETWEEN 1 AND 160),
  normalization_version text NOT NULL CHECK (length(normalization_version) BETWEEN 1 AND 160),
  status text NOT NULL CHECK (status IN ('processing', 'succeeded', 'indeterminate')),
  dispatch_stage text NOT NULL CHECK (dispatch_stage IN ('reserved', 'possibly_dispatched', 'completed', 'uncertain')),
  claim_token uuid,
  result_payload jsonb,
  result_revision uuid,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT receipt_results_state_check CHECK (
    -- A forced refresh may retain the last verified payload while its replacement
    -- is in flight. It is never returned until that claim resolves.
    (status = 'processing' AND dispatch_stage IN ('reserved', 'possibly_dispatched') AND claim_token IS NOT NULL AND completed_at IS NULL
      AND ((result_payload IS NULL AND result_revision IS NULL) OR (result_payload IS NOT NULL AND result_revision IS NOT NULL)))
    OR (status = 'succeeded' AND dispatch_stage IN ('completed', 'uncertain') AND claim_token IS NULL
      AND result_payload IS NOT NULL AND result_revision IS NOT NULL AND completed_at IS NOT NULL)
    OR (status = 'indeterminate' AND dispatch_stage = 'uncertain' AND claim_token IS NULL
      AND result_payload IS NULL AND result_revision IS NULL AND completed_at IS NOT NULL)
  ),
  CONSTRAINT receipt_results_fingerprint_key UNIQUE (
    user_id,
    image_hash,
    input_context_hash,
    provider,
    model_policy,
    generation,
    prompt_version,
    preprocess_version,
    normalization_version
  )
);

COMMENT ON TABLE ocr_private.receipt_results IS
  'Owner-bound normalized receipt OCR results. Rows have no automatic TTL: account deletion cascades, version-bound fingerprints prevent stale reuse, undispatched reservations require explicit recovery, and possibly dispatched calls remain blocked from replay.';

ALTER TABLE ocr_private.receipt_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_private.receipt_results FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ocr_private.receipt_results FROM PUBLIC, anon, authenticated;

-- Every review gets an opaque OCR generation. Explicit admin reset UPDATEs
-- rotate it even when the visible OCR columns were already null, so a stale
-- workflow cannot reuse the prior durable cache or publish after a later reset.
CREATE TABLE ocr_private.review_generations (
  review_id uuid PRIMARY KEY REFERENCES public.reviews(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  generation uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (review_id, user_id, generation)
);

ALTER TABLE ocr_private.review_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_private.review_generations FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ocr_private.review_generations FROM PUBLIC, anon, authenticated;

CREATE TABLE ocr_private.feature_runtime_capability (
  capability_version text PRIMARY KEY,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  activated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE ocr_private.feature_runtime_capability ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_private.feature_runtime_capability FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE ocr_private.feature_runtime_capability FROM PUBLIC, anon, authenticated;

INSERT INTO ocr_private.review_generations (review_id, user_id, generation)
SELECT review.id, review.user_id, extensions.gen_random_uuid()
FROM public.reviews AS review;

CREATE FUNCTION ocr_private.register_review_ocr_generation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO ocr_private.review_generations (review_id, user_id, generation)
  VALUES (NEW.id, NEW.user_id, extensions.gen_random_uuid())
  ON CONFLICT (review_id) DO UPDATE SET
    user_id = EXCLUDED.user_id,
    generation = extensions.gen_random_uuid(),
    updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER review_ocr_generation_on_insert
AFTER INSERT ON public.reviews
FOR EACH ROW EXECUTE FUNCTION ocr_private.register_review_ocr_generation();

CREATE TRIGGER review_ocr_generation_on_reset
AFTER UPDATE OF receipt_hash, receipt_data, is_duplicate, ocr_processed_at ON public.reviews
FOR EACH ROW
WHEN (
  NEW.verification_photo IS NOT NULL
  AND NEW.receipt_hash IS NULL
  AND NEW.receipt_data IS NULL
  AND NEW.ocr_processed_at IS NULL
  AND NEW.is_duplicate = false
)
EXECUTE FUNCTION ocr_private.register_review_ocr_generation();

CREATE FUNCTION ocr_private.valid_model_policy(p_policy jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_policy IS NOT NULL
    AND pg_catalog.jsonb_typeof(p_policy) = 'array'
    AND pg_catalog.jsonb_array_length(p_policy) BETWEEN 1 AND 8
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_array_elements(p_policy) AS entry(value)
      WHERE pg_catalog.jsonb_typeof(entry.value) <> 'string'
        OR pg_catalog.length(pg_catalog.btrim(entry.value #>> '{}')) NOT BETWEEN 1 AND 160
        OR pg_catalog.btrim(entry.value #>> '{}') <> entry.value #>> '{}'
        OR (entry.value #>> '{}') !~ '^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$'
    )
    AND (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.jsonb_array_elements_text(p_policy) AS model(value)
    ) = (
      SELECT pg_catalog.count(DISTINCT model.value)
      FROM pg_catalog.jsonb_array_elements_text(p_policy) AS model(value)
    );
$$;

CREATE OR REPLACE FUNCTION ocr_private.valid_result_payload(p_payload jsonb)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_normalized jsonb;
  v_entry jsonb;
  v_item jsonb;
  v_review_field text;
BEGIN
  IF p_payload IS NULL
    OR pg_catalog.jsonb_typeof(p_payload) <> 'object'
    OR pg_catalog.octet_length(pg_catalog.convert_to(p_payload::text, 'UTF8')) > 32768
    OR NOT (p_payload ?& ARRAY[
      'schema_version', 'provider', 'model', 'normalized', 'field_trust',
      'confidence', 'needs_review', 'normalization_version'
    ])
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_object_keys(p_payload) AS key(value)
      WHERE value <> ALL (ARRAY[
        'schema_version', 'provider', 'model', 'normalized', 'failure_code',
        'field_trust', 'confidence', 'needs_review', 'normalization_version'
      ])
    )
    OR pg_catalog.jsonb_typeof(p_payload->'schema_version') <> 'string'
    OR pg_catalog.jsonb_typeof(p_payload->'provider') <> 'string'
    OR pg_catalog.jsonb_typeof(p_payload->'model') <> 'string'
    OR pg_catalog.jsonb_typeof(p_payload->'normalization_version') <> 'string'
    OR p_payload->>'schema_version' <> 'receipt-public-ocr-v1'
    OR p_payload->>'provider' <> 'gemini'
    OR pg_catalog.length(pg_catalog.btrim(p_payload->>'model')) NOT BETWEEN 1 AND 160
    OR pg_catalog.btrim(p_payload->>'model') <> p_payload->>'model'
    OR pg_catalog.length(p_payload->>'normalization_version') NOT BETWEEN 1 AND 160
    OR pg_catalog.btrim(p_payload->>'normalization_version') <> p_payload->>'normalization_version'
    OR (p_payload ? 'failure_code' AND (
      pg_catalog.jsonb_typeof(p_payload->'failure_code') <> 'string'
      OR p_payload->>'failure_code' NOT IN ('not_receipt', 'unreadable', 'low_quality', 'ocr_failed')
    ))
  THEN
    RETURN false;
  END IF;

  IF pg_catalog.jsonb_typeof(p_payload->'confidence') <> 'number'
    OR (p_payload->>'confidence')::numeric NOT BETWEEN 0 AND 1
  THEN
    RETURN false;
  END IF;

  v_normalized := p_payload->'normalized';
  IF pg_catalog.jsonb_typeof(v_normalized) <> 'object'
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_object_keys(v_normalized) AS key(value)
      WHERE value <> ALL (ARRAY[
        'store_name', 'date', 'time', 'total_amount', 'category',
        'review_draft', 'items', 'confidence'
      ])
    )
  THEN
    RETURN false;
  END IF;

  IF v_normalized ? 'store_name'
    AND (pg_catalog.jsonb_typeof(v_normalized->'store_name') <> 'string'
      OR pg_catalog.length(v_normalized->>'store_name') NOT BETWEEN 1 AND 160
      OR pg_catalog.btrim(v_normalized->>'store_name') <> v_normalized->>'store_name')
  THEN RETURN false; END IF;

  IF v_normalized ? 'date'
    AND (pg_catalog.jsonb_typeof(v_normalized->'date') <> 'string'
      OR (v_normalized->>'date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
  THEN RETURN false; END IF;

  IF v_normalized ? 'time'
    AND (pg_catalog.jsonb_typeof(v_normalized->'time') <> 'string'
      OR (v_normalized->>'time') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
  THEN RETURN false; END IF;

  IF v_normalized ? 'total_amount' THEN
    IF pg_catalog.jsonb_typeof(v_normalized->'total_amount') <> 'number'
      OR (v_normalized->>'total_amount')::numeric NOT BETWEEN 0 AND 1000000000
    THEN RETURN false; END IF;
  END IF;

  IF v_normalized ? 'category'
    AND (pg_catalog.jsonb_typeof(v_normalized->'category') <> 'string'
      OR pg_catalog.length(v_normalized->>'category') NOT BETWEEN 1 AND 32
      OR pg_catalog.btrim(v_normalized->>'category') <> v_normalized->>'category')
  THEN RETURN false; END IF;

  IF v_normalized ? 'review_draft'
    AND (pg_catalog.jsonb_typeof(v_normalized->'review_draft') <> 'string'
      OR pg_catalog.length(v_normalized->>'review_draft') NOT BETWEEN 1 AND 4000
      OR pg_catalog.btrim(v_normalized->>'review_draft') <> v_normalized->>'review_draft')
  THEN RETURN false; END IF;

  IF v_normalized ? 'confidence' THEN
    IF pg_catalog.jsonb_typeof(v_normalized->'confidence') <> 'number'
      OR (v_normalized->>'confidence')::numeric NOT BETWEEN 0 AND 1
    THEN RETURN false; END IF;
  END IF;

  IF v_normalized ? 'items' THEN
    IF pg_catalog.jsonb_typeof(v_normalized->'items') <> 'array'
      OR pg_catalog.jsonb_array_length(v_normalized->'items') > 50
    THEN RETURN false; END IF;
    FOR v_item IN SELECT value FROM pg_catalog.jsonb_array_elements(v_normalized->'items') LOOP
      IF pg_catalog.jsonb_typeof(v_item) <> 'object'
        OR NOT (v_item ?& ARRAY['name', 'price'])
        OR EXISTS (
          SELECT 1
          FROM pg_catalog.jsonb_object_keys(v_item) AS key(value)
          WHERE value <> ALL (ARRAY['name', 'price'])
        )
        OR pg_catalog.jsonb_typeof(v_item->'name') <> 'string'
        OR pg_catalog.length(v_item->>'name') NOT BETWEEN 1 AND 160
        OR pg_catalog.btrim(v_item->>'name') <> v_item->>'name'
      THEN RETURN false; END IF;
      IF pg_catalog.jsonb_typeof(v_item->'price') NOT IN ('number', 'null') THEN RETURN false; END IF;
      IF pg_catalog.jsonb_typeof(v_item->'price') = 'number'
        AND (v_item->>'price')::numeric NOT BETWEEN 0 AND 1000000000
      THEN RETURN false; END IF;
    END LOOP;
  END IF;

  IF pg_catalog.jsonb_typeof(p_payload->'field_trust') <> 'array'
    OR pg_catalog.jsonb_array_length(p_payload->'field_trust') > 16
  THEN RETURN false; END IF;
  FOR v_entry IN SELECT value FROM pg_catalog.jsonb_array_elements(p_payload->'field_trust') LOOP
    IF pg_catalog.jsonb_typeof(v_entry) <> 'object'
      OR NOT (v_entry ?& ARRAY['field', 'level', 'source', 'reason', 'needsReview'])
      OR EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_object_keys(v_entry) AS key(value)
        WHERE value <> ALL (ARRAY['field', 'level', 'source', 'reason', 'needsReview'])
      )
      OR v_entry->>'field' NOT IN ('store_name', 'restaurant_id', 'date', 'time', 'total_amount', 'items', 'category', 'review_draft')
      OR v_entry->>'level' NOT IN ('high', 'medium', 'low')
      OR v_entry->>'source' NOT IN ('model_raw', 'model_candidate', 'selected_restaurant', 'db_exact', 'db_fuzzy', 'rule_validation', 'user_required')
      OR pg_catalog.jsonb_typeof(v_entry->'reason') <> 'string'
      OR pg_catalog.length(v_entry->>'reason') NOT BETWEEN 1 AND 240
      OR pg_catalog.jsonb_typeof(v_entry->'needsReview') <> 'boolean'
    THEN RETURN false; END IF;
  END LOOP;

  IF pg_catalog.jsonb_typeof(p_payload->'needs_review') <> 'array'
    OR pg_catalog.jsonb_array_length(p_payload->'needs_review') > 8
  THEN RETURN false; END IF;
  FOR v_review_field IN SELECT value #>> '{}' FROM pg_catalog.jsonb_array_elements(p_payload->'needs_review') LOOP
    IF v_review_field NOT IN ('store_name', 'restaurant_id', 'date', 'time', 'total_amount', 'items', 'category', 'review_draft')
    THEN RETURN false; END IF;
  END LOOP;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_array_elements_text(p_payload->'needs_review'))
    <> (SELECT pg_catalog.count(DISTINCT value) FROM pg_catalog.jsonb_array_elements_text(p_payload->'needs_review') AS field(value))
  THEN RETURN false; END IF;

  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION ocr_private.valid_result_payload(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.claim_receipt_ocr_result(
  p_user_id uuid,
  p_image_hash text,
  p_input_context_hash text,
  p_provider text,
  p_model_policy jsonb,
  p_generation uuid,
  p_prompt_version text,
  p_preprocess_version text,
  p_normalization_version text,
  p_operation_id uuid,
  p_force_refresh boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result ocr_private.receipt_results%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
    OR p_operation_id IS NULL
    OR p_image_hash IS NULL
    OR p_input_context_hash IS NULL
    OR p_provider IS NULL
    OR NOT ocr_private.valid_model_policy(p_model_policy)
    OR p_generation IS NULL
    OR p_prompt_version IS NULL
    OR p_preprocess_version IS NULL
    OR p_normalization_version IS NULL
    OR p_image_hash !~ '^[0-9a-f]{64}$'
    OR p_input_context_hash !~ '^[0-9a-f]{64}$'
    OR p_provider <> 'gemini'
    OR length(p_prompt_version) NOT BETWEEN 1 AND 160
    OR length(p_preprocess_version) NOT BETWEEN 1 AND 160
    OR length(p_normalization_version) NOT BETWEEN 1 AND 160
  THEN
    RAISE EXCEPTION 'invalid_receipt_ocr_claim' USING ERRCODE = '22023';
  END IF;

  INSERT INTO ocr_private.receipt_results (
    user_id, image_hash, input_context_hash, provider, model_policy, generation,
    prompt_version, preprocess_version, normalization_version,
    status, dispatch_stage, claim_token
  ) VALUES (
    p_user_id, p_image_hash, p_input_context_hash, p_provider, p_model_policy, p_generation,
    p_prompt_version, p_preprocess_version, p_normalization_version,
    'processing', 'reserved', p_operation_id
  )
  ON CONFLICT (
    user_id, image_hash, input_context_hash, provider, model_policy, generation,
    prompt_version, preprocess_version, normalization_version
  ) DO NOTHING
  RETURNING * INTO v_result;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'claimed',
      'result_ref', v_result.id,
      'claim_token', v_result.claim_token
    );
  END IF;

  SELECT * INTO v_result
  FROM ocr_private.receipt_results
  WHERE user_id = p_user_id
    AND image_hash = p_image_hash
    AND input_context_hash = p_input_context_hash
    AND provider = p_provider
    AND model_policy = p_model_policy
    AND generation = p_generation
    AND prompt_version = p_prompt_version
    AND preprocess_version = p_preprocess_version
    AND normalization_version = p_normalization_version
  FOR UPDATE;

  IF v_result.status = 'succeeded' AND (NOT p_force_refresh OR v_result.dispatch_stage = 'uncertain') THEN
    RETURN jsonb_build_object(
      'status', 'cached',
      'result_ref', v_result.id,
      'result_revision', v_result.result_revision,
      'result_payload', v_result.result_payload,
      'retry_blocked', v_result.dispatch_stage = 'uncertain'
    );
  END IF;

  IF v_result.status = 'processing' THEN
    IF p_force_refresh AND v_result.dispatch_stage = 'reserved' THEN
      UPDATE ocr_private.receipt_results
      SET claim_token = p_operation_id,
          claimed_at = now(),
          updated_at = now()
      WHERE id = v_result.id
        AND status = 'processing'
        AND dispatch_stage = 'reserved'
        AND claim_token = v_result.claim_token
      RETURNING * INTO v_result;
      IF FOUND THEN
        RETURN jsonb_build_object(
          'status', 'claimed',
          'result_ref', v_result.id,
          'claim_token', v_result.claim_token,
          'recovered_reservation', true
        );
      END IF;
    ELSIF p_force_refresh AND v_result.dispatch_stage = 'possibly_dispatched' THEN
      UPDATE ocr_private.receipt_results
      SET status = CASE WHEN result_payload IS NULL THEN 'indeterminate' ELSE 'succeeded' END,
          dispatch_stage = 'uncertain',
          claim_token = NULL,
          completed_at = now(),
          updated_at = now()
      WHERE id = v_result.id
        AND status = 'processing'
        AND dispatch_stage = 'possibly_dispatched'
        AND claim_token = v_result.claim_token
      RETURNING * INTO v_result;
      IF FOUND AND v_result.result_payload IS NOT NULL THEN
        RETURN jsonb_build_object(
          'status', 'cached',
          'result_ref', v_result.id,
          'result_revision', v_result.result_revision,
          'result_payload', v_result.result_payload,
          'retry_blocked', true
        );
      ELSIF FOUND THEN
        RETURN jsonb_build_object('status', 'indeterminate', 'result_ref', v_result.id);
      END IF;
    END IF;
    RETURN jsonb_build_object('status', 'processing', 'result_ref', v_result.id);
  END IF;

  -- An uncertain provider dispatch is never replayed by force refresh. Any
  -- future retry needs a separate reviewed server operation, not this route.
  IF v_result.status = 'indeterminate' OR NOT p_force_refresh THEN
    RETURN jsonb_build_object('status', 'indeterminate', 'result_ref', v_result.id);
  END IF;

  UPDATE ocr_private.receipt_results
  SET status = 'processing',
      dispatch_stage = 'reserved',
      claim_token = p_operation_id,
      claimed_at = now(),
      completed_at = NULL,
      updated_at = now()
  WHERE id = v_result.id
  RETURNING * INTO v_result;

  RETURN jsonb_build_object(
    'status', 'claimed',
    'result_ref', v_result.id,
    'claim_token', v_result.claim_token
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_receipt_ocr_dispatched(
  p_result_id uuid,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result ocr_private.receipt_results%ROWTYPE;
BEGIN
  UPDATE ocr_private.receipt_results
  SET dispatch_stage = 'possibly_dispatched',
      updated_at = now()
  WHERE id = p_result_id
    AND status = 'processing'
    AND dispatch_stage = 'reserved'
    AND claim_token = p_claim_token
  RETURNING * INTO v_result;

  IF FOUND THEN
    RETURN jsonb_build_object('status', 'dispatched', 'result_ref', v_result.id);
  END IF;
  SELECT * INTO v_result FROM ocr_private.receipt_results WHERE id = p_result_id;
  IF v_result.status = 'processing'
    AND v_result.dispatch_stage = 'possibly_dispatched'
    AND v_result.claim_token = p_claim_token
  THEN
    RETURN jsonb_build_object('status', 'dispatched', 'result_ref', v_result.id);
  END IF;
  RAISE EXCEPTION 'receipt_ocr_claim_mismatch' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_receipt_ocr_result(
  p_result_id uuid,
  p_claim_token uuid,
  p_result_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result ocr_private.receipt_results%ROWTYPE;
BEGIN
  IF NOT ocr_private.valid_result_payload(p_result_payload) THEN
    RAISE EXCEPTION 'invalid_receipt_ocr_result' USING ERRCODE = '22023';
  END IF;

  UPDATE ocr_private.receipt_results
  SET status = 'succeeded',
      dispatch_stage = 'completed',
      claim_token = NULL,
      result_payload = p_result_payload,
      result_revision = extensions.gen_random_uuid(),
      completed_at = now(),
      updated_at = now()
  WHERE id = p_result_id
    AND status = 'processing'
    AND dispatch_stage = 'possibly_dispatched'
    AND claim_token = p_claim_token
    AND provider = p_result_payload->>'provider'
    AND model_policy ? (p_result_payload->>'model')
    AND normalization_version = p_result_payload->>'normalization_version'
  RETURNING * INTO v_result;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'succeeded',
      'result_ref', v_result.id,
      'result_revision', v_result.result_revision
    );
  END IF;

  SELECT * INTO v_result FROM ocr_private.receipt_results WHERE id = p_result_id;
  IF v_result.status = 'succeeded' AND v_result.result_payload = p_result_payload THEN
    RETURN jsonb_build_object(
      'status', 'succeeded',
      'result_ref', v_result.id,
      'result_revision', v_result.result_revision
    );
  END IF;
  RAISE EXCEPTION 'receipt_ocr_claim_mismatch' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_receipt_ocr_result_indeterminate(
  p_result_id uuid,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result ocr_private.receipt_results%ROWTYPE;
BEGIN
  UPDATE ocr_private.receipt_results
  SET status = CASE WHEN result_payload IS NULL THEN 'indeterminate' ELSE 'succeeded' END,
      dispatch_stage = 'uncertain',
      claim_token = NULL,
      completed_at = now(),
      updated_at = now()
  WHERE id = p_result_id
    AND status = 'processing'
    AND dispatch_stage = 'possibly_dispatched'
    AND claim_token = p_claim_token
  RETURNING * INTO v_result;

  IF FOUND THEN
    RETURN jsonb_build_object('status', v_result.status, 'result_ref', v_result.id);
  END IF;
  SELECT * INTO v_result FROM ocr_private.receipt_results WHERE id = p_result_id;
  IF v_result.status = 'succeeded' THEN
    RETURN jsonb_build_object('status', 'succeeded', 'result_ref', v_result.id);
  END IF;
  RAISE EXCEPTION 'receipt_ocr_claim_mismatch' USING ERRCODE = '42501';
END;
$$;

CREATE OR REPLACE FUNCTION public.release_receipt_ocr_claim(
  p_result_id uuid,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_restored boolean := false;
BEGIN
  UPDATE ocr_private.receipt_results
  SET status = 'succeeded',
      dispatch_stage = 'completed',
      claim_token = NULL,
      completed_at = now(),
      updated_at = now()
  WHERE id = p_result_id
    AND status = 'processing'
    AND dispatch_stage = 'reserved'
    AND claim_token = p_claim_token
    AND result_payload IS NOT NULL;
  v_restored := FOUND;

  DELETE FROM ocr_private.receipt_results
  WHERE id = p_result_id
    AND status = 'processing'
    AND dispatch_stage = 'reserved'
    AND claim_token = p_claim_token
    AND result_payload IS NULL;
  IF NOT FOUND AND NOT v_restored THEN
    RAISE EXCEPTION 'receipt_ocr_claim_mismatch' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object('status', 'released', 'result_ref', p_result_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.read_receipt_ocr_result(
  p_user_id uuid,
  p_image_hash text,
  p_input_context_hash text,
  p_provider text,
  p_model_policy jsonb,
  p_generation uuid,
  p_prompt_version text,
  p_preprocess_version text,
  p_normalization_version text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result ocr_private.receipt_results%ROWTYPE;
BEGIN
  IF p_user_id IS NULL
    OR p_image_hash !~ '^[0-9a-f]{64}$'
    OR p_input_context_hash !~ '^[0-9a-f]{64}$'
    OR p_provider <> 'gemini'
    OR NOT ocr_private.valid_model_policy(p_model_policy)
    OR p_generation IS NULL
    OR pg_catalog.length(p_prompt_version) NOT BETWEEN 1 AND 160
    OR pg_catalog.length(p_preprocess_version) NOT BETWEEN 1 AND 160
    OR pg_catalog.length(p_normalization_version) NOT BETWEEN 1 AND 160
  THEN
    RAISE EXCEPTION 'invalid_receipt_ocr_read' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_result
  FROM ocr_private.receipt_results
  WHERE user_id = p_user_id
    AND image_hash = p_image_hash
    AND input_context_hash = p_input_context_hash
    AND provider = p_provider
    AND model_policy = p_model_policy
    AND generation = p_generation
    AND prompt_version = p_prompt_version
    AND preprocess_version = p_preprocess_version
    AND normalization_version = p_normalization_version;

  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_found');
  END IF;
  IF v_result.status = 'succeeded' THEN
    IF NOT ocr_private.valid_result_payload(v_result.result_payload)
      OR NOT (v_result.model_policy ? (v_result.result_payload->>'model'))
    THEN
      RAISE EXCEPTION 'invalid_receipt_ocr_result' USING ERRCODE = '22023';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'status', 'succeeded',
      'result_ref', v_result.id,
      'result_revision', v_result.result_revision,
      'result_payload', v_result.result_payload
    );
  END IF;
  RETURN pg_catalog.jsonb_build_object('status', v_result.status, 'result_ref', v_result.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_review_receipt_ocr_generation(
  p_user_id uuid,
  p_review_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_generation uuid;
BEGIN
  IF p_user_id IS NULL OR p_review_id IS NULL THEN
    RAISE EXCEPTION 'invalid_review_ocr_generation_read' USING ERRCODE = '22023';
  END IF;
  SELECT generation INTO v_generation
  FROM ocr_private.review_generations
  WHERE review_id = p_review_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object('status', 'not_found');
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'status', 'ready',
    'review_id', p_review_id,
    'generation', v_generation
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.publish_review_receipt_ocr_result(
  p_user_id uuid,
  p_review_id uuid,
  p_generation uuid,
  p_result_id uuid,
  p_result_revision uuid,
  p_receipt_hash text,
  p_receipt_data jsonb,
  p_is_duplicate boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_generation uuid;
  v_result ocr_private.receipt_results%ROWTYPE;
  v_review public.reviews%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_review_id IS NULL OR p_generation IS NULL
    OR p_result_id IS NULL OR p_result_revision IS NULL OR p_is_duplicate IS NULL
    OR p_receipt_data IS NULL OR pg_catalog.jsonb_typeof(p_receipt_data) <> 'object'
    OR pg_catalog.octet_length(pg_catalog.convert_to(p_receipt_data::text, 'UTF8')) > 32768
    OR (p_receipt_hash IS NOT NULL AND p_receipt_hash !~ '^[0-9a-f]{64}$')
  THEN
    RAISE EXCEPTION 'invalid_review_ocr_publish' USING ERRCODE = '22023';
  END IF;

  -- Match reset's lock order: both paths lock the review row before the
  -- generation row. This removes the reviews -> generations / generations ->
  -- reviews inversion while preserving a fixed stale-generation rejection.
  SELECT * INTO v_review
  FROM public.reviews
  WHERE id = p_review_id AND user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'review_ocr_publish_conflict' USING ERRCODE = '42501';
  END IF;

  SELECT generation INTO v_generation
  FROM ocr_private.review_generations
  WHERE review_id = p_review_id AND user_id = p_user_id
  FOR SHARE;
  IF NOT FOUND OR v_generation IS DISTINCT FROM p_generation THEN
    RAISE EXCEPTION 'review_ocr_generation_stale' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_result
  FROM ocr_private.receipt_results
  WHERE id = p_result_id
    AND user_id = p_user_id
    AND generation = p_generation
    AND status = 'succeeded'
  FOR SHARE;
  IF NOT FOUND
    OR v_result.result_revision IS DISTINCT FROM p_result_revision
    OR NOT ocr_private.valid_result_payload(v_result.result_payload)
    OR NOT (v_result.model_policy ? (v_result.result_payload->>'model'))
  THEN
    RAISE EXCEPTION 'review_ocr_result_stale' USING ERRCODE = '42501';
  END IF;

  UPDATE public.reviews
  SET receipt_hash = p_receipt_hash,
      receipt_data = p_receipt_data,
      is_duplicate = p_is_duplicate,
      ocr_processed_at = now()
  WHERE id = p_review_id
    AND user_id = p_user_id
    AND receipt_hash IS NULL
    AND receipt_data IS NULL
    AND ocr_processed_at IS NULL
    AND is_duplicate = false
  RETURNING * INTO v_review;

  IF NOT FOUND THEN
    SELECT * INTO v_review
    FROM public.reviews
    WHERE id = p_review_id AND user_id = p_user_id;
    IF NOT FOUND
      OR v_review.receipt_hash IS DISTINCT FROM p_receipt_hash
      OR v_review.receipt_data IS DISTINCT FROM p_receipt_data
      OR v_review.is_duplicate IS DISTINCT FROM p_is_duplicate
      OR v_review.ocr_processed_at IS NULL
    THEN
      RAISE EXCEPTION 'review_ocr_publish_conflict' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'published',
    'review_id', v_review.id,
    'generation', p_generation,
    'result_ref', p_result_id,
    'result_revision', p_result_revision,
    'receipt_hash', v_review.receipt_hash,
    'receipt_data', v_review.receipt_data,
    'is_duplicate', v_review.is_duplicate,
    'ocr_processed_at', v_review.ocr_processed_at
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_feature_runtime_capability(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_ready boolean;
  v_contracts_ready boolean;
  v_review_ocr_columns_ready boolean;
  v_review_ocr_indexes_ready boolean;
  v_trigger_helper_oid oid := pg_catalog.to_regprocedure(
    'ocr_private.register_review_ocr_generation()'
  );
BEGIN
  IF p_user_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM auth.users AS user_row WHERE user_row.id = p_user_id
  ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'schema_version', 1,
      'status', 'held',
      'code', 'FEATURE_DATABASE_HELD',
      'capability_version', 'review-media-feature-v1'
    );
  END IF;

  SELECT NOT EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('public.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)', 'jsonb'::pg_catalog.regtype, false, 'v'::"char"),
        ('public.mark_receipt_ocr_dispatched(uuid,uuid)', 'jsonb'::pg_catalog.regtype, false, 'v'::"char"),
        ('public.complete_receipt_ocr_result(uuid,uuid,jsonb)', 'jsonb'::pg_catalog.regtype, false, 'v'::"char"),
        ('public.mark_receipt_ocr_result_indeterminate(uuid,uuid)', 'jsonb'::pg_catalog.regtype, false, 'v'::"char"),
        ('public.release_receipt_ocr_claim(uuid,uuid)', 'jsonb'::pg_catalog.regtype, false, 'v'::"char"),
        ('public.read_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text)', 'jsonb'::pg_catalog.regtype, false, 's'::"char"),
        ('public.get_review_receipt_ocr_generation(uuid,uuid)', 'jsonb'::pg_catalog.regtype, false, 's'::"char"),
        ('public.publish_review_receipt_ocr_result(uuid,uuid,uuid,uuid,uuid,text,jsonb,boolean)', 'jsonb'::pg_catalog.regtype, false, 'v'::"char"),
        ('public.get_feature_runtime_capability(uuid)', 'jsonb'::pg_catalog.regtype, false, 's'::"char"),
        ('public.get_owned_review_storage_objects(uuid,uuid,text,text[])', 'record'::pg_catalog.regtype, true, 'v'::"char"),
        ('public.create_review_with_receipt_ocr(uuid,uuid,uuid,text,text,timestamptz,text,text[],text[],uuid,uuid,uuid,text,timestamptz,text,jsonb)', 'uuid'::pg_catalog.regtype, false, 'v'::"char")
    ) AS required(signature, return_type, returns_set, volatility)
    LEFT JOIN pg_catalog.pg_proc AS procedure_row
      ON procedure_row.oid = pg_catalog.to_regprocedure(required.signature)
    WHERE procedure_row.oid IS NULL
      OR procedure_row.proowner <> 'privacy_workflow_owner'::pg_catalog.regrole
      OR NOT procedure_row.prosecdef
      OR procedure_row.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
      OR procedure_row.prokind <> 'f'
      OR procedure_row.provolatile <> required.volatility
      OR procedure_row.prorettype <> required.return_type
      OR procedure_row.proretset IS DISTINCT FROM required.returns_set
      OR procedure_row.prolang <> (
        SELECT language.oid
        FROM pg_catalog.pg_language AS language
        WHERE language.lanname = 'sql'
      )
      OR NOT pg_catalog.has_function_privilege('service_role', procedure_row.oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('anon', procedure_row.oid, 'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated', procedure_row.oid, 'EXECUTE')
  ) INTO v_contracts_ready;

  -- Keep the runtime decision tied to the same exact review-column contract
  -- that the migration and successor controller admit. A later same-name
  -- column with a different type, default, nullability, identity or generated
  -- shape must put the feature back on hold.
  SELECT pg_catalog.count(*) = 4
    AND pg_catalog.bool_and(
      NOT attribute.attnotnull
      AND attribute.atttypmod = -1
      AND attribute.attidentity = ''
      AND attribute.attgenerated = ''
      AND CASE attribute.attname
        WHEN 'receipt_hash' THEN
          attribute.atttypid = 'text'::pg_catalog.regtype
          AND default_value.oid IS NULL
        WHEN 'receipt_data' THEN
          attribute.atttypid = 'jsonb'::pg_catalog.regtype
          AND default_value.oid IS NULL
        WHEN 'is_duplicate' THEN
          attribute.atttypid = 'boolean'::pg_catalog.regtype
          AND pg_catalog.pg_get_expr(
            default_value.adbin,
            default_value.adrelid
          ) = 'false'
        WHEN 'ocr_processed_at' THEN
          attribute.atttypid = 'timestamp with time zone'::pg_catalog.regtype
          AND default_value.oid IS NULL
        ELSE false
      END
    )
  INTO v_review_ocr_columns_ready
  FROM pg_catalog.pg_attribute AS attribute
  LEFT JOIN pg_catalog.pg_attrdef AS default_value
    ON default_value.adrelid = attribute.attrelid
   AND default_value.adnum = attribute.attnum
  WHERE attribute.attrelid = 'public.reviews'::regclass
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped
    AND attribute.attname = ANY (ARRAY[
      'receipt_hash',
      'receipt_data',
      'is_duplicate',
      'ocr_processed_at'
    ]::name[]);

  -- Index identity is not enough: method, key, predicate and online-validity
  -- flags are all part of the runtime contract.
  SELECT pg_catalog.count(*) = 3
    AND pg_catalog.bool_and(
      index_relation.relkind = 'i'
      AND index_row.indrelid = 'public.reviews'::regclass
      AND access_method.amname = 'btree'
      AND index_row.indnkeyatts = 1
      AND index_row.indnatts = 1
      AND index_row.indexprs IS NULL
      AND index_row.indisvalid
      AND index_row.indisready
      AND index_row.indislive
      AND NOT index_row.indisprimary
      AND NOT index_row.indisexclusion
      AND CASE index_relation.relname
        WHEN 'idx_reviews_receipt_hash' THEN
          index_row.indisunique
          AND pg_catalog.pg_get_indexdef(index_relation.oid, 1, true) = 'receipt_hash'
          AND pg_catalog.pg_get_expr(
            index_row.indpred,
            index_row.indrelid
          ) = '(receipt_hash IS NOT NULL)'
        WHEN 'reviews_ocr_pending_idx' THEN
          NOT index_row.indisunique
          AND pg_catalog.pg_get_indexdef(index_relation.oid, 1, true) = 'ocr_processed_at'
          AND pg_catalog.pg_get_expr(
            index_row.indpred,
            index_row.indrelid
          ) = '(verification_photo IS NOT NULL)'
        WHEN 'reviews_duplicate_idx' THEN
          NOT index_row.indisunique
          AND pg_catalog.pg_get_indexdef(index_relation.oid, 1, true) = 'is_duplicate'
          AND index_row.indpred IS NULL
        ELSE false
      END
    )
  INTO v_review_ocr_indexes_ready
  FROM pg_catalog.pg_class AS index_relation
  JOIN pg_catalog.pg_namespace AS namespace
    ON namespace.oid = index_relation.relnamespace
  JOIN pg_catalog.pg_index AS index_row
    ON index_row.indexrelid = index_relation.oid
  JOIN pg_catalog.pg_am AS access_method
    ON access_method.oid = index_relation.relam
  WHERE namespace.nspname = 'public'
    AND index_relation.relname = ANY (ARRAY[
      'idx_reviews_receipt_hash',
      'reviews_ocr_pending_idx',
      'reviews_duplicate_idx'
    ]::name[]);

  SELECT EXISTS (
    SELECT 1
    FROM ocr_private.feature_runtime_capability AS capability
    WHERE capability.capability_version = 'review-media-feature-v1'
      AND capability.schema_version = 1
  )
  AND v_contracts_ready
  AND coalesce(v_review_ocr_columns_ready, false)
  AND coalesce(v_review_ocr_indexes_ready, false)
  AND pg_catalog.to_regprocedure('public.storyboard_production_admin(uuid,text,uuid,integer,jsonb)') IS NOT NULL
  AND pg_catalog.to_regprocedure('public.storyboard_production_worker(uuid,text,uuid,uuid,jsonb)') IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS table_row
    WHERE table_row.oid = 'ocr_private.receipt_results'::pg_catalog.regclass
      AND table_row.relowner = 'postgres'::pg_catalog.regrole
      AND table_row.relrowsecurity
      AND table_row.relforcerowsecurity
  )
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS table_row
    WHERE table_row.oid = 'ocr_private.review_generations'::pg_catalog.regclass
      AND table_row.relowner = 'postgres'::pg_catalog.regrole
      AND table_row.relrowsecurity
      AND table_row.relforcerowsecurity
  )
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS helper
    WHERE helper.oid = v_trigger_helper_oid
      AND helper.proowner = 'postgres'::pg_catalog.regrole
      AND helper.prosecdef
      AND helper.proconfig = ARRAY['search_path=""']::text[]
      AND helper.prorettype = 'trigger'::pg_catalog.regtype
      AND helper.prolang = (
        SELECT language.oid
        FROM pg_catalog.pg_language AS language
        WHERE language.lanname = 'plpgsql'
      )
      AND NOT pg_catalog.has_function_privilege('anon', helper.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated', helper.oid, 'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('service_role', helper.oid, 'EXECUTE')
  )
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'public.reviews'::pg_catalog.regclass
      AND trigger_row.tgfoid = v_trigger_helper_oid
      AND trigger_row.tgname IN (
        'review_ocr_generation_on_insert',
        'review_ocr_generation_on_reset'
      )
      AND NOT trigger_row.tgisinternal
    GROUP BY trigger_row.tgfoid
    HAVING pg_catalog.count(*) = 2
  )
  AND EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'storage.objects'::pg_catalog.regclass
      AND trigger_row.tgname = 'a01_review_verification_immutable_update'
      AND NOT trigger_row.tgisinternal
  )
  INTO v_ready;

  RETURN pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'status', CASE WHEN v_ready THEN 'ready' ELSE 'held' END,
    'code', CASE WHEN v_ready THEN 'FEATURE_DATABASE_READY' ELSE 'FEATURE_DATABASE_HELD' END,
    'capability_version', 'review-media-feature-v1'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_owned_review_storage_objects(
  p_user_id uuid,
  p_review_id uuid,
  p_purpose text,
  p_names text[]
)
RETURNS TABLE (
  id uuid,
  bucket_id text,
  name text,
  owner_id text,
  version text,
  updated_at timestamptz,
  metadata jsonb,
  archived_at timestamptz,
  is_delete_marker boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_bucket text;
  v_prefix text;
BEGIN
  v_bucket := CASE p_purpose
    WHEN 'verification' THEN 'review-verifications'
    WHEN 'food' THEN 'review-photos'
    ELSE NULL
  END;
  v_prefix := p_user_id::text || '/reviews/' || p_review_id::text || '/' || p_purpose || '/';
  IF p_user_id IS NULL OR p_review_id IS NULL OR v_bucket IS NULL
    OR p_names IS NULL OR cardinality(p_names) NOT BETWEEN 1 AND 20
    OR (SELECT count(*) FROM unnest(p_names)) <> (SELECT count(DISTINCT object_name) FROM unnest(p_names) AS object_name)
    OR EXISTS (
      SELECT 1 FROM unnest(p_names) AS object_name
      WHERE object_name NOT LIKE v_prefix || '%'
        OR substring(object_name FROM length(v_prefix) + 1) LIKE '%/%'
    )
  THEN
    RAISE EXCEPTION 'invalid_review_storage_lookup' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT object_row.id, object_row.bucket_id, object_row.name, object_row.owner_id,
         object_row.version, object_row.updated_at, object_row.metadata,
         object_row.archived_at, object_row.is_delete_marker
  FROM storage.objects AS object_row
  WHERE object_row.bucket_id = v_bucket
    AND object_row.name = ANY(p_names)
    AND object_row.owner_id = p_user_id::text
    AND object_row.archived_at IS NULL
    AND object_row.is_delete_marker = false
  ORDER BY object_row.name;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_review_with_receipt_ocr(
  p_review_id uuid,
  p_user_id uuid,
  p_restaurant_id uuid,
  p_title text,
  p_content text,
  p_visited_at timestamptz,
  p_verification_photo text,
  p_food_photos text[],
  p_categories text[],
  p_ocr_result_id uuid,
  p_ocr_result_revision uuid,
  p_verification_object_id uuid,
  p_verification_object_version text,
  p_verification_object_updated_at timestamptz,
  p_verification_photo_sha256 text,
  p_user_corrections jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_result ocr_private.receipt_results%ROWTYPE;
  v_normalized jsonb;
  v_receipt_data jsonb;
  v_receipt_hash text;
  v_duplicate_of uuid;
  v_owner_prefix text := p_user_id::text || '/reviews/' || p_review_id::text || '/';
  v_verification_object storage.objects%ROWTYPE;
  v_food_object storage.objects%ROWTYPE;
  v_food_photo text;
BEGIN
  IF p_review_id IS NULL OR p_user_id IS NULL OR p_restaurant_id IS NULL
    OR p_ocr_result_id IS NULL OR p_ocr_result_revision IS NULL
    OR p_verification_object_id IS NULL OR p_verification_object_updated_at IS NULL
    OR p_verification_photo_sha256 IS NULL OR p_verification_photo_sha256 !~ '^[0-9a-f]{64}$'
    OR p_verification_photo IS NULL OR p_verification_photo NOT LIKE v_owner_prefix || 'verification/%'
    OR substring(p_verification_photo FROM length(v_owner_prefix || 'verification/') + 1) LIKE '%/%'
    OR p_food_photos IS NULL OR cardinality(p_food_photos) = 0
    OR EXISTS (SELECT 1 FROM unnest(p_food_photos) AS photo WHERE photo NOT LIKE v_owner_prefix || 'food/%')
    OR EXISTS (SELECT 1 FROM unnest(p_food_photos) AS photo WHERE substring(photo FROM length(v_owner_prefix || 'food/') + 1) LIKE '%/%')
    OR (SELECT count(*) FROM unnest(p_food_photos)) <> (SELECT count(DISTINCT photo) FROM unnest(p_food_photos) AS photo)
    OR p_user_corrections IS NULL OR jsonb_typeof(p_user_corrections) <> 'object'
    OR p_user_corrections ?| ARRAY['receipt_hash', 'ocr_result_id', 'ocr_result_revision', 'source', 'schema_version', 'status']
  THEN
    RAISE EXCEPTION 'invalid_review_receipt_input' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_result
  FROM ocr_private.receipt_results
  WHERE id = p_ocr_result_id
    AND user_id = p_user_id
    AND generation = '00000000-0000-0000-0000-000000000000'::uuid
    AND status = 'succeeded'
  FOR SHARE;
  IF NOT FOUND OR NOT ocr_private.valid_result_payload(v_result.result_payload) THEN
    RAISE EXCEPTION 'receipt_ocr_result_not_available' USING ERRCODE = '42501';
  END IF;
  IF v_result.result_revision IS DISTINCT FROM p_ocr_result_revision THEN
    RAISE EXCEPTION 'receipt_ocr_result_stale' USING ERRCODE = '42501';
  END IF;
  IF v_result.image_hash <> p_verification_photo_sha256 THEN
    RAISE EXCEPTION 'receipt_ocr_image_mismatch' USING ERRCODE = '42501';
  END IF;

  -- This row lock protects only Storage metadata. Correct byte binding requires
  -- the Storage service to update version/updated_at atomically with content,
  -- immutable verification keys (browser upsert:false and no authenticated
  -- UPDATE policy), and no out-of-band direct S3 overwrite.
  SELECT * INTO v_verification_object
  FROM storage.objects
  WHERE id = p_verification_object_id
    AND bucket_id = 'review-verifications'
    AND name = p_verification_photo
    AND owner_id = p_user_id::text
    AND archived_at IS NULL
    AND is_delete_marker = false
  FOR SHARE;
  IF NOT FOUND
    OR v_verification_object.version IS DISTINCT FROM p_verification_object_version
    OR v_verification_object.updated_at IS DISTINCT FROM p_verification_object_updated_at
  THEN
    RAISE EXCEPTION 'receipt_verification_object_not_available' USING ERRCODE = '42501';
  END IF;

  FOREACH v_food_photo IN ARRAY p_food_photos LOOP
    SELECT * INTO v_food_object
    FROM storage.objects
    WHERE bucket_id = 'review-photos'
      AND name = v_food_photo
      AND owner_id = p_user_id::text
      AND archived_at IS NULL
      AND is_delete_marker = false
    FOR SHARE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'review_food_object_not_available' USING ERRCODE = '42501';
    END IF;
  END LOOP;

  v_normalized := v_result.result_payload->'normalized';
  IF v_result.result_payload ? 'failure_code' THEN
    v_receipt_data := jsonb_build_object(
      'schema_version', 'receipt_summary_v1',
      'status', 'failed',
      'failure_code', v_result.result_payload->>'failure_code',
      'source', 'public_ocr',
      'ocr_result_id', v_result.id,
      'ocr_result_revision', v_result.result_revision
    );
  ELSE
    v_receipt_data := jsonb_strip_nulls(jsonb_build_object(
      'schema_version', 'receipt_summary_v1',
      'status', 'processed',
      'source', 'public_ocr',
      'ocr_result_id', v_result.id,
      'ocr_result_revision', v_result.result_revision,
      'store_name', v_normalized->'store_name',
      'date', v_normalized->'date',
      'time', v_normalized->'time',
      'total_amount', v_normalized->'total_amount',
      'items', v_normalized->'items',
      'item_count', COALESCE(jsonb_array_length(CASE WHEN jsonb_typeof(v_normalized->'items') = 'array' THEN v_normalized->'items' ELSE '[]'::jsonb END), 0),
      'confidence', v_result.result_payload->'confidence',
      'user_corrections', p_user_corrections
    ));

    IF NULLIF(v_normalized->>'store_name', '') IS NOT NULL
      AND (v_normalized->>'date') ~ '^\d{4}-\d{2}-\d{2}$'
      AND (v_normalized->>'time') ~ '^\d{2}:\d{2}$'
      AND jsonb_typeof(v_normalized->'total_amount') = 'number'
    THEN
      v_receipt_hash := encode(extensions.digest(
        (v_normalized->>'store_name') || '|' || (v_normalized->>'date') || '|'
        || (v_normalized->>'time') || '|' || (v_normalized->>'total_amount'),
        'sha256'
      ), 'hex');
      PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_receipt_hash, 0));
      SELECT id INTO v_duplicate_of
      FROM public.reviews
      WHERE receipt_hash = v_receipt_hash
      ORDER BY created_at, id
      LIMIT 1;
      IF v_duplicate_of IS NOT NULL THEN
        v_receipt_data := v_receipt_data || jsonb_build_object('duplicate_of', v_duplicate_of);
      END IF;
    END IF;
  END IF;

  INSERT INTO public.reviews (
    id, user_id, restaurant_id, title, content, visited_at,
    verification_photo, food_photos, categories, is_verified,
    receipt_hash, receipt_data, is_duplicate, ocr_processed_at
  ) VALUES (
    p_review_id, p_user_id, p_restaurant_id, p_title, p_content, p_visited_at,
    p_verification_photo, p_food_photos, p_categories, false,
    CASE WHEN v_duplicate_of IS NULL THEN v_receipt_hash ELSE NULL END,
    v_receipt_data,
    v_duplicate_of IS NOT NULL,
    now()
  );

  RETURN p_review_id;
END;
$$;

REVOKE ALL ON FUNCTION ocr_private.register_review_ocr_generation() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ocr_private.valid_model_policy(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_receipt_ocr_dispatched(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.complete_receipt_ocr_result(uuid,uuid,jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_receipt_ocr_result_indeterminate(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_receipt_ocr_claim(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.read_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_review_receipt_ocr_generation(uuid,uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.publish_review_receipt_ocr_result(uuid,uuid,uuid,uuid,uuid,text,jsonb,boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_feature_runtime_capability(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_owned_review_storage_objects(uuid,uuid,text,text[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_review_with_receipt_ocr(uuid,uuid,uuid,text,text,timestamptz,text,text[],text[],uuid,uuid,uuid,text,timestamptz,text,jsonb) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_receipt_ocr_dispatched(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.complete_receipt_ocr_result(uuid,uuid,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_receipt_ocr_result_indeterminate(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_receipt_ocr_claim(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_review_receipt_ocr_generation(uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.publish_review_receipt_ocr_result(uuid,uuid,uuid,uuid,uuid,text,jsonb,boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_feature_runtime_capability(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_owned_review_storage_objects(uuid,uuid,text,text[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_review_with_receipt_ocr(uuid,uuid,uuid,text,text,timestamptz,text,text[],text[],uuid,uuid,uuid,text,timestamptz,text,jsonb) TO service_role;
