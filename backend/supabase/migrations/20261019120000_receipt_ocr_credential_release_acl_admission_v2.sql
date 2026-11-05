-- Forward-only ACL admission for the frozen held 106 credential release.
-- Raw source stays held; the 105 -> 106 -> 107 operating artifact is compiled separately.
BEGIN;

SET LOCAL lock_timeout = '2s';
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('tzudong:receipt-ocr-credential-release-acl-admission:v2', 0)
);

-- BEGIN RECEIPT OCR 107 OPERATING ADMISSION
DO $prepare$
DECLARE
  actual_ledger_count integer;
  actual_ledger_identity_root text;
  pg_major integer := pg_catalog.current_setting('server_version_num')::integer / 10000;
BEGIN
  IF current_user <> 'postgres'
    OR session_user <> 'postgres'
    OR pg_major <> 17
    OR pg_catalog.current_setting('transaction_read_only') <> 'off'
    OR pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL
    OR pg_catalog.to_regclass('ocr_private.receipt_credential_rejection_releases') IS NULL
    OR pg_catalog.to_regclass('ocr_private.receipt_credential_release_catalog_contract') IS NULL
    OR pg_catalog.to_regprocedure('public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)') IS NULL
    OR pg_catalog.to_regprocedure('ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)') IS NULL
    OR pg_catalog.to_regprocedure('public.get_receipt_ocr_credential_release_capability()') IS NULL
    OR pg_catalog.to_regprocedure('ocr_private.get_receipt_ocr_credential_release_capability()') IS NULL
    OR pg_catalog.to_regprocedure('extensions.digest(bytea,text)') IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM ocr_private.receipt_credential_release_catalog_contract AS contract_row
      WHERE contract_row.capability_version = 'receipt-ocr-definitive-credential-release-v1'
    )
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_PREREQUISITE_DRIFT';
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

  IF actual_ledger_count <> 106
    OR actual_ledger_identity_root NOT IN (
      '83a1b91fa12541581e53dca933a12ca6c5aa4470dd70f912444d38dcd19522c1',
      'b6184e8b14977dcba0d66959d1ef266b29268f5420b86451a7d213b81d5c6e24'
    )
    OR (
      SELECT pg_catalog.count(*)
      FROM supabase_migrations.schema_migrations AS migration
      WHERE migration.version = '20261018152032'
        AND migration.name = 'receipt_ocr_definitive_credential_rejection_release'
        AND pg_catalog.cardinality(migration.statements) = 44
        AND pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(pg_catalog.array_to_json(migration.statements)::text, 'UTF8'),
            'sha256'
          ),
          'hex'
        ) = '54df90f1f3e6b23eb11b949d4c0d57856e02dcfb66fc998b5065cc424a34d14e'
    ) <> 1
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_LEDGER_DRIFT';
  END IF;
END;
$prepare$;
-- END RECEIPT OCR 107 OPERATING ADMISSION

