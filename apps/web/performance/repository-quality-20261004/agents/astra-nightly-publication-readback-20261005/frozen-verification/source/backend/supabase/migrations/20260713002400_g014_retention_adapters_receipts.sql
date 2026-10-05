-- G014-05: retention adapters, provider receipts, and fail-closed lifecycle controls.
-- This recovery migration removes legacy raw work-item locators, binds their
-- opaque hashes to the authoritative storage catalog under the owner boundary,
-- and does not make the web application an authority for external-provider deletion success.

BEGIN;

DO $g014_retention_preflight$
BEGIN
  IF pg_catalog.to_regclass('privacy_retention.privacy_retention_classes') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.privacy_retention_work_items') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.privacy_retention_runs') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.privacy_retention_run_items') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.privacy_retained_records') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.privacy_legal_holds') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.g014_public_rpc_allowlist') IS NULL
     OR pg_catalog.to_regclass('storage.objects') IS NULL
     OR (
       SELECT count(*)
       FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = pg_catalog.to_regclass('storage.objects')
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
         AND attribute.attname IN ('id', 'bucket_id', 'name', 'version')
     ) IS DISTINCT FROM 4
     OR pg_catalog.to_regprocedure('extensions.digest(text,text)') IS NULL
     OR pg_catalog.to_regprocedure('extensions.gen_random_uuid()') IS NULL
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles AS role_row
       WHERE role_row.rolname = 'privacy_workflow_owner'
     ) THEN
    RAISE EXCEPTION 'G014-05 required G010/G014 retention dependencies are missing';
  END IF;
