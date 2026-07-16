\set ON_ERROR_STOP on

-- First application must reject a source-declared structural drift before it
-- can persist a manifest from the hosted catalog.
BEGIN;
CREATE TABLE privacy_retention.g014_catalog_contract_pre_first_relation (
  id integer PRIMARY KEY
);
\set ON_ERROR_STOP off
\ir ../migrations/20260713002500_g014_catalog_contract.sql
\if :ERROR
  ROLLBACK;
\else
  ROLLBACK;
  \set ON_ERROR_STOP on
  DO $pre_first_import_structural_drift_accepted$
  BEGIN
    RAISE EXCEPTION 'pre-first-import structural drift was accepted';
  END;
  $pre_first_import_structural_drift_accepted$;
\endif
\set ON_ERROR_STOP on

-- First application must also reject a source-declared authorization drift
-- before the live catalog can become a manifest.
BEGIN;
GRANT UPDATE (message) ON TABLE public.notifications TO authenticated;
\set ON_ERROR_STOP off
\ir ../migrations/20260713002500_g014_catalog_contract.sql
\if :ERROR
  ROLLBACK;
\else
  ROLLBACK;
  \set ON_ERROR_STOP on
  DO $pre_first_import_authorization_drift_accepted$
  BEGIN
    RAISE EXCEPTION 'pre-first-import column ACL drift was accepted';
  END;
  $pre_first_import_authorization_drift_accepted$;
\endif
\set ON_ERROR_STOP on

-- Run only in a disposable database after G014-01..05. Every later drift fixture
-- is contained in a PL/pgSQL exception subtransaction and leaves no durable state.
BEGIN;
\ir ../migrations/20260713002500_g014_catalog_contract.sql

DO $baseline_contract$
BEGIN
  PERFORM privacy_retention.assert_g014_catalog_contract();
END;
$baseline_contract$;
-- Every protected catalog dimension is keyed and compared in both directions.
-- Each nested block rolls back its deliberate drift before the next fixture.
DO $exact_catalog_manifest_dimensions_fixture$
BEGIN
  BEGIN
    CREATE TABLE privacy_retention.g014_catalog_contract_unexpected_relation (
      id integer PRIMARY KEY
    );
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'unexpected protected relation was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unexpected protected relation was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    ALTER TABLE public.notifications
      ADD COLUMN g014_catalog_contract_drift integer;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'unexpected protected column was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unexpected protected column was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    ALTER TABLE public.notifications
      ALTER COLUMN is_read SET DEFAULT true;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'protected default drift was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'protected default drift was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    ALTER TABLE public.account_deletion_requests
      ALTER COLUMN source_manifest_hash DROP NOT NULL;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'source manifest nullability drift was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'source manifest nullability drift was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    ALTER TABLE public.notifications OWNER TO postgres;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'protected relation owner drift was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'protected relation owner drift was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    ALTER TABLE public.notifications DISABLE ROW LEVEL SECURITY;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'protected RLS drift was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'protected RLS drift was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    ALTER TABLE privacy_retention.privacy_audit_events NO FORCE ROW LEVEL SECURITY;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'protected FORCE RLS drift was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'protected FORCE RLS drift was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    CREATE POLICY g014_catalog_contract_unexpected_policy
      ON public.notifications
      AS RESTRICTIVE
      FOR ALL TO privacy_workflow_owner
      USING (true)
      WITH CHECK (true);
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'unexpected protected policy was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unexpected protected policy was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    GRANT REFERENCES ON TABLE public.notifications TO authenticated;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'unexpected protected grant was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unexpected protected grant was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    GRANT UPDATE (message) ON TABLE public.notifications TO authenticated;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'unexpected browser column grant was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unexpected browser column grant was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    GRANT SELECT (message) ON TABLE public.notifications TO service_role;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'unexpected service-role column grant was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unexpected service-role column grant was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    ALTER POLICY g014_privacy_workflow_owner_access
      ON public.notifications TO PUBLIC, privacy_workflow_owner;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'PUBLIC policy role drift was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'PUBLIC policy role drift was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    ALTER TABLE public.notifications
      ADD CONSTRAINT g014_catalog_contract_unexpected_check CHECK (true) NOT VALID;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'unexpected protected constraint was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unexpected protected constraint was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    ALTER TABLE public.account_deletion_request_items
      ADD CONSTRAINT g014_catalog_contract_unexpected_fk
      FOREIGN KEY (request_id)
      REFERENCES public.account_deletion_requests(id)
      ON UPDATE RESTRICT
      ON DELETE CASCADE
      NOT VALID;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'unexpected protected foreign key was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unexpected protected foreign key was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    CREATE UNIQUE INDEX g014_catalog_contract_unexpected_index
      ON public.notifications (id)
      WHERE is_read IS FALSE;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'unexpected protected index was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unexpected protected index was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    CREATE FUNCTION privacy_retention.catalog_contract_fixture_trigger()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = ''
    AS $function$
    BEGIN
      RETURN NEW;
    END;
    $function$;
    CREATE TRIGGER g014_catalog_contract_unexpected_trigger
      AFTER INSERT OR UPDATE OR DELETE ON public.notifications
      FOR EACH ROW
      EXECUTE FUNCTION privacy_retention.catalog_contract_fixture_trigger();
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'unexpected protected trigger was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unexpected protected trigger was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;
END;
$exact_catalog_manifest_dimensions_fixture$;
-- Catalog expressions are compared as verbatim deparser output. In particular,
-- quoted whitespace is data, not formatting, across every expression-bearing
-- protected projection.
DO $quoted_literal_whitespace_fixture$
DECLARE
  v_default_once text;
  v_default_twice text;
  v_check_once text;
  v_check_twice text;
  v_policy_once text;
  v_policy_twice text;
  v_index_once text;
  v_index_twice text;
  v_trigger_once text;
  v_trigger_twice text;
