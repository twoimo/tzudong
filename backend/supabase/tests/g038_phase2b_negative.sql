\set ON_ERROR_STOP on
\pset pager off
\pset footer off
\pset format unaligned
\pset tuples_only on
SET client_min_messages = warning;
BEGIN ISOLATION LEVEL READ COMMITTED;
SET LOCAL client_min_messages = warning;

DO $invalid_phase$
DECLARE
  before_c bigint;
  before_r bigint;
  after_c bigint;
  after_r bigint;
  got_state text;
  got_message text;
BEGIN
  SELECT count(*) INTO before_c FROM public.g038_deletion_commitment;
  SELECT count(*) INTO before_r FROM public.g038_deletion_route;
  BEGIN
    PERFORM public.g038_reserve_account_deletion_commitment(
      'INVALID'::text,
      '00000000-0000-0000-0000-000000000101'::uuid,
      '00000000-0000-0000-0000-000000000102'::uuid,
      '00000000-0000-0000-0000-000000000103'::uuid,
      '00000000-0000-0000-0000-000000000104'::uuid,
      '00000000-0000-0000-0000-000000000105'::uuid,
      '00000000-0000-0000-0000-000000000106'::uuid,
      'preview'::text, 'confirm'::text, 'idem'::text, 'manifest'::text,
      decode(repeat('11', 32), 'hex'), decode(repeat('12', 32), 'hex'), decode(repeat('13', 32), 'hex'), decode(repeat('14', 32), 'hex'), decode(repeat('15', 32), 'hex'),
      '00000000-0000-0000-0000-000000000107'::uuid, decode(repeat('16', 32), 'hex'),
      NULL::uuid, NULL::uuid, NULL::timestamptz, NULL::uuid, NULL::bytea, NULL::uuid, NULL::bytea, NULL::uuid, NULL::bytea, NULL::uuid, NULL::bytea, NULL::smallint, NULL::bytea, NULL::text, NULL::text, NULL::text, NULL::bytea, NULL::bytea, NULL::bytea, NULL::bytea, NULL::bytea
    );
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'g038_expected_error_not_raised';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS got_state = RETURNED_SQLSTATE, got_message = MESSAGE_TEXT;
  END;
  RESET ROLE;
  SELECT count(*) INTO after_c FROM public.g038_deletion_commitment;
  SELECT count(*) INTO after_r FROM public.g038_deletion_route;
  IF got_state IS DISTINCT FROM '22023' OR got_message IS DISTINCT FROM 'g038_invalid_phase'
     OR after_c IS DISTINCT FROM before_c OR after_r IS DISTINCT FROM before_r THEN
    RAISE EXCEPTION 'g038_phase2b_case_failed';
  END IF;
END $invalid_phase$;
SELECT 'PASS|INVALID_PHASE|22023|g038_invalid_phase|0|0';

DO $candidate_identifier$
DECLARE
  before_c bigint;
  before_r bigint;
  after_c bigint;
  after_r bigint;
  got_state text;
  got_message text;
BEGIN
  SELECT count(*) INTO before_c FROM public.g038_deletion_commitment;
  SELECT count(*) INTO before_r FROM public.g038_deletion_route;
  BEGIN
    PERFORM public.g038_reserve_account_deletion_commitment(
      'CREATE'::text,
      '00000000-0000-0000-0000-000000000201'::uuid,
      '00000000-0000-0000-0000-000000000202'::uuid,
      '00000000-0000-0000-0000-000000000203'::uuid,
      '00000000-0000-0000-0000-000000000204'::uuid,
      '00000000-0000-0000-0000-000000000205'::uuid,
      '00000000-0000-0000-0000-000000000206'::uuid,
      'preview'::text, 'confirm'::text, 'idem'::text, 'manifest'::text,
      decode(repeat('21', 32), 'hex'), decode(repeat('22', 32), 'hex'), decode(repeat('23', 32), 'hex'), decode(repeat('24', 32), 'hex'), decode(repeat('25', 32), 'hex'),
      '00000000-0000-0000-0000-000000000207'::uuid, decode(repeat('26', 32), 'hex'),
      '00000000-0000-0000-0000-000000000000'::uuid,
      '00000000-0000-0000-0000-000000000210'::uuid,
      TIMESTAMPTZ '2099-01-01 00:00:00+00',
      '00000000-0000-0000-0000-000000000211'::uuid, decode(repeat('27', 32), 'hex'),
      '00000000-0000-0000-0000-000000000212'::uuid, decode(repeat('28', 32), 'hex'),
      '00000000-0000-0000-0000-000000000213'::uuid, decode(repeat('29', 32), 'hex'),
      '00000000-0000-0000-0000-000000000214'::uuid, decode(repeat('30', 32), 'hex'),
      200::smallint, decode(repeat('31', 32), 'hex'),
      'G038-PREFLIGHT-REPLAY-CIPHERTEXT-V1'::text,
      'g038_preflight_replay_aead_v1'::text,
      'AES-256-GCM'::text,
      decode(repeat('32', 12), 'hex'), decode('aa', 'hex'), pg_catalog.sha256(decode('aa', 'hex')), decode('bb', 'hex'), decode(repeat('33', 16), 'hex')
    );
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'g038_expected_error_not_raised';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS got_state = RETURNED_SQLSTATE, got_message = MESSAGE_TEXT;
  END;
  RESET ROLE;
  SELECT count(*) INTO after_c FROM public.g038_deletion_commitment;
  SELECT count(*) INTO after_r FROM public.g038_deletion_route;
  IF got_state IS DISTINCT FROM '22023' OR got_message IS DISTINCT FROM 'g038_candidate_identifier_invalid'
     OR after_c IS DISTINCT FROM before_c OR after_r IS DISTINCT FROM before_r THEN
    RAISE EXCEPTION 'g038_phase2b_case_failed';
  END IF;
END $candidate_identifier$;
SELECT 'PASS|CANDIDATE_IDENTIFIER|22023|g038_candidate_identifier_invalid|0|0';

DO $adapter_direct_dml$
DECLARE
  before_c bigint;
  before_r bigint;
  after_c bigint;
  after_r bigint;
  got_state text;
  got_message text;
BEGIN
  SELECT count(*) INTO before_c FROM public.g038_deletion_commitment;
  SELECT count(*) INTO before_r FROM public.g038_deletion_route;
  BEGIN
    EXECUTE 'SET LOCAL ROLE g038_route_adapter';
    EXECUTE 'INSERT INTO public.g038_deletion_commitment (commitment_id) VALUES (''00000000-0000-0000-0000-000000000301''::uuid)';
    RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'g038_expected_error_not_raised';
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS got_state = RETURNED_SQLSTATE, got_message = MESSAGE_TEXT;
  END;
  RESET ROLE;
  SELECT count(*) INTO after_c FROM public.g038_deletion_commitment;
  SELECT count(*) INTO after_r FROM public.g038_deletion_route;
  IF got_state IS DISTINCT FROM '42501' OR got_message IS DISTINCT FROM 'permission denied for table g038_deletion_commitment'
     OR after_c IS DISTINCT FROM before_c OR after_r IS DISTINCT FROM before_r THEN
    RAISE EXCEPTION 'g038_phase2b_case_failed';
  END IF;
END $adapter_direct_dml$;
SELECT 'PASS|ADAPTER_DIRECT_DML|42501|permission denied for table g038_deletion_commitment|0|0';
COMMIT;