END;
$g014_retention_preflight$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_storage_locator_hash(
  p_bucket_name text,
  p_object_name text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(
    extensions.digest(p_bucket_name || E'\n' || p_object_name, 'sha256'),
    'hex'
  );
$function$;

ALTER TABLE privacy_retention.privacy_retention_work_items
  ADD COLUMN IF NOT EXISTS storage_version_hash text
    CHECK (storage_version_hash IS NULL OR storage_version_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE privacy_retention.privacy_retention_runs
  ADD COLUMN IF NOT EXISTS database_readback_passed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS storage_readback_passed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS no_active_hold_mutated boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS storage_receipts_hash text
    CHECK (storage_receipts_hash IS NULL OR storage_receipts_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS adapter_version text
    CHECK (adapter_version IS NULL OR adapter_version ~ '^[0-9a-f]{64}$'),
  ADD COLUMN IF NOT EXISTS source_mapping_version text
    CHECK (source_mapping_version IS NULL OR source_mapping_version ~ '^[0-9a-f]{64}$');

ALTER TABLE privacy_retention.privacy_retention_work_items
  DROP CONSTRAINT IF EXISTS privacy_retention_work_items_storage_locator_check;
ALTER TABLE privacy_retention.privacy_retention_work_items
  DROP CONSTRAINT IF EXISTS g014_retention_claim_requires_storage_version;
DROP FUNCTION IF EXISTS public.claim_privacy_retention_storage_items(uuid, text, text, integer);

DO $g014_retention_migrate_legacy_storage_locators$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_retention_work_items AS item
    WHERE item.source_type NOT IN ('storage_object', 'ocr_artifact')
      AND (item.storage_bucket IS NOT NULL OR item.storage_object_name IS NOT NULL)
  ) OR EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_retention_work_items AS item
    LEFT JOIN storage.objects AS object_row
      ON object_row.bucket_id::text = item.storage_bucket
     AND object_row.name::text = item.storage_object_name
    WHERE item.source_type = 'storage_object'
       OR (
         item.source_type = 'ocr_artifact'
         AND (item.storage_bucket IS NOT NULL OR item.storage_object_name IS NOT NULL)
       )
    GROUP BY item.id
    HAVING item.storage_bucket IS NULL
        OR item.storage_object_name IS NULL
        OR count(object_row.id) IS DISTINCT FROM 1
        OR pg_catalog.length(coalesce(max(pg_catalog.to_jsonb(object_row) ->> 'version'), '')) NOT BETWEEN 1 AND 256
        OR coalesce(max(pg_catalog.to_jsonb(object_row) ->> 'version'), '') !~ '^[A-Za-z0-9._:-]+$'
  ) OR EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_retention_work_items AS item
    WHERE item.source_type IN ('storage_object', 'ocr_artifact')
      AND item.storage_bucket IS NOT NULL
      AND item.storage_object_name IS NOT NULL
    GROUP BY item.class_code,
             privacy_retention.g014_retention_storage_locator_hash(
               item.storage_bucket, item.storage_object_name
             )
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'retention_storage_authoritative_locator_migration_invalid'
      USING ERRCODE = '55000';
  END IF;
END;
$g014_retention_migrate_legacy_storage_locators$;

UPDATE privacy_retention.privacy_retention_work_items AS item
SET source_ref_hash = privacy_retention.g014_retention_storage_locator_hash(
      object_row.bucket_id::text, object_row.name::text
    ),
    storage_version_hash = pg_catalog.encode(
      extensions.digest(pg_catalog.to_jsonb(object_row) ->> 'version', 'sha256'),
      'hex'
    )
FROM storage.objects AS object_row
WHERE item.source_type IN ('storage_object', 'ocr_artifact')
  AND item.storage_bucket IS NOT NULL
  AND item.storage_object_name IS NOT NULL
  AND object_row.bucket_id::text = item.storage_bucket
  AND object_row.name::text = item.storage_object_name;

ALTER TABLE privacy_retention.privacy_retention_work_items
  DROP COLUMN IF EXISTS storage_bucket,
  DROP COLUMN IF EXISTS storage_object_name;
ALTER TABLE privacy_retention.privacy_retention_work_items
  ADD CONSTRAINT g014_retention_storage_locator_binding CHECK (
    (source_type <> 'storage_object' OR storage_version_hash IS NOT NULL)
    AND (
      storage_version_hash IS NULL
      OR source_type IN ('storage_object', 'ocr_artifact')
    )
  );

CREATE TABLE privacy_retention.retention_adapter_registry (
  adapter_code text PRIMARY KEY CHECK (adapter_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  source_type text NOT NULL CHECK (source_type IN (
    'notification', 'approved_audit_record', 'ocr_metadata', 'ocr_artifact',
    'access_log', 'deleted_account_residue', 'storage_object'
  )),
  removal_mode text NOT NULL CHECK (removal_mode IN ('delete', 'external_delete', 'unsupported')),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE TABLE privacy_retention.retention_adapter_versions (
  adapter_code text NOT NULL REFERENCES privacy_retention.retention_adapter_registry(adapter_code) ON DELETE RESTRICT,
  adapter_version text NOT NULL CHECK (adapter_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'),
  source_relation text NOT NULL CHECK (source_relation ~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$'),
  source_identifier_column text NOT NULL CHECK (source_identifier_column ~ '^[a-z_][a-z0-9_]*$'),
  source_type text NOT NULL CHECK (source_type IN (
    'notification', 'approved_audit_record', 'ocr_metadata', 'ocr_artifact',
    'access_log', 'deleted_account_residue', 'storage_object'
  )),
  removal_mode text NOT NULL CHECK (removal_mode IN ('delete', 'external_delete', 'unsupported')),
  provider_verifier_ref text NULL CHECK (
    provider_verifier_ref IS NULL OR provider_verifier_ref ~ '^[A-Za-z0-9._:-]{8,128}$'
  ),
  contract_hash text NOT NULL CHECK (contract_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'disabled' CHECK (status IN ('disabled', 'draft', 'active')),
  physical_catalog_fingerprint text NULL CHECK (
    physical_catalog_fingerprint IS NULL OR physical_catalog_fingerprint ~ '^[0-9a-f]{64}$'
  ),
  operator_approval_ref text NULL CHECK (
    operator_approval_ref IS NULL OR operator_approval_ref ~ '^[A-Za-z0-9._:-]{8,128}$'
  ),
  legal_approval_ref text NULL CHECK (
    legal_approval_ref IS NULL OR legal_approval_ref ~ '^[A-Za-z0-9._:-]{8,128}$'
  ),
  activated_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (adapter_code, adapter_version),
  CHECK (
    (status = 'active'
      AND operator_approval_ref IS NOT NULL
      AND legal_approval_ref IS NOT NULL
      AND physical_catalog_fingerprint IS NOT NULL
      AND activated_at IS NOT NULL)
    OR (status <> 'active' AND activated_at IS NULL)
  ),
  CHECK (
    (removal_mode = 'external_delete' AND provider_verifier_ref IS NOT NULL)
    OR (removal_mode <> 'external_delete' AND provider_verifier_ref IS NULL)
  )
);
CREATE UNIQUE INDEX g014_retention_one_active_adapter_version_idx
  ON privacy_retention.retention_adapter_versions (adapter_code)
  WHERE status = 'active';

CREATE TABLE privacy_retention.retention_class_adapter_bindings (
  class_code text NOT NULL REFERENCES privacy_retention.privacy_retention_classes(code) ON DELETE RESTRICT,
  adapter_code text NOT NULL,
  adapter_version text NOT NULL,
  source_type text NOT NULL CHECK (source_type IN (
    'notification', 'approved_audit_record', 'ocr_metadata', 'ocr_artifact',
    'access_log', 'deleted_account_residue', 'storage_object'
  )),
  mapping_contract_hash text NOT NULL CHECK (mapping_contract_hash ~ '^[0-9a-f]{64}$'),
  operator_approval_ref text NOT NULL CHECK (operator_approval_ref ~ '^[A-Za-z0-9._:-]{8,128}$'),
  legal_approval_ref text NOT NULL CHECK (legal_approval_ref ~ '^[A-Za-z0-9._:-]{8,128}$'),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  activated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (class_code, adapter_code, adapter_version),
  FOREIGN KEY (adapter_code, adapter_version)
    REFERENCES privacy_retention.retention_adapter_versions(adapter_code, adapter_version)
    ON DELETE RESTRICT
);
CREATE UNIQUE INDEX g014_retention_one_active_class_source_idx
  ON privacy_retention.retention_class_adapter_bindings (class_code, source_type)
  WHERE status = 'active';

DO $g014_retention_approval_roles$
DECLARE
  v_role name;
BEGIN
  FOREACH v_role IN ARRAY ARRAY[
    'privacy_retention_operator_approver'::name,
    'privacy_retention_legal_approver'::name,
    'privacy_retention_activation_operator'::name
  ] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles AS role_row WHERE role_row.rolname = v_role) THEN
      EXECUTE pg_catalog.format(
        'CREATE ROLE %I NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS',
        v_role
      );
    ELSIF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS role_row
      WHERE role_row.rolname = v_role
        AND (role_row.rolsuper OR role_row.rolreplication OR role_row.rolbypassrls)
    ) THEN
      RAISE EXCEPTION 'G014 retention approval role % has a privileged immutable attribute', v_role;
    END IF;
    EXECUTE pg_catalog.format(
      'ALTER ROLE %I NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN',
      v_role
    );
  END LOOP;

  IF pg_catalog.pg_has_role('service_role', 'privacy_retention_operator_approver', 'member')
     OR pg_catalog.pg_has_role('service_role', 'privacy_retention_legal_approver', 'member')
     OR pg_catalog.pg_has_role('service_role', 'privacy_retention_activation_operator', 'member') THEN
    RAISE EXCEPTION 'service_role cannot hold a G014 retention approval capability';
  END IF;
END;
$g014_retention_approval_roles$;

CREATE TABLE privacy_retention.retention_adapter_approvals (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  approval_kind text NOT NULL CHECK (approval_kind IN ('operator', 'legal')),
  class_code text NOT NULL REFERENCES privacy_retention.privacy_retention_classes(code) ON DELETE RESTRICT,
  adapter_code text NOT NULL,
  adapter_version text NOT NULL,
  retention_period interval NOT NULL CHECK (retention_period > interval '0 seconds'),
  mapping_contract_hash text NOT NULL CHECK (mapping_contract_hash ~ '^[0-9a-f]{64}$'),
  approval_ref text NOT NULL CHECK (approval_ref ~ '^[A-Za-z0-9._:-]{8,128}$'),
  signed_payload_hash text NOT NULL CHECK (signed_payload_hash ~ '^[0-9a-f]{64}$'),
  approved_by_role name NOT NULL,
  approved_by_principal name NOT NULL DEFAULT session_user,
  approved_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (approval_kind, approval_ref),
  FOREIGN KEY (adapter_code, adapter_version)
    REFERENCES privacy_retention.retention_adapter_versions(adapter_code, adapter_version)
    ON DELETE RESTRICT,
  CHECK (
    (approval_kind = 'operator' AND approved_by_role = 'privacy_retention_operator_approver'::name)
    OR (approval_kind = 'legal' AND approved_by_role = 'privacy_retention_legal_approver'::name)
  ),
  CHECK (
    approved_by_principal <> ALL (ARRAY[
      'service_role'::name,
      'privacy_retention_operator_approver'::name,
      'privacy_retention_legal_approver'::name,
      'privacy_retention_activation_operator'::name
    ])
  )
);

CREATE TABLE privacy_retention.retention_adapter_approval_consumptions (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  operator_approval_id uuid NOT NULL UNIQUE
    REFERENCES privacy_retention.retention_adapter_approvals(id) ON DELETE RESTRICT,
  legal_approval_id uuid NOT NULL UNIQUE
    REFERENCES privacy_retention.retention_adapter_approvals(id) ON DELETE RESTRICT,
  class_code text NOT NULL REFERENCES privacy_retention.privacy_retention_classes(code) ON DELETE RESTRICT,
  adapter_code text NOT NULL,
  adapter_version text NOT NULL,
  retention_period interval NOT NULL CHECK (retention_period > interval '0 seconds'),
  mapping_contract_hash text NOT NULL CHECK (mapping_contract_hash ~ '^[0-9a-f]{64}$'),
  consumed_by_role name NOT NULL CHECK (consumed_by_role = 'privacy_retention_activation_operator'::name),
  consumed_by_principal name NOT NULL DEFAULT session_user,
  consumed_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (class_code, adapter_code, adapter_version),
  CHECK (operator_approval_id IS DISTINCT FROM legal_approval_id),
  CHECK (
    consumed_by_principal <> ALL (ARRAY[
      'service_role'::name,
      'privacy_retention_operator_approver'::name,
      'privacy_retention_legal_approver'::name,
      'privacy_retention_activation_operator'::name
    ])
  ),
  FOREIGN KEY (adapter_code, adapter_version)
    REFERENCES privacy_retention.retention_adapter_versions(adapter_code, adapter_version)
    ON DELETE RESTRICT
);
CREATE TABLE privacy_retention.g014_retention_storage_claims (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES privacy_retention.privacy_retention_runs(id) ON DELETE RESTRICT,
  work_item_id uuid NOT NULL REFERENCES privacy_retention.privacy_retention_work_items(id) ON DELETE RESTRICT,
  adapter_code text NOT NULL,
  adapter_version text NOT NULL,
  claim_token uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  object_locator_hash text NOT NULL CHECK (object_locator_hash ~ '^[0-9a-f]{64}$'),
  object_version_hash text NOT NULL CHECK (object_version_hash ~ '^[0-9a-f]{64}$'),
  claim_hash text NOT NULL CHECK (claim_hash ~ '^[0-9a-f]{64}$'),
  attempt_number integer NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'acknowledged', 'failed', 'expired')),
  claimed_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  claim_expires_at timestamptz NOT NULL,
  resolved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (claim_token),
  UNIQUE (run_id, work_item_id, attempt_number),
  CHECK (claim_expires_at > claimed_at),
  CHECK (
    (status = 'active' AND resolved_at IS NULL)
    OR (status IN ('acknowledged', 'failed', 'expired') AND resolved_at IS NOT NULL)
  ),
  FOREIGN KEY (adapter_code, adapter_version)
    REFERENCES privacy_retention.retention_adapter_versions(adapter_code, adapter_version)
    ON DELETE RESTRICT
);
CREATE UNIQUE INDEX g014_retention_one_active_storage_claim_idx
  ON privacy_retention.g014_retention_storage_claims (work_item_id)
  WHERE status = 'active';
CREATE TABLE privacy_retention.g014_retention_provider_effects (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES privacy_retention.privacy_retention_runs(id) ON DELETE RESTRICT,
  work_item_id uuid NOT NULL REFERENCES privacy_retention.privacy_retention_work_items(id) ON DELETE RESTRICT,
  claim_token uuid NOT NULL REFERENCES privacy_retention.g014_retention_storage_claims(claim_token) ON DELETE RESTRICT,
  claim_hash text NOT NULL CHECK (claim_hash ~ '^[0-9a-f]{64}$'),
  object_locator_hash text NOT NULL CHECK (object_locator_hash ~ '^[0-9a-f]{64}$'),
  object_version_hash text NOT NULL CHECK (object_version_hash ~ '^[0-9a-f]{64}$'),
  adapter_version text NOT NULL CHECK (adapter_version ~ '^[0-9a-f]{64}$'),
  source_mapping_version text NOT NULL CHECK (source_mapping_version ~ '^[0-9a-f]{64}$'),
  provider_verifier_ref text NOT NULL CHECK (provider_verifier_ref ~ '^[A-Za-z0-9._:-]{8,128}$'),
  subject_ref_hash text NULL CHECK (subject_ref_hash IS NULL OR subject_ref_hash ~ '^[0-9a-f]{64}$'),
  data_class text NOT NULL CHECK (data_class ~ '^[a-z][a-z0-9_]{2,79}$'),
  provider_effect_token uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  effect_state text NOT NULL DEFAULT 'provider_effect_in_flight'
    CHECK (effect_state IN ('provider_effect_in_flight', 'reconciliation_required', 'verified_absent', 'failed')),
  authorized_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  lease_expires_at timestamptz NOT NULL,
  verified_at timestamptz NULL,
  failure_code text NULL CHECK (failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{2,79}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (claim_token),
  UNIQUE (provider_effect_token),
  CHECK (lease_expires_at > authorized_at AND lease_expires_at <= authorized_at + interval '2 minutes'),
  CHECK (
    (effect_state IN ('provider_effect_in_flight', 'reconciliation_required')
      AND verified_at IS NULL AND failure_code IS NULL)
    OR (effect_state = 'verified_absent' AND verified_at IS NOT NULL AND failure_code IS NULL)
    OR (effect_state = 'failed' AND verified_at IS NOT NULL AND failure_code IS NOT NULL)
  )
);
CREATE INDEX g014_retention_provider_effect_reconcile_idx
  ON privacy_retention.g014_retention_provider_effects (run_id, effect_state, authorized_at);


CREATE TABLE privacy_retention.g014_retention_receipts (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES privacy_retention.privacy_retention_runs(id) ON DELETE RESTRICT,
  work_item_id uuid NOT NULL REFERENCES privacy_retention.privacy_retention_work_items(id) ON DELETE RESTRICT,
  adapter_code text NOT NULL,
  adapter_version text NOT NULL,
  receipt_kind text NOT NULL CHECK (receipt_kind IN ('database_source_absence', 'storage_provider_absence', 'storage_provider_failure')),
  source_ref_hash text NOT NULL CHECK (source_ref_hash ~ '^[0-9a-f]{64}$'),
  source_absence_hash text NULL CHECK (source_absence_hash IS NULL OR source_absence_hash ~ '^[0-9a-f]{64}$'),
  claim_token uuid NULL,
  claim_hash text NULL CHECK (claim_hash IS NULL OR claim_hash ~ '^[0-9a-f]{64}$'),
  object_version_hash text NULL CHECK (object_version_hash IS NULL OR object_version_hash ~ '^[0-9a-f]{64}$'),
  provider_effect_token uuid NULL,
  provider_receipt_ref text NULL CHECK (
    provider_receipt_ref IS NULL OR provider_receipt_ref ~ '^[A-Za-z0-9._:-]{8,255}[A-Za-z0-9._:-]?$'
  ),
  provider_receipt_hash text NULL CHECK (provider_receipt_hash IS NULL OR provider_receipt_hash ~ '^[0-9a-f]{64}$'),
  provider_absence_hash text NULL CHECK (provider_absence_hash IS NULL OR provider_absence_hash ~ '^[0-9a-f]{64}$'),
  verifier_ref text NULL CHECK (verifier_ref IS NULL OR verifier_ref ~ '^[A-Za-z0-9._:-]{8,128}$'),
  failure_code text NULL CHECK (failure_code IS NULL OR failure_code ~ '^[a-z][a-z0-9_]{2,79}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK (
    (receipt_kind = 'database_source_absence'
      AND source_absence_hash IS NOT NULL
      AND claim_token IS NULL AND claim_hash IS NULL AND object_version_hash IS NULL
      AND provider_effect_token IS NULL
      AND provider_receipt_ref IS NULL AND provider_receipt_hash IS NULL
      AND provider_absence_hash IS NULL AND verifier_ref IS NULL AND failure_code IS NULL)
    OR (receipt_kind = 'storage_provider_absence'
      AND source_absence_hash IS NULL
      AND claim_token IS NOT NULL AND claim_hash IS NOT NULL AND object_version_hash IS NOT NULL
      AND provider_effect_token IS NOT NULL
      AND provider_receipt_ref IS NOT NULL AND provider_receipt_hash IS NOT NULL
      AND provider_absence_hash IS NOT NULL AND verifier_ref IS NOT NULL AND failure_code IS NULL)
    OR (receipt_kind = 'storage_provider_failure'
      AND source_absence_hash IS NULL
      AND claim_token IS NOT NULL AND claim_hash IS NOT NULL AND object_version_hash IS NOT NULL
      AND provider_effect_token IS NULL
      AND provider_receipt_ref IS NULL AND provider_receipt_hash IS NULL
      AND provider_absence_hash IS NULL AND verifier_ref IS NULL AND failure_code IS NOT NULL)
  ),
  FOREIGN KEY (adapter_code, adapter_version)
    REFERENCES privacy_retention.retention_adapter_versions(adapter_code, adapter_version)
    ON DELETE RESTRICT
);
CREATE UNIQUE INDEX g014_retention_one_database_receipt_idx
  ON privacy_retention.g014_retention_receipts (run_id, work_item_id, receipt_kind)
  WHERE claim_token IS NULL;
CREATE UNIQUE INDEX g014_retention_one_claim_receipt_idx
  ON privacy_retention.g014_retention_receipts (run_id, work_item_id, receipt_kind, claim_token)
  WHERE claim_token IS NOT NULL;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_adapter_contract_hash(
  p_adapter_code text,
  p_adapter_version text,
  p_source_relation text,
  p_source_identifier_column text,
  p_source_type text,
  p_removal_mode text,
  p_provider_verifier_ref text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.concat_ws(
        ':', 'g014-retention-adapter-v1', p_adapter_code, p_adapter_version,
        p_source_relation, p_source_identifier_column, p_source_type,
        p_removal_mode, COALESCE(p_provider_verifier_ref, '<none>')
      ),
      'sha256'
    ),
    'hex'
  );
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_source_hash(
  p_adapter_code text,
  p_source_identifier text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.concat_ws(':', 'g014-retention-source-v1', p_adapter_code, p_source_identifier),
      'sha256'
    ),
    'hex'
  );
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_storage_claim_hash(
  p_run_id uuid,
  p_work_item_id uuid,
  p_claim_token uuid,
  p_object_locator_hash text,
  p_object_version_hash text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.concat_ws(
        ':', 'g014-retention-storage-claim-v1', p_run_id::text, p_work_item_id::text,
        p_claim_token::text, p_object_locator_hash, p_object_version_hash
      ),
      'sha256'
    ),
    'hex'
  );
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_database_absence_hash(
  p_adapter_code text,
  p_adapter_version text,
  p_source_ref_hash text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.concat_ws(
        ':', 'g014-retention-database-absence-v1', p_adapter_code,
        p_adapter_version, p_source_ref_hash, 'absent'
      ),
      'sha256'
    ),
    'hex'
  );
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_storage_receipt_set_hash(
  p_run_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(
    extensions.digest(
      COALESCE((
        SELECT pg_catalog.string_agg(
          pg_catalog.concat_ws(
            ':', receipt.work_item_id::text, receipt.claim_token::text, receipt.claim_hash,
            receipt.object_version_hash, receipt.provider_effect_token::text, receipt.provider_receipt_ref,
            receipt.provider_receipt_hash, receipt.provider_absence_hash, receipt.verifier_ref
          ),
          E'\n' ORDER BY receipt.work_item_id, receipt.claim_hash
        )
        FROM privacy_retention.g014_retention_receipts AS receipt
        WHERE receipt.run_id = p_run_id
          AND receipt.receipt_kind = 'storage_provider_absence'
      ), ''),
      'sha256'
    ),
    'hex'
  );
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_require_service_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'privacy_retention_service_role_required' USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_lock_subject_hash(
  p_subject_ref_hash text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_subject_ref_hash IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('g014-retention-subject:' || p_subject_ref_hash, 0)
    );
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_active_hold_exists(
  p_subject_ref_hash text,
  p_data_class text,
  p_as_of timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_subject_ref_hash IS NOT NULL AND EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_legal_holds AS hold_row
    WHERE hold_row.subject_ref_hash = p_subject_ref_hash
      AND hold_row.data_class = p_data_class
      AND hold_row.status = 'active'
      AND (hold_row.expires_at IS NULL OR hold_row.expires_at > p_as_of)
  );
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_source_absent(
  p_adapter_code text,
  p_source_relation text,
  p_source_identifier_column text,
  p_source_ref_hash text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_relation regclass;
  v_count bigint;
BEGIN
  v_relation := pg_catalog.to_regclass(p_source_relation);
  IF v_relation IS NULL THEN
    RAISE EXCEPTION 'retention_adapter_source_relation_missing' USING ERRCODE = '55000';
  END IF;

  EXECUTE pg_catalog.format(
    'SELECT count(*) FROM %s WHERE privacy_retention.g014_retention_source_hash($1, %I::text) = $2',
    v_relation,
    p_source_identifier_column
  ) INTO v_count USING p_adapter_code, p_source_ref_hash;

  RETURN v_count = 0;
END;
$function$;
CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_no_active_hold_mutated(
  p_run_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_item record;
BEGIN
  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'privacy_retention_run_required' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN
    SELECT run_item.work_item_id, item.source_ref_hash, item.subject_ref_hash,
           item.data_class, item.source_type, binding.adapter_code,
           version_row.source_relation, version_row.source_identifier_column
    FROM privacy_retention.privacy_retention_run_items AS run_item
    JOIN privacy_retention.privacy_retention_work_items AS item
      ON item.id = run_item.work_item_id
    JOIN privacy_retention.retention_class_adapter_bindings AS binding
      ON binding.class_code = item.class_code
     AND binding.source_type = item.source_type
     AND binding.status = 'active'
    JOIN privacy_retention.retention_adapter_versions AS version_row
      ON version_row.adapter_code = binding.adapter_code
     AND version_row.adapter_version = binding.adapter_version
     AND version_row.status = 'active'
     AND binding.mapping_contract_hash IS NOT DISTINCT FROM version_row.contract_hash
    WHERE run_item.run_id = p_run_id
    ORDER BY item.subject_ref_hash NULLS FIRST, run_item.work_item_id
  LOOP
    PERFORM privacy_retention.g014_retention_lock_subject_hash(v_item.subject_ref_hash);
    IF privacy_retention.g014_retention_active_hold_exists(
         v_item.subject_ref_hash, v_item.data_class, pg_catalog.clock_timestamp()
       ) THEN
      IF EXISTS (
           SELECT 1
           FROM privacy_retention.g014_retention_receipts AS receipt
           WHERE receipt.run_id = p_run_id
             AND receipt.work_item_id = v_item.work_item_id
             AND receipt.receipt_kind IN ('database_source_absence', 'storage_provider_absence')
         ) THEN
        RETURN false;
      END IF;
      IF v_item.source_type NOT IN ('storage_object', 'ocr_artifact')
         AND privacy_retention.g014_retention_source_absent(
           v_item.adapter_code, v_item.source_relation,
           v_item.source_identifier_column, v_item.source_ref_hash
         ) THEN
        RETURN false;
      END IF;
    END IF;
  END LOOP;
  RETURN true;
END;
$function$;
-- A run never binds to a singular adapter.  adapter_version is the canonical
-- SHA-256 digest of the complete ordered active adapter code/version set.
CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_active_adapter_version(
  p_class_code text
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(
    extensions.digest(
      COALESCE((
        SELECT pg_catalog.string_agg(
          pg_catalog.concat_ws(':', binding.adapter_code, binding.adapter_version),
          E'\n' ORDER BY binding.adapter_code, binding.adapter_version
        )
        FROM privacy_retention.retention_class_adapter_bindings AS binding
        JOIN privacy_retention.retention_adapter_versions AS version_row
          ON version_row.adapter_code = binding.adapter_code
         AND version_row.adapter_version = binding.adapter_version
         AND version_row.status = 'active'
         AND binding.source_type IS NOT DISTINCT FROM version_row.source_type
         AND binding.mapping_contract_hash IS NOT DISTINCT FROM version_row.contract_hash
        WHERE binding.class_code = p_class_code
          AND binding.status = 'active'
      ), ''),
      'sha256'
    ),
    'hex'
  );
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_active_source_mapping_version(
  p_class_code text
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(
    extensions.digest(
      COALESCE((
        SELECT pg_catalog.string_agg(
          pg_catalog.concat_ws(':', binding.class_code, binding.source_type, binding.mapping_contract_hash),
          E'\n' ORDER BY binding.class_code, binding.source_type, binding.mapping_contract_hash
        )
        FROM privacy_retention.retention_class_adapter_bindings AS binding
        JOIN privacy_retention.retention_adapter_versions AS version_row
          ON version_row.adapter_code = binding.adapter_code
         AND version_row.adapter_version = binding.adapter_version
         AND version_row.status = 'active'
         AND binding.source_type IS NOT DISTINCT FROM version_row.source_type
         AND binding.mapping_contract_hash IS NOT DISTINCT FROM version_row.contract_hash
        WHERE binding.class_code = p_class_code
          AND binding.status = 'active'
      ), ''),
      'sha256'
    ),
    'hex'
  );
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_assert_class_bindings(
  p_class_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_active_count integer;
  v_valid_count integer;
BEGIN
  IF p_class_code IS NULL THEN
    RAISE EXCEPTION 'privacy_retention_class_binding_required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-retention-class:' || p_class_code, 0)
  );
  PERFORM 1
  FROM privacy_retention.retention_class_adapter_bindings AS binding
  WHERE binding.class_code = p_class_code
    AND binding.status = 'active'
  FOR SHARE;

  PERFORM 1
  FROM privacy_retention.retention_adapter_versions AS version_row
  JOIN privacy_retention.retention_class_adapter_bindings AS binding
    ON binding.adapter_code = version_row.adapter_code
   AND binding.adapter_version = version_row.adapter_version
  WHERE binding.class_code = p_class_code
    AND binding.status = 'active'
  FOR SHARE OF version_row;
  SELECT count(*), count(version_row.adapter_code)
  INTO v_active_count, v_valid_count
  FROM privacy_retention.retention_class_adapter_bindings AS binding
  LEFT JOIN privacy_retention.retention_adapter_versions AS version_row
    ON version_row.adapter_code = binding.adapter_code
   AND version_row.adapter_version = binding.adapter_version
   AND version_row.status = 'active'
   AND binding.source_type IS NOT DISTINCT FROM version_row.source_type
   AND binding.mapping_contract_hash IS NOT DISTINCT FROM version_row.contract_hash
   AND version_row.physical_catalog_fingerprint IS NOT DISTINCT FROM
       privacy_retention.g014_retention_catalog_fingerprint(
         version_row.source_relation, version_row.source_identifier_column
       )
  WHERE binding.class_code = p_class_code
    AND binding.status = 'active';

  IF v_active_count = 0 OR v_active_count IS DISTINCT FROM v_valid_count THEN
    RAISE EXCEPTION 'privacy_retention_active_binding_invalid' USING ERRCODE = '55000';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_assert_run_bindings(
  p_class_code text,
  p_adapter_version text,
  p_source_mapping_version text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM privacy_retention.g014_retention_assert_class_bindings(p_class_code);
  IF p_adapter_version IS NULL
     OR p_source_mapping_version IS NULL
     OR p_adapter_version IS DISTINCT FROM
        privacy_retention.g014_retention_active_adapter_version(p_class_code)
     OR p_source_mapping_version IS DISTINCT FROM
        privacy_retention.g014_retention_active_source_mapping_version(p_class_code) THEN
    RAISE EXCEPTION 'privacy_retention_binding_drift' USING ERRCODE = '55000';
  END IF;
END;
$function$;

-- Historic runs are not upgraded to an unverified live binding.  They receive
-- the deterministic current-set digests solely to make the durable columns
-- non-null; any later transition revalidates and fails closed when no approved
-- active binding exists.
UPDATE privacy_retention.privacy_retention_runs AS run_row
SET adapter_version = privacy_retention.g014_retention_active_adapter_version(run_row.class_code),
    source_mapping_version = privacy_retention.g014_retention_active_source_mapping_version(run_row.class_code)
WHERE run_row.adapter_version IS NULL
   OR run_row.source_mapping_version IS NULL;
ALTER TABLE privacy_retention.privacy_retention_runs
  ALTER COLUMN adapter_version SET NOT NULL,
  ALTER COLUMN source_mapping_version SET NOT NULL;
-- Retention-run evidence is governed by a dedicated audit class, never by the
-- data class currently being processed.
CREATE OR REPLACE FUNCTION public.privacy_resolve_audit_retention_until(
  p_class_code text,
  p_now timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_matching_class_count bigint;
  v_retention_period interval;
BEGIN
  IF p_class_code IS NULL
     OR p_class_code NOT IN (
       'privacy_identity_audit',
       'privacy_marketing_audit',
       'privacy_account_deletion_audit',
       'privacy_incident_audit',
       'privacy_retention_run_audit'
     )
     OR p_now IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'privacy_audit_retention_policy_required';
  END IF;

  SELECT count(*), max(retention_period)
  INTO v_matching_class_count, v_retention_period
  FROM privacy_retention.privacy_retention_classes
  WHERE code = p_class_code
    AND status = 'active'
    AND approved_evidence_ref IS NOT NULL
    AND activated_at IS NOT NULL
    AND activated_at <= p_now
    AND version IS NOT NULL
    AND basis_code IS NOT NULL
    AND trigger_type = 'event_occurred'
    AND data_class = p_class_code
    AND retention_period IS NOT NULL
    AND retention_period > interval '0 seconds';

  IF v_matching_class_count <> 1 OR v_retention_period IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'privacy_audit_retention_policy_required';
  END IF;

  RETURN p_now + v_retention_period;
END;
$function$;


CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_append_audit(
  p_run privacy_retention.privacy_retention_runs,
  p_status text,
  p_reason_code text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_audit_id uuid;
  v_occurred_at timestamptz := pg_catalog.clock_timestamp();
  v_retention_until timestamptz;
BEGIN
  v_retention_until := public.privacy_resolve_audit_retention_until(
    'privacy_retention_run_audit',
    v_occurred_at
  );

  INSERT INTO privacy_retention.privacy_audit_events (
    event_type, actor_user_id, operation_id, correlation_id, preview_hash, status,
    reason_code, count_summary, request_metadata, occurred_at, retention_until
  ) VALUES (
    'privacy_retention_run',
    CASE WHEN auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM auth.users AS user_row WHERE user_row.id = auth.uid())
      THEN auth.uid() ELSE NULL END,
    p_run.id,
    p_run.id,
    p_run.preview_hash,
    p_status,
    p_reason_code,
    pg_catalog.jsonb_build_object(
      'requested', p_run.scanned_count,
      'eligible', p_run.planned_count,
      'suppressed', p_run.held_count,
      'created', p_run.separated_count,
      'updated', p_run.storage_deleted_count,
      'failed', p_run.failure_count
    ),
    pg_catalog.jsonb_build_object('route', '/api/internal/privacy-retention'),
    v_occurred_at,
    v_retention_until
  ) RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_reject_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION '% is immutable', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME USING ERRCODE = '55000';
END;
$function$;
CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_approval_payload_hash(
  p_approval_kind text,
  p_class_code text,
  p_adapter_code text,
  p_adapter_version text,
  p_retention_period interval,
  p_mapping_contract_hash text,
  p_approval_ref text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.concat_ws(
        ':', 'g014-retention-approval-v1', p_approval_kind, p_class_code,
        p_adapter_code, p_adapter_version, p_retention_period::text,
        p_mapping_contract_hash, p_approval_ref
      ),
      'sha256'
    ),
    'hex'
  );
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_approval_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.approved_by_principal IS NULL
     OR NEW.approved_by_principal IS DISTINCT FROM session_user::name
     OR NEW.approved_by_principal = ANY (ARRAY[
       'service_role'::name,
       'privacy_retention_operator_approver'::name,
       'privacy_retention_legal_approver'::name,
       'privacy_retention_activation_operator'::name
     ])
     OR NEW.approved_at > pg_catalog.clock_timestamp()
     OR NEW.signed_payload_hash IS DISTINCT FROM
        privacy_retention.g014_retention_approval_payload_hash(
          NEW.approval_kind, NEW.class_code, NEW.adapter_code, NEW.adapter_version,
          NEW.retention_period, NEW.mapping_contract_hash, NEW.approval_ref
        )
     OR (NEW.approval_kind = 'operator' AND current_user IS DISTINCT FROM 'privacy_retention_operator_approver')
     OR (NEW.approval_kind = 'legal' AND current_user IS DISTINCT FROM 'privacy_retention_legal_approver')
     OR NEW.approved_by_role IS DISTINCT FROM current_user::name THEN
    RAISE EXCEPTION 'retention_approval_identity_or_binding_invalid' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_require_activation_operator()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.role() IS NOT DISTINCT FROM 'service_role'
     OR session_user::name = ANY (ARRAY[
       'service_role'::name,
       'privacy_retention_operator_approver'::name,
       'privacy_retention_legal_approver'::name,
       'privacy_retention_activation_operator'::name
     ])
     OR NOT pg_catalog.pg_has_role(session_user, 'privacy_retention_activation_operator', 'member') THEN
    RAISE EXCEPTION 'retention_activation_operator_required' USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_catalog_fingerprint(
  p_source_relation text,
  p_source_identifier_column text
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_relation regclass;
  v_relation_oid oid;
  v_relkind "char";
  v_attnum smallint;
  v_atttypid oid;
  v_atttypmod integer;
  v_attnotnull boolean;
  v_constraint_identity text;
BEGIN
  v_relation := pg_catalog.to_regclass(p_source_relation);
  IF v_relation IS NULL THEN
    RAISE EXCEPTION 'retention_adapter_source_relation_missing' USING ERRCODE = '55000';
  END IF;

  SELECT relation_row.oid, relation_row.relkind, attribute.attnum, attribute.atttypid,
         attribute.atttypmod, attribute.attnotnull,
         (
           SELECT pg_catalog.string_agg(
             pg_catalog.concat_ws(':', constraint_row.oid::text, constraint_row.conname,
               pg_catalog.pg_get_constraintdef(constraint_row.oid, true)),
             E'\n' ORDER BY constraint_row.oid
           )
           FROM pg_catalog.pg_constraint AS constraint_row
           WHERE constraint_row.conrelid = relation_row.oid
             AND constraint_row.contype IN ('p', 'u')
             AND attribute.attnum = ANY (constraint_row.conkey)
         )
  INTO v_relation_oid, v_relkind, v_attnum, v_atttypid, v_atttypmod, v_attnotnull, v_constraint_identity
  FROM pg_catalog.pg_class AS relation_row
  JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = relation_row.oid
   AND attribute.attname = p_source_identifier_column
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
  WHERE relation_row.oid = v_relation;

  IF v_relation_oid IS NULL
     OR v_relkind IS DISTINCT FROM 'r'
     OR v_attnum IS NULL
     OR v_constraint_identity IS NULL THEN
    RAISE EXCEPTION 'retention_adapter_physical_catalog_invalid' USING ERRCODE = '55000';
  END IF;

  RETURN pg_catalog.encode(
    extensions.digest(
      pg_catalog.concat_ws(
        ':', 'g014-retention-catalog-v1', v_relation_oid::text, v_relkind::text,
        v_attnum::text, v_atttypid::regtype::text, v_atttypmod::text,
        v_attnotnull::text, v_constraint_identity
      ),
      'sha256'
    ),
    'hex'
  );
END;
$function$;

DROP TRIGGER IF EXISTS g014_retention_approval_insert_guard ON privacy_retention.retention_adapter_approvals;
CREATE TRIGGER g014_retention_approval_insert_guard
  BEFORE INSERT ON privacy_retention.retention_adapter_approvals
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_retention_approval_insert_guard();
DROP TRIGGER IF EXISTS g014_retention_approval_immutable ON privacy_retention.retention_adapter_approvals;
CREATE TRIGGER g014_retention_approval_immutable
  BEFORE UPDATE OR DELETE ON privacy_retention.retention_adapter_approvals
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_retention_reject_evidence_mutation();
DROP TRIGGER IF EXISTS g014_retention_approval_consumption_immutable ON privacy_retention.retention_adapter_approval_consumptions;
CREATE TRIGGER g014_retention_approval_consumption_immutable
  BEFORE UPDATE OR DELETE ON privacy_retention.retention_adapter_approval_consumptions
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_retention_reject_evidence_mutation();

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_adapter_version_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF OLD.adapter_code IS DISTINCT FROM NEW.adapter_code
     OR OLD.adapter_version IS DISTINCT FROM NEW.adapter_version
     OR OLD.source_relation IS DISTINCT FROM NEW.source_relation
     OR OLD.source_identifier_column IS DISTINCT FROM NEW.source_identifier_column
     OR OLD.source_type IS DISTINCT FROM NEW.source_type
     OR OLD.removal_mode IS DISTINCT FROM NEW.removal_mode
     OR OLD.provider_verifier_ref IS DISTINCT FROM NEW.provider_verifier_ref
     OR OLD.contract_hash IS DISTINCT FROM NEW.contract_hash
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR (
       OLD.physical_catalog_fingerprint IS NOT NULL
       AND OLD.physical_catalog_fingerprint IS DISTINCT FROM NEW.physical_catalog_fingerprint
     ) THEN
    RAISE EXCEPTION 'retention_adapter_version_binding_is_immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'active' AND (
    OLD.operator_approval_ref IS DISTINCT FROM NEW.operator_approval_ref
    OR OLD.legal_approval_ref IS DISTINCT FROM NEW.legal_approval_ref
    OR OLD.activated_at IS DISTINCT FROM NEW.activated_at
    OR OLD.physical_catalog_fingerprint IS DISTINCT FROM NEW.physical_catalog_fingerprint
  ) THEN
    RAISE EXCEPTION 'retention_adapter_activation_evidence_is_immutable' USING ERRCODE = '55000';
  END IF;

  IF NOT (
    (OLD.status = 'disabled' AND NEW.status IN ('draft', 'active'))
    OR (OLD.status = 'draft' AND NEW.status = 'active')
    OR (OLD.status = 'active' AND NEW.status = 'disabled')
  ) THEN
    RAISE EXCEPTION 'retention_adapter_version_predecessor_invalid' USING ERRCODE = '55000';
  END IF;

  IF NEW.status = 'active'
     AND NEW.physical_catalog_fingerprint IS DISTINCT FROM
         privacy_retention.g014_retention_catalog_fingerprint(
           NEW.source_relation, NEW.source_identifier_column
         ) THEN
    RAISE EXCEPTION 'retention_adapter_physical_catalog_drift' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_binding_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-retention-class:' || OLD.class_code, 0)
  );
  IF OLD.class_code IS DISTINCT FROM NEW.class_code
     OR OLD.adapter_code IS DISTINCT FROM NEW.adapter_code
     OR OLD.adapter_version IS DISTINCT FROM NEW.adapter_version
     OR OLD.source_type IS DISTINCT FROM NEW.source_type
     OR OLD.mapping_contract_hash IS DISTINCT FROM NEW.mapping_contract_hash
     OR OLD.operator_approval_ref IS DISTINCT FROM NEW.operator_approval_ref
     OR OLD.legal_approval_ref IS DISTINCT FROM NEW.legal_approval_ref
     OR OLD.activated_at IS DISTINCT FROM NEW.activated_at
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR NOT (OLD.status = 'active' AND NEW.status = 'disabled') THEN
    RAISE EXCEPTION 'retention_adapter_binding_predecessor_invalid' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_storage_claim_binding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_item privacy_retention.privacy_retention_work_items%ROWTYPE;
BEGIN
  SELECT * INTO v_item
  FROM privacy_retention.privacy_retention_work_items AS item
  WHERE item.id = NEW.work_item_id;

  IF NOT FOUND
     OR v_item.source_ref_hash IS DISTINCT FROM NEW.object_locator_hash
     OR v_item.storage_version_hash IS DISTINCT FROM NEW.object_version_hash
     OR NEW.claim_expires_at <= NEW.claimed_at
     OR NEW.claim_hash IS NOT NULL AND NEW.claim_hash IS DISTINCT FROM
        privacy_retention.g014_retention_storage_claim_hash(
          NEW.run_id, NEW.work_item_id, NEW.claim_token,
          NEW.object_locator_hash, NEW.object_version_hash
        ) THEN
    RAISE EXCEPTION 'retention_storage_claim_binding_invalid' USING ERRCODE = '55000';
  END IF;

  NEW.claim_hash := privacy_retention.g014_retention_storage_claim_hash(
    NEW.run_id, NEW.work_item_id, NEW.claim_token,
    NEW.object_locator_hash, NEW.object_version_hash
  );
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_storage_claim_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM privacy_retention.g014_retention_assert_run_bindings(
    run_row.class_code, run_row.adapter_version, run_row.source_mapping_version
  )
  FROM privacy_retention.privacy_retention_runs AS run_row
  WHERE run_row.id = OLD.run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'retention_storage_claim_run_missing' USING ERRCODE = '55000';
  END IF;
  IF OLD.run_id IS DISTINCT FROM NEW.run_id
     OR OLD.work_item_id IS DISTINCT FROM NEW.work_item_id
     OR OLD.adapter_code IS DISTINCT FROM NEW.adapter_code
     OR OLD.adapter_version IS DISTINCT FROM NEW.adapter_version
     OR OLD.claim_token IS DISTINCT FROM NEW.claim_token
     OR OLD.object_locator_hash IS DISTINCT FROM NEW.object_locator_hash
     OR OLD.object_version_hash IS DISTINCT FROM NEW.object_version_hash
     OR OLD.claim_hash IS DISTINCT FROM NEW.claim_hash
     OR OLD.attempt_number IS DISTINCT FROM NEW.attempt_number
     OR OLD.claimed_at IS DISTINCT FROM NEW.claimed_at
     OR OLD.claim_expires_at IS DISTINCT FROM NEW.claim_expires_at
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR NOT (
       (OLD.status = 'active' AND NEW.status IN ('acknowledged', 'failed', 'expired'))
     ) THEN
    RAISE EXCEPTION 'retention_storage_claim_predecessor_invalid' USING ERRCODE = '55000';
  END IF;
  IF NEW.resolved_at IS NULL OR NEW.resolved_at < OLD.claimed_at THEN
    RAISE EXCEPTION 'retention_storage_claim_resolution_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_provider_effect_transition()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF OLD.run_id IS DISTINCT FROM NEW.run_id
     OR OLD.work_item_id IS DISTINCT FROM NEW.work_item_id
     OR OLD.claim_token IS DISTINCT FROM NEW.claim_token
     OR OLD.claim_hash IS DISTINCT FROM NEW.claim_hash
     OR OLD.object_locator_hash IS DISTINCT FROM NEW.object_locator_hash
     OR OLD.object_version_hash IS DISTINCT FROM NEW.object_version_hash
     OR OLD.adapter_version IS DISTINCT FROM NEW.adapter_version
     OR OLD.source_mapping_version IS DISTINCT FROM NEW.source_mapping_version
     OR OLD.provider_verifier_ref IS DISTINCT FROM NEW.provider_verifier_ref
     OR OLD.subject_ref_hash IS DISTINCT FROM NEW.subject_ref_hash
     OR OLD.data_class IS DISTINCT FROM NEW.data_class
     OR OLD.provider_effect_token IS DISTINCT FROM NEW.provider_effect_token
     OR OLD.authorized_at IS DISTINCT FROM NEW.authorized_at
     OR OLD.lease_expires_at IS DISTINCT FROM NEW.lease_expires_at
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR NOT (
       (OLD.effect_state = 'provider_effect_in_flight'
         AND NEW.effect_state IN ('reconciliation_required', 'verified_absent', 'failed'))
       OR (OLD.effect_state = 'reconciliation_required'
         AND NEW.effect_state IN ('verified_absent', 'failed'))
     )
     OR (
       NEW.effect_state = 'reconciliation_required'
       AND (NEW.verified_at IS NOT NULL OR NEW.failure_code IS NOT NULL)
     )
     OR (
       NEW.effect_state IN ('verified_absent', 'failed')
       AND (NEW.verified_at IS NULL OR NEW.verified_at < OLD.authorized_at)
     ) THEN
    RAISE EXCEPTION 'retention_provider_effect_predecessor_invalid' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;


CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_run_transition_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.cutoff IS NULL
     OR NEW.adapter_version IS NULL
     OR NEW.source_mapping_version IS NULL THEN
    RAISE EXCEPTION 'privacy_retention_run_binding_required' USING ERRCODE = '22023';
  END IF;
  PERFORM privacy_retention.g014_retention_assert_run_bindings(
    NEW.class_code, NEW.adapter_version, NEW.source_mapping_version
  );
  IF TG_OP = 'INSERT' THEN
    IF NEW.cutoff > pg_catalog.clock_timestamp() THEN
      RAISE EXCEPTION 'privacy_retention_cutoff_future' USING ERRCODE = '22023';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.class_code IS DISTINCT FROM NEW.class_code
     OR OLD.cutoff IS DISTINCT FROM NEW.cutoff
     OR OLD.preview_hash IS DISTINCT FROM NEW.preview_hash
     OR OLD.preview_expires_at IS DISTINCT FROM NEW.preview_expires_at
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.adapter_version IS DISTINCT FROM NEW.adapter_version
     OR OLD.source_mapping_version IS DISTINCT FROM NEW.source_mapping_version
     OR (OLD.idempotency_key IS NOT NULL AND NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key)
     OR (OLD.storage_receipts_hash IS NOT NULL AND NEW.storage_receipts_hash IS DISTINCT FROM OLD.storage_receipts_hash)
     OR (OLD.database_readback_passed AND NOT NEW.database_readback_passed)
     OR (OLD.storage_readback_passed AND NOT NEW.storage_readback_passed)
     OR (OLD.no_active_hold_mutated AND NOT NEW.no_active_hold_mutated)
     OR (OLD.readback_passed AND NOT NEW.readback_passed) THEN
    RAISE EXCEPTION 'privacy_retention_run_binding_is_immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
    (OLD.status = 'previewed' AND NEW.status IN ('confirmed', 'failed'))
    OR (OLD.status = 'confirmed' AND NEW.status IN ('running', 'failed'))
    OR (OLD.status = 'running' AND NEW.status IN ('completed', 'partial', 'held', 'failed'))
    OR (OLD.status = 'partial' AND NEW.status IN ('running', 'completed', 'held', 'failed'))
    OR (OLD.status = 'held' AND NEW.status IN ('running', 'completed', 'partial', 'failed'))
  ) THEN
    RAISE EXCEPTION 'privacy_retention_run_predecessor_invalid' USING ERRCODE = '55000';
  END IF;

  IF NEW.cutoff > pg_catalog.clock_timestamp()
     OR (NEW.status = 'completed' AND NOT NEW.readback_passed)
     OR (NEW.readback_passed AND NEW.status IS DISTINCT FROM 'completed') THEN
    RAISE EXCEPTION 'privacy_retention_run_state_invalid' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_run_item_transition_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM privacy_retention.g014_retention_assert_run_bindings(
    run_row.class_code, run_row.adapter_version, run_row.source_mapping_version
  )
  FROM privacy_retention.privacy_retention_runs AS run_row
  WHERE run_row.id = NEW.run_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'retention_run_item_run_missing' USING ERRCODE = '55000';
  END IF;
  IF OLD.run_id IS DISTINCT FROM NEW.run_id
     OR OLD.work_item_id IS DISTINCT FROM NEW.work_item_id
     OR OLD.source_type IS DISTINCT FROM NEW.source_type THEN
    RAISE EXCEPTION 'privacy_retention_run_item_binding_is_immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
    (OLD.status = 'planned' AND NEW.status IN ('held', 'separated', 'storage_claimed', 'failed'))
    OR (OLD.status = 'held' AND NEW.status = 'planned')
    OR (OLD.status = 'storage_claimed' AND NEW.status IN ('planned', 'storage_deleted', 'failed', 'held'))
    OR (OLD.status = 'failed' AND NEW.status IN ('planned', 'storage_claimed', 'held'))
  ) THEN
    RAISE EXCEPTION 'privacy_retention_run_item_predecessor_invalid' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_work_item_transition_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run record;
BEGIN
  FOR v_run IN
    SELECT run_row.class_code, run_row.adapter_version, run_row.source_mapping_version
    FROM privacy_retention.privacy_retention_runs AS run_row
    JOIN privacy_retention.privacy_retention_run_items AS run_item
      ON run_item.run_id = run_row.id
    WHERE run_item.work_item_id = NEW.id
    ORDER BY run_row.id
  LOOP
    PERFORM privacy_retention.g014_retention_assert_run_bindings(
      v_run.class_code, v_run.adapter_version, v_run.source_mapping_version
    );
  END LOOP;
  IF OLD.class_code IS DISTINCT FROM NEW.class_code
     OR OLD.data_class IS DISTINCT FROM NEW.data_class
     OR OLD.source_type IS DISTINCT FROM NEW.source_type
     OR OLD.source_ref_hash IS DISTINCT FROM NEW.source_ref_hash
     OR OLD.subject_ref_hash IS DISTINCT FROM NEW.subject_ref_hash
     OR OLD.source_metadata_hash IS DISTINCT FROM NEW.source_metadata_hash
     OR OLD.storage_version_hash IS DISTINCT FROM NEW.storage_version_hash
     OR OLD.trigger_at IS DISTINCT FROM NEW.trigger_at
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'privacy_retention_work_item_binding_is_immutable' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IS DISTINCT FROM NEW.status AND NOT (
    (OLD.status = 'pending' AND NEW.status IN ('claimed', 'separated', 'failed'))
    OR (OLD.status = 'failed' AND NEW.status IN ('pending', 'claimed', 'separated'))
    OR (OLD.status = 'claimed' AND NEW.status IN ('pending', 'purged', 'failed'))
  ) THEN
    RAISE EXCEPTION 'privacy_retention_work_item_predecessor_invalid' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_hold_transition_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'legal_hold_delete_denied' USING ERRCODE = '55000';
  END IF;
  IF OLD.status IS DISTINCT FROM 'active' OR NEW.status IS DISTINCT FROM 'released'
     OR OLD.subject_ref_hash IS DISTINCT FROM NEW.subject_ref_hash
     OR OLD.data_class IS DISTINCT FROM NEW.data_class
     OR OLD.reason_code IS DISTINCT FROM NEW.reason_code
     OR OLD.approved_by IS DISTINCT FROM NEW.approved_by
     OR OLD.approved_evidence_ref IS DISTINCT FROM NEW.approved_evidence_ref
     OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR NEW.released_at IS NULL
     OR NEW.released_at < OLD.created_at THEN
    RAISE EXCEPTION 'legal_hold_transition_invalid' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_hold_subject_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM privacy_retention.g014_retention_lock_subject_hash(NEW.subject_ref_hash);
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1
    FROM privacy_retention.g014_retention_provider_effects AS effect_row
    WHERE effect_row.subject_ref_hash = NEW.subject_ref_hash
      AND effect_row.data_class = NEW.data_class
      AND effect_row.effect_state IN ('provider_effect_in_flight', 'reconciliation_required')
  ) THEN
    RAISE EXCEPTION 'retention_provider_effect_in_flight' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS g014_retention_adapter_registry_immutable ON privacy_retention.retention_adapter_registry;
CREATE TRIGGER g014_retention_adapter_registry_immutable
  BEFORE UPDATE OR DELETE ON privacy_retention.retention_adapter_registry
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_retention_reject_evidence_mutation();
DROP TRIGGER IF EXISTS g014_retention_adapter_version_transition ON privacy_retention.retention_adapter_versions;
CREATE TRIGGER g014_retention_adapter_version_transition
  BEFORE UPDATE ON privacy_retention.retention_adapter_versions
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_retention_adapter_version_transition();
DROP TRIGGER IF EXISTS g014_retention_adapter_version_delete ON privacy_retention.retention_adapter_versions;
CREATE TRIGGER g014_retention_adapter_version_delete
  BEFORE DELETE ON privacy_retention.retention_adapter_versions
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_retention_reject_evidence_mutation();
DROP TRIGGER IF EXISTS g014_retention_binding_transition ON privacy_retention.retention_class_adapter_bindings;
CREATE TRIGGER g014_retention_binding_transition
  BEFORE UPDATE ON privacy_retention.retention_class_adapter_bindings
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_retention_binding_transition();
DROP TRIGGER IF EXISTS g014_retention_binding_delete ON privacy_retention.retention_class_adapter_bindings;
CREATE TRIGGER g014_retention_binding_delete
  BEFORE DELETE ON privacy_retention.retention_class_adapter_bindings
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_retention_reject_evidence_mutation();
DROP TRIGGER IF EXISTS g014_retention_storage_claim_binding ON privacy_retention.g014_retention_storage_claims;
CREATE TRIGGER g014_retention_storage_claim_binding
  BEFORE INSERT ON privacy_retention.g014_retention_storage_claims
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_retention_storage_claim_binding();
DROP TRIGGER IF EXISTS g014_retention_storage_claim_transition ON privacy_retention.g014_retention_storage_claims;
CREATE TRIGGER g014_retention_storage_claim_transition
  BEFORE UPDATE ON privacy_retention.g014_retention_storage_claims
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_retention_storage_claim_transition();
DROP TRIGGER IF EXISTS g014_retention_storage_claim_delete ON privacy_retention.g014_retention_storage_claims;
CREATE TRIGGER g014_retention_storage_claim_delete
  BEFORE DELETE ON privacy_retention.g014_retention_storage_claims
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_retention_reject_evidence_mutation();
DROP TRIGGER IF EXISTS g014_retention_provider_effect_transition ON privacy_retention.g014_retention_provider_effects;
CREATE TRIGGER g014_retention_provider_effect_transition
  BEFORE UPDATE ON privacy_retention.g014_retention_provider_effects
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_retention_provider_effect_transition();
DROP TRIGGER IF EXISTS g014_retention_provider_effect_delete ON privacy_retention.g014_retention_provider_effects;
CREATE TRIGGER g014_retention_provider_effect_delete
  BEFORE DELETE ON privacy_retention.g014_retention_provider_effects
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_retention_reject_evidence_mutation();
DROP TRIGGER IF EXISTS g014_retention_receipts_immutable ON privacy_retention.g014_retention_receipts;
CREATE TRIGGER g014_retention_receipts_immutable
  BEFORE UPDATE OR DELETE ON privacy_retention.g014_retention_receipts
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_retention_reject_evidence_mutation();
DROP TRIGGER IF EXISTS g014_retention_run_transition_guard ON privacy_retention.privacy_retention_runs;
CREATE TRIGGER g014_retention_run_transition_guard
  BEFORE INSERT OR UPDATE ON privacy_retention.privacy_retention_runs
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_retention_run_transition_guard();
DROP TRIGGER IF EXISTS g014_retention_run_item_transition_guard ON privacy_retention.privacy_retention_run_items;
CREATE TRIGGER g014_retention_run_item_transition_guard
  BEFORE UPDATE ON privacy_retention.privacy_retention_run_items
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_retention_run_item_transition_guard();
DROP TRIGGER IF EXISTS g014_retention_work_item_transition_guard ON privacy_retention.privacy_retention_work_items;
CREATE TRIGGER g014_retention_work_item_transition_guard
  BEFORE UPDATE ON privacy_retention.privacy_retention_work_items
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_retention_work_item_transition_guard();
DROP TRIGGER IF EXISTS privacy_legal_holds_history ON privacy_retention.privacy_legal_holds;
CREATE TRIGGER privacy_legal_holds_history
  BEFORE UPDATE OR DELETE ON privacy_retention.privacy_legal_holds
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_retention_hold_transition_guard();
DROP TRIGGER IF EXISTS g014_retention_hold_subject_lock ON privacy_retention.privacy_legal_holds;
CREATE TRIGGER g014_retention_hold_subject_lock
  BEFORE INSERT OR UPDATE ON privacy_retention.privacy_legal_holds
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_retention_hold_subject_lock();

INSERT INTO privacy_retention.privacy_retention_classes (code, status)
VALUES
  ('notifications_operational', 'disabled'),
  ('privacy_retention_run_audit', 'disabled')
ON CONFLICT (code) DO NOTHING;

INSERT INTO privacy_retention.retention_adapter_registry (adapter_code, source_type, removal_mode)
VALUES
  ('notification_adapter', 'notification', 'delete'),
  ('approved_audit_record_adapter', 'approved_audit_record', 'unsupported'),
  ('ocr_metadata_adapter', 'ocr_metadata', 'delete'),
  ('ocr_artifact_adapter', 'ocr_artifact', 'external_delete'),
  ('access_log_adapter', 'access_log', 'delete'),
  ('deleted_account_residue_adapter', 'deleted_account_residue', 'unsupported')
ON CONFLICT (adapter_code) DO NOTHING;

INSERT INTO privacy_retention.retention_adapter_versions (
  adapter_code, adapter_version, source_relation, source_identifier_column,
  source_type, removal_mode, provider_verifier_ref, contract_hash
)
SELECT
  seed.adapter_code,
  seed.adapter_version,
  seed.source_relation,
  seed.source_identifier_column,
  seed.source_type,
  seed.removal_mode,
  seed.provider_verifier_ref,
  privacy_retention.g014_retention_adapter_contract_hash(
    seed.adapter_code, seed.adapter_version, seed.source_relation,
    seed.source_identifier_column, seed.source_type, seed.removal_mode,
    seed.provider_verifier_ref
  )
FROM (VALUES
  ('notification_adapter', 'g014-notification-v1', 'public.notifications', 'id', 'notification', 'delete', NULL::text),
  ('approved_audit_record_adapter', 'g014-approved-audit-v1', 'privacy_retention.privacy_audit_events', 'id', 'approved_audit_record', 'unsupported', NULL::text),
  ('ocr_metadata_adapter', 'g014-ocr-metadata-v1', 'public.ocr_logs', 'id', 'ocr_metadata', 'delete', NULL::text),
  ('ocr_artifact_adapter', 'g014-ocr-artifact-v1', 'storage.objects', 'id', 'ocr_artifact', 'external_delete', 'g014.storage.v1'),
  ('access_log_adapter', 'g014-access-log-v1', 'public.access_logs', 'id', 'access_log', 'delete', NULL::text),
  ('deleted_account_residue_adapter', 'g014-deleted-account-residue-v1', 'privacy_retention.privacy_retention_work_items', 'id', 'deleted_account_residue', 'unsupported', NULL::text)
) AS seed(adapter_code, adapter_version, source_relation, source_identifier_column, source_type, removal_mode, provider_verifier_ref)
ON CONFLICT (adapter_code, adapter_version) DO NOTHING;

CREATE OR REPLACE FUNCTION public.activate_privacy_retention_adapter(
  p_class_code text,
  p_adapter_code text,
  p_adapter_version text,
  p_data_class text,
  p_basis_code text,
  p_trigger_type text,
  p_retention_period interval,
  p_class_version text,
  p_operator_approval_ref text,
  p_legal_approval_ref text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_adapter privacy_retention.retention_adapter_registry%ROWTYPE;
  v_version privacy_retention.retention_adapter_versions%ROWTYPE;
  v_class privacy_retention.privacy_retention_classes%ROWTYPE;
  v_relation regclass;
  v_identifier_type regtype;
  v_binding privacy_retention.retention_class_adapter_bindings%ROWTYPE;
  v_operator_approval privacy_retention.retention_adapter_approvals%ROWTYPE;
  v_legal_approval privacy_retention.retention_adapter_approvals%ROWTYPE;
  v_consumption privacy_retention.retention_adapter_approval_consumptions%ROWTYPE;
  v_physical_catalog_fingerprint text;
  v_activation_principal name := session_user::name;
BEGIN
  PERFORM privacy_retention.g014_retention_require_activation_operator();
  IF p_class_code IS NULL OR p_adapter_code IS NULL OR p_adapter_version IS NULL
     OR p_data_class IS NULL OR p_basis_code IS NULL OR p_trigger_type IS NULL
     OR p_retention_period IS NULL OR p_retention_period <= interval '0 seconds'
     OR p_class_version IS NULL OR p_operator_approval_ref IS NULL OR p_legal_approval_ref IS NULL
     OR p_operator_approval_ref !~ '^[A-Za-z0-9._:-]{8,128}$'
     OR p_legal_approval_ref !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
    RAISE EXCEPTION 'retention_adapter_activation_arguments_invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-retention-class:' || p_class_code, 0)
  );
  SELECT * INTO v_adapter
  FROM privacy_retention.retention_adapter_registry
  WHERE adapter_code = p_adapter_code;
  SELECT * INTO v_version
  FROM privacy_retention.retention_adapter_versions
  WHERE adapter_code = p_adapter_code AND adapter_version = p_adapter_version
  FOR UPDATE;
  IF NOT FOUND
     OR v_adapter.source_type IS DISTINCT FROM v_version.source_type
     OR v_adapter.removal_mode IS DISTINCT FROM v_version.removal_mode
     OR v_version.removal_mode = 'unsupported'
     OR v_version.contract_hash IS DISTINCT FROM privacy_retention.g014_retention_adapter_contract_hash(
       v_version.adapter_code, v_version.adapter_version, v_version.source_relation,
       v_version.source_identifier_column, v_version.source_type, v_version.removal_mode,
       v_version.provider_verifier_ref
     ) THEN
    RAISE EXCEPTION 'retention_adapter_contract_invalid' USING ERRCODE = '55000';
  END IF;

  v_relation := pg_catalog.to_regclass(v_version.source_relation);
  IF v_relation IS NULL THEN
    RAISE EXCEPTION 'retention_adapter_source_relation_missing' USING ERRCODE = '55000';
  END IF;
  SELECT attribute.atttypid::regtype INTO v_identifier_type
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = v_relation
    AND attribute.attname = v_version.source_identifier_column
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;
  IF v_identifier_type IS NULL OR v_identifier_type NOT IN ('uuid'::regtype, 'text'::regtype) THEN
    RAISE EXCEPTION 'retention_adapter_source_identifier_invalid' USING ERRCODE = '55000';
  END IF;
  v_physical_catalog_fingerprint :=
    privacy_retention.g014_retention_catalog_fingerprint(
      v_version.source_relation, v_version.source_identifier_column
    );

  SELECT * INTO v_class
  FROM privacy_retention.privacy_retention_classes
  WHERE code = p_class_code
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'retention_class_preapproval_required' USING ERRCODE = '55000';
  ELSIF v_class.status = 'active' THEN
    IF v_class.data_class IS DISTINCT FROM p_data_class
       OR v_class.basis_code IS DISTINCT FROM p_basis_code
       OR v_class.trigger_type IS DISTINCT FROM p_trigger_type
       OR v_class.retention_period IS DISTINCT FROM p_retention_period
       OR v_class.version IS DISTINCT FROM p_class_version THEN
      RAISE EXCEPTION 'retention_class_active_version_mismatch' USING ERRCODE = '55000';
    END IF;
  ELSE
    UPDATE privacy_retention.privacy_retention_classes
    SET data_class = p_data_class,
        basis_code = p_basis_code,
        trigger_type = p_trigger_type,
        retention_period = p_retention_period,
        status = 'active',
        approved_evidence_ref = p_legal_approval_ref,
        version = p_class_version
    WHERE code = p_class_code;
  END IF;
  SELECT * INTO v_operator_approval
  FROM privacy_retention.retention_adapter_approvals AS approval_row
  WHERE approval_row.approval_kind = 'operator'
    AND approval_row.class_code = p_class_code
    AND approval_row.adapter_code = p_adapter_code
    AND approval_row.adapter_version = p_adapter_version
    AND approval_row.retention_period = p_retention_period
    AND approval_row.mapping_contract_hash = v_version.contract_hash
    AND approval_row.approval_ref = p_operator_approval_ref
    AND approval_row.signed_payload_hash IS NOT DISTINCT FROM
        privacy_retention.g014_retention_approval_payload_hash(
          'operator', p_class_code, p_adapter_code, p_adapter_version,
          p_retention_period, v_version.contract_hash, p_operator_approval_ref
        )
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'retention_operator_approval_exact_match_required' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_legal_approval
  FROM privacy_retention.retention_adapter_approvals AS approval_row
  WHERE approval_row.approval_kind = 'legal'
    AND approval_row.class_code = p_class_code
    AND approval_row.adapter_code = p_adapter_code
    AND approval_row.adapter_version = p_adapter_version
    AND approval_row.retention_period = p_retention_period
    AND approval_row.mapping_contract_hash = v_version.contract_hash
    AND approval_row.approval_ref = p_legal_approval_ref
    AND approval_row.signed_payload_hash IS NOT DISTINCT FROM
        privacy_retention.g014_retention_approval_payload_hash(
          'legal', p_class_code, p_adapter_code, p_adapter_version,
          p_retention_period, v_version.contract_hash, p_legal_approval_ref
        )
  FOR UPDATE;
  IF NOT FOUND
     OR v_operator_approval.id IS NOT DISTINCT FROM v_legal_approval.id
     OR v_operator_approval.approved_by_principal IS NULL
     OR v_legal_approval.approved_by_principal IS NULL
     OR v_activation_principal IS NULL
     OR v_operator_approval.approved_by_principal IS NOT DISTINCT FROM v_legal_approval.approved_by_principal
     OR v_activation_principal IS NOT DISTINCT FROM v_operator_approval.approved_by_principal
     OR v_activation_principal IS NOT DISTINCT FROM v_legal_approval.approved_by_principal THEN
    RAISE EXCEPTION 'retention_approval_principal_separation_required' USING ERRCODE = '55000';
  END IF;

  IF v_version.status = 'disabled' OR v_version.status = 'draft' THEN
    UPDATE privacy_retention.retention_adapter_versions
    SET status = 'active',
        operator_approval_ref = p_operator_approval_ref,
        legal_approval_ref = p_legal_approval_ref,
        activated_at = pg_catalog.clock_timestamp(),
        physical_catalog_fingerprint = v_physical_catalog_fingerprint
    WHERE adapter_code = p_adapter_code AND adapter_version = p_adapter_version;
  ELSIF v_version.status = 'active' AND (
    v_version.operator_approval_ref IS DISTINCT FROM p_operator_approval_ref
    OR v_version.legal_approval_ref IS DISTINCT FROM p_legal_approval_ref
    OR v_version.physical_catalog_fingerprint IS DISTINCT FROM v_physical_catalog_fingerprint
  ) THEN
    RAISE EXCEPTION 'retention_adapter_approval_replay_mismatch' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_consumption
  FROM privacy_retention.retention_adapter_approval_consumptions AS consumption
  WHERE consumption.class_code = p_class_code
    AND consumption.adapter_code = p_adapter_code
    AND consumption.adapter_version = p_adapter_version
  FOR UPDATE;
  IF FOUND THEN
    IF v_consumption.operator_approval_id IS DISTINCT FROM v_operator_approval.id
       OR v_consumption.legal_approval_id IS DISTINCT FROM v_legal_approval.id
       OR v_consumption.retention_period IS DISTINCT FROM p_retention_period
       OR v_consumption.mapping_contract_hash IS DISTINCT FROM v_version.contract_hash
       OR v_consumption.consumed_by_principal IS DISTINCT FROM v_activation_principal THEN
      RAISE EXCEPTION 'retention_approval_consumption_replay_mismatch' USING ERRCODE = '55000';
    END IF;
  ELSE
    INSERT INTO privacy_retention.retention_adapter_approval_consumptions (
      operator_approval_id, legal_approval_id, class_code, adapter_code,
      adapter_version, retention_period, mapping_contract_hash, consumed_by_role,
      consumed_by_principal
    ) VALUES (
      v_operator_approval.id, v_legal_approval.id, p_class_code, p_adapter_code,
      p_adapter_version, p_retention_period, v_version.contract_hash,
      'privacy_retention_activation_operator'::name, v_activation_principal
    );
  END IF;
  SELECT * INTO v_binding
  FROM privacy_retention.retention_class_adapter_bindings
  WHERE class_code = p_class_code
    AND source_type = v_version.source_type
    AND status = 'active'
  FOR UPDATE;
  IF FOUND AND (
    v_binding.adapter_code IS DISTINCT FROM p_adapter_code
    OR v_binding.adapter_version IS DISTINCT FROM p_adapter_version
    OR v_binding.mapping_contract_hash IS DISTINCT FROM v_version.contract_hash
    OR v_binding.operator_approval_ref IS DISTINCT FROM p_operator_approval_ref
    OR v_binding.legal_approval_ref IS DISTINCT FROM p_legal_approval_ref
  ) THEN
    RAISE EXCEPTION 'retention_class_source_mapping_already_active' USING ERRCODE = '55000';
  ELSIF NOT FOUND THEN
    INSERT INTO privacy_retention.retention_class_adapter_bindings (
      class_code, adapter_code, adapter_version, source_type, mapping_contract_hash,
      operator_approval_ref, legal_approval_ref
    ) VALUES (
      p_class_code, p_adapter_code, p_adapter_version, v_version.source_type,
      v_version.contract_hash, p_operator_approval_ref, p_legal_approval_ref
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'classCode', p_class_code,
    'adapterCode', p_adapter_code,
    'adapterCodeVersion', p_adapter_version,
    'adapterVersion', privacy_retention.g014_retention_active_adapter_version(p_class_code),
    'sourceMappingVersion', privacy_retention.g014_retention_active_source_mapping_version(p_class_code),
    'status', 'active'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_privacy_retention_run(
  p_class_code text,
  p_as_of timestamptz,
  p_batch_size integer,
  p_max_duration_ms integer DEFAULT 10000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_class privacy_retention.privacy_retention_classes%ROWTYPE;
  v_run privacy_retention.privacy_retention_runs%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_preview_hash text;
  v_adapter_version text;
  v_source_mapping_version text;
  v_planned_count integer := 0;
  v_held_count integer := 0;
BEGIN
  PERFORM privacy_retention.g014_retention_require_service_role();
  IF p_as_of IS NULL OR p_as_of > v_now
     OR p_batch_size IS NULL
     OR p_batch_size NOT BETWEEN 1 AND 100
     OR p_max_duration_ms IS NULL
     OR p_max_duration_ms NOT BETWEEN 1000 AND 10000 THEN
    RAISE EXCEPTION 'privacy_retention_batch_cutoff_or_timeout_invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.set_config('statement_timeout', p_max_duration_ms::text, true);

  SELECT * INTO v_class
  FROM privacy_retention.privacy_retention_classes
  WHERE code = p_class_code AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'privacy_retention_class_adapter_not_active' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_retention_assert_class_bindings(p_class_code);
  v_adapter_version := privacy_retention.g014_retention_active_adapter_version(p_class_code);
  v_source_mapping_version := privacy_retention.g014_retention_active_source_mapping_version(p_class_code);

  v_preview_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.concat_ws(
        ':', 'g014-retention-preview-v1', p_class_code, p_as_of::text,
        p_batch_size::text, v_class.version, v_adapter_version, v_source_mapping_version
      ),
      'sha256'
    ),
    'hex'
  );

  INSERT INTO privacy_retention.privacy_retention_runs (
    class_code, cutoff, status, preview_hash, preview_expires_at,
    adapter_version, source_mapping_version
  ) VALUES (
    p_class_code, p_as_of, 'previewed', v_preview_hash, v_now + interval '15 minutes',
    v_adapter_version, v_source_mapping_version
  ) RETURNING * INTO v_run;

  WITH candidates AS (
    SELECT item.id, item.source_type,
           privacy_retention.g014_retention_active_hold_exists(item.subject_ref_hash, item.data_class, v_now) AS held
    FROM privacy_retention.privacy_retention_work_items AS item
    JOIN privacy_retention.retention_class_adapter_bindings AS binding
      ON binding.class_code = item.class_code
     AND binding.source_type = item.source_type
     AND binding.status = 'active'
    JOIN privacy_retention.retention_adapter_versions AS version_row
      ON version_row.adapter_code = binding.adapter_code
     AND version_row.adapter_version = binding.adapter_version
     AND version_row.status = 'active'
     AND binding.mapping_contract_hash IS NOT DISTINCT FROM version_row.contract_hash
    WHERE item.class_code = p_class_code
      AND item.data_class = v_class.data_class
      AND item.trigger_at <= p_as_of
      AND item.status IN ('pending', 'failed')
    ORDER BY item.trigger_at, item.id
    LIMIT p_batch_size
  ), inserted AS (
    INSERT INTO privacy_retention.privacy_retention_run_items (run_id, work_item_id, source_type, status)
    SELECT v_run.id, id, source_type, CASE WHEN held THEN 'held' ELSE 'planned' END
    FROM candidates
    RETURNING status
  )
  SELECT count(*) FILTER (WHERE status = 'planned'), count(*) FILTER (WHERE status = 'held')
  INTO v_planned_count, v_held_count
  FROM inserted;

  UPDATE privacy_retention.privacy_retention_runs
  SET scanned_count = v_planned_count + v_held_count,
      planned_count = v_planned_count,
      held_count = v_held_count
  WHERE id = v_run.id
  RETURNING * INTO v_run;

  UPDATE privacy_retention.privacy_retention_runs
  SET audit_id = privacy_retention.g014_retention_append_audit(v_run, 'previewed', 'RETENTION_PREVIEW')
  WHERE id = v_run.id
  RETURNING * INTO v_run;

  RETURN pg_catalog.jsonb_build_object(
    'operationId', v_run.id,
    'previewHash', v_run.preview_hash,
    'expiresAt', v_run.preview_expires_at,
    'adapterVersion', v_run.adapter_version,
    'sourceMappingVersion', v_run.source_mapping_version,
    'summary', pg_catalog.jsonb_build_object(
      'cutoff', v_run.cutoff,
      'eligible', v_run.planned_count,
      'held', v_run.held_count,
      'scanned', v_run.scanned_count
    ),
    'requiredConfirmation', '보존·분리 적용'
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.confirm_privacy_retention_run(
  p_run_id uuid,
  p_preview_hash text,
  p_confirmation_text text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run privacy_retention.privacy_retention_runs%ROWTYPE;
BEGIN
  PERFORM privacy_retention.g014_retention_require_service_role();
  IF p_run_id IS NULL OR p_preview_hash IS NULL
     OR p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
     OR p_confirmation_text IS DISTINCT FROM '보존·분리 적용' THEN
    RAISE EXCEPTION 'privacy_retention_confirmation_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run FROM privacy_retention.privacy_retention_runs
  WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.preview_hash IS DISTINCT FROM p_preview_hash THEN
    RAISE EXCEPTION 'privacy_retention_confirmation_binding_invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM privacy_retention.g014_retention_assert_run_bindings(
    v_run.class_code, v_run.adapter_version, v_run.source_mapping_version
  );
  IF v_run.status IS DISTINCT FROM 'previewed' THEN
    IF v_run.idempotency_key IS NOT DISTINCT FROM p_idempotency_key THEN
      RETURN pg_catalog.jsonb_build_object(
        'operationId', v_run.id,
        'status', CASE
          WHEN v_run.status = 'completed' THEN 'applied'
          WHEN v_run.status = 'running' THEN 'partial'
          ELSE v_run.status
        END,
        'adapterVersion', v_run.adapter_version,
        'sourceMappingVersion', v_run.source_mapping_version
      );
    END IF;
    RAISE EXCEPTION 'privacy_retention_confirmation_predecessor_invalid' USING ERRCODE = '55000';
  END IF;
  IF v_run.preview_expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'privacy_retention_preview_expired' USING ERRCODE = '55000';
  END IF;

  UPDATE privacy_retention.privacy_retention_runs
  SET status = 'confirmed', idempotency_key = p_idempotency_key
  WHERE id = v_run.id
  RETURNING * INTO v_run;
  UPDATE privacy_retention.privacy_retention_runs
  SET audit_id = privacy_retention.g014_retention_append_audit(v_run, 'confirmed', 'RETENTION_CONFIRMED')
  WHERE id = v_run.id;

  RETURN pg_catalog.jsonb_build_object(
    'operationId', v_run.id,
    'status', 'confirmed',
    'adapterVersion', v_run.adapter_version,
    'sourceMappingVersion', v_run.source_mapping_version
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_privacy_retention_run(
  p_run_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_max_duration_ms integer DEFAULT 10000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run privacy_retention.privacy_retention_runs%ROWTYPE;
  v_item record;
  v_deleted integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_separated integer := 0;
  v_held integer := 0;
  v_failed integer := 0;
  v_audit_id uuid;
BEGIN
  PERFORM privacy_retention.g014_retention_require_service_role();
  IF p_max_duration_ms IS NULL OR p_max_duration_ms NOT BETWEEN 1000 AND 10000 THEN
    RAISE EXCEPTION 'privacy_retention_timeout_invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.set_config('statement_timeout', p_max_duration_ms::text, true);

  SELECT * INTO v_run FROM privacy_retention.privacy_retention_runs
  WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_run.idempotency_key IS DISTINCT FROM p_idempotency_key THEN
    RAISE EXCEPTION 'privacy_retention_apply_binding_invalid' USING ERRCODE = '22023';
  END IF;
  IF v_run.status NOT IN ('confirmed', 'running', 'partial', 'held') THEN
    RAISE EXCEPTION 'privacy_retention_apply_predecessor_invalid' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_retention_assert_run_bindings(
    v_run.class_code, v_run.adapter_version, v_run.source_mapping_version
  );

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-retention-run:' || v_run.id::text, 0)
  );
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_retention_run_items AS run_item
    LEFT JOIN privacy_retention.retention_class_adapter_bindings AS binding
      ON binding.class_code = v_run.class_code
     AND binding.source_type = run_item.source_type
     AND binding.status = 'active'
    LEFT JOIN privacy_retention.retention_adapter_versions AS version_row
      ON version_row.adapter_code = binding.adapter_code
     AND version_row.adapter_version = binding.adapter_version
     AND version_row.status = 'active'
     AND binding.mapping_contract_hash IS NOT DISTINCT FROM version_row.contract_hash
    WHERE run_item.run_id = v_run.id AND version_row.adapter_code IS NULL
  ) THEN
    RAISE EXCEPTION 'privacy_retention_run_adapter_not_active' USING ERRCODE = '55000';
  END IF;

  UPDATE privacy_retention.privacy_retention_runs
  SET status = 'running', started_at = COALESCE(started_at, v_now)
  WHERE id = v_run.id;

  UPDATE privacy_retention.privacy_retention_run_items AS run_item
  SET status = 'held', error_code = NULL
  FROM privacy_retention.privacy_retention_work_items AS item
  WHERE run_item.run_id = v_run.id
    AND run_item.work_item_id = item.id
    AND run_item.status IN ('planned', 'failed')
    AND privacy_retention.g014_retention_active_hold_exists(item.subject_ref_hash, item.data_class, v_now);
  GET DIAGNOSTICS v_held = ROW_COUNT;

  FOR v_item IN
    SELECT run_item.work_item_id, item.source_ref_hash, item.subject_ref_hash, item.data_class,
           item.class_code, binding.adapter_code, binding.adapter_version,
           version_row.source_relation, version_row.source_identifier_column,
           version_row.removal_mode
    FROM privacy_retention.privacy_retention_run_items AS run_item
    JOIN privacy_retention.privacy_retention_work_items AS item ON item.id = run_item.work_item_id
    JOIN privacy_retention.retention_class_adapter_bindings AS binding
      ON binding.class_code = item.class_code
     AND binding.source_type = item.source_type
     AND binding.status = 'active'
    JOIN privacy_retention.retention_adapter_versions AS version_row
      ON version_row.adapter_code = binding.adapter_code
     AND version_row.adapter_version = binding.adapter_version
     AND version_row.status = 'active'
     AND binding.mapping_contract_hash IS NOT DISTINCT FROM version_row.contract_hash
    WHERE run_item.run_id = v_run.id
      AND run_item.status = 'planned'
      AND item.status IN ('pending', 'failed')
      AND item.source_type NOT IN ('storage_object', 'ocr_artifact')
    ORDER BY item.trigger_at, item.id
    FOR UPDATE OF run_item, item SKIP LOCKED
  LOOP
    PERFORM privacy_retention.g014_retention_lock_subject_hash(v_item.subject_ref_hash);
    IF privacy_retention.g014_retention_active_hold_exists(v_item.subject_ref_hash, v_item.data_class, v_now) THEN
      UPDATE privacy_retention.privacy_retention_run_items
      SET status = 'held', error_code = NULL
      WHERE run_id = v_run.id AND work_item_id = v_item.work_item_id;
      v_held := v_held + 1;
      CONTINUE;
    END IF;

    IF v_item.removal_mode IS DISTINCT FROM 'delete' THEN
      UPDATE privacy_retention.privacy_retention_work_items
      SET status = 'failed', last_error_code = 'retention_adapter_removal_unsupported'
      WHERE id = v_item.work_item_id;
      UPDATE privacy_retention.privacy_retention_run_items
      SET status = 'failed', error_code = 'retention_adapter_removal_unsupported'
      WHERE run_id = v_run.id AND work_item_id = v_item.work_item_id;
      v_failed := v_failed + 1;
      CONTINUE;
    END IF;

    INSERT INTO privacy_retention.privacy_retained_records (
      work_item_id, class_code, data_class, subject_ref_hash, source_ref_hash,
      source_metadata_hash, retained_at, expires_at
    )
    SELECT item.id, item.class_code, item.data_class, item.subject_ref_hash,
           item.source_ref_hash, item.source_metadata_hash, v_now,
           item.trigger_at + class_row.retention_period
    FROM privacy_retention.privacy_retention_work_items AS item
    JOIN privacy_retention.privacy_retention_classes AS class_row ON class_row.code = item.class_code
    WHERE item.id = v_item.work_item_id
      AND class_row.status = 'active'
    ON CONFLICT (work_item_id) DO NOTHING;

    EXECUTE pg_catalog.format(
      'DELETE FROM %s WHERE privacy_retention.g014_retention_source_hash($1, %I::text) = $2',
      v_item.source_relation::regclass,
      v_item.source_identifier_column
    ) USING v_item.adapter_code, v_item.source_ref_hash;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    IF v_deleted = 1 AND privacy_retention.g014_retention_source_absent(
      v_item.adapter_code, v_item.source_relation, v_item.source_identifier_column, v_item.source_ref_hash
    ) THEN
      INSERT INTO privacy_retention.g014_retention_receipts (
        run_id, work_item_id, adapter_code, adapter_version, receipt_kind,
        source_ref_hash, source_absence_hash
      ) VALUES (
        v_run.id, v_item.work_item_id, v_item.adapter_code, v_item.adapter_version,
        'database_source_absence', v_item.source_ref_hash,
        privacy_retention.g014_retention_database_absence_hash(
          v_item.adapter_code, v_item.adapter_version, v_item.source_ref_hash
        )
      ) ON CONFLICT DO NOTHING;
      UPDATE privacy_retention.privacy_retention_work_items
      SET status = 'separated', last_error_code = NULL
      WHERE id = v_item.work_item_id;
      UPDATE privacy_retention.privacy_retention_run_items
      SET status = 'separated', error_code = NULL
      WHERE run_id = v_run.id AND work_item_id = v_item.work_item_id;
      v_separated := v_separated + 1;
    ELSE
      UPDATE privacy_retention.privacy_retention_work_items
      SET status = 'failed', last_error_code = 'retention_source_absence_not_proven'
      WHERE id = v_item.work_item_id;
      UPDATE privacy_retention.privacy_retention_run_items
      SET status = 'failed', error_code = 'retention_source_absence_not_proven'
      WHERE run_id = v_run.id AND work_item_id = v_item.work_item_id;
      v_failed := v_failed + 1;
    END IF;
  END LOOP;

  UPDATE privacy_retention.privacy_retention_run_items AS run_item
  SET status = 'failed', error_code = 'retention_source_busy'
  FROM privacy_retention.privacy_retention_work_items AS item
  WHERE run_item.run_id = v_run.id
    AND run_item.work_item_id = item.id
    AND run_item.status = 'planned'
    AND item.source_type NOT IN ('storage_object', 'ocr_artifact');

  UPDATE privacy_retention.privacy_retention_runs AS current_run
  SET separated_count = (
        SELECT count(*) FROM privacy_retention.privacy_retention_run_items
        WHERE run_id = current_run.id AND status = 'separated'
      ),
      held_count = (
        SELECT count(*) FROM privacy_retention.privacy_retention_run_items
        WHERE run_id = current_run.id AND status = 'held'
      ),
      failure_count = (
        SELECT count(*) FROM privacy_retention.privacy_retention_run_items
        WHERE run_id = current_run.id AND status = 'failed'
      ),
      no_active_hold_mutated =
        privacy_retention.g014_retention_no_active_hold_mutated(current_run.id)
  WHERE current_run.id = v_run.id
  RETURNING * INTO v_run;

  v_audit_id := privacy_retention.g014_retention_append_audit(v_run, 'applied', 'RETENTION_DATABASE_APPLY');
  UPDATE privacy_retention.privacy_retention_runs SET audit_id = v_audit_id WHERE id = v_run.id;

  RETURN pg_catalog.jsonb_build_object(
    'operationId', v_run.id,
    'status', 'partial',
    'readback', pg_catalog.jsonb_build_object(
      'passed', false,
      'checks', pg_catalog.jsonb_build_object(
        'expectedCountMatched', false,
        'databaseSourceAbsent', false,
        'storageProviderAbsent', false,
        'noActiveHoldMutated', v_run.no_active_hold_mutated
      )
    ),
    'auditId', v_audit_id,
    'adapterVersion', v_run.adapter_version,
    'sourceMappingVersion', v_run.source_mapping_version,
    'errorCode', NULL
  );
END;
$function$;

DROP FUNCTION IF EXISTS public.ack_privacy_retention_storage_items(uuid, text, text, uuid[], boolean);
DROP FUNCTION IF EXISTS public.claim_privacy_retention_storage_items(uuid, text, text, integer);

CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_claim_storage_items_internal(
  p_run_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_limit integer
)
RETURNS TABLE (
  work_item_id uuid,
  claim_token uuid,
  object_locator_hash text,
  object_version_hash text,
  claim_hash text,
  adapter_version text,
  source_mapping_version text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run privacy_retention.privacy_retention_runs%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM privacy_retention.g014_retention_require_service_role();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'privacy_retention_storage_limit_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_run FROM privacy_retention.privacy_retention_runs
  WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_run.idempotency_key IS DISTINCT FROM p_idempotency_key
     OR v_run.status NOT IN ('running', 'partial', 'held') THEN
    RAISE EXCEPTION 'privacy_retention_storage_claim_binding_invalid' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_retention_assert_run_bindings(
    v_run.class_code, v_run.adapter_version, v_run.source_mapping_version
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-retention-run:' || v_run.id::text, 0)
  );

  UPDATE privacy_retention.g014_retention_storage_claims AS claim_row
  SET status = 'expired', resolved_at = v_now
  WHERE claim_row.run_id = v_run.id
    AND claim_row.status = 'active'
    AND claim_row.claim_expires_at <= v_now
    AND NOT EXISTS (
      SELECT 1
      FROM privacy_retention.g014_retention_provider_effects AS effect_row
      WHERE effect_row.claim_token = claim_row.claim_token
    );
  UPDATE privacy_retention.privacy_retention_work_items AS item
  SET status = 'failed', storage_claim_token = NULL, storage_claimed_at = NULL,
      last_error_code = 'retention_storage_claim_expired'
  FROM privacy_retention.g014_retention_storage_claims AS claim_row
  WHERE claim_row.run_id = v_run.id
    AND claim_row.status = 'expired'
    AND item.id = claim_row.work_item_id
    AND item.status = 'claimed'
    AND item.storage_claim_token IS NOT DISTINCT FROM claim_row.claim_token;
  UPDATE privacy_retention.privacy_retention_run_items AS run_item
  SET status = 'failed', error_code = 'retention_storage_claim_expired'
  FROM privacy_retention.g014_retention_storage_claims AS claim_row
  WHERE claim_row.run_id = v_run.id
    AND claim_row.status = 'expired'
    AND run_item.run_id = v_run.id
    AND run_item.work_item_id = claim_row.work_item_id
    AND run_item.status = 'storage_claimed';
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.g014_retention_storage_claims AS claim_row
    WHERE claim_row.run_id = v_run.id
      AND claim_row.status = 'active'
  ) THEN
    RAISE EXCEPTION 'retention_storage_claim_batch_pending' USING ERRCODE = '55000';
  END IF;

  RETURN QUERY
  WITH candidates AS (
    SELECT run_item.work_item_id, item.source_ref_hash, item.storage_version_hash,
           item.subject_ref_hash, item.data_class,
           binding.adapter_code, binding.adapter_version,
           COALESCE((
             SELECT max(previous.attempt_number)
             FROM privacy_retention.g014_retention_storage_claims AS previous
             WHERE previous.run_id = v_run.id AND previous.work_item_id = run_item.work_item_id
           ), 0) + 1 AS attempt_number
    FROM privacy_retention.privacy_retention_run_items AS run_item
    JOIN privacy_retention.privacy_retention_work_items AS item ON item.id = run_item.work_item_id
    JOIN privacy_retention.retention_class_adapter_bindings AS binding
      ON binding.class_code = item.class_code
     AND binding.source_type = item.source_type
     AND binding.status = 'active'
    JOIN privacy_retention.retention_adapter_versions AS version_row
      ON version_row.adapter_code = binding.adapter_code
     AND version_row.adapter_version = binding.adapter_version
     AND version_row.status = 'active'
     AND version_row.removal_mode = 'external_delete'
     AND binding.mapping_contract_hash IS NOT DISTINCT FROM version_row.contract_hash
    WHERE run_item.run_id = v_run.id
      AND run_item.status IN ('planned', 'failed')
      AND item.status IN ('pending', 'failed')
      AND item.source_type IN ('storage_object', 'ocr_artifact')
      AND item.storage_version_hash IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM privacy_retention.g014_retention_provider_effects AS effect_row
        WHERE effect_row.work_item_id = run_item.work_item_id
      )
    ORDER BY item.subject_ref_hash NULLS FIRST, item.trigger_at, item.id
    LIMIT p_limit
    FOR UPDATE OF run_item, item SKIP LOCKED
  ), locked AS MATERIALIZED (
    SELECT candidates.*,
           privacy_retention.g014_retention_lock_subject_hash(candidates.subject_ref_hash) AS subject_lock
    FROM candidates
    ORDER BY candidates.subject_ref_hash NULLS FIRST, candidates.work_item_id
  ), eligible AS (
    SELECT locked.*
    FROM locked
    WHERE NOT privacy_retention.g014_retention_active_hold_exists(
      locked.subject_ref_hash, locked.data_class, v_now
    )
  ), selected AS (
    SELECT eligible.*
    FROM eligible
    WHERE (adapter_code, adapter_version) = (
      SELECT adapter_code, adapter_version
      FROM eligible
      ORDER BY work_item_id
      LIMIT 1
    )
  ), inserted AS (
    INSERT INTO privacy_retention.g014_retention_storage_claims (
      run_id, work_item_id, adapter_code, adapter_version, object_locator_hash,
      object_version_hash, claim_hash, attempt_number, claim_expires_at
    )
    SELECT v_run.id, work_item_id, adapter_code, adapter_version, source_ref_hash,
           storage_version_hash, NULL, attempt_number, v_now + interval '5 minutes'
    FROM selected
    WHERE attempt_number <= 3
    RETURNING work_item_id, claim_token, object_locator_hash, object_version_hash, claim_hash
  ), claimed AS (
    UPDATE privacy_retention.privacy_retention_work_items AS item
    SET status = 'claimed', storage_claim_token = inserted.claim_token,
        storage_claimed_at = v_now, last_error_code = NULL
    FROM inserted
    WHERE item.id = inserted.work_item_id
    RETURNING item.id
  ), marked AS (
    UPDATE privacy_retention.privacy_retention_run_items AS run_item
    SET status = 'storage_claimed', error_code = NULL
    FROM claimed
    WHERE run_item.run_id = v_run.id AND run_item.work_item_id = claimed.id
    RETURNING run_item.work_item_id
  )
  SELECT inserted.work_item_id, inserted.claim_token, inserted.object_locator_hash,
         inserted.object_version_hash, inserted.claim_hash,
         v_run.adapter_version, v_run.source_mapping_version
  FROM inserted
  JOIN marked ON marked.work_item_id = inserted.work_item_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_privacy_retention_storage_items(
  p_run_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_claims jsonb;
BEGIN
  PERFORM privacy_retention.g014_retention_require_service_role();
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'privacy_retention_storage_limit_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'workItemId', claim_row.work_item_id,
        'claimToken', claim_row.claim_token,
        'objectLocatorHash', claim_row.object_locator_hash,
        'objectVersionHash', claim_row.object_version_hash,
        'claimHash', claim_row.claim_hash,
        'adapterVersion', claim_row.adapter_version,
        'sourceMappingVersion', claim_row.source_mapping_version
      )
      ORDER BY claim_row.work_item_id
    ),
    '[]'::jsonb
  ) INTO v_claims
  FROM privacy_retention.g014_retention_claim_storage_items_internal(
    p_run_id, p_preview_hash, p_idempotency_key, p_limit
  ) AS claim_row;

  RETURN v_claims;