BEGIN
  BEGIN
    ALTER TABLE public.notifications
      ALTER COLUMN message SET DEFAULT 'g014 quoted literal';
    SELECT row.manifest_value ->> 'default' INTO v_default_once
    FROM privacy_retention.g014_catalog_manifest_rows() AS row
    WHERE row.manifest_kind = 'column'
      AND row.manifest_key = pg_catalog.jsonb_build_object(
        'schema', 'public',
        'relation', 'notifications',
        'column', 'message'
      );

    ALTER TABLE public.notifications
      ALTER COLUMN message SET DEFAULT 'g014 quoted  literal';
    SELECT row.manifest_value ->> 'default' INTO v_default_twice
    FROM privacy_retention.g014_catalog_manifest_rows() AS row
    WHERE row.manifest_kind = 'column'
      AND row.manifest_key = pg_catalog.jsonb_build_object(
        'schema', 'public',
        'relation', 'notifications',
        'column', 'message'
      );

    ALTER TABLE public.notifications
      ADD CONSTRAINT g014_catalog_quote_fixture_check
      CHECK (message <> 'g014 quoted literal') NOT VALID;
    SELECT row.manifest_value ->> 'definition' INTO v_check_once
    FROM privacy_retention.g014_catalog_manifest_rows() AS row
    WHERE row.manifest_kind = 'constraint'
      AND row.manifest_key = pg_catalog.jsonb_build_object(
        'schema', 'public',
        'relation', 'notifications',
        'constraint', 'g014_catalog_quote_fixture_check'
      );

    ALTER TABLE public.notifications
      DROP CONSTRAINT g014_catalog_quote_fixture_check;
    ALTER TABLE public.notifications
      ADD CONSTRAINT g014_catalog_quote_fixture_check
      CHECK (message <> 'g014 quoted  literal') NOT VALID;
    SELECT row.manifest_value ->> 'definition' INTO v_check_twice
    FROM privacy_retention.g014_catalog_manifest_rows() AS row
    WHERE row.manifest_kind = 'constraint'
      AND row.manifest_key = pg_catalog.jsonb_build_object(
        'schema', 'public',
        'relation', 'notifications',
        'constraint', 'g014_catalog_quote_fixture_check'
      );

    ALTER POLICY g014_privacy_workflow_owner_access
      ON public.notifications
      TO privacy_workflow_owner
      USING (message <> 'g014 quoted literal')
      WITH CHECK (message <> 'g014 quoted literal');
    SELECT row.manifest_value ->> 'using' INTO v_policy_once
    FROM privacy_retention.g014_catalog_manifest_rows() AS row
    WHERE row.manifest_kind = 'policy'
      AND row.manifest_key = pg_catalog.jsonb_build_object(
        'schema', 'public',
        'relation', 'notifications',
        'policy', 'g014_privacy_workflow_owner_access'
      );

    ALTER POLICY g014_privacy_workflow_owner_access
      ON public.notifications
      TO privacy_workflow_owner
      USING (message <> 'g014 quoted  literal')
      WITH CHECK (message <> 'g014 quoted  literal');
    SELECT row.manifest_value ->> 'using' INTO v_policy_twice
    FROM privacy_retention.g014_catalog_manifest_rows() AS row
    WHERE row.manifest_kind = 'policy'
      AND row.manifest_key = pg_catalog.jsonb_build_object(
        'schema', 'public',
        'relation', 'notifications',
        'policy', 'g014_privacy_workflow_owner_access'
      );

    CREATE INDEX g014_catalog_quote_fixture_index
      ON public.notifications (id)
      WHERE message <> 'g014 quoted literal';
    SELECT row.manifest_value ->> 'predicate' INTO v_index_once
    FROM privacy_retention.g014_catalog_manifest_rows() AS row
    WHERE row.manifest_kind = 'index'
      AND row.manifest_key = pg_catalog.jsonb_build_object(
        'schema', 'public',
        'relation', 'notifications',
        'index', 'g014_catalog_quote_fixture_index',
        'index_schema', 'public'
      );

    DROP INDEX public.g014_catalog_quote_fixture_index;
    CREATE INDEX g014_catalog_quote_fixture_index
      ON public.notifications (id)
      WHERE message <> 'g014 quoted  literal';
    SELECT row.manifest_value ->> 'predicate' INTO v_index_twice
    FROM privacy_retention.g014_catalog_manifest_rows() AS row
    WHERE row.manifest_kind = 'index'
      AND row.manifest_key = pg_catalog.jsonb_build_object(
        'schema', 'public',
        'relation', 'notifications',
        'index', 'g014_catalog_quote_fixture_index',
        'index_schema', 'public'
      );

    CREATE FUNCTION privacy_retention.catalog_quote_fixture_trigger()
    RETURNS trigger
    LANGUAGE plpgsql
    SET search_path = ''
    AS $function$
    BEGIN
      RETURN NEW;
    END;
    $function$;
    CREATE TRIGGER g014_catalog_quote_fixture_trigger
      BEFORE INSERT ON public.notifications
      FOR EACH ROW
      WHEN (NEW.message <> 'g014 quoted literal')
      EXECUTE FUNCTION privacy_retention.catalog_quote_fixture_trigger();
    SELECT row.manifest_value ->> 'definition' INTO v_trigger_once
    FROM privacy_retention.g014_catalog_manifest_rows() AS row
    WHERE row.manifest_kind = 'trigger'
      AND row.manifest_key = pg_catalog.jsonb_build_object(
        'schema', 'public',
        'relation', 'notifications',
        'trigger', 'g014_catalog_quote_fixture_trigger'
      );

    DROP TRIGGER g014_catalog_quote_fixture_trigger ON public.notifications;
    CREATE TRIGGER g014_catalog_quote_fixture_trigger
      BEFORE INSERT ON public.notifications
      FOR EACH ROW
      WHEN (NEW.message <> 'g014 quoted  literal')
      EXECUTE FUNCTION privacy_retention.catalog_quote_fixture_trigger();
    SELECT row.manifest_value ->> 'definition' INTO v_trigger_twice
    FROM privacy_retention.g014_catalog_manifest_rows() AS row
    WHERE row.manifest_kind = 'trigger'
      AND row.manifest_key = pg_catalog.jsonb_build_object(
        'schema', 'public',
        'relation', 'notifications',
        'trigger', 'g014_catalog_quote_fixture_trigger'
      );

    IF v_default_once IS NULL
       OR v_check_once IS NULL
       OR v_policy_once IS NULL
       OR v_index_once IS NULL
       OR v_trigger_once IS NULL
       OR v_default_once = v_default_twice
       OR v_check_once = v_check_twice
       OR v_policy_once = v_policy_twice
       OR v_index_once = v_index_twice
       OR v_trigger_once = v_trigger_twice THEN
      RAISE EXCEPTION 'G014 catalog expression projection collapsed quoted literal whitespace';
    END IF;

    RAISE EXCEPTION 'g014 quoted literal fixture cleanup';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'g014 quoted literal fixture cleanup' THEN
      RAISE;
    END IF;
  END;