CREATE TEMPORARY TABLE pg_temp.receipt_ocr_acl_v2_owner_lease (
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
    RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_OWNER_LEASE_PREREQUISITE_DRIFT';
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
    RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_SELF_MEMBERSHIP_DENIED';
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
      RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_OWNER_AUTHORITY_MISSING';
    END IF;
    EXECUTE 'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres';
  ELSE
    pg15_membership_lease := NOT pg_catalog.pg_has_role(runner, workflow_owner, 'MEMBER');
    IF pg15_membership_lease THEN
      GRANT privacy_workflow_owner TO postgres;
    END IF;
  END IF;

  INSERT INTO pg_temp.receipt_ocr_acl_v2_owner_lease (
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

CREATE FUNCTION ocr_private.receipt_credential_release_acl_admitted_v2()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH required_functions(signature, owner_name, allowed_nonowner_name) AS (
    VALUES
      ('public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'::text, 'privacy_workflow_owner'::name, 'service_role'::name),
      ('public.get_receipt_ocr_credential_release_capability()'::text, 'privacy_workflow_owner'::name, 'service_role'::name),
      ('ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'::text, 'postgres'::name, 'privacy_workflow_owner'::name),
      ('ocr_private.get_receipt_ocr_credential_release_capability()'::text, 'postgres'::name, 'privacy_workflow_owner'::name),
      ('ocr_private.receipt_credential_release_acl_admitted_v2()'::text, 'postgres'::name, 'privacy_workflow_owner'::name)
  ),
  function_catalog AS (
    SELECT
      required.signature,
      procedure.oid,
      procedure.proowner,
      owner_role.oid AS expected_owner,
      allowed_role.oid AS allowed_nonowner
    FROM required_functions AS required
    JOIN pg_catalog.pg_roles AS owner_role
      ON owner_role.rolname = required.owner_name
    LEFT JOIN pg_catalog.pg_roles AS allowed_role
      ON allowed_role.rolname = required.allowed_nonowner_name
    LEFT JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(required.signature)
  ),
  actual_function_acl AS (
    SELECT
      function_row.signature,
      acl.grantor,
      acl.grantee,
      acl.privilege_type,
      acl.is_grantable
    FROM function_catalog AS function_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(
        (SELECT procedure.proacl FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = function_row.oid),
        pg_catalog.acldefault('f', function_row.proowner)
      )
    ) AS acl
  ),
  expected_function_acl AS (
    SELECT
      function_row.signature,
      acl.grantor,
      acl.grantee,
      acl.privilege_type,
      acl.is_grantable
    FROM function_catalog AS function_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      pg_catalog.acldefault('f', function_row.expected_owner)
    ) AS acl
    WHERE acl.grantee = function_row.expected_owner
    UNION ALL
    SELECT
      function_row.signature,
      function_row.expected_owner,
      function_row.allowed_nonowner,
      'EXECUTE'::text,
      false
    FROM function_catalog AS function_row
    WHERE function_row.allowed_nonowner IS NOT NULL
  ),
  required_tables(relation_name, owner_name) AS (
    VALUES
      ('ocr_private.receipt_credential_rejection_releases'::text, 'postgres'::name),
      ('ocr_private.receipt_credential_release_catalog_contract'::text, 'postgres'::name)
  ),
  table_catalog AS (
    SELECT
      required.relation_name,
      relation.oid,
      relation.relowner,
      owner_role.oid AS expected_owner
    FROM required_tables AS required
    JOIN pg_catalog.pg_roles AS owner_role
      ON owner_role.rolname = required.owner_name
    LEFT JOIN pg_catalog.pg_class AS relation
      ON relation.oid = pg_catalog.to_regclass(required.relation_name)
  ),
  actual_table_acl AS (
    SELECT
      table_row.relation_name,
      acl.grantor,
      acl.grantee,
      acl.privilege_type,
      acl.is_grantable
    FROM table_catalog AS table_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(
        (SELECT relation.relacl FROM pg_catalog.pg_class AS relation WHERE relation.oid = table_row.oid),
        pg_catalog.acldefault('r', table_row.relowner)
      )
    ) AS acl
  ),
  expected_table_acl AS (
    SELECT
      table_row.relation_name,
      acl.grantor,
      acl.grantee,
      acl.privilege_type,
      acl.is_grantable
    FROM table_catalog AS table_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      pg_catalog.acldefault('r', table_row.expected_owner)
    ) AS acl
    WHERE acl.grantee = table_row.expected_owner
  )
  SELECT
    (SELECT pg_catalog.count(*) FROM function_catalog) = 5
    AND NOT EXISTS (
      SELECT 1
      FROM function_catalog AS function_row
      WHERE function_row.oid IS NULL
        OR function_row.proowner IS DISTINCT FROM function_row.expected_owner
    )
    AND NOT EXISTS (
      (SELECT * FROM actual_function_acl)
      EXCEPT
      (SELECT * FROM expected_function_acl)
    )
    AND NOT EXISTS (
      (SELECT * FROM expected_function_acl)
      EXCEPT
      (SELECT * FROM actual_function_acl)
    )
    AND (SELECT pg_catalog.count(*) FROM table_catalog) = 2
    AND NOT EXISTS (
      SELECT 1
      FROM table_catalog AS table_row
      WHERE table_row.oid IS NULL
        OR table_row.relowner IS DISTINCT FROM table_row.expected_owner
    )
    AND NOT EXISTS (
      (SELECT * FROM actual_table_acl)
      EXCEPT
      (SELECT * FROM expected_table_acl)
    )
    AND NOT EXISTS (
      (SELECT * FROM expected_table_acl)
      EXCEPT
      (SELECT * FROM actual_table_acl)
    );
