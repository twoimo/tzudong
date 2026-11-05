-- Adversarial catalog-readiness checks. Run only after the compiled 105-to-106
-- successor has sealed the private contract in a disposable PostgreSQL 17 DB.
\set ON_ERROR_STOP on

BEGIN;

SET LOCAL ROLE service_role;
DO $ready_baseline$
BEGIN
  IF public.get_receipt_ocr_credential_release_capability() IS DISTINCT FROM
    '{"schema_version":1,"status":"ready","capability_version":"receipt-ocr-definitive-credential-release-v1"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CATALOG_BASELINE_NOT_READY';
  END IF;
END;
$ready_baseline$;
RESET ROLE;

SAVEPOINT release_helper_body_drift;
CREATE OR REPLACE FUNCTION ocr_private.release_receipt_ocr_definitive_credential_rejection(
  p_result_id uuid,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $drift$
BEGIN
  RETURN pg_catalog.jsonb_build_object(
    'status', 'released',
    'result_ref', p_result_id,
    'disposition', 'deleted',
    'result_revision', NULL,
    'idempotent', false
  );
END;
$drift$;
SET LOCAL ROLE service_role;
DO $release_helper_body_held$
BEGIN
  IF public.get_receipt_ocr_credential_release_capability()->>'status' <> 'held' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RELEASE_HELPER_BODY_DRIFT_NOT_HELD';
  END IF;
END;
$release_helper_body_held$;
RESET ROLE;
ROLLBACK TO SAVEPOINT release_helper_body_drift;
\echo RECEIPT_OCR_RELEASE_HELPER_BODY_DRIFT=held

SAVEPOINT single_key_primary_drift;
ALTER TABLE ocr_private.receipt_credential_rejection_releases
  DROP CONSTRAINT receipt_credential_rejection_releases_pkey;
ALTER TABLE ocr_private.receipt_credential_rejection_releases
  ADD CONSTRAINT receipt_credential_rejection_releases_pkey PRIMARY KEY (result_id);
SET LOCAL ROLE service_role;
DO $single_key_primary_held$
BEGIN
  IF public.get_receipt_ocr_credential_release_capability()->>'status' <> 'held' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_SINGLE_KEY_PRIMARY_DRIFT_NOT_HELD';
  END IF;
END;
$single_key_primary_held$;
RESET ROLE;
ROLLBACK TO SAVEPOINT single_key_primary_drift;
\echo RECEIPT_OCR_SINGLE_KEY_PRIMARY_DRIFT=held

SAVEPOINT rls_drift;
ALTER TABLE ocr_private.receipt_credential_rejection_releases DISABLE ROW LEVEL SECURITY;
SET LOCAL ROLE service_role;
DO $rls_held$
BEGIN
  IF public.get_receipt_ocr_credential_release_capability()->>'status' <> 'held' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RLS_DRIFT_NOT_HELD';
  END IF;
END;
$rls_held$;
RESET ROLE;
ROLLBACK TO SAVEPOINT rls_drift;
\echo RECEIPT_OCR_RLS_DRIFT=held

SAVEPOINT policy_drift;
DROP POLICY receipt_credential_rejection_releases_owner_only
  ON ocr_private.receipt_credential_rejection_releases;
SET LOCAL ROLE service_role;
DO $policy_held$
BEGIN
  IF public.get_receipt_ocr_credential_release_capability()->>'status' <> 'held' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_POLICY_DRIFT_NOT_HELD';
  END IF;
END;
$policy_held$;
RESET ROLE;
ROLLBACK TO SAVEPOINT policy_drift;
\echo RECEIPT_OCR_POLICY_DRIFT=held

SAVEPOINT table_acl_drift;
GRANT SELECT ON ocr_private.receipt_credential_rejection_releases TO authenticated;
SET LOCAL ROLE service_role;
DO $table_acl_held$
BEGIN
  IF public.get_receipt_ocr_credential_release_capability()->>'status' <> 'held' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_TABLE_ACL_DRIFT_NOT_HELD';
  END IF;
END;
$table_acl_held$;
RESET ROLE;
ROLLBACK TO SAVEPOINT table_acl_drift;
\echo RECEIPT_OCR_TABLE_ACL_DRIFT=held

SAVEPOINT wrapper_acl_drift;
GRANT privacy_workflow_owner TO postgres
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE
  GRANTED BY postgres;
SET LOCAL ROLE privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION public.release_receipt_ocr_definitive_credential_rejection(uuid, uuid)
  TO supabase_admin;
RESET ROLE;
DO $wrapper_acl_mutated$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(
        procedure.proacl,
        pg_catalog.acldefault('f', procedure.proowner)
      )
    ) AS acl
    WHERE procedure.oid = pg_catalog.to_regprocedure(
      'public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'
    )
      AND acl.grantee = 'supabase_admin'::regrole
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'RECEIPT_OCR_WRAPPER_ACL_DRIFT_MUTATION_NOT_APPLIED';
  END IF;
