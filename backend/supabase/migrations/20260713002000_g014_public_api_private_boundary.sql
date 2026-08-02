-- G014-01: fail closed at the Supabase public/private boundary.
-- This migration intentionally preserves object OIDs when moving retained privacy
-- relations. It never rewrites historical audit rows.

DO $role$
DECLARE
  v_role record;
BEGIN
  SELECT role_row.oid,
         role_row.rolsuper,
         role_row.rolinherit,
         role_row.rolcreaterole,
         role_row.rolcreatedb,
         role_row.rolreplication,
         role_row.rolbypassrls,
         role_row.rolcanlogin
  INTO v_role
  FROM pg_catalog.pg_roles AS role_row
  WHERE role_row.rolname = 'privacy_workflow_owner';

  IF NOT FOUND THEN
    EXECUTE 'CREATE ROLE privacy_workflow_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS';
  ELSE
    IF v_role.rolsuper
       OR v_role.rolinherit
       OR v_role.rolcreaterole
       OR v_role.rolcreatedb
       OR v_role.rolreplication
       OR v_role.rolbypassrls
       OR v_role.rolcanlogin THEN
      RAISE EXCEPTION 'privacy_workflow_owner role attributes are incompatible';
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      WHERE membership.member = v_role.oid
         OR membership.roleid = v_role.oid
    ) THEN
      RAISE EXCEPTION 'privacy_workflow_owner has unexpected role membership or effective access';
    END IF;
  END IF;

  EXECUTE 'ALTER ROLE privacy_workflow_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS';
END;
$role$;

CREATE SCHEMA IF NOT EXISTS privacy_retention;
ALTER SCHEMA privacy_retention OWNER TO privacy_workflow_owner;

-- Browser roles may use public objects, but must never create shadow objects
-- there. The verified NOLOGIN workflow owner retains the CREATE privilege needed
-- to own hardened public RPCs and private workflow objects.
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SCHEMA privacy_retention FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE, CREATE ON SCHEMA public TO privacy_workflow_owner;
GRANT USAGE, CREATE ON SCHEMA privacy_retention TO privacy_workflow_owner;
-- Hardened definers resolve these extension helpers explicitly. The workflow
-- owner receives only the exact dependency access needed for those calls.
DO $extension_dependency_access$
BEGIN
  IF pg_catalog.to_regprocedure('extensions.gen_random_uuid()') IS NULL
     OR pg_catalog.to_regprocedure('extensions.digest(text,text)') IS NULL THEN
    RAISE EXCEPTION 'G014 required extension helper identity is missing';
  END IF;
END;
$extension_dependency_access$;
GRANT USAGE ON SCHEMA extensions TO privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION extensions.gen_random_uuid(), extensions.digest(text, text)
  TO privacy_workflow_owner;

-- Default ACLs must be changed for every verified local object creator. Hosted
-- supabase_admin default ACLs remain an operator-only gate because the migration
-- runner is not necessarily permitted to alter that platform role.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA privacy_retention
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE privacy_workflow_owner IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE privacy_workflow_owner IN SCHEMA privacy_retention
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA privacy_retention
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA privacy_retention
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE privacy_workflow_owner IN SCHEMA privacy_retention
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE privacy_workflow_owner IN SCHEMA privacy_retention
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_workflow_owner_contract()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_role record;
BEGIN
  SELECT role_row.oid,
         role_row.rolsuper,
         role_row.rolinherit,
         role_row.rolcreaterole,
         role_row.rolcreatedb,
         role_row.rolreplication,
         role_row.rolbypassrls,
         role_row.rolcanlogin
  INTO v_role
  FROM pg_catalog.pg_roles AS role_row
  WHERE role_row.rolname = 'privacy_workflow_owner';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'privacy_workflow_owner is missing';
  END IF;
  IF v_role.rolsuper
     OR v_role.rolinherit
     OR v_role.rolcreaterole
     OR v_role.rolcreatedb
     OR v_role.rolreplication
     OR v_role.rolbypassrls
     OR v_role.rolcanlogin THEN
    RAISE EXCEPTION 'privacy_workflow_owner role attributes are incompatible';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    WHERE membership.member = v_role.oid
       OR membership.roleid = v_role.oid
  ) THEN
    RAISE EXCEPTION 'privacy_workflow_owner has unexpected role membership or effective access';
  END IF;
END;
$function$;
ALTER FUNCTION privacy_retention.assert_g014_workflow_owner_contract()
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.assert_g014_workflow_owner_contract()
  FROM PUBLIC, anon, authenticated, service_role;

-- SET SCHEMA retains relation OIDs, rows, indexes, FKs, and trigger bindings.
-- Partial placement is incompatible drift and must not be guessed around.
DO $move$
DECLARE
  v_public_count integer;
  v_private_count integer;
  v_name text;
BEGIN
  SELECT count(*) INTO v_public_count
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'public'
    AND relation.relkind = 'r'
    AND relation.relname IN (
      'privacy_policy_versions',
      'privacy_onboarding_challenges',
      'privacy_guardian_verifications',
      'privacy_age_profiles',
      'privacy_consent_events',
      'privacy_audit_events'
    );

  SELECT count(*) INTO v_private_count
  FROM pg_catalog.pg_class AS relation
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
  WHERE namespace.nspname = 'privacy_retention'
    AND relation.relkind = 'r'
    AND relation.relname IN (
      'privacy_policy_versions',
      'privacy_onboarding_challenges',
      'privacy_guardian_verifications',
      'privacy_age_profiles',
      'privacy_consent_events',
      'privacy_audit_events'
    );

  IF v_public_count = 6 AND v_private_count = 0 THEN
    FOREACH v_name IN ARRAY ARRAY[
      'privacy_policy_versions',
      'privacy_onboarding_challenges',
      'privacy_guardian_verifications',
      'privacy_age_profiles',
      'privacy_consent_events',
      'privacy_audit_events'
    ] LOOP
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA privacy_retention', v_name);
    END LOOP;
  ELSIF v_public_count = 0 AND v_private_count = 6 THEN
    NULL;
  ELSE
    RAISE EXCEPTION
      'G014 privacy relation placement is incompatible (public %, privacy_retention %)',
      v_public_count, v_private_count;
  END IF;
END;
$move$;

-- The public consent projection is the sole retained-table compatibility surface.
CREATE OR REPLACE VIEW public.privacy_consent_state
WITH (security_barrier = true)
AS
SELECT DISTINCT ON (event.user_id, event.subject_kind, event.purpose, event.channel)
  event.user_id,
  event.subject_kind,
  event.purpose,
  event.channel,
  event.decision,
  event.policy_version_id,
  event.guardian_verification_id,
  event.id AS consent_event_id,
  event.occurred_at
FROM privacy_retention.privacy_consent_events AS event
WHERE event.user_id = auth.uid()
ORDER BY event.user_id, event.subject_kind, event.purpose, event.channel, event.occurred_at DESC, event.id DESC;
ALTER VIEW public.privacy_consent_state OWNER TO privacy_workflow_owner;
REVOKE ALL ON TABLE public.privacy_consent_state FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.privacy_consent_state TO authenticated;

-- Private relations have a single NOLOGIN workflow principal. FORCE RLS remains
-- enabled even for the owner, so SECURITY DEFINER access is explicit and scoped.
DO $private_rls$
DECLARE
  v_relation record;
BEGIN
  FOR v_relation IN
    SELECT namespace.nspname AS schema_name, relation.relname AS relation_name
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'privacy_retention'
      AND relation.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I OWNER TO privacy_workflow_owner', v_relation.schema_name, v_relation.relation_name);
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', v_relation.schema_name, v_relation.relation_name);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', v_relation.schema_name, v_relation.relation_name);
    EXECUTE format('REVOKE ALL ON TABLE %I.%I FROM PUBLIC, anon, authenticated, service_role', v_relation.schema_name, v_relation.relation_name);
    EXECUTE format('GRANT ALL ON TABLE %I.%I TO privacy_workflow_owner', v_relation.schema_name, v_relation.relation_name);
    EXECUTE format('DROP POLICY IF EXISTS g014_privacy_workflow_owner_access ON %I.%I', v_relation.schema_name, v_relation.relation_name);
    EXECUTE format(
      'CREATE POLICY g014_privacy_workflow_owner_access ON %I.%I FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true)',
      v_relation.schema_name,
      v_relation.relation_name
    );
  END LOOP;
END;
$private_rls$;

-- G010 public workflow tables remain RPC implementation details. Data API roles
-- receive no direct mutation capability; only documented read surfaces remain.
DO $workflow_policy$
DECLARE
  v_name text;
  v_sequence regclass;
  v_workflow_relations constant text[] := ARRAY[
    'notifications',
    'marketing_campaign_operations',
    'marketing_campaign_recipients',
    'marketing_campaign_batches',
    'account_deletion_policies',
    'account_deletion_data_classes',
    'account_deletion_requests',
    'account_deletion_request_items',
    'privacy_incidents',
    'privacy_incident_transition_previews',
    'privacy_incident_notices',
    'privacy_incident_actions',
    'profiles',
    'user_roles',
    'user_account_status',
    'admin_audit_events'
  ];
BEGIN
  FOREACH v_name IN ARRAY v_workflow_relations LOOP
    IF pg_catalog.to_regclass('public.' || v_name) IS NULL THEN
      RAISE EXCEPTION 'required G010 workflow relation public.% is missing', v_name;
    END IF;
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated, service_role', v_name);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO privacy_workflow_owner', v_name);
    EXECUTE format('DROP POLICY IF EXISTS g014_privacy_workflow_owner_access ON public.%I', v_name);
    EXECUTE format(
      'CREATE POLICY g014_privacy_workflow_owner_access ON public.%I FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true)',
      v_name
    );
  END LOOP;

  FOR v_sequence IN
    SELECT sequence_relation.oid::regclass
    FROM pg_catalog.pg_class AS sequence_relation
    JOIN pg_catalog.pg_depend AS dependency
      ON dependency.objid = sequence_relation.oid
     AND dependency.classid = 'pg_class'::regclass
     AND dependency.deptype IN ('a', 'i')
    JOIN pg_catalog.pg_class AS table_relation ON table_relation.oid = dependency.refobjid
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = table_relation.relnamespace
    WHERE sequence_relation.relkind = 'S'
      AND namespace.nspname = 'public'
      AND table_relation.relname = ANY (v_workflow_relations)
  LOOP
    EXECUTE format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated, service_role', v_sequence);
    EXECUTE format('GRANT ALL ON SEQUENCE %s TO privacy_workflow_owner', v_sequence);
  END LOOP;

  GRANT SELECT ON TABLE public.notifications TO authenticated;
  GRANT SELECT ON TABLE
    public.privacy_incidents,
    public.privacy_incident_notices,
    public.privacy_incident_actions
  TO service_role;
END;
$workflow_policy$;
-- The active workflow class describes retained audit attribution accurately:
-- deletion removes identity records while audit rows remain separated.
DO $audit_class$
DECLARE
  v_active_policy_count integer;
  v_class_count integer;
  v_updated integer;
BEGIN
  SELECT count(*) INTO v_active_policy_count
  FROM public.account_deletion_policies AS policy
  WHERE policy.status = 'active';

  IF v_active_policy_count <> 1 THEN
    RAISE EXCEPTION 'G014 requires exactly one active account-deletion policy';
  END IF;

  SELECT count(*) INTO v_class_count
  FROM public.account_deletion_data_classes AS data_class
  JOIN public.account_deletion_policies AS policy
    ON policy.version = data_class.policy_version
  WHERE policy.status = 'active'
    AND data_class.code = 'privacy_audit_actor_references';

  IF v_class_count <> 1 THEN
    RAISE EXCEPTION 'G014 privacy audit account-deletion class shape is incompatible';
  END IF;

  UPDATE public.account_deletion_data_classes AS data_class
  SET disposition = 'separate'
  FROM public.account_deletion_policies AS policy
  WHERE policy.version = data_class.policy_version
    AND policy.status = 'active'
    AND data_class.code = 'privacy_audit_actor_references'
    AND data_class.disposition = 'anonymize';
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  IF v_updated > 1 OR NOT EXISTS (
    SELECT 1
    FROM public.account_deletion_data_classes AS data_class
    JOIN public.account_deletion_policies AS policy
      ON policy.version = data_class.policy_version
    WHERE policy.status = 'active'
      AND data_class.code = 'privacy_audit_actor_references'
      AND data_class.disposition = 'separate'
      AND data_class.mandatory
  ) THEN
    RAISE EXCEPTION 'G014 privacy audit account-deletion class did not become mandatory separate';
  END IF;