END;
$function$;
-- Hash-only claims are non-delete evidence. This is the only RPC which can
-- consume a claim and disclose its bounded provider locator to the private
-- service-role worker immediately before the provider call.
CREATE OR REPLACE FUNCTION public.resolve_privacy_retention_provider_effect(
  p_run_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_work_item_id uuid,
  p_claim_token uuid,
  p_claim_hash text,
  p_object_locator_hash text,
  p_object_version_hash text,
  p_adapter_version text,
  p_source_mapping_version text,
  p_provider_verifier_ref text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run privacy_retention.privacy_retention_runs%ROWTYPE;
  v_claim privacy_retention.g014_retention_storage_claims%ROWTYPE;
  v_item privacy_retention.privacy_retention_work_items%ROWTYPE;
  v_storage_object storage.objects%ROWTYPE;
  v_storage_version text;
  v_effect privacy_retention.g014_retention_provider_effects%ROWTYPE;
  v_verifier_ref text;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM privacy_retention.g014_retention_require_service_role();
  IF p_run_id IS NULL OR p_work_item_id IS NULL OR p_claim_token IS NULL
     OR p_preview_hash !~ '^[0-9a-f]{64}$'
     OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
     OR p_claim_hash !~ '^[0-9a-f]{64}$'
     OR p_object_locator_hash !~ '^[0-9a-f]{64}$'
     OR p_object_version_hash !~ '^[0-9a-f]{64}$'
     OR p_adapter_version !~ '^[0-9a-f]{64}$'
     OR p_source_mapping_version !~ '^[0-9a-f]{64}$'
     OR p_provider_verifier_ref !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
    RAISE EXCEPTION 'retention_provider_effect_arguments_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run
  FROM privacy_retention.privacy_retention_runs
  WHERE id = p_run_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_run.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_run.idempotency_key IS DISTINCT FROM p_idempotency_key
     OR v_run.adapter_version IS DISTINCT FROM p_adapter_version
     OR v_run.source_mapping_version IS DISTINCT FROM p_source_mapping_version
     OR v_run.status NOT IN ('running', 'partial', 'held') THEN
    RAISE EXCEPTION 'retention_provider_effect_binding_invalid' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_retention_assert_run_bindings(
    v_run.class_code, v_run.adapter_version, v_run.source_mapping_version
  );

  SELECT * INTO v_claim
  FROM privacy_retention.g014_retention_storage_claims
  WHERE run_id = v_run.id
    AND work_item_id = p_work_item_id
    AND claim_token = p_claim_token
  FOR UPDATE;
  IF NOT FOUND
     OR v_claim.status IS DISTINCT FROM 'active'
     OR v_claim.claim_expires_at <= v_now
     OR v_claim.claim_hash IS DISTINCT FROM p_claim_hash
     OR v_claim.object_locator_hash IS DISTINCT FROM p_object_locator_hash
     OR v_claim.object_version_hash IS DISTINCT FROM p_object_version_hash THEN
    RAISE EXCEPTION 'retention_provider_effect_claim_invalid' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_item
  FROM privacy_retention.privacy_retention_work_items
  WHERE id = v_claim.work_item_id
  FOR UPDATE;
  SELECT version_row.provider_verifier_ref INTO v_verifier_ref
  FROM privacy_retention.retention_adapter_versions AS version_row
  WHERE version_row.adapter_code = v_claim.adapter_code
    AND version_row.adapter_version = v_claim.adapter_version
    AND version_row.status = 'active'
    AND version_row.removal_mode = 'external_delete';
  IF NOT FOUND
     OR v_item.source_ref_hash IS DISTINCT FROM v_claim.object_locator_hash
     OR v_item.storage_version_hash IS DISTINCT FROM v_claim.object_version_hash
     OR v_verifier_ref IS DISTINCT FROM p_provider_verifier_ref THEN
    RAISE EXCEPTION 'retention_provider_effect_locator_invalid' USING ERRCODE = '55000';
  END IF;

  PERFORM privacy_retention.g014_retention_lock_subject_hash(v_item.subject_ref_hash);
  IF privacy_retention.g014_retention_active_hold_exists(
       v_item.subject_ref_hash, v_item.data_class, pg_catalog.clock_timestamp()
     ) THEN
    UPDATE privacy_retention.g014_retention_storage_claims
    SET status = 'failed', resolved_at = v_now
    WHERE id = v_claim.id AND status = 'active';
    UPDATE privacy_retention.privacy_retention_work_items
    SET status = 'failed', storage_claim_token = NULL, storage_claimed_at = NULL,
        last_error_code = 'retention_legal_hold_active'
    WHERE id = v_item.id
      AND status = 'claimed'
      AND storage_claim_token IS NOT DISTINCT FROM v_claim.claim_token;
    UPDATE privacy_retention.privacy_retention_run_items
    SET status = 'held', error_code = NULL
    WHERE run_id = v_run.id
      AND work_item_id = v_item.id
      AND status = 'storage_claimed';
    RETURN NULL;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.g014_retention_provider_effects AS effect_row
    WHERE effect_row.claim_token = v_claim.claim_token
  ) THEN
    RAISE EXCEPTION 'retention_provider_effect_already_consumed' USING ERRCODE = '55000';
  END IF;
  SELECT object_row.* INTO v_storage_object
  FROM storage.objects AS object_row
  WHERE privacy_retention.g014_retention_storage_locator_hash(
          object_row.bucket_id::text, object_row.name::text
        ) = v_claim.object_locator_hash
  FOR UPDATE OF object_row;
  v_storage_version := pg_catalog.to_jsonb(v_storage_object) ->> 'version';
  IF NOT FOUND
     OR v_storage_object.id IS NULL
     OR v_storage_object.bucket_id::text !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,62}$'
     OR pg_catalog.length(v_storage_object.name::text) NOT BETWEEN 1 AND 1024
     OR v_storage_object.name::text !~ '^[A-Za-z0-9][A-Za-z0-9._/:-]*$'
     OR pg_catalog.length(v_storage_version) NOT BETWEEN 1 AND 256
     OR v_storage_version !~ '^[A-Za-z0-9._:-]+$'
     OR pg_catalog.encode(
          extensions.digest(v_storage_version, 'sha256'),
          'hex'
        ) IS DISTINCT FROM v_claim.object_version_hash THEN
    RAISE EXCEPTION 'retention_provider_effect_authoritative_locator_invalid'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO privacy_retention.g014_retention_provider_effects (
    run_id, work_item_id, claim_token, claim_hash, object_locator_hash,
    object_version_hash, adapter_version, source_mapping_version,
    provider_verifier_ref, subject_ref_hash, data_class, lease_expires_at
  ) VALUES (
    v_run.id, v_claim.work_item_id, v_claim.claim_token, v_claim.claim_hash,
    v_claim.object_locator_hash, v_claim.object_version_hash,
    v_run.adapter_version, v_run.source_mapping_version,
    v_verifier_ref, v_item.subject_ref_hash, v_item.data_class,
    v_now + interval '45 seconds'
  )
  RETURNING * INTO v_effect;

  RETURN pg_catalog.jsonb_build_object(
    'workItemId', v_claim.work_item_id,
    'claimToken', v_claim.claim_token,
    'claimHash', v_claim.claim_hash,
    'objectLocatorHash', v_claim.object_locator_hash,
    'objectVersionHash', v_claim.object_version_hash,
    'adapterVersion', v_run.adapter_version,
    'sourceMappingVersion', v_run.source_mapping_version,
    'providerEffectToken', v_effect.provider_effect_token,
    'providerVerifierRef', v_effect.provider_verifier_ref,
    'leaseExpiresAt', v_effect.lease_expires_at,
    'bucketName', v_storage_object.bucket_id::text,
    'objectName', v_storage_object.name::text
  );
