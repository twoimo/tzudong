\set ON_ERROR_STOP on

-- Run only in a disposable local Supabase database after G014-01..05.
-- Every fixture relation and row is rolled back.  The script emits neither raw
-- subject data nor storage object paths in durable receipts.
BEGIN;

DO $catalog_contract$
DECLARE
  v_signature text;
  v_oid oid;
  v_search_path text;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('privacy_retention.retention_adapter_registry'),
      ('privacy_retention.retention_adapter_versions'),
      ('privacy_retention.retention_class_adapter_bindings'),
      ('privacy_retention.g014_retention_storage_claims'),
      ('privacy_retention.g014_retention_provider_effects'),
      ('privacy_retention.retention_adapter_approvals'),
      ('privacy_retention.retention_adapter_approval_consumptions'),
      ('privacy_retention.g014_retention_receipts')
    ) AS expected(relation_name)
    WHERE pg_catalog.to_regclass(expected.relation_name) IS NULL
  ) THEN
    RAISE EXCEPTION 'G014-05 retention adapter or receipt relation is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM privacy_retention.privacy_retention_classes AS class_row
    WHERE class_row.code = 'notifications_operational'
      AND class_row.status = 'disabled'
  ) OR NOT EXISTS (
    SELECT 1 FROM privacy_retention.privacy_retention_classes AS class_row
    WHERE class_row.code = 'privacy_retention_run_audit'
      AND class_row.status = 'disabled'
      AND class_row.data_class IS NULL
      AND class_row.basis_code IS NULL
      AND class_row.trigger_type IS NULL
      AND class_row.retention_period IS NULL
      AND class_row.approved_evidence_ref IS NULL
      AND class_row.version IS NULL
      AND class_row.activated_at IS NULL
  ) OR EXISTS (
    SELECT 1
    FROM (VALUES
      ('notification_adapter', 'notification', 'delete'),
      ('approved_audit_record_adapter', 'approved_audit_record', 'unsupported'),
      ('ocr_metadata_adapter', 'ocr_metadata', 'delete'),
      ('ocr_artifact_adapter', 'ocr_artifact', 'external_delete'),
      ('access_log_adapter', 'access_log', 'delete'),
      ('deleted_account_residue_adapter', 'deleted_account_residue', 'unsupported')
    ) AS expected(adapter_code, source_type, removal_mode)
    LEFT JOIN privacy_retention.retention_adapter_registry AS registry
      ON registry.adapter_code = expected.adapter_code
     AND registry.source_type = expected.source_type
     AND registry.removal_mode = expected.removal_mode
    WHERE registry.adapter_code IS NULL
  ) THEN
    RAISE EXCEPTION 'G014-05 disabled retention classes or private adapter coverage is missing';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('privacy_retention.retention_adapter_registry'),
      ('privacy_retention.retention_adapter_versions'),
      ('privacy_retention.retention_class_adapter_bindings'),
      ('privacy_retention.retention_adapter_approvals'),
      ('privacy_retention.retention_adapter_approval_consumptions'),
      ('privacy_retention.g014_retention_storage_claims'),
      ('privacy_retention.g014_retention_provider_effects'),
      ('privacy_retention.g014_retention_receipts'),
      ('privacy_retention.privacy_retention_runs'),
      ('privacy_retention.privacy_retention_work_items'),
      ('privacy_retention.privacy_legal_holds')
    ) AS expected(relation_name)
    JOIN pg_catalog.pg_class AS relation_row
      ON relation_row.oid = pg_catalog.to_regclass(expected.relation_name)
    JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = relation_row.relowner
    WHERE owner_role.rolname IS DISTINCT FROM 'privacy_workflow_owner'
       OR NOT relation_row.relrowsecurity
       OR NOT relation_row.relforcerowsecurity
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.pg_policy AS policy_row
         WHERE policy_row.polrelid = relation_row.oid
           AND (
             (policy_row.polname = 'g014_retention_owner_access' AND policy_row.polcmd = '*')
             OR (
               relation_row.oid = 'privacy_retention.retention_adapter_approvals'::regclass
               AND policy_row.polname = 'g014_retention_approval_owner_read'
               AND policy_row.polcmd = 'r'
             )
           )
       )
  ) THEN
    RAISE EXCEPTION 'G014-05 retention relation owner or forced-RLS boundary failed';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'privacy_retention.privacy_retention_runs'::regclass
      AND attribute.attname IN ('adapter_version', 'source_mapping_version')
      AND (attribute.atttypid IS DISTINCT FROM 'text'::regtype OR NOT attribute.attnotnull)
  ) OR (
    SELECT count(*)
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'privacy_retention.privacy_retention_runs'::regclass
      AND attribute.attname IN ('adapter_version', 'source_mapping_version')
      AND attribute.atttypid = 'text'::regtype
      AND attribute.attnotnull
  ) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'G014-05 immutable run binding columns are missing or nullable';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid IN (
      'privacy_retention.retention_adapter_approvals'::regclass,
      'privacy_retention.retention_adapter_approval_consumptions'::regclass
    )
      AND (
        (attribute.attrelid = 'privacy_retention.retention_adapter_approvals'::regclass
         AND attribute.attname = 'approved_by_principal')
        OR (attribute.attrelid = 'privacy_retention.retention_adapter_approval_consumptions'::regclass
         AND attribute.attname = 'consumed_by_principal')
      )
      AND (attribute.atttypid IS DISTINCT FROM 'name'::regtype OR NOT attribute.attnotnull)
  ) OR (
    SELECT count(*)
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid IN (
      'privacy_retention.retention_adapter_approvals'::regclass,
      'privacy_retention.retention_adapter_approval_consumptions'::regclass
    )
      AND (
        (attribute.attrelid = 'privacy_retention.retention_adapter_approvals'::regclass
         AND attribute.attname = 'approved_by_principal')
        OR (attribute.attrelid = 'privacy_retention.retention_adapter_approval_consumptions'::regclass
         AND attribute.attname = 'consumed_by_principal')
      )
      AND attribute.atttypid = 'name'::regtype
      AND attribute.attnotnull
  ) IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'G014-05 immutable canonical approval principals are missing or nullable';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('privacy_retention.retention_adapter_registry'),
      ('privacy_retention.retention_adapter_versions'),
      ('privacy_retention.retention_class_adapter_bindings'),
      ('privacy_retention.retention_adapter_approvals'),
      ('privacy_retention.retention_adapter_approval_consumptions'),
      ('privacy_retention.g014_retention_storage_claims'),
      ('privacy_retention.g014_retention_provider_effects'),
      ('privacy_retention.g014_retention_receipts'),
      ('privacy_retention.privacy_retention_classes'),
      ('privacy_retention.privacy_retention_work_items'),
      ('privacy_retention.privacy_retention_runs'),
      ('privacy_retention.privacy_legal_holds')
    ) AS protected_relation(relation_name)
    CROSS JOIN (VALUES ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) AS operation(privilege_name)
    WHERE pg_catalog.has_table_privilege('service_role', protected_relation.relation_name, operation.privilege_name)
  ) THEN
    RAISE EXCEPTION 'G014-05 direct service DML boundary failed';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles AS role_row
    WHERE role_row.rolname IN (
      'privacy_retention_operator_approver',
      'privacy_retention_legal_approver',
      'privacy_retention_activation_operator'
    )
      AND (
        role_row.rolsuper OR role_row.rolinherit OR role_row.rolcreaterole
        OR role_row.rolcreatedb OR role_row.rolreplication OR role_row.rolbypassrls
        OR role_row.rolcanlogin
      )
  ) OR pg_catalog.pg_has_role('service_role', 'privacy_retention_operator_approver', 'member')
     OR pg_catalog.pg_has_role('service_role', 'privacy_retention_legal_approver', 'member')
     OR pg_catalog.pg_has_role('service_role', 'privacy_retention_activation_operator', 'member') THEN
    RAISE EXCEPTION 'G014-05 approval role separation failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('privacy_retention.retention_adapter_registry'),
      ('privacy_retention.retention_adapter_versions'),
      ('privacy_retention.retention_class_adapter_bindings'),
      ('privacy_retention.retention_adapter_approvals'),
      ('privacy_retention.retention_adapter_approval_consumptions'),
      ('privacy_retention.g014_retention_storage_claims'),
      ('privacy_retention.g014_retention_provider_effects'),
      ('privacy_retention.g014_retention_receipts'),
      ('privacy_retention.privacy_retention_classes'),
      ('privacy_retention.privacy_retention_class_sources'),
      ('privacy_retention.privacy_retention_work_items'),
      ('privacy_retention.privacy_retained_records'),
      ('privacy_retention.privacy_retention_runs'),
      ('privacy_retention.privacy_retention_run_items'),
      ('privacy_retention.privacy_legal_holds')
    ) AS retained_relation(relation_name)
    JOIN pg_catalog.pg_attribute AS attribute
      ON attribute.attrelid = pg_catalog.to_regclass(retained_relation.relation_name)
    WHERE attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attname IN (
        'storage_bucket', 'storage_object_name', 'bucket_name', 'object_name'
      )
  ) OR pg_catalog.pg_get_functiondef(
       'privacy_retention.g014_retention_storage_receipt_set_hash(uuid)'::regprocedure
     ) ~ '(storage_bucket|storage_object_name|bucket_name|object_name)' THEN
    RAISE EXCEPTION 'G014-05 durable retention state leaks a raw storage locator';
  END IF;

  IF pg_catalog.to_regprocedure('public.ack_privacy_retention_storage_items(uuid,text,text,uuid[],boolean)') IS NOT NULL THEN
    RAISE EXCEPTION 'G014-05 web self-attestation acknowledgement RPC remains exposed';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
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
    SELECT setting.value INTO v_search_path
    FROM pg_catalog.unnest((
      SELECT procedure.proconfig FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_oid
    )) AS setting(value)
    WHERE setting.value LIKE 'search_path=%';
    IF v_oid IS NULL
       OR NOT (SELECT procedure.prosecdef FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_oid)
       OR pg_catalog.pg_get_userbyid((SELECT procedure.proowner FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_oid))
          IS DISTINCT FROM 'privacy_workflow_owner'
       OR (v_search_path IS DISTINCT FROM 'search_path=' AND v_search_path IS DISTINCT FROM 'search_path=""')
       OR NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'G014-05 RPC owner/path/grant contract failed for %', v_signature;
    END IF;
  END LOOP;
  v_oid := pg_catalog.to_regprocedure(
    'public.activate_privacy_retention_adapter(text,text,text,text,text,text,interval,text,text,text)'
  );
  IF v_oid IS NULL
     OR NOT (SELECT procedure.prosecdef FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_oid)
     OR pg_catalog.pg_get_userbyid((SELECT procedure.proowner FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_oid))
        IS DISTINCT FROM 'privacy_workflow_owner'
     OR pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('privacy_retention_activation_operator', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'G014-05 activation capability is not operator-only';
  END IF;

  IF pg_catalog.pg_get_function_result(
       'public.claim_privacy_retention_storage_items(uuid,text,text,integer)'::regprocedure
     ) IS DISTINCT FROM 'jsonb'
     OR pg_catalog.pg_get_functiondef(
       'public.claim_privacy_retention_storage_items(uuid,text,text,integer)'::regprocedure
     ) !~ 'workItemId'
     OR pg_catalog.pg_get_functiondef(
       'public.claim_privacy_retention_storage_items(uuid,text,text,integer)'::regprocedure
     ) !~ 'sourceMappingVersion'
     OR pg_catalog.pg_get_functiondef(
       'public.claim_privacy_retention_storage_items(uuid,text,text,integer)'::regprocedure
     ) !~ 'objectLocatorHash'
     OR pg_catalog.pg_get_functiondef(
       'public.claim_privacy_retention_storage_items(uuid,text,text,integer)'::regprocedure
     ) ~ '(bucketName|objectName)'
     OR pg_catalog.pg_get_functiondef(
       'public.record_privacy_retention_storage_provider_receipts(uuid,text,text,jsonb)'::regprocedure
     ) !~ 'jsonb_object_length'
     OR pg_catalog.pg_get_functiondef(
       'public.record_privacy_retention_storage_provider_receipts(uuid,text,text,jsonb)'::regprocedure
     ) !~ 'providerAbsenceHash'
     OR pg_catalog.pg_get_functiondef(
       'public.record_privacy_retention_storage_provider_receipts(uuid,text,text,jsonb)'::regprocedure
     ) !~ 'providerEffectToken'
     OR pg_catalog.pg_get_functiondef(
       'public.resolve_privacy_retention_provider_effect(uuid,text,text,uuid,uuid,text,text,text,text,text,text)'::regprocedure
     ) !~ 'provider_effect_in_flight'
     OR pg_catalog.pg_get_functiondef(
       'public.resolve_privacy_retention_provider_effect(uuid,text,text,uuid,uuid,text,text,text,text,text,text)'::regprocedure
     ) !~ 'storage[.]objects'
     OR pg_catalog.pg_get_functiondef(
       'public.resolve_privacy_retention_provider_effect(uuid,text,text,uuid,uuid,text,text,text,text,text,text)'::regprocedure
     ) !~ 'g014_retention_storage_locator_hash'
     OR pg_catalog.pg_get_functiondef(
       'public.resolve_privacy_retention_provider_effect(uuid,text,text,uuid,uuid,text,text,text,text,text,text)'::regprocedure
     ) !~ 'FOR UPDATE OF object_row'
     OR pg_catalog.pg_get_functiondef(
       'public.get_privacy_retention_provider_reconciliation_work(uuid,text,text,text,integer)'::regprocedure
     ) ~ '(storage_bucket|storage_object_name|bucketName|objectName)'
     OR pg_catalog.pg_get_functiondef(
       'public.apply_privacy_retention_run(uuid,text,text,integer)'::regprocedure
     ) !~ 'pg_advisory_xact_lock'
     OR pg_catalog.pg_get_functiondef(
       'public.finalize_privacy_retention_run(uuid,text,text)'::regprocedure
     ) !~ 'g014_retention_source_absent'
     OR position(
       'g014_retention_lock_subject_hash' IN pg_catalog.pg_get_functiondef(
         'public.record_privacy_retention_storage_provider_receipts(uuid,text,text,jsonb)'::regprocedure
       )
     ) = 0
     OR position(
       'g014_retention_active_hold_exists' IN pg_catalog.pg_get_functiondef(
         'public.record_privacy_retention_storage_provider_receipts(uuid,text,text,jsonb)'::regprocedure
       )
     ) = 0
     OR position(
       'retention_legal_hold_active' IN pg_catalog.pg_get_functiondef(
         'public.record_privacy_retention_storage_provider_receipts(uuid,text,text,jsonb)'::regprocedure
       )
     ) = 0
     OR position(
       'g014_retention_active_hold_exists' IN pg_catalog.pg_get_functiondef(
         'privacy_retention.g014_retention_no_active_hold_mutated(uuid)'::regprocedure
       )
     ) = 0
     OR position(
       'approved_by_principal' IN pg_catalog.pg_get_functiondef(
         'public.activate_privacy_retention_adapter(text,text,text,text,text,text,interval,text,text,text)'::regprocedure
       )
     ) = 0 THEN
    RAISE EXCEPTION 'G014-05 exact claim, approval-principal, lock, or source-readback contract failed';
  END IF;
  IF position(
       'g014_retention_lock_subject_hash' IN pg_catalog.pg_get_functiondef(
         'privacy_retention.g014_retention_claim_storage_items_internal(uuid,text,text,integer)'::regprocedure
       )
     ) = 0
     OR position(
       'g014_retention_active_hold_exists' IN pg_catalog.pg_get_functiondef(
         'privacy_retention.g014_retention_claim_storage_items_internal(uuid,text,text,integer)'::regprocedure
       )
     ) = 0
     OR position(
       'g014_retention_provider_effects' IN pg_catalog.pg_get_functiondef(
         'privacy_retention.g014_retention_claim_storage_items_internal(uuid,text,text,integer)'::regprocedure
       )
     ) = 0
     OR position(
       'g014_retention_lock_subject_hash' IN pg_catalog.pg_get_functiondef(
         'privacy_retention.g014_retention_hold_subject_lock()'::regprocedure
       )
     ) = 0
     OR position(
       'g014_retention_lock_subject_hash' IN pg_catalog.pg_get_functiondef(
         'public.resolve_privacy_retention_provider_effect(uuid,text,text,uuid,uuid,text,text,text,text,text,text)'::regprocedure
       )
     ) = 0
     OR position(
       'g014_retention_active_hold_exists' IN pg_catalog.pg_get_functiondef(
         'public.resolve_privacy_retention_provider_effect(uuid,text,text,uuid,uuid,text,text,text,text,text,text)'::regprocedure
       )
     ) = 0
     OR position(
       'retention_provider_effect_in_flight' IN pg_catalog.pg_get_functiondef(
         'privacy_retention.g014_retention_hold_subject_lock()'::regprocedure
       )
     ) = 0
     OR position(
       'g014_retention_assert_run_bindings' IN pg_catalog.pg_get_functiondef(
         'privacy_retention.g014_retention_run_item_transition_guard()'::regprocedure
       )
     ) = 0
     OR position(
       'g014_retention_assert_run_bindings' IN pg_catalog.pg_get_functiondef(
         'privacy_retention.g014_retention_work_item_transition_guard()'::regprocedure
       )
     ) = 0 THEN
    RAISE EXCEPTION 'G014-05 two-session claim/hold race lock and recheck contract failed';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('privacy_retention.retention_adapter_registry'),
      ('privacy_retention.g014_retention_receipts'),
      ('privacy_retention.g014_retention_provider_effects'),
      ('privacy_retention.retention_adapter_approvals'),
      ('privacy_retention.retention_adapter_approval_consumptions')
    ) AS immutable_relation(relation_name)
    WHERE NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger AS trigger_row
      WHERE trigger_row.tgrelid = pg_catalog.to_regclass(immutable_relation.relation_name)
        AND trigger_row.tgname LIKE 'g014_retention_%'
        AND NOT trigger_row.tgisinternal
    )
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_trigger AS trigger_row
    WHERE trigger_row.tgrelid = 'privacy_retention.privacy_legal_holds'::regclass
      AND trigger_row.tgname = 'privacy_legal_holds_history'
      AND NOT trigger_row.tgisinternal
  ) THEN
    RAISE EXCEPTION 'G014-05 evidence immutability or legal-hold guard is missing';
  END IF;
