-- G014.8: under-14 guardian verification stays an external-provider hash
-- workflow. The public RPC signature is unchanged. Identity ciphertext,
-- date of birth, guardian contact, and resident registration numbers are
-- never accepted. Applied G014 migrations are not rewritten.
BEGIN;

DO $membership$
BEGIN
  IF pg_catalog.pg_has_role(session_user, 'supabase_admin', 'MEMBER') THEN
    EXECUTE 'SET LOCAL ROLE supabase_admin';
  END IF;
  IF NOT pg_catalog.pg_has_role(session_user, 'privacy_workflow_owner', 'MEMBER') THEN
    EXECUTE pg_catalog.format('GRANT privacy_workflow_owner TO %I', session_user);
    PERFORM pg_catalog.set_config('g014_8.temporary_membership', 'true', true);
  ELSE
    PERFORM pg_catalog.set_config('g014_8.temporary_membership', 'false', true);
  END IF;
END
$membership$;

RESET ROLE;
SET LOCAL ROLE privacy_workflow_owner;

DO $preflight$
BEGIN
  IF pg_catalog.to_regprocedure(
    'public.record_privacy_guardian_verification(uuid,uuid,text,text,text,timestamptz,timestamptz)'
  ) IS NULL THEN
    RAISE EXCEPTION 'g014_8_guardian_verification_rpc_missing';
  END IF;
  IF pg_catalog.to_regclass('privacy_retention.privacy_guardian_verifications') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.privacy_age_profiles') IS NULL THEN
    RAISE EXCEPTION 'g014_8_guardian_tables_missing';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_guardian_verifications AS guardian
    WHERE guardian.guardian_name_ciphertext IS NOT NULL
       OR guardian.guardian_contact_ciphertext IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'g014_8_guardian_identity_ciphertext_present';
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION public.record_privacy_guardian_verification(
  p_verification_id uuid,
  p_child_user_id uuid,
  p_status text,
  p_provider text,
  p_provider_reference_hash text,
  p_verified_at timestamptz DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_existing privacy_retention.privacy_guardian_verifications%ROWTYPE;
  v_profile privacy_retention.privacy_age_profiles%ROWTYPE;
  v_written privacy_retention.privacy_guardian_verifications%ROWTYPE;
  v_audit_id uuid;
  v_changed boolean := false;
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  IF p_verification_id IS NULL
     OR p_child_user_id IS NULL
     OR p_status IS NULL
     OR p_status NOT IN ('pending', 'verified', 'rejected', 'expired', 'withdrawn')
     OR p_provider IS NULL
     OR p_provider !~ '^[A-Za-z0-9._-]{1,80}$'
     OR p_provider_reference_hash IS NULL
     OR p_provider_reference_hash !~ '^[0-9a-f]{64}$'
     OR (
       p_status = 'verified'
       AND (
         p_verified_at IS NULL
         OR p_verified_at > pg_catalog.clock_timestamp()
         OR p_expires_at IS NULL
         OR p_expires_at <= p_verified_at
         OR p_expires_at <= pg_catalog.clock_timestamp()
       )
     )
     OR (p_status IS DISTINCT FROM 'verified' AND (p_verified_at IS NOT NULL OR p_expires_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'privacy_guardian_verification_request_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_profile
  FROM privacy_retention.privacy_age_profiles AS profile
  WHERE profile.user_id = p_child_user_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_profile.age_band <> 'under_14'
     OR v_profile.status NOT IN ('guardian_pending', 'guardian_verified', 'guardian_withdrawn') THEN
    RAISE EXCEPTION 'privacy_guardian_child_binding_invalid' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_existing
  FROM privacy_retention.privacy_guardian_verifications AS guardian
  WHERE guardian.id = p_verification_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.child_user_id IS DISTINCT FROM p_child_user_id
       OR v_existing.provider IS DISTINCT FROM p_provider
       OR v_existing.provider_reference_hash IS DISTINCT FROM p_provider_reference_hash THEN
      RAISE EXCEPTION 'privacy_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    IF v_existing.guardian_name_ciphertext IS NOT NULL
       OR v_existing.guardian_contact_ciphertext IS NOT NULL THEN
      RAISE EXCEPTION 'privacy_guardian_identity_forbidden' USING ERRCODE = '22023';
    END IF;
    IF v_existing.status IS DISTINCT FROM p_status THEN
      IF NOT (
        (v_existing.status = 'pending' AND p_status IN ('verified', 'rejected', 'expired', 'withdrawn'))
        OR (v_existing.status = 'verified' AND p_status IN ('expired', 'withdrawn'))
      ) THEN
        RAISE EXCEPTION 'privacy_guardian_transition_invalid' USING ERRCODE = '23514';
      END IF;
      UPDATE privacy_retention.privacy_guardian_verifications AS guardian
      SET status = p_status,
          verified_at = p_verified_at,
          expires_at = p_expires_at,
          withdrawn_at = CASE WHEN p_status = 'withdrawn' THEN pg_catalog.clock_timestamp() ELSE NULL END,
          guardian_name_ciphertext = NULL,
          guardian_contact_ciphertext = NULL,
          updated_at = pg_catalog.clock_timestamp()
      WHERE guardian.id = p_verification_id;
      v_changed := true;
    ELSIF v_existing.verified_at IS DISTINCT FROM p_verified_at
       OR v_existing.expires_at IS DISTINCT FROM p_expires_at THEN
      RAISE EXCEPTION 'privacy_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
  ELSE
    INSERT INTO privacy_retention.privacy_guardian_verifications (
      id,
      child_user_id,
      status,
      provider,
      provider_reference_hash,
      guardian_name_ciphertext,
      guardian_contact_ciphertext,
      verified_at,
      expires_at,
      withdrawn_at,
      updated_at
    ) VALUES (
      p_verification_id,
      p_child_user_id,
      p_status,
      p_provider,
      p_provider_reference_hash,
      NULL,
      NULL,
      p_verified_at,
      p_expires_at,
      CASE WHEN p_status = 'withdrawn' THEN pg_catalog.clock_timestamp() ELSE NULL END,
      pg_catalog.clock_timestamp()
    );
    v_changed := true;
  END IF;

  SELECT * INTO v_written
  FROM privacy_retention.privacy_guardian_verifications AS guardian
  WHERE guardian.id = p_verification_id;
  IF NOT FOUND
     OR v_written.guardian_name_ciphertext IS NOT NULL
     OR v_written.guardian_contact_ciphertext IS NOT NULL
     OR v_written.child_user_id IS DISTINCT FROM p_child_user_id
     OR v_written.status IS DISTINCT FROM p_status
     OR v_written.provider IS DISTINCT FROM p_provider
     OR v_written.provider_reference_hash IS DISTINCT FROM p_provider_reference_hash THEN
    RAISE EXCEPTION 'privacy_guardian_verification_readback_failed' USING ERRCODE = '55000';
  END IF;

  PERFORM public.privacy_refresh_age_profile(p_child_user_id);
  IF v_changed THEN
    v_audit_id := privacy_retention.append_privacy_audit_event_internal(
      'guardian_verification_recorded',
      NULL,
      p_child_user_id,
      p_verification_id,
      p_verification_id,
      'applied',
      'GUARDIAN_VERIFICATION_RECORDED',
      pg_catalog.jsonb_build_object('guardianVerified', p_status = 'verified'),
      pg_catalog.jsonb_build_object('route', '/api/privacy/guardian')
    );
  ELSE
    SELECT audit.id INTO v_audit_id
    FROM privacy_retention.privacy_audit_events AS audit
    WHERE audit.operation_id = p_verification_id
      AND audit.event_type = 'guardian_verification_recorded'
    ORDER BY audit.created_at DESC, audit.id DESC
    LIMIT 1;
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'privacy_guardian_audit_missing' USING ERRCODE = '55000';
    END IF;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'operationId', p_verification_id::text,
    'status', 'applied',
    'readback', pg_catalog.jsonb_build_object(
      'passed', true,
      'checks', pg_catalog.jsonb_build_object(
        'verificationRecorded', true,
        'verified', p_status = 'verified',
        'identityOmitted', true
      )
    ),
    'auditId', v_audit_id::text,
    'guardianStatus', p_status
  );
END;
$function$;

ALTER FUNCTION public.record_privacy_guardian_verification(uuid, uuid, text, text, text, timestamptz, timestamptz)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.record_privacy_guardian_verification(uuid, uuid, text, text, text, timestamptz, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_privacy_guardian_verification(uuid, uuid, text, text, text, timestamptz, timestamptz)
  TO service_role;

SELECT privacy_retention.assert_g014_public_rpc_allowlist();
SELECT privacy_retention.assert_g014_catalog_contract();

NOTIFY pgrst, 'reload schema';
RESET ROLE;

DO $membership$
BEGIN
  IF pg_catalog.pg_has_role(session_user, 'supabase_admin', 'MEMBER') THEN
    EXECUTE 'SET LOCAL ROLE supabase_admin';
  END IF;
  IF pg_catalog.current_setting('g014_8.temporary_membership', true) = 'true' THEN
    EXECUTE pg_catalog.format('REVOKE privacy_workflow_owner FROM %I', session_user);
  END IF;
END
$membership$;

RESET ROLE;
COMMIT;