END;
$function$;

-- Reconciliation deliberately returns no locator. A consumed effect is
-- verifier-only forever, including after the short egress lease expires.
CREATE OR REPLACE FUNCTION public.get_privacy_retention_provider_reconciliation_work(
  p_run_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_provider_verifier_ref text,
  p_limit integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run privacy_retention.privacy_retention_runs%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_work jsonb;
BEGIN
  PERFORM privacy_retention.g014_retention_require_service_role();
  IF p_run_id IS NULL
     OR p_preview_hash !~ '^[0-9a-f]{64}$'
     OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
     OR p_provider_verifier_ref !~ '^[A-Za-z0-9._:-]{8,128}$'
     OR p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'retention_provider_reconciliation_arguments_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_run
  FROM privacy_retention.privacy_retention_runs
  WHERE id = p_run_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_run.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_run.idempotency_key IS DISTINCT FROM p_idempotency_key
     OR v_run.status NOT IN ('running', 'partial', 'held') THEN
    RAISE EXCEPTION 'retention_provider_reconciliation_binding_invalid' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_retention_assert_run_bindings(
    v_run.class_code, v_run.adapter_version, v_run.source_mapping_version
  );

  UPDATE privacy_retention.g014_retention_provider_effects AS effect_row
  SET effect_state = 'reconciliation_required'
  WHERE effect_row.run_id = v_run.id
    AND effect_row.effect_state = 'provider_effect_in_flight'
    AND effect_row.lease_expires_at <= v_now;

  IF EXISTS (
    SELECT 1
    FROM privacy_retention.g014_retention_provider_effects AS effect_row
    WHERE effect_row.run_id = v_run.id
      AND effect_row.effect_state IN ('provider_effect_in_flight', 'reconciliation_required')
      AND effect_row.provider_verifier_ref IS DISTINCT FROM p_provider_verifier_ref
  ) THEN
    RAISE EXCEPTION 'retention_provider_reconciliation_verifier_invalid' USING ERRCODE = '55000';
  END IF;

  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'workItemId', effect_row.work_item_id,
        'claimToken', effect_row.claim_token,
        'claimHash', effect_row.claim_hash,
        'objectLocatorHash', effect_row.object_locator_hash,
        'objectVersionHash', effect_row.object_version_hash,
        'adapterVersion', effect_row.adapter_version,
        'sourceMappingVersion', effect_row.source_mapping_version,
        'providerEffectToken', effect_row.provider_effect_token,
        'providerVerifierRef', effect_row.provider_verifier_ref,
        'workMode', 'verify_absence_only'
      )
      ORDER BY effect_row.authorized_at, effect_row.work_item_id
    ),
    '[]'::jsonb
  ) INTO v_work
  FROM (
    SELECT *
    FROM privacy_retention.g014_retention_provider_effects
    WHERE run_id = v_run.id
      AND effect_state IN ('provider_effect_in_flight', 'reconciliation_required')
      AND provider_verifier_ref = p_provider_verifier_ref
    ORDER BY authorized_at, work_item_id
    LIMIT p_limit
  ) AS effect_row;

  RETURN v_work;
