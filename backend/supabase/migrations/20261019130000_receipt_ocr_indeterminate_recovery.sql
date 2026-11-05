-- Draft 108 successor: explicit, idempotent recovery for one provider-indeterminate
-- receipt OCR generation. Admission remains held until the predecessor-107
-- identity is verified and the private catalog contract is sealed by its compiler.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL check_function_bodies = on;

-- BEGIN RECEIPT OCR 108 OPERATING ADMISSION
DO $prerequisite$
DECLARE
  actual_ledger_count integer;
  actual_ledger_identity_root text;
BEGIN
  IF current_user <> 'postgres'
    OR session_user <> 'postgres'
    OR pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17
    OR pg_catalog.current_setting('transaction_read_only') <> 'off'
    OR pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL
    OR pg_catalog.to_regnamespace('ocr_private') IS NULL
    OR pg_catalog.to_regclass('ocr_private.receipt_results') IS NULL
    OR pg_catalog.to_regclass('ocr_private.review_generations') IS NULL
    OR pg_catalog.to_regclass('privacy_retention.g014_public_rpc_allowlist') IS NULL
    OR pg_catalog.to_regclass('privacy_retention.g014_nested_helper_allowlist') IS NULL
    OR pg_catalog.to_regprocedure('privacy_retention.assert_g014_public_rpc_allowlist()') IS NULL
    OR pg_catalog.to_regprocedure('privacy_retention.assert_g014_definer_contract()') IS NULL
    OR pg_catalog.to_regprocedure('public.get_receipt_ocr_credential_release_capability()') IS NULL
    OR pg_catalog.to_regprocedure('ocr_private.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)') IS NULL
    OR pg_catalog.to_regprocedure('public.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)') IS NULL
    OR pg_catalog.to_regprocedure('public.publish_review_receipt_ocr_result(uuid,uuid,uuid,uuid,uuid,text,jsonb,boolean)') IS NULL
    OR pg_catalog.to_regprocedure('extensions.digest(bytea,text)') IS NULL
    OR pg_catalog.to_regprocedure('extensions.gen_random_uuid()') IS NULL
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_PREREQUISITE_MISSING';
  END IF;

  WITH ledger_identity AS (
    SELECT
      migration.version,
      migration.name,
      pg_catalog.octet_length(pg_catalog.convert_to(migration.version, 'UTF8'))::text
        || ':' || migration.version || pg_catalog.chr(31)
        || CASE
          WHEN migration.name IS NULL THEN '-1:'
          ELSE pg_catalog.octet_length(pg_catalog.convert_to(migration.name, 'UTF8'))::text
            || ':' || migration.name
        END
        || pg_catalog.chr(31)
        || pg_catalog.cardinality(migration.statements)::text
        || pg_catalog.chr(31)
        || pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(pg_catalog.array_to_json(migration.statements)::text, 'UTF8'),
            'sha256'
          ),
          'hex'
        ) AS row_material
    FROM supabase_migrations.schema_migrations AS migration
  )
  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          coalesce(
            pg_catalog.string_agg(
              ledger_identity.row_material,
              pg_catalog.chr(30)
              ORDER BY ledger_identity.version COLLATE "C", ledger_identity.name COLLATE "C"
            ),
            ''
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  INTO actual_ledger_count, actual_ledger_identity_root
  FROM ledger_identity;

  IF actual_ledger_count <> 107
    OR actual_ledger_identity_root <> 'cd04aebfc1efcc5588486adf3b7ba47fc5b5b76e39a9c23e316768f2919d9d9e'
    OR (
      SELECT pg_catalog.count(*)
      FROM supabase_migrations.schema_migrations AS migration
      WHERE migration.version = '20261019120000'
        AND migration.name = 'receipt_ocr_credential_release_acl_admission_v2'
        AND pg_catalog.cardinality(migration.statements) = 27
        AND pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(pg_catalog.array_to_json(migration.statements)::text, 'UTF8'),
            'sha256'
          ),
          'hex'
        ) = '37decc48cfcd3cbb9e40afd6511929262da2400264aa1f18e51317a01d92e9bf'
    ) <> 1
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_LEDGER_DRIFT';
  END IF;
  IF ocr_private.get_receipt_ocr_credential_release_capability() IS DISTINCT FROM
    '{"schema_version":1,"status":"ready","capability_version":"receipt-ocr-definitive-credential-release-v2"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_PREDECESSOR_NOT_READY';
  END IF;
END;
$prerequisite$;
-- END RECEIPT OCR 108 OPERATING ADMISSION

CREATE TEMPORARY TABLE pg_temp.receipt_ocr_recovery108_owner_lease (
  pg_major integer NOT NULL,
  pg15_membership_lease boolean NOT NULL,
  self_membership jsonb,
  before_members jsonb NOT NULL
) ON COMMIT DROP;

DO $prepare_owner_lease$
DECLARE
  workflow_owner oid := 'privacy_workflow_owner'::regrole;
  runner oid := 'postgres'::regrole;
  pg_major integer := pg_catalog.current_setting('server_version_num')::integer / 10000;
  pg15_membership_lease boolean := false;
  self_membership jsonb;
  before_members jsonb;
BEGIN
  IF current_user <> 'postgres'
    OR session_user <> 'postgres'
    OR pg_major NOT IN (15, 17)
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles AS role_row
      WHERE role_row.oid = workflow_owner
        AND NOT role_row.rolsuper
        AND NOT role_row.rolbypassrls
        AND NOT role_row.rolcanlogin
        AND NOT role_row.rolinherit
    )
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_OWNER_LEASE_PREREQUISITE_DRIFT';
  END IF;

  SELECT coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.to_jsonb(membership)
             ORDER BY membership.roleid, membership.member, membership.grantor
           ),
           '[]'::jsonb
         )
  INTO before_members
  FROM pg_catalog.pg_auth_members AS membership;

  SELECT pg_catalog.to_jsonb(membership)
  INTO self_membership
  FROM pg_catalog.pg_auth_members AS membership
  WHERE membership.roleid = workflow_owner
    AND membership.member = runner
    AND membership.grantor = runner;

  IF self_membership IS NOT NULL
    AND (self_membership->>'admin_option')::boolean
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_SELF_MEMBERSHIP_DENIED';
  END IF;

  IF pg_major = 17 THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      WHERE membership.roleid = workflow_owner
        AND membership.member = runner
        AND membership.admin_option
        AND membership.grantor <> runner
    ) THEN
      RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_OWNER_AUTHORITY_MISSING';
    END IF;
    EXECUTE 'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres';
  ELSE
    pg15_membership_lease := NOT pg_catalog.pg_has_role(runner, workflow_owner, 'MEMBER');
    IF pg15_membership_lease THEN
      GRANT privacy_workflow_owner TO postgres;
    END IF;
  END IF;

  INSERT INTO pg_temp.receipt_ocr_recovery108_owner_lease (
    pg_major,
    pg15_membership_lease,
    self_membership,
    before_members
  ) VALUES (
    pg_major,
    pg15_membership_lease,
    self_membership,
    before_members
  );
END;
$prepare_owner_lease$;

CREATE TABLE ocr_private.receipt_ocr_indeterminate_recoveries (
  operation_id uuid PRIMARY KEY,
  review_id uuid NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  expected_generation uuid NOT NULL,
  recovery_generation uuid NOT NULL,
  input_snapshot_hash text NOT NULL CHECK (input_snapshot_hash ~ '^[0-9a-f]{64}$'),
  verification_photo_hash text NOT NULL CHECK (verification_photo_hash ~ '^[0-9a-f]{64}$'),
  expected_image_hash text NOT NULL CHECK (expected_image_hash ~ '^[0-9a-f]{64}$'),
  model_policy jsonb NOT NULL CHECK (
    CASE WHEN pg_catalog.jsonb_typeof(model_policy) = 'array'
      THEN pg_catalog.jsonb_array_length(model_policy) BETWEEN 1 AND 3
      ELSE false
    END
  ),
  thinking_level text NOT NULL CHECK (thinking_level IN ('LOW', 'MEDIUM', 'HIGH')),
  prompt_version text NOT NULL,
  preprocess_version text NOT NULL,
  normalization_version text NOT NULL,
  admitted_input_context_hash text CHECK (admitted_input_context_hash ~ '^[0-9a-f]{64}$'),
  execution_admitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (review_id, expected_generation),
  UNIQUE (review_id, recovery_generation)
);

