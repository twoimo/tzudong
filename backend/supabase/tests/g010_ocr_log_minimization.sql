BEGIN;

DO $$
DECLARE
  v_constraint_validated boolean;
BEGIN
  IF NOT public.ocr_log_metadata_is_safe(pg_catalog.jsonb_build_object(
    'file_size', 1000,
    'compressed_size', 900,
    'savings', '10%',
    'store_found', true,
    'provider', 'gemini',
    'model', 'gemini-3.5-flash',
    'prompt_version', 'receipt-extraction-v2',
    'preprocess_version', 'receipt-image-v3',
    'extraction_schema_version', 'receipt-ocr-v1',
    'routing_mode', 'automatic',
    'normalization_version', 'receipt-normalization-v1',
    'fallback_used', false,
    'force_refresh', false,
    'attempt_count', 1,
    'confidence', 0.91,
    'needs_review', pg_catalog.jsonb_build_array('store_name'),
    'restaurant_lookup', pg_catalog.jsonb_build_object(
      'lookupCount', 1,
      'lookupLimit', 3,
      'stoppedByBudget', false
    )
  )) THEN
    RAISE EXCEPTION 'privacy-minimized OCR metadata was rejected';
  END IF;

  IF public.ocr_log_metadata_is_safe(pg_catalog.jsonb_build_object(
    'raw_ocr_result', pg_catalog.jsonb_build_object('store_name', '민감 상호'),
    'credential_source', 'GEMINI_API_KEY',
    'attempted_providers', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('error', 'raw provider detail'))
  )) THEN
    RAISE EXCEPTION 'raw OCR/provider/credential metadata was accepted';
  END IF;

  IF pg_catalog.to_regclass('public.ocr_logs') IS NOT NULL THEN
    SELECT constraint_row.convalidated
    INTO v_constraint_validated
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.ocr_logs'::regclass
      AND constraint_row.conname = 'ocr_logs_metadata_privacy_safe';

    IF v_constraint_validated IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'ocr_logs metadata privacy constraint is missing or unvalidated';
    END IF;
  END IF;
END;
$$;

ROLLBACK;

SELECT 'ocr-log-minimization:PASS' AS result;