END;
$function$;
CREATE OR REPLACE FUNCTION public.record_privacy_retention_storage_provider_receipts(
  p_run_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_receipts jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run privacy_retention.privacy_retention_runs%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_submitted_count integer;
  v_active_count integer;
  v_accepted_count integer;
  v_subject record;
  v_receipts_normalized jsonb;
BEGIN
  PERFORM privacy_retention.g014_retention_require_service_role();
  IF p_receipts IS NULL OR pg_catalog.jsonb_typeof(p_receipts) IS DISTINCT FROM 'array'
     OR pg_catalog.jsonb_array_length(p_receipts) IS NULL
     OR pg_catalog.jsonb_array_length(p_receipts) NOT BETWEEN 1 AND 100
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.jsonb_array_elements(p_receipts) AS element(value)
       WHERE pg_catalog.jsonb_typeof(value) IS DISTINCT FROM 'object'
          OR pg_catalog.jsonb_object_length(value) IS DISTINCT FROM 10
          OR value - ARRAY[
            'workItemId', 'claimToken', 'objectLocatorHash', 'objectVersionHash',
            'claimHash', 'providerEffectToken', 'providerReceiptRef',
            'providerReceiptHash', 'providerAbsenceHash', 'verifierRef'
          ] IS DISTINCT FROM '{}'::jsonb
          OR (value ->> 'workItemId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          OR (value ->> 'claimToken') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          OR (value ->> 'providerEffectToken') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          OR pg_catalog.jsonb_typeof(value -> 'objectLocatorHash') IS DISTINCT FROM 'string'
          OR (value ->> 'objectLocatorHash') IS NULL
          OR (value ->> 'objectLocatorHash') !~ '^[0-9a-f]{64}$'
          OR (value ->> 'objectVersionHash') !~ '^[0-9a-f]{64}$'
          OR (value ->> 'claimHash') !~ '^[0-9a-f]{64}$'
          OR (value ->> 'providerReceiptRef') !~ '^[A-Za-z0-9._:-]{8,255}[A-Za-z0-9._:-]?$'
          OR (value ->> 'providerReceiptHash') !~ '^[0-9a-f]{64}$'
          OR (value ->> 'providerAbsenceHash') !~ '^[0-9a-f]{64}$'
          OR (value ->> 'verifierRef') !~ '^[A-Za-z0-9._:-]{8,128}$'
     ) THEN
    RAISE EXCEPTION 'retention_storage_receipt_shape_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'work_item_id', value ->> 'workItemId',
      'claim_token', value ->> 'claimToken',
      'object_locator_hash', value ->> 'objectLocatorHash',
      'object_version_hash', value ->> 'objectVersionHash',
      'claim_hash', value ->> 'claimHash',
      'provider_effect_token', value ->> 'providerEffectToken',
      'provider_receipt_ref', value ->> 'providerReceiptRef',
      'provider_receipt_hash', value ->> 'providerReceiptHash',
      'provider_absence_hash', value ->> 'providerAbsenceHash',
      'verifier_ref', value ->> 'verifierRef'
    )
  ) INTO v_receipts_normalized
  FROM pg_catalog.jsonb_array_elements(p_receipts) AS element(value);

  SELECT * INTO v_run FROM privacy_retention.privacy_retention_runs
  WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_run.idempotency_key IS DISTINCT FROM p_idempotency_key
     OR v_run.status NOT IN ('running', 'partial', 'held') THEN
    RAISE EXCEPTION 'retention_storage_receipt_binding_invalid' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_retention_assert_run_bindings(
    v_run.class_code, v_run.adapter_version, v_run.source_mapping_version
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-retention-run:' || v_run.id::text, 0)
  );
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.g014_retention_storage_claims AS claim_row
    WHERE claim_row.run_id = v_run.id
      AND claim_row.status = 'active'
      AND claim_row.claim_expires_at <= v_now
      AND NOT EXISTS (
        SELECT 1
        FROM privacy_retention.g014_retention_provider_effects AS effect_row
        WHERE effect_row.claim_token = claim_row.claim_token
      )
  ) THEN
    RAISE EXCEPTION 'retention_storage_claim_expired' USING ERRCODE = '55000';
  END IF;

  WITH submitted AS (
    SELECT receipt.work_item_id, receipt.claim_token, receipt.object_locator_hash,
           receipt.object_version_hash, receipt.claim_hash, receipt.provider_effect_token
    FROM pg_catalog.jsonb_to_recordset(v_receipts_normalized) AS receipt(
      work_item_id uuid, claim_token uuid, object_locator_hash text, object_version_hash text,
      claim_hash text, provider_effect_token uuid, provider_receipt_ref text,
      provider_receipt_hash text, provider_absence_hash text, verifier_ref text
    )
  ), active AS (
    SELECT claim_row.work_item_id, claim_row.claim_token, claim_row.object_locator_hash,
           claim_row.object_version_hash, claim_row.claim_hash, effect_row.provider_effect_token
    FROM privacy_retention.g014_retention_storage_claims AS claim_row
    JOIN privacy_retention.g014_retention_provider_effects AS effect_row
      ON effect_row.claim_token = claim_row.claim_token
    WHERE claim_row.run_id = v_run.id
      AND claim_row.status = 'active'
      AND effect_row.effect_state IN ('provider_effect_in_flight', 'reconciliation_required')
  )
  SELECT (SELECT count(*) FROM submitted), (SELECT count(*) FROM active)
  INTO v_submitted_count, v_active_count;

  IF v_submitted_count IS DISTINCT FROM v_active_count
     OR EXISTS (
       WITH submitted AS (
         SELECT receipt.work_item_id, receipt.claim_token, receipt.object_locator_hash,
                receipt.object_version_hash, receipt.claim_hash, receipt.provider_effect_token
         FROM pg_catalog.jsonb_to_recordset(v_receipts_normalized) AS receipt(
           work_item_id uuid, claim_token uuid, object_locator_hash text, object_version_hash text,
           claim_hash text, provider_effect_token uuid, provider_receipt_ref text,
           provider_receipt_hash text, provider_absence_hash text, verifier_ref text
         )
       ), active AS (
         SELECT claim_row.work_item_id, claim_row.claim_token, claim_row.object_locator_hash,
                claim_row.object_version_hash, claim_row.claim_hash, effect_row.provider_effect_token
         FROM privacy_retention.g014_retention_storage_claims AS claim_row
         JOIN privacy_retention.g014_retention_provider_effects AS effect_row
           ON effect_row.claim_token = claim_row.claim_token
         WHERE claim_row.run_id = v_run.id
           AND claim_row.status = 'active'
           AND effect_row.effect_state IN ('provider_effect_in_flight', 'reconciliation_required')
       )
       SELECT 1 FROM (
         (SELECT * FROM submitted EXCEPT SELECT * FROM active)
         UNION ALL
         (SELECT * FROM active EXCEPT SELECT * FROM submitted)
       ) AS mismatch
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.jsonb_to_recordset(v_receipts_normalized) AS receipt(
         work_item_id uuid, claim_token uuid, object_locator_hash text, object_version_hash text,
         claim_hash text, provider_effect_token uuid, provider_receipt_ref text,
         provider_receipt_hash text, provider_absence_hash text, verifier_ref text
       )
       JOIN privacy_retention.g014_retention_storage_claims AS claim_row
         ON claim_row.run_id = v_run.id
        AND claim_row.work_item_id = receipt.work_item_id
        AND claim_row.claim_token = receipt.claim_token
       JOIN privacy_retention.g014_retention_provider_effects AS effect_row
         ON effect_row.claim_token = claim_row.claim_token
        AND effect_row.provider_effect_token = receipt.provider_effect_token
       JOIN privacy_retention.retention_adapter_versions AS version_row
         ON version_row.adapter_code = claim_row.adapter_code
        AND version_row.adapter_version = claim_row.adapter_version
       WHERE receipt.verifier_ref IS DISTINCT FROM version_row.provider_verifier_ref
          OR receipt.verifier_ref IS DISTINCT FROM effect_row.provider_verifier_ref
          OR effect_row.effect_state NOT IN ('provider_effect_in_flight', 'reconciliation_required')
     ) THEN
    RAISE EXCEPTION 'retention_storage_receipt_claim_set_invalid' USING ERRCODE = '55000';
  END IF;

  FOR v_subject IN
    SELECT DISTINCT item.subject_ref_hash, item.data_class
    FROM privacy_retention.g014_retention_storage_claims AS claim_row
    JOIN privacy_retention.privacy_retention_work_items AS item
      ON item.id = claim_row.work_item_id
    JOIN privacy_retention.g014_retention_provider_effects AS effect_row
      ON effect_row.claim_token = claim_row.claim_token
    WHERE claim_row.run_id = v_run.id
      AND claim_row.status = 'active'
      AND effect_row.effect_state IN ('provider_effect_in_flight', 'reconciliation_required')
    ORDER BY item.subject_ref_hash NULLS FIRST, item.data_class
  LOOP
    PERFORM privacy_retention.g014_retention_lock_subject_hash(v_subject.subject_ref_hash);
  END LOOP;

  WITH held_claims AS (
    SELECT claim_row.id, claim_row.work_item_id, claim_row.claim_token
    FROM privacy_retention.g014_retention_storage_claims AS claim_row
    JOIN privacy_retention.privacy_retention_work_items AS item
      ON item.id = claim_row.work_item_id
    WHERE claim_row.run_id = v_run.id
      AND claim_row.status = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM privacy_retention.g014_retention_provider_effects AS effect_row
        WHERE effect_row.claim_token = claim_row.claim_token
      )
      AND privacy_retention.g014_retention_active_hold_exists(
        item.subject_ref_hash, item.data_class, pg_catalog.clock_timestamp()
      )
  ), failed_claims AS (
    UPDATE privacy_retention.g014_retention_storage_claims AS claim_row
    SET status = 'failed', resolved_at = v_now
    FROM held_claims
    WHERE claim_row.id = held_claims.id
    RETURNING claim_row.work_item_id, claim_row.claim_token
  ), failed_items AS (
    UPDATE privacy_retention.privacy_retention_work_items AS item
    SET status = 'failed', storage_claim_token = NULL, storage_claimed_at = NULL,
        last_error_code = 'retention_legal_hold_active'
    FROM failed_claims
    WHERE item.id = failed_claims.work_item_id
      AND item.status = 'claimed'
      AND item.storage_claim_token IS NOT DISTINCT FROM failed_claims.claim_token
    RETURNING item.id
  )
  UPDATE privacy_retention.privacy_retention_run_items AS run_item
  SET status = 'held', error_code = NULL
  FROM failed_claims
  WHERE run_item.run_id = v_run.id
    AND run_item.work_item_id = failed_claims.work_item_id
    AND run_item.status = 'storage_claimed';

  SELECT count(*) INTO v_accepted_count
  FROM privacy_retention.g014_retention_storage_claims AS claim_row
  JOIN privacy_retention.g014_retention_provider_effects AS effect_row
    ON effect_row.claim_token = claim_row.claim_token
  WHERE claim_row.run_id = v_run.id
    AND claim_row.status = 'active'
    AND effect_row.effect_state IN ('provider_effect_in_flight', 'reconciliation_required');

  INSERT INTO privacy_retention.g014_retention_receipts (
    run_id, work_item_id, adapter_code, adapter_version, receipt_kind, source_ref_hash,
    claim_token, claim_hash, object_version_hash, provider_effect_token,
    provider_receipt_ref, provider_receipt_hash, provider_absence_hash, verifier_ref
  )
  SELECT v_run.id, claim_row.work_item_id, claim_row.adapter_code, claim_row.adapter_version,
         'storage_provider_absence', claim_row.object_locator_hash, claim_row.claim_token,
         claim_row.claim_hash, claim_row.object_version_hash, effect_row.provider_effect_token,
         receipt.provider_receipt_ref, receipt.provider_receipt_hash,
         receipt.provider_absence_hash, receipt.verifier_ref
  FROM pg_catalog.jsonb_to_recordset(v_receipts_normalized) AS receipt(
    work_item_id uuid, claim_token uuid, object_locator_hash text, object_version_hash text,
    claim_hash text, provider_effect_token uuid, provider_receipt_ref text,
    provider_receipt_hash text, provider_absence_hash text, verifier_ref text
  )
  JOIN privacy_retention.g014_retention_storage_claims AS claim_row
    ON claim_row.run_id = v_run.id
   AND claim_row.work_item_id = receipt.work_item_id
   AND claim_row.claim_token = receipt.claim_token
   AND claim_row.status = 'active'
  JOIN privacy_retention.g014_retention_provider_effects AS effect_row
    ON effect_row.claim_token = claim_row.claim_token
   AND effect_row.provider_effect_token = receipt.provider_effect_token
   AND effect_row.effect_state IN ('provider_effect_in_flight', 'reconciliation_required')
  ON CONFLICT DO NOTHING;

  UPDATE privacy_retention.g014_retention_provider_effects AS effect_row
  SET effect_state = 'verified_absent', verified_at = v_now
  FROM pg_catalog.jsonb_to_recordset(v_receipts_normalized) AS receipt(
    work_item_id uuid, claim_token uuid, object_locator_hash text, object_version_hash text,
    claim_hash text, provider_effect_token uuid, provider_receipt_ref text,
    provider_receipt_hash text, provider_absence_hash text, verifier_ref text
  )
  WHERE effect_row.run_id = v_run.id
    AND effect_row.work_item_id = receipt.work_item_id
    AND effect_row.claim_token = receipt.claim_token
    AND effect_row.provider_effect_token = receipt.provider_effect_token
    AND effect_row.effect_state IN ('provider_effect_in_flight', 'reconciliation_required');

  UPDATE privacy_retention.g014_retention_storage_claims AS claim_row
  SET status = 'acknowledged', resolved_at = v_now
  FROM privacy_retention.g014_retention_provider_effects AS effect_row
  WHERE claim_row.run_id = v_run.id
    AND claim_row.status = 'active'
    AND effect_row.claim_token = claim_row.claim_token
    AND effect_row.effect_state = 'verified_absent';

  UPDATE privacy_retention.privacy_retention_work_items AS item
  SET status = 'purged', storage_claim_token = NULL, storage_claimed_at = NULL, last_error_code = NULL
  FROM privacy_retention.g014_retention_storage_claims AS claim_row
  JOIN privacy_retention.g014_retention_provider_effects AS effect_row
    ON effect_row.claim_token = claim_row.claim_token
   AND effect_row.effect_state = 'verified_absent'
  WHERE claim_row.run_id = v_run.id
    AND claim_row.status = 'acknowledged'
    AND item.id = claim_row.work_item_id
    AND item.status = 'claimed'
    AND item.storage_claim_token IS NOT DISTINCT FROM claim_row.claim_token;

  UPDATE privacy_retention.privacy_retention_run_items AS run_item
  SET status = 'storage_deleted', error_code = NULL
  FROM privacy_retention.g014_retention_storage_claims AS claim_row
  JOIN privacy_retention.g014_retention_provider_effects AS effect_row
    ON effect_row.claim_token = claim_row.claim_token
   AND effect_row.effect_state = 'verified_absent'
  WHERE claim_row.run_id = v_run.id
    AND claim_row.status = 'acknowledged'
    AND run_item.run_id = v_run.id
    AND run_item.work_item_id = claim_row.work_item_id
    AND run_item.status = 'storage_claimed';


  RETURN pg_catalog.jsonb_build_object(
    'operationId', v_run.id,
    'acceptedCount', v_accepted_count,
    'adapterVersion', v_run.adapter_version,
    'sourceMappingVersion', v_run.source_mapping_version
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_privacy_retention_storage_claims(
  p_run_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_claim_tokens uuid[],
  p_failure_code text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run privacy_retention.privacy_retention_runs%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_expected integer;
  v_affected integer;
BEGIN
  PERFORM privacy_retention.g014_retention_require_service_role();
  IF cardinality(p_claim_tokens) IS NULL OR cardinality(p_claim_tokens) NOT BETWEEN 1 AND 100
     OR p_failure_code IS NULL OR p_failure_code !~ '^[a-z][a-z0-9_]{2,79}$'
     OR cardinality(ARRAY(SELECT DISTINCT unnest(p_claim_tokens))) IS DISTINCT FROM cardinality(p_claim_tokens) THEN
    RAISE EXCEPTION 'retention_storage_failure_arguments_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_run FROM privacy_retention.privacy_retention_runs
  WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_run.idempotency_key IS DISTINCT FROM p_idempotency_key
     OR v_run.status NOT IN ('running', 'partial', 'held') THEN
    RAISE EXCEPTION 'retention_storage_failure_binding_invalid' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_retention_assert_run_bindings(
    v_run.class_code, v_run.adapter_version, v_run.source_mapping_version
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-retention-run:' || v_run.id::text, 0)
  );
  SELECT count(*) INTO v_expected
  FROM privacy_retention.g014_retention_storage_claims AS claim_row
  WHERE claim_row.run_id = v_run.id
    AND claim_row.claim_token = ANY (p_claim_tokens)
    AND claim_row.status = 'active'
    AND claim_row.claim_expires_at > v_now
    AND NOT EXISTS (
      SELECT 1
      FROM privacy_retention.g014_retention_provider_effects AS effect_row
      WHERE effect_row.claim_token = claim_row.claim_token
    );
  IF v_expected IS DISTINCT FROM cardinality(p_claim_tokens) THEN
    RAISE EXCEPTION 'retention_storage_failure_claim_set_invalid' USING ERRCODE = '55000';
  END IF;

  INSERT INTO privacy_retention.g014_retention_receipts (
    run_id, work_item_id, adapter_code, adapter_version, receipt_kind, source_ref_hash,
    claim_token, claim_hash, object_version_hash, failure_code
  )
  SELECT claim_row.run_id, claim_row.work_item_id, claim_row.adapter_code, claim_row.adapter_version,
         'storage_provider_failure', claim_row.object_locator_hash, claim_row.claim_token,
         claim_row.claim_hash, claim_row.object_version_hash, p_failure_code
  FROM privacy_retention.g014_retention_storage_claims AS claim_row
  WHERE claim_row.run_id = v_run.id AND claim_row.claim_token = ANY (p_claim_tokens)
    AND claim_row.status = 'active'
    AND NOT EXISTS (
      SELECT 1
      FROM privacy_retention.g014_retention_provider_effects AS effect_row
      WHERE effect_row.claim_token = claim_row.claim_token
    );

  UPDATE privacy_retention.g014_retention_storage_claims AS claim_row
  SET status = 'failed', resolved_at = v_now
  WHERE claim_row.run_id = v_run.id
    AND claim_row.claim_token = ANY (p_claim_tokens)
    AND claim_row.status = 'active'
    AND NOT EXISTS (
      SELECT 1
      FROM privacy_retention.g014_retention_provider_effects AS effect_row
      WHERE effect_row.claim_token = claim_row.claim_token
    );
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  UPDATE privacy_retention.privacy_retention_work_items AS item
  SET status = 'failed', storage_claim_token = NULL, storage_claimed_at = NULL,
      last_error_code = p_failure_code
  FROM privacy_retention.g014_retention_storage_claims AS claim_row
  WHERE claim_row.run_id = v_run.id AND claim_row.claim_token = ANY (p_claim_tokens)
    AND claim_row.status = 'failed' AND item.id = claim_row.work_item_id
    AND item.status = 'claimed' AND item.storage_claim_token IS NOT DISTINCT FROM claim_row.claim_token;
  UPDATE privacy_retention.privacy_retention_run_items AS run_item
  SET status = 'failed', error_code = p_failure_code
  FROM privacy_retention.g014_retention_storage_claims AS claim_row
  WHERE claim_row.run_id = v_run.id AND claim_row.claim_token = ANY (p_claim_tokens)
    AND claim_row.status = 'failed' AND run_item.run_id = v_run.id
    AND run_item.work_item_id = claim_row.work_item_id AND run_item.status = 'storage_claimed';
  RETURN v_affected;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_privacy_retention_run(
  p_run_id uuid,
  p_preview_hash text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_run privacy_retention.privacy_retention_runs%ROWTYPE;
  v_item record;
  v_expected integer := 0;
  v_pending integer := 0;
  v_held integer := 0;
  v_failed integer := 0;
  v_separated integer := 0;
  v_storage_deleted integer := 0;
  v_database_readback boolean := true;
  v_storage_readback boolean := true;
  v_readback boolean := false;
  v_no_active_hold_mutated boolean := true;
  v_empty_scan_complete boolean := false;
  v_final_status text;
  v_audit_id uuid;
BEGIN
  PERFORM privacy_retention.g014_retention_require_service_role();
  SELECT * INTO v_run FROM privacy_retention.privacy_retention_runs
  WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR v_run.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_run.idempotency_key IS DISTINCT FROM p_idempotency_key THEN
    RAISE EXCEPTION 'privacy_retention_finalize_binding_invalid' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_retention_assert_run_bindings(
    v_run.class_code, v_run.adapter_version, v_run.source_mapping_version
  );
  IF v_run.status = 'completed' THEN
    RETURN pg_catalog.jsonb_build_object(
      'operationId', v_run.id,
      'status', 'applied',
      'readback', pg_catalog.jsonb_build_object(
        'passed', v_run.readback_passed,
        'checks', pg_catalog.jsonb_build_object(
          'expectedCountMatched', v_run.readback_passed,
          'databaseSourceAbsent', v_run.database_readback_passed,
          'storageProviderAbsent', v_run.storage_readback_passed,
          'noActiveHoldMutated', v_run.no_active_hold_mutated
        )
      ),
      'auditId', v_run.audit_id,
      'adapterVersion', v_run.adapter_version,
      'sourceMappingVersion', v_run.source_mapping_version,
      'errorCode', NULL
    );
  END IF;
  IF v_run.status NOT IN ('running', 'partial', 'held') THEN
    RAISE EXCEPTION 'privacy_retention_finalize_predecessor_invalid' USING ERRCODE = '55000';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-retention-run:' || v_run.id::text, 0)
  );

  SELECT count(*),
         count(*) FILTER (WHERE status IN ('planned', 'storage_claimed')),
         count(*) FILTER (WHERE status = 'held'),
         count(*) FILTER (WHERE status = 'failed'),
         count(*) FILTER (WHERE status = 'separated'),
         count(*) FILTER (WHERE status = 'storage_deleted')
  INTO v_expected, v_pending, v_held, v_failed, v_separated, v_storage_deleted
  FROM privacy_retention.privacy_retention_run_items
  WHERE run_id = v_run.id;
  -- A zero-item run is complete only when a fresh due-work scan is empty.
  SELECT NOT EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_retention_work_items AS item
    WHERE item.class_code = v_run.class_code
      AND item.trigger_at <= v_run.cutoff
      AND item.status IN ('pending', 'failed', 'claimed')
  ) INTO v_empty_scan_complete;
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_retention_run_items AS run_item
    JOIN privacy_retention.privacy_retention_work_items AS item ON item.id = run_item.work_item_id
    LEFT JOIN privacy_retention.retention_class_adapter_bindings AS binding
      ON binding.class_code = item.class_code
     AND binding.source_type = item.source_type
     AND binding.status = 'active'
    LEFT JOIN privacy_retention.retention_adapter_versions AS version_row
      ON version_row.adapter_code = binding.adapter_code
     AND version_row.adapter_version = binding.adapter_version
     AND version_row.status = 'active'
     AND binding.mapping_contract_hash IS NOT DISTINCT FROM version_row.contract_hash
    WHERE run_item.run_id = v_run.id
      AND version_row.adapter_code IS NULL
  ) THEN
    RAISE EXCEPTION 'privacy_retention_finalize_adapter_not_active' USING ERRCODE = '55000';
  END IF;

  FOR v_item IN
    SELECT run_item.work_item_id, run_item.source_type, run_item.status,
           item.source_ref_hash, binding.adapter_code, binding.adapter_version,
           version_row.source_relation, version_row.source_identifier_column
    FROM privacy_retention.privacy_retention_run_items AS run_item
    JOIN privacy_retention.privacy_retention_work_items AS item ON item.id = run_item.work_item_id
    JOIN privacy_retention.retention_class_adapter_bindings AS binding
      ON binding.class_code = item.class_code AND binding.source_type = item.source_type
     AND binding.status = 'active'
    JOIN privacy_retention.retention_adapter_versions AS version_row
      ON version_row.adapter_code = binding.adapter_code
     AND version_row.adapter_version = binding.adapter_version AND version_row.status = 'active'
     AND binding.mapping_contract_hash IS NOT DISTINCT FROM version_row.contract_hash
    WHERE run_item.run_id = v_run.id
  LOOP
    IF v_item.source_type IN ('storage_object', 'ocr_artifact') THEN
      IF v_item.status IS DISTINCT FROM 'storage_deleted'
         OR NOT EXISTS (
           SELECT 1 FROM privacy_retention.g014_retention_receipts AS receipt
           WHERE receipt.run_id = v_run.id AND receipt.work_item_id = v_item.work_item_id
             AND receipt.receipt_kind = 'storage_provider_absence'
         ) THEN
        v_storage_readback := false;
      END IF;
    ELSIF v_item.status IS DISTINCT FROM 'separated'
       OR NOT privacy_retention.g014_retention_source_absent(
         v_item.adapter_code, v_item.source_relation,
         v_item.source_identifier_column, v_item.source_ref_hash
       )
       OR NOT EXISTS (
         SELECT 1 FROM privacy_retention.g014_retention_receipts AS receipt
         WHERE receipt.run_id = v_run.id AND receipt.work_item_id = v_item.work_item_id
           AND receipt.receipt_kind = 'database_source_absence'
       ) THEN
      v_database_readback := false;
    END IF;
  END LOOP;
  IF (
    SELECT count(*)
    FROM privacy_retention.g014_retention_receipts AS receipt
    WHERE receipt.run_id = v_run.id
      AND receipt.receipt_kind = 'storage_provider_absence'
  ) IS DISTINCT FROM v_storage_deleted THEN
    v_storage_readback := false;
  END IF;

  v_no_active_hold_mutated :=
    privacy_retention.g014_retention_no_active_hold_mutated(v_run.id);

  v_readback := v_pending = 0 AND v_held = 0 AND v_failed = 0
    AND v_database_readback AND v_storage_readback AND v_no_active_hold_mutated
    AND (
      v_expected > 0
      OR (
        v_empty_scan_complete
        AND v_run.scanned_count = 0
        AND v_run.planned_count = 0
        AND v_run.held_count = 0
      )
    );
  v_final_status := CASE
    WHEN v_readback THEN 'completed'
    WHEN v_held = v_expected AND v_expected > 0 THEN 'held'
    ELSE 'partial'
  END;

  UPDATE privacy_retention.privacy_retention_runs
  SET status = v_final_status,
      separated_count = v_separated,
      storage_deleted_count = v_storage_deleted,
      held_count = v_held,
      failure_count = v_failed,
      database_readback_passed = v_database_readback,
      storage_readback_passed = v_storage_readback,
      no_active_hold_mutated = v_no_active_hold_mutated,
      storage_receipts_hash = CASE
        WHEN v_readback THEN privacy_retention.g014_retention_storage_receipt_set_hash(v_run.id)
        ELSE NULL
      END,
      readback_passed = v_readback,
      completed_at = CASE WHEN v_final_status = 'completed' THEN pg_catalog.clock_timestamp() ELSE NULL END
  WHERE id = v_run.id
  RETURNING * INTO v_run;

  v_audit_id := privacy_retention.g014_retention_append_audit(
    v_run,
    CASE WHEN v_run.readback_passed THEN 'readback_passed' ELSE 'readback_failed' END,
    'RETENTION_READBACK'
  );
  UPDATE privacy_retention.privacy_retention_runs SET audit_id = v_audit_id WHERE id = v_run.id;

  RETURN pg_catalog.jsonb_build_object(
    'operationId', v_run.id,
    'status', CASE
      WHEN v_run.status = 'completed' THEN 'applied'
      WHEN v_run.status = 'held' THEN 'partial'
      ELSE v_run.status
    END,
    'readback', pg_catalog.jsonb_build_object(
      'passed', v_run.readback_passed,
      'checks', pg_catalog.jsonb_build_object(
        'expectedCountMatched', v_run.readback_passed,
        'databaseSourceAbsent', v_run.database_readback_passed,
        'storageProviderAbsent', v_run.storage_readback_passed,
        'noActiveHoldMutated', v_run.no_active_hold_mutated
      )
    ),
    'auditId', v_audit_id,
    'adapterVersion', v_run.adapter_version,
    'sourceMappingVersion', v_run.source_mapping_version,
    'errorCode', CASE WHEN v_run.readback_passed THEN NULL ELSE 'privacy_retention_readback_incomplete' END
  );