COMMENT ON TABLE ocr_private.receipt_ocr_indeterminate_recoveries IS
  'Opaque idempotency receipts for explicit administrator recovery of one provider-indeterminate OCR generation. No raw OCR, provider diagnostics, credentials, or request bodies are stored.';

ALTER TABLE ocr_private.receipt_ocr_indeterminate_recoveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_private.receipt_ocr_indeterminate_recoveries FORCE ROW LEVEL SECURITY;
CREATE POLICY receipt_ocr_indeterminate_recoveries_owner_only
  ON ocr_private.receipt_ocr_indeterminate_recoveries
  TO postgres
  USING (true)
  WITH CHECK (true);
REVOKE ALL ON TABLE ocr_private.receipt_ocr_indeterminate_recoveries
  FROM PUBLIC, anon, authenticated, service_role, privacy_workflow_owner;

CREATE TABLE ocr_private.receipt_ocr_recovery_execution_leases (
  recovery_operation_id uuid PRIMARY KEY
    REFERENCES ocr_private.receipt_ocr_indeterminate_recoveries(operation_id) ON DELETE RESTRICT,
  review_id uuid NOT NULL REFERENCES public.reviews(id) ON DELETE RESTRICT,
  result_id uuid NOT NULL UNIQUE REFERENCES ocr_private.receipt_results(id) ON DELETE CASCADE,
  recovery_generation uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (review_id, recovery_generation)
);

COMMENT ON TABLE ocr_private.receipt_ocr_recovery_execution_leases IS
  'Active recovery provider-execution leases. A review cannot be deleted after a bound claim until its result becomes terminal or the undispatched claim is explicitly released.';

ALTER TABLE ocr_private.receipt_ocr_recovery_execution_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_private.receipt_ocr_recovery_execution_leases FORCE ROW LEVEL SECURITY;
CREATE POLICY receipt_ocr_recovery_execution_leases_owner_only
  ON ocr_private.receipt_ocr_recovery_execution_leases
  TO postgres
  USING (true)
  WITH CHECK (true);
REVOKE ALL ON TABLE ocr_private.receipt_ocr_recovery_execution_leases
  FROM PUBLIC, anon, authenticated, service_role, privacy_workflow_owner;

CREATE TABLE ocr_private.receipt_ocr_recovery_catalog_contract (
  capability_version text PRIMARY KEY CHECK (
    capability_version = 'receipt-ocr-indeterminate-recovery-v1'
  ),
  migration_version text,
  migration_name text,
  statement_count integer,
  statement_vector_sha256 text,
  predecessor_ledger_count integer,
  predecessor_terminal_identity_root text,
  ledger_count integer,
  ledger_identity_root text,
  sealed_at timestamptz,
  function_contract jsonb NOT NULL,
  table_contract jsonb NOT NULL,
  trigger_contract jsonb NOT NULL,
  CONSTRAINT receipt_ocr_recovery_catalog_seal_check CHECK (
    (
      migration_version IS NULL
      AND migration_name IS NULL
      AND statement_count IS NULL
      AND statement_vector_sha256 IS NULL
      AND predecessor_ledger_count IS NULL
      AND predecessor_terminal_identity_root IS NULL
      AND ledger_count IS NULL
      AND ledger_identity_root IS NULL
      AND sealed_at IS NULL
    ) OR (
      migration_version ~ '^[0-9]{14}$'
      AND migration_name = 'receipt_ocr_indeterminate_recovery'
      AND statement_count > 0
      AND statement_vector_sha256 ~ '^[0-9a-f]{64}$'
      AND predecessor_ledger_count = 107
      AND predecessor_terminal_identity_root ~ '^[0-9a-f]{64}$'
      AND ledger_count = 108
      AND ledger_identity_root ~ '^[0-9a-f]{64}$'
      AND sealed_at IS NOT NULL
    )
  )
);

ALTER TABLE ocr_private.receipt_ocr_recovery_catalog_contract ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_private.receipt_ocr_recovery_catalog_contract FORCE ROW LEVEL SECURITY;
CREATE POLICY receipt_ocr_recovery_catalog_contract_owner_only
  ON ocr_private.receipt_ocr_recovery_catalog_contract
  TO postgres
  USING (true)
  WITH CHECK (true);
REVOKE ALL ON TABLE ocr_private.receipt_ocr_recovery_catalog_contract
  FROM PUBLIC, anon, authenticated, service_role, privacy_workflow_owner;

CREATE FUNCTION ocr_private.preview_review_receipt_ocr_indeterminate_recovery(
  p_review_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  review_row public.reviews%ROWTYPE;
  current_generation uuid;
  durable_result ocr_private.receipt_results%ROWTYPE;
  current_operation ocr_private.receipt_ocr_indeterminate_recoveries%ROWTYPE;
  processing_count integer;
  indeterminate_count integer;
  snapshot_hash text;
BEGIN
  IF p_review_id IS NULL THEN
    RAISE EXCEPTION 'receipt_ocr_recovery_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO review_row
  FROM public.reviews AS review
  WHERE review.id = p_review_id;
  IF NOT FOUND
    OR review_row.verification_photo IS NULL
    OR review_row.ocr_processed_at IS NOT NULL
    OR review_row.receipt_data IS NOT NULL
    OR review_row.receipt_hash IS NOT NULL
    OR review_row.is_duplicate IS DISTINCT FROM false
  THEN
    RETURN pg_catalog.jsonb_build_object(
      'schema_version', 1,
      'status', 'conflict',
      'review_id', p_review_id,
      'expected_generation', NULL,
      'input_snapshot_hash', NULL,
      'recovery_operation_id', NULL
    );
  END IF;

  SELECT generation INTO current_generation
  FROM ocr_private.review_generations AS generation_row
  WHERE generation_row.review_id = review_row.id
    AND generation_row.user_id = review_row.user_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'schema_version', 1, 'status', 'conflict', 'review_id', p_review_id,
      'expected_generation', NULL, 'input_snapshot_hash', NULL, 'recovery_operation_id', NULL
    );
  END IF;

  SELECT pg_catalog.count(*)::integer INTO processing_count
  FROM ocr_private.receipt_results AS result_row
  WHERE result_row.user_id = review_row.user_id
    AND result_row.generation = current_generation
    AND result_row.status = 'processing';
  IF processing_count > 0 THEN
    RETURN pg_catalog.jsonb_build_object(
      'schema_version', 1, 'status', 'processing', 'review_id', p_review_id,
      'expected_generation', current_generation, 'input_snapshot_hash', NULL, 'recovery_operation_id', NULL
    );
  END IF;

  SELECT pg_catalog.count(*)::integer INTO indeterminate_count
  FROM ocr_private.receipt_results AS result_row
  WHERE result_row.user_id = review_row.user_id
    AND result_row.generation = current_generation
    AND result_row.status = 'indeterminate'
    AND result_row.dispatch_stage = 'uncertain';

  IF indeterminate_count > 1 THEN
    RETURN pg_catalog.jsonb_build_object(
      'schema_version', 1, 'status', 'conflict', 'review_id', p_review_id,
      'expected_generation', current_generation, 'input_snapshot_hash', NULL, 'recovery_operation_id', NULL
    );
  END IF;

  IF indeterminate_count = 1 THEN
    SELECT * INTO durable_result
    FROM ocr_private.receipt_results AS result_row
    WHERE result_row.user_id = review_row.user_id
      AND result_row.generation = current_generation
      AND result_row.status = 'indeterminate'
      AND result_row.dispatch_stage = 'uncertain';
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
    RETURN pg_catalog.jsonb_build_object(
      'schema_version', 1,
      'status', 'eligible',
      'review_id', p_review_id,
      'expected_generation', current_generation,
      'input_snapshot_hash', snapshot_hash,
      'recovery_operation_id', NULL
    );
  END IF;

  SELECT * INTO current_operation
  FROM ocr_private.receipt_ocr_indeterminate_recoveries AS operation_row
  WHERE operation_row.review_id = review_row.id
    AND operation_row.recovery_generation = current_generation;
  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'schema_version', 1,
      'status', 'recovery_in_progress',
      'review_id', p_review_id,
      'expected_generation', current_operation.expected_generation,
      'input_snapshot_hash', current_operation.input_snapshot_hash,
      'recovery_operation_id', current_operation.operation_id
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'status', 'not_indeterminate',
    'review_id', p_review_id,
    'expected_generation', current_generation,
    'input_snapshot_hash', NULL,
    'recovery_operation_id', NULL
  );