END;
$catalog_contract$;

CREATE OR REPLACE FUNCTION pg_temp.g014_expect_failure(p_sql text)
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $expect_failure$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN OTHERS THEN
    RETURN;
  END;
  RAISE EXCEPTION 'expected fail-closed SQL rejection';
END;
$expect_failure$;

CREATE TEMPORARY TABLE pg_temp.g014_retention_fixture (
  fixture_key text PRIMARY KEY,
  fixture_value text NOT NULL
) ON COMMIT DROP;
GRANT ALL ON TABLE pg_temp.g014_retention_fixture TO service_role;

-- This disposable source has the exact identifier/hash contract required by a
-- versioned adapter.  It holds no user identifier, payload, or object locator.
CREATE TABLE privacy_retention.g014_retention_fixture_source (
  id uuid PRIMARY KEY,
  marker text NOT NULL CHECK (marker ~ '^[a-z][a-z0-9_]{2,63}$')
);
ALTER TABLE privacy_retention.g014_retention_fixture_source OWNER TO privacy_workflow_owner;
ALTER TABLE privacy_retention.g014_retention_fixture_source ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_retention.g014_retention_fixture_source FORCE ROW LEVEL SECURITY;
GRANT ALL ON TABLE privacy_retention.g014_retention_fixture_source TO privacy_workflow_owner;
CREATE POLICY g014_retention_fixture_source_access
  ON privacy_retention.g014_retention_fixture_source
  FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true);

INSERT INTO privacy_retention.retention_adapter_registry (adapter_code, source_type, removal_mode)
VALUES
  ('fixture_notification_adapter', 'notification', 'delete'),
  ('fixture_artifact_adapter', 'ocr_artifact', 'external_delete'),
  ('fixture_missing_adapter', 'access_log', 'delete'),
  ('fixture_contract_adapter', 'notification', 'delete')
ON CONFLICT (adapter_code) DO NOTHING;