END;
$function$;

DO $g014_retention_ownership$
DECLARE
  v_relation regclass;
  v_signature text;
  v_oid oid;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'privacy_retention.retention_adapter_registry'::regclass,
    'privacy_retention.retention_adapter_versions'::regclass,
    'privacy_retention.retention_class_adapter_bindings'::regclass,
    'privacy_retention.retention_adapter_approvals'::regclass,
    'privacy_retention.retention_adapter_approval_consumptions'::regclass,
    'privacy_retention.g014_retention_storage_claims'::regclass,
    'privacy_retention.g014_retention_provider_effects'::regclass,
    'privacy_retention.g014_retention_receipts'::regclass,
    'privacy_retention.privacy_retention_classes'::regclass,
    'privacy_retention.privacy_retention_class_sources'::regclass,
    'privacy_retention.privacy_legal_holds'::regclass,
    'privacy_retention.privacy_retention_work_items'::regclass,
    'privacy_retention.privacy_retained_records'::regclass,
    'privacy_retention.privacy_retention_runs'::regclass,
    'privacy_retention.privacy_retention_run_items'::regclass
  ] LOOP
    EXECUTE pg_catalog.format('ALTER TABLE %s OWNER TO privacy_workflow_owner', v_relation);
    EXECUTE pg_catalog.format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', v_relation);
    EXECUTE pg_catalog.format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', v_relation);
    EXECUTE pg_catalog.format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated, service_role', v_relation);
    EXECUTE pg_catalog.format('GRANT ALL ON TABLE %s TO privacy_workflow_owner', v_relation);
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS g014_retention_owner_access ON %s', v_relation);
    EXECUTE pg_catalog.format('CREATE POLICY g014_retention_owner_access ON %s FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true)', v_relation);
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'privacy_retention.g014_retention_adapter_contract_hash(text,text,text,text,text,text,text)',
    'privacy_retention.g014_retention_source_hash(text,text)',
    'privacy_retention.g014_retention_storage_locator_hash(text,text)',
    'privacy_retention.g014_retention_storage_claim_hash(uuid,uuid,uuid,text,text)',
    'privacy_retention.g014_retention_database_absence_hash(text,text,text)',
    'privacy_retention.g014_retention_storage_receipt_set_hash(uuid)',
    'privacy_retention.g014_retention_require_service_role()',
    'privacy_retention.g014_retention_lock_subject_hash(text)',
    'privacy_retention.g014_retention_active_hold_exists(text,text,timestamptz)',
    'privacy_retention.g014_retention_source_absent(text,text,text,text)',
    'privacy_retention.g014_retention_no_active_hold_mutated(uuid)',
    'privacy_retention.g014_retention_approval_payload_hash(text,text,text,text,interval,text,text)',
    'privacy_retention.g014_retention_approval_insert_guard()',
    'privacy_retention.g014_retention_require_activation_operator()',
    'privacy_retention.g014_retention_catalog_fingerprint(text,text)',
    'privacy_retention.g014_retention_claim_storage_items_internal(uuid,text,text,integer)',
    'privacy_retention.g014_retention_active_adapter_version(text)',
    'privacy_retention.g014_retention_active_source_mapping_version(text)',
    'privacy_retention.g014_retention_assert_class_bindings(text)',
    'privacy_retention.g014_retention_assert_run_bindings(text,text,text)',
    'privacy_retention.g014_retention_append_audit(privacy_retention.privacy_retention_runs,text,text)',
    'privacy_retention.g014_retention_reject_evidence_mutation()',
    'privacy_retention.g014_retention_adapter_version_transition()',
    'privacy_retention.g014_retention_binding_transition()',
    'privacy_retention.g014_retention_storage_claim_binding()',
    'privacy_retention.g014_retention_storage_claim_transition()',
    'privacy_retention.g014_retention_provider_effect_transition()',
    'privacy_retention.g014_retention_run_transition_guard()',
    'privacy_retention.g014_retention_run_item_transition_guard()',
    'privacy_retention.g014_retention_work_item_transition_guard()',
    'privacy_retention.g014_retention_hold_transition_guard()',
    'privacy_retention.g014_retention_hold_subject_lock()',
    'public.activate_privacy_retention_adapter(text,text,text,text,text,text,interval,text,text,text)',
    'public.preview_privacy_retention_run(text,timestamptz,integer,integer)',
    'public.confirm_privacy_retention_run(uuid,text,text,text)',
    'public.apply_privacy_retention_run(uuid,text,text,integer)',
    'public.claim_privacy_retention_storage_items(uuid,text,text,integer)',
    'public.resolve_privacy_retention_provider_effect(uuid,text,text,uuid,uuid,text,text,text,text,text,text)',
    'public.get_privacy_retention_provider_reconciliation_work(uuid,text,text,text,integer)',
    'public.record_privacy_retention_storage_provider_receipts(uuid,text,text,jsonb)',
    'public.fail_privacy_retention_storage_claims(uuid,text,text,uuid[],text)',
    'public.finalize_privacy_retention_run(uuid,text,text)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'G014-05 required function is missing: %', v_signature;
    END IF;
    EXECUTE pg_catalog.format('ALTER FUNCTION %s OWNER TO privacy_workflow_owner', v_oid::regprocedure);
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_oid::regprocedure);
  END LOOP;