END;
$function$;

CREATE FUNCTION ocr_private.recover_review_receipt_ocr_indeterminate(
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
    OR (CASE WHEN pg_catalog.jsonb_typeof(p_model_policy) = 'array' THEN
      pg_catalog.jsonb_array_length(p_model_policy) NOT BETWEEN 1 AND 3
      OR EXISTS (
        SELECT 1 FROM pg_catalog.jsonb_array_elements(p_model_policy) AS model(value)
        WHERE pg_catalog.jsonb_typeof(model.value) IS DISTINCT FROM 'string'
          OR pg_catalog.length(model.value #>> '{}') NOT BETWEEN 1 AND 120
      )
      ELSE true
    END)
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

CREATE FUNCTION ocr_private.authorize_review_receipt_ocr_execution(
  p_user_id uuid,
  p_review_id uuid,
  p_generation uuid,
  p_recovery_operation_id uuid,
  p_verification_photo_hash text,
  p_image_hash text,
  p_input_context_hash text,
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
  recovery_row ocr_private.receipt_ocr_indeterminate_recoveries%ROWTYPE;
  current_photo_hash text;
BEGIN
  IF p_user_id IS NULL OR p_review_id IS NULL OR p_generation IS NULL
    OR p_verification_photo_hash !~ '^[0-9a-f]{64}$'
    OR p_image_hash !~ '^[0-9a-f]{64}$'
    OR p_input_context_hash !~ '^[0-9a-f]{64}$'
    OR pg_catalog.jsonb_typeof(p_model_policy) IS DISTINCT FROM 'array'
    OR p_thinking_level NOT IN ('LOW', 'MEDIUM', 'HIGH')
    OR p_prompt_version IS NULL OR p_preprocess_version IS NULL OR p_normalization_version IS NULL
  THEN
    RAISE EXCEPTION 'receipt_ocr_recovery_execution_invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('receipt-ocr-recovery-review:' || p_review_id::text, 0)
  );
  SELECT * INTO review_row
  FROM public.reviews AS review
  WHERE review.id = p_review_id AND review.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR review_row.verification_photo IS NULL
    OR review_row.ocr_processed_at IS NOT NULL
    OR review_row.receipt_data IS NOT NULL
    OR review_row.receipt_hash IS NOT NULL
    OR review_row.is_duplicate IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'receipt_ocr_recovery_execution_conflict' USING ERRCODE = '55000';
  END IF;

  SELECT generation INTO current_generation
  FROM ocr_private.review_generations AS generation_row
  WHERE generation_row.review_id = p_review_id AND generation_row.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR current_generation IS DISTINCT FROM p_generation THEN
    RAISE EXCEPTION 'receipt_ocr_recovery_execution_conflict' USING ERRCODE = '55000';
  END IF;

  current_photo_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(review_row.verification_photo, 'UTF8'), 'sha256'),
    'hex'
  );
  IF current_photo_hash IS DISTINCT FROM p_verification_photo_hash THEN
    RAISE EXCEPTION 'receipt_ocr_recovery_execution_conflict' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO recovery_row
  FROM ocr_private.receipt_ocr_indeterminate_recoveries AS operation_row
  WHERE operation_row.review_id = p_review_id
    AND operation_row.recovery_generation = p_generation
  FOR UPDATE;

  IF NOT FOUND THEN
    IF p_recovery_operation_id IS NOT NULL THEN
      RAISE EXCEPTION 'receipt_ocr_recovery_execution_conflict' USING ERRCODE = '55000';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'schema_version', 1,
      'status', 'allowed_normal',
      'review_id', p_review_id,
      'generation', p_generation,
      'recovery_operation_id', NULL
    );
  END IF;

  IF p_recovery_operation_id IS NULL
    OR recovery_row.operation_id IS DISTINCT FROM p_recovery_operation_id
    OR recovery_row.verification_photo_hash IS DISTINCT FROM p_verification_photo_hash
    OR recovery_row.expected_image_hash IS DISTINCT FROM p_image_hash
    OR recovery_row.model_policy IS DISTINCT FROM p_model_policy
    OR recovery_row.thinking_level IS DISTINCT FROM p_thinking_level
    OR recovery_row.prompt_version IS DISTINCT FROM p_prompt_version
    OR recovery_row.preprocess_version IS DISTINCT FROM p_preprocess_version
    OR recovery_row.normalization_version IS DISTINCT FROM p_normalization_version
    OR (
      recovery_row.admitted_input_context_hash IS NOT NULL
      AND recovery_row.admitted_input_context_hash IS DISTINCT FROM p_input_context_hash
    )
  THEN
    RAISE EXCEPTION 'receipt_ocr_recovery_execution_conflict' USING ERRCODE = '55000';
  END IF;

  IF recovery_row.admitted_input_context_hash IS NULL THEN
    UPDATE ocr_private.receipt_ocr_indeterminate_recoveries AS operation_row
    SET admitted_input_context_hash = p_input_context_hash,
        execution_admitted_at = pg_catalog.clock_timestamp()
    WHERE operation_row.operation_id = recovery_row.operation_id
      AND operation_row.admitted_input_context_hash IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'receipt_ocr_recovery_execution_conflict' USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'status', 'allowed_recovery',
    'review_id', p_review_id,
    'generation', p_generation,
    'recovery_operation_id', recovery_row.operation_id
  );
END;
$function$;

ALTER FUNCTION ocr_private.claim_receipt_ocr_result(
  uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean
) RENAME TO claim_receipt_ocr_result_core;

REVOKE ALL ON FUNCTION ocr_private.claim_receipt_ocr_result_core(
  uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean
) FROM PUBLIC, anon, authenticated, service_role, privacy_workflow_owner;

CREATE FUNCTION ocr_private.claim_receipt_ocr_result(
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
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  claim_review_id uuid;
BEGIN
  SELECT generation_row.review_id INTO claim_review_id
  FROM ocr_private.review_generations AS generation_row
  WHERE generation_row.user_id = p_user_id
    AND generation_row.generation = p_generation;
  IF FOUND THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('receipt-ocr-recovery-review:' || claim_review_id::text, 0)
    );
    IF NOT EXISTS (
      SELECT 1
      FROM ocr_private.review_generations AS generation_row
      WHERE generation_row.review_id = claim_review_id
        AND generation_row.user_id = p_user_id
        AND generation_row.generation = p_generation
    ) THEN
      RAISE EXCEPTION 'receipt_ocr_review_generation_stale' USING ERRCODE = '55000';
    END IF;
  ELSIF p_prompt_version LIKE 'admin-receipt-%' THEN
    -- A deleted review or rotated generation cannot be reclassified as an
    -- ordinary admin claim merely because its recovery receipt cascaded away.
    RAISE EXCEPTION 'receipt_ocr_review_generation_stale' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM ocr_private.receipt_ocr_indeterminate_recoveries AS recovery
    WHERE recovery.recovery_generation = p_generation
      OR recovery.expected_generation = p_generation
  ) THEN
    RAISE EXCEPTION 'receipt_ocr_recovery_operation_required' USING ERRCODE = '55000';
  END IF;
  RETURN ocr_private.claim_receipt_ocr_result_core(
    p_user_id, p_image_hash, p_input_context_hash, p_provider, p_model_policy,
    p_generation, p_prompt_version, p_preprocess_version, p_normalization_version,
    p_operation_id, p_force_refresh
  );
