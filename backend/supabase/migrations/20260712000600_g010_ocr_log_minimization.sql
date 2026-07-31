-- G010: remove raw OCR/provider/credential payloads from usage logs and reject future unsafe metadata.

CREATE OR REPLACE FUNCTION public.ocr_log_metadata_is_safe(p_metadata jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT
    pg_catalog.jsonb_typeof(p_metadata) = 'object'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_object_keys(p_metadata) AS key_name
      WHERE key_name <> ALL (ARRAY[
        'file_size',
        'compressed_size',
        'savings',
        'store_found',
        'provider',
        'model',
        'prompt_version',
        'preprocess_version',
        'extraction_schema_version',
        'routing_mode',
        'normalization_version',
        'fallback_used',
        'force_refresh',
        'attempt_count',
        'confidence',
        'needs_review',
        'restaurant_lookup',
        'error_code'
      ]::text[])
    )
    AND (NOT (p_metadata ? 'file_size') OR (
      pg_catalog.jsonb_typeof(p_metadata -> 'file_size') = 'number'
      AND (p_metadata ->> 'file_size')::numeric >= 0
    ))
    AND (NOT (p_metadata ? 'compressed_size') OR (
      pg_catalog.jsonb_typeof(p_metadata -> 'compressed_size') = 'number'
      AND (p_metadata ->> 'compressed_size')::numeric >= 0
    ))
    AND (NOT (p_metadata ? 'attempt_count') OR (
      pg_catalog.jsonb_typeof(p_metadata -> 'attempt_count') = 'number'
      AND (p_metadata ->> 'attempt_count')::numeric >= 0
      AND (p_metadata ->> 'attempt_count')::numeric <= 100
    ))
    AND (NOT (p_metadata ? 'confidence') OR (
      pg_catalog.jsonb_typeof(p_metadata -> 'confidence') = 'number'
      AND (p_metadata ->> 'confidence')::numeric BETWEEN 0 AND 1
    ))
    AND (NOT (p_metadata ? 'store_found') OR pg_catalog.jsonb_typeof(p_metadata -> 'store_found') = 'boolean')
    AND (NOT (p_metadata ? 'fallback_used') OR pg_catalog.jsonb_typeof(p_metadata -> 'fallback_used') = 'boolean')
    AND (NOT (p_metadata ? 'force_refresh') OR pg_catalog.jsonb_typeof(p_metadata -> 'force_refresh') = 'boolean')
    AND (NOT (p_metadata ? 'savings') OR (
      pg_catalog.jsonb_typeof(p_metadata -> 'savings') = 'string'
      AND pg_catalog.length(p_metadata ->> 'savings') BETWEEN 1 AND 16
      AND (p_metadata ->> 'savings') ~ '^[0-9]{1,3}%$'
    ))
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(ARRAY[
        'provider',
        'model',
        'prompt_version',
        'preprocess_version',
        'extraction_schema_version',
        'routing_mode',
        'normalization_version'
      ]::text[]) AS field_name
      WHERE p_metadata ? field_name
        AND (
          pg_catalog.jsonb_typeof(p_metadata -> field_name) <> 'string'
          OR pg_catalog.length(p_metadata ->> field_name) NOT BETWEEN 1 AND 128
          OR (p_metadata ->> field_name) !~ '^[A-Za-z0-9._:/-]+$'
        )
    )
    AND (NOT (p_metadata ? 'error_code') OR (
      pg_catalog.jsonb_typeof(p_metadata -> 'error_code') = 'string'
      AND pg_catalog.length(p_metadata ->> 'error_code') BETWEEN 1 AND 64
      AND (p_metadata ->> 'error_code') ~ '^[A-Z0-9_]+$'
    ))
    AND (NOT (p_metadata ? 'needs_review') OR (
      pg_catalog.jsonb_typeof(p_metadata -> 'needs_review') = 'array'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements_text(p_metadata -> 'needs_review') AS review_field
        WHERE review_field <> ALL (ARRAY[
          'store_name',
          'restaurant_id',
          'date',
          'time',
          'total_amount',
          'items',
          'category',
          'review_draft'
        ]::text[])
      )
    ))
    AND (NOT (p_metadata ? 'restaurant_lookup') OR (
      pg_catalog.jsonb_typeof(p_metadata -> 'restaurant_lookup') = 'object'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_object_keys(p_metadata -> 'restaurant_lookup') AS lookup_key
        WHERE lookup_key <> ALL (ARRAY['lookupCount', 'lookupLimit', 'stoppedByBudget']::text[])
      )
      AND pg_catalog.jsonb_typeof(p_metadata #> '{restaurant_lookup,lookupCount}') = 'number'
      AND pg_catalog.jsonb_typeof(p_metadata #> '{restaurant_lookup,lookupLimit}') = 'number'
      AND pg_catalog.jsonb_typeof(p_metadata #> '{restaurant_lookup,stoppedByBudget}') = 'boolean'
      AND (p_metadata #>> '{restaurant_lookup,lookupCount}')::numeric >= 0
      AND (p_metadata #>> '{restaurant_lookup,lookupLimit}')::numeric >= 0
    ));
$$;

REVOKE ALL ON FUNCTION public.ocr_log_metadata_is_safe(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ocr_log_metadata_is_safe(jsonb) TO service_role;

DO $migration$
BEGIN
  IF pg_catalog.to_regclass('public.ocr_logs') IS NULL THEN
    RAISE NOTICE 'public.ocr_logs is absent; production schema readback must fail closed before release';
    RETURN;
  END IF;

  EXECUTE $sql$
    UPDATE public.ocr_logs AS log_row
    SET metadata = COALESCE((
      SELECT pg_catalog.jsonb_object_agg(entry.key, entry.value)
      FROM pg_catalog.jsonb_each(
        CASE
          WHEN pg_catalog.jsonb_typeof(log_row.metadata) = 'object' THEN log_row.metadata
          ELSE '{}'::jsonb
        END
      ) AS entry
      WHERE entry.key = ANY (ARRAY[
        'file_size',
        'compressed_size',
        'savings',
        'store_found',
        'provider',
        'model',
        'prompt_version',
        'preprocess_version',
        'extraction_schema_version',
        'routing_mode',
        'normalization_version',
        'fallback_used',
        'force_refresh',
        'attempt_count',
        'confidence',
        'needs_review',
        'restaurant_lookup',
        'error_code'
      ]::text[])
    ), '{}'::jsonb)
    WHERE log_row.metadata IS NOT NULL
  $sql$;

  EXECUTE $sql$
    UPDATE public.ocr_logs
    SET metadata = '{}'::jsonb
    WHERE metadata IS NOT NULL
      AND NOT public.ocr_log_metadata_is_safe(metadata)
  $sql$;

  EXECUTE 'ALTER TABLE public.ocr_logs DROP CONSTRAINT IF EXISTS ocr_logs_metadata_privacy_safe';
  EXECUTE 'ALTER TABLE public.ocr_logs ADD CONSTRAINT ocr_logs_metadata_privacy_safe CHECK (metadata IS NULL OR public.ocr_log_metadata_is_safe(metadata)) NOT VALID';
  EXECUTE 'ALTER TABLE public.ocr_logs VALIDATE CONSTRAINT ocr_logs_metadata_privacy_safe';
END;
$migration$;

COMMENT ON FUNCTION public.ocr_log_metadata_is_safe(jsonb) IS
  'G010 exact allowlist for privacy-minimized OCR usage metadata; rejects raw OCR, provider diagnostics, credential sources, and arbitrary payloads.';
