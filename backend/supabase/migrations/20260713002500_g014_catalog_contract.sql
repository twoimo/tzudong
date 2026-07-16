-- G014-06: final fail-closed catalog promotion gate.
-- This migration validates every outstanding G014 CHECK/FK only after the
-- preceding deployment has completed its hosted cleanup/preflight. Any invalid
-- legacy row is a deployment blocker, never a NOTICE fallback.

DO $validate_g014_constraints$
DECLARE
  v_constraint record;
BEGIN
  FOR v_constraint IN
    SELECT namespace.nspname AS schema_name,
           relation_row.relname AS relation_name,
           constraint_row.conname
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_class AS relation_row ON relation_row.oid = constraint_row.conrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation_row.relnamespace
    WHERE namespace.nspname IN ('public', 'privacy_retention')
      AND constraint_row.conname LIKE 'g014\_%' ESCAPE '\'
      AND constraint_row.contype IN ('c', 'f')
      AND NOT constraint_row.convalidated
    ORDER BY namespace.nspname, relation_row.relname, constraint_row.conname
  LOOP
    EXECUTE pg_catalog.format(
      'ALTER TABLE %I.%I VALIDATE CONSTRAINT %I',
      v_constraint.schema_name,
      v_constraint.relation_name,
      v_constraint.conname
    );
  END LOOP;
END;
$validate_g014_constraints$;
-- The old five-argument finalizer cannot safely prove a provider outcome. It
-- deliberately raised in G014-03; remove the obsolete overload rather than
-- leaving an RPC alias that PostgREST could resolve unexpectedly.
DELETE FROM privacy_retention.g014_public_rpc_allowlist
WHERE source_signature = 'public.finalize_marketing_campaign_batch(uuid,uuid,uuid,text,uuid[])';

DROP FUNCTION IF EXISTS public.finalize_marketing_campaign_batch(uuid,uuid,uuid,text,uuid[]);
-- The catalog manifest is a one-time, append-only baseline from the completed
-- G014 migration sequence. It deliberately excludes only itself; every
-- protected relation is listed below and every structural projection is
-- compared in both directions on later assertions.
CREATE TABLE IF NOT EXISTS privacy_retention.g014_catalog_contract_manifest (
  manifest_kind text NOT NULL,
  manifest_key jsonb NOT NULL,
  manifest_value jsonb NOT NULL,
  PRIMARY KEY (manifest_kind, manifest_key)
);

ALTER TABLE privacy_retention.g014_catalog_contract_manifest
  OWNER TO privacy_workflow_owner;
ALTER TABLE privacy_retention.g014_catalog_contract_manifest ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_retention.g014_catalog_contract_manifest FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE privacy_retention.g014_catalog_contract_manifest
  FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE privacy_retention.g014_catalog_contract_manifest
  TO privacy_workflow_owner;
DROP POLICY IF EXISTS g014_privacy_workflow_owner_access
  ON privacy_retention.g014_catalog_contract_manifest;
CREATE POLICY g014_privacy_workflow_owner_access
  ON privacy_retention.g014_catalog_contract_manifest
  FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION privacy_retention.g014_catalog_protected_relations()
RETURNS TABLE(schema_name name, relation_name name)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT expected.schema_name::name, expected.relation_name::name
  FROM (VALUES
    ('public', 'notifications'),
    ('public', 'marketing_campaign_operations'),
    ('public', 'marketing_campaign_recipients'),
    ('public', 'marketing_campaign_batches'),
    ('public', 'account_deletion_policies'),
    ('public', 'account_deletion_data_classes'),
    ('public', 'account_deletion_requests'),
    ('public', 'account_deletion_request_items'),
    ('public', 'privacy_incidents'),
    ('public', 'privacy_incident_transition_previews'),
    ('public', 'privacy_incident_notices'),
    ('public', 'privacy_incident_actions'),
    ('public', 'admin_audit_events'),
    ('privacy_retention', 'privacy_policy_versions'),
    ('privacy_retention', 'privacy_onboarding_challenges'),
    ('privacy_retention', 'privacy_guardian_verifications'),
    ('privacy_retention', 'privacy_age_profiles'),
    ('privacy_retention', 'privacy_consent_events'),
    ('privacy_retention', 'privacy_audit_events'),
    ('privacy_retention', 'g014_public_rpc_allowlist'),
    ('privacy_retention', 'g014_nested_helper_allowlist'),
    ('privacy_retention', 'tzuyang_address_evidence_admin_approval_receipts'),
    ('privacy_retention', 'privacy_onboarding_compensation_holds'),
    ('privacy_retention', 'marketing_campaign_batch_recipients'),
    ('privacy_retention', 'marketing_campaign_consent_evidence_keys'),
    ('privacy_retention', 'marketing_campaign_provider_attempts'),
    ('privacy_retention', 'account_deletion_adapter_registry'),
    ('privacy_retention', 'account_deletion_source_manifest'),
    ('privacy_retention', 'account_deletion_hold_class_map'),
    ('privacy_retention', 'account_deletion_client_cleanup_contracts'),
    ('privacy_retention', 'account_deletion_admin_guard'),
    ('privacy_retention', 'account_deletion_policy_activation_history'),
    ('privacy_retention', 'account_deletion_policy_publications'),
    ('privacy_retention', 'account_deletion_admin_reservations'),
    ('privacy_retention', 'account_deletion_external_phase_leases'),
    ('privacy_retention', 'account_deletion_evidence_cleanup_leases'),
    ('privacy_retention', 'account_deletion_evidence_separations'),
    ('privacy_retention', 'account_deletion_storage_objects'),
    ('privacy_retention', 'account_deletion_provider_receipt_proofs'),
    ('privacy_retention', 'account_deletion_storage_receipts'),
    ('privacy_retention', 'account_deletion_external_jobs'),
    ('privacy_retention', 'account_deletion_external_job_attempts'),
    ('privacy_retention', 'account_deletion_external_job_checkpoints'),
    ('privacy_retention', 'account_deletion_external_job_provider_proofs'),
    ('privacy_retention', 'privacy_retention_classes'),
    ('privacy_retention', 'privacy_retention_class_sources'),
    ('privacy_retention', 'privacy_legal_holds'),
    ('privacy_retention', 'privacy_retention_work_items'),
    ('privacy_retention', 'privacy_retained_records'),
    ('privacy_retention', 'privacy_retention_runs'),
    ('privacy_retention', 'privacy_retention_run_items'),
    ('privacy_retention', 'retention_adapter_registry'),
    ('privacy_retention', 'retention_adapter_versions'),
    ('privacy_retention', 'retention_class_adapter_bindings'),
    ('privacy_retention', 'retention_adapter_approvals'),
    ('privacy_retention', 'retention_adapter_approval_consumptions'),
    ('privacy_retention', 'g014_retention_storage_claims'),
    ('privacy_retention', 'g014_retention_provider_effects'),
    ('privacy_retention', 'g014_retention_receipts')
  ) AS expected(schema_name, relation_name);