END;
$function$;

CREATE FUNCTION ocr_private.claim_receipt_ocr_recovery_result(
  p_recovery_operation_id uuid,
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
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  recovery_row ocr_private.receipt_ocr_indeterminate_recoveries%ROWTYPE;
  recovery_review_id uuid;
  current_generation uuid;
  review_row public.reviews%ROWTYPE;
  current_photo_hash text;
  claim_result jsonb;
  claimed_result_id uuid;
BEGIN
  IF p_recovery_operation_id IS NULL THEN
    RAISE EXCEPTION 'receipt_ocr_recovery_operation_required' USING ERRCODE = '55000';
  END IF;
  SELECT recovery.review_id INTO recovery_review_id
  FROM ocr_private.receipt_ocr_indeterminate_recoveries AS recovery
  WHERE recovery.operation_id = p_recovery_operation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'receipt_ocr_recovery_execution_conflict' USING ERRCODE = '55000';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('receipt-ocr-recovery-review:' || recovery_review_id::text, 0)
  );
  SELECT * INTO review_row
  FROM public.reviews AS review
  WHERE review.id = recovery_review_id AND review.user_id = p_user_id
  FOR SHARE;
  IF NOT FOUND OR review_row.verification_photo IS NULL
    OR review_row.ocr_processed_at IS NOT NULL
    OR review_row.receipt_data IS NOT NULL
    OR review_row.receipt_hash IS NOT NULL
    OR review_row.is_duplicate IS DISTINCT FROM false
  THEN
    RAISE EXCEPTION 'receipt_ocr_recovery_execution_conflict' USING ERRCODE = '55000';
  END IF;
  SELECT generation INTO current_generation
  FROM ocr_private.review_generations AS generation_row
  WHERE generation_row.review_id = recovery_review_id
    AND generation_row.user_id = p_user_id
  FOR SHARE;
  IF NOT FOUND OR current_generation IS DISTINCT FROM p_generation THEN
    RAISE EXCEPTION 'receipt_ocr_recovery_execution_conflict' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO recovery_row
  FROM ocr_private.receipt_ocr_indeterminate_recoveries AS recovery
  WHERE recovery.operation_id = p_recovery_operation_id
  FOR UPDATE;
  IF NOT FOUND OR recovery_row.recovery_generation IS DISTINCT FROM p_generation
    OR recovery_row.expected_image_hash IS DISTINCT FROM p_image_hash
    OR recovery_row.admitted_input_context_hash IS NULL
    OR recovery_row.admitted_input_context_hash IS DISTINCT FROM p_input_context_hash
    OR recovery_row.model_policy IS DISTINCT FROM p_model_policy
    OR recovery_row.prompt_version IS DISTINCT FROM p_prompt_version
    OR recovery_row.preprocess_version IS DISTINCT FROM p_preprocess_version
    OR recovery_row.normalization_version IS DISTINCT FROM p_normalization_version
  THEN
    RAISE EXCEPTION 'receipt_ocr_recovery_execution_conflict' USING ERRCODE = '55000';
  END IF;

  current_photo_hash := pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(review_row.verification_photo, 'UTF8'), 'sha256'),
    'hex'
  );
  IF current_photo_hash IS DISTINCT FROM recovery_row.verification_photo_hash THEN
    RAISE EXCEPTION 'receipt_ocr_recovery_execution_conflict' USING ERRCODE = '55000';
  END IF;

  claim_result := ocr_private.claim_receipt_ocr_result_core(
    p_user_id, p_image_hash, p_input_context_hash, p_provider, p_model_policy,
    p_generation, p_prompt_version, p_preprocess_version, p_normalization_version,
    p_operation_id, p_force_refresh
  );

  IF claim_result->>'status' IN ('claimed', 'processing') THEN
    BEGIN
      claimed_result_id := (claim_result->>'result_ref')::uuid;
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'receipt_ocr_recovery_execution_conflict' USING ERRCODE = '55000';
    END;
    IF claimed_result_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM ocr_private.receipt_results AS result_row
      WHERE result_row.id = claimed_result_id
        AND result_row.user_id = p_user_id
        AND result_row.generation = p_generation
        AND result_row.status = 'processing'
    ) THEN
      RAISE EXCEPTION 'receipt_ocr_recovery_execution_conflict' USING ERRCODE = '55000';
    END IF;

    INSERT INTO ocr_private.receipt_ocr_recovery_execution_leases (
      recovery_operation_id,
      review_id,
      result_id,
      recovery_generation
    ) VALUES (
      recovery_row.operation_id,
      recovery_row.review_id,
      claimed_result_id,
      recovery_row.recovery_generation
    ) ON CONFLICT DO NOTHING;

    IF NOT EXISTS (
      SELECT 1
      FROM ocr_private.receipt_ocr_recovery_execution_leases AS lease
      WHERE lease.recovery_operation_id = recovery_row.operation_id
        AND lease.review_id = recovery_row.review_id
        AND lease.result_id = claimed_result_id
        AND lease.recovery_generation = recovery_row.recovery_generation
    ) THEN
      RAISE EXCEPTION 'receipt_ocr_recovery_execution_conflict' USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN claim_result;
END;
$function$;

CREATE FUNCTION ocr_private.release_receipt_ocr_recovery_execution_lease()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF OLD.status = 'processing' AND NEW.status <> 'processing' THEN
    DELETE FROM ocr_private.receipt_ocr_recovery_execution_leases AS lease
    WHERE lease.result_id = OLD.id;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER receipt_ocr_recovery_execution_lease_release
AFTER UPDATE OF status ON ocr_private.receipt_results
FOR EACH ROW
WHEN (OLD.status = 'processing' AND NEW.status <> 'processing')
EXECUTE FUNCTION ocr_private.release_receipt_ocr_recovery_execution_lease();

REVOKE ALL ON FUNCTION ocr_private.release_receipt_ocr_recovery_execution_lease()
  FROM PUBLIC, anon, authenticated, service_role, privacy_workflow_owner;

CREATE FUNCTION ocr_private.guard_receipt_ocr_recovery_photo_update()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.verification_photo IS DISTINCT FROM OLD.verification_photo
    AND OLD.verification_photo IS NOT NULL
    AND OLD.ocr_processed_at IS NULL
    AND OLD.receipt_data IS NULL
    AND OLD.receipt_hash IS NULL
    AND OLD.is_duplicate IS DISTINCT FROM true
    AND EXISTS (
      SELECT 1
      FROM ocr_private.review_generations AS generation_row
      JOIN ocr_private.receipt_ocr_indeterminate_recoveries AS recovery
        ON recovery.review_id = generation_row.review_id
       AND recovery.recovery_generation = generation_row.generation
      WHERE generation_row.review_id = OLD.id
        AND generation_row.user_id = OLD.user_id
    )
  THEN
    RAISE EXCEPTION 'receipt_ocr_recovery_photo_locked' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER receipt_ocr_recovery_photo_update_guard
BEFORE UPDATE OF verification_photo ON public.reviews
FOR EACH ROW
EXECUTE FUNCTION ocr_private.guard_receipt_ocr_recovery_photo_update();

REVOKE ALL ON FUNCTION ocr_private.guard_receipt_ocr_recovery_photo_update()
  FROM PUBLIC, anon, authenticated, service_role, privacy_workflow_owner;