END;
$g014_retention_ownership$;
REVOKE ALL ON TABLE privacy_retention.retention_adapter_approvals
  FROM privacy_retention_operator_approver, privacy_retention_legal_approver, privacy_retention_activation_operator;
GRANT INSERT ON TABLE privacy_retention.retention_adapter_approvals
  TO privacy_retention_operator_approver, privacy_retention_legal_approver;
GRANT USAGE ON SCHEMA privacy_retention
  TO privacy_retention_operator_approver, privacy_retention_legal_approver, privacy_retention_activation_operator;
GRANT USAGE ON SCHEMA extensions
  TO privacy_retention_operator_approver, privacy_retention_legal_approver;
GRANT EXECUTE ON FUNCTION extensions.gen_random_uuid()
  TO privacy_retention_operator_approver, privacy_retention_legal_approver;
GRANT EXECUTE ON FUNCTION privacy_retention.g014_retention_approval_payload_hash(
  text,text,text,text,interval,text,text
) TO privacy_retention_operator_approver, privacy_retention_legal_approver;

DROP POLICY IF EXISTS g014_retention_owner_access ON privacy_retention.retention_adapter_approvals;
CREATE POLICY g014_retention_approval_owner_read
  ON privacy_retention.retention_adapter_approvals
  FOR SELECT TO privacy_workflow_owner USING (true);