END;
$audit_class$;

-- G010 allowed an audit-actor minimization exception. Audit ledgers are now
-- unconditional append-only records. Account deletion must append a later
-- retention-separation event; it may not mutate a historical audit row.
CREATE OR REPLACE FUNCTION privacy_retention.g014_reject_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'append_only_audit_ledger' USING ERRCODE = '55000';
END;
$function$;
ALTER FUNCTION privacy_retention.g014_reject_audit_mutation() OWNER TO privacy_workflow_owner;

DROP TRIGGER IF EXISTS privacy_audit_events_append_only ON privacy_retention.privacy_audit_events;
DROP TRIGGER IF EXISTS g014_privacy_audit_events_append_only ON privacy_retention.privacy_audit_events;
CREATE TRIGGER g014_privacy_audit_events_append_only
BEFORE UPDATE OR DELETE ON privacy_retention.privacy_audit_events
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_reject_audit_mutation();
-- Retained audit attribution is deliberately detached from active Auth identity.
-- The UUID remains historical, private, and append-only; it must not make Auth
-- deletion cascade, update retained records, or block the final Auth operation.
DO $audit_actor_fk$
DECLARE
  v_constraint_name name;
  v_actor_attnum smallint;
  v_auth_id_attnum smallint;
  v_auth_fk_count integer;
BEGIN
  SELECT attribute.attnum
  INTO v_actor_attnum
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = 'privacy_retention.privacy_audit_events'::regclass
    AND attribute.attname = 'actor_user_id'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  SELECT attribute.attnum
  INTO v_auth_id_attnum
  FROM pg_catalog.pg_attribute AS attribute
  WHERE attribute.attrelid = 'auth.users'::regclass
    AND attribute.attname = 'id'
    AND attribute.attnum > 0
    AND NOT attribute.attisdropped;

  IF v_actor_attnum IS NULL OR v_auth_id_attnum IS NULL THEN
    RAISE EXCEPTION 'G014 privacy audit/Auth foreign-key columns are incompatible';
  END IF;

  SELECT count(*)
  INTO v_auth_fk_count
  FROM pg_catalog.pg_constraint AS constraint_row
  WHERE constraint_row.conrelid = 'privacy_retention.privacy_audit_events'::regclass
    AND constraint_row.contype = 'f'
    AND constraint_row.confrelid = 'auth.users'::regclass;

  IF v_auth_fk_count = 0 THEN
    NULL;
  ELSIF v_auth_fk_count <> 1 THEN
    RAISE EXCEPTION 'G014 privacy audit/Auth foreign-key shape is incompatible';
  ELSE
    SELECT constraint_row.conname
    INTO v_constraint_name
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'privacy_retention.privacy_audit_events'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'auth.users'::regclass
      AND constraint_row.conkey = ARRAY[v_actor_attnum]
      AND constraint_row.confkey = ARRAY[v_auth_id_attnum]
      AND constraint_row.confupdtype = 'a'
      AND constraint_row.confdeltype = 'r'
      AND constraint_row.confmatchtype = 's'
      AND NOT constraint_row.condeferrable
      AND NOT constraint_row.condeferred;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'G014 privacy audit/Auth foreign-key shape is incompatible';
    END IF;

    EXECUTE format(
      'ALTER TABLE privacy_retention.privacy_audit_events DROP CONSTRAINT %I',
      v_constraint_name
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'privacy_retention.privacy_audit_events'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'auth.users'::regclass
  ) THEN
    RAISE EXCEPTION 'G014 retained audit remains coupled to auth.users';
  END IF;
END;
$audit_actor_fk$;


DROP TRIGGER IF EXISTS g014_admin_audit_events_append_only ON public.admin_audit_events;
CREATE TRIGGER g014_admin_audit_events_append_only
BEFORE UPDATE OR DELETE ON public.admin_audit_events
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_reject_audit_mutation();
REVOKE ALL ON TABLE public.admin_audit_events FROM service_role;

-- A checked-in source signature is required before it can become an API
-- identity. The persisted canonical identity is the exact ordered input-type OID
-- vector, derived only after the source signature resolves. This avoids
-- search-path-dependent type rendering while preserving overload identity.
DO $allowlist_shape$
BEGIN
  IF to_regclass('privacy_retention.g014_public_rpc_allowlist') IS NULL THEN
    EXECUTE $ddl$
      CREATE TABLE privacy_retention.g014_public_rpc_allowlist (
        function_schema name NOT NULL,
        function_name name NOT NULL,
        identity_arguments text NOT NULL,
        grantee name NOT NULL CHECK (grantee IN ('anon', 'authenticated', 'service_role')),
        source_signature text NOT NULL,
        PRIMARY KEY (function_schema, function_name, identity_arguments, grantee),
        UNIQUE (source_signature, grantee)
      )
    $ddl$;
  ELSIF (
    SELECT count(*)
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'privacy_retention.g014_public_rpc_allowlist'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) <> 5
  OR EXISTS (
    (SELECT *
     FROM (VALUES
       ('function_schema'::text, 'name'::regtype, true),
       ('function_name'::text, 'name'::regtype, true),
       ('identity_arguments'::text, 'text'::regtype, true),
       ('grantee'::text, 'name'::regtype, true),
       ('source_signature'::text, 'text'::regtype, true)
     ) AS expected(attname, atttype, attnotnull)
     EXCEPT
     SELECT attribute.attname::text, attribute.atttypid::regtype, attribute.attnotnull
     FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = 'privacy_retention.g014_public_rpc_allowlist'::regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped)
    UNION ALL
    (SELECT attribute.attname::text, attribute.atttypid::regtype, attribute.attnotnull
     FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = 'privacy_retention.g014_public_rpc_allowlist'::regclass
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
     EXCEPT
     SELECT *
     FROM (VALUES
       ('function_schema'::text, 'name'::regtype, true),
       ('function_name'::text, 'name'::regtype, true),
       ('identity_arguments'::text, 'text'::regtype, true),
       ('grantee'::text, 'name'::regtype, true),
       ('source_signature'::text, 'text'::regtype, true)
     ) AS expected(attname, atttype, attnotnull))
  )
  OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'privacy_retention.g014_public_rpc_allowlist'::regclass
      AND constraint_row.contype = 'p'
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid)
        = 'PRIMARY KEY (function_schema, function_name, identity_arguments, grantee)'
  )
  OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'privacy_retention.g014_public_rpc_allowlist'::regclass
      AND constraint_row.contype = 'u'
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid)
        = 'UNIQUE (source_signature, grantee)'
  ) THEN
    RAISE EXCEPTION 'g014_public_rpc_allowlist has an incompatible shape';
  END IF;
END;
$allowlist_shape$;
ALTER TABLE privacy_retention.g014_public_rpc_allowlist OWNER TO privacy_workflow_owner;
ALTER TABLE privacy_retention.g014_public_rpc_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_retention.g014_public_rpc_allowlist FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE privacy_retention.g014_public_rpc_allowlist FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE privacy_retention.g014_public_rpc_allowlist TO privacy_workflow_owner;
DROP POLICY IF EXISTS g014_privacy_workflow_owner_access ON privacy_retention.g014_public_rpc_allowlist;
CREATE POLICY g014_privacy_workflow_owner_access
  ON privacy_retention.g014_public_rpc_allowlist
  FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true);

DO $allowlist_seed$
DECLARE
  v_missing text;