CREATE FUNCTION ocr_private.receipt_ocr_recovery_acl_admitted_v1()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH required_functions(signature, owner_name, allowed_nonowner_name) AS (
    VALUES
      ('public.preview_review_receipt_ocr_indeterminate_recovery(uuid)'::text, 'privacy_workflow_owner'::name, 'service_role'::name),
      ('public.recover_review_receipt_ocr_indeterminate(uuid,uuid,uuid,uuid,text,jsonb,text,text,text,text)'::text, 'privacy_workflow_owner'::name, 'service_role'::name),
      ('public.authorize_review_receipt_ocr_execution(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text,text,text)'::text, 'privacy_workflow_owner'::name, 'service_role'::name),
      ('public.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)'::text, 'privacy_workflow_owner'::name, 'service_role'::name),
      ('public.claim_receipt_ocr_recovery_result(uuid,uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)'::text, 'privacy_workflow_owner'::name, 'service_role'::name),
      ('public.get_receipt_ocr_indeterminate_recovery_capability()'::text, 'privacy_workflow_owner'::name, 'service_role'::name),
      ('ocr_private.preview_review_receipt_ocr_indeterminate_recovery(uuid)'::text, 'postgres'::name, 'privacy_workflow_owner'::name),
      ('ocr_private.recover_review_receipt_ocr_indeterminate(uuid,uuid,uuid,uuid,text,jsonb,text,text,text,text)'::text, 'postgres'::name, 'privacy_workflow_owner'::name),
      ('ocr_private.authorize_review_receipt_ocr_execution(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text,text,text)'::text, 'postgres'::name, 'privacy_workflow_owner'::name),
      ('ocr_private.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)'::text, 'postgres'::name, 'privacy_workflow_owner'::name),
      ('ocr_private.claim_receipt_ocr_recovery_result(uuid,uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)'::text, 'postgres'::name, 'privacy_workflow_owner'::name),
      ('ocr_private.claim_receipt_ocr_result_core(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)'::text, 'postgres'::name, NULL::name),
      ('ocr_private.release_receipt_ocr_recovery_execution_lease()'::text, 'postgres'::name, NULL::name),
      ('ocr_private.guard_receipt_ocr_recovery_photo_update()'::text, 'postgres'::name, NULL::name),
      ('ocr_private.receipt_ocr_recovery_catalog_snapshot_v1()'::text, 'postgres'::name, NULL::name),
      ('ocr_private.get_receipt_ocr_indeterminate_recovery_capability()'::text, 'postgres'::name, 'privacy_workflow_owner'::name),
      ('ocr_private.receipt_ocr_recovery_acl_admitted_v1()'::text, 'postgres'::name, 'privacy_workflow_owner'::name)
  ),
  function_catalog AS (
    SELECT required.signature, procedure.oid, procedure.proowner,
      owner_role.oid AS expected_owner, allowed_role.oid AS allowed_nonowner
    FROM required_functions AS required
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.rolname = required.owner_name
    LEFT JOIN pg_catalog.pg_roles AS allowed_role ON allowed_role.rolname = required.allowed_nonowner_name
    LEFT JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(required.signature)
  ),
  actual_function_acl AS (
    SELECT function_row.signature, acl.grantor, acl.grantee,
      acl.privilege_type, acl.is_grantable
    FROM function_catalog AS function_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(
        (SELECT procedure.proacl FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = function_row.oid),
        pg_catalog.acldefault('f', function_row.proowner)
      )
    ) AS acl
  ),
  expected_function_acl AS (
    SELECT function_row.signature, acl.grantor, acl.grantee,
      acl.privilege_type, acl.is_grantable
    FROM function_catalog AS function_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      pg_catalog.acldefault('f', function_row.expected_owner)
    ) AS acl
    WHERE acl.grantee = function_row.expected_owner
    UNION ALL
    SELECT function_row.signature, function_row.expected_owner,
      function_row.allowed_nonowner, 'EXECUTE'::text, false
    FROM function_catalog AS function_row
    WHERE function_row.allowed_nonowner IS NOT NULL
  ),
  required_tables(relation_name, owner_name) AS (
    VALUES
      ('ocr_private.receipt_ocr_indeterminate_recoveries'::text, 'postgres'::name),
      ('ocr_private.receipt_ocr_recovery_execution_leases'::text, 'postgres'::name),
      ('ocr_private.receipt_ocr_recovery_catalog_contract'::text, 'postgres'::name)
  ),
  table_catalog AS (
    SELECT required.relation_name, relation.oid, relation.relowner,
      owner_role.oid AS expected_owner
    FROM required_tables AS required
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.rolname = required.owner_name
    LEFT JOIN pg_catalog.pg_class AS relation
      ON relation.oid = pg_catalog.to_regclass(required.relation_name)
  ),
  actual_table_acl AS (
    SELECT table_row.relation_name, acl.grantor, acl.grantee,
      acl.privilege_type, acl.is_grantable
    FROM table_catalog AS table_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(
        (SELECT relation.relacl FROM pg_catalog.pg_class AS relation WHERE relation.oid = table_row.oid),
        pg_catalog.acldefault('r', table_row.relowner)
      )
    ) AS acl
  ),
  expected_table_acl AS (
    SELECT table_row.relation_name, acl.grantor, acl.grantee,
      acl.privilege_type, acl.is_grantable
    FROM table_catalog AS table_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      pg_catalog.acldefault('r', table_row.expected_owner)
    ) AS acl
    WHERE acl.grantee = table_row.expected_owner
  )
  SELECT
    (SELECT pg_catalog.count(*) FROM function_catalog) = 17
    AND NOT EXISTS (
      SELECT 1 FROM function_catalog AS function_row
      WHERE function_row.oid IS NULL OR function_row.proowner IS DISTINCT FROM function_row.expected_owner
    )
    AND NOT EXISTS ((SELECT * FROM actual_function_acl) EXCEPT (SELECT * FROM expected_function_acl))
    AND NOT EXISTS ((SELECT * FROM expected_function_acl) EXCEPT (SELECT * FROM actual_function_acl))
    AND (SELECT pg_catalog.count(*) FROM table_catalog) = 3
    AND NOT EXISTS (
      SELECT 1 FROM table_catalog AS table_row
      WHERE table_row.oid IS NULL OR table_row.relowner IS DISTINCT FROM table_row.expected_owner
    )
    AND NOT EXISTS ((SELECT * FROM actual_table_acl) EXCEPT (SELECT * FROM expected_table_acl))
    AND NOT EXISTS ((SELECT * FROM expected_table_acl) EXCEPT (SELECT * FROM actual_table_acl));
$function$;

CREATE FUNCTION ocr_private.receipt_ocr_recovery_catalog_snapshot_v1()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  function_contract jsonb;
  table_contract jsonb;
  trigger_contract jsonb;