$function$;

REVOKE ALL ON FUNCTION ocr_private.receipt_credential_release_acl_admitted_v2()
  FROM PUBLIC, anon, authenticated, service_role, privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION ocr_private.receipt_credential_release_acl_admitted_v2()
  TO privacy_workflow_owner;

DO $initial_acl_admission$
BEGIN
  IF ocr_private.receipt_credential_release_acl_admitted_v2() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_INITIAL_ADMISSION_FAILED';
  END IF;
END;
$initial_acl_admission$;

DO $replace_capability_version_check$
DECLARE
  constraint_count integer;
  constraint_name name;
BEGIN
  SELECT pg_catalog.count(*), min(constraint_row.conname::text)::name
  INTO constraint_count, constraint_name
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid =
      'ocr_private.receipt_credential_release_catalog_contract'::pg_catalog.regclass
    AND constraint_row.contype = 'c'
    AND constraint_row.conkey = ARRAY[
      (
        SELECT attribute.attnum
        FROM pg_catalog.pg_attribute AS attribute
        WHERE attribute.attrelid = constraint_row.conrelid
          AND attribute.attname = 'capability_version'
          AND attribute.attnum > 0
          AND NOT attribute.attisdropped
      )
    ]::smallint[];

  IF constraint_count <> 1 OR constraint_name IS NULL THEN
    RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_CAPABILITY_CHECK_DRIFT';
  END IF;
  EXECUTE pg_catalog.format(
    'ALTER TABLE ocr_private.receipt_credential_release_catalog_contract DROP CONSTRAINT %I',
    constraint_name
  );
END;
$replace_capability_version_check$;
ALTER TABLE ocr_private.receipt_credential_release_catalog_contract
  ADD CONSTRAINT receipt_credential_release_capability_version_v2_check CHECK (
    capability_version IN (
      'receipt-ocr-definitive-credential-release-v1',
      'receipt-ocr-definitive-credential-release-v2'
    )
  );

