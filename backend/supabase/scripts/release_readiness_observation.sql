-- Metadata only. Execute inside an explicit READ ONLY transaction.
-- This is an observation, not release approval or a migration ledger repair.
WITH policy AS (
  SELECT version, locale, status, content_sha256, effective_at, published_at,
         operator_approval_ref IS NOT NULL AND length(operator_approval_ref)>0 AS approval_reference_present
  FROM privacy_retention.privacy_policy_versions
  WHERE status='published' AND effective_at<=pg_catalog.statement_timestamp()
  ORDER BY effective_at DESC LIMIT 1
), expected_classes(code) AS (
  VALUES ('privacy_identity_audit'),('privacy_marketing_audit'),
         ('privacy_account_deletion_audit'),('privacy_incident_audit'),
         ('privacy_retention_run_audit'),('notifications_operational')
), classes AS (
  SELECT e.code, c.code IS NOT NULL AS present,
         coalesce(c.status='active' AND c.data_class IS NOT NULL
           AND c.basis_code IS NOT NULL AND c.trigger_type IS NOT NULL
           AND (e.code='notifications_operational' OR
                (c.data_class=e.code AND c.trigger_type='event_occurred'))
           AND c.retention_period>interval '0 seconds'
           AND c.approved_evidence_ref IS NOT NULL AND c.version IS NOT NULL
           AND c.activated_at<=pg_catalog.statement_timestamp(),false) AS configured
  FROM expected_classes e
  LEFT JOIN privacy_retention.privacy_retention_classes c USING(code)
), private_relations AS (
  SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='privacy_retention'
    AND c.relname IN ('privacy_policy_versions','privacy_retention_classes','privacy_audit_events')
    AND c.relkind IN ('r','p')
)
SELECT pg_catalog.jsonb_build_object(
 'schemaVersion',1,
 'observedAt',pg_catalog.statement_timestamp(),
 'transactionReadOnly',pg_catalog.current_setting('transaction_read_only')='on',
 'ledger', (SELECT pg_catalog.jsonb_build_object('count',count(*),'terminalVersion',max(version))
            FROM supabase_migrations.schema_migrations),
 'policy', (SELECT pg_catalog.to_jsonb(policy) FROM policy),
 'retention', (SELECT pg_catalog.jsonb_agg(pg_catalog.to_jsonb(classes) ORDER BY code) FROM classes),
 'privateRelations',(SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'name',relname,'rls',relrowsecurity,'forceRls',relforcerowsecurity) ORDER BY relname) FROM private_relations),
 'unvalidatedPublicConstraints',(SELECT count(*) FROM pg_catalog.pg_constraint k
    JOIN pg_catalog.pg_namespace n ON n.oid=k.connamespace WHERE n.nspname='public' AND NOT k.convalidated),
 'mutablePublicFunctionPaths',(SELECT count(*) FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.prokind='f'
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.unnest(p.proconfig) v WHERE v LIKE 'search_path=%')
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_depend d WHERE d.classid='pg_proc'::regclass
        AND d.objid=p.oid AND d.deptype='e'))
) AS observation;