INSERT INTO privacy_retention.retention_adapter_versions (
  adapter_code, adapter_version, source_relation, source_identifier_column,
  source_type, removal_mode, provider_verifier_ref, contract_hash
)
VALUES
  ('fixture_notification_adapter', 'fixture-notification-v1', 'privacy_retention.g014_retention_fixture_source', 'id', 'notification', 'delete', NULL,
   privacy_retention.g014_retention_adapter_contract_hash('fixture_notification_adapter', 'fixture-notification-v1', 'privacy_retention.g014_retention_fixture_source', 'id', 'notification', 'delete', NULL)),
  ('fixture_artifact_adapter', 'fixture-artifact-v1', 'privacy_retention.g014_retention_fixture_source', 'id', 'ocr_artifact', 'external_delete', 'fixture.provider.v1',
   privacy_retention.g014_retention_adapter_contract_hash('fixture_artifact_adapter', 'fixture-artifact-v1', 'privacy_retention.g014_retention_fixture_source', 'id', 'ocr_artifact', 'external_delete', 'fixture.provider.v1')),
  ('fixture_missing_adapter', 'fixture-missing-v1', 'privacy_retention.g014_retention_missing_source', 'id', 'access_log', 'delete', NULL,
   privacy_retention.g014_retention_adapter_contract_hash('fixture_missing_adapter', 'fixture-missing-v1', 'privacy_retention.g014_retention_missing_source', 'id', 'access_log', 'delete', NULL)),
  ('fixture_contract_adapter', 'fixture-contract-v1', 'privacy_retention.g014_retention_fixture_source', 'id', 'notification', 'delete', NULL,
   repeat('0', 64))
ON CONFLICT (adapter_code, adapter_version) DO NOTHING;
INSERT INTO privacy_retention.privacy_retention_classes (
  code, data_class, basis_code, trigger_type, retention_period, status,
  approved_evidence_ref, version
) VALUES (
  'g014_fixture_retention', 'notifications_operational', 'fixture.basis',
  'event_occurred', interval '30 days', 'disabled',
  'fixture.legal.class.1', 'fixture-retention-v1'
);

DO $fixture_approval_principal_membership$
DECLARE
  v_principal name;
  v_capability name;
BEGIN
  FOR v_principal, v_capability IN
    SELECT principal_name::name, capability_name::name
    FROM (VALUES
      ('g014_fixture_operator_principal', 'privacy_retention_operator_approver'),
      ('g014_fixture_legal_principal', 'privacy_retention_legal_approver'),
      ('g014_fixture_activation_principal', 'privacy_retention_activation_operator')
    ) AS fixture_principal(principal_name, capability_name)
  LOOP
    EXECUTE pg_catalog.format(
      'CREATE ROLE %I NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS',
      v_principal
    );
    EXECUTE pg_catalog.format('GRANT %I TO %I', v_capability, v_principal);
  END LOOP;
  EXECUTE 'CREATE ROLE g014_fixture_same_principal NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS';
  EXECUTE 'GRANT privacy_retention_operator_approver, privacy_retention_legal_approver, privacy_retention_activation_operator TO g014_fixture_same_principal';
END;
$fixture_approval_principal_membership$;

-- Capability changes through SET ROLE do not change session_user, so a single
-- principal cannot supply both immutable approvals or consume them.
SET SESSION AUTHORIZATION g014_fixture_same_principal;
SET LOCAL ROLE privacy_retention_operator_approver;
INSERT INTO privacy_retention.retention_adapter_approvals (
  approval_kind, class_code, adapter_code, adapter_version, retention_period,
  mapping_contract_hash, approval_ref, signed_payload_hash, approved_by_role
)
SELECT
  'operator', 'g014_fixture_retention', version_row.adapter_code, version_row.adapter_version,
  interval '30 days', version_row.contract_hash, 'fixture.same.operator.notif.1',
  privacy_retention.g014_retention_approval_payload_hash(
    'operator', 'g014_fixture_retention', version_row.adapter_code, version_row.adapter_version,
    interval '30 days', version_row.contract_hash, 'fixture.same.operator.notif.1'
  ),
  current_user::name
FROM privacy_retention.retention_adapter_versions AS version_row
WHERE version_row.adapter_code = 'fixture_notification_adapter';
RESET ROLE;
SET LOCAL ROLE privacy_retention_legal_approver;
INSERT INTO privacy_retention.retention_adapter_approvals (
  approval_kind, class_code, adapter_code, adapter_version, retention_period,
  mapping_contract_hash, approval_ref, signed_payload_hash, approved_by_role
)
SELECT
  'legal', 'g014_fixture_retention', version_row.adapter_code, version_row.adapter_version,
  interval '30 days', version_row.contract_hash, 'fixture.same.legal.notif.1',
  privacy_retention.g014_retention_approval_payload_hash(
    'legal', 'g014_fixture_retention', version_row.adapter_code, version_row.adapter_version,
    interval '30 days', version_row.contract_hash, 'fixture.same.legal.notif.1'
  ),
  current_user::name
FROM privacy_retention.retention_adapter_versions AS version_row
WHERE version_row.adapter_code = 'fixture_notification_adapter';
RESET ROLE;
SET LOCAL ROLE privacy_retention_activation_operator;
SELECT pg_temp.g014_expect_failure($sql$
  SELECT public.activate_privacy_retention_adapter(
    'g014_fixture_retention', 'fixture_notification_adapter', 'fixture-notification-v1',
    'notifications_operational', 'fixture.basis', 'event_occurred', interval '30 days',
    'fixture-retention-v1', 'fixture.same.operator.notif.1', 'fixture.same.legal.notif.1'
  )
$sql$);
RESET ROLE;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION g014_fixture_operator_principal;
SET LOCAL ROLE privacy_retention_operator_approver;
INSERT INTO privacy_retention.retention_adapter_approvals (
  approval_kind, class_code, adapter_code, adapter_version, retention_period,
  mapping_contract_hash, approval_ref, signed_payload_hash, approved_by_role
)
SELECT
  'operator', 'g014_fixture_retention', version_row.adapter_code, version_row.adapter_version,
  interval '30 days', version_row.contract_hash,
  CASE version_row.adapter_code
    WHEN 'fixture_notification_adapter' THEN 'fixture.operator.notif.1'
    ELSE 'fixture.operator.artifact.1'
  END,
  privacy_retention.g014_retention_approval_payload_hash(
    'operator', 'g014_fixture_retention', version_row.adapter_code, version_row.adapter_version,
    interval '30 days', version_row.contract_hash,
    CASE version_row.adapter_code
      WHEN 'fixture_notification_adapter' THEN 'fixture.operator.notif.1'
      ELSE 'fixture.operator.artifact.1'
    END
  ),
  current_user::name
FROM privacy_retention.retention_adapter_versions AS version_row
WHERE version_row.adapter_code IN ('fixture_notification_adapter', 'fixture_artifact_adapter');
RESET ROLE;
RESET SESSION AUTHORIZATION;

SET SESSION AUTHORIZATION g014_fixture_legal_principal;
SET LOCAL ROLE privacy_retention_legal_approver;
INSERT INTO privacy_retention.retention_adapter_approvals (
  approval_kind, class_code, adapter_code, adapter_version, retention_period,
  mapping_contract_hash, approval_ref, signed_payload_hash, approved_by_role
)
SELECT
  'legal', 'g014_fixture_retention', version_row.adapter_code, version_row.adapter_version,
  interval '30 days', version_row.contract_hash,
  CASE version_row.adapter_code
    WHEN 'fixture_notification_adapter' THEN 'fixture.legal.notif.1'
    ELSE 'fixture.legal.artifact.1'
  END,
  privacy_retention.g014_retention_approval_payload_hash(
    'legal', 'g014_fixture_retention', version_row.adapter_code, version_row.adapter_version,
    interval '30 days', version_row.contract_hash,
    CASE version_row.adapter_code
      WHEN 'fixture_notification_adapter' THEN 'fixture.legal.notif.1'
      ELSE 'fixture.legal.artifact.1'
    END
  ),
  current_user::name
FROM privacy_retention.retention_adapter_versions AS version_row
WHERE version_row.adapter_code IN ('fixture_notification_adapter', 'fixture_artifact_adapter');
RESET ROLE;
RESET SESSION AUTHORIZATION;

-- Direct DML is denied even though service_role can invoke the narrowly scoped
-- workflow RPCs.  The same service principal cannot create a fake registry row.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT pg_temp.g014_expect_failure($sql$
  INSERT INTO privacy_retention.retention_adapter_registry(adapter_code, source_type, removal_mode)
  VALUES ('service_dml_adapter', 'notification', 'delete')
$sql$);
SELECT pg_temp.g014_expect_failure($sql$
  UPDATE privacy_retention.privacy_legal_holds SET status = 'released'
$sql$);
SELECT pg_temp.g014_expect_failure($sql$
  INSERT INTO privacy_retention.retention_adapter_approvals (
    approval_kind, class_code, adapter_code, adapter_version, retention_period,
    mapping_contract_hash, approval_ref, signed_payload_hash, approved_by_role
  ) VALUES (
    'operator', 'g014_fixture_retention', 'fixture_notification_adapter',
    'fixture-notification-v1', interval '30 days', repeat('0', 64),
    'service.fake.approval.1', repeat('0', 64), 'privacy_retention_operator_approver'
  )
$sql$);
RESET ROLE;

