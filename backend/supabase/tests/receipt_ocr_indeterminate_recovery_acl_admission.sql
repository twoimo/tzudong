-- Execute only after compiled 108 reports ready. Every mutation is rolled back.
BEGIN;

DO $ready_precondition$
BEGIN
  IF public.get_receipt_ocr_indeterminate_recovery_capability() IS DISTINCT FROM
    '{"schema_version":1,"status":"ready","capability_version":"receipt-ocr-indeterminate-recovery-v1"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_ACL_READY_PRECONDITION_FAILED';
  END IF;
  IF pg_catalog.to_regrole('supabase_admin') IS NULL THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_ACL_FIXTURE_ROLE_MISSING';
  END IF;
END;
$ready_precondition$;

SAVEPOINT forbidden_acl;
GRANT EXECUTE ON FUNCTION ocr_private.preview_review_receipt_ocr_indeterminate_recovery(uuid)
  TO supabase_admin;
GRANT SELECT ON TABLE ocr_private.receipt_ocr_indeterminate_recoveries
  TO supabase_admin;
DO $forbidden_acl_readback$
BEGIN
  IF ocr_private.receipt_ocr_recovery_acl_admitted_v1() IS DISTINCT FROM false
    OR public.get_receipt_ocr_indeterminate_recovery_capability() IS DISTINCT FROM
      '{"schema_version":1,"status":"held","capability_version":"receipt-ocr-indeterminate-recovery-v1"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_FORBIDDEN_ACL_READY';
  END IF;
END;
$forbidden_acl_readback$;
ROLLBACK TO SAVEPOINT forbidden_acl;

SAVEPOINT grant_option_drift;
GRANT EXECUTE ON FUNCTION ocr_private.authorize_review_receipt_ocr_execution(
  uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text,text,text
) TO privacy_workflow_owner WITH GRANT OPTION;
DO $grant_option_readback$
BEGIN
  IF ocr_private.receipt_ocr_recovery_acl_admitted_v1() IS DISTINCT FROM false
    OR public.get_receipt_ocr_indeterminate_recovery_capability() IS DISTINCT FROM
      '{"schema_version":1,"status":"held","capability_version":"receipt-ocr-indeterminate-recovery-v1"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_GRANT_OPTION_DRIFT_READY';
  END IF;
END;
$grant_option_readback$;
ROLLBACK TO SAVEPOINT grant_option_drift;

SAVEPOINT owner_drift;
ALTER FUNCTION ocr_private.guard_receipt_ocr_recovery_photo_update()
  OWNER TO supabase_admin;
DO $owner_readback$
BEGIN
  IF ocr_private.receipt_ocr_recovery_acl_admitted_v1() IS DISTINCT FROM false
    OR public.get_receipt_ocr_indeterminate_recovery_capability() IS DISTINCT FROM
      '{"schema_version":1,"status":"held","capability_version":"receipt-ocr-indeterminate-recovery-v1"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_OWNER_DRIFT_READY';
  END IF;
END;
$owner_readback$;
ROLLBACK TO SAVEPOINT owner_drift;

