-- G028: one-time, session-bound password reauthentication proofs for self account deletion.

BEGIN;

CREATE SCHEMA IF NOT EXISTS account_deletion_private;
REVOKE ALL ON SCHEMA account_deletion_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE account_deletion_private.reauth_proofs (
  proof_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  session_id uuid NOT NULL,
  password_reauthenticated_at timestamptz NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  request_id uuid,
  idempotency_key text,
  CONSTRAINT reauth_proofs_self_target_check CHECK (actor_user_id = target_user_id),
  CONSTRAINT reauth_proofs_expiry_check CHECK (
    expires_at > issued_at
    AND expires_at <= issued_at + interval '5 minutes'
  ),
  CONSTRAINT reauth_proofs_consumption_metadata_check CHECK (
    (consumed_at IS NULL AND request_id IS NULL AND idempotency_key IS NULL)
    OR (
      consumed_at IS NOT NULL
      AND request_id IS NOT NULL
      AND idempotency_key IS NOT NULL
      AND char_length(btrim(idempotency_key)) BETWEEN 1 AND 200
    )
  )
);

CREATE INDEX reauth_proofs_expiry_idx
  ON account_deletion_private.reauth_proofs (expires_at);

ALTER TABLE account_deletion_private.reauth_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_deletion_private.reauth_proofs FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.issue_account_deletion_reauth_proof(
  p_target_user_id uuid
)
RETURNS TABLE (proof_id uuid, expires_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_now_epoch numeric := extract(epoch FROM v_now);
  v_actor_user_id uuid := auth.uid();
  v_claims jsonb := auth.jwt();
  v_session_id uuid;
  v_exp numeric;
  v_iat numeric;
  v_amr_timestamp numeric;
BEGIN
  IF auth.role() <> 'authenticated'
     OR v_actor_user_id IS NULL
     OR p_target_user_id IS NULL
     OR v_actor_user_id <> p_target_user_id
     OR v_claims IS NULL
     OR jsonb_typeof(v_claims) <> 'object'
     OR jsonb_typeof(v_claims -> 'session_id') <> 'string'
     OR (v_claims ->> 'session_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR jsonb_typeof(v_claims -> 'exp') <> 'number'
     OR jsonb_typeof(v_claims -> 'iat') <> 'number'
     OR (v_claims ->> 'exp') !~ '^[0-9]+$'
     OR (v_claims ->> 'iat') !~ '^[0-9]+$'
     OR jsonb_typeof(v_claims -> 'amr') <> 'array' THEN
    RAISE EXCEPTION 'account_deletion_reauth_proof_invalid_claims';
  END IF;

  v_session_id := (v_claims ->> 'session_id')::uuid;
  v_exp := (v_claims ->> 'exp')::numeric;
  v_iat := (v_claims ->> 'iat')::numeric;
  SELECT max((amr.entry ->> 'timestamp')::numeric)
    INTO v_amr_timestamp
    FROM jsonb_array_elements(v_claims -> 'amr') AS amr(entry)
   WHERE jsonb_typeof(amr.entry) = 'object'
     AND amr.entry ->> 'method' = 'password'
     AND jsonb_typeof(amr.entry -> 'timestamp') = 'number'
     AND (amr.entry ->> 'timestamp') ~ '^[0-9]+$';

  IF v_exp <= v_now_epoch
     OR v_iat > v_now_epoch
     OR v_iat > v_exp
     OR v_amr_timestamp IS NULL THEN
    RAISE EXCEPTION 'account_deletion_reauth_proof_invalid_claims';
  END IF;
  IF v_amr_timestamp > v_now_epoch
     OR v_amr_timestamp < v_now_epoch - 300 THEN
    RAISE EXCEPTION 'account_deletion_reauth_proof_password_reauthentication_required';
  END IF;

  INSERT INTO account_deletion_private.reauth_proofs AS proofs (
    actor_user_id, target_user_id, session_id, password_reauthenticated_at, issued_at, expires_at
  ) VALUES (
    v_actor_user_id, p_target_user_id, v_session_id, pg_catalog.to_timestamp(v_amr_timestamp), v_now, v_now + interval '5 minutes'
  )
  RETURNING proofs.proof_id, proofs.expires_at INTO proof_id, expires_at;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.consume_account_deletion_reauth_proof(
  p_proof_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_idempotency_key text
)
RETURNS TABLE (proof_id uuid, consumed_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_now_epoch numeric := extract(epoch FROM v_now);
  v_actor_user_id uuid := auth.uid();
  v_claims jsonb := auth.jwt();
  v_session_id uuid;
  v_exp numeric;
  v_iat numeric;
  v_amr_timestamp numeric;
  v_proof account_deletion_private.reauth_proofs%ROWTYPE;
BEGIN
  IF auth.role() <> 'authenticated'
     OR v_actor_user_id IS NULL
     OR p_proof_id IS NULL
     OR p_target_user_id IS NULL
     OR p_request_id IS NULL
     OR p_idempotency_key IS NULL
     OR char_length(btrim(p_idempotency_key)) NOT BETWEEN 1 AND 200
     OR v_actor_user_id <> p_target_user_id
     OR v_claims IS NULL
     OR jsonb_typeof(v_claims) <> 'object'
     OR jsonb_typeof(v_claims -> 'session_id') <> 'string'
     OR (v_claims ->> 'session_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
     OR jsonb_typeof(v_claims -> 'exp') <> 'number'
     OR jsonb_typeof(v_claims -> 'iat') <> 'number'
     OR (v_claims ->> 'exp') !~ '^[0-9]+$'
     OR (v_claims ->> 'iat') !~ '^[0-9]+$'
     OR jsonb_typeof(v_claims -> 'amr') <> 'array' THEN
    RAISE EXCEPTION 'account_deletion_reauth_proof_invalid_claims';
  END IF;

  v_session_id := (v_claims ->> 'session_id')::uuid;
  v_exp := (v_claims ->> 'exp')::numeric;
  v_iat := (v_claims ->> 'iat')::numeric;
  SELECT max((amr.entry ->> 'timestamp')::numeric)
    INTO v_amr_timestamp
    FROM jsonb_array_elements(v_claims -> 'amr') AS amr(entry)
   WHERE jsonb_typeof(amr.entry) = 'object'
     AND amr.entry ->> 'method' = 'password'
     AND jsonb_typeof(amr.entry -> 'timestamp') = 'number'
     AND (amr.entry ->> 'timestamp') ~ '^[0-9]+$';

  IF v_exp <= v_now_epoch
     OR v_iat > v_now_epoch
     OR v_iat > v_exp
     OR v_amr_timestamp IS NULL THEN
    RAISE EXCEPTION 'account_deletion_reauth_proof_invalid_claims';
  END IF;
  IF v_amr_timestamp > v_now_epoch
     OR v_amr_timestamp < v_now_epoch - 300 THEN
    RAISE EXCEPTION 'account_deletion_reauth_proof_password_reauthentication_required';
  END IF;

  SELECT proofs.* INTO v_proof
    FROM account_deletion_private.reauth_proofs AS proofs
   WHERE proofs.proof_id = p_proof_id
   FOR UPDATE;
  IF NOT FOUND
     OR v_proof.actor_user_id <> v_actor_user_id
     OR v_proof.target_user_id <> p_target_user_id
     OR v_proof.session_id <> v_session_id
     OR v_proof.password_reauthenticated_at <> pg_catalog.to_timestamp(v_amr_timestamp)
     OR v_proof.expires_at <= v_now
     OR v_proof.consumed_at IS NOT NULL THEN
    RAISE EXCEPTION 'account_deletion_reauth_proof_not_available';
  END IF;

  UPDATE account_deletion_private.reauth_proofs AS proofs
     SET consumed_at = v_now,
         request_id = p_request_id,
         idempotency_key = btrim(p_idempotency_key)
   WHERE proofs.proof_id = v_proof.proof_id
  RETURNING proofs.proof_id, proofs.consumed_at INTO proof_id, consumed_at;
  RETURN NEXT;
END;
$function$;

CREATE OR REPLACE FUNCTION public.begin_account_deletion_apply_with_reauth(
  p_proof_id uuid,
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_confirmation_text text,
  p_idempotency_key text,
  p_source_manifest_hash text
)
RETURNS TABLE (
  request_id uuid,
  status text,
  reason_code text,
  delete_count integer,
  anonymize_count integer,
  separate_count integer,
  retain_count integer,
  db_readback_passed boolean,
  storage_readback_passed boolean,
  session_readback_passed boolean,
  auth_readback_passed boolean,
  storage_receipt_refs jsonb,
  auth_receipt_ref text,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_user_id uuid := auth.uid();
  v_last_sign_in_at timestamptz;
  v_original_role_claim text := current_setting('request.jwt.claim.role', true);
  v_begin record;
BEGIN
  IF auth.role() <> 'authenticated'
     OR v_actor_user_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_target_user_id IS NULL
     OR v_actor_user_id <> p_actor_user_id
     OR v_actor_user_id <> p_target_user_id THEN
    RAISE EXCEPTION 'account_deletion_reauth_proof_invalid_claims' USING ERRCODE = '42501';
  END IF;

  PERFORM public.consume_account_deletion_reauth_proof(
    p_proof_id, p_target_user_id, p_request_id, p_idempotency_key
  );

  SELECT user_row.last_sign_in_at INTO v_last_sign_in_at
    FROM auth.users AS user_row
   WHERE user_row.id = v_actor_user_id;
  IF v_last_sign_in_at IS NULL THEN
    RAISE EXCEPTION 'account_deletion_reauthentication_required' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  SELECT * INTO v_begin
    FROM public.begin_account_deletion_apply(
      v_actor_user_id,
      p_target_user_id,
      p_request_id,
      p_preview_hash,
      p_confirmation_text,
      p_idempotency_key,
      v_last_sign_in_at,
      p_source_manifest_hash
    );

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_apply_invariant_failed';
  END IF;

  IF v_begin.status IS DISTINCT FROM 'APPLY_STARTED' THEN
    UPDATE account_deletion_private.reauth_proofs AS proofs
       SET consumed_at = NULL,
           request_id = NULL,
           idempotency_key = NULL
     WHERE proofs.proof_id = p_proof_id
       AND proofs.actor_user_id = v_actor_user_id
       AND proofs.target_user_id = p_target_user_id
       AND proofs.request_id = p_request_id
       AND proofs.idempotency_key = btrim(p_idempotency_key);

    v_begin.reason_code := 'account_deletion_apply_not_started';
  END IF;

  RETURN QUERY
  SELECT
    v_begin.request_id,
    v_begin.status,
    v_begin.reason_code,
    v_begin.delete_count,
    v_begin.anonymize_count,
    v_begin.separate_count,
    v_begin.retain_count,
    v_begin.db_readback_passed,
    v_begin.storage_readback_passed,
    v_begin.session_readback_passed,
    v_begin.auth_readback_passed,
    v_begin.storage_receipt_refs,
    v_begin.auth_receipt_ref,
    v_begin.source_manifest_hash;
  PERFORM pg_catalog.set_config('request.jwt.claim.role', COALESCE(v_original_role_claim, ''), true);
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_catalog.set_config('request.jwt.claim.role', COALESCE(v_original_role_claim, ''), true);
  RAISE;
END;
$function$;

ALTER SCHEMA account_deletion_private OWNER TO postgres;
ALTER TABLE account_deletion_private.reauth_proofs OWNER TO postgres;
ALTER FUNCTION public.issue_account_deletion_reauth_proof(uuid) OWNER TO postgres;
ALTER FUNCTION public.consume_account_deletion_reauth_proof(uuid, uuid, uuid, text) OWNER TO postgres;
ALTER FUNCTION public.begin_account_deletion_apply_with_reauth(uuid, uuid, uuid, uuid, text, text, text, text) OWNER TO postgres;

REVOKE ALL ON TABLE account_deletion_private.reauth_proofs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.issue_account_deletion_reauth_proof(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.consume_account_deletion_reauth_proof(uuid, uuid, uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.begin_account_deletion_apply_with_reauth(uuid, uuid, uuid, uuid, text, text, text, text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.issue_account_deletion_reauth_proof(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_account_deletion_reauth_proof(uuid, uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.begin_account_deletion_apply_with_reauth(uuid, uuid, uuid, uuid, text, text, text, text) TO authenticated;

DO $function$
DECLARE
  v_function oid;
BEGIN
  IF (SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'account_deletion_private') <> 'postgres'
     OR (SELECT relowner::regrole::text FROM pg_class WHERE oid = 'account_deletion_private.reauth_proofs'::regclass) <> 'postgres'
     OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'account_deletion_private.reauth_proofs'::regclass)
     OR EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = 'account_deletion_private.reauth_proofs'::regclass)
     OR has_schema_privilege('PUBLIC', 'account_deletion_private', 'USAGE')
     OR has_schema_privilege('anon', 'account_deletion_private', 'USAGE')
     OR has_schema_privilege('authenticated', 'account_deletion_private', 'USAGE')
     OR has_schema_privilege('service_role', 'account_deletion_private', 'USAGE')
     OR has_table_privilege('PUBLIC', 'account_deletion_private.reauth_proofs', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('anon', 'account_deletion_private.reauth_proofs', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('authenticated', 'account_deletion_private.reauth_proofs', 'SELECT, INSERT, UPDATE, DELETE')
     OR has_table_privilege('service_role', 'account_deletion_private.reauth_proofs', 'SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'G028 private reauthentication proof ACL invariant failed';
  END IF;

  FOREACH v_function IN ARRAY ARRAY[
    'public.issue_account_deletion_reauth_proof(uuid)'::regprocedure::oid,
    'public.consume_account_deletion_reauth_proof(uuid,uuid,uuid,text)'::regprocedure::oid,
    'public.begin_account_deletion_apply_with_reauth(uuid,uuid,uuid,uuid,text,text,text,text)'::regprocedure::oid
  ] LOOP
    IF (SELECT proowner::regrole::text FROM pg_proc WHERE oid = v_function) <> 'postgres'
       OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_function)
       OR NOT (SELECT proconfig IS NOT DISTINCT FROM ARRAY['search_path='] FROM pg_proc WHERE oid = v_function)
       OR has_function_privilege('PUBLIC', v_function, 'EXECUTE')
       OR has_function_privilege('anon', v_function, 'EXECUTE')
       OR has_function_privilege('service_role', v_function, 'EXECUTE')
       OR NOT has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'G028 public reauthentication proof RPC invariant failed';
    END IF;
  END LOOP;
END;
$function$;

NOTIFY pgrst, 'reload schema';
COMMIT;