$function$;
DO $g014_harden_public_catalog_relations$
DECLARE
  v_relation regclass;
BEGIN
  FOR v_relation IN
    SELECT pg_catalog.to_regclass(
      pg_catalog.format('%I.%I', expected.schema_name, expected.relation_name)
    )
    FROM privacy_retention.g014_catalog_protected_relations() AS expected
    WHERE expected.schema_name = 'public'
  LOOP
    IF v_relation IS NULL THEN
      RAISE EXCEPTION 'G014 protected public relation is missing';
    END IF;
    EXECUTE pg_catalog.format('ALTER TABLE %s OWNER TO privacy_workflow_owner', v_relation);
    EXECUTE pg_catalog.format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', v_relation);
    EXECUTE pg_catalog.format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', v_relation);
    EXECUTE pg_catalog.format(
      'REVOKE INSERT, UPDATE, DELETE ON TABLE %s FROM service_role',
      v_relation
    );
    EXECUTE pg_catalog.format(
      'DROP POLICY IF EXISTS g014_catalog_owner_access ON %s',
      v_relation
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY g014_catalog_owner_access ON %s FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true)',
      v_relation
    );
  END LOOP;
END;
$g014_harden_public_catalog_relations$;
CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_catalog_security_baseline()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'public.account_deletion_requests'::regclass
      AND attribute.attname = 'source_manifest_hash'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attnotnull
      AND attribute.atttypid = 'text'::regtype
  ) THEN
    RAISE EXCEPTION 'G014 source_manifest_hash must be NOT NULL';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'public.account_deletion_requests'::regclass
      AND constraint_row.conname = 'g014_account_deletion_applied_receipt_check'
      AND constraint_row.contype = 'c'
      AND constraint_row.convalidated
  ) THEN
    RAISE EXCEPTION 'G014 applied deletion receipt CHECK is missing or unvalidated';
  END IF;

  -- G014 grants no column privileges on protected relations. This source-declared
  -- zero-row contract runs before a first manifest can be persisted, so an
  -- inherited browser/service-role column grant cannot become its own baseline.
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.g014_catalog_protected_relations() AS expected
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.nspname = expected.schema_name
    JOIN pg_catalog.pg_class AS relation_row
      ON relation_row.relnamespace = namespace.oid
     AND relation_row.relname = expected.relation_name
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relation_row.oid
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
  ) THEN
    RAISE EXCEPTION 'G014 protected column ACL baseline drifted';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.g014_catalog_protected_relations() AS expected
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.nspname = expected.schema_name
    JOIN pg_catalog.pg_class AS relation_row
      ON relation_row.relnamespace = namespace.oid
     AND relation_row.relname = expected.relation_name
    WHERE expected.schema_name = 'privacy_retention'
      AND (
        pg_catalog.pg_get_userbyid(relation_row.relowner) IS DISTINCT FROM 'privacy_workflow_owner'
        OR NOT relation_row.relrowsecurity
        OR NOT relation_row.relforcerowsecurity
        OR NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_policy AS policy_row
          JOIN pg_catalog.unnest(policy_row.polroles) AS policy_role(role_oid) ON true
          JOIN pg_catalog.pg_roles AS role_row ON role_row.oid = policy_role.role_oid
          WHERE policy_row.polrelid = relation_row.oid
            AND role_row.rolname = 'privacy_workflow_owner'
        )
      )
  ) THEN
    RAISE EXCEPTION 'G014 private catalog security baseline drifted';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM privacy_retention.g014_catalog_protected_relations() AS expected
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.nspname = expected.schema_name
    JOIN pg_catalog.pg_class AS relation_row
      ON relation_row.relnamespace = namespace.oid
     AND relation_row.relname = expected.relation_name
    WHERE expected.schema_name = 'public'
      AND (
        pg_catalog.pg_get_userbyid(relation_row.relowner) IS DISTINCT FROM 'privacy_workflow_owner'
        OR NOT relation_row.relrowsecurity
        OR NOT relation_row.relforcerowsecurity
        OR NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_policy AS policy_row
          JOIN pg_catalog.unnest(policy_row.polroles) AS policy_role(role_oid) ON true
          JOIN pg_catalog.pg_roles AS role_row ON role_row.oid = policy_role.role_oid
          WHERE policy_row.polrelid = relation_row.oid
            AND role_row.rolname = 'privacy_workflow_owner'
        )
        OR pg_catalog.has_table_privilege('service_role', relation_row.oid, 'INSERT')
        OR pg_catalog.has_table_privilege('service_role', relation_row.oid, 'UPDATE')
        OR pg_catalog.has_table_privilege('service_role', relation_row.oid, 'DELETE')
      )
  ) THEN
    RAISE EXCEPTION 'G014 public catalog security baseline drifted';
  END IF;