SAVEPOINT authorize_body_drift;
CREATE OR REPLACE FUNCTION ocr_private.authorize_review_receipt_ocr_execution(
  p_user_id uuid, p_review_id uuid, p_generation uuid, p_recovery_operation_id uuid,
  p_verification_photo_hash text, p_image_hash text, p_input_context_hash text,
  p_model_policy jsonb, p_thinking_level text, p_prompt_version text,
  p_preprocess_version text, p_normalization_version text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $drift$
  SELECT '{"schema_version":1,"status":"allowed_normal"}'::jsonb;
$drift$;
DO $authorize_body_readback$
BEGIN
  IF ocr_private.receipt_ocr_recovery_acl_admitted_v1() IS DISTINCT FROM true
    OR public.get_receipt_ocr_indeterminate_recovery_capability() IS DISTINCT FROM
      '{"schema_version":1,"status":"held","capability_version":"receipt-ocr-indeterminate-recovery-v1"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_AUTHORIZE_BODY_DRIFT_READY';
  END IF;
END;
$authorize_body_readback$;
ROLLBACK TO SAVEPOINT authorize_body_drift;

SAVEPOINT claim_body_drift;
CREATE OR REPLACE FUNCTION ocr_private.claim_receipt_ocr_recovery_result(
  p_recovery_operation_id uuid, p_user_id uuid, p_image_hash text,
  p_input_context_hash text, p_provider text, p_model_policy jsonb,
  p_generation uuid, p_prompt_version text, p_preprocess_version text,
  p_normalization_version text, p_operation_id uuid, p_force_refresh boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $drift$
  SELECT '{"status":"processing","result_ref":"00000000-0000-4000-8000-000000000000"}'::jsonb;
$drift$;
DO $claim_body_readback$
BEGIN
  IF ocr_private.receipt_ocr_recovery_acl_admitted_v1() IS DISTINCT FROM true
    OR public.get_receipt_ocr_indeterminate_recovery_capability() IS DISTINCT FROM
      '{"schema_version":1,"status":"held","capability_version":"receipt-ocr-indeterminate-recovery-v1"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_CLAIM_BODY_DRIFT_READY';
  END IF;
END;
$claim_body_readback$;
ROLLBACK TO SAVEPOINT claim_body_drift;

SAVEPOINT guard_body_drift;
CREATE OR REPLACE FUNCTION ocr_private.guard_receipt_ocr_recovery_photo_update()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $drift$
BEGIN
  RETURN NEW;
END;
$drift$;
DO $guard_body_readback$
BEGIN
  IF ocr_private.receipt_ocr_recovery_acl_admitted_v1() IS DISTINCT FROM true
    OR public.get_receipt_ocr_indeterminate_recovery_capability() IS DISTINCT FROM
      '{"schema_version":1,"status":"held","capability_version":"receipt-ocr-indeterminate-recovery-v1"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_GUARD_BODY_DRIFT_READY';
  END IF;
END;
$guard_body_readback$;
ROLLBACK TO SAVEPOINT guard_body_drift;

SAVEPOINT photo_trigger_disabled;
ALTER TABLE public.reviews DISABLE TRIGGER receipt_ocr_recovery_photo_update_guard;
DO $photo_trigger_readback$
BEGIN
  IF ocr_private.receipt_ocr_recovery_acl_admitted_v1() IS DISTINCT FROM true
    OR public.get_receipt_ocr_indeterminate_recovery_capability() IS DISTINCT FROM
      '{"schema_version":1,"status":"held","capability_version":"receipt-ocr-indeterminate-recovery-v1"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_PHOTO_TRIGGER_DISABLED_READY';
  END IF;
END;
$photo_trigger_readback$;
ROLLBACK TO SAVEPOINT photo_trigger_disabled;

SAVEPOINT lease_trigger_disabled;
ALTER TABLE ocr_private.receipt_results
  DISABLE TRIGGER receipt_ocr_recovery_execution_lease_release;
DO $lease_trigger_readback$
BEGIN
  IF ocr_private.receipt_ocr_recovery_acl_admitted_v1() IS DISTINCT FROM true
    OR public.get_receipt_ocr_indeterminate_recovery_capability() IS DISTINCT FROM
      '{"schema_version":1,"status":"held","capability_version":"receipt-ocr-indeterminate-recovery-v1"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_LEASE_TRIGGER_DISABLED_READY';
  END IF;
END;
$lease_trigger_readback$;
ROLLBACK TO SAVEPOINT lease_trigger_disabled;

SAVEPOINT lease_review_fk_removed;
DO $drop_review_fk$
DECLARE
  constraint_name name;
BEGIN
  SELECT constraint_row.conname INTO STRICT constraint_name
  FROM pg_catalog.pg_constraint AS constraint_row
  JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = constraint_row.conrelid
   AND attribute.attnum = constraint_row.conkey[1]
  WHERE constraint_row.conrelid = 'ocr_private.receipt_ocr_recovery_execution_leases'::pg_catalog.regclass
    AND constraint_row.contype = 'f'
    AND attribute.attname = 'review_id';
  EXECUTE pg_catalog.format(
    'ALTER TABLE ocr_private.receipt_ocr_recovery_execution_leases DROP CONSTRAINT %I',
    constraint_name
  );
END;
$drop_review_fk$;
DO $removed_fk_readback$
BEGIN
  IF public.get_receipt_ocr_indeterminate_recovery_capability() IS DISTINCT FROM
    '{"schema_version":1,"status":"held","capability_version":"receipt-ocr-indeterminate-recovery-v1"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_LEASE_FK_REMOVED_READY';
  END IF;
END;
$removed_fk_readback$;
ROLLBACK TO SAVEPOINT lease_review_fk_removed;

SAVEPOINT lease_review_fk_cascade;
DO $replace_review_fk$
DECLARE
  constraint_name name;
BEGIN
  SELECT constraint_row.conname INTO STRICT constraint_name
  FROM pg_catalog.pg_constraint AS constraint_row
  JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = constraint_row.conrelid
   AND attribute.attnum = constraint_row.conkey[1]
  WHERE constraint_row.conrelid = 'ocr_private.receipt_ocr_recovery_execution_leases'::pg_catalog.regclass
    AND constraint_row.contype = 'f'
    AND attribute.attname = 'review_id';
  EXECUTE pg_catalog.format(
    'ALTER TABLE ocr_private.receipt_ocr_recovery_execution_leases DROP CONSTRAINT %I',
    constraint_name
  );
  ALTER TABLE ocr_private.receipt_ocr_recovery_execution_leases
    ADD CONSTRAINT receipt_ocr_recovery_execution_leases_review_drift_fk
    FOREIGN KEY (review_id) REFERENCES public.reviews(id) ON DELETE CASCADE;
END;
$replace_review_fk$;
DO $cascade_fk_readback$
BEGIN
  IF public.get_receipt_ocr_indeterminate_recovery_capability() IS DISTINCT FROM
    '{"schema_version":1,"status":"held","capability_version":"receipt-ocr-indeterminate-recovery-v1"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_LEASE_FK_CASCADE_READY';
  END IF;
END;
$cascade_fk_readback$;
ROLLBACK TO SAVEPOINT lease_review_fk_cascade;

DO $ready_restored$
BEGIN
  IF public.get_receipt_ocr_indeterminate_recovery_capability() IS DISTINCT FROM
    '{"schema_version":1,"status":"ready","capability_version":"receipt-ocr-indeterminate-recovery-v1"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_ACL_READY_NOT_RESTORED';
  END IF;
END;
$ready_restored$;

ROLLBACK;

\echo RECEIPT_OCR_RECOVERY108_FORBIDDEN_ACL=held
\echo RECEIPT_OCR_RECOVERY108_GRANT_OPTION_DRIFT=held
\echo RECEIPT_OCR_RECOVERY108_OWNER_DRIFT=held
\echo RECEIPT_OCR_RECOVERY108_AUTHORIZE_BODY_DRIFT=held
\echo RECEIPT_OCR_RECOVERY108_CLAIM_BODY_DRIFT=held
\echo RECEIPT_OCR_RECOVERY108_GUARD_BODY_DRIFT=held
\echo RECEIPT_OCR_RECOVERY108_PHOTO_TRIGGER_DISABLED=held
\echo RECEIPT_OCR_RECOVERY108_LEASE_TRIGGER_DISABLED=held
\echo RECEIPT_OCR_RECOVERY108_LEASE_FK_REMOVED=held
\echo RECEIPT_OCR_RECOVERY108_LEASE_FK_CASCADE=held
\echo RECEIPT_OCR_RECOVERY108_ACL_READY_RESTORED=ready