CREATE OR REPLACE FUNCTION ocr_private.release_receipt_ocr_definitive_credential_rejection(
  p_result_id uuid,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  durable_result ocr_private.receipt_results%ROWTYPE;
  prior_release ocr_private.receipt_credential_rejection_releases%ROWTYPE;
  release_disposition text;
BEGIN
  IF p_result_id IS NULL OR p_claim_token IS NULL THEN
    RAISE EXCEPTION 'receipt_ocr_credential_release_invalid' USING ERRCODE = '22023';
  END IF;


  IF ocr_private.get_receipt_ocr_credential_release_capability() IS DISTINCT FROM
    '{"schema_version":1,"status":"ready","capability_version":"receipt-ocr-definitive-credential-release-v2"}'::jsonb
  THEN
    RAISE EXCEPTION 'receipt_ocr_credential_release_capability_held' USING ERRCODE = '55000';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'receipt-ocr-definitive-credential-rejection:' || p_result_id::text,
      0
    )
  );

  SELECT *
  INTO prior_release
  FROM ocr_private.receipt_credential_rejection_releases AS release_row
  WHERE release_row.result_id = p_result_id
    AND release_row.claim_token = p_claim_token;

  IF FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'status', 'released',
      'result_ref', prior_release.result_id,
      'disposition', prior_release.disposition,
      'result_revision', prior_release.result_revision,
      'idempotent', true
    );
  END IF;

  SELECT *
  INTO durable_result
  FROM ocr_private.receipt_results AS result_row
  WHERE result_row.id = p_result_id
  FOR UPDATE;

  IF NOT FOUND
    OR durable_result.status <> 'processing'
    OR durable_result.dispatch_stage <> 'possibly_dispatched'
    OR durable_result.claim_token IS DISTINCT FROM p_claim_token
  THEN
    RAISE EXCEPTION 'receipt_ocr_claim_mismatch' USING ERRCODE = '42501';
  END IF;

  IF durable_result.result_payload IS NOT NULL
    AND (
      NOT ocr_private.valid_result_payload(durable_result.result_payload)
      OR durable_result.provider IS DISTINCT FROM durable_result.result_payload->>'provider'
      OR NOT (durable_result.model_policy ? (durable_result.result_payload->>'model'))
      OR durable_result.normalization_version IS DISTINCT FROM durable_result.result_payload->>'normalization_version'
    )
  THEN
    RAISE EXCEPTION 'receipt_ocr_claim_mismatch' USING ERRCODE = '42501';
  END IF;

  release_disposition := CASE
    WHEN durable_result.result_payload IS NULL THEN 'deleted'
    ELSE 'restored'
  END;

  INSERT INTO ocr_private.receipt_credential_rejection_releases (
    result_id,
    claim_token,
    disposition,
    result_revision
  ) VALUES (
    durable_result.id,
    p_claim_token,
    release_disposition,
    CASE WHEN release_disposition = 'restored' THEN durable_result.result_revision ELSE NULL END
  );

  IF release_disposition = 'restored' THEN
    UPDATE ocr_private.receipt_results AS result_row
    SET status = 'succeeded',
        dispatch_stage = 'completed',
        claim_token = NULL,
        completed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    WHERE result_row.id = p_result_id
      AND result_row.status = 'processing'
      AND result_row.dispatch_stage = 'possibly_dispatched'
      AND result_row.claim_token = p_claim_token
      AND result_row.result_payload IS NOT NULL
      AND result_row.result_revision IS NOT NULL;
  ELSE
    DELETE FROM ocr_private.receipt_results AS result_row
    WHERE result_row.id = p_result_id
      AND result_row.status = 'processing'
      AND result_row.dispatch_stage = 'possibly_dispatched'
      AND result_row.claim_token = p_claim_token
      AND result_row.result_payload IS NULL
      AND result_row.result_revision IS NULL;
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'receipt_ocr_claim_mismatch' USING ERRCODE = '42501';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'released',
    'result_ref', durable_result.id,
    'disposition', release_disposition,
    'result_revision', CASE
      WHEN release_disposition = 'restored' THEN durable_result.result_revision
      ELSE NULL
    END,
    'idempotent', false
  );
END;
$function$;

CREATE OR REPLACE FUNCTION ocr_private.get_receipt_ocr_credential_release_capability()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  catalog_contract ocr_private.receipt_credential_release_catalog_contract%ROWTYPE;
  contract_found boolean := false;
  actual_function_contract jsonb;
  actual_table_contract jsonb;
  actual_ledger_count integer := 0;
  actual_ledger_identity_root text;
  ready boolean := false;
  acl_admitted boolean := false;