END;
$quoted_literal_whitespace_fixture$;

-- The named applied-receipt CHECK rejects a completed state without the durable
-- receipt even when all prior state-machine fields otherwise look complete.
DO $applied_receipt_check_fixture$
DECLARE
  v_policy_version text;
BEGIN
  SELECT policy.version INTO v_policy_version
  FROM public.account_deletion_policies AS policy
  ORDER BY policy.version
  LIMIT 1;

  BEGIN
    INSERT INTO public.account_deletion_requests (
      actor_user_id,
      target_user_id,
      policy_version,
      preview_hash,
      preview_expires_at,
      reauthenticated_at,
      status,
      source_manifest_hash,
      reason_code,
      db_readback_passed,
      storage_readback_passed,
      session_readback_passed,
      auth_readback_passed,
      applied_at
    ) VALUES (
      extensions.gen_random_uuid(),
      extensions.gen_random_uuid(),
      v_policy_version,
      pg_catalog.repeat('a', 64),
      pg_catalog.clock_timestamp() + INTERVAL '1 hour',
      pg_catalog.clock_timestamp(),
      'applied',
      pg_catalog.repeat('b', 64),
      'APPLIED',
      true,
      true,
      true,
      true,
      pg_catalog.clock_timestamp()
    );
    RAISE EXCEPTION 'applied deletion without an auth receipt was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END;