BEGIN
  CREATE TEMPORARY TABLE pg_temp.g014_expected_rpc_allowlist (
    source_signature text NOT NULL,
    grantee name NOT NULL,
    PRIMARY KEY (source_signature, grantee)
  ) ON COMMIT DROP;
  INSERT INTO pg_temp.g014_expected_rpc_allowlist (source_signature, grantee)
  VALUES
      ('public.approve_submission_item(uuid,uuid,jsonb)', 'authenticated'::name),
      ('public.approve_submission_item(uuid,uuid,jsonb)', 'service_role'::name),
      ('public.approve_edit_submission_item(uuid,uuid,jsonb)', 'authenticated'::name),
      ('public.approve_edit_submission_item(uuid,uuid,jsonb)', 'service_role'::name),
      ('public.merge_restaurant_records_for_admin_review(uuid,uuid,uuid,timestamptz,text,jsonb,text,text)', 'authenticated'::name),
      ('public.merge_restaurant_records_for_admin_review(uuid,uuid,uuid,timestamptz,text,jsonb,text,text)', 'service_role'::name),
      ('public.make_user_admin(text)', 'service_role'::name),
      ('public.batch_insert_restaurants_from_jsonl(jsonb[])', 'service_role'::name),
      ('public.insert_restaurant_from_jsonl(jsonb)', 'service_role'::name),
      ('public.refresh_materialized_views()', 'service_role'::name),
      ('public.cleanup_old_notifications(integer)', 'service_role'::name),
      ('public.approve_restaurant(uuid,uuid)', 'service_role'::name),
      ('public.reject_restaurant(uuid,uuid,text)', 'service_role'::name),
      ('public.approve_restaurant_submission(uuid,uuid)', 'service_role'::name),
      ('public.reject_restaurant_submission(uuid,uuid,text)', 'service_role'::name),
      ('public.approve_new_restaurant_submission(uuid,uuid,jsonb)', 'service_role'::name),
      ('public.approve_edit_restaurant_submission(uuid,uuid,uuid[])', 'service_role'::name),
      ('public.reject_submission(uuid,uuid,text)', 'service_role'::name),
      ('public.reject_submission_item(uuid,uuid,text)', 'service_role'::name),
      ('public.apply_admin_user_db_mutation(uuid,uuid,text,text,jsonb,jsonb,uuid,jsonb,text,text,text,text,text)', 'service_role'::name),
      ('public.match_storyboard_documents_hybrid(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)', 'authenticated'::name),
      ('public.match_storyboard_documents_hybrid(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)', 'service_role'::name),
      ('public.match_storyboard_documents_hybrid_v2(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)', 'authenticated'::name),
      ('public.match_storyboard_documents_hybrid_v2(uuid,extensions.vector,jsonb,double precision,integer,integer,jsonb)', 'service_role'::name),
      ('public.review_restaurant_request(uuid,uuid,text,text,text)', 'service_role'::name),
      ('public.delete_pending_restaurant_submission(uuid,uuid,text)', 'service_role'::name),
      ('public.submit_restaurant_submission(uuid,text,text,text,text,text,text[],text,text)', 'service_role'::name),
      ('public.apply_restaurant_admin_destructive_action(uuid,text,text,uuid[],uuid,jsonb)', 'service_role'::name),
      ('public.apply_admin_restaurant_map_overlay_action(uuid,text,uuid,text,text,text,timestamptz,timestamptz,jsonb,text,text,text,uuid,text,jsonb)', 'service_role'::name),
      ('public.claim_admin_trend_job_request(text,interval)', 'service_role'::name),
      ('public.complete_admin_trend_job_request(uuid,text,uuid,jsonb)', 'service_role'::name),
      ('public.fail_admin_trend_job_request(uuid,text,text,jsonb)', 'service_role'::name),
      ('public.review_admin_restaurant_map_overlay_proposal(uuid,uuid,text,text,text,uuid,text,text,jsonb)', 'service_role'::name),
      ('public.approve_admin_restaurant_map_overlay_proposal(uuid,uuid,text,text,text,text,jsonb,text,text,uuid,text,jsonb)', 'service_role'::name),
      ('public.preflight_release_auth_session_family(uuid,uuid,uuid,text,bigint)', 'service_role'::name),
      ('public.revoke_release_auth_session_family(uuid,uuid,uuid,text)', 'service_role'::name),
      ('public.read_release_auth_revocation(uuid,uuid,uuid)', 'service_role'::name),
      ('public.read_release_auth_revocation_by_operation(uuid)', 'anon'::name),
      ('public.read_release_auth_revocation_by_operation(uuid)', 'authenticated'::name),
      ('public.get_current_auth_session_id()', 'authenticated'::name),
      ('public.is_current_auth_session_active()', 'authenticated'::name),
      ('public.get_current_privacy_policy_version()', 'authenticated'::name),
      ('public.get_current_privacy_policy_version()', 'service_role'::name),
      ('public.create_privacy_onboarding_challenge(text,uuid,text,jsonb,text,timestamptz)', 'service_role'::name),
      ('public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)', 'service_role'::name),
      ('public.submit_privacy_consent(text,text,text,uuid,text,text,uuid,text,uuid)', 'authenticated'::name),
      ('public.record_privacy_guardian_verification(uuid,uuid,text,text,text,timestamptz,timestamptz)', 'service_role'::name),
      ('public.read_privacy_guardian_status(uuid)', 'service_role'::name),
      ('public.create_user_notification(uuid,text,text,text,jsonb)', 'authenticated'::name),
      ('public.mark_notification_read(uuid)', 'authenticated'::name),
      ('public.mark_all_notifications_read()', 'authenticated'::name),
      ('public.delete_notification(uuid)', 'authenticated'::name),
      ('public.evaluate_notification_marketing_permission(uuid,text,timestamptz,text)', 'service_role'::name),
      ('public.marketing_campaign_receipt(uuid)', 'service_role'::name),
      ('public.preview_marketing_campaign(uuid,text,uuid[],text,text,jsonb,text,timestamptz)', 'service_role'::name),
      ('public.prepare_marketing_campaign_batch(uuid,uuid,text,text,integer,text)', 'service_role'::name),
      ('public.fail_marketing_campaign_batch(uuid,uuid,uuid,text,text)', 'service_role'::name),
      ('public.finalize_marketing_campaign_batch(uuid,uuid,uuid,text,uuid[])', 'service_role'::name),
      ('public.preview_account_deletion(uuid,uuid,timestamptz)', 'service_role'::name),
      ('public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz)', 'service_role'::name),
      ('public.apply_account_deletion_database_cleanup(uuid,uuid)', 'service_role'::name),
      ('public.list_account_deletion_storage_objects(uuid,uuid)', 'service_role'::name),
      ('public.finalize_account_deletion_storage(uuid,uuid,boolean)', 'service_role'::name),
      ('public.finalize_account_deletion_auth(uuid,uuid,boolean)', 'service_role'::name),
      ('public.fail_account_deletion(uuid,uuid,text)', 'service_role'::name),
      ('public.preview_privacy_retention_run(text,timestamptz,integer,integer)', 'service_role'::name),
      ('public.confirm_privacy_retention_run(uuid,text,text,text)', 'service_role'::name),
      ('public.apply_privacy_retention_run(uuid,text,text,integer)', 'service_role'::name),
      ('public.claim_privacy_retention_storage_items(uuid,text,text,integer)', 'service_role'::name),
      ('public.ack_privacy_retention_storage_items(uuid,text,text,uuid[],boolean)', 'service_role'::name),
      ('public.finalize_privacy_retention_run(uuid,text,text)', 'service_role'::name),
      ('public.preview_privacy_incident_transition(uuid,uuid,public.privacy_incident_status,timestamptz,text,jsonb,uuid)', 'service_role'::name),
      ('public.apply_privacy_incident_transition(uuid,uuid,uuid,public.privacy_incident_status,timestamptz,text,text,text,jsonb,uuid,text)', 'service_role'::name),
      ('public.record_privacy_incident_detection(uuid,uuid,text,timestamptz,text,uuid)', 'service_role'::name),
      ('public.ocr_log_metadata_is_safe(jsonb)', 'service_role'::name),
      ('public.allocate_short_url(text,uuid,uuid,text,text[])', 'service_role'::name),
      ('public.get_ocr_daily_quota_status()', 'authenticated'::name),
      ('public.reserve_ocr_daily_quota(uuid)', 'authenticated'::name),
      ('public.reserve_admin_provider_budget(uuid,text,uuid)', 'service_role'::name),
      ('public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamptz,timestamptz)', 'service_role'::name);
  SELECT source_signature INTO v_missing
  FROM pg_temp.g014_expected_rpc_allowlist
  WHERE to_regprocedure(source_signature) IS NULL
  ORDER BY source_signature
  LIMIT 1;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'G014 required public RPC identity is missing: %', v_missing;
  END IF;

  INSERT INTO privacy_retention.g014_public_rpc_allowlist (
    function_schema,
    function_name,
    identity_arguments,
    grantee,
    source_signature
  )
  SELECT namespace.nspname,
         procedure.proname,
         procedure.proargtypes::text,
         expected.grantee,
         expected.source_signature
  FROM pg_temp.g014_expected_rpc_allowlist AS expected
  JOIN LATERAL pg_catalog.to_regprocedure(expected.source_signature) AS resolved(procedure_oid) ON true
  JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = resolved.procedure_oid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  ON CONFLICT (source_signature, grantee) DO UPDATE
  SET function_schema = EXCLUDED.function_schema,
      function_name = EXCLUDED.function_name,
      identity_arguments = EXCLUDED.identity_arguments;

  IF EXISTS (
    (SELECT function_schema, function_name, identity_arguments, grantee, source_signature
     FROM privacy_retention.g014_public_rpc_allowlist)
    EXCEPT
    (SELECT namespace.nspname,
            procedure.proname,
            procedure.proargtypes::text,
            expected.grantee,
            expected.source_signature
     FROM pg_temp.g014_expected_rpc_allowlist AS expected
     JOIN LATERAL pg_catalog.to_regprocedure(expected.source_signature) AS resolved(procedure_oid) ON true
     JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = resolved.procedure_oid
     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace)
  ) OR EXISTS (
    (SELECT namespace.nspname,
            procedure.proname,
            procedure.proargtypes::text,
            expected.grantee,
            expected.source_signature
     FROM pg_temp.g014_expected_rpc_allowlist AS expected
     JOIN LATERAL pg_catalog.to_regprocedure(expected.source_signature) AS resolved(procedure_oid) ON true
     JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = resolved.procedure_oid
     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace)
    EXCEPT
    (SELECT function_schema, function_name, identity_arguments, grantee, source_signature
     FROM privacy_retention.g014_public_rpc_allowlist)
  ) THEN
    RAISE EXCEPTION 'G014 public RPC allowlist has incompatible persisted rows';
  END IF;
  DROP TABLE pg_temp.g014_expected_rpc_allowlist;
END;
$allowlist_seed$;