CREATE POLICY g014_retention_operator_approval_insert
  ON privacy_retention.retention_adapter_approvals
  FOR INSERT TO privacy_retention_operator_approver
  WITH CHECK (
    approval_kind = 'operator'
    AND approved_by_role = 'privacy_retention_operator_approver'::name
    AND approved_by_principal = session_user::name
  );
CREATE POLICY g014_retention_legal_approval_insert
  ON privacy_retention.retention_adapter_approvals
  FOR INSERT TO privacy_retention_legal_approver
  WITH CHECK (
    approval_kind = 'legal'
    AND approved_by_role = 'privacy_retention_legal_approver'::name
    AND approved_by_principal = session_user::name
  );
-- The workflow owner needs only the database sources which have an executable
-- delete contract.  Missing source relations leave their adapters disabled and
-- are rejected by activation rather than making this additive migration fail.
DO $g014_retention_source_grants$
DECLARE
  v_relation regclass;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    pg_catalog.to_regclass('public.notifications'),
    pg_catalog.to_regclass('public.ocr_logs')
  ] LOOP
    IF v_relation IS NOT NULL THEN
      EXECUTE pg_catalog.format(
        'REVOKE ALL ON TABLE %s FROM privacy_workflow_owner', v_relation
      );
      EXECUTE pg_catalog.format(
        'GRANT SELECT, DELETE ON TABLE %s TO privacy_workflow_owner', v_relation
      );
      EXECUTE pg_catalog.format(
        'DROP POLICY IF EXISTS g014_retention_source_access ON %s', v_relation
      );
      EXECUTE pg_catalog.format(
        'CREATE POLICY g014_retention_source_access ON %s FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true)',
        v_relation
      );
    END IF;
  END LOOP;
END;
$g014_retention_source_grants$;

DELETE FROM privacy_retention.g014_public_rpc_allowlist
WHERE source_signature IN (
  'public.activate_privacy_retention_adapter(text,text,text,text,text,text,interval,text,text,text)',
  'public.preview_privacy_retention_run(text,timestamptz,integer,integer)',
  'public.confirm_privacy_retention_run(uuid,text,text,text)',
  'public.apply_privacy_retention_run(uuid,text,text,integer)',
  'public.claim_privacy_retention_storage_items(uuid,text,text,integer)',
  'public.resolve_privacy_retention_provider_effect(uuid,text,text,uuid,uuid,text,text,text,text,text,text)',
  'public.get_privacy_retention_provider_reconciliation_work(uuid,text,text,text,integer)',
  'public.ack_privacy_retention_storage_items(uuid,text,text,uuid[],boolean)',
  'public.finalize_privacy_retention_run(uuid,text,text)'
);
INSERT INTO privacy_retention.g014_public_rpc_allowlist (
  function_schema, function_name, identity_arguments, grantee, source_signature
)
SELECT namespace.nspname, procedure.proname,
       procedure.proargtypes::text,
       'service_role'::name, expected.source_signature
FROM (VALUES
  ('public.preview_privacy_retention_run(text,timestamptz,integer,integer)'),
  ('public.confirm_privacy_retention_run(uuid,text,text,text)'),
  ('public.apply_privacy_retention_run(uuid,text,text,integer)'),
  ('public.claim_privacy_retention_storage_items(uuid,text,text,integer)'),
  ('public.resolve_privacy_retention_provider_effect(uuid,text,text,uuid,uuid,text,text,text,text,text,text)'),
  ('public.get_privacy_retention_provider_reconciliation_work(uuid,text,text,text,integer)'),
  ('public.record_privacy_retention_storage_provider_receipts(uuid,text,text,jsonb)'),
  ('public.fail_privacy_retention_storage_claims(uuid,text,text,uuid[],text)'),
  ('public.finalize_privacy_retention_run(uuid,text,text)')
) AS expected(source_signature)
JOIN LATERAL pg_catalog.to_regprocedure(expected.source_signature) AS resolved(procedure_oid) ON true
JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = resolved.procedure_oid
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
ON CONFLICT DO NOTHING;

GRANT EXECUTE ON FUNCTION public.preview_privacy_retention_run(text,timestamptz,integer,integer),
  public.confirm_privacy_retention_run(uuid,text,text,text),
  public.apply_privacy_retention_run(uuid,text,text,integer),
  public.claim_privacy_retention_storage_items(uuid,text,text,integer),
  public.resolve_privacy_retention_provider_effect(uuid,text,text,uuid,uuid,text,text,text,text,text,text),
  public.get_privacy_retention_provider_reconciliation_work(uuid,text,text,text,integer),
  public.record_privacy_retention_storage_provider_receipts(uuid,text,text,jsonb),
  public.fail_privacy_retention_storage_claims(uuid,text,text,uuid[],text),
  public.finalize_privacy_retention_run(uuid,text,text)
TO service_role;
GRANT EXECUTE ON FUNCTION public.activate_privacy_retention_adapter(
  text,text,text,text,text,text,interval,text,text,text
) TO privacy_retention_activation_operator;

DO $g014_normalize_allowlisted_definers$
DECLARE
  v_signature text;
  v_procedure regprocedure;
  v_is_definer boolean;
BEGIN
  FOR v_signature IN
    SELECT allowlisted.source_signature
    FROM privacy_retention.g014_public_rpc_allowlist AS allowlisted
    ORDER BY allowlisted.source_signature
  LOOP
    v_procedure := pg_catalog.to_regprocedure(v_signature);
    SELECT procedure.prosecdef
    INTO v_is_definer
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid = v_procedure;
    IF v_procedure IS NULL OR v_is_definer IS NULL THEN
      RAISE EXCEPTION 'G014 allowlisted RPC identity is missing: %', v_signature;
    END IF;
    IF v_signature IN (
      'public.match_storyboard_documents_hybrid(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)',
      'public.match_storyboard_documents_hybrid_v2(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)',
      'public.ocr_log_metadata_is_safe(jsonb)'
    ) THEN
      IF v_is_definer THEN
        RAISE EXCEPTION 'G014 declared SECURITY INVOKER RPC became SECURITY DEFINER: %', v_signature;
      END IF;
      CONTINUE;
    END IF;
    IF NOT v_is_definer THEN
      RAISE EXCEPTION 'G014 undeclared SECURITY INVOKER allowlisted RPC: %', v_signature;
    END IF;
    EXECUTE pg_catalog.format('ALTER FUNCTION %s SET search_path = ''''', v_procedure);
    EXECUTE pg_catalog.format('ALTER FUNCTION %s OWNER TO privacy_workflow_owner', v_procedure);
  END LOOP;
END;
$g014_normalize_allowlisted_definers$;
CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_definer_contract()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_signature text;
  v_oid oid;
  v_owner text;
  v_search_path text;
  v_is_definer boolean;
BEGIN
  FOR v_signature IN
    SELECT source_signature FROM privacy_retention.g014_public_rpc_allowlist
    UNION ALL VALUES
      ('privacy_retention.g014_retention_storage_receipt_set_hash(uuid)'),
      ('privacy_retention.g014_retention_source_absent(text,text,text,text)'),
      ('privacy_retention.g014_retention_no_active_hold_mutated(uuid)'),
      ('privacy_retention.g014_retention_catalog_fingerprint(text,text)'),
      ('privacy_retention.g014_retention_require_activation_operator()'),
      ('privacy_retention.g014_retention_active_adapter_version(text)'),
      ('privacy_retention.g014_retention_active_source_mapping_version(text)'),
      ('privacy_retention.g014_retention_assert_class_bindings(text)'),
      ('privacy_retention.g014_retention_assert_run_bindings(text,text,text)'),
      ('privacy_retention.g014_retention_append_audit(privacy_retention.privacy_retention_runs,text,text)')
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'G014 required RPC identity is missing: %', v_signature;
    END IF;
    SELECT procedure.prosecdef
    INTO v_is_definer
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid = v_oid;
    IF v_signature IN (
      'public.match_storyboard_documents_hybrid(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)',
      'public.match_storyboard_documents_hybrid_v2(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)',
      'public.ocr_log_metadata_is_safe(jsonb)'
    ) THEN
      IF v_is_definer THEN
        RAISE EXCEPTION 'G014 declared SECURITY INVOKER RPC became SECURITY DEFINER: %', v_signature;
      END IF;
      CONTINUE;
    END IF;
    IF NOT v_is_definer THEN
      RAISE EXCEPTION 'G014 required SECURITY DEFINER identity is SECURITY INVOKER: %', v_signature;
    END IF;

    SELECT pg_catalog.pg_get_userbyid(procedure.proowner), setting.value
    INTO v_owner, v_search_path
    FROM pg_catalog.pg_proc AS procedure
    LEFT JOIN LATERAL pg_catalog.unnest(procedure.proconfig) AS setting(value)
      ON setting.value LIKE 'search_path=%'
    WHERE procedure.oid = v_oid;

    IF v_owner IS DISTINCT FROM 'privacy_workflow_owner' THEN
      RAISE EXCEPTION 'G014 SECURITY DEFINER owner mismatch: %', v_signature;
    END IF;
    IF v_search_path IS DISTINCT FROM 'search_path='
       AND v_search_path IS DISTINCT FROM 'search_path=""' THEN
      RAISE EXCEPTION 'G014 SECURITY DEFINER search_path is not empty: %', v_signature;
    END IF;
  END LOOP;
END;
$function$;
ALTER FUNCTION privacy_retention.assert_g014_definer_contract() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.assert_g014_definer_contract()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION privacy_retention.assert_g014_definer_contract() TO privacy_workflow_owner;

SELECT privacy_retention.assert_g014_public_rpc_allowlist();
NOTIFY pgrst, 'reload schema';

COMMIT;