END;
$function$;


CREATE OR REPLACE FUNCTION privacy_retention.g014_catalog_manifest_rows()
RETURNS TABLE(manifest_kind text, manifest_key jsonb, manifest_value jsonb)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  WITH protected_relation AS (
    SELECT * FROM privacy_retention.g014_catalog_protected_relations()
  ),
  relation_row AS (
    SELECT
      protected_relation.schema_name,
      protected_relation.relation_name,
      class_row.oid,
      class_row.relkind,
      class_row.relowner,
      class_row.relrowsecurity,
      class_row.relforcerowsecurity,
      class_row.relacl
    FROM protected_relation
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.nspname = protected_relation.schema_name
    JOIN pg_catalog.pg_class AS class_row
      ON class_row.relnamespace = namespace.oid
     AND class_row.relname = protected_relation.relation_name
     AND class_row.relkind IN ('r', 'p')
  )
  SELECT
    'relation',
    pg_catalog.jsonb_build_object(
      'schema', relation_row.schema_name,
      'relation', relation_row.relation_name
    ),
    pg_catalog.jsonb_build_object(
      'kind', relation_row.relkind,
      'owner', pg_catalog.pg_get_userbyid(relation_row.relowner),
      'rls_enabled', relation_row.relrowsecurity,
      'rls_forced', relation_row.relforcerowsecurity
    )
  FROM relation_row

  UNION ALL

  SELECT
    'column',
    pg_catalog.jsonb_build_object(
      'schema', relation_row.schema_name,
      'relation', relation_row.relation_name,
      'column', attribute.attname
    ),
    pg_catalog.jsonb_build_object(
      'position', attribute.attnum,
      'type', pg_catalog.format_type(attribute.atttypid, attribute.atttypmod),
      'not_null', attribute.attnotnull,
      'default', COALESCE(
        pg_catalog.pg_get_expr(attribute_default.adbin, attribute_default.adrelid, false),
        ''
      ),
      'identity', attribute.attidentity,
      'generated', attribute.attgenerated
    )
  FROM relation_row
  JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = relation_row.oid
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef AS attribute_default
    ON attribute_default.adrelid = attribute.attrelid
   AND attribute_default.adnum = attribute.attnum

  UNION ALL

  SELECT
    'column_grant',
    pg_catalog.jsonb_build_object(
      'schema', relation_row.schema_name,
      'relation', relation_row.relation_name,
      'column', attribute.attname,
      'grantee', CASE
        WHEN acl.grantee = 0 THEN 'PUBLIC'
        ELSE pg_catalog.pg_get_userbyid(acl.grantee)
      END,
      'grantor', CASE
        WHEN acl.grantor = 0 THEN 'PUBLIC'
        ELSE pg_catalog.pg_get_userbyid(acl.grantor)
      END,
      'privilege', acl.privilege_type
    ),
    pg_catalog.jsonb_build_object('grantable', acl.is_grantable)
  FROM relation_row
  JOIN pg_catalog.pg_attribute AS attribute
    ON attribute.attrelid = relation_row.oid
   AND attribute.attnum > 0
   AND NOT attribute.attisdropped
  CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl

  UNION ALL

  SELECT
    'policy',
    pg_catalog.jsonb_build_object(
      'schema', relation_row.schema_name,
      'relation', relation_row.relation_name,
      'policy', policy_row.polname
    ),
    pg_catalog.jsonb_build_object(
      'command', policy_row.polcmd::text,
      'permissive', policy_row.polpermissive,
      'roles', COALESCE((
        SELECT pg_catalog.jsonb_agg(
          CASE
            WHEN policy_role.role_oid = 0 THEN 'PUBLIC'
            ELSE role_row.rolname
          END
          ORDER BY CASE
            WHEN policy_role.role_oid = 0 THEN 'PUBLIC'
            ELSE role_row.rolname
          END
        )
        FROM pg_catalog.unnest(policy_row.polroles) AS policy_role(role_oid)
        LEFT JOIN pg_catalog.pg_roles AS role_row ON role_row.oid = policy_role.role_oid
      ), '[]'::jsonb),
      'using', COALESCE(
        pg_catalog.pg_get_expr(policy_row.polqual, policy_row.polrelid, false),
        ''
      ),
      'with_check', COALESCE(
        pg_catalog.pg_get_expr(policy_row.polwithcheck, policy_row.polrelid, false),
        ''
      )
    )
  FROM relation_row
  JOIN pg_catalog.pg_policy AS policy_row ON policy_row.polrelid = relation_row.oid

  UNION ALL

  SELECT
    'grant',
    pg_catalog.jsonb_build_object(
      'schema', relation_row.schema_name,
      'relation', relation_row.relation_name,
      'grantee', CASE
        WHEN acl.grantee = 0 THEN 'PUBLIC'
        ELSE pg_catalog.pg_get_userbyid(acl.grantee)
      END,
      'grantor', CASE
        WHEN acl.grantor = 0 THEN 'PUBLIC'
        ELSE pg_catalog.pg_get_userbyid(acl.grantor)
      END,
      'privilege', acl.privilege_type
    ),
    pg_catalog.jsonb_build_object('grantable', acl.is_grantable)
  FROM relation_row
  CROSS JOIN LATERAL pg_catalog.aclexplode(
    COALESCE(relation_row.relacl, pg_catalog.acldefault('r', relation_row.relowner))
  ) AS acl

  UNION ALL

  SELECT
    'constraint',
    pg_catalog.jsonb_build_object(
      'schema', relation_row.schema_name,
      'relation', relation_row.relation_name,
      'constraint', constraint_row.conname
    ),
    pg_catalog.jsonb_build_object(
      'type', constraint_row.contype::text,
      'definition', pg_catalog.pg_get_constraintdef(constraint_row.oid, false),
      'validated', constraint_row.convalidated,
      'deferrable', constraint_row.condeferrable,
      'deferred', constraint_row.condeferred
    )
  FROM relation_row
  JOIN pg_catalog.pg_constraint AS constraint_row
    ON constraint_row.conrelid = relation_row.oid
   AND constraint_row.contype IN ('c', 'p', 'u', 'x')

  UNION ALL

  SELECT
    'foreign_key',
    pg_catalog.jsonb_build_object(
      'schema', relation_row.schema_name,
      'relation', relation_row.relation_name,
      'constraint', foreign_key.conname
    ),
    pg_catalog.jsonb_build_object(
      'referenced_schema', referenced_namespace.nspname,
      'referenced_relation', referenced_relation.relname,
      'columns', COALESCE((
        SELECT pg_catalog.jsonb_agg(local_attribute.attname ORDER BY local_key.ordinality)
        FROM pg_catalog.unnest(foreign_key.conkey) WITH ORDINALITY
          AS local_key(attnum, ordinality)
        JOIN pg_catalog.pg_attribute AS local_attribute
          ON local_attribute.attrelid = foreign_key.conrelid
         AND local_attribute.attnum = local_key.attnum
      ), '[]'::jsonb),
      'referenced_columns', COALESCE((
        SELECT pg_catalog.jsonb_agg(referenced_attribute.attname ORDER BY referenced_key.ordinality)
        FROM pg_catalog.unnest(foreign_key.confkey) WITH ORDINALITY
          AS referenced_key(attnum, ordinality)
        JOIN pg_catalog.pg_attribute AS referenced_attribute
          ON referenced_attribute.attrelid = foreign_key.confrelid
         AND referenced_attribute.attnum = referenced_key.attnum
      ), '[]'::jsonb),
      'on_update', foreign_key.confupdtype::text,
      'on_delete', foreign_key.confdeltype::text,
      'match', foreign_key.confmatchtype::text,
      'validated', foreign_key.convalidated,
      'deferrable', foreign_key.condeferrable,
      'deferred', foreign_key.condeferred
    )
  FROM relation_row
  JOIN pg_catalog.pg_constraint AS foreign_key
    ON foreign_key.conrelid = relation_row.oid
   AND foreign_key.contype = 'f'
  JOIN pg_catalog.pg_class AS referenced_relation
    ON referenced_relation.oid = foreign_key.confrelid
  JOIN pg_catalog.pg_namespace AS referenced_namespace
    ON referenced_namespace.oid = referenced_relation.relnamespace

  UNION ALL

  SELECT
    'index',
    pg_catalog.jsonb_build_object(
      'schema', relation_row.schema_name,
      'relation', relation_row.relation_name,
      'index', index_relation.relname,
      'index_schema', index_namespace.nspname
    ),
    pg_catalog.jsonb_build_object(
      'access_method', access_method.amname,
      'keys', COALESCE((
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.pg_get_indexdef(index_relation.oid, key_position.key_number, false)
          ORDER BY key_position.ordinality
        )
        FROM pg_catalog.generate_series(1, index_row.indnkeyatts::integer)
          WITH ORDINALITY AS key_position(key_number, ordinality)
      ), '[]'::jsonb),
      'included_columns', COALESCE((
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.pg_get_indexdef(index_relation.oid, include_position.key_number, false)
          ORDER BY include_position.ordinality
        )
        FROM pg_catalog.generate_series(
          index_row.indnkeyatts::integer + 1,
          index_row.indnatts::integer
        ) WITH ORDINALITY AS include_position(key_number, ordinality)
      ), '[]'::jsonb),
      'unique', index_row.indisunique,
      'primary', index_row.indisprimary,
      'valid', index_row.indisvalid,
      'predicate', COALESCE(
        pg_catalog.pg_get_expr(index_row.indpred, index_row.indrelid, false),
        ''
      )
    )
  FROM relation_row
  JOIN pg_catalog.pg_index AS index_row ON index_row.indrelid = relation_row.oid
  JOIN pg_catalog.pg_class AS index_relation ON index_relation.oid = index_row.indexrelid
  JOIN pg_catalog.pg_namespace AS index_namespace ON index_namespace.oid = index_relation.relnamespace
  JOIN pg_catalog.pg_am AS access_method ON access_method.oid = index_relation.relam

  UNION ALL

  SELECT
    'trigger',
    pg_catalog.jsonb_build_object(
      'schema', relation_row.schema_name,
      'relation', relation_row.relation_name,
      'trigger', trigger_row.tgname
    ),
    pg_catalog.jsonb_build_object(
      'timing', CASE
        WHEN trigger_row.tgtype & 2 <> 0 THEN 'BEFORE'
        WHEN trigger_row.tgtype & 64 <> 0 THEN 'INSTEAD OF'
        ELSE 'AFTER'
      END,
      'events', (
        SELECT COALESCE(
          pg_catalog.jsonb_agg(event_matrix.event_name ORDER BY event_matrix.sort_order),
          '[]'::jsonb
        )
        FROM (VALUES
          (1, 'INSERT', trigger_row.tgtype & 4 <> 0),
          (2, 'DELETE', trigger_row.tgtype & 8 <> 0),
          (3, 'UPDATE', trigger_row.tgtype & 16 <> 0),
          (4, 'TRUNCATE', trigger_row.tgtype & 32 <> 0)
        ) AS event_matrix(sort_order, event_name, enabled)
        WHERE event_matrix.enabled
      ),
      'level', CASE WHEN trigger_row.tgtype & 1 <> 0 THEN 'ROW' ELSE 'STATEMENT' END,
      'enabled', trigger_row.tgenabled::text,
      'function', pg_catalog.format(
        '%I.%I(%s)',
        function_namespace.nspname,
        function_row.proname,
        pg_catalog.pg_get_function_identity_arguments(function_row.oid)
      ),
      'definition', pg_catalog.pg_get_triggerdef(trigger_row.oid, false)
    )
  FROM relation_row
  JOIN pg_catalog.pg_trigger AS trigger_row
    ON trigger_row.tgrelid = relation_row.oid
   AND NOT trigger_row.tgisinternal
  JOIN pg_catalog.pg_proc AS function_row ON function_row.oid = trigger_row.tgfoid
  JOIN pg_catalog.pg_namespace AS function_namespace
    ON function_namespace.oid = function_row.pronamespace;
