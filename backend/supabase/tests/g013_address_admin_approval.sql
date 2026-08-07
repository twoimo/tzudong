-- G013 address-evidence admin approval replay boundary. Run in a disposable migrated database.
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('13131313-1313-4313-8313-131313131301', 'authenticated', 'authenticated', 'g013-address-admin@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('13131313-1313-4313-8313-131313131302', 'authenticated', 'authenticated', 'g013-address-other-admin@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('13131313-1313-4313-8313-131313131303', 'authenticated', 'authenticated', 'g013-address-user@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());
INSERT INTO public.user_roles (user_id, role) VALUES
  ('13131313-1313-4313-8313-131313131301', 'admin'),
  ('13131313-1313-4313-8313-131313131302', 'admin');
INSERT INTO public.user_account_status (user_id, account_status) VALUES
  ('13131313-1313-4313-8313-131313131301', 'active'),
  ('13131313-1313-4313-8313-131313131302', 'active'),
  ('13131313-1313-4313-8313-131313131303', 'active');

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);

DO $approval_replay$
DECLARE
  v_admin uuid := '13131313-1313-4313-8313-131313131301';
  v_other_admin uuid := '13131313-1313-4313-8313-131313131302';
  v_user uuid := '13131313-1313-4313-8313-131313131303';
  v_operation uuid := '13131313-1313-4313-8313-131313131311';
  v_issued_at timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp() - interval '1 minute');
  v_expires_at timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp() + interval '10 minutes');
  v_result record;