-- Missing registry, missing source relation, and stale version contract are
-- rejected before any class becomes active.
SET SESSION AUTHORIZATION g014_fixture_activation_principal;
SET LOCAL ROLE privacy_retention_activation_operator;
SELECT pg_catalog.set_config('request.jwt.claim.role', '', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{}', true);
SELECT pg_temp.g014_expect_failure($sql$
  SELECT public.activate_privacy_retention_adapter(
    'g014_fixture_missing_registry', 'not_registered', 'v1', 'notifications_operational',
    'fixture.basis', 'event_occurred', interval '1 day', 'fixture-v1',
    'fixture.operator.1', 'fixture.legal.1'
  )
$sql$);
SELECT pg_temp.g014_expect_failure($sql$
  SELECT public.activate_privacy_retention_adapter(
    'g014_fixture_missing_relation', 'fixture_missing_adapter', 'fixture-missing-v1',
    'notifications_operational', 'fixture.basis', 'event_occurred', interval '1 day',
    'fixture-v1', 'fixture.operator.1', 'fixture.legal.1'
  )
$sql$);
SELECT pg_temp.g014_expect_failure($sql$
  SELECT public.activate_privacy_retention_adapter(
    'g014_fixture_bad_contract', 'fixture_contract_adapter', 'fixture-contract-v1',
    'notifications_operational', 'fixture.basis', 'event_occurred', interval '1 day',
    'fixture-v1', 'fixture.operator.1', 'fixture.legal.1'
  )
$sql$);
RESET ROLE;
RESET SESSION AUTHORIZATION;
SELECT pg_catalog.set_config('request.jwt.claim.role', '', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{}', true);
SET SESSION AUTHORIZATION g014_fixture_activation_principal;
SET LOCAL ROLE privacy_retention_activation_operator;
SELECT public.activate_privacy_retention_adapter(
  'g014_fixture_retention', 'fixture_notification_adapter', 'fixture-notification-v1',
  'notifications_operational', 'fixture.basis', 'event_occurred', interval '30 days',
  'fixture-retention-v1', 'fixture.operator.notif.1', 'fixture.legal.notif.1'
);
SELECT public.activate_privacy_retention_adapter(
  'g014_fixture_retention', 'fixture_artifact_adapter', 'fixture-artifact-v1',
  'notifications_operational', 'fixture.basis', 'event_occurred', interval '30 days',
  'fixture-retention-v1', 'fixture.operator.artifact.1', 'fixture.legal.artifact.1'
);
RESET ROLE;
RESET SESSION AUTHORIZATION;
DO $activation_receipt_contract$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.retention_adapter_versions AS version_row
    WHERE version_row.adapter_code IN ('fixture_notification_adapter', 'fixture_artifact_adapter')
      AND (
        version_row.status IS DISTINCT FROM 'active'
        OR version_row.physical_catalog_fingerprint IS DISTINCT FROM
           privacy_retention.g014_retention_catalog_fingerprint(
             version_row.source_relation, version_row.source_identifier_column
           )
      )
  ) OR (
    SELECT count(*)
    FROM privacy_retention.retention_adapter_approval_consumptions AS consumption
    WHERE consumption.class_code = 'g014_fixture_retention'
      AND consumption.adapter_code IN ('fixture_notification_adapter', 'fixture_artifact_adapter')
  ) IS DISTINCT FROM 2 OR EXISTS (
    SELECT 1
    FROM privacy_retention.retention_adapter_approval_consumptions AS consumption
    JOIN privacy_retention.retention_adapter_approvals AS operator_approval
      ON operator_approval.id = consumption.operator_approval_id
    JOIN privacy_retention.retention_adapter_approvals AS legal_approval
      ON legal_approval.id = consumption.legal_approval_id
    WHERE consumption.class_code = 'g014_fixture_retention'
      AND consumption.adapter_code IN ('fixture_notification_adapter', 'fixture_artifact_adapter')
      AND (
        operator_approval.approved_by_principal IS NULL
        OR legal_approval.approved_by_principal IS NULL
        OR consumption.consumed_by_principal IS NULL
        OR operator_approval.approved_by_principal IS NOT DISTINCT FROM legal_approval.approved_by_principal
        OR consumption.consumed_by_principal IS NOT DISTINCT FROM operator_approval.approved_by_principal
        OR consumption.consumed_by_principal IS NOT DISTINCT FROM legal_approval.approved_by_principal
      )
  ) THEN
    RAISE EXCEPTION 'activation did not consume exact independent approval principals and catalog fingerprints';
  END IF;
END;
$activation_receipt_contract$;
-- Retention-run evidence is unavailable until its independently approved audit
-- class is active. The processed operational class must not satisfy this check.
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $retention_run_audit_class_required$
BEGIN
  BEGIN
    PERFORM public.preview_privacy_retention_run(
      'g014_fixture_retention', pg_catalog.clock_timestamp() - interval '1 second', 1, 10000
    );
    RAISE EXCEPTION 'disabled retention-run audit class unexpectedly allowed a preview';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM IS DISTINCT FROM 'privacy_audit_retention_policy_required' THEN
      RAISE;
    END IF;
  END;
END;
$retention_run_audit_class_required$;
RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claim.role', '', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{}', true);

-- This fixture is the operator-approved class evidence for this disposable
-- database only. Production remains seeded disabled and unconfigured.
SET LOCAL ROLE privacy_workflow_owner;
UPDATE privacy_retention.privacy_retention_classes
SET data_class = 'privacy_retention_run_audit',
    basis_code = 'fixture.retention.run.audit',
    trigger_type = 'event_occurred',
    retention_period = interval '90 days',
    status = 'active',
    approved_evidence_ref = 'fixture.operator.retention.run.audit.1',
    version = 'fixture-retention-run-audit-v1'
WHERE code = 'privacy_retention_run_audit';
RESET ROLE;

DO $retention_run_audit_class_contract$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF public.privacy_resolve_audit_retention_until('privacy_retention_run_audit', v_now)
       IS DISTINCT FROM v_now + interval '90 days' THEN
    RAISE EXCEPTION 'retention-run audit class did not resolve its independently approved period';
  END IF;
END;
$retention_run_audit_class_contract$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $empty_healthy_retention_runs$
DECLARE
  v_preview jsonb;
  v_confirmation jsonb;
  v_apply jsonb;
  v_final jsonb;
  v_final_replay jsonb;
  v_future_preview jsonb;
  v_future_final jsonb;
  v_run_id uuid;
  v_future_run_id uuid;
  v_preview_hash text;
  v_future_preview_hash text;
BEGIN
  SELECT public.preview_privacy_retention_run(
    'g014_fixture_retention', pg_catalog.clock_timestamp() - interval '1 second', 1, 10000
  ) INTO v_preview;
  v_run_id := (v_preview ->> 'operationId')::uuid;
  v_preview_hash := v_preview ->> 'previewHash';
  IF v_preview -> 'summary' IS DISTINCT FROM pg_catalog.jsonb_build_object(
       'cutoff', v_preview #>> '{summary,cutoff}',
       'eligible', 0,
       'held', 0,
       'scanned', 0
     ) THEN
    RAISE EXCEPTION 'healthy empty retention preview was not fully scanned and hold-clear';
  END IF;

  SELECT public.confirm_privacy_retention_run(
    v_run_id, v_preview_hash, '보존·분리 적용', 'g014-empty-retention-noop-001'
  ) INTO v_confirmation;
  IF v_confirmation ->> 'status' IS DISTINCT FROM 'confirmed' THEN
    RAISE EXCEPTION 'healthy empty retention confirmation failed';
  END IF;

  SELECT public.apply_privacy_retention_run(
    v_run_id, v_preview_hash, 'g014-empty-retention-noop-001', 10000
  ) INTO v_apply;
  IF v_apply ->> 'status' IS DISTINCT FROM 'partial' THEN
    RAISE EXCEPTION 'empty retention apply did not preserve the canonical finalization protocol';
  END IF;

  SELECT public.finalize_privacy_retention_run(
    v_run_id, v_preview_hash, 'g014-empty-retention-noop-001'
  ) INTO v_final;
  IF pg_catalog.jsonb_object_length(v_final) IS DISTINCT FROM 7
     OR (v_final - ARRAY[
       'operationId', 'status', 'readback', 'auditId',
       'adapterVersion', 'sourceMappingVersion', 'errorCode'
     ]) IS DISTINCT FROM '{}'::jsonb
     OR v_final ->> 'status' IS DISTINCT FROM 'applied'
     OR v_final #>> '{readback,passed}' IS DISTINCT FROM 'true'
     OR pg_catalog.jsonb_object_length(v_final -> 'readback' -> 'checks') IS DISTINCT FROM 4
     OR (v_final -> 'readback' -> 'checks') IS DISTINCT FROM pg_catalog.jsonb_build_object(
       'expectedCountMatched', true,
       'databaseSourceAbsent', true,
       'storageProviderAbsent', true,
       'noActiveHoldMutated', true
     )
     OR v_final -> 'errorCode' IS DISTINCT FROM 'null'::jsonb
     OR v_final ->> 'auditId' IS NULL
     OR NOT EXISTS (
       SELECT 1
       FROM privacy_retention.privacy_retention_runs AS run_row
       WHERE run_row.id = v_run_id
         AND run_row.status = 'completed'
         AND run_row.readback_passed
         AND run_row.database_readback_passed
         AND run_row.storage_readback_passed
         AND run_row.no_active_hold_mutated
         AND run_row.scanned_count = 0
         AND run_row.planned_count = 0
         AND run_row.held_count = 0
         AND run_row.separated_count = 0
         AND run_row.storage_deleted_count = 0
         AND run_row.failure_count = 0
         AND run_row.storage_receipts_hash IS NOT NULL
         AND run_row.storage_receipts_hash IS NOT DISTINCT FROM
           privacy_retention.g014_retention_storage_receipt_set_hash(v_run_id)
     )
     OR (
       SELECT audit_event.retention_until - audit_event.occurred_at
       FROM privacy_retention.privacy_audit_events AS audit_event
       WHERE audit_event.id = (v_final ->> 'auditId')::uuid
     ) IS DISTINCT FROM interval '90 days' THEN
    RAISE EXCEPTION 'healthy empty retention run did not close with the canonical independently retained receipt';
  END IF;

  SELECT public.confirm_privacy_retention_run(
    v_run_id, v_preview_hash, '보존·분리 적용', 'g014-empty-retention-noop-001'
  ) INTO v_confirmation;
  SELECT public.finalize_privacy_retention_run(
    v_run_id, v_preview_hash, 'g014-empty-retention-noop-001'
  ) INTO v_final_replay;
  IF v_confirmation ->> 'status' IS DISTINCT FROM 'applied'
     OR v_final_replay IS DISTINCT FROM v_final THEN
    RAISE EXCEPTION 'healthy empty retention replay was not idempotent';
  END IF;

  -- A completed zero-work run is terminal, so it cannot occupy the one-active-run
  -- slot and prevent the next scheduled class run.
  SELECT public.preview_privacy_retention_run(
    'g014_fixture_retention', pg_catalog.clock_timestamp() - interval '1 second', 1, 10000
  ) INTO v_future_preview;
  v_future_run_id := (v_future_preview ->> 'operationId')::uuid;
  v_future_preview_hash := v_future_preview ->> 'previewHash';
  SELECT public.confirm_privacy_retention_run(
    v_future_run_id, v_future_preview_hash, '보존·분리 적용', 'g014-empty-retention-noop-002'
  ) INTO v_confirmation;
  PERFORM public.apply_privacy_retention_run(
    v_future_run_id, v_future_preview_hash, 'g014-empty-retention-noop-002', 10000
  );
  SELECT public.finalize_privacy_retention_run(
    v_future_run_id, v_future_preview_hash, 'g014-empty-retention-noop-002'
  ) INTO v_future_final;
  IF v_future_preview -> 'summary' IS DISTINCT FROM pg_catalog.jsonb_build_object(
       'cutoff', v_future_preview #>> '{summary,cutoff}',
       'eligible', 0,
       'held', 0,
       'scanned', 0
     )
     OR v_confirmation ->> 'status' IS DISTINCT FROM 'confirmed'
     OR v_future_final ->> 'status' IS DISTINCT FROM 'applied'
     OR v_future_final #>> '{readback,passed}' IS DISTINCT FROM 'true'
     OR (SELECT status FROM privacy_retention.privacy_retention_runs WHERE id = v_future_run_id)
        IS DISTINCT FROM 'completed' THEN
    RAISE EXCEPTION 'completed empty retention run blocked a future class schedule';
  END IF;
