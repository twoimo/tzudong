-- Forward-only safe release for a provider request that returned a definitive
-- credential rejection. This migration intentionally follows the frozen OCR
-- and G014 catalog chain instead of editing either applied predecessor.
BEGIN;

SET LOCAL lock_timeout = '2s';
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('tzudong:receipt-ocr-definitive-credential-rejection:v1', 0)
);

CREATE TEMPORARY TABLE pg_temp.receipt_ocr_credential_release_lease (
  pg_major integer NOT NULL,
  schema_lease boolean NOT NULL,
  pg15_membership_lease boolean NOT NULL,
  self_membership jsonb,
  before_members jsonb NOT NULL,
  before_public_schema jsonb NOT NULL,
  before_manifest jsonb NOT NULL
) ON COMMIT DROP;

DO $prepare$
DECLARE
  workflow_owner oid := 'privacy_workflow_owner'::regrole;
  runner oid := 'postgres'::regrole;
  pg_major integer := pg_catalog.current_setting('server_version_num')::integer / 10000;
  schema_lease boolean;
  pg15_membership_lease boolean := false;
  self_membership jsonb;
  before_members jsonb;
  before_public_schema jsonb;
  before_manifest jsonb;
BEGIN
  IF current_user <> 'postgres'
    OR session_user <> 'postgres'
    OR pg_major NOT IN (15, 17)
    OR pg_catalog.current_setting('transaction_read_only') <> 'off'
    OR pg_catalog.to_regclass('ocr_private.receipt_results') IS NULL
    OR pg_catalog.to_regclass('privacy_retention.g014_public_rpc_allowlist') IS NULL
    OR pg_catalog.to_regclass('privacy_retention.g014_nested_helper_allowlist') IS NULL
    OR pg_catalog.to_regprocedure('privacy_retention.assert_g014_public_rpc_allowlist()') IS NULL
    OR pg_catalog.to_regprocedure('privacy_retention.assert_g014_definer_contract()') IS NULL
    OR pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NULL
    OR pg_catalog.to_regprocedure('extensions.digest(bytea,text)') IS NULL
    OR pg_catalog.to_regprocedure('public.release_receipt_ocr_claim(uuid,uuid)') IS NULL
    OR pg_catalog.to_regprocedure('ocr_private.release_receipt_ocr_claim(uuid,uuid)') IS NULL
    OR pg_catalog.to_regprocedure('public.mark_receipt_ocr_dispatched(uuid,uuid)') IS NULL
    OR pg_catalog.to_regprocedure('ocr_private.mark_receipt_ocr_dispatched(uuid,uuid)') IS NULL
    OR pg_catalog.to_regprocedure('public.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)') IS NULL
    OR pg_catalog.to_regprocedure('ocr_private.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)') IS NULL
    OR pg_catalog.to_regprocedure('ocr_private.valid_result_payload(jsonb)') IS NULL
    OR pg_catalog.to_regclass('ocr_private.receipt_credential_rejection_releases') IS NOT NULL
    OR pg_catalog.to_regclass('ocr_private.receipt_credential_release_catalog_contract') IS NOT NULL
    OR pg_catalog.to_regprocedure('public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)') IS NOT NULL
    OR pg_catalog.to_regprocedure('ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)') IS NOT NULL
    OR pg_catalog.to_regprocedure('public.get_receipt_ocr_credential_release_capability()') IS NOT NULL
    OR pg_catalog.to_regprocedure('ocr_private.get_receipt_ocr_credential_release_capability()') IS NOT NULL
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
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_PREREQUISITE_DRIFT';
  END IF;

  SELECT coalesce(
           pg_catalog.jsonb_agg(pg_catalog.to_jsonb(membership) ORDER BY roleid, member, grantor),
           '[]'::jsonb
         )
  INTO before_members
  FROM pg_catalog.pg_auth_members AS membership;

  SELECT pg_catalog.to_jsonb(namespace)
  INTO before_public_schema
  FROM pg_catalog.pg_namespace AS namespace
  WHERE namespace.oid = 'public'::pg_catalog.regnamespace;

  SELECT coalesce(
           pg_catalog.jsonb_agg(
             pg_catalog.to_jsonb(manifest)
             ORDER BY manifest.manifest_kind, manifest.manifest_key
           ),
           '[]'::jsonb
         )
  INTO before_manifest
  FROM privacy_retention.g014_catalog_contract_manifest AS manifest;

  schema_lease := NOT pg_catalog.has_schema_privilege(
    workflow_owner,
    'public',
    'CREATE'
  );
  IF schema_lease THEN
    GRANT CREATE ON SCHEMA public TO privacy_workflow_owner;
  END IF;

  SELECT pg_catalog.to_jsonb(membership)
  INTO self_membership
  FROM pg_catalog.pg_auth_members AS membership
  WHERE membership.roleid = workflow_owner
    AND membership.member = runner
    AND membership.grantor = runner;

  IF self_membership IS NOT NULL
    AND (self_membership->>'admin_option')::boolean
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_SELF_MEMBERSHIP_DENIED';
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
      RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_OWNER_AUTHORITY_MISSING';
    END IF;
    EXECUTE 'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres';
  ELSE
    pg15_membership_lease := NOT pg_catalog.pg_has_role(runner, workflow_owner, 'MEMBER');
    IF pg15_membership_lease THEN
      GRANT privacy_workflow_owner TO postgres;
    END IF;
  END IF;

  INSERT INTO pg_temp.receipt_ocr_credential_release_lease (
    pg_major,
    schema_lease,
    pg15_membership_lease,
    self_membership,
    before_members,
    before_public_schema,
    before_manifest
  ) VALUES (
    pg_major,
    schema_lease,
    pg15_membership_lease,
    self_membership,
    before_members,
    before_public_schema,
    before_manifest
  );