$function$;

ALTER FUNCTION privacy_retention.g014_catalog_protected_relations()
  OWNER TO privacy_workflow_owner;
ALTER FUNCTION privacy_retention.g014_catalog_manifest_rows()
  OWNER TO privacy_workflow_owner;
ALTER FUNCTION privacy_retention.assert_g014_catalog_security_baseline()
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_catalog_protected_relations()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION privacy_retention.g014_catalog_manifest_rows()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION privacy_retention.assert_g014_catalog_security_baseline()
  FROM PUBLIC, anon, authenticated, service_role;

DO $initialize_g014_catalog_manifest$
BEGIN
  PERFORM privacy_retention.assert_g014_catalog_security_baseline();
  IF EXISTS (
    WITH expected AS (
      SELECT * FROM privacy_retention.g014_catalog_protected_relations()
    ),
    actual AS (
      SELECT namespace.nspname::name AS schema_name, relation_row.relname::name AS relation_name
      FROM pg_catalog.pg_class AS relation_row
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation_row.relnamespace
      WHERE relation_row.relkind IN ('r', 'p')
        AND (
          (namespace.nspname = 'privacy_retention'
            AND relation_row.relname <> 'g014_catalog_contract_manifest')
          OR EXISTS (
            SELECT 1
            FROM expected
            WHERE expected.schema_name = namespace.nspname
              AND expected.relation_name = relation_row.relname
          )
        )
    )
    SELECT 1
    FROM (
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    ) AS relation_drift
  ) THEN
    RAISE EXCEPTION 'G014 protected relation catalog drifted before manifest capture';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM privacy_retention.g014_catalog_contract_manifest
  ) THEN
    INSERT INTO privacy_retention.g014_catalog_contract_manifest (
      manifest_kind, manifest_key, manifest_value
    )
    SELECT manifest_kind, manifest_key, manifest_value
    FROM privacy_retention.g014_catalog_manifest_rows();
  END IF;