-- Rewrite only noncanonical G010 definitions that still name a moved relation.
-- A canonical definition is never regenerated: repeated application must retain
-- the exact qualification bytes and must not double-qualify extension calls.
DO $rewrite_g010$
DECLARE
  v_signature text;
  v_oid oid;
  v_definition text;
  v_doubled_extensions_qualification text := 'extensions.' || 'extensions.';
  v_doubled_pg_catalog_qualification text := 'pg_catalog.' || 'pg_catalog.';
  v_doubled_public_qualification text := 'public.' || 'public.';
  v_unqualified_gen_random_uuid text := 'gen_random_' || 'uuid()';
  v_extensions_gen_random_uuid text := 'extensions.' || 'gen_random_' || 'uuid()';
  v_unqualified_encode_digest text := ' encode(' || 'digest(';
  v_unqualified_digest text := ' dig' || 'est(';
  v_cross_schema_owner_functions constant text[] := ARRAY[
    'public.account_deletion_require_service_role()',
    'public.account_deletion_is_active_admin(uuid)',
    'public.account_deletion_write_audit(public.account_deletion_requests,text,text)',
    'public.preview_account_deletion(uuid,uuid,timestamptz)',
    'public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz)',
    'public.apply_account_deletion_database_cleanup(uuid,uuid)',
    'public.list_account_deletion_storage_objects(uuid,uuid)',
    'public.finalize_account_deletion_storage(uuid,uuid,boolean)',
    'public.finalize_account_deletion_auth(uuid,uuid,boolean)',
    'public.fail_account_deletion(uuid,uuid,text)',
    'privacy_retention.require_service_role()',
    'privacy_retention.write_run_audit(privacy_retention.privacy_retention_runs,text,text)'
  ];
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.privacy_resolve_audit_retention_until(text,timestamptz)',
    'public.privacy_under_14_is_eligible(uuid,uuid)',
    'public.privacy_validate_age_profile()',
    'public.privacy_validate_consent_event()',
    'public.privacy_refresh_age_profile(uuid)',
    'public.privacy_refresh_age_profile_after_consent()',
    'public.privacy_refresh_age_profile_after_guardian()',
    'public.privacy_append_audit_event(text,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb)',
    'public.get_current_privacy_policy_version()',
    'public.create_privacy_onboarding_challenge(text,uuid,text,jsonb,text,timestamptz)',
    'public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)',
    'public.submit_privacy_consent(text,text,text,uuid,text,text,uuid,text,uuid)',
    'public.record_privacy_guardian_verification(uuid,uuid,text,text,text,timestamptz,timestamptz)',
    'public.read_privacy_guardian_status(uuid)',
    'public.create_user_notification(uuid,text,text,text,jsonb)',
    'public.mark_notification_read(uuid)',
    'public.mark_all_notifications_read()',
    'public.delete_notification(uuid)',
    'public.assert_marketing_service_role()',
    'public.evaluate_notification_marketing_permission(uuid,text,timestamptz,text)',
    'public.record_marketing_campaign_audit(uuid,uuid,text,text,text,text,integer,integer,integer,integer)',
    'public.marketing_campaign_receipt(uuid)',
    'public.preview_marketing_campaign(uuid,text,uuid[],text,text,jsonb,text,timestamptz)',
    'public.prepare_marketing_campaign_batch(uuid,uuid,text,text,integer,text)',
    'public.fail_marketing_campaign_batch(uuid,uuid,uuid,text,text)',
    'public.finalize_marketing_campaign_batch(uuid,uuid,uuid,text,uuid[])',
    'privacy_retention.require_service_role()',
    'privacy_retention.active_hold_exists(text,text,timestamptz)',
    'privacy_retention.write_run_audit(privacy_retention.privacy_retention_runs,text,text)',
    'public.preview_privacy_retention_run(text,timestamptz,integer,integer)',
    'public.confirm_privacy_retention_run(uuid,text,text,text)',
    'public.apply_privacy_retention_run(uuid,text,text,integer)',
    'public.claim_privacy_retention_storage_items(uuid,text,text,integer)',
    'public.ack_privacy_retention_storage_items(uuid,text,text,uuid[],boolean)',
    'public.finalize_privacy_retention_run(uuid,text,text)',
    'public.account_deletion_require_service_role()',
    'public.account_deletion_is_active_admin(uuid)',
    'public.account_deletion_write_audit(public.account_deletion_requests,text,text)',
    'public.preview_account_deletion(uuid,uuid,timestamptz)',
    'public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz)',
    'public.apply_account_deletion_database_cleanup(uuid,uuid)',
    'public.list_account_deletion_storage_objects(uuid,uuid)',
    'public.finalize_account_deletion_storage(uuid,uuid,boolean)',
    'public.finalize_account_deletion_auth(uuid,uuid,boolean)',
    'public.fail_account_deletion(uuid,uuid,text)',
    'public.privacy_incident_require_admin(uuid)',
    'public.privacy_incident_audit_retention_until(timestamptz)',
    'public.preview_privacy_incident_transition(uuid,uuid,public.privacy_incident_status,timestamptz,text,jsonb,uuid)',
    'public.apply_privacy_incident_transition(uuid,uuid,uuid,public.privacy_incident_status,timestamptz,text,text,text,jsonb,uuid,text)',
    'public.record_privacy_incident_detection(uuid,uuid,text,timestamptz,text,uuid)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'G014 required SECURITY DEFINER identity is missing: %', v_signature;
    END IF;
    IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc WHERE oid = v_oid) THEN
      RAISE EXCEPTION 'G014 expected SECURITY DEFINER identity is not a definer: %', v_signature;
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    IF position(v_doubled_extensions_qualification IN v_definition) <> 0
       OR position(v_doubled_pg_catalog_qualification IN v_definition) <> 0
       OR position(v_doubled_public_qualification IN v_definition) <> 0 THEN
      RAISE EXCEPTION 'G014 found a doubly-qualified function definition: %', v_signature;
    END IF;

    IF position('public.privacy_policy_versions' IN v_definition) <> 0
       OR position('public.privacy_onboarding_challenges' IN v_definition) <> 0
       OR position('public.privacy_guardian_verifications' IN v_definition) <> 0
       OR position('public.privacy_age_profiles' IN v_definition) <> 0
       OR position('public.privacy_consent_events' IN v_definition) <> 0
       OR position('public.privacy_audit_events' IN v_definition) <> 0
       OR (
         position(v_unqualified_gen_random_uuid IN v_definition) <> 0
         AND position(v_extensions_gen_random_uuid IN v_definition) = 0
       )
       OR position(v_unqualified_encode_digest IN v_definition) <> 0
       OR position(v_unqualified_digest IN v_definition) <> 0 THEN
      v_definition := pg_catalog.replace(v_definition, 'public.privacy_policy_versions', 'privacy_retention.privacy_policy_versions');
      v_definition := pg_catalog.replace(v_definition, 'public.privacy_onboarding_challenges', 'privacy_retention.privacy_onboarding_challenges');
      v_definition := pg_catalog.replace(v_definition, 'public.privacy_guardian_verifications', 'privacy_retention.privacy_guardian_verifications');
      v_definition := pg_catalog.replace(v_definition, 'public.privacy_age_profiles', 'privacy_retention.privacy_age_profiles');
      v_definition := pg_catalog.replace(v_definition, 'public.privacy_consent_events', 'privacy_retention.privacy_consent_events');
      v_definition := pg_catalog.replace(v_definition, 'public.privacy_audit_events', 'privacy_retention.privacy_audit_events');
      v_definition := pg_catalog.replace(v_definition, 'extensions.gen_random_uuid()', 'g014_extensions_gen_random_uuid_placeholder()');
      v_definition := pg_catalog.replace(v_definition, 'gen_random_uuid()', 'extensions.gen_random_uuid()');
      v_definition := pg_catalog.replace(v_definition, 'g014_extensions_gen_random_uuid_placeholder()', 'extensions.gen_random_uuid()');
      v_definition := pg_catalog.replace(v_definition, ' digest(', ' extensions.digest(');
      v_definition := pg_catalog.replace(v_definition, ' encode(digest(', ' pg_catalog.encode(extensions.digest(');
      IF v_signature = 'public.preview_account_deletion(uuid,uuid,timestamptz)' THEN
        IF position(
          'v_profile_count + v_privacy_audit_actor_reference_count,' IN v_definition
        ) = 0 THEN
          RAISE EXCEPTION 'G014 account-deletion preview summary shape is incompatible';
        END IF;
        v_definition := pg_catalog.regexp_replace(
          v_definition,
          'v_profile_count [+] v_privacy_audit_actor_reference_count,[[:space:]]+0,[[:space:]]+0;',
          '(
      SELECT COALESCE(
        SUM(request_item.planned_count) FILTER (WHERE request_item.disposition = ''anonymize''),
        0
      )::integer
      FROM public.account_deletion_request_items AS request_item
      WHERE request_item.request_id = v_request.id
    ),
    (
      SELECT COALESCE(
        SUM(request_item.planned_count) FILTER (WHERE request_item.disposition = ''separate''),
        0
      )::integer
      FROM public.account_deletion_request_items AS request_item
      WHERE request_item.request_id = v_request.id
    ),
    (
      SELECT COALESCE(
        SUM(request_item.planned_count) FILTER (WHERE request_item.disposition = ''retain''),
        0
      )::integer
      FROM public.account_deletion_request_items AS request_item
      WHERE request_item.request_id = v_request.id
    );'
        );
        IF position(
          'v_profile_count + v_privacy_audit_actor_reference_count,' IN v_definition
        ) <> 0 THEN
          RAISE EXCEPTION 'G014 account-deletion preview summary rewrite is not canonical';
        END IF;
      END IF;

      IF position('public.privacy_policy_versions' IN v_definition) <> 0
         OR position('public.privacy_onboarding_challenges' IN v_definition) <> 0
         OR position('public.privacy_guardian_verifications' IN v_definition) <> 0
         OR position('public.privacy_age_profiles' IN v_definition) <> 0
         OR position('public.privacy_consent_events' IN v_definition) <> 0
         OR position('public.privacy_audit_events' IN v_definition) <> 0
         OR (
           position(v_unqualified_gen_random_uuid IN v_definition) <> 0
           AND position(v_extensions_gen_random_uuid IN v_definition) = 0
         )
         OR position(v_unqualified_encode_digest IN v_definition) <> 0
         OR position(v_unqualified_digest IN v_definition) <> 0
         OR position(v_doubled_extensions_qualification IN v_definition) <> 0
         OR position(v_doubled_pg_catalog_qualification IN v_definition) <> 0
         OR position(v_doubled_public_qualification IN v_definition) <> 0 THEN
        RAISE EXCEPTION 'G014 function definition rewrite is not canonical: %', v_signature;
      END IF;

      EXECUTE v_definition;
    END IF;
    EXECUTE format('ALTER FUNCTION %s SET search_path = ''''', v_oid::regprocedure);
    IF v_signature = ANY (v_cross_schema_owner_functions) THEN
      IF pg_catalog.pg_get_userbyid(
        (SELECT procedure.proowner FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_oid)
      ) <> 'postgres' THEN
        RAISE EXCEPTION 'G014 cross-schema function owner is not the trusted existing owner: %', v_signature;
      END IF;
    ELSE
      EXECUTE format('ALTER FUNCTION %s OWNER TO privacy_workflow_owner', v_oid::regprocedure);
    END IF;
  END LOOP;
END;
$rewrite_g010$;
-- Retained audit rows are separated, not anonymized. This replacement retains
-- the G010 cleanup order and product readbacks while making the audit branch
-- independently prove that its historical bytes and count did not change.
CREATE OR REPLACE FUNCTION public.apply_account_deletion_database_cleanup(
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS TABLE (
  request_id uuid,
  status text,
  reason_code text,
  db_readback_passed boolean,
  session_readback_passed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_item public.account_deletion_request_items%ROWTYPE;
  v_db_failed boolean := false;
  v_session_failed boolean := false;
  v_remaining integer := 0;
  v_sessions_remaining integer := 0;
  v_privacy_identity_remaining integer := 0;
  v_privacy_audit_actor_references_before bigint := 0;
  v_privacy_audit_actor_references_after bigint := 0;
  v_privacy_audit_hash_before text;
  v_privacy_audit_hash_after text;
BEGIN
  PERFORM public.account_deletion_require_service_role();
  SELECT * INTO v_request
  FROM public.account_deletion_requests AS request
  WHERE request.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.actor_user_id <> p_actor_user_id THEN
    RETURN QUERY SELECT p_request_id, 'failed'::text, 'PREVIEW_NOT_FOUND'::text, false, false;
    RETURN;
  END IF;

  IF v_request.status = 'applied' THEN
    RETURN QUERY SELECT v_request.id, v_request.status, v_request.reason_code, v_request.db_readback_passed, v_request.session_readback_passed;
    RETURN;
  END IF;

  IF v_request.status NOT IN ('applying', 'partial') THEN
    RETURN QUERY SELECT v_request.id, 'failed'::text, 'APPLY_NOT_STARTED'::text, false, false;
    RETURN;
  END IF;

  BEGIN
    IF pg_catalog.to_regclass('public.marketing_campaign_recipients') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.marketing_campaign_recipients WHERE user_id = $1' USING v_request.target_user_id;
      EXECUTE 'SELECT count(*) FROM public.marketing_campaign_recipients WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
      IF v_remaining <> 0 THEN
        RAISE EXCEPTION 'marketing_campaign_recipients_readback_failed';
      END IF;
    END IF;

    UPDATE public.account_deletion_request_items AS request_item
    SET status = 'applied',
        reason_code = 'DB_READBACK_PASSED'
    WHERE request_item.request_id = v_request.id
      AND request_item.data_class_code = 'marketing_campaign_recipients';
  EXCEPTION WHEN OTHERS THEN
    v_db_failed := true;
    UPDATE public.account_deletion_request_items AS request_item
    SET status = 'failed',
        reason_code = 'DB_CLEANUP_FAILED'
    WHERE request_item.request_id = v_request.id
      AND request_item.data_class_code = 'marketing_campaign_recipients';
  END;

  BEGIN
    SELECT
      count(*),
      pg_catalog.encode(
        extensions.digest(
          COALESCE(
            pg_catalog.jsonb_agg(pg_catalog.to_jsonb(audit) ORDER BY audit.id),
            '[]'::jsonb
          )::text,
          'sha256'
        ),
        'hex'
      )
    INTO v_privacy_audit_actor_references_before, v_privacy_audit_hash_before
    FROM privacy_retention.privacy_audit_events AS audit
    WHERE audit.actor_user_id = v_request.target_user_id;
    DELETE FROM public.notifications AS notification
    USING privacy_retention.privacy_consent_events AS consent
    WHERE notification.consent_event_id = consent.id
      AND consent.user_id = v_request.target_user_id;
    SELECT count(*) INTO v_remaining
    FROM public.notifications AS notification
    JOIN privacy_retention.privacy_consent_events AS consent
      ON consent.id = notification.consent_event_id
    WHERE consent.user_id = v_request.target_user_id;
    IF v_remaining <> 0 THEN
      RAISE EXCEPTION 'consent_dependent_notifications_readback_failed';
    END IF;


    DELETE FROM privacy_retention.privacy_consent_events
    WHERE user_id = v_request.target_user_id;
    DELETE FROM privacy_retention.privacy_age_profiles
    WHERE user_id = v_request.target_user_id;
    DELETE FROM privacy_retention.privacy_guardian_verifications
    WHERE child_user_id = v_request.target_user_id;
    DELETE FROM privacy_retention.privacy_onboarding_challenges
    WHERE consumed_by_user_id = v_request.target_user_id;

    SELECT count(*) INTO v_privacy_identity_remaining
    FROM (
      SELECT consent.id
      FROM privacy_retention.privacy_consent_events AS consent
      WHERE consent.user_id = v_request.target_user_id
      UNION ALL
      SELECT age_profile.user_id
      FROM privacy_retention.privacy_age_profiles AS age_profile
      WHERE age_profile.user_id = v_request.target_user_id
      UNION ALL
      SELECT guardian.id
      FROM privacy_retention.privacy_guardian_verifications AS guardian
      WHERE guardian.child_user_id = v_request.target_user_id
      UNION ALL
      SELECT challenge.id
      FROM privacy_retention.privacy_onboarding_challenges AS challenge
      WHERE challenge.consumed_by_user_id = v_request.target_user_id
    ) AS remaining_privacy_identity;

    SELECT
      count(*),
      pg_catalog.encode(
        extensions.digest(
          COALESCE(
            pg_catalog.jsonb_agg(pg_catalog.to_jsonb(audit) ORDER BY audit.id),
            '[]'::jsonb
          )::text,
          'sha256'
        ),
        'hex'
      )
    INTO v_privacy_audit_actor_references_after, v_privacy_audit_hash_after
    FROM privacy_retention.privacy_audit_events AS audit
    WHERE audit.actor_user_id = v_request.target_user_id;

    IF v_privacy_identity_remaining <> 0
       OR v_privacy_audit_actor_references_after
          IS DISTINCT FROM v_privacy_audit_actor_references_before
       OR v_privacy_audit_hash_after IS DISTINCT FROM v_privacy_audit_hash_before THEN
      RAISE EXCEPTION 'privacy_identity_or_retained_audit_readback_failed';
    END IF;

    UPDATE public.account_deletion_request_items AS request_item
    SET status = 'applied',
        reason_code = 'DB_READBACK_PASSED'
    WHERE request_item.request_id = v_request.id
      AND request_item.data_class_code = 'privacy_identity_records';

    UPDATE public.account_deletion_request_items AS request_item
    SET status = 'separated',
        reason_code = 'DB_READBACK_PASSED'
    WHERE request_item.request_id = v_request.id
      AND request_item.data_class_code = 'privacy_audit_actor_references';
  EXCEPTION WHEN OTHERS THEN
    v_db_failed := true;
    UPDATE public.account_deletion_request_items AS request_item
    SET status = 'failed',
        reason_code = 'DB_CLEANUP_FAILED'
    WHERE request_item.request_id = v_request.id
      AND request_item.data_class_code IN (
        'privacy_identity_records',
        'privacy_audit_actor_references'
      );
  END;

  FOR v_item IN
    SELECT *
    FROM public.account_deletion_request_items AS request_item
    WHERE request_item.request_id = v_request.id
      AND request_item.data_class_code NOT IN (
        'storage_objects',
        'auth_identity',
        'approved_audit_records',
        'retention_work_items',
        'marketing_campaign_recipients',
        'privacy_identity_records',
        'privacy_audit_actor_references'
      )
    ORDER BY CASE request_item.data_class_code
      WHEN 'review_likes' THEN 10
      WHEN 'reviews' THEN 20
      WHEN 'restaurant_submissions' THEN 30
      WHEN 'restaurant_requests' THEN 40
      WHEN 'ocr_logs' THEN 50
      ELSE 100
    END, request_item.data_class_code
  FOR UPDATE
  LOOP
    BEGIN
      IF v_item.data_class_code = 'profile_identity' THEN
        IF pg_catalog.to_regclass('public.profiles') IS NOT NULL THEN
          EXECUTE 'UPDATE public.profiles SET nickname = ''탈퇴한 사용자'', username = NULL, avatar_url = NULL WHERE user_id = $1' USING v_request.target_user_id;
          EXECUTE 'SELECT count(*) FROM public.profiles WHERE user_id = $1 AND (nickname IS DISTINCT FROM ''탈퇴한 사용자'' OR username IS NOT NULL OR avatar_url IS NOT NULL)' INTO v_remaining USING v_request.target_user_id;
          IF v_remaining <> 0 THEN
            RAISE EXCEPTION 'profile_anonymization_readback_failed';
          END IF;
        END IF;
      ELSIF v_item.data_class_code = 'user_statistics' AND pg_catalog.to_regclass('public.user_stats') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.user_stats WHERE user_id = $1' USING v_request.target_user_id;
        EXECUTE 'SELECT count(*) FROM public.user_stats WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
        IF v_remaining <> 0 THEN RAISE EXCEPTION 'user_statistics_readback_failed'; END IF;
      ELSIF v_item.data_class_code = 'user_bookmarks' AND pg_catalog.to_regclass('public.user_bookmarks') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.user_bookmarks WHERE user_id = $1' USING v_request.target_user_id;
        EXECUTE 'SELECT count(*) FROM public.user_bookmarks WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
        IF v_remaining <> 0 THEN RAISE EXCEPTION 'user_bookmarks_readback_failed'; END IF;
      ELSIF v_item.data_class_code = 'notifications' AND pg_catalog.to_regclass('public.notifications') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.notifications WHERE user_id = $1' USING v_request.target_user_id;
        EXECUTE 'SELECT count(*) FROM public.notifications WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
        IF v_remaining <> 0 THEN RAISE EXCEPTION 'notifications_readback_failed'; END IF;
      ELSIF v_item.data_class_code = 'user_preferences' AND pg_catalog.to_regclass('public.admin_user_preferences') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.admin_user_preferences WHERE user_id = $1' USING v_request.target_user_id;
        EXECUTE 'SELECT count(*) FROM public.admin_user_preferences WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
        IF v_remaining <> 0 THEN RAISE EXCEPTION 'user_preferences_readback_failed'; END IF;
      ELSIF v_item.data_class_code = 'storyboard_documents' AND pg_catalog.to_regclass('public.documents') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.documents WHERE user_id = $1' USING v_request.target_user_id;
        EXECUTE 'SELECT count(*) FROM public.documents WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
        IF v_remaining <> 0 THEN RAISE EXCEPTION 'storyboard_documents_readback_failed'; END IF;
      ELSIF v_item.data_class_code = 'review_likes' AND pg_catalog.to_regclass('public.review_likes') IS NOT NULL THEN
        IF pg_catalog.to_regclass('public.reviews') IS NOT NULL THEN
          EXECUTE 'DELETE FROM public.review_likes AS review_like WHERE review_like.user_id = $1 OR review_like.review_id IN (SELECT review_row.id FROM public.reviews AS review_row WHERE review_row.user_id = $1)' USING v_request.target_user_id;
          EXECUTE 'SELECT count(*) FROM public.review_likes AS review_like WHERE review_like.user_id = $1 OR review_like.review_id IN (SELECT review_row.id FROM public.reviews AS review_row WHERE review_row.user_id = $1)' INTO v_remaining USING v_request.target_user_id;
        ELSE
          EXECUTE 'DELETE FROM public.review_likes WHERE user_id = $1' USING v_request.target_user_id;
          EXECUTE 'SELECT count(*) FROM public.review_likes WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
        END IF;
        IF v_remaining <> 0 THEN RAISE EXCEPTION 'review_likes_readback_failed'; END IF;
      ELSIF v_item.data_class_code = 'reviews' AND pg_catalog.to_regclass('public.reviews') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.reviews WHERE user_id = $1' USING v_request.target_user_id;
        EXECUTE 'SELECT count(*) FROM public.reviews WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
        IF v_remaining <> 0 THEN RAISE EXCEPTION 'reviews_readback_failed'; END IF;
      ELSIF v_item.data_class_code = 'restaurant_submissions' AND pg_catalog.to_regclass('public.restaurant_submissions') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.restaurant_submissions WHERE user_id = $1' USING v_request.target_user_id;
        EXECUTE 'SELECT count(*) FROM public.restaurant_submissions WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
        IF v_remaining <> 0 THEN RAISE EXCEPTION 'restaurant_submissions_readback_failed'; END IF;
      ELSIF v_item.data_class_code = 'restaurant_requests' AND pg_catalog.to_regclass('public.restaurant_requests') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.restaurant_requests WHERE user_id = $1' USING v_request.target_user_id;
        EXECUTE 'SELECT count(*) FROM public.restaurant_requests WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
        IF v_remaining <> 0 THEN RAISE EXCEPTION 'restaurant_requests_readback_failed'; END IF;
      ELSIF v_item.data_class_code = 'ocr_logs' AND pg_catalog.to_regclass('public.ocr_logs') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.ocr_logs WHERE user_id = $1' USING v_request.target_user_id;
        EXECUTE 'SELECT count(*) FROM public.ocr_logs WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
        IF v_remaining <> 0 THEN RAISE EXCEPTION 'ocr_logs_readback_failed'; END IF;
      END IF;

      UPDATE public.account_deletion_request_items AS request_item
      SET status = CASE WHEN request_item.disposition = 'retain' THEN 'retained' WHEN request_item.disposition = 'separate' THEN 'separated' ELSE 'applied' END,
          reason_code = 'DB_READBACK_PASSED'
      WHERE request_item.request_id = v_request.id AND request_item.data_class_code = v_item.data_class_code;
    EXCEPTION WHEN OTHERS THEN
      v_db_failed := true;
      UPDATE public.account_deletion_request_items AS request_item
      SET status = 'failed', reason_code = 'DB_CLEANUP_FAILED'
      WHERE request_item.request_id = v_request.id AND request_item.data_class_code = v_item.data_class_code;
    END;
  END LOOP;

  BEGIN
    DELETE FROM auth.sessions AS user_session
    WHERE user_session.user_id = v_request.target_user_id;
    SELECT count(*) INTO v_sessions_remaining
    FROM auth.sessions AS session
    WHERE session.user_id = v_request.target_user_id;
    IF v_sessions_remaining <> 0 THEN
      RAISE EXCEPTION 'session_readback_failed';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_session_failed := true;
    v_sessions_remaining := 1;
  END;

  UPDATE public.account_deletion_requests AS request
  SET
    status = CASE WHEN v_db_failed OR v_session_failed THEN 'partial' ELSE 'applying' END,
    reason_code = CASE WHEN v_db_failed OR v_session_failed THEN 'DB_OR_SESSION_CLEANUP_FAILED' ELSE 'DB_AND_SESSION_READBACK_PASSED' END,
    db_readback_passed = NOT v_db_failed,
    session_readback_passed = NOT v_session_failed
  WHERE request.id = v_request.id
  RETURNING * INTO v_request;

  PERFORM public.account_deletion_write_audit(
    v_request,
    CASE WHEN v_db_failed OR v_session_failed THEN 'partial' ELSE 'readback_passed' END,
    v_request.reason_code
  );

  RETURN QUERY SELECT v_request.id, v_request.status, v_request.reason_code, v_request.db_readback_passed, v_request.session_readback_passed;
END;
$function$;

-- SECURITY INVOKER helpers must not retain public/private search paths either.
DO $invoker_paths$
DECLARE
  v_signature text;
  v_oid oid;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.evaluate_marketing_permission_state(text,boolean,boolean,timestamptz,text)',
    'privacy_retention.set_updated_at()',
    'privacy_retention.prevent_retention_class_history_mutation()',
    'privacy_retention.prevent_active_class_source_mutation()',
    'privacy_retention.prevent_legal_hold_history_mutation()',
    'public.privacy_incident_set_updated_at()',
    'public.privacy_incident_actions_are_immutable()',
    'public.privacy_incident_enforce_state_invariants()',
    'public.privacy_incident_transition_is_allowed(public.privacy_incident_status,public.privacy_incident_status)',
    'public.privacy_incident_audit_count_summary(integer,integer)',
    'public.privacy_incident_validate_input(public.privacy_incident_status,jsonb)',
    'public.privacy_incident_decision_prompts(integer,boolean,boolean)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'G014 required helper identity is missing: %', v_signature;
    END IF;
    EXECUTE format('ALTER FUNCTION %s SET search_path = pg_catalog', v_oid::regprocedure);
  END LOOP;
END;
$invoker_paths$;

-- The former service evaluator read the owner-filtered view. It now queries the
-- private base ledger under its definer, preserving the service-only contract.
CREATE OR REPLACE FUNCTION public.evaluate_notification_marketing_permission(
  p_user_id uuid,
  p_channel text,
  p_scheduled_at timestamptz,
  p_timezone text DEFAULT 'Asia/Seoul'
)
RETURNS TABLE (allowed boolean, reason_code text, consent_event_id uuid, night_consent_event_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_ordinary uuid;
  v_ordinary_decision text;
  v_night uuid;
  v_night_decision text;
BEGIN
  PERFORM public.assert_marketing_service_role();
  IF p_user_id IS NULL OR p_channel NOT IN ('email', 'sms', 'push') THEN
    RAISE EXCEPTION 'marketing_permission_input_invalid';
  END IF;

  SELECT event.id, event.decision INTO v_ordinary, v_ordinary_decision
  FROM privacy_retention.privacy_consent_events AS event
  WHERE event.user_id = p_user_id
    AND event.subject_kind = 'self'
    AND event.purpose = p_channel || '_marketing'
    AND event.channel = p_channel
  ORDER BY event.occurred_at DESC, event.id DESC
  LIMIT 1;

  IF p_channel <> 'email' AND public.is_marketing_night_window(p_scheduled_at, p_timezone) THEN
    SELECT event.id, event.decision INTO v_night, v_night_decision
    FROM privacy_retention.privacy_consent_events AS event
    WHERE event.user_id = p_user_id
      AND event.subject_kind = 'self'
      AND event.purpose = 'night_marketing'
      AND event.channel = p_channel
    ORDER BY event.occurred_at DESC, event.id DESC
    LIMIT 1;
  END IF;

  RETURN QUERY
  SELECT permission.allowed,
         permission.reason_code,
         CASE WHEN permission.allowed THEN v_ordinary END,
         CASE WHEN permission.allowed THEN v_night END
  FROM public.evaluate_marketing_permission_state(
    p_channel,
    v_ordinary_decision = 'granted',
    v_night_decision = 'granted',
    p_scheduled_at,
    p_timezone
  ) AS permission;
END;
$function$;
ALTER FUNCTION public.evaluate_notification_marketing_permission(uuid, text, timestamptz, text)
  OWNER TO privacy_workflow_owner;

-- apply_admin_user_db_mutation writes the immutable admin ledger. It must remain
-- callable only through its RPC once service_role table DML is removed.
DO $admin_definer$
DECLARE
  v_oid oid := pg_catalog.to_regprocedure('public.apply_admin_user_db_mutation(uuid,uuid,text,text,jsonb,jsonb,uuid,jsonb,text,text,text,text,text)');
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'G014 required admin mutation RPC is missing';
  END IF;
  EXECUTE format('ALTER FUNCTION %s SECURITY DEFINER', v_oid::regprocedure);
  EXECUTE format('ALTER FUNCTION %s SET search_path = ''''', v_oid::regprocedure);
  EXECUTE format('ALTER FUNCTION %s OWNER TO privacy_workflow_owner', v_oid::regprocedure);