END;
$prepare$;

GRANT SELECT ON TABLE pg_temp.receipt_ocr_credential_release_lease
  TO privacy_workflow_owner;

CREATE TABLE ocr_private.receipt_credential_rejection_releases (
  result_id uuid NOT NULL,
  claim_token uuid NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('deleted', 'restored')),
  result_revision uuid,
  released_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (result_id, claim_token),
  CONSTRAINT receipt_credential_rejection_release_revision_check CHECK (
    (disposition = 'deleted' AND result_revision IS NULL)
    OR (disposition = 'restored' AND result_revision IS NOT NULL)
  )
);

COMMENT ON TABLE ocr_private.receipt_credential_rejection_releases IS
  'Opaque idempotency receipts for safe release after a definitive provider credential rejection. No credentials, provider diagnostics, raw OCR, or user content are stored.';

ALTER TABLE ocr_private.receipt_credential_rejection_releases ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_private.receipt_credential_rejection_releases FORCE ROW LEVEL SECURITY;
CREATE POLICY receipt_credential_rejection_releases_owner_only
  ON ocr_private.receipt_credential_rejection_releases
  TO postgres
  USING (true)
  WITH CHECK (true);
REVOKE ALL ON TABLE ocr_private.receipt_credential_rejection_releases
  FROM PUBLIC, anon, authenticated, service_role, privacy_workflow_owner;

CREATE TABLE ocr_private.receipt_credential_release_catalog_contract (
  capability_version text PRIMARY KEY CHECK (
    capability_version = 'receipt-ocr-definitive-credential-release-v1'
  ),
  migration_version text,
  migration_name text,
  statement_count integer,
  statement_vector_sha256 text,
  ledger_count integer,
  ledger_identity_root text,
  function_contract jsonb NOT NULL,
  table_contract jsonb NOT NULL,
  sealed_at timestamptz,
  CONSTRAINT receipt_credential_release_catalog_seal_check CHECK (
    (
      migration_version IS NULL
      AND migration_name IS NULL
      AND statement_count IS NULL
      AND statement_vector_sha256 IS NULL
      AND ledger_count IS NULL
      AND ledger_identity_root IS NULL
      AND sealed_at IS NULL
    ) OR (
      migration_version ~ '^[0-9]{14}$'
      AND migration_name ~ '^[a-z0-9_]+$'
      AND statement_count > 0
      AND statement_vector_sha256 ~ '^[0-9a-f]{64}$'
      AND ledger_count > 0
      AND ledger_identity_root ~ '^[0-9a-f]{64}$'
      AND sealed_at IS NOT NULL
    )
  ),
  CONSTRAINT receipt_credential_release_function_contract_check CHECK (
    pg_catalog.jsonb_typeof(function_contract) = 'object'
  ),
  CONSTRAINT receipt_credential_release_table_contract_check CHECK (
    pg_catalog.jsonb_typeof(table_contract) = 'object'
  )
);

COMMENT ON TABLE ocr_private.receipt_credential_release_catalog_contract IS
  'Private runtime-definition seal installed by the migration and bound to the exact ledger identity only by the compiled 105-to-106 successor.';