END;
$initialize_g014_catalog_manifest$;

DROP TRIGGER IF EXISTS g014_catalog_manifest_immutable
  ON privacy_retention.g014_catalog_contract_manifest;
CREATE TRIGGER g014_catalog_manifest_immutable
BEFORE UPDATE OR DELETE ON privacy_retention.g014_catalog_contract_manifest
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_account_deletion_append_only();

CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_catalog_manifest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF EXISTS (
    WITH expected AS (
      SELECT * FROM privacy_retention.g014_catalog_protected_relations()
    ),
    actual AS (
      SELECT namespace.nspname::name AS schema_name, relation_row.relname::name AS relation_name
      FROM pg_catalog.pg_class AS relation_row
      JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation_row.relnamespace
      WHERE relation_row.relkind IN ('r', 'p')
        AND (
          (namespace.nspname = 'privacy_retention'
            AND relation_row.relname <> 'g014_catalog_contract_manifest')
          OR EXISTS (
            SELECT 1
            FROM expected
            WHERE expected.schema_name = namespace.nspname
              AND expected.relation_name = relation_row.relname
          )
        )
    )
    SELECT 1
    FROM (
      (SELECT * FROM expected EXCEPT SELECT * FROM actual)
      UNION ALL
      (SELECT * FROM actual EXCEPT SELECT * FROM expected)
    ) AS relation_drift
  ) THEN
    RAISE EXCEPTION 'G014 protected relation catalog drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM privacy_retention.g014_catalog_contract_manifest
  ) THEN
    RAISE EXCEPTION 'G014 catalog manifest is missing';
  END IF;

  IF EXISTS (
    (
      SELECT manifest_kind, manifest_key, manifest_value
      FROM privacy_retention.g014_catalog_contract_manifest
      EXCEPT
      SELECT manifest_kind, manifest_key, manifest_value
      FROM privacy_retention.g014_catalog_manifest_rows()
    )
    UNION ALL
    (
      SELECT manifest_kind, manifest_key, manifest_value
      FROM privacy_retention.g014_catalog_manifest_rows()
      EXCEPT
      SELECT manifest_kind, manifest_key, manifest_value
      FROM privacy_retention.g014_catalog_contract_manifest
    )
  ) THEN
    RAISE EXCEPTION 'G014 exact catalog manifest drifted';
  END IF;
END;
$function$;

ALTER FUNCTION privacy_retention.assert_g014_catalog_manifest()
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.assert_g014_catalog_manifest()
  FROM PUBLIC, anon, authenticated, service_role;

-- The catalog assertion is deliberately exhaustive and fail-closed: any
-- missing, renamed, widened, or unexpectedly overloaded G014 object blocks
-- promotion rather than being repaired implicitly against hosted state.

CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_catalog_contract()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_expected record;
  v_procedure oid;
  v_search_path text;
  v_is_definer boolean;
  v_auth_users_oid oid;
  v_auth_users_count integer;
  v_auth_dependency_missing text;
  v_auth_dependency_unexpected text;