$applied_receipt_check_fixture$;

-- Missing exact identity is a hard failure, not a skipped allowlist row.
DO $missing_identity_fixture$
BEGIN
  BEGIN
    DELETE FROM privacy_retention.g014_public_rpc_allowlist
    WHERE source_signature = 'public.create_user_notification(uuid,text,text,text,jsonb)'
      AND grantee = 'authenticated';
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'missing G014 RPC identity was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'missing G014 RPC identity was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;
END;
$missing_identity_fixture$;

-- A new overload of an exposed RPC name is rejected even without a grant.
DO $unexpected_overload_fixture$
BEGIN
  BEGIN
    EXECUTE $sql$
      CREATE FUNCTION public.create_user_notification(
        uuid, text, text, text, jsonb, integer
      ) RETURNS void LANGUAGE plpgsql SET search_path = '' AS 'BEGIN RETURN; END;'
    $sql$;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'unexpected G014 RPC overload was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unexpected G014 RPC overload was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;
END;
$unexpected_overload_fixture$;

-- Effective privilege checks include grants inherited from PUBLIC and direct
-- role grants, rather than inspecting only explicit procedure ACL rows.
DO $grant_fixture$
BEGIN
  BEGIN
    GRANT EXECUTE ON FUNCTION public.ocr_log_metadata_is_safe(jsonb) TO authenticated;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'nonallowlisted authenticated execute was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'nonallowlisted authenticated execute was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;
END;
$grant_fixture$;

DO $owner_rls_and_constraint_fixture$
BEGIN
  BEGIN
    ALTER FUNCTION public.create_user_notification(uuid, text, text, text, jsonb)
      OWNER TO postgres;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'RPC owner drift was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'RPC owner drift was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    ALTER TABLE privacy_retention.privacy_audit_events NO FORCE ROW LEVEL SECURITY;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'private FORCE RLS drift was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'private FORCE RLS drift was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    ALTER TABLE public.marketing_campaign_operations
      DROP CONSTRAINT g014_marketing_campaign_operations_actor_ref_hash_check;
    ALTER TABLE public.marketing_campaign_operations
      ADD CONSTRAINT g014_marketing_campaign_operations_actor_ref_hash_check
      CHECK (true) NOT VALID;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'unvalidated named G014 check was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unvalidated named G014 check was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;
  BEGIN
    ALTER TABLE public.marketing_campaign_operations
      DROP CONSTRAINT g014_marketing_campaign_operations_actor_user_id_fkey;
    ALTER TABLE public.marketing_campaign_operations
      ADD CONSTRAINT g014_marketing_campaign_operations_actor_user_id_fkey
      FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE RESTRICT NOT VALID;
    ALTER TABLE public.marketing_campaign_operations
      VALIDATE CONSTRAINT g014_marketing_campaign_operations_actor_user_id_fkey;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'wrong account-delete action was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'wrong account-delete action was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;
END;
$owner_rls_and_constraint_fixture$;