ALTER TABLE ocr_private.receipt_credential_release_catalog_contract ENABLE ROW LEVEL SECURITY;
ALTER TABLE ocr_private.receipt_credential_release_catalog_contract FORCE ROW LEVEL SECURITY;
CREATE POLICY receipt_credential_release_catalog_contract_owner_only
  ON ocr_private.receipt_credential_release_catalog_contract
  TO postgres
  USING (true)
  WITH CHECK (true);
REVOKE ALL ON TABLE ocr_private.receipt_credential_release_catalog_contract
  FROM PUBLIC, anon, authenticated, service_role, privacy_workflow_owner;

CREATE FUNCTION ocr_private.release_receipt_ocr_definitive_credential_rejection(
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

REVOKE ALL ON FUNCTION ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid, uuid)
  TO privacy_workflow_owner;

CREATE FUNCTION ocr_private.get_receipt_ocr_credential_release_capability()
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
BEGIN
  SELECT *
  INTO catalog_contract
  FROM ocr_private.receipt_credential_release_catalog_contract AS contract_row
  WHERE contract_row.capability_version = 'receipt-ocr-definitive-credential-release-v1';
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
    ('ocr_private.get_receipt_ocr_credential_release_capability()'::text)
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

  IF pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
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
  END IF;

  ready := contract_found
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
        ('ocr_private.get_receipt_ocr_credential_release_capability()'::text, 'postgres'::name, 'plpgsql'::name, 's'::"char", false)
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
    );

  RETURN pg_catalog.jsonb_build_object(
    'schema_version', 1,
    'status', CASE WHEN ready THEN 'ready' ELSE 'held' END,
    'capability_version', 'receipt-ocr-definitive-credential-release-v1'
  );
END;
$function$;

REVOKE ALL ON FUNCTION ocr_private.get_receipt_ocr_credential_release_capability()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION ocr_private.get_receipt_ocr_credential_release_capability()
  TO privacy_workflow_owner;

SET LOCAL ROLE privacy_workflow_owner;

CREATE FUNCTION public.release_receipt_ocr_definitive_credential_rejection(
  p_result_id uuid,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $wrapper$
  SELECT ocr_private.release_receipt_ocr_definitive_credential_rejection($1, $2);
$wrapper$;

CREATE FUNCTION public.get_receipt_ocr_credential_release_capability()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $wrapper$
  SELECT ocr_private.get_receipt_ocr_credential_release_capability();
$wrapper$;

REVOKE ALL ON FUNCTION public.release_receipt_ocr_definitive_credential_rejection(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_receipt_ocr_definitive_credential_rejection(uuid, uuid)
  TO service_role;
REVOKE ALL ON FUNCTION public.get_receipt_ocr_credential_release_capability()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_receipt_ocr_credential_release_capability()
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
  ('public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'::text),
  ('public.get_receipt_ocr_credential_release_capability()'::text)
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
  ('ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'),
  ('ocr_private.get_receipt_ocr_credential_release_capability()')
ON CONFLICT (source_signature) DO NOTHING;

CREATE FUNCTION pg_temp.receipt_ocr_credential_release_assert()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $bridge$
BEGIN
  PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
  PERFORM privacy_retention.assert_g014_definer_contract();
  DROP FUNCTION pg_temp.receipt_ocr_credential_release_assert();
END;
$bridge$;
REVOKE ALL ON FUNCTION pg_temp.receipt_ocr_credential_release_assert()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.receipt_ocr_credential_release_assert() TO postgres;

DO $manifest_unchanged$
BEGIN
  IF (
    SELECT coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(manifest)
               ORDER BY manifest.manifest_kind, manifest.manifest_key
             ),
             '[]'::jsonb
           )
    FROM privacy_retention.g014_catalog_contract_manifest AS manifest
  ) IS DISTINCT FROM (
    SELECT lease.before_manifest
    FROM pg_temp.receipt_ocr_credential_release_lease AS lease
  ) THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_MANIFEST_DRIFT';
  END IF;
END;
$manifest_unchanged$;

RESET ROLE;

INSERT INTO ocr_private.receipt_credential_release_catalog_contract (
  capability_version,
  function_contract,
  table_contract
)
SELECT
  'receipt-ocr-definitive-credential-release-v1',
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
  ('ocr_private.get_receipt_ocr_credential_release_capability()'::text)
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
    WHERE contract_row.capability_version = 'receipt-ocr-definitive-credential-release-v1'
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
      ) = 4
      AND (
        SELECT pg_catalog.count(*)
        FROM pg_catalog.jsonb_object_keys(contract_row.table_contract)
      ) = 2
  ) <> 1 THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_CATALOG_CONTRACT_INSTALL_FAILED';
  END IF;
END;
$catalog_contract_installed$;