BEGIN
  SELECT pg_catalog.jsonb_object_agg(
           required.signature,
           pg_catalog.jsonb_build_object(
             'definition_sha256', pg_catalog.encode(
               extensions.digest(
                 pg_catalog.convert_to(pg_catalog.pg_get_functiondef(procedure.oid), 'UTF8'),
                 'sha256'
               ),
               'hex'
             ),
             'language', language.lanname,
             'volatility', procedure.provolatile::text,
             'securityDefiner', procedure.prosecdef,
             'configuration', procedure.proconfig,
             'owner', pg_catalog.pg_get_userbyid(procedure.proowner),
             'acl', (
               SELECT coalesce(
                        pg_catalog.jsonb_agg(
                          pg_catalog.jsonb_build_object(
                            'grantor', pg_catalog.pg_get_userbyid(acl.grantor),
                            'grantee', CASE
                              WHEN acl.grantee = 0 THEN 'PUBLIC'
                              ELSE pg_catalog.pg_get_userbyid(acl.grantee)::text
                            END,
                            'privilege', acl.privilege_type,
                            'grantable', acl.is_grantable
                          )
                          ORDER BY acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
                        ),
                        '[]'::jsonb
                      )
               FROM pg_catalog.aclexplode(
                 coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
               ) AS acl
             )
           )
           ORDER BY required.signature
         )
  INTO function_contract
  FROM (VALUES
    ('public.preview_review_receipt_ocr_indeterminate_recovery(uuid)'::text),
    ('public.recover_review_receipt_ocr_indeterminate(uuid,uuid,uuid,uuid,text,jsonb,text,text,text,text)'::text),
    ('public.authorize_review_receipt_ocr_execution(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text,text,text)'::text),
    ('public.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)'::text),
    ('public.claim_receipt_ocr_recovery_result(uuid,uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)'::text),
    ('public.get_receipt_ocr_indeterminate_recovery_capability()'::text),
    ('ocr_private.preview_review_receipt_ocr_indeterminate_recovery(uuid)'::text),
    ('ocr_private.recover_review_receipt_ocr_indeterminate(uuid,uuid,uuid,uuid,text,jsonb,text,text,text,text)'::text),
    ('ocr_private.authorize_review_receipt_ocr_execution(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text,text,text)'::text),
    ('ocr_private.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)'::text),
    ('ocr_private.claim_receipt_ocr_recovery_result(uuid,uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)'::text),
    ('ocr_private.claim_receipt_ocr_result_core(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)'::text),
    ('ocr_private.release_receipt_ocr_recovery_execution_lease()'::text),
    ('ocr_private.guard_receipt_ocr_recovery_photo_update()'::text),
    ('ocr_private.get_receipt_ocr_indeterminate_recovery_capability()'::text),
    ('ocr_private.receipt_ocr_recovery_acl_admitted_v1()'::text),
    ('ocr_private.receipt_ocr_recovery_catalog_snapshot_v1()'::text)
  ) AS required(signature)
  JOIN pg_catalog.pg_proc AS procedure
    ON procedure.oid = pg_catalog.to_regprocedure(required.signature)
  JOIN pg_catalog.pg_language AS language
    ON language.oid = procedure.prolang;

  SELECT pg_catalog.jsonb_object_agg(
           required.relation_name,
           pg_catalog.jsonb_build_object(
             'owner', pg_catalog.pg_get_userbyid(relation.relowner),
             'kind', relation.relkind::text,
             'rowSecurity', relation.relrowsecurity,
             'forceRowSecurity', relation.relforcerowsecurity,
             'acl', (
               SELECT coalesce(
                        pg_catalog.jsonb_agg(
                          pg_catalog.jsonb_build_object(
                            'grantor', pg_catalog.pg_get_userbyid(acl.grantor),
                            'grantee', CASE
                              WHEN acl.grantee = 0 THEN 'PUBLIC'
                              ELSE pg_catalog.pg_get_userbyid(acl.grantee)::text
                            END,
                            'privilege', acl.privilege_type,
                            'grantable', acl.is_grantable
                          )
                          ORDER BY acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
                        ),
                        '[]'::jsonb
                      )
               FROM pg_catalog.aclexplode(
                 coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
               ) AS acl
             ),
             'columns', (
               SELECT coalesce(
                        pg_catalog.jsonb_agg(
                          pg_catalog.jsonb_build_object(
                            'name', attribute.attname,
                            'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
                            'notNull', attribute.attnotnull,
                            'identity', attribute.attidentity::text,
                            'generated', attribute.attgenerated::text,
                            'default', pg_catalog.pg_get_expr(default_value.adbin, default_value.adrelid)
                          ) ORDER BY attribute.attnum
                        ),
                        '[]'::jsonb
                      )
               FROM pg_catalog.pg_attribute AS attribute
               LEFT JOIN pg_catalog.pg_attrdef AS default_value
                 ON default_value.adrelid = attribute.attrelid
                AND default_value.adnum = attribute.attnum
               WHERE attribute.attrelid = relation.oid
                 AND attribute.attnum > 0
                 AND NOT attribute.attisdropped
             ),
             'constraints', (
               SELECT coalesce(
                        pg_catalog.jsonb_agg(
                          pg_catalog.jsonb_build_object(
                            'name', constraint_row.conname,
                            'type', constraint_row.contype::text,
                            'definition', pg_catalog.pg_get_constraintdef(constraint_row.oid, false)
                          ) ORDER BY constraint_row.conname
                        ),
                        '[]'::jsonb
                      )
               FROM pg_catalog.pg_constraint AS constraint_row
               WHERE constraint_row.conrelid = relation.oid
             ),
             'policies', (
               SELECT coalesce(
                        pg_catalog.jsonb_agg(
                          pg_catalog.jsonb_build_object(
                            'name', policy.polname,
                            'permissive', policy.polpermissive,
                            'command', policy.polcmd::text,
                            'roles', (
                              SELECT coalesce(
                                       pg_catalog.jsonb_agg(
                                         CASE WHEN role_oid = 0 THEN 'PUBLIC'
                                           ELSE pg_catalog.pg_get_userbyid(role_oid)::text END
                                         ORDER BY role_oid
                                       ),
                                       '[]'::jsonb
                                     )
                              FROM pg_catalog.unnest(policy.polroles) AS role_value(role_oid)
                            ),
                            'using', pg_catalog.pg_get_expr(policy.polqual, policy.polrelid),
                            'withCheck', pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid)
                          ) ORDER BY policy.polname
                        ),
                        '[]'::jsonb
                      )
               FROM pg_catalog.pg_policy AS policy
               WHERE policy.polrelid = relation.oid
             )
           )
           ORDER BY required.relation_name
         )
  INTO table_contract
  FROM (VALUES
    ('ocr_private.receipt_ocr_indeterminate_recoveries'::text),
    ('ocr_private.receipt_ocr_recovery_execution_leases'::text),
    ('ocr_private.receipt_ocr_recovery_catalog_contract'::text)
  ) AS required(relation_name)
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = pg_catalog.to_regclass(required.relation_name);

  SELECT pg_catalog.jsonb_object_agg(
           required.trigger_key,
           pg_catalog.jsonb_build_object(
             'definition_sha256', pg_catalog.encode(
               extensions.digest(
                 pg_catalog.convert_to(pg_catalog.pg_get_triggerdef(trigger_row.oid, false), 'UTF8'),
                 'sha256'
               ),
               'hex'
             ),
             'enabled', trigger_row.tgenabled::text,
             'internal', trigger_row.tgisinternal,
             'function', trigger_row.tgfoid::pg_catalog.regprocedure::text
           )
           ORDER BY required.trigger_key
         )
  INTO trigger_contract
  FROM (VALUES
    ('public.reviews.receipt_ocr_recovery_photo_update_guard'::text, 'public.reviews'::pg_catalog.regclass, 'receipt_ocr_recovery_photo_update_guard'::name),
    ('ocr_private.receipt_results.receipt_ocr_recovery_execution_lease_release'::text, 'ocr_private.receipt_results'::pg_catalog.regclass, 'receipt_ocr_recovery_execution_lease_release'::name)
  ) AS required(trigger_key, relation_oid, trigger_name)
  JOIN pg_catalog.pg_trigger AS trigger_row
    ON trigger_row.tgrelid = required.relation_oid
   AND trigger_row.tgname = required.trigger_name
   AND NOT trigger_row.tgisinternal;

  RETURN pg_catalog.jsonb_build_object(
    'functions', function_contract,
    'tables', table_contract,
    'triggers', trigger_contract
  );
END;
$function$;

REVOKE ALL ON FUNCTION ocr_private.receipt_ocr_recovery_catalog_snapshot_v1()
  FROM PUBLIC, anon, authenticated, service_role, privacy_workflow_owner;

CREATE FUNCTION ocr_private.get_receipt_ocr_indeterminate_recovery_capability()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  catalog_contract ocr_private.receipt_ocr_recovery_catalog_contract%ROWTYPE;
  actual_snapshot jsonb;
  actual_ledger_count integer := 0;
  actual_ledger_identity_root text;
  ready boolean := false;
