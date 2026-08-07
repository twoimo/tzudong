-- G028 database contract tests. Run after G014 and 20260713002700_g028_account_deletion_reauth_proof.sql.
-- Uses transaction-local JWT claims and rolls all fixtures back.

BEGIN;

DO $function$
DECLARE
  v_user_id uuid := '11111111-1111-4111-8111-111111111111';
  v_other_user_id uuid := '12121212-1212-4212-8212-121212121212';
  v_session_id uuid := '22222222-2222-4222-8222-222222222222';
  v_other_session_id uuid := '33333333-3333-4333-8333-333333333333';
  v_second_other_session_id uuid := '34343434-3434-4434-8434-343434343434';
  v_proof_id uuid;
  v_expired_proof_id uuid;
  v_replay_proof_id uuid;
  v_now_epoch bigint := extract(epoch FROM pg_catalog.clock_timestamp())::bigint;
  v_claims text;
BEGIN
  -- The current password AMR is intentionally not the array tail.
  v_claims := jsonb_build_object(
    'role', 'authenticated',
    'sub', v_user_id::text,
    'session_id', v_session_id::text,
    'iat', v_now_epoch - 1,
    'exp', v_now_epoch + 600,
    'amr', jsonb_build_array(
      jsonb_build_object('method', 'password', 'timestamp', v_now_epoch - 1),
      jsonb_build_object('method', 'otp', 'timestamp', v_now_epoch),
      jsonb_build_object('method', 'password', 'timestamp', v_now_epoch - 301)
    )
  )::text;
  PERFORM pg_catalog.set_config('request.jwt.claims', v_claims, true);
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'authenticated', true);

  SELECT issued.proof_id INTO v_proof_id
    FROM public.issue_account_deletion_reauth_proof(v_user_id) AS issued;
  IF v_proof_id IS NULL THEN
    RAISE EXCEPTION 'G028 did not accept a fresh password AMR before later AMR entries';
  END IF;

  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_set(v_claims::jsonb, '{session_id}', to_jsonb(v_other_session_id::text))::text,
    true
  );
  BEGIN
    PERFORM public.consume_account_deletion_reauth_proof(
      v_proof_id, v_user_id, '44444444-4444-4444-8444-444444444444', 'mismatch-session'
    );
    RAISE EXCEPTION 'G028 accepted a mismatched session';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'account_deletion_reauth_proof_not_available' THEN RAISE; END IF;
  END;
  PERFORM pg_catalog.set_config('request.jwt.claims', v_claims, true);
  -- A session mismatch must remain fail-closed even after a prior rejected attempt.
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_set(v_claims::jsonb, '{session_id}', to_jsonb(v_second_other_session_id::text))::text,
    true
  );
  BEGIN
    PERFORM public.consume_account_deletion_reauth_proof(
      v_proof_id, v_user_id, '45454545-4545-4545-8454-454545454545', 'second-mismatch-session'
    );
    RAISE EXCEPTION 'G028 accepted a second mismatched session';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'account_deletion_reauth_proof_not_available' THEN RAISE; END IF;
  END;
  PERFORM pg_catalog.set_config('request.jwt.claims', v_claims, true);

  -- A caller cannot bind a self-only proof to a different actor/target.
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_set(v_claims::jsonb, '{sub}', to_jsonb(v_other_user_id::text))::text,
    true
  );
  BEGIN
    PERFORM public.consume_account_deletion_reauth_proof(
      v_proof_id, v_other_user_id, '46464646-4646-4646-8464-464646464646', 'cross-user-target'
    );
    RAISE EXCEPTION 'G028 accepted a cross-user proof target';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'account_deletion_reauth_proof_not_available' THEN RAISE; END IF;
  END;
  PERFORM pg_catalog.set_config('request.jwt.claims', v_claims, true);

  SELECT issued.proof_id INTO v_expired_proof_id
    FROM public.issue_account_deletion_reauth_proof(v_user_id) AS issued;
  UPDATE account_deletion_private.reauth_proofs
     SET expires_at = issued_at + interval '1 microsecond'
   WHERE proof_id = v_expired_proof_id;
  BEGIN
    PERFORM public.consume_account_deletion_reauth_proof(
      v_expired_proof_id, v_user_id, '47474747-4747-4747-8474-474747474747', 'expired-proof'
    );
    RAISE EXCEPTION 'G028 accepted an expired proof';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'account_deletion_reauth_proof_not_available' THEN RAISE; END IF;
  END;

  -- A successfully consumed proof is one-time and cannot be replayed.
  SELECT issued.proof_id INTO v_replay_proof_id
    FROM public.issue_account_deletion_reauth_proof(v_user_id) AS issued;
  PERFORM public.consume_account_deletion_reauth_proof(
    v_replay_proof_id, v_user_id, '48484848-4848-4848-8484-484848484848', 'first-consume'
  );
  BEGIN
    PERFORM public.consume_account_deletion_reauth_proof(
      v_replay_proof_id, v_user_id, '49494949-4949-4949-8494-494949494949', 'replayed-consume'
    );
    RAISE EXCEPTION 'G028 accepted a replayed proof';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'account_deletion_reauth_proof_not_available' THEN RAISE; END IF;
  END;

  -- A failure after consume (missing auth.users compatibility timestamp) rolls back consumption.
  BEGIN
    PERFORM public.begin_account_deletion_apply_with_reauth(
      v_proof_id,
      v_user_id,
      v_user_id,
      '55555555-5555-4555-8555-555555555555',
      repeat('a', 64),
      'confirm',
      'delete-request-1',
      repeat('b', 64)
    );
    RAISE EXCEPTION 'G028 unexpectedly began a deletion without an auth user';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'account_deletion_reauthentication_required' THEN RAISE; END IF;
  END;
  IF EXISTS (
    SELECT 1 FROM account_deletion_private.reauth_proofs
     WHERE proof_id = v_proof_id AND consumed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'G028 consumed a proof when the atomic begin failed';
  END IF;
  -- Replaying a failed wrapper begin leaves the proof available rather than consuming it.
  BEGIN
    PERFORM public.begin_account_deletion_apply_with_reauth(
      v_proof_id,
      v_user_id,
      v_user_id,
      '56565656-5656-4656-8656-565656565656',
      repeat('a', 64),
      'confirm',
      'delete-request-2',
      repeat('b', 64)
    );
    RAISE EXCEPTION 'G028 unexpectedly replayed a deletion without an auth user';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'account_deletion_reauthentication_required' THEN RAISE; END IF;
  END;
  IF EXISTS (
    SELECT 1 FROM account_deletion_private.reauth_proofs
     WHERE proof_id = v_proof_id AND consumed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'G028 consumed a proof when a replayed atomic begin failed';
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claims', (v_claims::jsonb - 'session_id')::text, true);
  BEGIN
    PERFORM public.issue_account_deletion_reauth_proof(v_user_id);
    RAISE EXCEPTION 'G028 accepted missing session claims';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'account_deletion_reauth_proof_invalid_claims' THEN RAISE; END IF;
  END;

  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_set(v_claims::jsonb, '{amr}', jsonb_build_array(
      jsonb_build_object('method', 'password', 'timestamp', v_now_epoch - 301),
      jsonb_build_object('method', 'otp', 'timestamp', v_now_epoch)
    ))::text,
    true
  );
  BEGIN
    PERFORM public.issue_account_deletion_reauth_proof(v_user_id);
    RAISE EXCEPTION 'G028 accepted stale password reauthentication';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'account_deletion_reauth_proof_password_reauthentication_required' THEN RAISE; END IF;
  END;
  PERFORM pg_catalog.set_config(
    'request.jwt.claims',
    jsonb_set(v_claims::jsonb, '{role}', '"service_role"'::jsonb)::text,
    true
  );
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  BEGIN
    PERFORM public.issue_account_deletion_reauth_proof(v_user_id);
    RAISE EXCEPTION 'G028 accepted service_role proof issuance';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'account_deletion_reauth_proof_invalid_claims' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM public.begin_account_deletion_apply_with_reauth(
      v_proof_id,
      v_user_id,
      v_user_id,
      '66666666-6666-4666-8666-666666666666',
      repeat('a', 64),
      'confirm',
      'service-role-denial',
      repeat('b', 64)
    );
    RAISE EXCEPTION 'G028 accepted service_role deletion begin';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'account_deletion_reauth_proof_invalid_claims' THEN RAISE; END IF;
  END;
END;
$function$;

DO $function$
DECLARE
  v_consume_call_count integer;
  v_private_columns text[];
  v_atomic_definition text;
BEGIN
  IF has_schema_privilege('PUBLIC', 'account_deletion_private', 'USAGE')
     OR has_schema_privilege('anon', 'account_deletion_private', 'USAGE')
     OR has_schema_privilege('authenticated', 'account_deletion_private', 'USAGE')
     OR has_schema_privilege('service_role', 'account_deletion_private', 'USAGE')
     OR has_table_privilege('PUBLIC', 'account_deletion_private.reauth_proofs', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('anon', 'account_deletion_private.reauth_proofs', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('authenticated', 'account_deletion_private.reauth_proofs', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('service_role', 'account_deletion_private.reauth_proofs', 'SELECT, INSERT, UPDATE, DELETE')
     OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'account_deletion_private.reauth_proofs'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'account_deletion_private.reauth_proofs'::regclass)
     OR has_function_privilege('PUBLIC', 'public.begin_account_deletion_apply_with_reauth(uuid,uuid,uuid,uuid,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.begin_account_deletion_apply_with_reauth(uuid,uuid,uuid,uuid,text,text,text,text)', 'EXECUTE')
     OR has_function_privilege('service_role', 'public.begin_account_deletion_apply_with_reauth(uuid,uuid,uuid,uuid,text,text,text,text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.begin_account_deletion_apply_with_reauth(uuid,uuid,uuid,uuid,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'G028 grants or RLS expose a private proof path';
  END IF;

  SELECT array_agg(columns.column_name ORDER BY columns.ordinal_position)
    INTO v_private_columns
    FROM information_schema.columns AS columns
   WHERE columns.table_schema = 'account_deletion_private'
     AND columns.table_name = 'reauth_proofs';
  IF v_private_columns IS DISTINCT FROM ARRAY[
    'proof_id', 'actor_user_id', 'target_user_id', 'session_id', 'password_reauthenticated_at',
    'issued_at', 'expires_at', 'consumed_at', 'request_id', 'idempotency_key'
  ]::text[] THEN
    RAISE EXCEPTION 'G028 private proof table has an unexpected or secret-bearing column';
  END IF;

  SELECT pg_get_functiondef(
    'public.begin_account_deletion_apply_with_reauth(uuid,uuid,uuid,uuid,text,text,text,text)'::regprocedure
  ) INTO v_atomic_definition;
  v_consume_call_count := (
    length(v_atomic_definition) - length(replace(
      v_atomic_definition, 'public.consume_account_deletion_reauth_proof', ''
    ))
  ) / length('public.consume_account_deletion_reauth_proof');
  IF v_consume_call_count <> 1
     OR position('IF v_begin.status IS DISTINCT FROM ''APPLY_STARTED'' THEN' IN v_atomic_definition) = 0 THEN
    RAISE EXCEPTION 'G028 wrapper must consume exactly once and only restore proofs after a failed begin';
  END IF;
  IF position('public.consume_account_deletion_reauth_proof' IN v_atomic_definition) = 0
     OR position('public.begin_account_deletion_apply(' IN v_atomic_definition) = 0
     OR position('public.consume_account_deletion_reauth_proof' IN v_atomic_definition) > position('public.begin_account_deletion_apply(' IN v_atomic_definition)
     OR position('request.jwt.claim.role' IN v_atomic_definition) = 0
     OR position('v_last_sign_in_at' IN v_atomic_definition) = 0 THEN
    RAISE EXCEPTION 'G028 atomic begin does not preserve consume, G014, and compatibility bindings';
  END IF;
END;
$function$;

ROLLBACK;