END;
$admin_definer$;
-- Nested G010 helpers are implementation-only capabilities. Their exact
-- identities are frozen separately from externally callable public RPCs, and
-- EXECUTE is granted only to the two trusted implementation owners.
DO $nested_helper_shape$
BEGIN
  IF pg_catalog.to_regclass('privacy_retention.g014_nested_helper_allowlist') IS NULL THEN
    CREATE TABLE privacy_retention.g014_nested_helper_allowlist (
      source_signature text PRIMARY KEY
    );
  ELSIF (
    SELECT count(*)
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'privacy_retention.g014_nested_helper_allowlist'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) <> 1
  OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'privacy_retention.g014_nested_helper_allowlist'::regclass
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
      AND attribute.attname = 'source_signature'
      AND attribute.atttypid = 'text'::regtype
      AND attribute.attnotnull
  )
  OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'privacy_retention.g014_nested_helper_allowlist'::regclass
      AND constraint_row.contype = 'p'
      AND pg_catalog.pg_get_constraintdef(constraint_row.oid)
        = 'PRIMARY KEY (source_signature)'
  ) THEN
    RAISE EXCEPTION 'g014_nested_helper_allowlist has an incompatible shape';
  END IF;
END;
$nested_helper_shape$;
ALTER TABLE privacy_retention.g014_nested_helper_allowlist OWNER TO privacy_workflow_owner;
ALTER TABLE privacy_retention.g014_nested_helper_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_retention.g014_nested_helper_allowlist FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE privacy_retention.g014_nested_helper_allowlist
  FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE privacy_retention.g014_nested_helper_allowlist TO privacy_workflow_owner;
