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
  CONSTRAINT reauth_proofs_expiry_check CHECK (expires_at > issued_at AND expires_at <= issued_at + interval '5 minutes'),
  CONSTRAINT reauth_proofs_consumption_metadata_check CHECK ((consumed_at IS NULL AND request_id IS NULL AND idempotency_key IS NULL) OR (consumed_at IS NOT NULL AND request_id IS NOT NULL AND idempotency_key IS NOT NULL AND char_length(btrim(idempotency_key)) BETWEEN 1 AND 200))
);
ALTER TABLE account_deletion_private.reauth_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_deletion_private.reauth_proofs FORCE ROW LEVEL SECURITY;
CREATE POLICY g028_reauth_proof_owner_access
  ON account_deletion_private.reauth_proofs
  FOR ALL TO privacy_workflow_owner
  USING (true)
  WITH CHECK (true);
CREATE INDEX reauth_proofs_expiry_idx ON account_deletion_private.reauth_proofs (expires_at);

CREATE OR REPLACE FUNCTION public.issue_account_deletion_reauth_proof(p_target_user_id uuid)
RETURNS TABLE (proof_id uuid, expires_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp(); v_now_epoch numeric := extract(epoch FROM v_now); v_claims jsonb := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb; v_actor_user_id uuid := nullif(v_claims ->> 'sub', '')::uuid; v_session_id uuid; v_exp numeric; v_iat numeric; v_amr_timestamp numeric;
BEGIN
  IF v_claims ->> 'role' IS DISTINCT FROM 'authenticated' OR v_actor_user_id IS NULL OR p_target_user_id IS NULL OR v_actor_user_id <> p_target_user_id OR v_claims IS NULL OR jsonb_typeof(v_claims) IS DISTINCT FROM 'object' OR jsonb_typeof(v_claims -> 'session_id') IS DISTINCT FROM 'string' OR (v_claims ->> 'session_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR jsonb_typeof(v_claims -> 'exp') IS DISTINCT FROM 'number' OR jsonb_typeof(v_claims -> 'iat') IS DISTINCT FROM 'number' OR (v_claims ->> 'exp') !~ '^[0-9]+$' OR (v_claims ->> 'iat') !~ '^[0-9]+$' OR jsonb_typeof(v_claims -> 'amr') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'account_deletion_reauth_proof_invalid_claims'; END IF;
  v_session_id := (v_claims ->> 'session_id')::uuid; v_exp := (v_claims ->> 'exp')::numeric; v_iat := (v_claims ->> 'iat')::numeric;
  SELECT max((entry ->> 'timestamp')::numeric) INTO v_amr_timestamp FROM jsonb_array_elements(v_claims -> 'amr') AS amr(entry) WHERE jsonb_typeof(entry) = 'object' AND entry ->> 'method' = 'password' AND jsonb_typeof(entry -> 'timestamp') = 'number' AND (entry ->> 'timestamp') ~ '^[0-9]+$';
  IF v_exp <= v_now_epoch OR v_iat > v_now_epoch OR v_iat > v_exp OR v_amr_timestamp IS NULL THEN RAISE EXCEPTION 'account_deletion_reauth_proof_invalid_claims'; END IF;
  IF v_amr_timestamp > v_now_epoch OR v_amr_timestamp < v_now_epoch - 300 THEN RAISE EXCEPTION 'account_deletion_reauth_proof_password_reauthentication_required'; END IF;
  DELETE FROM account_deletion_private.reauth_proofs AS proofs WHERE proofs.actor_user_id = v_actor_user_id AND proofs.expires_at <= v_now;
  INSERT INTO account_deletion_private.reauth_proofs AS proofs (actor_user_id,target_user_id,session_id,password_reauthenticated_at,issued_at,expires_at) VALUES (v_actor_user_id,p_target_user_id,v_session_id,pg_catalog.to_timestamp(v_amr_timestamp),v_now,v_now + interval '5 minutes') RETURNING proofs.proof_id,proofs.expires_at INTO proof_id,expires_at;
  RETURN NEXT;
END; $$;

CREATE OR REPLACE FUNCTION public.consume_account_deletion_reauth_proof(p_proof_id uuid,p_target_user_id uuid,p_request_id uuid,p_idempotency_key text)
RETURNS TABLE (proof_id uuid, consumed_at timestamptz) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp(); v_now_epoch numeric := extract(epoch FROM v_now); v_claims jsonb := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb; v_actor_user_id uuid := nullif(v_claims ->> 'sub', '')::uuid; v_session_id uuid; v_exp numeric; v_iat numeric; v_amr_timestamp numeric; v_proof account_deletion_private.reauth_proofs%ROWTYPE;
BEGIN
  IF v_claims ->> 'role' IS DISTINCT FROM 'authenticated' OR v_actor_user_id IS NULL OR p_proof_id IS NULL OR p_target_user_id IS NULL OR p_request_id IS NULL OR p_idempotency_key IS NULL OR char_length(btrim(p_idempotency_key)) NOT BETWEEN 1 AND 200 OR v_actor_user_id <> p_target_user_id OR v_claims IS NULL OR jsonb_typeof(v_claims) IS DISTINCT FROM 'object' OR jsonb_typeof(v_claims -> 'session_id') IS DISTINCT FROM 'string' OR (v_claims ->> 'session_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' OR jsonb_typeof(v_claims -> 'exp') IS DISTINCT FROM 'number' OR jsonb_typeof(v_claims -> 'iat') IS DISTINCT FROM 'number' OR (v_claims ->> 'exp') !~ '^[0-9]+$' OR (v_claims ->> 'iat') !~ '^[0-9]+$' OR jsonb_typeof(v_claims -> 'amr') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'account_deletion_reauth_proof_invalid_claims'; END IF;
  v_session_id := (v_claims ->> 'session_id')::uuid; v_exp := (v_claims ->> 'exp')::numeric; v_iat := (v_claims ->> 'iat')::numeric;
  SELECT max((entry ->> 'timestamp')::numeric) INTO v_amr_timestamp FROM jsonb_array_elements(v_claims -> 'amr') AS amr(entry) WHERE jsonb_typeof(entry) = 'object' AND entry ->> 'method' = 'password' AND jsonb_typeof(entry -> 'timestamp') = 'number' AND (entry ->> 'timestamp') ~ '^[0-9]+$';
  IF v_exp <= v_now_epoch OR v_iat > v_now_epoch OR v_iat > v_exp OR v_amr_timestamp IS NULL THEN RAISE EXCEPTION 'account_deletion_reauth_proof_invalid_claims'; END IF;
  IF v_amr_timestamp > v_now_epoch OR v_amr_timestamp < v_now_epoch - 300 THEN RAISE EXCEPTION 'account_deletion_reauth_proof_password_reauthentication_required'; END IF;
  SELECT proofs.* INTO v_proof FROM account_deletion_private.reauth_proofs AS proofs WHERE proofs.proof_id = p_proof_id FOR UPDATE;
  IF NOT FOUND OR v_proof.actor_user_id <> v_actor_user_id OR v_proof.target_user_id <> p_target_user_id OR v_proof.session_id <> v_session_id OR v_proof.password_reauthenticated_at <> pg_catalog.to_timestamp(v_amr_timestamp) OR v_proof.expires_at <= v_now OR v_proof.consumed_at IS NOT NULL THEN RAISE EXCEPTION 'account_deletion_reauth_proof_not_available'; END IF;
  UPDATE account_deletion_private.reauth_proofs AS proofs SET consumed_at=v_now,request_id=p_request_id,idempotency_key=btrim(p_idempotency_key) WHERE proofs.proof_id=v_proof.proof_id RETURNING proofs.proof_id,proofs.consumed_at INTO proof_id,consumed_at;
  RETURN NEXT;
END; $$;

CREATE OR REPLACE FUNCTION public.begin_account_deletion_apply_with_reauth(p_proof_id uuid,p_actor_user_id uuid,p_target_user_id uuid,p_request_id uuid,p_preview_hash text,p_confirmation_text text,p_idempotency_key text,p_source_manifest_hash text)
RETURNS TABLE (request_id uuid,status text,reason_code text,delete_count integer,anonymize_count integer,separate_count integer,retain_count integer,db_readback_passed boolean,storage_readback_passed boolean,session_readback_passed boolean,auth_readback_passed boolean,storage_receipt_refs jsonb,auth_receipt_ref text,source_manifest_hash text) LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_claims jsonb := nullif(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb;
  v_actor_user_id uuid := nullif(v_claims ->> 'sub', '')::uuid;
  v_reauthenticated_at timestamptz;
  v_original_role_claim text := current_setting('request.jwt.claim.role', true);
  v_result record;
BEGIN
  IF v_claims ->> 'role' IS DISTINCT FROM 'authenticated' OR v_actor_user_id IS NULL OR p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_actor_user_id <> v_actor_user_id OR p_target_user_id <> v_actor_user_id THEN RAISE EXCEPTION 'account_deletion_reauth_proof_invalid_actor'; END IF;
  PERFORM public.consume_account_deletion_reauth_proof(p_proof_id,p_target_user_id,p_request_id,p_idempotency_key);
  SELECT proofs.password_reauthenticated_at
  INTO STRICT v_reauthenticated_at
  FROM account_deletion_private.reauth_proofs AS proofs
  WHERE proofs.proof_id = p_proof_id
    AND proofs.actor_user_id = v_actor_user_id
    AND proofs.target_user_id = p_target_user_id
    AND proofs.request_id = p_request_id
    AND proofs.idempotency_key = btrim(p_idempotency_key)
    AND proofs.consumed_at IS NOT NULL;
  PERFORM set_config('request.jwt.claim.role','service_role',true);
  SELECT * INTO STRICT v_result
  FROM public.begin_account_deletion_apply(p_actor_user_id,p_target_user_id,p_request_id,p_preview_hash,p_confirmation_text,p_idempotency_key,v_reauthenticated_at,p_source_manifest_hash);
  IF v_result.request_id IS DISTINCT FROM p_request_id
    OR v_result.source_manifest_hash IS DISTINCT FROM p_source_manifest_hash
  THEN
    RAISE EXCEPTION 'account_deletion_reauth_begin_receipt_invalid';
  END IF;
  IF v_result.reason_code IS DISTINCT FROM 'APPLY_STARTED' THEN
    UPDATE account_deletion_private.reauth_proofs AS proofs
    SET consumed_at = NULL, request_id = NULL, idempotency_key = NULL
    WHERE proofs.proof_id = p_proof_id
      AND proofs.actor_user_id = v_actor_user_id
      AND proofs.target_user_id = p_target_user_id
      AND proofs.request_id = p_request_id
      AND proofs.idempotency_key = btrim(p_idempotency_key);
    v_result.reason_code := 'APPLY_NOT_STARTED';
    PERFORM set_config('request.jwt.claim.role',COALESCE(v_original_role_claim,''),true);
    RETURN QUERY SELECT v_result.request_id,v_result.status,v_result.reason_code,v_result.delete_count,v_result.anonymize_count,v_result.separate_count,v_result.retain_count,v_result.db_readback_passed,v_result.storage_readback_passed,v_result.session_readback_passed,v_result.auth_readback_passed,v_result.storage_receipt_refs,v_result.auth_receipt_ref,v_result.source_manifest_hash;
    RETURN;
  END IF;
  IF v_result.status IS DISTINCT FROM 'applying'
    OR v_result.delete_count IS NULL OR v_result.delete_count < 0
    OR v_result.anonymize_count IS NULL OR v_result.anonymize_count < 0
    OR v_result.separate_count IS NULL OR v_result.separate_count < 0
    OR v_result.retain_count IS NULL OR v_result.retain_count < 0
    OR v_result.db_readback_passed IS DISTINCT FROM false
    OR v_result.storage_readback_passed IS DISTINCT FROM false
    OR v_result.session_readback_passed IS DISTINCT FROM false
    OR v_result.auth_readback_passed IS DISTINCT FROM false
    OR v_result.storage_receipt_refs IS NOT NULL
    OR v_result.auth_receipt_ref IS NOT NULL
  THEN
    RAISE EXCEPTION 'account_deletion_reauth_begin_receipt_invalid';
  END IF;
  PERFORM set_config('request.jwt.claim.role',COALESCE(v_original_role_claim,''),true);
  DELETE FROM account_deletion_private.reauth_proofs AS proofs WHERE proofs.proof_id = p_proof_id;
  RETURN QUERY SELECT v_result.request_id,v_result.status,v_result.reason_code,v_result.delete_count,v_result.anonymize_count,v_result.separate_count,v_result.retain_count,v_result.db_readback_passed,v_result.storage_readback_passed,v_result.session_readback_passed,v_result.auth_readback_passed,v_result.storage_receipt_refs,v_result.auth_receipt_ref,v_result.source_manifest_hash;
EXCEPTION WHEN OTHERS THEN
  PERFORM set_config('request.jwt.claim.role',COALESCE(v_original_role_claim,''),true);
  RAISE;
END; $$;

GRANT privacy_workflow_owner TO postgres;
ALTER SCHEMA account_deletion_private OWNER TO privacy_workflow_owner;
ALTER TABLE account_deletion_private.reauth_proofs OWNER TO privacy_workflow_owner;
ALTER FUNCTION public.issue_account_deletion_reauth_proof(uuid) OWNER TO privacy_workflow_owner;
ALTER FUNCTION public.consume_account_deletion_reauth_proof(uuid,uuid,uuid,text) OWNER TO privacy_workflow_owner;
ALTER FUNCTION public.begin_account_deletion_apply_with_reauth(uuid,uuid,uuid,uuid,text,text,text,text) OWNER TO privacy_workflow_owner;
REVOKE ALL ON TABLE account_deletion_private.reauth_proofs FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA account_deletion_private TO privacy_workflow_owner;
GRANT ALL ON TABLE account_deletion_private.reauth_proofs TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.issue_account_deletion_reauth_proof(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.consume_account_deletion_reauth_proof(uuid,uuid,uuid,text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.begin_account_deletion_apply_with_reauth(uuid,uuid,uuid,uuid,text,text,text,text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.issue_account_deletion_reauth_proof(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.consume_account_deletion_reauth_proof(uuid,uuid,uuid,text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.begin_account_deletion_apply_with_reauth(uuid,uuid,uuid,uuid,text,text,text,text) TO authenticated;

DELETE FROM privacy_retention.g014_public_rpc_allowlist
WHERE source_signature IN (
  'public.issue_account_deletion_reauth_proof(uuid)',
  'public.begin_account_deletion_apply_with_reauth(uuid,uuid,uuid,uuid,text,text,text,text)'
);

INSERT INTO privacy_retention.g014_public_rpc_allowlist (
  function_schema,
  function_name,
  identity_arguments,
  grantee,
  source_signature
)
SELECT
  namespace.nspname,
  procedure.proname,
  procedure.proargtypes::text,
  'authenticated'::name,
  CASE procedure.proname
    WHEN 'issue_account_deletion_reauth_proof' THEN
      'public.issue_account_deletion_reauth_proof(uuid)'
    WHEN 'begin_account_deletion_apply_with_reauth' THEN
      'public.begin_account_deletion_apply_with_reauth(uuid,uuid,uuid,uuid,text,text,text,text)'
  END
FROM pg_catalog.pg_proc AS procedure
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = procedure.pronamespace
WHERE procedure.oid IN (
  'public.issue_account_deletion_reauth_proof(uuid)'::regprocedure,
  'public.begin_account_deletion_apply_with_reauth(uuid,uuid,uuid,uuid,text,text,text,text)'::regprocedure
);
REVOKE privacy_workflow_owner FROM postgres;

DO $g028_catalog_contract$
DECLARE v_function oid;
BEGIN
  IF (SELECT nspowner::regrole::text FROM pg_namespace WHERE nspname = 'account_deletion_private') <> 'privacy_workflow_owner' OR (SELECT relowner::regrole::text FROM pg_class WHERE oid = 'account_deletion_private.reauth_proofs'::regclass) <> 'privacy_workflow_owner' OR NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'account_deletion_private.reauth_proofs'::regclass) OR (SELECT count(*) FROM pg_policy WHERE polrelid = 'account_deletion_private.reauth_proofs'::regclass AND polname = 'g028_reauth_proof_owner_access' AND polroles = ARRAY['privacy_workflow_owner'::regrole::oid] AND polcmd = '*') <> 1 OR has_schema_privilege('anon','account_deletion_private','USAGE') OR has_schema_privilege('authenticated','account_deletion_private','USAGE') OR has_schema_privilege('service_role','account_deletion_private','USAGE') OR has_table_privilege('anon','account_deletion_private.reauth_proofs','SELECT, INSERT, UPDATE, DELETE') OR has_table_privilege('authenticated','account_deletion_private.reauth_proofs','SELECT, INSERT, UPDATE, DELETE') OR has_table_privilege('service_role','account_deletion_private.reauth_proofs','SELECT, INSERT, UPDATE, DELETE') THEN RAISE EXCEPTION 'G028 private reauthentication proof ACL invariant failed'; END IF;
  FOREACH v_function IN ARRAY ARRAY['public.issue_account_deletion_reauth_proof(uuid)'::regprocedure::oid,'public.begin_account_deletion_apply_with_reauth(uuid,uuid,uuid,uuid,text,text,text,text)'::regprocedure::oid] LOOP
    IF (SELECT proowner::regrole::text FROM pg_proc WHERE oid = v_function) <> 'privacy_workflow_owner' OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_function) OR NOT (SELECT proconfig IS NOT DISTINCT FROM ARRAY['search_path=""'] FROM pg_proc WHERE oid = v_function) OR EXISTS (SELECT 1 FROM pg_proc AS procedure_row CROSS JOIN LATERAL aclexplode(COALESCE(procedure_row.proacl, acldefault('f', procedure_row.proowner))) AS acl_row WHERE procedure_row.oid = v_function AND acl_row.privilege_type = 'EXECUTE' AND acl_row.grantee IN (0,(SELECT oid FROM pg_roles WHERE rolname = 'anon'),(SELECT oid FROM pg_roles WHERE rolname = 'service_role'))) OR NOT EXISTS (SELECT 1 FROM pg_proc AS procedure_row CROSS JOIN LATERAL aclexplode(COALESCE(procedure_row.proacl, acldefault('f', procedure_row.proowner))) AS acl_row WHERE procedure_row.oid = v_function AND acl_row.privilege_type = 'EXECUTE' AND acl_row.grantee = (SELECT oid FROM pg_roles WHERE rolname = 'authenticated')) THEN RAISE EXCEPTION 'G028 public reauthentication proof RPC invariant failed'; END IF;
  END LOOP;
  v_function := 'public.consume_account_deletion_reauth_proof(uuid,uuid,uuid,text)'::regprocedure::oid;
  IF (SELECT proowner::regrole::text FROM pg_proc WHERE oid = v_function) <> 'privacy_workflow_owner' OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_function) OR NOT (SELECT proconfig IS NOT DISTINCT FROM ARRAY['search_path=""'] FROM pg_proc WHERE oid = v_function) OR EXISTS (SELECT 1 FROM pg_proc AS procedure_row CROSS JOIN LATERAL aclexplode(COALESCE(procedure_row.proacl, acldefault('f', procedure_row.proowner))) AS acl_row WHERE procedure_row.oid = v_function AND acl_row.privilege_type = 'EXECUTE' AND acl_row.grantee IN (0,(SELECT oid FROM pg_roles WHERE rolname = 'anon'),(SELECT oid FROM pg_roles WHERE rolname = 'authenticated'),(SELECT oid FROM pg_roles WHERE rolname = 'service_role'))) THEN RAISE EXCEPTION 'G028 internal proof consumer ACL invariant failed'; END IF;
  IF pg_catalog.pg_has_role('postgres', 'privacy_workflow_owner', 'MEMBER') THEN RAISE EXCEPTION 'G028 temporary workflow-owner membership was not revoked'; END IF;
END;
$g028_catalog_contract$;
NOTIFY pgrst, 'reload schema';
COMMIT;