DO $restore_lease$
DECLARE
  lease pg_temp.receipt_ocr_credential_release_lease%ROWTYPE;
BEGIN
  SELECT * INTO lease
  FROM pg_temp.receipt_ocr_credential_release_lease;

  IF lease.schema_lease THEN
    REVOKE CREATE ON SCHEMA public FROM privacy_workflow_owner;
  END IF;

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
END;
$restore_lease$;

SELECT pg_temp.receipt_ocr_credential_release_assert();

DO $readback$
DECLARE
  wrapper_oid oid := pg_catalog.to_regprocedure(
    'public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'
  );
  helper_oid oid := pg_catalog.to_regprocedure(
    'ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'
  );
  capability_wrapper_oid oid := pg_catalog.to_regprocedure(
    'public.get_receipt_ocr_credential_release_capability()'
  );
  capability_helper_oid oid := pg_catalog.to_regprocedure(
    'ocr_private.get_receipt_ocr_credential_release_capability()'
  );
  lease pg_temp.receipt_ocr_credential_release_lease%ROWTYPE;
BEGIN
  SELECT * INTO lease
  FROM pg_temp.receipt_ocr_credential_release_lease;

  IF pg_catalog.to_regprocedure('pg_temp.receipt_ocr_credential_release_assert()') IS NOT NULL
    OR wrapper_oid IS NULL
    OR helper_oid IS NULL
    OR capability_wrapper_oid IS NULL
    OR capability_helper_oid IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      WHERE procedure.oid = wrapper_oid
        AND procedure.proowner = 'privacy_workflow_owner'::regrole
        AND procedure.prosecdef
        AND procedure.provolatile = 'v'
        AND procedure.proconfig = ARRAY['search_path=""']::text[]
        AND procedure.prolang = (
          SELECT language.oid FROM pg_catalog.pg_language AS language WHERE language.lanname = 'sql'
        )
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      WHERE procedure.oid = helper_oid
        AND procedure.proowner = 'postgres'::regrole
        AND procedure.prosecdef
        AND procedure.provolatile = 'v'
        AND procedure.proconfig = ARRAY['search_path=""']::text[]
        AND procedure.prolang = (
          SELECT language.oid FROM pg_catalog.pg_language AS language WHERE language.lanname = 'plpgsql'
        )
    )
    OR NOT pg_catalog.has_function_privilege('service_role', wrapper_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', wrapper_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', wrapper_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', helper_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', helper_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', helper_oid, 'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role', capability_wrapper_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('anon', capability_wrapper_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated', capability_wrapper_oid, 'EXECUTE')
    OR pg_catalog.has_function_privilege('service_role', capability_helper_oid, 'EXECUTE')
    OR pg_catalog.has_table_privilege(
      'service_role',
      'ocr_private.receipt_credential_rejection_releases',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    OR pg_catalog.has_table_privilege(
      'service_role',
      'ocr_private.receipt_credential_release_catalog_contract',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM privacy_retention.g014_public_rpc_allowlist AS allowed
      WHERE allowed.source_signature = 'public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'
        AND allowed.grantee = 'service_role'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM privacy_retention.g014_nested_helper_allowlist AS allowed
      WHERE allowed.source_signature = 'ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM privacy_retention.g014_public_rpc_allowlist AS allowed
      WHERE allowed.source_signature = 'public.get_receipt_ocr_credential_release_capability()'
        AND allowed.grantee = 'service_role'
    )
    OR NOT EXISTS (
      SELECT 1
      FROM privacy_retention.g014_nested_helper_allowlist AS allowed
      WHERE allowed.source_signature = 'ocr_private.get_receipt_ocr_credential_release_capability()'
    )
    OR ocr_private.get_receipt_ocr_credential_release_capability() IS DISTINCT FROM
      '{"schema_version":1,"status":"held","capability_version":"receipt-ocr-definitive-credential-release-v1"}'::jsonb
    OR (
      SELECT coalesce(
               pg_catalog.jsonb_agg(pg_catalog.to_jsonb(membership) ORDER BY roleid, member, grantor),
               '[]'::jsonb
             )
      FROM pg_catalog.pg_auth_members AS membership
    ) IS DISTINCT FROM lease.before_members
    OR (
      SELECT pg_catalog.to_jsonb(namespace)
      FROM pg_catalog.pg_namespace AS namespace
      WHERE namespace.oid = 'public'::pg_catalog.regnamespace
    ) IS DISTINCT FROM lease.before_public_schema
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_CREDENTIAL_RELEASE_READBACK_DRIFT';
  END IF;
END;
$readback$;

COMMIT;