BEGIN
  SELECT *
  INTO catalog_contract
  FROM ocr_private.receipt_credential_release_catalog_contract AS contract_row
  WHERE contract_row.capability_version = 'receipt-ocr-definitive-credential-release-v2';
  contract_found := FOUND;

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
                 coalesce(
                   procedure.proacl,
                   pg_catalog.acldefault('f', procedure.proowner)
                 )
               ) AS acl
             )
           )
           ORDER BY required.signature
         )
  INTO actual_function_contract
  FROM (VALUES
    ('public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'::text),
    ('ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'::text),
    ('public.get_receipt_ocr_credential_release_capability()'::text),
    ('ocr_private.get_receipt_ocr_credential_release_capability()'::text),
    ('ocr_private.receipt_credential_release_acl_admitted_v2()'::text)
  ) AS required(signature)
  JOIN pg_catalog.pg_proc AS procedure
    ON procedure.oid = pg_catalog.to_regprocedure(required.signature)
  JOIN pg_catalog.pg_language AS language
    ON language.oid = procedure.prolang;

  SELECT pg_catalog.jsonb_object_agg(
           required.relation_name,
           pg_catalog.jsonb_build_object(
             'owner', pg_catalog.pg_get_userbyid(relation.relowner),
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
                 coalesce(
                   relation.relacl,
                   pg_catalog.acldefault('r', relation.relowner)
                 )
               ) AS acl
             )
           )
           ORDER BY required.relation_name
         )
  INTO actual_table_contract
  FROM (VALUES
    ('ocr_private.receipt_credential_rejection_releases'::text),
    ('ocr_private.receipt_credential_release_catalog_contract'::text)
  ) AS required(relation_name)
  JOIN pg_catalog.pg_class AS relation
    ON relation.oid = pg_catalog.to_regclass(required.relation_name);

  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'schema_version', 1,
      'status', 'held',
      'capability_version', 'receipt-ocr-definitive-credential-release-v2'
    );
  END IF;

    WITH ledger_identity AS (
      SELECT
        migration.version,
        migration.name,
        pg_catalog.cardinality(migration.statements)::integer AS statement_count,
        pg_catalog.encode(
          extensions.digest(
            pg_catalog.convert_to(pg_catalog.array_to_json(migration.statements)::text, 'UTF8'),
            'sha256'
          ),
          'hex'
        ) AS statement_vector_sha256,
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


  SELECT ocr_private.receipt_credential_release_acl_admitted_v2()
  INTO acl_admitted;

  ready := contract_found
    AND acl_admitted
    AND catalog_contract.migration_version IS NOT NULL
    AND catalog_contract.migration_name IS NOT NULL
    AND catalog_contract.statement_count IS NOT NULL
    AND catalog_contract.statement_vector_sha256 IS NOT NULL
    AND catalog_contract.ledger_count IS NOT NULL
    AND catalog_contract.ledger_identity_root IS NOT NULL
    AND catalog_contract.sealed_at IS NOT NULL
    AND actual_function_contract IS NOT NULL
    AND actual_function_contract = catalog_contract.function_contract
    AND actual_table_contract IS NOT NULL
    AND actual_table_contract = catalog_contract.table_contract
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
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      WHERE relation.oid = pg_catalog.to_regclass(
        'ocr_private.receipt_credential_rejection_releases'
      )
        AND relation.relkind = 'r'
        AND relation.relrowsecurity
        AND relation.relforcerowsecurity
        AND (
          SELECT pg_catalog.count(*)
          FROM pg_catalog.pg_constraint AS constraint_row
          WHERE constraint_row.conrelid = relation.oid
            AND constraint_row.contype = 'p'
        ) = 1
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_constraint AS constraint_row
          WHERE constraint_row.conrelid = relation.oid
            AND constraint_row.contype = 'p'
            AND pg_catalog.pg_get_constraintdef(constraint_row.oid, false) =
              'PRIMARY KEY (result_id, claim_token)'
        )
        AND (
          SELECT pg_catalog.count(*)
          FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = relation.oid
        ) = 1
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = relation.oid
            AND policy.polname = 'receipt_credential_rejection_releases_owner_only'
            AND policy.polpermissive
            AND policy.polroles = ARRAY['postgres'::regrole::oid]
            AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) = 'true'
            AND pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) = 'true'
        )
    )
    AND EXISTS (
      SELECT 1
      FROM pg_catalog.pg_class AS relation
      WHERE relation.oid = pg_catalog.to_regclass(
        'ocr_private.receipt_credential_release_catalog_contract'
      )
        AND relation.relkind = 'r'
        AND relation.relrowsecurity
        AND relation.relforcerowsecurity
        AND (
          SELECT pg_catalog.count(*)
          FROM pg_catalog.pg_constraint AS constraint_row
          WHERE constraint_row.conrelid = relation.oid
            AND constraint_row.contype = 'p'
        ) = 1
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_constraint AS constraint_row
          WHERE constraint_row.conrelid = relation.oid
            AND constraint_row.contype = 'p'
            AND pg_catalog.pg_get_constraintdef(constraint_row.oid, false) =
              'PRIMARY KEY (capability_version)'
        )
        AND (
          SELECT pg_catalog.count(*)
          FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = relation.oid
        ) = 1
        AND EXISTS (
          SELECT 1
          FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = relation.oid
            AND policy.polname = 'receipt_credential_release_catalog_contract_owner_only'
            AND policy.polpermissive
            AND policy.polroles = ARRAY['postgres'::regrole::oid]
            AND pg_catalog.pg_get_expr(policy.polqual, policy.polrelid) = 'true'
            AND pg_catalog.pg_get_expr(policy.polwithcheck, policy.polrelid) = 'true'
        )
    )
    AND NOT pg_catalog.has_table_privilege(
      'service_role',
      'ocr_private.receipt_credential_rejection_releases',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    AND NOT pg_catalog.has_table_privilege(
      'service_role',
      'ocr_private.receipt_credential_release_catalog_contract',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM (VALUES
        ('public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'::text, 'privacy_workflow_owner'::name, 'sql'::name, 'v'::"char", true),
        ('ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'::text, 'postgres'::name, 'plpgsql'::name, 'v'::"char", false),
        ('public.get_receipt_ocr_credential_release_capability()'::text, 'privacy_workflow_owner'::name, 'sql'::name, 's'::"char", true),
        ('ocr_private.get_receipt_ocr_credential_release_capability()'::text, 'postgres'::name, 'plpgsql'::name, 's'::"char", false),
        ('ocr_private.receipt_credential_release_acl_admitted_v2()'::text, 'postgres'::name, 'sql'::name, 's'::"char", false)
      ) AS required(signature, owner_name, language_name, volatility, service_executable)
      LEFT JOIN pg_catalog.pg_proc AS procedure
        ON procedure.oid = pg_catalog.to_regprocedure(required.signature)
      LEFT JOIN pg_catalog.pg_language AS language
        ON language.oid = procedure.prolang
      WHERE procedure.oid IS NULL
        OR procedure.proowner <> required.owner_name::regrole
        OR NOT procedure.prosecdef
        OR procedure.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
        OR procedure.provolatile <> required.volatility
        OR language.lanname <> required.language_name
        OR pg_catalog.has_function_privilege('service_role', procedure.oid, 'EXECUTE') IS DISTINCT FROM required.service_executable
        OR pg_catalog.has_function_privilege('anon', procedure.oid, 'EXECUTE')
        OR pg_catalog.has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
    )
    AND EXISTS (
      SELECT 1
      FROM privacy_retention.g014_public_rpc_allowlist AS allowed
      WHERE allowed.source_signature = 'public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'
        AND allowed.grantee = 'service_role'
    )
    AND EXISTS (
      SELECT 1
      FROM privacy_retention.g014_nested_helper_allowlist AS allowed
      WHERE allowed.source_signature = 'ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'
    )
    AND EXISTS (
      SELECT 1
      FROM privacy_retention.g014_public_rpc_allowlist AS allowed
      WHERE allowed.source_signature = 'public.get_receipt_ocr_credential_release_capability()'
        AND allowed.grantee = 'service_role'
    )
    AND EXISTS (
      SELECT 1
      FROM privacy_retention.g014_nested_helper_allowlist AS allowed
      WHERE allowed.source_signature = 'ocr_private.get_receipt_ocr_credential_release_capability()'
    )
    AND EXISTS (
      SELECT 1
      FROM privacy_retention.g014_nested_helper_allowlist AS allowed
      WHERE allowed.source_signature = 'ocr_private.receipt_credential_release_acl_admitted_v2()'
    );

  RETURN pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'status', CASE WHEN ready THEN 'ready' ELSE 'held' END,
    'capability_version', 'receipt-ocr-definitive-credential-release-v2'
  );
