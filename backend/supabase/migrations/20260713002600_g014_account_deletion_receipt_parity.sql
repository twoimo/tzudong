-- G014-09: preserve the durable applied receipt on the owner status readback.

DO $g014_account_deletion_receipt_parity_preflight$
BEGIN
  IF pg_catalog.to_regclass('public.account_deletion_requests') IS NULL
     OR pg_catalog.to_regclass('public.account_deletion_request_items') IS NULL
     OR pg_catalog.to_regclass('storage.objects') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.g014_public_rpc_allowlist') IS NULL
     OR pg_catalog.to_regprocedure('privacy_retention.g014_account_deletion_storage_receipt_refs(uuid)') IS NULL
     OR pg_catalog.to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'G014-09 account-deletion receipt parity dependencies are missing';
  END IF;
END;
$g014_account_deletion_receipt_parity_preflight$;

DROP FUNCTION public.read_current_account_deletion_status(uuid, text, text);
CREATE OR REPLACE FUNCTION public.apply_account_deletion_database_cleanup(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text
)
RETURNS TABLE (
  request_id uuid,
  status text,
  reason_code text,
  db_readback_passed boolean,
  session_readback_passed boolean,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_manifest privacy_retention.account_deletion_source_manifest%ROWTYPE;
  v_evidence_cleanup_lease_token uuid;
  v_storage_object_count bigint;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_require_service_role();
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_request_id IS NULL
     OR p_preview_hash IS NULL OR p_idempotency_key IS NULL OR p_source_manifest_hash IS NULL THEN
    RAISE EXCEPTION 'account_deletion_database_arguments_required' USING ERRCODE = '22004';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_lock_target(p_target_user_id);
  SELECT * INTO v_request FROM public.account_deletion_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND
     OR v_request.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v_request.target_user_id IS DISTINCT FROM p_target_user_id
     OR v_request.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_request.idempotency_key IS DISTINCT FROM p_idempotency_key
     OR v_request.source_manifest_hash IS DISTINCT FROM p_source_manifest_hash THEN
    RAISE EXCEPTION 'account_deletion_database_binding_mismatch' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_assert_actor_allowed(p_actor_user_id, p_target_user_id);
  PERFORM privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id);
  IF v_request.status NOT IN ('applying', 'partial')
     OR v_request.source_manifest_hash IS DISTINCT FROM
        privacy_retention.g014_account_deletion_validate_manifest(v_request.policy_version) THEN
    RAISE EXCEPTION 'account_deletion_database_predecessor_invalid' USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO v_storage_object_count
  FROM storage.objects AS object_row
  WHERE object_row.owner_id::text = p_target_user_id::text;
  IF v_storage_object_count > 100 THEN
    RAISE EXCEPTION 'account_deletion_storage_receipt_limit_exceeded' USING ERRCODE = '54000';
  END IF;

  FOR v_manifest IN
    SELECT manifest.*
    FROM privacy_retention.account_deletion_source_manifest AS manifest
    WHERE manifest.policy_version = v_request.policy_version
      AND manifest.code NOT IN ('storage_objects', 'auth_identity')
    ORDER BY manifest.ordinal, manifest.code
  LOOP
    PERFORM privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id);
    PERFORM privacy_retention.g014_account_deletion_apply_adapter(
      v_manifest.adapter_name, v_request.id, p_target_user_id
    );
    UPDATE public.account_deletion_request_items AS item
    SET status = CASE item.disposition
      WHEN 'retain' THEN 'retained'
      WHEN 'separate' THEN 'separated'
      ELSE 'applied'
    END,
    reason_code = 'DB_READBACK_PASSED'
    WHERE item.request_id = v_request.id AND item.data_class_code = v_manifest.code;
  END LOOP;

  v_evidence_cleanup_lease_token := pg_catalog.nullif(
    pg_catalog.current_setting('app.account_deletion_evidence_lease_token', true), ''
  )::uuid;
  IF v_evidence_cleanup_lease_token IS NOT NULL THEN
    PERFORM privacy_retention.g014_account_deletion_release_evidence_cleanup(
      v_request.id, p_target_user_id, v_evidence_cleanup_lease_token
    );
  END IF;

  UPDATE public.account_deletion_requests
  SET status = 'applying',
      reason_code = 'DB_READBACK_PASSED',
      db_readback_passed = true,
      session_readback_passed = false
  WHERE id = v_request.id
  RETURNING * INTO v_request;
  PERFORM privacy_retention.g014_account_deletion_append_audit(
    v_request, 'readback_passed', 'DB_READBACK_PASSED'
  );
  RETURN QUERY SELECT v_request.id, v_request.status, v_request.reason_code,
    v_request.db_readback_passed, v_request.session_readback_passed,
    v_request.source_manifest_hash;