END;
$empty_healthy_retention_runs$;
RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claim.role', '', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{}', true);

INSERT INTO privacy_retention.g014_retention_fixture_source (id, marker)
VALUES
  ('58000000-0000-4000-8000-000000000001', 'database_source'),
  ('58000000-0000-4000-8000-000000000002', 'storage_source'),
  ('58000000-0000-4000-8000-000000000003', 'source_still_present'),
  ('58000000-0000-4000-8000-000000000004', 'held_source'),
  ('58000000-0000-4000-8000-000000000005', 'partial_storage_source'),
  ('58000000-0000-4000-8000-000000000006', 'mixed_retry_storage_source');

INSERT INTO storage.objects (id, bucket_id, name, owner_id, version)
VALUES (
  '59000000-0000-4000-8000-000000000102',
  'fixture-bucket',
  'opaque-fixture-object',
  NULL,
  'fixture-version-success-v1'
);

INSERT INTO privacy_retention.privacy_retention_work_items (
  id, class_code, data_class, source_type, source_ref_hash, trigger_at,
  storage_version_hash
) VALUES
  ('59000000-0000-4000-8000-000000000001', 'g014_fixture_retention', 'notifications_operational', 'notification',
   privacy_retention.g014_retention_source_hash('fixture_notification_adapter', '58000000-0000-4000-8000-000000000001'),
   pg_catalog.clock_timestamp() - interval '1 minute', NULL),
  ('59000000-0000-4000-8000-000000000002', 'g014_fixture_retention', 'notifications_operational', 'ocr_artifact',
   privacy_retention.g014_retention_storage_locator_hash('fixture-bucket', 'opaque-fixture-object'),
   pg_catalog.clock_timestamp() - interval '1 minute',
   pg_catalog.encode(extensions.digest('fixture-version-success-v1', 'sha256'), 'hex'));

DO $durable_locator_fixture_boundary$
DECLARE
  v_relation regclass;
  v_locator_leaked boolean;
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
    'privacy_retention.privacy_retention_work_items'::regclass,
    'privacy_retention.privacy_retained_records'::regclass,
    'privacy_retention.privacy_retention_runs'::regclass,
    'privacy_retention.privacy_retention_run_items'::regclass,
    'privacy_retention.privacy_legal_holds'::regclass
  ] LOOP
    EXECUTE pg_catalog.format(
      'SELECT EXISTS (
         SELECT 1
         FROM %s AS retained_row
         WHERE pg_catalog.to_jsonb(retained_row)::text ~ $1
       )',
      v_relation
    ) INTO v_locator_leaked
      USING '(fixture-bucket|opaque-fixture-object)';
    IF v_locator_leaked THEN
      RAISE EXCEPTION 'G014-05 durable retention fixture leaked a raw storage locator';
    END IF;
  END LOOP;
END;
$durable_locator_fixture_boundary$;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $successful_workflow$
DECLARE
  v_preview jsonb;
  v_run_id uuid;
  v_preview_hash text;
  v_receipts jsonb;
  v_claims jsonb;
  v_effect jsonb;
  v_reconciliation jsonb;
  v_final jsonb;
  v_confirmation jsonb;
  v_apply jsonb;
  v_adapter_version text;
  v_source_mapping_version text;