DROP POLICY IF EXISTS g014_privacy_workflow_owner_access
  ON privacy_retention.g014_nested_helper_allowlist;
CREATE POLICY g014_privacy_workflow_owner_access
  ON privacy_retention.g014_nested_helper_allowlist
  FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true);

DO $nested_helper_allowlist$
DECLARE
  v_signature text;
  v_oid oid;
  v_grantee name;
  v_missing text;
  v_cross_schema_owner_functions constant text[] := ARRAY[
    'public.account_deletion_require_service_role()',
    'public.account_deletion_is_active_admin(uuid)',
    'public.account_deletion_write_audit(public.account_deletion_requests,text,text)',
    'privacy_retention.require_service_role()',
    'privacy_retention.write_run_audit(privacy_retention.privacy_retention_runs,text,text)'
  ];
BEGIN
  CREATE TEMPORARY TABLE pg_temp.g014_expected_nested_helper_allowlist (
    source_signature text PRIMARY KEY
  ) ON COMMIT DROP;

  INSERT INTO pg_temp.g014_expected_nested_helper_allowlist (source_signature)
  VALUES
    ('public.privacy_requested_consents_are_valid(jsonb)'),
    ('public.privacy_resolve_audit_retention_until(text,timestamptz)'),
    ('public.privacy_audit_count_summary_is_safe(jsonb)'),
    ('public.privacy_audit_metadata_is_safe(jsonb)'),
    ('public.privacy_reject_immutable_mutation()'),
    ('public.privacy_reject_published_policy_mutation()'),
    ('public.privacy_under_14_is_eligible(uuid,uuid)'),
    ('public.privacy_validate_age_profile()'),
    ('public.privacy_validate_consent_event()'),
    ('public.privacy_refresh_age_profile(uuid)'),
    ('public.privacy_refresh_age_profile_after_consent()'),
    ('public.privacy_refresh_age_profile_after_guardian()'),
    ('public.privacy_append_audit_event(text,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb)'),
    ('public.assert_notification_content_safe(text,text,jsonb)'),
    ('public.assert_marketing_service_role()'),
    ('public.is_marketing_night_window(timestamptz,text)'),
    ('public.evaluate_marketing_permission_state(text,boolean,boolean,timestamptz,text)'),
    ('public.record_marketing_campaign_audit(uuid,uuid,text,text,text,text,integer,integer,integer,integer)'),
    ('public.account_deletion_set_updated_at()'),
    ('public.account_deletion_require_service_role()'),
    ('public.account_deletion_subject_hash(uuid)'),
    ('public.account_deletion_is_active_admin(uuid)'),
    ('public.account_deletion_write_audit(public.account_deletion_requests,text,text)'),
    ('public.account_deletion_reason_code_is_safe(text)'),
    ('public.admin_user_audit_reason_code(text,text)'),
    ('public.admin_user_audit_counts_are_safe(jsonb)'),
    ('public.admin_user_audit_flags_are_safe(jsonb)'),
    ('public.admin_user_audit_event_is_safe(text,text,text,text,jsonb,jsonb,jsonb,jsonb,text,text,text)'),
    ('privacy_retention.set_updated_at()'),
    ('privacy_retention.prevent_retention_class_history_mutation()'),
    ('privacy_retention.prevent_active_class_source_mutation()'),
    ('privacy_retention.prevent_legal_hold_history_mutation()'),
    ('privacy_retention.require_service_role()'),
    ('privacy_retention.active_hold_exists(text,text,timestamptz)'),
    ('privacy_retention.write_run_audit(privacy_retention.privacy_retention_runs,text,text)'),
    ('public.privacy_incident_set_updated_at()'),
    ('public.privacy_incident_actions_are_immutable()'),
    ('public.privacy_incident_enforce_state_invariants()'),
    ('public.privacy_incident_transition_is_allowed(public.privacy_incident_status,public.privacy_incident_status)'),
    ('public.privacy_incident_audit_count_summary(integer,integer)'),
    ('public.privacy_incident_input_hash(jsonb)'),
    ('public.privacy_incident_validate_input(public.privacy_incident_status,jsonb)'),
    ('public.privacy_incident_decision_prompts(integer,boolean,boolean)'),
    ('public.privacy_incident_require_admin(uuid)'),
    ('public.privacy_incident_audit_retention_until(timestamptz)');

  SELECT expected.source_signature INTO v_missing
  FROM pg_temp.g014_expected_nested_helper_allowlist AS expected
  WHERE pg_catalog.to_regprocedure(expected.source_signature) IS NULL
  ORDER BY expected.source_signature
  LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'G014 required nested helper identity is missing: %', v_missing;
  END IF;

  INSERT INTO privacy_retention.g014_nested_helper_allowlist (source_signature)
  SELECT source_signature
  FROM pg_temp.g014_expected_nested_helper_allowlist
  ON CONFLICT DO NOTHING;

  IF EXISTS (
    (SELECT source_signature FROM privacy_retention.g014_nested_helper_allowlist)
    EXCEPT
    (SELECT source_signature FROM pg_temp.g014_expected_nested_helper_allowlist)
  ) OR EXISTS (
    (SELECT source_signature FROM pg_temp.g014_expected_nested_helper_allowlist)
    EXCEPT
    (SELECT source_signature FROM privacy_retention.g014_nested_helper_allowlist)
  ) THEN
    RAISE EXCEPTION 'G014 nested helper allowlist has incompatible persisted rows';
  END IF;

  FOR v_signature IN
    SELECT source_signature
    FROM privacy_retention.g014_nested_helper_allowlist
    ORDER BY source_signature
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_signature = ANY (v_cross_schema_owner_functions) THEN
      IF pg_catalog.pg_get_userbyid(
        (SELECT procedure.proowner FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_oid)
      ) <> 'postgres' THEN
        RAISE EXCEPTION 'G014 cross-schema nested helper owner is not the trusted existing owner: %', v_signature;
      END IF;
    ELSE
      EXECUTE format('ALTER FUNCTION %s OWNER TO privacy_workflow_owner', v_oid::regprocedure);
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, postgres, privacy_workflow_owner', v_oid::regprocedure);
    FOR v_grantee IN
      SELECT DISTINCT pg_catalog.pg_get_userbyid(acl.grantee)::name
      FROM pg_catalog.pg_proc AS procedure
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
      ) AS acl
      WHERE procedure.oid = v_oid
        AND acl.privilege_type = 'EXECUTE'
        AND acl.grantee <> 0
        AND pg_catalog.pg_get_userbyid(acl.grantee) NOT IN ('postgres', 'privacy_workflow_owner')
    LOOP
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I', v_oid::regprocedure, v_grantee);
    END LOOP;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM postgres, privacy_workflow_owner', v_oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO postgres', v_oid::regprocedure);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO privacy_workflow_owner', v_oid::regprocedure);
  END LOOP;
  DROP TABLE pg_temp.g014_expected_nested_helper_allowlist;
END;
$nested_helper_allowlist$;

-- The validator is private because it is used both during migration application
-- and in the SQL contract fixture to prove missing/extra overloads fail.
CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_public_rpc_allowlist()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_missing_identity text;
  v_unexpected_identity text;
BEGIN
  SELECT allowed.source_signature
  INTO v_missing_identity
  FROM privacy_retention.g014_public_rpc_allowlist AS allowed
  WHERE pg_catalog.to_regprocedure(allowed.source_signature) IS NULL
  ORDER BY allowed.source_signature
  LIMIT 1;

  IF v_missing_identity IS NOT NULL THEN
    RAISE EXCEPTION 'G014 required public RPC identity is missing: %', v_missing_identity;
  END IF;

  SELECT format(
           '%I.%I(%s)',
           namespace.nspname,
           procedure.proname,
           pg_catalog.pg_get_function_identity_arguments(procedure.oid)
         )
  INTO v_unexpected_identity
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  JOIN (
    SELECT DISTINCT function_schema, function_name
    FROM privacy_retention.g014_public_rpc_allowlist
  ) AS expected_name
    ON expected_name.function_schema = namespace.nspname
   AND expected_name.function_name = procedure.proname
  WHERE namespace.nspname = 'public'
    AND NOT EXISTS (
      SELECT 1
      FROM privacy_retention.g014_public_rpc_allowlist AS allowed
      WHERE allowed.function_schema = namespace.nspname
        AND allowed.function_name = procedure.proname
        AND allowed.identity_arguments = procedure.proargtypes::text
    )
  ORDER BY
    namespace.nspname,
    procedure.proname,
    pg_catalog.pg_get_function_identity_arguments(procedure.oid)
  LIMIT 1;

  IF v_unexpected_identity IS NOT NULL THEN
    RAISE EXCEPTION 'G014 found an unexpected overload of an allowlisted RPC: %',
      v_unexpected_identity;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND pg_catalog.pg_get_userbyid(procedure.proowner) NOT IN ('postgres', 'privacy_workflow_owner')
  ) THEN
    RAISE EXCEPTION 'G014 found a public function owned by an unverified creator';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    CROSS JOIN (VALUES ('anon'::name), ('authenticated'::name), ('service_role'::name)) AS role_matrix(grantee)
    WHERE namespace.nspname = 'public'
      AND pg_catalog.has_function_privilege(role_matrix.grantee, procedure.oid, 'EXECUTE')
        IS DISTINCT FROM EXISTS (
          SELECT 1
          FROM privacy_retention.g014_public_rpc_allowlist AS allowed
          WHERE allowed.function_schema = namespace.nspname
            AND allowed.function_name = procedure.proname
            AND allowed.identity_arguments = procedure.proargtypes::text
            AND allowed.grantee = role_matrix.grantee
        )
  ) THEN
    RAISE EXCEPTION 'G014 public RPC effective grantee matrix does not match the allowlist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) AS acl
    WHERE namespace.nspname = 'public'
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'G014 found PUBLIC EXECUTE on a public function';
  END IF;
END;
$function$;
ALTER FUNCTION privacy_retention.assert_g014_public_rpc_allowlist() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.assert_g014_public_rpc_allowlist()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION privacy_retention.assert_g014_public_rpc_allowlist()
  TO postgres;
CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_invoker_contract()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_procedure record;
  v_search_path text;
BEGIN
  SELECT procedure.prosecdef,
         pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
         procedure.proconfig
  INTO v_procedure
  FROM pg_catalog.pg_proc AS procedure
  WHERE procedure.oid = 'privacy_retention.g014_reject_audit_mutation()'::regprocedure;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'G014 required SECURITY INVOKER audit trigger function is missing';
  END IF;
  IF v_procedure.prosecdef THEN
    RAISE EXCEPTION 'G014 audit trigger function must remain SECURITY INVOKER';
  END IF;
  IF v_procedure.owner_name <> 'privacy_workflow_owner' THEN
    RAISE EXCEPTION 'G014 SECURITY INVOKER audit trigger owner mismatch';
  END IF;

  SELECT setting.value INTO v_search_path
  FROM pg_catalog.unnest(v_procedure.proconfig) AS setting(value)
  WHERE setting.value LIKE 'search_path=%';

  IF v_search_path IS DISTINCT FROM 'search_path='
     AND v_search_path IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION 'G014 SECURITY INVOKER audit trigger search_path is not empty';
  END IF;
