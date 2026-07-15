-- G013: durable, single-consume approval receipts for Tzuyang address evidence applies.
-- The approval envelope and nonce are intentionally retained only as SHA-256 digests.

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
  ELSIF v_role.rolsuper
     OR v_role.rolinherit
     OR v_role.rolcreaterole
     OR v_role.rolcreatedb
     OR v_role.rolreplication
     OR v_role.rolbypassrls
     OR v_role.rolcanlogin
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_auth_members AS membership
        WHERE membership.member = v_role.oid
           OR membership.roleid = v_role.oid
     ) THEN
    RAISE EXCEPTION 'privacy_workflow_owner role attributes are incompatible';
  END IF;

  EXECUTE 'ALTER ROLE privacy_workflow_owner NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOLOGIN NOREPLICATION NOBYPASSRLS';
END;
$role$;

CREATE SCHEMA IF NOT EXISTS privacy_retention;
REVOKE ALL ON SCHEMA privacy_retention FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE, CREATE ON SCHEMA privacy_retention TO privacy_workflow_owner;

CREATE TABLE privacy_retention.tzuyang_address_evidence_admin_approval_receipts (
  operation_id uuid PRIMARY KEY,
  approval_envelope_sha256 text NOT NULL UNIQUE
    CHECK (approval_envelope_sha256 ~ '^[0-9a-f]{64}$'),
  nonce_sha256 text NOT NULL UNIQUE
    CHECK (nonce_sha256 ~ '^[0-9a-f]{64}$'),
  actor_user_id uuid NOT NULL,
  review_manifest_sha256 text NOT NULL
    CHECK (review_manifest_sha256 ~ '^[0-9a-f]{64}$'),
  signer_id text NOT NULL
    CHECK (
      octet_length(signer_id) BETWEEN 1 AND 256
      AND signer_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'
    ),
  action text NOT NULL
    CHECK (action = 'apply_tzuyang_address_evidence_ledger'),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL,
  CONSTRAINT tzuyang_address_evidence_admin_approval_receipts_time_order_check
    CHECK (expires_at > issued_at),
  CONSTRAINT tzuyang_address_evidence_admin_approval_receipts_timestamp_precision_check
    CHECK (
      issued_at = pg_catalog.date_trunc('milliseconds', issued_at)
      AND expires_at = pg_catalog.date_trunc('milliseconds', expires_at)
      AND consumed_at = pg_catalog.date_trunc('milliseconds', consumed_at)
    )
);

ALTER TABLE privacy_retention.tzuyang_address_evidence_admin_approval_receipts
  OWNER TO privacy_workflow_owner;
ALTER TABLE privacy_retention.tzuyang_address_evidence_admin_approval_receipts
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_retention.tzuyang_address_evidence_admin_approval_receipts
  FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE privacy_retention.tzuyang_address_evidence_admin_approval_receipts
  FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE privacy_retention.tzuyang_address_evidence_admin_approval_receipts
  TO privacy_workflow_owner;
CREATE POLICY g014_privacy_workflow_owner_access
  ON privacy_retention.tzuyang_address_evidence_admin_approval_receipts
  FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true);

CREATE FUNCTION privacy_retention.reject_tzuyang_address_evidence_admin_approval_receipt_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'tzuyang_address_evidence_admin_approval_receipt_immutable'
    USING ERRCODE = '55000';
END;
$function$;
ALTER FUNCTION privacy_retention.reject_tzuyang_address_evidence_admin_approval_receipt_mutation()
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.reject_tzuyang_address_evidence_admin_approval_receipt_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER tzuyang_address_evidence_admin_approval_receipts_append_only
BEFORE UPDATE OR DELETE ON privacy_retention.tzuyang_address_evidence_admin_approval_receipts
FOR EACH ROW EXECUTE FUNCTION privacy_retention.reject_tzuyang_address_evidence_admin_approval_receipt_mutation();
CREATE TRIGGER tzuyang_address_evidence_admin_approval_receipts_append_only_truncate
BEFORE TRUNCATE ON privacy_retention.tzuyang_address_evidence_admin_approval_receipts
FOR EACH STATEMENT EXECUTE FUNCTION privacy_retention.reject_tzuyang_address_evidence_admin_approval_receipt_mutation();

-- The definer locks the exact active-admin rows before recording a receipt.
-- G014-01 recreates this same policy as part of its workflow-owner hardening.
GRANT SELECT, UPDATE ON TABLE public.user_roles, public.user_account_status
  TO privacy_workflow_owner;
DROP POLICY IF EXISTS g014_privacy_workflow_owner_access ON public.user_roles;
CREATE POLICY g014_privacy_workflow_owner_access ON public.user_roles
  FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS g014_privacy_workflow_owner_access ON public.user_account_status;
CREATE POLICY g014_privacy_workflow_owner_access ON public.user_account_status
  FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true);