DO $trigger_and_auth_dependency_fixture$
BEGIN
  BEGIN
    DROP TRIGGER g014_privacy_audit_events_append_only
      ON privacy_retention.privacy_audit_events;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'append-only trigger drift was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'append-only trigger drift was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;

  BEGIN
    ALTER TABLE privacy_retention.privacy_onboarding_compensation_holds
      ADD CONSTRAINT g014_catalog_contract_unexpected_auth_fk
      FOREIGN KEY (user_id) REFERENCES auth.users(id) NOT VALID;
    PERFORM privacy_retention.assert_g014_catalog_contract();
    RAISE EXCEPTION 'unexpected retained auth.users dependency was accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = 'unexpected retained auth.users dependency was accepted' OR SQLERRM NOT LIKE 'G014%' THEN
      RAISE;
    END IF;
  END;
END;
$trigger_and_auth_dependency_fixture$;

-- Reapplying the additive promotion gate must not change protected catalog
-- shape or immutable audit row bytes.
CREATE TEMPORARY TABLE pg_temp.g014_catalog_contract_snapshot AS
SELECT
  (SELECT pg_catalog.md5(pg_catalog.string_agg(
    namespace.nspname || '.' || relation_row.relname || ':' || relation_row.relowner::text || ':'
      || relation_row.relrowsecurity::text || ':' || relation_row.relforcerowsecurity::text,
    E'\n' ORDER BY namespace.nspname, relation_row.relname
  ))
   FROM pg_catalog.pg_class AS relation_row
   JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation_row.relnamespace
   WHERE namespace.nspname IN ('public', 'privacy_retention')
     AND relation_row.relkind IN ('r', 'p', 'v')) AS relation_hash,
  (SELECT pg_catalog.md5(pg_catalog.string_agg(
    procedure.oid::regprocedure::text || ':' || procedure.proowner::text || ':'
      || procedure.prosecdef::text || ':' || COALESCE(pg_catalog.array_to_string(procedure.proconfig, ','), ''),
    E'\n' ORDER BY procedure.oid::regprocedure::text
  ))
   FROM pg_catalog.pg_proc AS procedure
   JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname IN ('public', 'privacy_retention')) AS function_hash,
  (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
    id::text || ':' || event_type || ':' || operation_id::text || ':' || occurred_at::text || ':' || retention_until::text,
    E'\n' ORDER BY id
  ), '')) FROM privacy_retention.privacy_audit_events) AS privacy_audit_hash,
  (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
    id::text || ':' || action || ':' || created_at::text,
    E'\n' ORDER BY id
  ), '')) FROM public.admin_audit_events) AS admin_audit_hash;

\ir ../migrations/20260713002500_g014_catalog_contract.sql

DO $repeat_determinism$
DECLARE
  v_before pg_temp.g014_catalog_contract_snapshot%ROWTYPE;
  v_after pg_temp.g014_catalog_contract_snapshot%ROWTYPE;
BEGIN
  SELECT * INTO v_before FROM pg_temp.g014_catalog_contract_snapshot;
  SELECT
    (SELECT pg_catalog.md5(pg_catalog.string_agg(
      namespace.nspname || '.' || relation_row.relname || ':' || relation_row.relowner::text || ':'
        || relation_row.relrowsecurity::text || ':' || relation_row.relforcerowsecurity::text,
      E'\n' ORDER BY namespace.nspname, relation_row.relname
    ))
     FROM pg_catalog.pg_class AS relation_row
     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation_row.relnamespace
     WHERE namespace.nspname IN ('public', 'privacy_retention')
       AND relation_row.relkind IN ('r', 'p', 'v')),
    (SELECT pg_catalog.md5(pg_catalog.string_agg(
      procedure.oid::regprocedure::text || ':' || procedure.proowner::text || ':'
        || procedure.prosecdef::text || ':' || COALESCE(pg_catalog.array_to_string(procedure.proconfig, ','), ''),
      E'\n' ORDER BY procedure.oid::regprocedure::text
    ))
     FROM pg_catalog.pg_proc AS procedure
     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname IN ('public', 'privacy_retention')),
    (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
      id::text || ':' || event_type || ':' || operation_id::text || ':' || occurred_at::text || ':' || retention_until::text,
      E'\n' ORDER BY id
    ), '')) FROM privacy_retention.privacy_audit_events),
    (SELECT pg_catalog.md5(COALESCE(pg_catalog.string_agg(
      id::text || ':' || action || ':' || created_at::text,
      E'\n' ORDER BY id
    ), '')) FROM public.admin_audit_events)
  INTO v_after;
  IF v_after IS DISTINCT FROM v_before THEN
    RAISE EXCEPTION 'G014 catalog promotion gate is not repeat-deterministic';
  END IF;
END;
$repeat_determinism$;

ROLLBACK;