END;
$function$;
ALTER FUNCTION privacy_retention.assert_g014_invoker_contract() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.assert_g014_invoker_contract()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_cross_schema_contract()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_signature text;
  v_oid oid;
  v_procedure record;
  v_search_path text;
  v_stale_private_relation_prefix text := pg_catalog.replace(
    'privacy_retention.',
    'privacy_retention',
    'public'
  );
  v_doubled_extensions_qualification text := 'extensions.' || 'extensions.';
  v_doubled_pg_catalog_qualification text := 'pg_catalog.' || 'pg_catalog.';
  v_doubled_public_qualification text := 'public.' || 'public.';
  v_unqualified_gen_random_uuid text := 'gen_random_' || 'uuid()';
  v_extensions_gen_random_uuid text := 'extensions.' || 'gen_random_' || 'uuid()';
  v_unqualified_encode_digest text := ' encode(' || 'digest(';
  v_unqualified_digest text := ' dig' || 'est(';
BEGIN
  FOR v_signature IN
    SELECT expected.source_signature
    FROM (VALUES
      ('public.account_deletion_require_service_role()'),
      ('public.account_deletion_is_active_admin(uuid)'),
      ('public.account_deletion_write_audit(public.account_deletion_requests,text,text)'),
      ('public.preview_account_deletion(uuid,uuid,timestamptz)'),
      ('public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz)'),
      ('public.apply_account_deletion_database_cleanup(uuid,uuid)'),
      ('public.list_account_deletion_storage_objects(uuid,uuid)'),
      ('public.finalize_account_deletion_storage(uuid,uuid,boolean)'),
      ('public.finalize_account_deletion_auth(uuid,uuid,boolean)'),
      ('public.fail_account_deletion(uuid,uuid,text)'),
      ('privacy_retention.require_service_role()'),
      ('privacy_retention.write_run_audit(privacy_retention.privacy_retention_runs,text,text)')
    ) AS expected(source_signature)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'G014 required cross-schema function is missing: %', v_signature;
    END IF;

    SELECT procedure.prosecdef,
           pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
           procedure.proconfig
    INTO v_procedure
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid = v_oid;

    IF NOT v_procedure.prosecdef THEN
      RAISE EXCEPTION 'G014 cross-schema function is SECURITY INVOKER: %', v_signature;
    END IF;
    IF v_procedure.owner_name <> 'postgres' THEN
      RAISE EXCEPTION 'G014 cross-schema function owner mismatch: %', v_signature;
    END IF;

    SELECT setting.value INTO v_search_path
    FROM pg_catalog.unnest(v_procedure.proconfig) AS setting(value)
    WHERE setting.value LIKE 'search_path=%';

    IF v_search_path IS DISTINCT FROM 'search_path='
       AND v_search_path IS DISTINCT FROM 'search_path=""' THEN
      RAISE EXCEPTION 'G014 cross-schema function search_path is not empty: %', v_signature;
    END IF;
    IF position(v_stale_private_relation_prefix || 'privacy_policy_versions' IN pg_catalog.pg_get_functiondef(v_oid)) <> 0
       OR position(v_stale_private_relation_prefix || 'privacy_onboarding_challenges' IN pg_catalog.pg_get_functiondef(v_oid)) <> 0
       OR position(v_stale_private_relation_prefix || 'privacy_guardian_verifications' IN pg_catalog.pg_get_functiondef(v_oid)) <> 0
       OR position(v_stale_private_relation_prefix || 'privacy_age_profiles' IN pg_catalog.pg_get_functiondef(v_oid)) <> 0
       OR position(v_stale_private_relation_prefix || 'privacy_consent_events' IN pg_catalog.pg_get_functiondef(v_oid)) <> 0
       OR position(v_stale_private_relation_prefix || 'privacy_audit_events' IN pg_catalog.pg_get_functiondef(v_oid)) <> 0
       OR position(v_doubled_extensions_qualification IN pg_catalog.pg_get_functiondef(v_oid)) <> 0
       OR position(v_doubled_pg_catalog_qualification IN pg_catalog.pg_get_functiondef(v_oid)) <> 0
       OR position(v_doubled_public_qualification IN pg_catalog.pg_get_functiondef(v_oid)) <> 0
       OR (
         position(v_unqualified_gen_random_uuid IN pg_catalog.pg_get_functiondef(v_oid)) <> 0
         AND position(v_extensions_gen_random_uuid IN pg_catalog.pg_get_functiondef(v_oid)) = 0
       )
       OR position(v_unqualified_encode_digest IN pg_catalog.pg_get_functiondef(v_oid)) <> 0
       OR position(v_unqualified_digest IN pg_catalog.pg_get_functiondef(v_oid)) <> 0 THEN
      RAISE EXCEPTION 'G014 cross-schema function qualification mismatch: %', v_signature;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM (VALUES ('anon'::name), ('authenticated'::name), ('service_role'::name)) AS roles(role_name)
      WHERE pg_catalog.has_function_privilege(roles.role_name, v_oid, 'EXECUTE')
        IS DISTINCT FROM EXISTS (
          SELECT 1
          FROM privacy_retention.g014_public_rpc_allowlist AS allowed
          WHERE allowed.source_signature = v_signature
            AND allowed.grantee = roles.role_name
        )
    ) THEN
      RAISE EXCEPTION 'G014 cross-schema function Data API EXECUTE mismatch: %', v_signature;
    END IF;
  END LOOP;
END;
$function$;
ALTER FUNCTION privacy_retention.assert_g014_cross_schema_contract() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.assert_g014_cross_schema_contract()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_definer_contract()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_signature text;
  v_oid oid;
  v_procedure record;
  v_search_path text;
BEGIN
  FOR v_signature IN
    SELECT expected.source_signature
    FROM (VALUES
      ('public.privacy_resolve_audit_retention_until(text,timestamptz)'),
      ('public.privacy_under_14_is_eligible(uuid,uuid)'),
      ('public.privacy_validate_age_profile()'),
      ('public.privacy_validate_consent_event()'),
      ('public.privacy_refresh_age_profile(uuid)'),
      ('public.privacy_refresh_age_profile_after_consent()'),
      ('public.privacy_refresh_age_profile_after_guardian()'),
      ('public.privacy_append_audit_event(text,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb)'),
      ('public.get_current_privacy_policy_version()'),
      ('public.create_privacy_onboarding_challenge(text,uuid,text,jsonb,text,timestamptz)'),
      ('public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)'),
      ('public.submit_privacy_consent(text,text,text,uuid,text,text,uuid,text,uuid)'),
      ('public.record_privacy_guardian_verification(uuid,uuid,text,text,text,timestamptz,timestamptz)'),
      ('public.read_privacy_guardian_status(uuid)'),
      ('public.create_user_notification(uuid,text,text,text,jsonb)'),
      ('public.mark_notification_read(uuid)'),
      ('public.mark_all_notifications_read()'),
      ('public.delete_notification(uuid)'),
      ('public.assert_marketing_service_role()'),
      ('public.evaluate_notification_marketing_permission(uuid,text,timestamptz,text)'),
      ('public.record_marketing_campaign_audit(uuid,uuid,text,text,text,text,integer,integer,integer,integer)'),
      ('public.marketing_campaign_receipt(uuid)'),
      ('public.preview_marketing_campaign(uuid,text,uuid[],text,text,jsonb,text,timestamptz)'),
      ('public.prepare_marketing_campaign_batch(uuid,uuid,text,text,integer,text)'),
      ('public.fail_marketing_campaign_batch(uuid,uuid,uuid,text,text)'),
      ('public.finalize_marketing_campaign_batch(uuid,uuid,uuid,text,uuid[])'),
      ('privacy_retention.active_hold_exists(text,text,timestamptz)'),
      ('public.preview_privacy_retention_run(text,timestamptz,integer,integer)'),
      ('public.confirm_privacy_retention_run(uuid,text,text,text)'),
      ('public.apply_privacy_retention_run(uuid,text,text,integer)'),
      ('public.claim_privacy_retention_storage_items(uuid,text,text,integer)'),
      ('public.ack_privacy_retention_storage_items(uuid,text,text,uuid[],boolean)'),
      ('public.finalize_privacy_retention_run(uuid,text,text)'),
      ('public.privacy_incident_require_admin(uuid)'),
      ('public.privacy_incident_audit_retention_until(timestamptz)'),
      ('public.preview_privacy_incident_transition(uuid,uuid,public.privacy_incident_status,timestamptz,text,jsonb,uuid)'),
      ('public.apply_privacy_incident_transition(uuid,uuid,uuid,public.privacy_incident_status,timestamptz,text,text,text,jsonb,uuid,text)'),
      ('public.record_privacy_incident_detection(uuid,uuid,text,timestamptz,text,uuid)'),
      ('public.apply_admin_user_db_mutation(uuid,uuid,text,text,jsonb,jsonb,uuid,jsonb,text,text,text,text,text)'),
      ('public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamptz,timestamptz)'),
      ('privacy_retention.assert_g014_public_rpc_allowlist()'),
      ('privacy_retention.assert_g014_invoker_contract()'),
      ('privacy_retention.assert_g014_cross_schema_contract()'),
      ('privacy_retention.assert_g014_definer_contract()')
    ) AS expected(source_signature)
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'G014 required SECURITY DEFINER identity is missing: %', v_signature;
    END IF;

    SELECT procedure.prosecdef,
           pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
           procedure.proconfig
    INTO v_procedure
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid = v_oid;

    IF NOT v_procedure.prosecdef THEN
      RAISE EXCEPTION 'G014 required SECURITY DEFINER identity is SECURITY INVOKER: %', v_signature;
    END IF;
    IF v_procedure.owner_name <> 'privacy_workflow_owner' THEN
      RAISE EXCEPTION 'G014 SECURITY DEFINER owner mismatch: %', v_signature;
    END IF;

    SELECT setting.value INTO v_search_path
    FROM pg_catalog.unnest(v_procedure.proconfig) AS setting(value)
    WHERE setting.value LIKE 'search_path=%';

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
GRANT EXECUTE ON FUNCTION privacy_retention.assert_g014_definer_contract()
  TO privacy_workflow_owner;

-- Start from zero effective Data API EXECUTE on every public overload, then grant
-- only the frozen matrix. This intentionally removes default/legacy grants.
DO $revoke_and_grant$
DECLARE
  v_function regprocedure;
  v_allowed record;
BEGIN
  FOR v_function IN
    SELECT procedure.oid::regprocedure
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_function);
  END LOOP;

  FOR v_allowed IN
    SELECT allowed.source_signature, allowed.grantee
    FROM privacy_retention.g014_public_rpc_allowlist AS allowed
    ORDER BY allowed.source_signature, allowed.grantee
  LOOP
    IF pg_catalog.to_regprocedure(v_allowed.source_signature) IS NULL THEN
      RAISE EXCEPTION 'G014 required public RPC disappeared before grant: %', v_allowed.source_signature;
    END IF;
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO %I',
      pg_catalog.to_regprocedure(v_allowed.source_signature)::regprocedure,
      v_allowed.grantee
    );
  END LOOP;
END;
$revoke_and_grant$;

-- Only trusted implementation owners may execute private helpers; no Data API
-- principal receives private function access.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA privacy_retention FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA privacy_retention FROM PUBLIC, anon, authenticated, service_role;

SELECT privacy_retention.assert_g014_public_rpc_allowlist();

DO $final_contract$
DECLARE
  v_name text;
  v_definition_violation record;
  v_stale_private_relation_prefix text := pg_catalog.replace(
    'privacy_retention.',
    'privacy_retention',
    'public'
  );
  v_doubled_extensions_qualification text := 'extensions.' || 'extensions.';
  v_doubled_pg_catalog_qualification text := 'pg_catalog.' || 'pg_catalog.';
  v_doubled_public_qualification text := 'public.' || 'public.';
  v_unqualified_gen_random_uuid text := 'gen_random_' || 'uuid()';
  v_extensions_gen_random_uuid text := 'extensions.' || 'gen_random_' || 'uuid()';
  v_unqualified_encode_digest text := ' encode(' || 'digest(';
  v_unqualified_digest text := ' dig' || 'est(';
  v_workflow_relations constant text[] := ARRAY[
    'notifications',
    'marketing_campaign_operations',
    'marketing_campaign_recipients',
    'marketing_campaign_batches',
    'account_deletion_policies',
    'account_deletion_data_classes',
    'account_deletion_requests',
    'account_deletion_request_items',
    'privacy_incidents',
    'privacy_incident_transition_previews',
    'privacy_incident_notices',
    'privacy_incident_actions',
    'profiles',
    'user_roles',
    'user_account_status',
    'admin_audit_events'
  ];