BEGIN
  SELECT * INTO v_result
    FROM public.consume_tzuyang_address_evidence_admin_approval(
      v_operation,
      repeat('a', 64),
      repeat('b', 64),
      v_admin,
      repeat('c', 64),
      'g013.address.approval-signer:1',
      'apply_tzuyang_address_evidence_ledger',
      v_issued_at,
      v_expires_at
    );
  IF v_result.consumed IS DISTINCT FROM true OR v_result.reason <> 'consumed' THEN
    RAISE EXCEPTION 'G013 address approval first consume did not succeed';
  END IF;

  SELECT * INTO v_result
    FROM public.consume_tzuyang_address_evidence_admin_approval(
      v_operation,
      repeat('a', 64),
      repeat('b', 64),
      v_admin,
      repeat('c', 64),
      'g013.address.approval-signer:1',
      'apply_tzuyang_address_evidence_ledger',
      v_issued_at,
      v_expires_at
    );
  IF v_result.consumed IS DISTINCT FROM false OR v_result.reason <> 'replayed' THEN
    RAISE EXCEPTION 'G013 identical address approval replay did not return replayed';
  END IF;

  BEGIN
    PERFORM * FROM public.consume_tzuyang_address_evidence_admin_approval(
      v_operation, repeat('a', 64), repeat('b', 64), v_other_admin, repeat('c', 64),
      'g013.address.approval-signer:1', 'apply_tzuyang_address_evidence_ledger', v_issued_at, v_expires_at
    );
    RAISE EXCEPTION 'G013 cross-actor approval replay unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'tzuyang_address_admin_approval_binding_conflict' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM public.consume_tzuyang_address_evidence_admin_approval(
      v_operation, repeat('a', 64), repeat('b', 64), v_admin, repeat('d', 64),
      'g013.address.approval-signer:1', 'apply_tzuyang_address_evidence_ledger', v_issued_at, v_expires_at
    );
    RAISE EXCEPTION 'G013 cross-manifest approval replay unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'tzuyang_address_admin_approval_binding_conflict' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM public.consume_tzuyang_address_evidence_admin_approval(
      v_operation, repeat('a', 64), repeat('b', 64), v_admin, repeat('c', 64),
      'g013.address.approval-signer:2', 'apply_tzuyang_address_evidence_ledger', v_issued_at, v_expires_at
    );
    RAISE EXCEPTION 'G013 cross-signer approval replay unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'tzuyang_address_admin_approval_binding_conflict' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM public.consume_tzuyang_address_evidence_admin_approval(
      v_operation, repeat('a', 64), repeat('b', 64), v_admin, repeat('c', 64),
      'g013.address.approval-signer:1', 'not_the_signed_action', v_issued_at, v_expires_at
    );
    RAISE EXCEPTION 'G013 cross-action approval replay unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'tzuyang_address_admin_approval_request_invalid' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM public.consume_tzuyang_address_evidence_admin_approval(
      v_operation, repeat('a', 64), repeat('b', 64), v_admin, repeat('c', 64),
      'g013.address.approval-signer:1', 'apply_tzuyang_address_evidence_ledger', v_issued_at - interval '1 second', v_expires_at
    );
    RAISE EXCEPTION 'G013 cross-time approval replay unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'tzuyang_address_admin_approval_binding_conflict' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM public.consume_tzuyang_address_evidence_admin_approval(
      v_operation, repeat('d', 64), repeat('b', 64), v_admin, repeat('c', 64),
      'g013.address.approval-signer:1', 'apply_tzuyang_address_evidence_ledger', v_issued_at, v_expires_at
    );
    RAISE EXCEPTION 'G013 cross-envelope-hash approval replay unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'tzuyang_address_admin_approval_binding_conflict' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM public.consume_tzuyang_address_evidence_admin_approval(
      v_operation, repeat('a', 64), repeat('d', 64), v_admin, repeat('c', 64),
      'g013.address.approval-signer:1', 'apply_tzuyang_address_evidence_ledger', v_issued_at, v_expires_at
    );
    RAISE EXCEPTION 'G013 cross-nonce-hash approval replay unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'tzuyang_address_admin_approval_binding_conflict' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM public.consume_tzuyang_address_evidence_admin_approval(
      '13131313-1313-4313-8313-131313131312', repeat('e', 64), repeat('b', 64), v_admin, repeat('c', 64),
      'g013.address.approval-signer:1', 'apply_tzuyang_address_evidence_ledger', v_issued_at, v_expires_at
    );
    RAISE EXCEPTION 'G013 nonce collision unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'tzuyang_address_admin_approval_binding_conflict' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM public.consume_tzuyang_address_evidence_admin_approval(
      '13131313-1313-4313-8313-131313131313', repeat('a', 64), repeat('e', 64), v_admin, repeat('c', 64),
      'g013.address.approval-signer:1', 'apply_tzuyang_address_evidence_ledger', v_issued_at, v_expires_at
    );
    RAISE EXCEPTION 'G013 envelope-hash collision unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'tzuyang_address_admin_approval_binding_conflict' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM public.consume_tzuyang_address_evidence_admin_approval(
      '13131313-1313-4313-8313-131313131314', repeat('e', 64), repeat('f', 64), v_user, repeat('c', 64),
      'g013.address.approval-signer:1', 'apply_tzuyang_address_evidence_ledger', v_issued_at, v_expires_at
    );
    RAISE EXCEPTION 'G013 non-admin approval consumption unexpectedly succeeded';
  EXCEPTION WHEN insufficient_privilege THEN
    IF SQLERRM <> 'tzuyang_address_admin_approval_actor_forbidden' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM public.consume_tzuyang_address_evidence_admin_approval(
      '13131313-1313-4313-8313-131313131315', repeat('e', 64), repeat('f', 64), v_admin, repeat('c', 64),
      'g013.address.approval-signer:1', 'apply_tzuyang_address_evidence_ledger', v_issued_at - interval '2 minutes', v_issued_at - interval '1 minute'
    );
    RAISE EXCEPTION 'G013 expired approval consumption unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'tzuyang_address_admin_approval_request_invalid' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM * FROM public.consume_tzuyang_address_evidence_admin_approval(
      '13131313-1313-4313-8313-131313131316', repeat('e', 64), repeat('f', 64), v_admin, repeat('c', 64),
      'g013.address.approval-signer:1', 'apply_tzuyang_address_evidence_ledger', v_expires_at, v_expires_at + interval '1 minute'
    );
    RAISE EXCEPTION 'G013 not-yet-valid approval consumption unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '22023' THEN
    IF SQLERRM <> 'tzuyang_address_admin_approval_request_invalid' THEN RAISE; END IF;
  END;

END;
$approval_replay$;

DO $service_dml$
DECLARE
  v_statement text;