BEGIN
  PERFORM privacy_retention.assert_g014_workflow_owner_contract();
  PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
  PERFORM privacy_retention.assert_g014_definer_contract();

  IF pg_catalog.has_schema_privilege('anon', 'public', 'CREATE')
     OR pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'G014 browser/public CREATE privilege remains';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('anon'::name), ('authenticated'::name), ('service_role'::name))
      AS role_matrix(grantee)
    WHERE pg_catalog.has_schema_privilege(role_matrix.grantee, 'privacy_retention', 'USAGE')
       OR pg_catalog.has_schema_privilege(role_matrix.grantee, 'privacy_retention', 'CREATE')
  ) THEN
    RAISE EXCEPTION 'G014 private schema privilege remains';
  END IF;

  PERFORM privacy_retention.assert_g014_catalog_manifest();
  PERFORM privacy_retention.assert_g014_catalog_security_baseline();

  IF EXISTS (
    SELECT 1
    FROM public.account_deletion_requests AS request_row
    WHERE request_row.status = 'applied'
      AND (
        request_row.db_readback_passed IS DISTINCT FROM true
        OR request_row.session_readback_passed IS DISTINCT FROM true
        OR request_row.storage_readback_passed IS DISTINCT FROM true
        OR request_row.auth_readback_passed IS DISTINCT FROM true
        OR request_row.auth_receipt_ref IS NULL
        OR request_row.auth_receipt_ref !~ '^auth:[0-9a-f]{64}$'
        OR request_row.applied_at IS NULL
      )
  ) THEN
    RAISE EXCEPTION 'G014 applied account deletion receipt/readback invariant drifted';
  END IF;
  -- Freeze the final G014-facing RPC matrix explicitly. The persisted allowlist
  -- still covers pre-G014 application RPCs; this subset prevents a later
  -- migration from retaining an obsolete privacy, notification, deletion, or
  -- retention overload under the same public name.
  IF EXISTS (
    WITH expected(source_signature, grantee) AS (
      VALUES
        ('public.get_current_privacy_policy_version()', 'authenticated'::name),
        ('public.get_current_privacy_policy_version()', 'service_role'::name),
        ('public.create_privacy_onboarding_challenge(text,uuid,text,jsonb,text,timestamptz)', 'service_role'::name),
        ('public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)', 'service_role'::name),
        ('public.submit_privacy_consent(text,text,text,uuid,text,text,uuid,text,uuid)', 'authenticated'::name),
        ('public.record_privacy_guardian_verification(uuid,uuid,text,text,text,timestamptz,timestamptz)', 'service_role'::name),
        ('public.read_privacy_guardian_status(uuid)', 'service_role'::name),
        ('public.append_privacy_audit_event(text,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb)', 'service_role'::name),
        ('public.publish_privacy_policy_version(text,text,text,timestamptz,uuid,text,text)', 'service_role'::name),
        ('public.transition_privacy_onboarding_challenge(uuid,text,text,uuid,text)', 'service_role'::name),
        ('public.submit_guardian_privacy_consent(text,text,text,uuid,text,uuid,text,uuid)', 'service_role'::name),
        ('public.hold_privacy_onboarding_compensation(uuid,uuid,text,text)', 'service_role'::name),
        ('public.get_current_privacy_eligibility()', 'authenticated'::name),
        ('public.get_privacy_eligibility_for_user(uuid)', 'service_role'::name),
        ('public.create_user_notification(uuid,text,text,text,jsonb)', 'authenticated'::name),
        ('public.mark_notification_read(uuid)', 'authenticated'::name),
        ('public.mark_all_notifications_read()', 'authenticated'::name),
        ('public.delete_notification(uuid)', 'authenticated'::name),
        ('public.create_admin_transactional_notification(uuid,uuid,text,text,text,jsonb)', 'service_role'::name),
        ('public.create_review_like_notification(uuid,uuid,uuid)', 'service_role'::name),
        ('public.evaluate_notification_marketing_permission(uuid,text,timestamptz,text)', 'service_role'::name),
        ('public.marketing_campaign_receipt(uuid)', 'service_role'::name),
        ('public.preview_marketing_campaign(uuid,text,uuid[],text,text,jsonb,text,timestamptz)', 'service_role'::name),
        ('public.prepare_marketing_campaign_batch(uuid,uuid,text,text,integer,text)', 'service_role'::name),
        ('public.claim_marketing_campaign_dispatch(uuid,uuid,uuid,text,text,text)', 'service_role'::name),
        ('public.fail_marketing_campaign_batch(uuid,uuid,uuid,text,text)', 'service_role'::name),
        ('public.fail_marketing_campaign_provider_attempt(uuid,uuid,uuid,text,uuid,uuid,text,text,text,text)', 'service_role'::name),
        ('public.finalize_marketing_campaign_batch(uuid,uuid,uuid,text,uuid,uuid,text,text,text,uuid[],text)', 'service_role'::name),
        ('public.preview_account_deletion(uuid,uuid,timestamptz)', 'service_role'::name),
        ('public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)', 'service_role'::name),
        ('public.apply_account_deletion_database_cleanup(uuid,uuid,uuid,text,text,text)', 'service_role'::name),
        ('public.claim_account_deletion_external_job(uuid,uuid,uuid,text,text,text,text,uuid)', 'service_role'::name),
        ('public.prepare_account_deletion_external_egress(uuid,uuid,uuid,text,text,text,text,uuid)', 'service_role'::name),
        ('public.read_account_deletion_external_job(uuid,uuid,uuid,text,text,text,text,uuid)', 'service_role'::name),
        ('public.run_account_deletion_session_family_cleanup(uuid,uuid,uuid,text,text,text,uuid)', 'service_role'::name),
        ('public.get_account_deletion_storage_work(uuid,uuid,uuid,text,text,text,uuid)', 'service_role'::name),
        ('public.record_account_deletion_external_provider_proof(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text)', 'service_role'::name),
        ('public.reconcile_account_deletion_storage_job(uuid,uuid,uuid,text,text,text,uuid)', 'service_role'::name),
        ('public.reconcile_account_deletion_auth_job(uuid,uuid,uuid,text,text,text,uuid)', 'service_role'::name),
        ('public.claim_next_account_deletion_external_job()', 'service_role'::name),
        ('public.read_current_account_deletion_status(uuid,text,text)', 'authenticated'::name),
        ('public.fail_account_deletion(uuid,uuid,uuid,text,text,text,text)', 'service_role'::name),
        ('public.preview_privacy_retention_run(text,timestamptz,integer,integer)', 'service_role'::name),
        ('public.confirm_privacy_retention_run(uuid,text,text,text)', 'service_role'::name),
        ('public.apply_privacy_retention_run(uuid,text,text,integer)', 'service_role'::name),
        ('public.claim_privacy_retention_storage_items(uuid,text,text,integer)', 'service_role'::name),
        ('public.resolve_privacy_retention_provider_effect(uuid,text,text,uuid,uuid,text,text,text,text,text,text)', 'service_role'::name),
        ('public.get_privacy_retention_provider_reconciliation_work(uuid,text,text,text,integer)', 'service_role'::name),
        ('public.record_privacy_retention_storage_provider_receipts(uuid,text,text,jsonb)', 'service_role'::name),
        ('public.fail_privacy_retention_storage_claims(uuid,text,text,uuid[],text)', 'service_role'::name),
        ('public.finalize_privacy_retention_run(uuid,text,text)', 'service_role'::name)
    )
    SELECT 1
    FROM expected
    LEFT JOIN privacy_retention.g014_public_rpc_allowlist AS allowed
      ON allowed.source_signature = expected.source_signature
     AND allowed.grantee = expected.grantee
    WHERE allowed.source_signature IS NULL
  ) THEN
    RAISE EXCEPTION 'G014 final public RPC allowlist is missing an exact required identity';
  END IF;
  -- Every G014 implementation/helper has the same trusted owner and an empty
  -- lookup path. SECURITY INVOKER trigger helpers are intentionally permitted,
  -- but may not regain an ambient search_path.
  FOR v_expected IN
    SELECT procedure.oid, namespace.nspname, procedure.proname
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname IN ('public', 'privacy_retention')
      AND procedure.proname LIKE 'g014\_%' ESCAPE '\'
  LOOP
    SELECT setting.value INTO v_search_path
    FROM pg_catalog.unnest((
      SELECT procedure.proconfig FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_expected.oid
    )) AS setting(value)
    WHERE setting.value LIKE 'search_path=%';
    IF pg_catalog.pg_get_userbyid((
         SELECT procedure.proowner FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_expected.oid
       )) IS DISTINCT FROM 'privacy_workflow_owner'
       OR (v_search_path IS DISTINCT FROM 'search_path=' AND v_search_path IS DISTINCT FROM 'search_path=""') THEN
      RAISE EXCEPTION 'G014 helper owner/search_path mismatch: %.%',
        v_expected.nspname, v_expected.proname;
    END IF;
  END LOOP;

  -- All exposed public overloads are exact allowlist identities. This catches an
  -- added overload even when its ACL is otherwise empty; callers must never gain
  -- a silent alias due to PostgREST overload resolution.
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND EXISTS (
        SELECT 1
        FROM privacy_retention.g014_public_rpc_allowlist AS allowed
        WHERE allowed.function_schema = namespace.nspname
          AND allowed.function_name = procedure.proname
      )
      AND NOT EXISTS (
        SELECT 1
        FROM privacy_retention.g014_public_rpc_allowlist AS allowed
        WHERE allowed.function_schema = namespace.nspname
          AND allowed.function_name = procedure.proname
          AND allowed.identity_arguments = procedure.proargtypes::text
      )
  ) THEN
    RAISE EXCEPTION 'G014 public RPC has an unexpected overload';
  END IF;

  FOR v_expected IN
    SELECT allowed.source_signature, allowed.grantee
    FROM privacy_retention.g014_public_rpc_allowlist AS allowed
    ORDER BY allowed.source_signature, allowed.grantee
  LOOP
    v_procedure := pg_catalog.to_regprocedure(v_expected.source_signature);
    IF v_procedure IS NULL THEN
      RAISE EXCEPTION 'G014 allowlisted public RPC identity is missing: %', v_expected.source_signature;
    END IF;
    SELECT procedure.prosecdef
    INTO v_is_definer
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid = v_procedure;
    IF v_expected.source_signature IN (
      'public.match_storyboard_documents_hybrid(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)',
      'public.match_storyboard_documents_hybrid_v2(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)',
      'public.ocr_log_metadata_is_safe(jsonb)'
    ) THEN
      IF v_is_definer THEN
        RAISE EXCEPTION 'G014 declared SECURITY INVOKER public RPC became SECURITY DEFINER: %',
          v_expected.source_signature;
      END IF;
    ELSIF NOT v_is_definer THEN
      RAISE EXCEPTION 'G014 undeclared SECURITY INVOKER allowlisted public RPC: %',
        v_expected.source_signature;
    ELSE
      SELECT setting.value INTO v_search_path
      FROM pg_catalog.unnest((SELECT procedure.proconfig FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_procedure))
        AS setting(value)
      WHERE setting.value LIKE 'search_path=%';
      IF pg_catalog.pg_get_userbyid((SELECT procedure.proowner FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_procedure))
            IS DISTINCT FROM 'privacy_workflow_owner'
         OR (v_search_path IS DISTINCT FROM 'search_path=' AND v_search_path IS DISTINCT FROM 'search_path=""') THEN
        RAISE EXCEPTION 'G014 allowlisted public RPC owner/definer/path mismatch: %', v_expected.source_signature;
      END IF;
    END IF;
    IF NOT pg_catalog.has_function_privilege(v_expected.grantee, v_procedure, 'EXECUTE') THEN
      RAISE EXCEPTION 'G014 allowlisted public RPC grant missing: %', v_expected.source_signature;
    END IF;
  END LOOP;

  -- No PUBLIC, anon, or authenticated effective EXECUTE survives outside its
  -- checked-in matrix. Service-role access is equally exact for every G014 RPC.
  FOR v_expected IN
    SELECT procedure.oid, namespace.nspname, procedure.proname,
           procedure.proargtypes::text AS identity_arguments
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
  LOOP
    IF EXISTS (
      SELECT 1
      FROM (VALUES ('anon'::name), ('authenticated'::name), ('service_role'::name)) AS role_matrix(grantee)
      WHERE pg_catalog.has_function_privilege(role_matrix.grantee, v_expected.oid, 'EXECUTE')
        IS DISTINCT FROM EXISTS (
          SELECT 1
          FROM privacy_retention.g014_public_rpc_allowlist AS allowed
          WHERE allowed.function_schema = v_expected.nspname
            AND allowed.function_name = v_expected.proname
            AND allowed.identity_arguments = v_expected.identity_arguments
            AND allowed.grantee = role_matrix.grantee
        )
    ) OR EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(COALESCE(
        (SELECT procedure.proacl FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_expected.oid),
        pg_catalog.acldefault('f', (SELECT procedure.proowner FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_expected.oid))
      )) AS acl
      WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'G014 effective public RPC privilege drifted: %.%(%)',
        v_expected.nspname, v_expected.proname, v_expected.identity_arguments;
    END IF;
  END LOOP;
  -- Resolve the Auth relation solely through pg_catalog. A SECURITY DEFINER
  -- assertion must not require USAGE on the platform-owned auth schema.
  SELECT relation_row.oid
    INTO v_auth_users_oid
    FROM pg_catalog.pg_class AS relation_row
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = relation_row.relnamespace
   WHERE namespace.nspname = 'auth'
     AND relation_row.relname = 'users'
     AND relation_row.relkind = 'r';
  GET DIAGNOSTICS v_auth_users_count = ROW_COUNT;
  IF v_auth_users_count <> 1 THEN
    RAISE EXCEPTION 'G014 auth.users catalog identity is missing or ambiguous';
  END IF;

  -- The moved G010 identities retain exactly four live Auth FKs. The retained
  -- privacy audit actor UUID is deliberately detached from auth.users so
  -- historical append-only audit identity does not couple to active Auth
  -- deletion. Any additional private Auth dependency would make
  -- retention/deletion coupling implicit and therefore blocks promotion.
  -- Diagnostics contain catalog identities only, never table data, and are
  -- ordered for stable replay output.
  WITH expected(schema_name, relation_name, column_name, constraint_name, delete_action) AS (
    VALUES
      ('privacy_retention'::name, 'privacy_onboarding_challenges'::name, 'consumed_by_user_id'::name, 'privacy_onboarding_challenges_consumed_by_user_id_fkey'::name, 'RESTRICT'::text),
      ('privacy_retention'::name, 'privacy_guardian_verifications'::name, 'child_user_id'::name, 'privacy_guardian_verifications_child_user_id_fkey'::name, 'RESTRICT'::text),
      ('privacy_retention'::name, 'privacy_age_profiles'::name, 'user_id'::name, 'privacy_age_profiles_user_id_fkey'::name, 'RESTRICT'::text),
      ('privacy_retention'::name, 'privacy_consent_events'::name, 'user_id'::name, 'privacy_consent_events_user_id_fkey'::name, 'RESTRICT'::text)
  ),
  actual AS (
    SELECT
      namespace.nspname::name AS schema_name,
      relation_row.relname::name AS relation_name,
      attribute.attname::name AS column_name,
      constraint_row.conname AS constraint_name,
      CASE constraint_row.confdeltype
        WHEN 'a' THEN 'NO ACTION'
        WHEN 'r' THEN 'RESTRICT'
        WHEN 'c' THEN 'CASCADE'
        WHEN 'n' THEN 'SET NULL'
        WHEN 'd' THEN 'SET DEFAULT'
      END AS delete_action
    FROM pg_catalog.pg_constraint AS constraint_row
    JOIN pg_catalog.pg_class AS relation_row ON relation_row.oid = constraint_row.conrelid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation_row.relnamespace
    JOIN LATERAL pg_catalog.unnest(constraint_row.conkey) AS key_column(attnum) ON true
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = relation_row.oid AND attribute.attnum = key_column.attnum
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid = v_auth_users_oid
      AND namespace.nspname = 'privacy_retention'
  ),
  missing AS (
    SELECT * FROM expected
    EXCEPT
    SELECT * FROM actual
  ),
  unexpected AS (
    SELECT * FROM actual
    EXCEPT
    SELECT * FROM expected
  )
  SELECT
    COALESCE((
      SELECT pg_catalog.string_agg(
        pg_catalog.format(
          '%I.%I.%I constraint=%I on_delete=%s',
          schema_name, relation_name, column_name, constraint_name, delete_action
        ),
        '; ' ORDER BY schema_name, relation_name, column_name, constraint_name, delete_action
      )
      FROM missing
    ), ''),
    COALESCE((
      SELECT pg_catalog.string_agg(
        pg_catalog.format(
          '%I.%I.%I constraint=%I on_delete=%s',
          schema_name, relation_name, column_name, constraint_name, delete_action
        ),
        '; ' ORDER BY schema_name, relation_name, column_name, constraint_name, delete_action
      )
      FROM unexpected
    ), '')
  INTO v_auth_dependency_missing, v_auth_dependency_unexpected;

  IF v_auth_dependency_missing <> '' OR v_auth_dependency_unexpected <> '' THEN
    RAISE EXCEPTION
      'G014 private auth.users dependency contract drifted; missing=[%]; unexpected=[%]',
      v_auth_dependency_missing,
      v_auth_dependency_unexpected;
  END IF;
END;
$function$;

ALTER FUNCTION privacy_retention.assert_g014_catalog_contract()
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.assert_g014_catalog_contract()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION privacy_retention.assert_g014_catalog_contract()
  TO privacy_workflow_owner;

-- The assertion resolves auth.users from pg_catalog and needs no privilege on
-- the platform-owned auth schema.
SELECT privacy_retention.assert_g014_catalog_contract();
NOTIFY pgrst, 'reload schema';