END;
$function$;


REVOKE ALL ON FUNCTION ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid, uuid)
  TO privacy_workflow_owner;

REVOKE ALL ON FUNCTION ocr_private.get_receipt_ocr_credential_release_capability()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION ocr_private.get_receipt_ocr_credential_release_capability()
  TO privacy_workflow_owner;

SET LOCAL ROLE privacy_workflow_owner;

INSERT INTO privacy_retention.g014_nested_helper_allowlist (source_signature)
VALUES ('ocr_private.receipt_credential_release_acl_admitted_v2()')
ON CONFLICT (source_signature) DO NOTHING;

DO $post_replace_acl_admission$
BEGIN
  IF ocr_private.receipt_credential_release_acl_admitted_v2() IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_POST_REPLACE_ADMISSION_FAILED';
  END IF;
  PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
  PERFORM privacy_retention.assert_g014_definer_contract();
END;
$post_replace_acl_admission$;

RESET ROLE;

DO $restore_owner_lease$
DECLARE
  lease pg_temp.receipt_ocr_acl_v2_owner_lease%ROWTYPE;
  after_members jsonb;
BEGIN
  SELECT * INTO STRICT lease
  FROM pg_temp.receipt_ocr_acl_v2_owner_lease;

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
    RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_OWNER_LEASE_RESTORE_FAILED';
  END IF;