BEGIN
  FOREACH v_statement IN ARRAY ARRAY[
    'INSERT INTO privacy_retention.tzuyang_address_evidence_admin_approval_receipts DEFAULT VALUES',
    'UPDATE privacy_retention.tzuyang_address_evidence_admin_approval_receipts SET signer_id = signer_id WHERE false',
    'DELETE FROM privacy_retention.tzuyang_address_evidence_admin_approval_receipts WHERE false',
    'TRUNCATE TABLE privacy_retention.tzuyang_address_evidence_admin_approval_receipts'
  ] LOOP
    BEGIN
      EXECUTE v_statement;
      RAISE EXCEPTION 'G013 service_role unexpectedly issued direct receipt DML: %', v_statement;
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
  END LOOP;
END;
$service_dml$;

RESET ROLE;
SELECT pg_catalog.set_config('request.jwt.claims', '', true);
DO $database_apply_identity$
DECLARE
  v_result record;
BEGIN
  SELECT * INTO v_result
    FROM public.consume_tzuyang_address_evidence_admin_approval(
      '13131313-1313-4313-8313-131313131318',
      repeat('d', 64),
      repeat('e', 64),
      '13131313-1313-4313-8313-131313131301',
      repeat('c', 64),
      'g013.address.approval-signer:1',
      'apply_tzuyang_address_evidence_ledger',
      pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp() - interval '1 minute'),
      pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp() + interval '1 minute')
    );
  IF v_result.consumed IS DISTINCT FROM true OR v_result.reason <> 'consumed' THEN
    RAISE EXCEPTION 'G013 database apply identity did not consume approval';
  END IF;
END;
$database_apply_identity$;

SET LOCAL ROLE authenticated;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"authenticated"}', true);
DO $authenticated_execute$
BEGIN
  BEGIN
    PERFORM * FROM public.consume_tzuyang_address_evidence_admin_approval(
      '13131313-1313-4313-8313-131313131317', repeat('e', 64), repeat('f', 64),
      '13131313-1313-4313-8313-131313131301', repeat('c', 64),
      'g013.address.approval-signer:1', 'apply_tzuyang_address_evidence_ledger',
      pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp() - interval '1 minute'),
      pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp() + interval '1 minute')
    );
    RAISE EXCEPTION 'G013 authenticated unexpectedly executed approval consumption';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END;
$authenticated_execute$;
RESET ROLE;

SET LOCAL ROLE privacy_workflow_owner;
DO $append_only$
DECLARE
  v_before_receipt_count bigint;
  v_before_envelope_hashes text[];
  v_before_nonce_hashes text[];
  v_after_receipt_count bigint;
  v_after_envelope_hashes text[];
  v_after_nonce_hashes text[];
BEGIN
  SELECT count(*),
         array_agg(approval_envelope_sha256 ORDER BY operation_id),
         array_agg(nonce_sha256 ORDER BY operation_id)
    INTO v_before_receipt_count,
         v_before_envelope_hashes,
         v_before_nonce_hashes
    FROM privacy_retention.tzuyang_address_evidence_admin_approval_receipts;

  BEGIN
    UPDATE privacy_retention.tzuyang_address_evidence_admin_approval_receipts
       SET signer_id = signer_id
     WHERE operation_id = '13131313-1313-4313-8313-131313131311';
    RAISE EXCEPTION 'G013 immutable approval receipt unexpectedly updated';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM <> 'tzuyang_address_evidence_admin_approval_receipt_immutable' THEN RAISE; END IF;
  END;

  BEGIN
    DELETE FROM privacy_retention.tzuyang_address_evidence_admin_approval_receipts
     WHERE operation_id = '13131313-1313-4313-8313-131313131311';
    RAISE EXCEPTION 'G013 immutable approval receipt unexpectedly deleted';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM <> 'tzuyang_address_evidence_admin_approval_receipt_immutable' THEN RAISE; END IF;
  END;

  BEGIN
    TRUNCATE TABLE privacy_retention.tzuyang_address_evidence_admin_approval_receipts;
    RAISE EXCEPTION 'G013 immutable approval receipt unexpectedly truncated';
  EXCEPTION WHEN SQLSTATE '55000' THEN
    IF SQLERRM <> 'tzuyang_address_evidence_admin_approval_receipt_immutable' THEN RAISE; END IF;
  END;

  SELECT count(*),
         array_agg(approval_envelope_sha256 ORDER BY operation_id),
         array_agg(nonce_sha256 ORDER BY operation_id)
    INTO v_after_receipt_count,
         v_after_envelope_hashes,
         v_after_nonce_hashes
    FROM privacy_retention.tzuyang_address_evidence_admin_approval_receipts;

  IF v_after_receipt_count IS DISTINCT FROM v_before_receipt_count
     OR v_after_envelope_hashes IS DISTINCT FROM v_before_envelope_hashes
     OR v_after_nonce_hashes IS DISTINCT FROM v_before_nonce_hashes THEN
    RAISE EXCEPTION 'G013 immutable approval receipt rows or hashes changed after rejected truncate';
  END IF;