END;
$function$;

CREATE OR REPLACE FUNCTION public.read_current_account_deletion_status(
  p_request_id uuid,
  p_preview_hash text,
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
  source_manifest_hash text,
  idempotency_key_binding_sha256 text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_owner_id uuid := auth.uid();
BEGIN
  IF v_owner_id IS NULL
     OR p_request_id IS NULL
     OR p_preview_hash IS NULL
     OR p_source_manifest_hash IS NULL
     OR p_preview_hash !~ '^[0-9a-f]{64}$'
     OR p_source_manifest_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    request_row.id,
    request_row.status,
    request_row.reason_code,
    LEAST(COALESCE((SELECT sum(item.planned_count) FROM public.account_deletion_request_items AS item WHERE item.request_id = request_row.id AND item.disposition = 'delete'), 0), 2147483647)::integer,
    LEAST(COALESCE((SELECT sum(item.planned_count) FROM public.account_deletion_request_items AS item WHERE item.request_id = request_row.id AND item.disposition = 'anonymize'), 0), 2147483647)::integer,
    LEAST(COALESCE((SELECT sum(item.planned_count) FROM public.account_deletion_request_items AS item WHERE item.request_id = request_row.id AND item.disposition = 'separate'), 0), 2147483647)::integer,
    LEAST(COALESCE((SELECT sum(item.planned_count) FROM public.account_deletion_request_items AS item WHERE item.request_id = request_row.id AND item.disposition = 'retain'), 0), 2147483647)::integer,
    request_row.db_readback_passed,
    request_row.storage_readback_passed,
    request_row.session_readback_passed,
    request_row.auth_readback_passed,
    CASE WHEN request_row.status = 'applied'
      AND request_row.db_readback_passed
      AND request_row.storage_readback_passed
      AND request_row.session_readback_passed
      AND request_row.auth_readback_passed
      AND request_row.applied_at IS NOT NULL
      AND request_row.auth_receipt_ref ~ '^[A-Za-z0-9._:-]{8,256}$'
      THEN privacy_retention.g014_account_deletion_storage_receipt_refs(request_row.id)
      ELSE NULL END,
    CASE WHEN request_row.status = 'applied'
      AND request_row.db_readback_passed
      AND request_row.storage_readback_passed
      AND request_row.session_readback_passed
      AND request_row.auth_readback_passed
      AND request_row.applied_at IS NOT NULL
      AND request_row.auth_receipt_ref ~ '^[A-Za-z0-9._:-]{8,256}$'
      THEN request_row.auth_receipt_ref
      ELSE NULL END,
    request_row.source_manifest_hash,
    CASE WHEN request_row.idempotency_key IS NOT NULL THEN pg_catalog.encode(
      extensions.digest(
        'g038-account-deletion-idempotency-binding:v1' || pg_catalog.chr(10) || request_row.idempotency_key,
        'sha256'
      ),
      'hex'
    ) ELSE NULL END
  FROM public.account_deletion_requests AS request_row
  WHERE request_row.id = p_request_id
    AND request_row.actor_user_id = v_owner_id
    AND request_row.target_user_id = v_owner_id
    AND request_row.preview_hash = p_preview_hash
    AND request_row.source_manifest_hash = p_source_manifest_hash
    AND request_row.status IN ('applying', 'partial', 'failed', 'applied', 'expired', 'cancelled')
    AND public.account_deletion_reason_code_is_safe(request_row.reason_code);
END;
$function$;

ALTER FUNCTION public.apply_account_deletion_database_cleanup(uuid, uuid, uuid, text, text, text)
  OWNER TO privacy_workflow_owner;
ALTER FUNCTION public.read_current_account_deletion_status(uuid, text, text)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.read_current_account_deletion_status(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_current_account_deletion_status(uuid, text, text)
  TO authenticated;

DELETE FROM privacy_retention.g014_public_rpc_allowlist
WHERE source_signature = 'public.read_current_account_deletion_status(uuid,text,text)'
  AND grantee = 'authenticated'::name;
INSERT INTO privacy_retention.g014_public_rpc_allowlist (
  function_schema, function_name, identity_arguments, grantee, source_signature
)
SELECT namespace.nspname, procedure.proname, procedure.proargtypes::text,
  'authenticated'::name, 'public.read_current_account_deletion_status(uuid,text,text)'
FROM pg_catalog.pg_proc AS procedure
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
WHERE procedure.oid = pg_catalog.to_regprocedure('public.read_current_account_deletion_status(uuid,text,text)');