CREATE FUNCTION public.consume_tzuyang_address_evidence_admin_approval(
  p_operation_id uuid,
  p_approval_envelope_sha256 text,
  p_nonce_sha256 text,
  p_actor_user_id uuid,
  p_review_manifest_sha256 text,
  p_signer_id text,
  p_action text,
  p_issued_at timestamptz,
  p_expires_at timestamptz
)
RETURNS TABLE (consumed boolean, reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request_role text;
  v_now timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  v_existing privacy_retention.tzuyang_address_evidence_admin_approval_receipts%ROWTYPE;
  v_actor_user_id uuid;
BEGIN
  v_request_role := COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  IF v_request_role <> 'service_role' AND SESSION_USER <> 'postgres' THEN
    RAISE EXCEPTION 'tzuyang_address_admin_approval_apply_identity_required'
      USING ERRCODE = '42501';
  END IF;

  IF p_operation_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_approval_envelope_sha256 IS NULL
     OR p_approval_envelope_sha256 !~ '^[0-9a-f]{64}$'
     OR p_nonce_sha256 IS NULL
     OR p_nonce_sha256 !~ '^[0-9a-f]{64}$'
     OR p_review_manifest_sha256 IS NULL
     OR p_review_manifest_sha256 !~ '^[0-9a-f]{64}$'
     OR p_signer_id IS NULL
     OR octet_length(p_signer_id) NOT BETWEEN 1 AND 256
     OR p_signer_id !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$'
     OR p_action IS DISTINCT FROM 'apply_tzuyang_address_evidence_ledger'
     OR p_issued_at IS NULL
     OR p_expires_at IS NULL
     OR p_issued_at <> pg_catalog.date_trunc('milliseconds', p_issued_at)
     OR p_expires_at <> pg_catalog.date_trunc('milliseconds', p_expires_at)
     OR p_issued_at > v_now
     OR p_expires_at <= p_issued_at
     OR p_expires_at <= v_now THEN
    RAISE EXCEPTION 'tzuyang_address_admin_approval_request_invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT role_row.user_id
    INTO v_actor_user_id
    FROM public.user_roles AS role_row
    JOIN public.user_account_status AS status_row
      ON status_row.user_id = role_row.user_id
   WHERE role_row.user_id = p_actor_user_id
     AND role_row.role = 'admin'
     AND status_row.account_status = 'active'
   FOR UPDATE OF role_row, status_row;

  IF NOT FOUND OR v_actor_user_id IS DISTINCT FROM p_actor_user_id THEN
    RAISE EXCEPTION 'tzuyang_address_admin_approval_actor_forbidden'
      USING ERRCODE = '42501';
  END IF;

  -- Lock every unique replay binding in a deterministic order. The uniqueness
  -- constraints remain the final collision fence if an advisory hash collides.
  PERFORM pg_catalog.pg_advisory_xact_lock(lock_row.lock_key)
    FROM (
      SELECT DISTINCT pg_catalog.hashtextextended(binding.value, 0) AS lock_key
        FROM unnest(ARRAY[
          'tzuyang-address-approval-operation:' || p_operation_id::text,
          'tzuyang-address-approval-envelope:' || p_approval_envelope_sha256,
          'tzuyang-address-approval-nonce:' || p_nonce_sha256
        ]) AS binding(value)
       ORDER BY lock_key
    ) AS lock_row;

  SELECT receipt.*
    INTO v_existing
    FROM privacy_retention.tzuyang_address_evidence_admin_approval_receipts AS receipt
   WHERE receipt.operation_id = p_operation_id
   FOR UPDATE;

  IF FOUND THEN
    IF v_existing.approval_envelope_sha256 = p_approval_envelope_sha256
       AND v_existing.nonce_sha256 = p_nonce_sha256
       AND v_existing.actor_user_id = p_actor_user_id
       AND v_existing.review_manifest_sha256 = p_review_manifest_sha256
       AND v_existing.signer_id = p_signer_id
       AND v_existing.action = p_action
       AND v_existing.issued_at = p_issued_at
       AND v_existing.expires_at = p_expires_at THEN
      RETURN QUERY SELECT false, 'replayed'::text;
      RETURN;
    END IF;

    RAISE EXCEPTION 'tzuyang_address_admin_approval_binding_conflict'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
    FROM privacy_retention.tzuyang_address_evidence_admin_approval_receipts AS receipt
   WHERE receipt.approval_envelope_sha256 = p_approval_envelope_sha256
      OR receipt.nonce_sha256 = p_nonce_sha256
   FOR UPDATE;

  IF FOUND THEN
    RAISE EXCEPTION 'tzuyang_address_admin_approval_binding_conflict'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO privacy_retention.tzuyang_address_evidence_admin_approval_receipts (
    operation_id,
    approval_envelope_sha256,
    nonce_sha256,
    actor_user_id,
    review_manifest_sha256,
    signer_id,
    action,
    issued_at,
    expires_at,
    consumed_at
  ) VALUES (
    p_operation_id,
    p_approval_envelope_sha256,
    p_nonce_sha256,
    p_actor_user_id,
    p_review_manifest_sha256,
    p_signer_id,
    p_action,
    p_issued_at,
    p_expires_at,
    v_now
  );

  RETURN QUERY SELECT true, 'consumed'::text;
END;
$function$;
ALTER FUNCTION public.consume_tzuyang_address_evidence_admin_approval(
  uuid, text, text, uuid, text, text, text, timestamptz, timestamptz
) OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.consume_tzuyang_address_evidence_admin_approval(
  uuid, text, text, uuid, text, text, text, timestamptz, timestamptz
) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_tzuyang_address_evidence_admin_approval(
  uuid, text, text, uuid, text, text, text, timestamptz, timestamptz
) TO service_role;

NOTIFY pgrst, 'reload schema';