END;
$append_only$;
RESET ROLE;

DO $catalog_contract$
DECLARE
  v_procedure record;
  v_search_path text;
BEGIN
  IF (
    SELECT count(*)
      FROM privacy_retention.tzuyang_address_evidence_admin_approval_receipts
     WHERE operation_id = '13131313-1313-4313-8313-131313131311'
  ) <> 1 THEN
    RAISE EXCEPTION 'G013 address approval operation was consumed more than once';
  END IF;
  SELECT procedure.prosecdef,
         pg_catalog.pg_get_userbyid(procedure.proowner) AS owner_name,
         procedure.proconfig
    INTO v_procedure
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid = 'public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamptz,timestamptz)'::regprocedure;
  IF NOT FOUND
     OR NOT v_procedure.prosecdef
     OR v_procedure.owner_name <> 'privacy_workflow_owner' THEN
    RAISE EXCEPTION 'G013 approval RPC owner or SECURITY DEFINER contract is incorrect';
  END IF;

  SELECT setting.value INTO v_search_path
    FROM pg_catalog.unnest(v_procedure.proconfig) AS setting(value)
   WHERE setting.value LIKE 'search_path=%';
  IF v_search_path IS DISTINCT FROM 'search_path=' AND v_search_path IS DISTINCT FROM 'search_path=""' THEN
    RAISE EXCEPTION 'G013 approval RPC search_path is not empty';
  END IF;

  IF pg_catalog.has_function_privilege('anon', 'public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamptz,timestamptz)'::regprocedure, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', 'public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamptz,timestamptz)'::regprocedure, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamptz,timestamptz)'::regprocedure, 'EXECUTE')
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS procedure
         CROSS JOIN LATERAL pg_catalog.aclexplode(
           COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
         ) AS acl
        WHERE procedure.oid = 'public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamptz,timestamptz)'::regprocedure
          AND acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'G013 approval RPC grant matrix is incorrect';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'privacy_retention.tzuyang_address_evidence_admin_approval_receipts'::regclass
       AND pg_catalog.pg_get_userbyid(relation.relowner) = 'privacy_workflow_owner'
       AND relation.relrowsecurity
       AND relation.relforcerowsecurity
  ) OR pg_catalog.has_schema_privilege('service_role', 'privacy_retention', 'USAGE')
    OR pg_catalog.has_table_privilege('service_role', 'privacy_retention.tzuyang_address_evidence_admin_approval_receipts', 'INSERT,UPDATE,DELETE,TRUNCATE') THEN
    RAISE EXCEPTION 'G013 approval receipt private-table contract is incorrect';
  END IF;

  IF position(
       'pg_advisory_xact_lock' IN pg_catalog.pg_get_functiondef(
         'public.consume_tzuyang_address_evidence_admin_approval(uuid,text,text,uuid,text,text,text,timestamptz,timestamptz)'::regprocedure
       )
     ) = 0
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'privacy_retention.tzuyang_address_evidence_admin_approval_receipts'::regclass
          AND constraint_row.contype = 'p'
          AND pg_catalog.pg_get_constraintdef(constraint_row.oid) = 'PRIMARY KEY (operation_id)'
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'privacy_retention.tzuyang_address_evidence_admin_approval_receipts'::regclass
          AND constraint_row.contype = 'u'
          AND pg_catalog.pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (approval_envelope_sha256)'
     )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = 'privacy_retention.tzuyang_address_evidence_admin_approval_receipts'::regclass
          AND constraint_row.contype = 'u'
          AND pg_catalog.pg_get_constraintdef(constraint_row.oid) = 'UNIQUE (nonce_sha256)'
     ) THEN
    RAISE EXCEPTION 'G013 approval consume lacks its one-winner concurrency fence';
  END IF;
END;
$catalog_contract$;

ROLLBACK;
