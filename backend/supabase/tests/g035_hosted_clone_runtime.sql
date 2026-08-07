\set ON_ERROR_STOP on

-- Clone-only verification.  This script reads catalog metadata only, creates no
-- fixtures, emits no subject rows, and always rolls back its read-only transaction.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '5000ms';
SET LOCAL lock_timeout = '1000ms';
SET LOCAL idle_in_transaction_session_timeout = '5000ms';

DO $g035_clone_contract$
DECLARE
  target oid;
  public_execute boolean;
  remediation_violation boolean := false;
BEGIN
  -- Approval RPC must have its exact identity signature and no public/client grant.
  target := pg_catalog.to_regprocedure(
    'public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamp with time zone,timestamp with time zone)'
  );
  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(procedure_row.proacl, pg_catalog.acldefault('f', procedure_row.proowner))
      ) AS privilege_row
     WHERE procedure_row.oid = target
       AND privilege_row.grantee = 0
       AND privilege_row.privilege_type = 'EXECUTE'
  ) INTO public_execute;
  IF target IS NULL
     OR public_execute
     OR pg_catalog.has_function_privilege('anon', target, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', target, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', target, 'EXECUTE') THEN
    RAISE EXCEPTION 'G035 clone approval RPC signature or grant contract failed';
  END IF;

  -- G010 privacy onboarding and consent APIs retain their deliberately narrow grants.
  target := pg_catalog.to_regprocedure('public.submit_privacy_consent(text,text,text,uuid,text,text,uuid,text,uuid)');
  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(procedure_row.proacl, pg_catalog.acldefault('f', procedure_row.proowner))
      ) AS privilege_row
     WHERE procedure_row.oid = target
       AND privilege_row.grantee = 0
       AND privilege_row.privilege_type = 'EXECUTE'
  ) INTO public_execute;
  IF target IS NULL
     OR public_execute
     OR pg_catalog.has_function_privilege('anon', target, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', target, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', target, 'EXECUTE') THEN
    RAISE EXCEPTION 'G035 clone G010 consent fail-closed grant contract failed';
  END IF;

  target := pg_catalog.to_regprocedure('public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text)');
  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(procedure_row.proacl, pg_catalog.acldefault('f', procedure_row.proowner))
      ) AS privilege_row
     WHERE procedure_row.oid = target
       AND privilege_row.grantee = 0
       AND privilege_row.privilege_type = 'EXECUTE'
  ) INTO public_execute;
  IF target IS NULL
     OR public_execute
     OR pg_catalog.has_function_privilege('anon', target, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', target, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', target, 'EXECUTE') THEN
    RAISE EXCEPTION 'G035 clone G010 onboarding fail-closed grant contract failed';
  END IF;

  -- G013 short-url allocation is privileged only; no direct public/client execution.
  target := pg_catalog.to_regprocedure('public.allocate_short_url(text,uuid,uuid,text,text[])');
  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(procedure_row.proacl, pg_catalog.acldefault('f', procedure_row.proowner))
      ) AS privilege_row
     WHERE procedure_row.oid = target
       AND privilege_row.grantee = 0
       AND privilege_row.privilege_type = 'EXECUTE'
  ) INTO public_execute;
  IF target IS NULL
     OR public_execute
     OR pg_catalog.has_function_privilege('anon', target, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', target, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', target, 'EXECUTE') THEN
    RAISE EXCEPTION 'G035 clone G013 short-url fail-closed grant contract failed';
  END IF;

  -- G014 apply is service-only and the approval activation RPC is separated.
  target := pg_catalog.to_regprocedure('public.apply_privacy_retention_run(uuid,text,text,integer)');
  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(procedure_row.proacl, pg_catalog.acldefault('f', procedure_row.proowner))
      ) AS privilege_row
     WHERE procedure_row.oid = target
       AND privilege_row.grantee = 0
       AND privilege_row.privilege_type = 'EXECUTE'
  ) INTO public_execute;
  IF target IS NULL
     OR public_execute
     OR pg_catalog.has_function_privilege('anon', target, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', target, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', target, 'EXECUTE') THEN
    RAISE EXCEPTION 'G035 clone G014 apply fail-closed grant contract failed';
  END IF;

  target := pg_catalog.to_regprocedure('public.activate_privacy_retention_adapter(text,text,text,text,text,text,interval,text,text,text)');
  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(procedure_row.proacl, pg_catalog.acldefault('f', procedure_row.proowner))
      ) AS privilege_row
     WHERE procedure_row.oid = target
       AND privilege_row.grantee = 0
       AND privilege_row.privilege_type = 'EXECUTE'
  ) INTO public_execute;
  IF target IS NULL
     OR public_execute
     OR pg_catalog.has_function_privilege('anon', target, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', target, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', target, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('privacy_retention_activation_operator', target, 'EXECUTE') THEN
    RAISE EXCEPTION 'G035 clone G014 approval separation contract failed';
  END IF;

  -- Protected approval receipts remain private, owner-controlled, and forced-RLS.
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation_row
      JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace
      JOIN pg_catalog.pg_roles AS owner_role ON owner_role.oid = relation_row.relowner
     WHERE namespace_row.nspname = 'privacy_retention'
       AND relation_row.relname = 'tzuyang_address_evidence_admin_approval_receipts'
       AND relation_row.relkind = 'r'
       AND relation_row.relrowsecurity
       AND relation_row.relforcerowsecurity
       AND owner_role.rolname = 'privacy_workflow_owner'
  ) OR pg_catalog.has_table_privilege('service_role',
       'privacy_retention.tzuyang_address_evidence_admin_approval_receipts', 'INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'G035 clone approval receipt fail-closed relation contract failed';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = 'public.short_urls'::regclass
       AND constraint_row.contype = 'u'
       AND pg_catalog.pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (target_url)'
  ) OR EXISTS (SELECT 1 FROM public.short_urls GROUP BY target_url HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'G035 short-url target uniqueness contract failed';
  END IF;
  IF pg_catalog.to_regclass('g035_recovery_control.short_url_duplicate_quarantine') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.short_urls AS active JOIN g035_recovery_control.short_url_duplicate_quarantine AS quarantined ON quarantined.id = active.id)' INTO remediation_violation;
    IF remediation_violation THEN
      RAISE EXCEPTION 'G035 remediation active/quarantine overlap';
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_namespace AS namespace_row
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(namespace_row.nspacl, pg_catalog.acldefault('n', namespace_row.nspowner))) AS privilege_row
     WHERE namespace_row.nspname = 'g035_recovery_control'
       AND privilege_row.grantee IN (0, (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon'), (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'), (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role'))
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation_row
      JOIN pg_catalog.pg_namespace AS namespace_row ON namespace_row.oid = relation_row.relnamespace
      CROSS JOIN LATERAL pg_catalog.aclexplode(COALESCE(relation_row.relacl, pg_catalog.acldefault('r', relation_row.relowner))) AS privilege_row
     WHERE namespace_row.nspname = 'g035_recovery_control'
       AND relation_row.relkind IN ('r','S')
       AND privilege_row.grantee IN (0, (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'anon'), (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'authenticated'), (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'service_role'))
  ) THEN
    RAISE EXCEPTION 'G035 remediation quarantine grant contract failed';
  END IF;
END;
$g035_clone_contract$;

ROLLBACK;