BEGIN
  SELECT public.preview_privacy_retention_run(
    'g014_fixture_retention', pg_catalog.clock_timestamp() - interval '1 second', 2, 10000
  ) INTO v_preview;
  v_run_id := (v_preview ->> 'operationId')::uuid;
  v_preview_hash := v_preview ->> 'previewHash';
  v_adapter_version := v_preview ->> 'adapterVersion';
  v_source_mapping_version := v_preview ->> 'sourceMappingVersion';
  IF v_adapter_version !~ '^[0-9a-f]{64}$'
     OR v_source_mapping_version !~ '^[0-9a-f]{64}$'
     OR v_adapter_version IS DISTINCT FROM
        privacy_retention.g014_retention_active_adapter_version('g014_fixture_retention')
     OR v_source_mapping_version IS DISTINCT FROM
        privacy_retention.g014_retention_active_source_mapping_version('g014_fixture_retention')
     OR v_adapter_version IS DISTINCT FROM (
       SELECT run_row.adapter_version
       FROM privacy_retention.privacy_retention_runs AS run_row
       WHERE run_row.id = v_run_id
     )
     OR v_source_mapping_version IS DISTINCT FROM (
       SELECT run_row.source_mapping_version
       FROM privacy_retention.privacy_retention_runs AS run_row
       WHERE run_row.id = v_run_id
     ) THEN
    RAISE EXCEPTION 'preview did not persist the canonical active binding-set versions';
  END IF;
  IF v_preview_hash IS DISTINCT FROM pg_catalog.encode(
    extensions.digest(
      pg_catalog.concat_ws(
        ':', 'g014-retention-preview-v1', 'g014_fixture_retention',
        (SELECT cutoff::text FROM privacy_retention.privacy_retention_runs WHERE id = v_run_id),
        '2',
        (SELECT version FROM privacy_retention.privacy_retention_classes WHERE code = 'g014_fixture_retention'),
        v_adapter_version,
        v_source_mapping_version
      ),
      'sha256'
    ),
    'hex'
  ) THEN
    RAISE EXCEPTION 'preview hash did not bind both canonical active binding-set versions';
  END IF;
  INSERT INTO pg_temp.g014_retention_fixture VALUES
    ('success_run_id', v_run_id::text),
    ('success_preview_hash', v_preview_hash),
    ('success_idempotency', 'g014-fixture-retention-success-001');

  SELECT public.confirm_privacy_retention_run(
    v_run_id, v_preview_hash, '보존·분리 적용', 'g014-fixture-retention-success-001'
  ) INTO v_confirmation;
  IF v_confirmation ->> 'adapterVersion' IS DISTINCT FROM v_adapter_version
     OR v_confirmation ->> 'sourceMappingVersion' IS DISTINCT FROM v_source_mapping_version THEN
    RAISE EXCEPTION 'confirmation did not return the durable run binding';
  END IF;
  SELECT public.confirm_privacy_retention_run(
    v_run_id, v_preview_hash, '보존·분리 적용', 'g014-fixture-retention-success-001'
  ) INTO v_confirmation;
  IF v_confirmation ->> 'status' IS DISTINCT FROM 'confirmed'
     OR v_confirmation ->> 'adapterVersion' IS DISTINCT FROM v_adapter_version
     OR v_confirmation ->> 'sourceMappingVersion' IS DISTINCT FROM v_source_mapping_version THEN
    RAISE EXCEPTION 'confirmation replay did not return the exact durable binding';
  END IF;
  SELECT public.apply_privacy_retention_run(
    v_run_id, v_preview_hash, 'g014-fixture-retention-success-001', 10000
  ) INTO v_apply;
  IF v_apply ->> 'adapterVersion' IS DISTINCT FROM v_adapter_version
     OR v_apply ->> 'sourceMappingVersion' IS DISTINCT FROM v_source_mapping_version
     OR v_apply ->> 'status' IS DISTINCT FROM 'partial' THEN
    RAISE EXCEPTION 'apply did not return the exact durable binding receipt';
  END IF;

  v_claims := public.claim_privacy_retention_storage_items(
    v_run_id, v_preview_hash, 'g014-fixture-retention-success-001', 2
  );
  IF pg_catalog.jsonb_array_length(v_claims) IS DISTINCT FROM 1
     OR pg_catalog.jsonb_object_length(v_claims -> 0) IS DISTINCT FROM 7
     OR (v_claims -> 0) - ARRAY[
       'workItemId', 'claimToken', 'objectLocatorHash', 'objectVersionHash',
       'claimHash', 'adapterVersion', 'sourceMappingVersion'
     ] IS DISTINCT FROM '{}'::jsonb
     OR pg_catalog.jsonb_typeof(v_claims -> 0 -> 'objectLocatorHash') IS DISTINCT FROM 'string'
     OR (v_claims -> 0 ->> 'objectLocatorHash') IS NULL
     OR (v_claims -> 0 ->> 'objectLocatorHash') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'fixture storage claim was not exact, canonical, and bounded';
  END IF;
  IF (v_claims -> 0 ->> 'objectLocatorHash') IS DISTINCT FROM
       privacy_retention.g014_retention_storage_locator_hash(
         'fixture-bucket', 'opaque-fixture-object'
       )
     OR (v_claims -> 0 ->> 'objectVersionHash') IS DISTINCT FROM (
       SELECT pg_catalog.encode(
         extensions.digest(pg_catalog.to_jsonb(object_row) ->> 'version', 'sha256'),
         'hex'
       )
       FROM storage.objects AS object_row
       WHERE object_row.id = '59000000-0000-4000-8000-000000000102'
     ) THEN
    RAISE EXCEPTION 'storage claim did not bind the authoritative catalog identity';
  END IF;
  v_effect := public.resolve_privacy_retention_provider_effect(
    v_run_id, v_preview_hash, 'g014-fixture-retention-success-001',
    (v_claims -> 0 ->> 'workItemId')::uuid,
    (v_claims -> 0 ->> 'claimToken')::uuid,
    v_claims -> 0 ->> 'claimHash',
    v_claims -> 0 ->> 'objectLocatorHash',
    v_claims -> 0 ->> 'objectVersionHash',
    v_adapter_version, v_source_mapping_version, 'fixture.provider.v1'
  );

  IF pg_catalog.jsonb_object_length(v_effect) IS DISTINCT FROM 12
     OR (v_effect - ARRAY[
       'workItemId', 'claimToken', 'claimHash', 'objectLocatorHash',
       'objectVersionHash', 'adapterVersion', 'sourceMappingVersion',
       'providerEffectToken', 'providerVerifierRef', 'leaseExpiresAt',
       'bucketName', 'objectName'
     ]) IS DISTINCT FROM '{}'::jsonb
     OR v_effect ->> 'bucketName' IS DISTINCT FROM 'fixture-bucket'
     OR v_effect ->> 'objectName' IS DISTINCT FROM 'opaque-fixture-object' THEN
    RAISE EXCEPTION 'ephemeral provider effect resolution was not exact and bounded';
  END IF;
  v_reconciliation := public.get_privacy_retention_provider_reconciliation_work(
    v_run_id, v_preview_hash, 'g014-fixture-retention-success-001', 'fixture.provider.v1', 1
  );
  IF pg_catalog.jsonb_array_length(v_reconciliation) IS DISTINCT FROM 1
     OR pg_catalog.jsonb_object_length(v_reconciliation -> 0) IS DISTINCT FROM 10
     OR (v_reconciliation -> 0) - ARRAY[
       'workItemId', 'claimToken', 'claimHash', 'objectLocatorHash',
       'objectVersionHash', 'adapterVersion', 'sourceMappingVersion',
       'providerEffectToken', 'providerVerifierRef', 'workMode'
     ] IS DISTINCT FROM '{}'::jsonb
     OR (v_reconciliation -> 0 ->> 'workMode') IS DISTINCT FROM 'verify_absence_only' THEN
    RAISE EXCEPTION 'provider reconciliation leaked a locator';
  END IF;
  v_receipts := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'workItemId', v_claims -> 0 ->> 'workItemId',
    'claimToken', v_claims -> 0 ->> 'claimToken',
    'objectLocatorHash', v_claims -> 0 ->> 'objectLocatorHash',
    'objectVersionHash', v_claims -> 0 ->> 'objectVersionHash',
    'claimHash', v_claims -> 0 ->> 'claimHash',
    'providerEffectToken', v_effect ->> 'providerEffectToken',
    'providerReceiptRef', 'fixture.receipt.0001',
    'providerReceiptHash', repeat('b', 64),
    'providerAbsenceHash', repeat('c', 64),
    'verifierRef', 'fixture.provider.v1'
  ));

  IF v_receipts IS NULL OR pg_catalog.jsonb_array_length(v_receipts) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'fixture storage receipt was not exact and bounded';
  END IF;
  BEGIN
    PERFORM public.record_privacy_retention_storage_provider_receipts(
      v_run_id, v_preview_hash, 'g014-fixture-retention-success-001',
      pg_catalog.jsonb_set(v_receipts, '{0,claimHash}', pg_catalog.to_jsonb(repeat('d', 64)))
    );
    RAISE EXCEPTION 'mismatched storage claim was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'mismatched storage claim was accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.record_privacy_retention_storage_provider_receipts(
      v_run_id, v_preview_hash, 'g014-fixture-retention-success-001',
      pg_catalog.jsonb_set(v_receipts, '{0,unexpected}', '"x"'::jsonb)
    );
    RAISE EXCEPTION 'provider receipt extra key was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'provider receipt extra key was accepted' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.record_privacy_retention_storage_provider_receipts(
      v_run_id, v_preview_hash, 'g014-fixture-retention-success-001',
      pg_catalog.jsonb_set(v_receipts, '{0,work_item_id}', '"00000000-0000-4000-8000-000000000001"'::jsonb)
    );
    RAISE EXCEPTION 'provider receipt snake_case key was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'provider receipt snake_case key was accepted' THEN RAISE; END IF;
  END;
  PERFORM public.record_privacy_retention_storage_provider_receipts(
    v_run_id, v_preview_hash, 'g014-fixture-retention-success-001', v_receipts
  );
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_retention_runs AS run_row
    WHERE run_row.id = v_run_id
      AND run_row.storage_receipts_hash IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'storage receipt-set hash was persisted before complete finalize';
  END IF;
  BEGIN
    PERFORM public.record_privacy_retention_storage_provider_receipts(
      v_run_id, v_preview_hash, 'g014-fixture-retention-success-001', v_receipts
    );
    RAISE EXCEPTION 'stale storage claim replay was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'stale storage claim replay was accepted' THEN RAISE; END IF;
  END;

  SELECT public.finalize_privacy_retention_run(
    v_run_id, v_preview_hash, 'g014-fixture-retention-success-001'
  ) INTO v_final;
  IF v_final ->> 'status' IS DISTINCT FROM 'applied'
     OR (v_final #>> '{readback,passed}')::boolean IS DISTINCT FROM true
     OR v_final ->> 'adapterVersion' IS DISTINCT FROM v_adapter_version
     OR v_final ->> 'sourceMappingVersion' IS DISTINCT FROM v_source_mapping_version
     OR (SELECT storage_receipts_hash
         FROM privacy_retention.privacy_retention_runs WHERE id = v_run_id)
        IS DISTINCT FROM privacy_retention.g014_retention_storage_receipt_set_hash(v_run_id)
     OR NOT EXISTS (
       SELECT 1 FROM privacy_retention.g014_retention_receipts AS receipt
       WHERE receipt.run_id = v_run_id
         AND receipt.receipt_kind = 'database_source_absence'
     )
     OR NOT EXISTS (
       SELECT 1 FROM privacy_retention.g014_retention_receipts AS receipt
       WHERE receipt.run_id = v_run_id
         AND receipt.receipt_kind = 'storage_provider_absence'
     )
     OR EXISTS (
       SELECT 1 FROM privacy_retention.g014_retention_fixture_source
       WHERE id IN ('58000000-0000-4000-8000-000000000001', '58000000-0000-4000-8000-000000000002')
     ) THEN
    RAISE EXCEPTION 'successful transactional source/readback path did not prove exact absence';
  END IF;
  SELECT public.finalize_privacy_retention_run(
    v_run_id, v_preview_hash, 'g014-fixture-retention-success-001'
  ) INTO v_final;
  IF v_final ->> 'status' IS DISTINCT FROM 'applied'
     OR v_final ->> 'adapterVersion' IS DISTINCT FROM v_adapter_version
     OR v_final ->> 'sourceMappingVersion' IS DISTINCT FROM v_source_mapping_version THEN
    RAISE EXCEPTION 'finalize replay did not return the exact durable binding';
  END IF;
END;
$successful_workflow$;

SELECT pg_temp.g014_expect_failure($sql$
  SELECT public.preview_privacy_retention_run(
    'g014_fixture_retention', pg_catalog.clock_timestamp() - interval '1 second', 101, 10000
  )
$sql$);
SELECT pg_temp.g014_expect_failure($sql$
  SELECT public.preview_privacy_retention_run(
    'g014_fixture_retention', pg_catalog.clock_timestamp() + interval '1 minute', 1, 10000
  )
$sql$);
SELECT pg_temp.g014_expect_failure($sql$
  SELECT public.preview_privacy_retention_run(
    'g014_fixture_retention', NULL::timestamptz, 1, 10000
  )
$sql$);
SELECT pg_temp.g014_expect_failure($sql$
  SELECT public.preview_privacy_retention_run(
    'g014_fixture_retention', pg_catalog.clock_timestamp() - interval '1 second', NULL::integer, 10000
  )
$sql$);
SELECT pg_temp.g014_expect_failure($sql$
  SELECT public.preview_privacy_retention_run(
    'g014_fixture_retention', pg_catalog.clock_timestamp() - interval '1 second', 1, NULL::integer
  )
$sql$);
SELECT pg_temp.g014_expect_failure(format(
  'SELECT public.apply_privacy_retention_run(%L::uuid, %L, %L, NULL::integer)',
  (SELECT fixture_value FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'success_run_id'),
  (SELECT fixture_value FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'success_preview_hash'),
  (SELECT fixture_value FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'success_idempotency')
));
SELECT pg_temp.g014_expect_failure(format(
  'SELECT public.claim_privacy_retention_storage_items(%L::uuid, %L, %L, NULL::integer)',
  (SELECT fixture_value FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'success_run_id'),
  (SELECT fixture_value FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'success_preview_hash'),
  (SELECT fixture_value FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'success_idempotency')
));
RESET ROLE;

-- A provider can report an exact failure, but cannot turn it into success.  The
-- bounded claim is terminally partial until a later approved retry obtains a
-- fresh immutable claim and provider-absence receipt.
INSERT INTO storage.objects (id, bucket_id, name, owner_id, version)
VALUES
  ('59000000-0000-4000-8000-000000000105', 'fixture-bucket', 'opaque-partial-object', NULL, 'fixture-version-partial-v1'),
  ('59000000-0000-4000-8000-000000000106', 'fixture-bucket', 'opaque-mixed-object', NULL, 'fixture-version-mixed-v1');

INSERT INTO privacy_retention.privacy_retention_work_items (
  id, class_code, data_class, source_type, source_ref_hash, trigger_at,
  storage_version_hash
) VALUES
  (
    '59000000-0000-4000-8000-000000000005', 'g014_fixture_retention', 'notifications_operational', 'ocr_artifact',
    privacy_retention.g014_retention_storage_locator_hash('fixture-bucket', 'opaque-partial-object'),
    pg_catalog.clock_timestamp() - interval '1 minute',
    pg_catalog.encode(extensions.digest('fixture-version-partial-v1', 'sha256'), 'hex')
  ),
  (
    '59000000-0000-4000-8000-000000000006', 'g014_fixture_retention', 'notifications_operational', 'ocr_artifact',
    privacy_retention.g014_retention_storage_locator_hash('fixture-bucket', 'opaque-mixed-object'),
    pg_catalog.clock_timestamp() - interval '1 minute',
    pg_catalog.encode(extensions.digest('fixture-version-mixed-v1', 'sha256'), 'hex')
  );

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $partial_provider_workflow$
DECLARE
  v_preview jsonb;
  v_run_id uuid;
  v_preview_hash text;
  v_claim uuid;
  v_claim_json jsonb;
  v_receipts jsonb;
  v_effect jsonb;
  v_final jsonb;
BEGIN
  SELECT public.preview_privacy_retention_run(
    'g014_fixture_retention', pg_catalog.clock_timestamp() - interval '1 second', 2, 10000
  ) INTO v_preview;
  v_run_id := (v_preview ->> 'operationId')::uuid;
  v_preview_hash := v_preview ->> 'previewHash';
  PERFORM public.confirm_privacy_retention_run(v_run_id, v_preview_hash, '보존·분리 적용', 'g014-fixture-retention-partial-001');
  PERFORM public.apply_privacy_retention_run(v_run_id, v_preview_hash, 'g014-fixture-retention-partial-001', 10000);
  SELECT (public.claim_privacy_retention_storage_items(
    v_run_id, v_preview_hash, 'g014-fixture-retention-partial-001', 1
  ) -> 0 ->> 'claimToken')::uuid INTO v_claim;
  PERFORM public.fail_privacy_retention_storage_claims(
    v_run_id, v_preview_hash, 'g014-fixture-retention-partial-001', ARRAY[v_claim], 'provider_absence_unverified'
  );
  v_claim_json := public.claim_privacy_retention_storage_items(
    v_run_id, v_preview_hash, 'g014-fixture-retention-partial-001', 1
  );
  IF pg_catalog.jsonb_array_length(v_claim_json) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'mixed retry did not issue the second bounded storage claim';
  END IF;
  IF pg_catalog.jsonb_object_length(v_claim_json -> 0) IS DISTINCT FROM 7
     OR (v_claim_json -> 0) - ARRAY[
       'workItemId', 'claimToken', 'objectLocatorHash', 'objectVersionHash',
       'claimHash', 'adapterVersion', 'sourceMappingVersion'
     ] IS DISTINCT FROM '{}'::jsonb
     OR pg_catalog.jsonb_typeof(v_claim_json -> 0 -> 'objectLocatorHash') IS DISTINCT FROM 'string'
     OR (v_claim_json -> 0 ->> 'objectLocatorHash') IS NULL
     OR (v_claim_json -> 0 ->> 'objectLocatorHash') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'storage claim output is not exact camelCase JSON';
  END IF;
  v_effect := public.resolve_privacy_retention_provider_effect(
    v_run_id, v_preview_hash, 'g014-fixture-retention-partial-001',
    (v_claim_json -> 0 ->> 'workItemId')::uuid,
    (v_claim_json -> 0 ->> 'claimToken')::uuid,
    v_claim_json -> 0 ->> 'claimHash',
    v_claim_json -> 0 ->> 'objectLocatorHash',
    v_claim_json -> 0 ->> 'objectVersionHash',
    v_claim_json -> 0 ->> 'adapterVersion',
    v_claim_json -> 0 ->> 'sourceMappingVersion',
    'fixture.provider.v1'
  );
  v_receipts := pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
    'workItemId', v_claim_json -> 0 ->> 'workItemId',
    'claimToken', v_claim_json -> 0 ->> 'claimToken',
    'objectLocatorHash', v_claim_json -> 0 ->> 'objectLocatorHash',
    'objectVersionHash', v_claim_json -> 0 ->> 'objectVersionHash',
    'claimHash', v_claim_json -> 0 ->> 'claimHash',
    'providerEffectToken', v_effect ->> 'providerEffectToken',
    'providerReceiptRef', 'fixture.mixed.receipt.1',
    'providerReceiptHash', repeat('a', 64),
    'providerAbsenceHash', repeat('b', 64),
    'verifierRef', 'fixture.provider.v1'
  ));
  PERFORM public.record_privacy_retention_storage_provider_receipts(
    v_run_id, v_preview_hash, 'g014-fixture-retention-partial-001', v_receipts
  );
  SELECT public.finalize_privacy_retention_run(v_run_id, v_preview_hash, 'g014-fixture-retention-partial-001') INTO v_final;
  IF v_final ->> 'status' IS DISTINCT FROM 'partial'
     OR (v_final #>> '{readback,passed}')::boolean
     OR (SELECT storage_receipts_hash IS NOT NULL
         FROM privacy_retention.privacy_retention_runs WHERE id = v_run_id)
     OR (SELECT count(*) FROM privacy_retention.g014_retention_receipts
         WHERE run_id = v_run_id AND receipt_kind = 'storage_provider_absence') IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'mixed provider outcome was incorrectly completed';
  END IF;
END;
$partial_provider_workflow$;
RESET ROLE;
-- A hold created after a bounded external-storage claim invalidates that claim
-- before the provider receipt can be accepted or finalize the run.
INSERT INTO privacy_retention.g014_retention_fixture_source (id, marker)
VALUES ('58000000-0000-4000-8000-000000000007', 'claim_then_hold_storage_source');
INSERT INTO storage.objects (id, bucket_id, name, owner_id, version)
VALUES (
  '59000000-0000-4000-8000-000000000107',
  'fixture-bucket',
  'opaque-claim-then-hold-object',
  NULL,
  'fixture-version-hold-v1'
);

INSERT INTO privacy_retention.privacy_retention_work_items (
  id, class_code, data_class, source_type, source_ref_hash, subject_ref_hash, trigger_at,
  storage_version_hash
) VALUES (
  '59000000-0000-4000-8000-000000000007', 'g014_fixture_retention', 'notifications_operational',
  'ocr_artifact',
  privacy_retention.g014_retention_storage_locator_hash(
    'fixture-bucket', 'opaque-claim-then-hold-object'
  ),
  repeat('d', 64), pg_catalog.clock_timestamp() - interval '2 days',
  pg_catalog.encode(extensions.digest('fixture-version-hold-v1', 'sha256'), 'hex')
);

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $hold_after_claim_issue$
DECLARE
  v_preview jsonb;
  v_run_id uuid;
  v_preview_hash text;
  v_claims jsonb;
BEGIN
  SELECT public.preview_privacy_retention_run(
    'g014_fixture_retention', pg_catalog.clock_timestamp() - interval '1 second', 1, 10000
  ) INTO v_preview;
  v_run_id := (v_preview ->> 'operationId')::uuid;
  v_preview_hash := v_preview ->> 'previewHash';
  PERFORM public.confirm_privacy_retention_run(
    v_run_id, v_preview_hash, '보존·분리 적용', 'g014-fixture-retention-hold-after-claim-001'
  );
  PERFORM public.apply_privacy_retention_run(
    v_run_id, v_preview_hash, 'g014-fixture-retention-hold-after-claim-001', 10000
  );
  v_claims := public.claim_privacy_retention_storage_items(
    v_run_id, v_preview_hash, 'g014-fixture-retention-hold-after-claim-001', 1
  );
  IF pg_catalog.jsonb_array_length(v_claims) IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'hold-after-claim fixture did not issue one bounded storage claim';
  END IF;
  IF pg_catalog.jsonb_object_length(v_claims -> 0) IS DISTINCT FROM 7
     OR (v_claims -> 0) - ARRAY[
       'workItemId', 'claimToken', 'objectLocatorHash', 'objectVersionHash',
       'claimHash', 'adapterVersion', 'sourceMappingVersion'
     ] IS DISTINCT FROM '{}'::jsonb
     OR pg_catalog.jsonb_typeof(v_claims -> 0 -> 'objectLocatorHash') IS DISTINCT FROM 'string'
     OR (v_claims -> 0 ->> 'objectLocatorHash') IS NULL
     OR (v_claims -> 0 ->> 'objectLocatorHash') !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'hold-after-claim output is not exact, canonical claim JSON';
  END IF;
  INSERT INTO pg_temp.g014_retention_fixture (fixture_key, fixture_value) VALUES
    ('hold_after_claim_run_id', v_run_id::text),
    ('hold_after_claim_preview_hash', v_preview_hash),
    ('hold_after_claim_claims', v_claims::text);
END;
$hold_after_claim_issue$;
RESET ROLE;

INSERT INTO privacy_retention.privacy_legal_holds (
  subject_ref_hash, data_class, reason_code, approved_by, approved_evidence_ref
) VALUES (
  repeat('d', 64), 'notifications_operational', 'fixture_hold_after_claim',
  '5a000000-0000-4000-8000-000000000007', 'fixture.legal.hold.after.claim.1'
);

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $hold_after_claim_receipt$
DECLARE
  v_run_id uuid;
  v_preview_hash text;
  v_claims jsonb;
  v_effect jsonb;
  v_final jsonb;
BEGIN
  SELECT fixture_value::uuid INTO v_run_id
  FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'hold_after_claim_run_id';
  SELECT fixture_value INTO v_preview_hash
  FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'hold_after_claim_preview_hash';
  SELECT fixture_value::jsonb INTO v_claims
  FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'hold_after_claim_claims';
  v_effect := public.resolve_privacy_retention_provider_effect(
    v_run_id, v_preview_hash, 'g014-fixture-retention-hold-after-claim-001',
    (v_claims -> 0 ->> 'workItemId')::uuid,
    (v_claims -> 0 ->> 'claimToken')::uuid,
    v_claims -> 0 ->> 'claimHash',
    v_claims -> 0 ->> 'objectLocatorHash',
    v_claims -> 0 ->> 'objectVersionHash',
    v_claims -> 0 ->> 'adapterVersion',
    v_claims -> 0 ->> 'sourceMappingVersion',
    'fixture.provider.v1'
  );
  IF v_effect IS NOT NULL THEN
    RAISE EXCEPTION 'hold before provider effect returned an ephemeral locator';
  END IF;
  SELECT public.finalize_privacy_retention_run(
    v_run_id, v_preview_hash, 'g014-fixture-retention-hold-after-claim-001'
  ) INTO v_final;
  IF v_final ->> 'status' IS DISTINCT FROM 'partial'
     OR (v_final #>> '{readback,passed}')::boolean
     OR (v_final #>> '{readback,checks,noActiveHoldMutated}')::boolean IS DISTINCT FROM true
     OR EXISTS (
       SELECT 1
       FROM privacy_retention.g014_retention_receipts AS receipt
       WHERE receipt.run_id = v_run_id
         AND receipt.receipt_kind = 'storage_provider_absence'
     )
     OR EXISTS (
       SELECT 1
       FROM privacy_retention.g014_retention_storage_claims AS claim_row
       WHERE claim_row.run_id = v_run_id
         AND claim_row.status = 'acknowledged'
     )
     OR EXISTS (
       SELECT 1
       FROM privacy_retention.privacy_retention_work_items AS item
       WHERE item.id = '59000000-0000-4000-8000-000000000007'
         AND item.status = 'purged'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM privacy_retention.privacy_retention_run_items AS run_item
       WHERE run_item.run_id = v_run_id
         AND run_item.work_item_id = '59000000-0000-4000-8000-000000000007'
         AND run_item.status = 'held'
     )
     OR NOT EXISTS (
       SELECT 1
       FROM privacy_retention.g014_retention_storage_claims AS claim_row
       WHERE claim_row.run_id = v_run_id
         AND claim_row.work_item_id = '59000000-0000-4000-8000-000000000007'
         AND claim_row.status = 'failed'
     )
     OR (SELECT run_row.storage_receipts_hash IS NOT NULL
         FROM privacy_retention.privacy_retention_runs AS run_row
         WHERE run_row.id = v_run_id) THEN
    RAISE EXCEPTION 'post-claim legal hold accepted external storage success or finalization';
  END IF;
END;
$hold_after_claim_receipt$;
RESET ROLE;

-- A legal hold inserted before preview wins.  It can only be released, never
-- deleted or edited in place, and the run remains held rather than mutating its source.
INSERT INTO privacy_retention.privacy_legal_holds (
  subject_ref_hash, data_class, reason_code, approved_by, approved_evidence_ref
) VALUES (
  repeat('f', 64), 'notifications_operational', 'fixture_hold',
  '5a000000-0000-4000-8000-000000000004', 'fixture.legal.hold.1'
);
INSERT INTO privacy_retention.privacy_retention_work_items (
  id, class_code, data_class, source_type, source_ref_hash, subject_ref_hash, trigger_at
) VALUES (
  '59000000-0000-4000-8000-000000000004', 'g014_fixture_retention', 'notifications_operational', 'notification',
  privacy_retention.g014_retention_source_hash('fixture_notification_adapter', '58000000-0000-4000-8000-000000000004'),
  repeat('f', 64), pg_catalog.clock_timestamp() - interval '3 days'
);

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $hold_race$
DECLARE
  v_preview jsonb;
  v_run_id uuid;
  v_preview_hash text;
  v_final jsonb;
BEGIN
  SELECT public.preview_privacy_retention_run(
    'g014_fixture_retention', pg_catalog.clock_timestamp() - interval '1 second', 1, 10000
  ) INTO v_preview;
  v_run_id := (v_preview ->> 'operationId')::uuid;
  v_preview_hash := v_preview ->> 'previewHash';
  PERFORM public.confirm_privacy_retention_run(v_run_id, v_preview_hash, '보존·분리 적용', 'g014-fixture-retention-hold-001');
  PERFORM public.apply_privacy_retention_run(v_run_id, v_preview_hash, 'g014-fixture-retention-hold-001', 10000);
  SELECT public.finalize_privacy_retention_run(v_run_id, v_preview_hash, 'g014-fixture-retention-hold-001')
  INTO v_final;
  IF NOT EXISTS (
    SELECT 1 FROM privacy_retention.privacy_retention_run_items
    WHERE run_id = v_run_id AND status = 'held'
  ) OR NOT EXISTS (
    SELECT 1 FROM privacy_retention.g014_retention_fixture_source
    WHERE id = '58000000-0000-4000-8000-000000000004'
  ) OR (v_final #>> '{readback,checks,noActiveHoldMutated}')::boolean IS DISTINCT FROM true
    OR (SELECT no_active_hold_mutated FROM privacy_retention.privacy_retention_runs WHERE id = v_run_id)
       IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'legal hold race did not prevent source mutation';
  END IF;
END;
$hold_race$;
RESET ROLE;

SELECT pg_temp.g014_expect_failure($sql$
  DELETE FROM privacy_retention.privacy_legal_holds
  WHERE subject_ref_hash = repeat('f', 64)
$sql$);
UPDATE privacy_retention.privacy_legal_holds
SET status = 'released', released_at = pg_catalog.clock_timestamp()
WHERE subject_ref_hash = repeat('f', 64);
SELECT pg_temp.g014_expect_failure($sql$
  UPDATE privacy_retention.privacy_legal_holds
  SET status = 'active', released_at = NULL
  WHERE subject_ref_hash = repeat('f', 64)
$sql$);

-- A source that refuses deletion remains present and is reported as a failed,
-- non-completed run rather than being self-attested from a mutation row count.
CREATE OR REPLACE FUNCTION privacy_retention.g014_retention_fixture_prevent_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RETURN NULL;
END;
$function$;
ALTER FUNCTION privacy_retention.g014_retention_fixture_prevent_delete() OWNER TO privacy_workflow_owner;
CREATE TRIGGER g014_retention_fixture_prevent_delete
  BEFORE DELETE ON privacy_retention.g014_retention_fixture_source
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_retention_fixture_prevent_delete();
INSERT INTO privacy_retention.privacy_retention_work_items (
  id, class_code, data_class, source_type, source_ref_hash, trigger_at
) VALUES (
  '59000000-0000-4000-8000-000000000003', 'g014_fixture_retention', 'notifications_operational', 'notification',
  privacy_retention.g014_retention_source_hash('fixture_notification_adapter', '58000000-0000-4000-8000-000000000003'),
  pg_catalog.clock_timestamp() - interval '4 days'
);

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
DO $source_present$
DECLARE
  v_preview jsonb;
  v_run_id uuid;
  v_preview_hash text;
  v_final jsonb;
BEGIN
  SELECT public.preview_privacy_retention_run(
    'g014_fixture_retention', pg_catalog.clock_timestamp() - interval '1 second', 1, 10000
  ) INTO v_preview;
  v_run_id := (v_preview ->> 'operationId')::uuid;
  v_preview_hash := v_preview ->> 'previewHash';
  PERFORM public.confirm_privacy_retention_run(v_run_id, v_preview_hash, '보존·분리 적용', 'g014-fixture-retention-source-001');
  PERFORM public.apply_privacy_retention_run(v_run_id, v_preview_hash, 'g014-fixture-retention-source-001', 10000);
  SELECT public.finalize_privacy_retention_run(v_run_id, v_preview_hash, 'g014-fixture-retention-source-001') INTO v_final;
  IF v_final ->> 'status' IS DISTINCT FROM 'partial'
     OR NOT EXISTS (
       SELECT 1 FROM privacy_retention.g014_retention_fixture_source
       WHERE id = '58000000-0000-4000-8000-000000000003'
     ) THEN
    RAISE EXCEPTION 'authoritative source-presence readback was bypassed';
  END IF;
END;
$source_present$;
RESET ROLE;

SELECT pg_temp.g014_expect_failure($sql$
  UPDATE privacy_retention.privacy_retention_runs
  SET status = 'failed'
  WHERE id = (SELECT fixture_value::uuid FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'success_run_id')
$sql$);
SELECT pg_temp.g014_expect_failure($sql$
  UPDATE privacy_retention.privacy_retention_runs
  SET adapter_version = repeat('0', 64)
  WHERE id = (SELECT fixture_value::uuid FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'success_run_id')
$sql$);
SELECT pg_temp.g014_expect_failure($sql$
  UPDATE privacy_retention.privacy_retention_runs
  SET source_mapping_version = repeat('1', 64)
  WHERE id = (SELECT fixture_value::uuid FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'success_run_id')
$sql$);
ALTER TABLE privacy_retention.g014_retention_fixture_source
  ALTER COLUMN id TYPE text USING id::text;

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT pg_temp.g014_expect_failure(format(
  'SELECT public.confirm_privacy_retention_run(%L::uuid, %L, %L, %L)',
  (SELECT fixture_value FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'success_run_id'),
  (SELECT fixture_value FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'success_preview_hash'),
  '보존·분리 적용',
  (SELECT fixture_value FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'success_idempotency')
));
RESET ROLE;

DROP TABLE privacy_retention.g014_retention_fixture_source;
CREATE TABLE privacy_retention.g014_retention_fixture_source (
  id text PRIMARY KEY,
  marker text NOT NULL CHECK (marker ~ '^[a-z][a-z0-9_]{2,63}$')
);
ALTER TABLE privacy_retention.g014_retention_fixture_source OWNER TO privacy_workflow_owner;
SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT pg_temp.g014_expect_failure(format(
  'SELECT public.finalize_privacy_retention_run(%L::uuid, %L, %L)',
  (SELECT fixture_value FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'success_run_id'),
  (SELECT fixture_value FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'success_preview_hash'),
  (SELECT fixture_value FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'success_idempotency')
));
RESET ROLE;

-- A replay is not permitted to reuse a historic run after the current active
-- ordered adapter/source-mapping sets drift.  The binding remains immutable,
-- but an approved mapping may be explicitly disabled, which must fence every
-- subsequent public transition for that run.
UPDATE privacy_retention.retention_class_adapter_bindings
SET status = 'disabled'
WHERE class_code = 'g014_fixture_retention'
  AND adapter_code = 'fixture_notification_adapter'
  AND adapter_version = 'fixture-notification-v1';

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT pg_temp.g014_expect_failure(format(
  'SELECT public.confirm_privacy_retention_run(%L::uuid, %L, %L, %L)',
  (SELECT fixture_value FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'success_run_id'),
  (SELECT fixture_value FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'success_preview_hash'),
  '보존·분리 적용',
  (SELECT fixture_value FROM pg_temp.g014_retention_fixture WHERE fixture_key = 'success_idempotency')
));
RESET ROLE;

DO $durable_locator_readback$
DECLARE
  v_relation regclass;
  v_locator_leaked boolean;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'privacy_retention.g014_retention_storage_claims'::regclass,
    'privacy_retention.g014_retention_provider_effects'::regclass,
    'privacy_retention.g014_retention_receipts'::regclass,
    'privacy_retention.privacy_retention_work_items'::regclass,
    'privacy_retention.privacy_retained_records'::regclass,
    'privacy_retention.privacy_retention_runs'::regclass,
    'privacy_retention.privacy_retention_run_items'::regclass
  ] LOOP
    EXECUTE pg_catalog.format(
      'SELECT EXISTS (
         SELECT 1
         FROM %s AS retained_row
         WHERE pg_catalog.to_jsonb(retained_row)::text ~ $1
       )',
      v_relation
    ) INTO v_locator_leaked
      USING '(fixture-bucket|opaque-(fixture|partial|mixed|claim-then-hold)-object)';
    IF v_locator_leaked THEN
      RAISE EXCEPTION 'G014-05 durable retention readback leaked a raw storage locator';
    END IF;
  END LOOP;
END;
$durable_locator_readback$;
ROLLBACK;