BEGIN
  SELECT * INTO catalog_contract
  FROM ocr_private.receipt_ocr_recovery_catalog_contract AS contract
  WHERE contract.capability_version = 'receipt-ocr-indeterminate-recovery-v1';
  IF NOT FOUND OR pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'schema_version', 1,
      'status', 'held',
      'capability_version', 'receipt-ocr-indeterminate-recovery-v1'
    );
  END IF;

  actual_snapshot := ocr_private.receipt_ocr_recovery_catalog_snapshot_v1();

  WITH ledger_identity AS (
    SELECT
      migration.version,
      migration.name,
      pg_catalog.octet_length(pg_catalog.convert_to(migration.version, 'UTF8'))::text
        || ':' || migration.version || pg_catalog.chr(31)
        || CASE WHEN migration.name IS NULL THEN '-1:'
          ELSE pg_catalog.octet_length(pg_catalog.convert_to(migration.name, 'UTF8'))::text
            || ':' || migration.name END
        || pg_catalog.chr(31)
        || pg_catalog.cardinality(migration.statements)::text
        || pg_catalog.chr(31)
        || pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(pg_catalog.array_to_json(migration.statements)::text, 'UTF8'),
            'sha256'
          ),
          'hex'
        ) AS row_material
    FROM supabase_migrations.schema_migrations AS migration
  )
  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.convert_to(
          coalesce(
            pg_catalog.string_agg(
              ledger_identity.row_material,
              pg_catalog.chr(30)
              ORDER BY ledger_identity.version COLLATE "C", ledger_identity.name COLLATE "C"
            ),
            ''
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )
  INTO actual_ledger_count, actual_ledger_identity_root
  FROM ledger_identity;

  ready := catalog_contract.migration_version IS NOT NULL
    AND catalog_contract.migration_name IS NOT NULL
    AND catalog_contract.statement_count IS NOT NULL
    AND catalog_contract.statement_vector_sha256 IS NOT NULL
    AND catalog_contract.predecessor_ledger_count = 107
    AND catalog_contract.predecessor_terminal_identity_root = 'cd04aebfc1efcc5588486adf3b7ba47fc5b5b76e39a9c23e316768f2919d9d9e'
    AND catalog_contract.ledger_count = 108
    AND catalog_contract.ledger_identity_root IS NOT NULL
    AND catalog_contract.sealed_at IS NOT NULL
    AND actual_snapshot->'functions' IS NOT NULL
    AND actual_snapshot->'functions' = catalog_contract.function_contract
    AND actual_snapshot->'tables' IS NOT NULL
    AND actual_snapshot->'tables' = catalog_contract.table_contract
    AND actual_snapshot->'triggers' IS NOT NULL
    AND actual_snapshot->'triggers' = catalog_contract.trigger_contract
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(actual_snapshot->'functions')) = 17
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(actual_snapshot->'tables')) = 3
    AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(actual_snapshot->'triggers')) = 2
    AND actual_ledger_count = catalog_contract.ledger_count
    AND actual_ledger_identity_root = catalog_contract.ledger_identity_root
    AND EXISTS (
      SELECT 1
      FROM supabase_migrations.schema_migrations AS migration
      WHERE migration.version = catalog_contract.migration_version
        AND migration.name = catalog_contract.migration_name
        AND pg_catalog.cardinality(migration.statements) = catalog_contract.statement_count
        AND pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(pg_catalog.array_to_json(migration.statements)::text, 'UTF8'),
            'sha256'
          ),
          'hex'
        ) = catalog_contract.statement_vector_sha256
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('public.reviews'::pg_catalog.regclass, 'receipt_ocr_recovery_photo_update_guard'::name),
        ('ocr_private.receipt_results'::pg_catalog.regclass, 'receipt_ocr_recovery_execution_lease_release'::name)
      ) AS required(relation_oid, trigger_name)
      LEFT JOIN pg_catalog.pg_trigger AS trigger_row
        ON trigger_row.tgrelid = required.relation_oid
       AND trigger_row.tgname = required.trigger_name
       AND NOT trigger_row.tgisinternal
      WHERE trigger_row.oid IS NULL OR trigger_row.tgenabled <> 'O'
    )
    AND EXISTS (
      SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist AS allowed
      WHERE allowed.source_signature = 'public.preview_review_receipt_ocr_indeterminate_recovery(uuid)'
        AND allowed.grantee = 'service_role'
    )
    AND EXISTS (
      SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist AS allowed
      WHERE allowed.source_signature = 'public.recover_review_receipt_ocr_indeterminate(uuid,uuid,uuid,uuid,text,jsonb,text,text,text,text)'
        AND allowed.grantee = 'service_role'
    )
    AND EXISTS (
      SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist AS allowed
      WHERE allowed.source_signature = 'public.authorize_review_receipt_ocr_execution(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text,text,text)'
        AND allowed.grantee = 'service_role'
    )
    AND EXISTS (
      SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist AS allowed
      WHERE allowed.source_signature = 'public.claim_receipt_ocr_recovery_result(uuid,uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)'
        AND allowed.grantee = 'service_role'
    )
    AND EXISTS (
      SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist AS allowed
      WHERE allowed.source_signature = 'public.get_receipt_ocr_indeterminate_recovery_capability()'
        AND allowed.grantee = 'service_role'
    )
    AND ocr_private.receipt_ocr_recovery_acl_admitted_v1();

  RETURN pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'status', CASE WHEN ready THEN 'ready' ELSE 'held' END,
    'capability_version', 'receipt-ocr-indeterminate-recovery-v1'
  );
END;
$function$;