END;
$wrapper_acl_mutated$;
SET LOCAL ROLE service_role;
DO $wrapper_acl_held$
BEGIN
  IF public.get_receipt_ocr_credential_release_capability()->>'status' <> 'held' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_WRAPPER_ACL_DRIFT_NOT_HELD';
  END IF;
END;
$wrapper_acl_held$;
RESET ROLE;
ROLLBACK TO SAVEPOINT wrapper_acl_drift;
\echo RECEIPT_OCR_WRAPPER_ACL_DRIFT=held

SAVEPOINT release_table_owner_drift;
GRANT privacy_workflow_owner TO postgres
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE
  GRANTED BY postgres;
GRANT CREATE ON SCHEMA ocr_private TO privacy_workflow_owner;
ALTER TABLE ocr_private.receipt_credential_rejection_releases
  OWNER TO privacy_workflow_owner;
DO $release_table_owner_mutated$
BEGIN
  IF (
    SELECT relation.relowner
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = pg_catalog.to_regclass(
      'ocr_private.receipt_credential_rejection_releases'
    )
  ) IS DISTINCT FROM 'privacy_workflow_owner'::regrole THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RELEASE_TABLE_OWNER_DRIFT_MUTATION_NOT_APPLIED';
  END IF;
END;
$release_table_owner_mutated$;
SET LOCAL ROLE service_role;
DO $release_table_owner_held$
BEGIN
  IF public.get_receipt_ocr_credential_release_capability()->>'status' <> 'held' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RELEASE_TABLE_OWNER_DRIFT_NOT_HELD';
  END IF;
END;
$release_table_owner_held$;
RESET ROLE;
ROLLBACK TO SAVEPOINT release_table_owner_drift;
\echo RECEIPT_OCR_RELEASE_TABLE_OWNER_DRIFT=held

SAVEPOINT catalog_table_owner_drift;
GRANT privacy_workflow_owner TO postgres
  WITH ADMIN FALSE, INHERIT FALSE, SET TRUE
  GRANTED BY postgres;
GRANT CREATE ON SCHEMA ocr_private TO privacy_workflow_owner;
ALTER TABLE ocr_private.receipt_credential_release_catalog_contract
  OWNER TO privacy_workflow_owner;
SET LOCAL ROLE privacy_workflow_owner;
GRANT SELECT ON ocr_private.receipt_credential_release_catalog_contract TO postgres;
RESET ROLE;
DO $catalog_table_owner_mutated$
BEGIN
  IF (
    SELECT relation.relowner
    FROM pg_catalog.pg_class AS relation
    WHERE relation.oid = pg_catalog.to_regclass(
      'ocr_private.receipt_credential_release_catalog_contract'
    )
  ) IS DISTINCT FROM 'privacy_workflow_owner'::regrole THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CATALOG_TABLE_OWNER_DRIFT_MUTATION_NOT_APPLIED';
  END IF;
END;
$catalog_table_owner_mutated$;
SET LOCAL ROLE service_role;
DO $catalog_table_owner_held$
BEGIN
  IF public.get_receipt_ocr_credential_release_capability()->>'status' <> 'held' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CATALOG_TABLE_OWNER_DRIFT_NOT_HELD';
  END IF;
END;
$catalog_table_owner_held$;
RESET ROLE;
ROLLBACK TO SAVEPOINT catalog_table_owner_drift;
\echo RECEIPT_OCR_CATALOG_TABLE_OWNER_DRIFT=held

SAVEPOINT ledger_unregistered;
DELETE FROM supabase_migrations.schema_migrations
WHERE version = '20261018152032';
SET LOCAL ROLE service_role;
DO $ledger_unregistered_held$
BEGIN
  IF public.get_receipt_ocr_credential_release_capability()->>'status' <> 'held' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_LEDGER_UNREGISTERED_NOT_HELD';
  END IF;
END;
$ledger_unregistered_held$;
RESET ROLE;
ROLLBACK TO SAVEPOINT ledger_unregistered;
\echo RECEIPT_OCR_LEDGER_UNREGISTERED=held

SAVEPOINT ledger_statement_drift;
UPDATE supabase_migrations.schema_migrations
SET statements = statements || ARRAY['synthetic statement drift']::text[]
WHERE version = '20261018152032';
SET LOCAL ROLE service_role;
DO $ledger_statement_held$
BEGIN
  IF public.get_receipt_ocr_credential_release_capability()->>'status' <> 'held' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_LEDGER_STATEMENT_DRIFT_NOT_HELD';
  END IF;
END;
$ledger_statement_held$;
RESET ROLE;
ROLLBACK TO SAVEPOINT ledger_statement_drift;
\echo RECEIPT_OCR_LEDGER_STATEMENT_DRIFT=held

SET LOCAL ROLE service_role;
DO $ready_restored$
BEGIN
  IF public.get_receipt_ocr_credential_release_capability()->>'status' <> 'ready' THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CATALOG_BASELINE_NOT_RESTORED';
  END IF;
END;
$ready_restored$;
RESET ROLE;

ROLLBACK;