END;
$restore_owner_lease$;

INSERT INTO ocr_private.receipt_credential_release_catalog_contract (
  capability_version,
  function_contract,
  table_contract
)
SELECT
  'receipt-ocr-definitive-credential-release-v2',
  pg_catalog.jsonb_object_agg(
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
                 coalesce(
                   procedure.proacl,
                   pg_catalog.acldefault('f', procedure.proowner)
                 )
               ) AS acl
             )
    )
    ORDER BY required.signature
         ),
  (
    SELECT pg_catalog.jsonb_object_agg(
             required.relation_name,
             pg_catalog.jsonb_build_object(
               'owner', pg_catalog.pg_get_userbyid(relation.relowner),
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
                   coalesce(
                     relation.relacl,
                     pg_catalog.acldefault('r', relation.relowner)
                   )
                 ) AS acl
               )
             )
             ORDER BY required.relation_name
           )
    FROM (VALUES
      ('ocr_private.receipt_credential_rejection_releases'::text),
      ('ocr_private.receipt_credential_release_catalog_contract'::text)
    ) AS required(relation_name)
    JOIN pg_catalog.pg_class AS relation
      ON relation.oid = pg_catalog.to_regclass(required.relation_name)
  )
FROM (VALUES
  ('public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'::text),
  ('ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'::text),
  ('public.get_receipt_ocr_credential_release_capability()'::text),
  ('ocr_private.get_receipt_ocr_credential_release_capability()'::text),
  ('ocr_private.receipt_credential_release_acl_admitted_v2()'::text)
) AS required(signature)
JOIN pg_catalog.pg_proc AS procedure
  ON procedure.oid = pg_catalog.to_regprocedure(required.signature)
JOIN pg_catalog.pg_language AS language
  ON language.oid = procedure.prolang;

DO $catalog_contract_installed$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM ocr_private.receipt_credential_release_catalog_contract AS contract_row
    WHERE contract_row.capability_version = 'receipt-ocr-definitive-credential-release-v2'
      AND contract_row.migration_version IS NULL
      AND contract_row.migration_name IS NULL
      AND contract_row.statement_count IS NULL
      AND contract_row.statement_vector_sha256 IS NULL
      AND contract_row.ledger_count IS NULL
      AND contract_row.ledger_identity_root IS NULL
      AND contract_row.sealed_at IS NULL
      AND (
        SELECT pg_catalog.count(*)
        FROM pg_catalog.jsonb_object_keys(contract_row.function_contract)
      ) = 5
      AND (
        SELECT pg_catalog.count(*)
        FROM pg_catalog.jsonb_object_keys(contract_row.table_contract)
      ) = 2
  ) <> 1 THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_CATALOG_CONTRACT_INSTALL_FAILED';
  END IF;
END;
$catalog_contract_installed$;


DO $unsealed_capability$
BEGIN
  IF public.get_receipt_ocr_credential_release_capability() IS DISTINCT FROM
    '{"schema_version":1,"status":"held","capability_version":"receipt-ocr-definitive-credential-release-v2"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_UNSEALED_CAPABILITY_DRIFT';
  END IF;
END;
$unsealed_capability$;

COMMIT;