REVOKE ALL ON FUNCTION ocr_private.preview_review_receipt_ocr_indeterminate_recovery(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ocr_private.recover_review_receipt_ocr_indeterminate(uuid,uuid,uuid,uuid,text,jsonb,text,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ocr_private.authorize_review_receipt_ocr_execution(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ocr_private.get_receipt_ocr_indeterminate_recovery_capability()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION ocr_private.receipt_ocr_recovery_acl_admitted_v1()
  FROM PUBLIC, anon, authenticated, service_role, privacy_workflow_owner;
REVOKE ALL ON FUNCTION ocr_private.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)
  FROM PUBLIC, anon, authenticated, service_role, privacy_workflow_owner;
REVOKE ALL ON FUNCTION ocr_private.claim_receipt_ocr_recovery_result(uuid,uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)
  FROM PUBLIC, anon, authenticated, service_role, privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION ocr_private.preview_review_receipt_ocr_indeterminate_recovery(uuid)
  TO privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION ocr_private.recover_review_receipt_ocr_indeterminate(uuid,uuid,uuid,uuid,text,jsonb,text,text,text,text)
  TO privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION ocr_private.authorize_review_receipt_ocr_execution(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text,text,text)
  TO privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION ocr_private.get_receipt_ocr_indeterminate_recovery_capability()
  TO privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION ocr_private.receipt_ocr_recovery_acl_admitted_v1()
  TO privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION ocr_private.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)
  TO privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION ocr_private.claim_receipt_ocr_recovery_result(uuid,uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)
  TO privacy_workflow_owner;

SET LOCAL ROLE privacy_workflow_owner;

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
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $wrapper$
  SELECT ocr_private.claim_receipt_ocr_result(
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
  );
$wrapper$;

CREATE FUNCTION public.claim_receipt_ocr_recovery_result(
  p_recovery_operation_id uuid,
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
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $wrapper$
  SELECT ocr_private.claim_receipt_ocr_recovery_result(
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
  );
$wrapper$;

CREATE FUNCTION public.preview_review_receipt_ocr_indeterminate_recovery(p_review_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $wrapper$
  SELECT ocr_private.preview_review_receipt_ocr_indeterminate_recovery($1);
$wrapper$;

CREATE FUNCTION public.recover_review_receipt_ocr_indeterminate(
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
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $wrapper$
  SELECT ocr_private.recover_review_receipt_ocr_indeterminate($1, $2, $3, $4, $5, $6, $7, $8, $9, $10);
$wrapper$;

CREATE FUNCTION public.authorize_review_receipt_ocr_execution(
  p_user_id uuid,
  p_review_id uuid,
  p_generation uuid,
  p_recovery_operation_id uuid,
  p_verification_photo_hash text,
  p_image_hash text,
  p_input_context_hash text,
  p_model_policy jsonb,
  p_thinking_level text,
  p_prompt_version text,
  p_preprocess_version text,
  p_normalization_version text
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $wrapper$
  SELECT ocr_private.authorize_review_receipt_ocr_execution(
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
  );
$wrapper$;

CREATE FUNCTION public.get_receipt_ocr_indeterminate_recovery_capability()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $wrapper$
  SELECT ocr_private.get_receipt_ocr_indeterminate_recovery_capability();
$wrapper$;

REVOKE ALL ON FUNCTION public.preview_review_receipt_ocr_indeterminate_recovery(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_review_receipt_ocr_indeterminate(uuid,uuid,uuid,uuid,text,jsonb,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.authorize_review_receipt_ocr_execution(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text,text,text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_receipt_ocr_indeterminate_recovery_capability()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_receipt_ocr_recovery_result(uuid,uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_review_receipt_ocr_indeterminate_recovery(uuid)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.recover_review_receipt_ocr_indeterminate(uuid,uuid,uuid,uuid,text,jsonb,text,text,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.authorize_review_receipt_ocr_execution(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text,text,text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.get_receipt_ocr_indeterminate_recovery_capability()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.claim_receipt_ocr_recovery_result(uuid,uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)
  TO service_role;

INSERT INTO privacy_retention.g014_public_rpc_allowlist (
  function_schema,
  function_name,
  identity_arguments,
  grantee,
  source_signature
)
SELECT
  namespace.nspname,
  procedure.proname,
  procedure.proargtypes::text,
  'service_role'::name,
  signature.source_signature
FROM (VALUES
  ('public.preview_review_receipt_ocr_indeterminate_recovery(uuid)'::text),
  ('public.recover_review_receipt_ocr_indeterminate(uuid,uuid,uuid,uuid,text,jsonb,text,text,text,text)'::text),
  ('public.authorize_review_receipt_ocr_execution(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text,text,text)'::text),
  ('public.claim_receipt_ocr_recovery_result(uuid,uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)'::text),
  ('public.get_receipt_ocr_indeterminate_recovery_capability()'::text)
) AS signature(source_signature)
JOIN pg_catalog.pg_proc AS procedure
  ON procedure.oid = pg_catalog.to_regprocedure(signature.source_signature)
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = procedure.pronamespace
ON CONFLICT (source_signature, grantee) DO UPDATE SET
  function_schema = EXCLUDED.function_schema,
  function_name = EXCLUDED.function_name,
  identity_arguments = EXCLUDED.identity_arguments;

INSERT INTO privacy_retention.g014_nested_helper_allowlist (source_signature)
VALUES
  ('ocr_private.preview_review_receipt_ocr_indeterminate_recovery(uuid)'),
  ('ocr_private.recover_review_receipt_ocr_indeterminate(uuid,uuid,uuid,uuid,text,jsonb,text,text,text,text)'),
  ('ocr_private.authorize_review_receipt_ocr_execution(uuid,uuid,uuid,uuid,text,text,text,jsonb,text,text,text,text)'),
  ('ocr_private.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)'),
  ('ocr_private.claim_receipt_ocr_recovery_result(uuid,uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)'),
  ('ocr_private.claim_receipt_ocr_result_core(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)'),
  ('ocr_private.release_receipt_ocr_recovery_execution_lease()'),
  ('ocr_private.guard_receipt_ocr_recovery_photo_update()'),
  ('ocr_private.receipt_ocr_recovery_catalog_snapshot_v1()'),
  ('ocr_private.get_receipt_ocr_indeterminate_recovery_capability()'),
  ('ocr_private.receipt_ocr_recovery_acl_admitted_v1()')
ON CONFLICT (source_signature) DO NOTHING;

DO $acl_readback$
BEGIN
  PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
  PERFORM privacy_retention.assert_g014_definer_contract();
  IF ocr_private.receipt_ocr_recovery_acl_admitted_v1() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_INITIAL_ACL_ADMISSION_FAILED';
  END IF;
  IF ocr_private.get_receipt_ocr_indeterminate_recovery_capability() IS DISTINCT FROM
    '{"schema_version":1,"status":"held","capability_version":"receipt-ocr-indeterminate-recovery-v1"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_HELD_READBACK_FAILED';
  END IF;
END;
$acl_readback$;

RESET ROLE;

INSERT INTO ocr_private.receipt_ocr_recovery_catalog_contract (
  capability_version,
  function_contract,
  table_contract,
  trigger_contract
)
SELECT
  'receipt-ocr-indeterminate-recovery-v1',
  snapshot.document->'functions',
  snapshot.document->'tables',
  snapshot.document->'triggers'
FROM (
  SELECT ocr_private.receipt_ocr_recovery_catalog_snapshot_v1() AS document
) AS snapshot
WHERE (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(snapshot.document->'functions')) = 17
  AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(snapshot.document->'tables')) = 3
  AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(snapshot.document->'triggers')) = 2;

DO $catalog_contract_installed$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM ocr_private.receipt_ocr_recovery_catalog_contract AS contract
    WHERE contract.capability_version = 'receipt-ocr-indeterminate-recovery-v1'
      AND contract.migration_version IS NULL
      AND contract.migration_name IS NULL
      AND contract.statement_count IS NULL
      AND contract.statement_vector_sha256 IS NULL
      AND contract.predecessor_ledger_count IS NULL
      AND contract.predecessor_terminal_identity_root IS NULL
      AND contract.ledger_count IS NULL
      AND contract.ledger_identity_root IS NULL
      AND contract.sealed_at IS NULL
      AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(contract.function_contract)) = 17
      AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(contract.table_contract)) = 3
      AND (SELECT pg_catalog.count(*) FROM pg_catalog.jsonb_object_keys(contract.trigger_contract)) = 2
  ) <> 1 THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_CATALOG_CONTRACT_INSTALL_FAILED';
  END IF;
END;
$catalog_contract_installed$;

SET LOCAL ROLE privacy_workflow_owner;

DO $unsealed_catalog_readback$
BEGIN
  IF ocr_private.get_receipt_ocr_indeterminate_recovery_capability() IS DISTINCT FROM
    '{"schema_version":1,"status":"held","capability_version":"receipt-ocr-indeterminate-recovery-v1"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_UNSEALED_CATALOG_READY';
  END IF;
END;
$unsealed_catalog_readback$;

RESET ROLE;

DO $restore_owner_lease$
DECLARE
  lease pg_temp.receipt_ocr_recovery108_owner_lease%ROWTYPE;
  after_members jsonb;
BEGIN
  SELECT * INTO STRICT lease
  FROM pg_temp.receipt_ocr_recovery108_owner_lease;

  IF lease.pg_major = 15 THEN
    IF lease.pg15_membership_lease THEN
      REVOKE privacy_workflow_owner FROM postgres;
    END IF;
  ELSIF lease.self_membership IS NULL THEN
    REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
  ELSE
    EXECUTE pg_catalog.format(
      'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT %s, SET %s GRANTED BY postgres',
      pg_catalog.upper(lease.self_membership->>'inherit_option'),
      pg_catalog.upper(lease.self_membership->>'set_option')
    );
  END IF;

  SELECT coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.to_jsonb(membership)
             ORDER BY membership.roleid, membership.member, membership.grantor
           ),
           '[]'::jsonb
         )
  INTO after_members
  FROM pg_catalog.pg_auth_members AS membership;

  IF after_members IS DISTINCT FROM lease.before_members THEN
    RAISE EXCEPTION 'RECEIPT_OCR_RECOVERY108_OWNER_LEASE_RESTORE_FAILED';
  END IF;
END;
$restore_owner_lease$;

COMMIT;