BEGIN
  PERFORM privacy_retention.assert_g014_workflow_owner_contract();
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace AS namespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(namespace.nspacl, pg_catalog.acldefault('n', namespace.nspowner))
    ) AS acl
    WHERE namespace.nspname = 'public'
      AND acl.grantee = 0
      AND acl.privilege_type = 'CREATE'
  ) OR pg_catalog.has_schema_privilege('anon', 'public', 'CREATE')
     OR pg_catalog.has_schema_privilege('authenticated', 'public', 'CREATE') THEN
    RAISE EXCEPTION 'G014 public CREATE revoke did not take effect';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'privacy_retention'
      AND relation.relkind = 'r'
      AND relation.relname IN (
        'privacy_policy_versions',
        'privacy_onboarding_challenges',
        'privacy_guardian_verifications',
        'privacy_age_profiles',
        'privacy_consent_events',
        'privacy_audit_events'
      )
  ) <> 6 OR EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'public'
      AND relation.relname IN (
        'privacy_policy_versions',
        'privacy_onboarding_challenges',
        'privacy_guardian_verifications',
        'privacy_age_profiles',
        'privacy_consent_events',
        'privacy_audit_events'
      )
  ) THEN
    RAISE EXCEPTION 'G014 retained privacy relation placement is not private-only';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class AS relation
    JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
    WHERE namespace.nspname = 'privacy_retention'
      AND relation.relkind = 'r'
      AND relation.relname IN (
        'privacy_policy_versions',
        'privacy_onboarding_challenges',
        'privacy_guardian_verifications',
        'privacy_age_profiles',
        'privacy_consent_events',
        'privacy_audit_events'
      )
      AND (
        pg_catalog.pg_get_userbyid(relation.relowner) <> 'privacy_workflow_owner'
        OR NOT relation.relrowsecurity
        OR NOT relation.relforcerowsecurity
      )
  ) THEN
    RAISE EXCEPTION 'G014 private relation owner or RLS contract failed';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_rewrite AS rewrite_rule
    JOIN pg_catalog.pg_depend AS dependency
      ON dependency.classid = 'pg_rewrite'::regclass
     AND dependency.objid = rewrite_rule.oid
     AND dependency.refclassid = 'pg_class'::regclass
    WHERE rewrite_rule.ev_class = 'public.privacy_consent_state'::regclass
      AND dependency.refobjid = 'privacy_retention.privacy_consent_events'::regclass
  ) THEN
    RAISE EXCEPTION 'G014 consent projection lost its private relation dependency';
  END IF;

  IF (
    SELECT count(*)
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'privacy_retention.privacy_consent_events'::regclass
      AND constraint_row.conrelid IN (
        'public.notifications'::regclass,
        'public.marketing_campaign_recipients'::regclass
      )
  ) <> 3 THEN
    RAISE EXCEPTION 'G014 moved consent-event foreign-key dependencies drifted';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS constraint_row
    WHERE constraint_row.conrelid = 'privacy_retention.privacy_audit_events'::regclass
      AND constraint_row.contype = 'f'
      AND constraint_row.confrelid = 'auth.users'::regclass
  ) THEN
    RAISE EXCEPTION 'G014 retained audit is still coupled to auth.users';
  END IF;

  IF (
    SELECT count(*)
    FROM public.account_deletion_data_classes AS data_class
    JOIN public.account_deletion_policies AS policy
      ON policy.version = data_class.policy_version
    WHERE policy.status = 'active'
      AND data_class.code = 'privacy_audit_actor_references'
      AND data_class.disposition = 'separate'
      AND data_class.mandatory
  ) <> 1 THEN
    RAISE EXCEPTION 'G014 active retained-audit deletion class is not separate';
  END IF;


  SELECT
    format(
      '%I.%I(%s)',
      namespace.nspname,
      procedure.proname,
      pg_catalog.pg_get_function_identity_arguments(procedure.oid)
    ) AS identity,
    CASE
      WHEN position(v_stale_private_relation_prefix || 'privacy_policy_versions' IN definition.body) <> 0 THEN 'stale_public_privacy_policy_versions'
      WHEN position(v_stale_private_relation_prefix || 'privacy_onboarding_challenges' IN definition.body) <> 0 THEN 'stale_public_privacy_onboarding_challenges'
      WHEN position(v_stale_private_relation_prefix || 'privacy_guardian_verifications' IN definition.body) <> 0 THEN 'stale_public_privacy_guardian_verifications'
      WHEN position(v_stale_private_relation_prefix || 'privacy_age_profiles' IN definition.body) <> 0 THEN 'stale_public_privacy_age_profiles'
      WHEN position(v_stale_private_relation_prefix || 'privacy_consent_events' IN definition.body) <> 0 THEN 'stale_public_privacy_consent_events'
      WHEN position(v_stale_private_relation_prefix || 'privacy_audit_events' IN definition.body) <> 0 THEN 'stale_public_privacy_audit_events'
      WHEN pg_catalog.pg_get_userbyid(procedure.proowner) = 'privacy_workflow_owner'
           AND position(v_doubled_extensions_qualification IN definition.body) <> 0 THEN 'doubled_extensions_qualification'
      WHEN pg_catalog.pg_get_userbyid(procedure.proowner) = 'privacy_workflow_owner'
           AND position(v_doubled_pg_catalog_qualification IN definition.body) <> 0 THEN 'doubled_pg_catalog_qualification'
      WHEN pg_catalog.pg_get_userbyid(procedure.proowner) = 'privacy_workflow_owner'
           AND position(v_doubled_public_qualification IN definition.body) <> 0 THEN 'doubled_public_qualification'
      WHEN pg_catalog.pg_get_userbyid(procedure.proowner) = 'privacy_workflow_owner'
           AND position(v_unqualified_gen_random_uuid IN definition.body) <> 0
           AND position(v_extensions_gen_random_uuid IN definition.body) = 0 THEN 'unqualified_gen_random_uuid'
      WHEN pg_catalog.pg_get_userbyid(procedure.proowner) = 'privacy_workflow_owner'
           AND position(v_unqualified_encode_digest IN definition.body) <> 0 THEN 'unqualified_encode_digest'
      WHEN pg_catalog.pg_get_userbyid(procedure.proowner) = 'privacy_workflow_owner'
           AND position(v_unqualified_digest IN definition.body) <> 0 THEN 'unqualified_digest'
    END AS reason_code
  INTO v_definition_violation
  FROM pg_catalog.pg_proc AS procedure
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  CROSS JOIN LATERAL (
    SELECT pg_catalog.pg_get_functiondef(procedure.oid) AS body
  ) AS definition
  WHERE namespace.nspname IN ('public', 'privacy_retention')
    AND procedure.prokind IN ('f', 'p')
    AND (
      position(v_stale_private_relation_prefix || 'privacy_policy_versions' IN definition.body) <> 0
      OR position(v_stale_private_relation_prefix || 'privacy_onboarding_challenges' IN definition.body) <> 0
      OR position(v_stale_private_relation_prefix || 'privacy_guardian_verifications' IN definition.body) <> 0
      OR position(v_stale_private_relation_prefix || 'privacy_age_profiles' IN definition.body) <> 0
      OR position(v_stale_private_relation_prefix || 'privacy_consent_events' IN definition.body) <> 0
      OR position(v_stale_private_relation_prefix || 'privacy_audit_events' IN definition.body) <> 0
      OR (
        pg_catalog.pg_get_userbyid(procedure.proowner) = 'privacy_workflow_owner'
        AND (
          position(v_doubled_extensions_qualification IN definition.body) <> 0
          OR position(v_doubled_pg_catalog_qualification IN definition.body) <> 0
          OR position(v_doubled_public_qualification IN definition.body) <> 0
          OR (
            position(v_unqualified_gen_random_uuid IN definition.body) <> 0
            AND position(v_extensions_gen_random_uuid IN definition.body) = 0
          )
          OR position(v_unqualified_encode_digest IN definition.body) <> 0
          OR position(v_unqualified_digest IN definition.body) <> 0
        )
      )
    )
  ORDER BY
    namespace.nspname,
    procedure.proname,
    pg_catalog.pg_get_function_identity_arguments(procedure.oid)
  LIMIT 1;

  IF v_definition_violation.identity IS NOT NULL THEN
    RAISE EXCEPTION 'G014 function definition still has stale or doubled qualification: % [%]',
      v_definition_violation.identity,
      v_definition_violation.reason_code;
  END IF;
  IF position(
       'public.privacy_consent_state' IN pg_catalog.pg_get_functiondef(
         'public.evaluate_notification_marketing_permission(uuid,text,timestamptz,text)'::regprocedure
       )
     ) <> 0 THEN
    RAISE EXCEPTION 'G014 service marketing evaluator still resolves the owner view';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM privacy_retention.g014_nested_helper_allowlist AS allowed
    CROSS JOIN (VALUES ('anon'::name), ('authenticated'::name), ('service_role'::name)) AS roles(role_name)
    WHERE pg_catalog.has_function_privilege(
      roles.role_name,
      pg_catalog.to_regprocedure(allowed.source_signature),
      'EXECUTE'
    )
  ) OR EXISTS (
    SELECT 1
    FROM privacy_retention.g014_nested_helper_allowlist AS allowed
    WHERE NOT pg_catalog.has_function_privilege(
      'postgres',
      pg_catalog.to_regprocedure(allowed.source_signature),
      'EXECUTE'
    ) OR NOT pg_catalog.has_function_privilege(
      'privacy_workflow_owner',
      pg_catalog.to_regprocedure(allowed.source_signature),
      'EXECUTE'
    )
  ) OR EXISTS (
    SELECT 1
    FROM privacy_retention.g014_nested_helper_allowlist AS allowed
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(allowed.source_signature)
    WHERE (
      SELECT count(*)
      FROM pg_catalog.aclexplode(
        COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
      ) AS acl
    ) <> 2
      OR EXISTS (
        (SELECT pg_catalog.pg_get_userbyid(acl.grantee)::name,
                acl.privilege_type,
                acl.is_grantable
         FROM pg_catalog.aclexplode(
           COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
         ) AS acl)
        EXCEPT
        (VALUES
          ('postgres'::name, 'EXECUTE'::text, false),
          ('privacy_workflow_owner'::name, 'EXECUTE'::text, false)
        )
      )
      OR EXISTS (
        (VALUES
          ('postgres'::name, 'EXECUTE'::text, false),
          ('privacy_workflow_owner'::name, 'EXECUTE'::text, false)
        )
        EXCEPT
        (SELECT pg_catalog.pg_get_userbyid(acl.grantee)::name,
                acl.privilege_type,
                acl.is_grantable
         FROM pg_catalog.aclexplode(
           COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
         ) AS acl)
      )
  ) THEN
    RAISE EXCEPTION 'G014 nested helper EXECUTE contract failed';
  END IF;

  FOREACH v_name IN ARRAY v_workflow_relations LOOP
    IF pg_catalog.has_table_privilege('anon', 'public.' || v_name, 'INSERT')
       OR pg_catalog.has_table_privilege('anon', 'public.' || v_name, 'UPDATE')
       OR pg_catalog.has_table_privilege('anon', 'public.' || v_name, 'DELETE')
       OR pg_catalog.has_table_privilege('anon', 'public.' || v_name, 'TRUNCATE')
       OR pg_catalog.has_table_privilege('authenticated', 'public.' || v_name, 'INSERT')
       OR pg_catalog.has_table_privilege('authenticated', 'public.' || v_name, 'UPDATE')
       OR pg_catalog.has_table_privilege('authenticated', 'public.' || v_name, 'DELETE')
       OR pg_catalog.has_table_privilege('authenticated', 'public.' || v_name, 'TRUNCATE')
       OR pg_catalog.has_table_privilege('service_role', 'public.' || v_name, 'INSERT')
       OR pg_catalog.has_table_privilege('service_role', 'public.' || v_name, 'UPDATE')
       OR pg_catalog.has_table_privilege('service_role', 'public.' || v_name, 'DELETE')
       OR pg_catalog.has_table_privilege('service_role', 'public.' || v_name, 'TRUNCATE') THEN
      RAISE EXCEPTION 'G014 Data API workflow-table mutation grant remains on public.%', v_name;
    END IF;
  END LOOP;

  PERFORM privacy_retention.assert_g014_invoker_contract();
  PERFORM privacy_retention.assert_g014_cross_schema_contract();
  PERFORM privacy_retention.assert_g014_definer_contract();
END;
$final_contract$;

NOTIFY pgrst, 'reload schema';
