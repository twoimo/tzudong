-- G014-02: private, fail-closed privacy workflow RPCs.
-- This migration follows G014-01. It confines retained workflow data to
-- privacy_retention and adds one durable, service-only compensation hold.

CREATE OR REPLACE FUNCTION privacy_retention.g014_require_service_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
BEGIN
  v_role := COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  IF v_role <> 'service_role' THEN
    RAISE EXCEPTION 'privacy_service_role_required' USING ERRCODE = '42501';
  END IF;
END;
$function$;
ALTER FUNCTION privacy_retention.g014_require_service_role() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_require_service_role() FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE privacy_retention.privacy_onboarding_compensation_holds (
  operation_id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  audit_event_id uuid NOT NULL UNIQUE REFERENCES privacy_retention.privacy_audit_events(id) ON DELETE RESTRICT,
  challenge_id uuid NOT NULL REFERENCES privacy_retention.privacy_onboarding_challenges(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL,
  operation_code text NOT NULL DEFAULT 'onboarding_compensation_hold'
    CHECK (operation_code = 'onboarding_compensation_hold'),
  idempotency_key text NOT NULL UNIQUE
    CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  state text NOT NULL DEFAULT 'active' CHECK (state = 'active'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (challenge_id, user_id, operation_code)
);
CREATE INDEX privacy_onboarding_compensation_holds_active_user_idx
  ON privacy_retention.privacy_onboarding_compensation_holds (user_id, operation_code)
  WHERE state = 'active';
ALTER TABLE privacy_retention.privacy_onboarding_compensation_holds
  OWNER TO privacy_workflow_owner;
ALTER TABLE privacy_retention.privacy_onboarding_compensation_holds
  ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_retention.privacy_onboarding_compensation_holds
  FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE privacy_retention.privacy_onboarding_compensation_holds
  FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE privacy_retention.privacy_onboarding_compensation_holds
  TO privacy_workflow_owner;
CREATE POLICY g014_privacy_onboarding_compensation_holds_owner_access
  ON privacy_retention.privacy_onboarding_compensation_holds
  FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION privacy_retention.g014_reject_onboarding_compensation_hold_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'privacy_onboarding_compensation_hold_immutable' USING ERRCODE = '55000';
END;
$function$;
ALTER FUNCTION privacy_retention.g014_reject_onboarding_compensation_hold_mutation()
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_reject_onboarding_compensation_hold_mutation()
  FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER g014_privacy_onboarding_compensation_holds_append_only
BEFORE UPDATE OR DELETE ON privacy_retention.privacy_onboarding_compensation_holds
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_reject_onboarding_compensation_hold_mutation();

CREATE OR REPLACE FUNCTION privacy_retention.append_privacy_audit_event_internal(
  p_event_type text,
  p_actor_user_id uuid,
  p_subject_user_id uuid,
  p_operation_id uuid,
  p_correlation_id uuid,
  p_status text,
  p_reason_code text,
  p_count_summary jsonb,
  p_request_metadata jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_audit_id uuid;
  v_occurred_at timestamptz := pg_catalog.clock_timestamp();
  v_class_code text;
  v_retention_until timestamptz;
BEGIN
  IF p_event_type IS NULL
     OR p_operation_id IS NULL
     OR p_correlation_id IS NULL
     OR p_status IS NULL
     OR p_status NOT IN ('previewed', 'confirmed', 'applied', 'partial', 'failed', 'readback_passed', 'readback_failed', 'held')
     OR p_reason_code IS NULL
     OR p_reason_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
     OR NOT public.privacy_audit_count_summary_is_safe(COALESCE(p_count_summary, '{}'::jsonb))
     OR NOT public.privacy_audit_metadata_is_safe(COALESCE(p_request_metadata, '{}'::jsonb)) THEN
    RAISE EXCEPTION 'privacy_audit_request_invalid' USING ERRCODE = '22023';
  END IF;

  v_class_code := CASE
    WHEN p_event_type IN (
      'onboarding_challenge_created',
      'onboarding_confirmed',
      'consent_recorded',
      'guardian_verification_recorded',
      'policy_published',
      'onboarding_challenge_transition',
      'onboarding_compensation_held'
    ) THEN 'privacy_identity_audit'
    WHEN p_event_type = 'account_deletion' THEN 'privacy_account_deletion_audit'
    ELSE NULL
  END;
  IF v_class_code IS NULL THEN
    RAISE EXCEPTION 'privacy_audit_event_type_not_supported' USING ERRCODE = '22023';
  END IF;

  v_retention_until := public.privacy_resolve_audit_retention_until(v_class_code, v_occurred_at);

  INSERT INTO privacy_retention.privacy_audit_events (
    event_type,
    actor_user_id,
    subject_ref_hash,
    operation_id,
    correlation_id,
    status,
    reason_code,
    count_summary,
    request_metadata,
    occurred_at,
    retention_until
  ) VALUES (
    p_event_type,
    p_actor_user_id,
    CASE
      WHEN p_subject_user_id IS NULL THEN NULL
      ELSE pg_catalog.encode(
        extensions.digest('privacy-subject:v1:' || p_subject_user_id::text, 'sha256'),
        'hex'
      )
    END,
    p_operation_id,
    p_correlation_id,
    p_status,
    p_reason_code,
    COALESCE(p_count_summary, '{}'::jsonb),
    COALESCE(p_request_metadata, '{}'::jsonb),
    v_occurred_at,
    v_retention_until
  )
  RETURNING id INTO v_audit_id;

  RETURN v_audit_id;
END;
$function$;
ALTER FUNCTION privacy_retention.append_privacy_audit_event_internal(text, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.append_privacy_audit_event_internal(text, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.append_privacy_audit_event(
  p_event_type text,
  p_actor_user_id uuid,
  p_subject_user_id uuid,
  p_operation_id uuid,
  p_correlation_id uuid,
  p_status text,
  p_reason_code text,
  p_count_summary jsonb,
  p_request_metadata jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  RETURN privacy_retention.append_privacy_audit_event_internal(
    p_event_type,
    p_actor_user_id,
    p_subject_user_id,
    p_operation_id,
    p_correlation_id,
    p_status,
    p_reason_code,
    p_count_summary,
    p_request_metadata
  );
END;
$function$;
ALTER FUNCTION public.append_privacy_audit_event(text, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.append_privacy_audit_event(text, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.append_privacy_audit_event(text, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb)
  TO service_role;

-- Preserve the G010 identity for existing service workflows while routing all
-- writes through the narrow retention-resolving implementation above.
CREATE OR REPLACE FUNCTION public.privacy_append_audit_event(
  p_event_type text,
  p_actor_user_id uuid,
  p_subject_user_id uuid,
  p_operation_id uuid,
  p_correlation_id uuid,
  p_status text,
  p_reason_code text,
  p_count_summary jsonb,
  p_request_metadata jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  RETURN privacy_retention.append_privacy_audit_event_internal(
    p_event_type,
    p_actor_user_id,
    p_subject_user_id,
    p_operation_id,
    p_correlation_id,
    p_status,
    p_reason_code,
    p_count_summary,
    p_request_metadata
  );
END;
$function$;
ALTER FUNCTION public.privacy_append_audit_event(text, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.privacy_append_audit_event(text, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_current_privacy_policy_version()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_policy privacy_retention.privacy_policy_versions%ROWTYPE;
BEGIN
  v_role := COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  IF v_role NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION 'privacy_authentication_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_policy
  FROM privacy_retention.privacy_policy_versions AS policy
  WHERE policy.status = 'published'
    AND policy.effective_at <= pg_catalog.clock_timestamp()
  ORDER BY policy.effective_at DESC, policy.id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'privacy_current_policy_unavailable' USING ERRCODE = 'P0002';
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'policyVersionId', v_policy.id::text,
    'version', v_policy.version,
    'locale', v_policy.locale,
    'contentSha256', v_policy.content_sha256,
    'effectiveAt', pg_catalog.to_char(v_policy.effective_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'publishedAt', pg_catalog.to_char(v_policy.published_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'approvalBound', pg_catalog.length(pg_catalog.btrim(v_policy.operator_approval_ref)) > 0
  );
END;
$function$;
ALTER FUNCTION public.get_current_privacy_policy_version() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.get_current_privacy_policy_version() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_current_privacy_policy_version() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.publish_privacy_policy_version(
  p_version text,
  p_locale text,
  p_content_sha256 text,
  p_effective_at timestamptz,
  p_supersedes_id uuid,
  p_operator_approval_ref text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_existing_audit privacy_retention.privacy_audit_events%ROWTYPE;
  v_existing_policy privacy_retention.privacy_policy_versions%ROWTYPE;
  v_previous_policy privacy_retention.privacy_policy_versions%ROWTYPE;
  v_policy_id uuid;
  v_audit_id uuid;
  v_published_at timestamptz;
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  IF p_version IS NULL
     OR p_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
     OR p_locale IS DISTINCT FROM 'ko-KR'
     OR p_content_sha256 IS NULL
     OR p_content_sha256 !~ '^[0-9a-f]{64}$'
     OR p_effective_at IS NULL
     OR p_operator_approval_ref IS NULL
     OR p_operator_approval_ref !~ '^[A-Za-z0-9._:-]{1,128}$'
     OR p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' THEN
    RAISE EXCEPTION 'privacy_policy_publish_request_invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-policy:' || p_idempotency_key, 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-policy-publication-state', 0)
  );
  SELECT * INTO v_existing_audit
  FROM privacy_retention.privacy_audit_events AS audit
  WHERE audit.event_type = 'policy_published'
    AND audit.request_metadata ->> 'requestId' = p_idempotency_key
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO v_existing_policy
    FROM privacy_retention.privacy_policy_versions AS policy
    WHERE policy.id = v_existing_audit.operation_id
    FOR UPDATE;
    IF NOT FOUND
       OR v_existing_policy.version IS DISTINCT FROM p_version
       OR v_existing_policy.locale IS DISTINCT FROM p_locale
       OR v_existing_policy.content_sha256 IS DISTINCT FROM p_content_sha256
       OR v_existing_policy.effective_at IS DISTINCT FROM p_effective_at
       OR v_existing_policy.supersedes_id IS DISTINCT FROM p_supersedes_id
       OR v_existing_policy.operator_approval_ref IS DISTINCT FROM p_operator_approval_ref THEN
      RAISE EXCEPTION 'privacy_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'applied',
      'policyVersionId', v_existing_policy.id::text,
      'version', v_existing_policy.version,
      'contentSha256', v_existing_policy.content_sha256,
      'effectiveAt', pg_catalog.to_char(v_existing_policy.effective_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'auditId', v_existing_audit.id::text
    );
  END IF;

  SELECT * INTO v_previous_policy
  FROM privacy_retention.privacy_policy_versions AS policy
  WHERE policy.status = 'published'
  ORDER BY policy.effective_at DESC, policy.id DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    IF p_supersedes_id IS DISTINCT FROM v_previous_policy.id
       OR p_effective_at <= v_previous_policy.effective_at THEN
      RAISE EXCEPTION 'privacy_policy_publish_transition_invalid' USING ERRCODE = '23514';
    END IF;
  ELSIF p_supersedes_id IS NOT NULL THEN
    RAISE EXCEPTION 'privacy_policy_publish_transition_invalid' USING ERRCODE = '23514';
  END IF;

  v_published_at := pg_catalog.clock_timestamp();
  INSERT INTO privacy_retention.privacy_policy_versions (
    version,
    locale,
    status,
    content_sha256,
    effective_at,
    published_at,
    supersedes_id,
    operator_approval_ref
  ) VALUES (
    p_version,
    p_locale,
    'published',
    p_content_sha256,
    p_effective_at,
    v_published_at,
    p_supersedes_id,
    p_operator_approval_ref
  )
  RETURNING id INTO v_policy_id;

  v_audit_id := privacy_retention.append_privacy_audit_event_internal(
    'policy_published',
    NULL,
    NULL,
    v_policy_id,
    v_policy_id,
    'applied',
    'PRIVACY_POLICY_PUBLISHED',
    pg_catalog.jsonb_build_object('created', 1),
    pg_catalog.jsonb_build_object('requestId', p_idempotency_key, 'route', '/api/privacy/policy')
  );
  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'status', 'applied',
    'policyVersionId', v_policy_id::text,
    'version', p_version,
    'contentSha256', p_content_sha256,
    'effectiveAt', pg_catalog.to_char(p_effective_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'auditId', v_audit_id::text
  );
END;
$function$;
ALTER FUNCTION public.publish_privacy_policy_version(text, text, text, timestamptz, uuid, text, text)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.publish_privacy_policy_version(text, text, text, timestamptz, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.publish_privacy_policy_version(text, text, text, timestamptz, uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.create_privacy_onboarding_challenge(
  p_token_hash text,
  p_policy_version_id uuid,
  p_age_band text,
  p_requested_consents jsonb,
  p_oauth_nonce_hash text DEFAULT NULL,
  p_expires_at timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_policy_id uuid;
  v_challenge_id uuid;
  v_expires_at timestamptz := COALESCE(p_expires_at, pg_catalog.clock_timestamp() + interval '15 minutes');
  v_audit_id uuid;
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  IF p_token_hash IS NULL
     OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_age_band IS NULL
     OR p_age_band NOT IN ('unknown', 'age_14_plus', 'under_14')
     OR NOT public.privacy_requested_consents_are_valid(COALESCE(p_requested_consents, '{}'::jsonb))
     OR (p_oauth_nonce_hash IS NOT NULL AND p_oauth_nonce_hash !~ '^[0-9a-f]{64}$')
     OR v_expires_at <= pg_catalog.clock_timestamp()
     OR v_expires_at > pg_catalog.clock_timestamp() + interval '15 minutes' THEN
    RAISE EXCEPTION 'privacy_onboarding_request_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT policy.id INTO v_policy_id
  FROM privacy_retention.privacy_policy_versions AS policy
  WHERE policy.status = 'published'
    AND policy.effective_at <= pg_catalog.clock_timestamp()
  ORDER BY policy.effective_at DESC, policy.id DESC
  LIMIT 1;
  IF v_policy_id IS NULL OR v_policy_id IS DISTINCT FROM p_policy_version_id THEN
    RAISE EXCEPTION 'privacy_current_policy_required' USING ERRCODE = '23514';
  END IF;

  INSERT INTO privacy_retention.privacy_onboarding_challenges (
    token_hash,
    policy_version_id,
    age_band,
    requested_consents,
    oauth_nonce_hash,
    expires_at
  ) VALUES (
    p_token_hash,
    p_policy_version_id,
    p_age_band,
    COALESCE(p_requested_consents, '{}'::jsonb),
    p_oauth_nonce_hash,
    v_expires_at
  )
  RETURNING id INTO v_challenge_id;

  v_audit_id := privacy_retention.append_privacy_audit_event_internal(
    'onboarding_challenge_created',
    NULL,
    NULL,
    v_challenge_id,
    v_challenge_id,
    'applied',
    'ONBOARDING_CHALLENGE_CREATED',
    pg_catalog.jsonb_build_object('requested', 1),
    pg_catalog.jsonb_build_object('route', '/api/privacy/onboarding')
  );
  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'challengeId', v_challenge_id::text,
    'policyVersionId', p_policy_version_id::text,
    'ageBand', p_age_band,
    'expiresAt', pg_catalog.to_char(v_expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'auditId', v_audit_id::text
  );
END;
$function$;
ALTER FUNCTION public.create_privacy_onboarding_challenge(text, uuid, text, jsonb, text, timestamptz)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.create_privacy_onboarding_challenge(text, uuid, text, jsonb, text, timestamptz)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_privacy_onboarding_challenge(text, uuid, text, jsonb, text, timestamptz)
  TO service_role;

CREATE OR REPLACE FUNCTION public.transition_privacy_onboarding_challenge(
  p_challenge_id uuid,
  p_expected_state text,
  p_next_state text,
  p_user_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_challenge privacy_retention.privacy_onboarding_challenges%ROWTYPE;
  v_existing_audit privacy_retention.privacy_audit_events%ROWTYPE;
  v_audit_id uuid;
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  IF p_challenge_id IS NULL
     OR p_user_id IS NULL
     OR p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$'
     OR p_expected_state IS DISTINCT FROM 'pending'
     OR p_next_state IS DISTINCT FROM 'consumed' THEN
    RAISE EXCEPTION 'privacy_onboarding_transition_invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-challenge:' || p_idempotency_key, 0)
  );
  SELECT * INTO v_existing_audit
  FROM privacy_retention.privacy_audit_events AS audit
  WHERE audit.event_type = 'onboarding_challenge_transition'
    AND audit.request_metadata ->> 'requestId' = p_idempotency_key
  ORDER BY audit.created_at DESC, audit.id DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing_audit.operation_id IS DISTINCT FROM p_challenge_id
       OR v_existing_audit.actor_user_id IS DISTINCT FROM p_user_id
       OR v_existing_audit.reason_code <> 'ONBOARDING_CHALLENGE_CONSUMED' THEN
      RAISE EXCEPTION 'privacy_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'applied',
      'challengeId', p_challenge_id::text,
      'userId', p_user_id::text,
      'state', 'consumed',
      'auditId', v_existing_audit.id::text
    );
  END IF;

  SELECT * INTO v_challenge
  FROM privacy_retention.privacy_onboarding_challenges AS challenge
  WHERE challenge.id = p_challenge_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_challenge.consumed_at IS NOT NULL
     OR v_challenge.expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'privacy_onboarding_transition_invalid' USING ERRCODE = '23514';
  END IF;

  UPDATE privacy_retention.privacy_onboarding_challenges AS challenge
  SET consumed_at = pg_catalog.clock_timestamp(),
      consumed_by_user_id = p_user_id
  WHERE challenge.id = p_challenge_id
    AND challenge.consumed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'privacy_onboarding_transition_invalid' USING ERRCODE = '55000';
  END IF;

  v_audit_id := privacy_retention.append_privacy_audit_event_internal(
    'onboarding_challenge_transition',
    p_user_id,
    p_user_id,
    p_challenge_id,
    p_challenge_id,
    'applied',
    'ONBOARDING_CHALLENGE_CONSUMED',
    pg_catalog.jsonb_build_object('updated', 1),
    pg_catalog.jsonb_build_object('requestId', p_idempotency_key, 'route', '/api/privacy/onboarding')
  );
  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'status', 'applied',
    'challengeId', p_challenge_id::text,
    'userId', p_user_id::text,
    'state', 'consumed',
    'auditId', v_audit_id::text
  );
END;
$function$;
ALTER FUNCTION public.transition_privacy_onboarding_challenge(uuid, text, text, uuid, text)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.transition_privacy_onboarding_challenge(uuid, text, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.transition_privacy_onboarding_challenge(uuid, text, text, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.confirm_privacy_onboarding(
  p_challenge_id uuid,
  p_challenge_token text,
  p_user_id uuid,
  p_source text,
  p_guardian_verification_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_challenge privacy_retention.privacy_onboarding_challenges%ROWTYPE;
  v_policy privacy_retention.privacy_policy_versions%ROWTYPE;
  v_audit_id uuid;
  v_existing_audit privacy_retention.privacy_audit_events%ROWTYPE;
  v_event_count integer := 0;
  v_status text;
  v_receipt_status text;
  v_error_code text;
  v_idempotency_prefix text;
  v_guardian privacy_retention.privacy_guardian_verifications%ROWTYPE;
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  IF p_challenge_id IS NULL
     OR p_user_id IS NULL
     OR p_challenge_token IS NULL
     OR pg_catalog.length(p_challenge_token) NOT BETWEEN 16 AND 512
     OR p_source IS NULL
     OR p_source NOT IN ('password_signup', 'oauth') THEN
    RAISE EXCEPTION 'privacy_onboarding_confirmation_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_challenge
  FROM privacy_retention.privacy_onboarding_challenges AS challenge
  WHERE challenge.id = p_challenge_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_challenge.token_hash IS DISTINCT FROM pg_catalog.encode(extensions.digest(p_challenge_token, 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'privacy_onboarding_challenge_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_challenge.consumed_at IS NOT NULL THEN
    IF v_challenge.consumed_by_user_id IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'privacy_onboarding_challenge_already_consumed' USING ERRCODE = '42501';
    END IF;
    SELECT * INTO v_existing_audit
    FROM privacy_retention.privacy_audit_events AS audit
    WHERE audit.operation_id = p_challenge_id
      AND audit.event_type = 'onboarding_confirmed'
      AND audit.correlation_id = p_challenge_id
      AND audit.actor_user_id = p_user_id
    ORDER BY audit.created_at DESC, audit.id DESC
    LIMIT 1
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'privacy_onboarding_confirmation_audit_missing' USING ERRCODE = '55000';
    END IF;

    v_status := CASE v_challenge.age_band
      WHEN 'age_14_plus' THEN 'eligible'
      WHEN 'under_14' THEN 'guardian_pending'
      ELSE 'pending'
    END;
    v_receipt_status := CASE WHEN v_status = 'eligible' THEN 'applied' ELSE 'held' END;
    v_error_code := CASE
      WHEN v_status = 'guardian_pending' THEN 'PRIVACY_GUARDIAN_REQUIRED'
      WHEN v_status = 'pending' THEN 'PRIVACY_AGE_ATTESTATION_REQUIRED'
      ELSE NULL
    END;
    v_event_count := COALESCE((v_existing_audit.count_summary ->> 'consentEvents')::integer, -1);
    IF v_existing_audit.status IS DISTINCT FROM v_receipt_status
       OR v_existing_audit.reason_code IS DISTINCT FROM (
         CASE
           WHEN v_receipt_status = 'applied' THEN 'ONBOARDING_CONFIRMED'
           ELSE 'ONBOARDING_HELD'
         END
       )
       OR (v_challenge.age_band = 'age_14_plus' AND v_event_count < 1)
       OR (v_challenge.age_band <> 'age_14_plus' AND v_event_count <> 0) THEN
      RAISE EXCEPTION 'privacy_onboarding_confirmation_audit_invalid' USING ERRCODE = '55000';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'operationId', p_challenge_id::text,
      'challengeId', p_challenge_id::text,
      'userId', p_user_id::text,
      'policyVersionId', v_challenge.policy_version_id::text,
      'eligible', v_receipt_status = 'applied',
      'status', v_receipt_status,
      'readback', pg_catalog.jsonb_build_object(
        'passed', true,
        'checks', pg_catalog.jsonb_build_object(
          'challengeConsumed', true,
          'ageProfileRecorded', true,
          'requiredConsentRecorded', v_event_count > 0,
          'eligible', v_status = 'eligible'
        )
      ),
      'auditId', v_existing_audit.id::text,
      'errorCode', v_error_code,
      'ageStatus', v_status
    );
  END IF;
  IF v_challenge.expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'privacy_onboarding_challenge_expired' USING ERRCODE = 'P0002';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-policy-publication-state', 0)
  );

  SELECT * INTO v_policy
  FROM privacy_retention.privacy_policy_versions AS policy
  WHERE policy.status = 'published'
    AND policy.effective_at <= pg_catalog.clock_timestamp()
  ORDER BY policy.effective_at DESC, policy.id DESC
  LIMIT 1;
  IF NOT FOUND OR v_policy.id IS DISTINCT FROM v_challenge.policy_version_id THEN
    RAISE EXCEPTION 'privacy_current_policy_required' USING ERRCODE = '23514';
  END IF;
  IF p_guardian_verification_id IS NOT NULL THEN
    IF v_challenge.age_band <> 'under_14' THEN
      RAISE EXCEPTION 'privacy_guardian_verification_not_applicable' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_guardian
    FROM privacy_retention.privacy_guardian_verifications AS guardian
    WHERE guardian.id = p_guardian_verification_id
    FOR UPDATE;
    IF NOT FOUND
       OR v_guardian.child_user_id IS DISTINCT FROM p_user_id
       OR v_guardian.status <> 'verified'
       OR v_guardian.verified_at IS NULL
       OR v_guardian.verified_at > pg_catalog.clock_timestamp()
       OR v_guardian.expires_at IS NULL
       OR v_guardian.expires_at <= pg_catalog.clock_timestamp()
       OR v_guardian.withdrawn_at IS NOT NULL THEN
      RAISE EXCEPTION 'privacy_guardian_verification_required' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_age_profiles AS profile
    WHERE profile.user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'privacy_onboarding_already_confirmed' USING ERRCODE = '23505';
  END IF;

  v_status := CASE v_challenge.age_band
    WHEN 'age_14_plus' THEN 'eligible'
    WHEN 'under_14' THEN 'guardian_pending'
    ELSE 'pending'
  END;
  INSERT INTO privacy_retention.privacy_age_profiles (
    user_id,
    age_band,
    attested_at,
    method,
    status,
    policy_version_id
  ) VALUES (
    p_user_id,
    v_challenge.age_band,
    pg_catalog.clock_timestamp(),
    'self_attestation',
    v_status,
    v_challenge.policy_version_id
  );

  v_idempotency_prefix := 'onb' || pg_catalog.replace(p_challenge_id::text, '-', '');
  IF v_challenge.age_band = 'age_14_plus' THEN
    INSERT INTO privacy_retention.privacy_consent_events (
      user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256,
      source, correlation_id, idempotency_key
    ) VALUES (
      p_user_id, 'self', 'privacy_required', 'none', 'granted', v_policy.id, v_policy.content_sha256,
      p_source, p_challenge_id, v_idempotency_prefix || 'required'
    );
    v_event_count := v_event_count + 1;
    IF COALESCE((v_challenge.requested_consents ->> 'email')::boolean, false) THEN
      INSERT INTO privacy_retention.privacy_consent_events (
        user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256,
        source, correlation_id, idempotency_key
      ) VALUES (
        p_user_id, 'self', 'email_marketing', 'email', 'granted', v_policy.id, v_policy.content_sha256,
        p_source, p_challenge_id, v_idempotency_prefix || 'email'
      );
      v_event_count := v_event_count + 1;
    END IF;
    IF COALESCE((v_challenge.requested_consents ->> 'sms')::boolean, false) THEN
      INSERT INTO privacy_retention.privacy_consent_events (
        user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256,
        source, correlation_id, idempotency_key
      ) VALUES (
        p_user_id, 'self', 'sms_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256,
        p_source, p_challenge_id, v_idempotency_prefix || 'sms'
      );
      v_event_count := v_event_count + 1;
    END IF;
    IF COALESCE((v_challenge.requested_consents ->> 'push')::boolean, false) THEN
      INSERT INTO privacy_retention.privacy_consent_events (
        user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256,
        source, correlation_id, idempotency_key
      ) VALUES (
        p_user_id, 'self', 'push_marketing', 'push', 'granted', v_policy.id, v_policy.content_sha256,
        p_source, p_challenge_id, v_idempotency_prefix || 'push'
      );
      v_event_count := v_event_count + 1;
    END IF;
    IF COALESCE((v_challenge.requested_consents ->> 'night_email')::boolean, false) THEN
      INSERT INTO privacy_retention.privacy_consent_events (
        user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256,
        source, correlation_id, idempotency_key
      ) VALUES (
        p_user_id, 'self', 'night_marketing', 'email', 'granted', v_policy.id, v_policy.content_sha256,
        p_source, p_challenge_id, v_idempotency_prefix || 'nightemail'
      );
      v_event_count := v_event_count + 1;
    END IF;
    IF COALESCE((v_challenge.requested_consents ->> 'night_sms')::boolean, false) THEN
      INSERT INTO privacy_retention.privacy_consent_events (
        user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256,
        source, correlation_id, idempotency_key
      ) VALUES (
        p_user_id, 'self', 'night_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256,
        p_source, p_challenge_id, v_idempotency_prefix || 'nightsms'
      );
      v_event_count := v_event_count + 1;
    END IF;
    IF COALESCE((v_challenge.requested_consents ->> 'night_push')::boolean, false) THEN
      INSERT INTO privacy_retention.privacy_consent_events (
        user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256,
        source, correlation_id, idempotency_key
      ) VALUES (
        p_user_id, 'self', 'night_marketing', 'push', 'granted', v_policy.id, v_policy.content_sha256,
        p_source, p_challenge_id, v_idempotency_prefix || 'nightpush'
      );
      v_event_count := v_event_count + 1;
    END IF;
  END IF;

  UPDATE privacy_retention.privacy_onboarding_challenges AS challenge
  SET consumed_at = pg_catalog.clock_timestamp(),
      consumed_by_user_id = p_user_id
  WHERE challenge.id = p_challenge_id
    AND challenge.consumed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'privacy_onboarding_transition_invalid' USING ERRCODE = '55000';
  END IF;

  SELECT profile.status INTO v_status
  FROM privacy_retention.privacy_age_profiles AS profile
  WHERE profile.user_id = p_user_id;
  v_receipt_status := CASE WHEN v_status IN ('eligible', 'guardian_verified') THEN 'applied' ELSE 'held' END;
  v_error_code := CASE
    WHEN v_status IN ('guardian_pending', 'guardian_withdrawn') THEN 'PRIVACY_GUARDIAN_REQUIRED'
    WHEN v_status IN ('pending', 'blocked') THEN 'PRIVACY_AGE_ATTESTATION_REQUIRED'
    ELSE NULL
  END;
  v_audit_id := privacy_retention.append_privacy_audit_event_internal(
    'onboarding_confirmed',
    p_user_id,
    p_user_id,
    p_challenge_id,
    p_challenge_id,
    v_receipt_status,
    CASE WHEN v_receipt_status = 'applied' THEN 'ONBOARDING_CONFIRMED' ELSE 'ONBOARDING_HELD' END,
    pg_catalog.jsonb_build_object('consentEvents', v_event_count, 'eligible', v_receipt_status = 'applied'),
    pg_catalog.jsonb_build_object('route', '/api/privacy/onboarding')
  );
  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'operationId', p_challenge_id::text,
    'challengeId', p_challenge_id::text,
    'userId', p_user_id::text,
    'policyVersionId', v_challenge.policy_version_id::text,
    'eligible', v_receipt_status = 'applied',
    'status', v_receipt_status,
    'readback', pg_catalog.jsonb_build_object(
      'passed', true,
      'checks', pg_catalog.jsonb_build_object(
        'challengeConsumed', true,
        'ageProfileRecorded', true,
        'requiredConsentRecorded', v_event_count > 0,
        'eligible', v_status IN ('eligible', 'guardian_verified')
      )
    ),
    'auditId', v_audit_id::text,
    'errorCode', v_error_code,
    'ageStatus', v_status
  );
END;
$function$;
ALTER FUNCTION public.confirm_privacy_onboarding(uuid, text, uuid, text, uuid) OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.confirm_privacy_onboarding(uuid, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_privacy_onboarding(uuid, text, uuid, text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.submit_privacy_consent(
  p_purpose text,
  p_channel text,
  p_decision text,
  p_policy_version_id uuid,
  p_notice_sha256 text,
  p_source text,
  p_guardian_verification_id uuid,
  p_idempotency_key text,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_user_id uuid := auth.uid();
  v_existing privacy_retention.privacy_consent_events%ROWTYPE;
  v_policy privacy_retention.privacy_policy_versions%ROWTYPE;
  v_profile privacy_retention.privacy_age_profiles%ROWTYPE;
  v_event_id uuid;
  v_audit_id uuid;
BEGIN
  v_role := COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  IF v_role <> 'authenticated' OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'privacy_authentication_required' USING ERRCODE = '42501';
  END IF;
  IF p_purpose IS NULL
     OR p_channel IS NULL
     OR p_decision IS NULL
     OR p_decision NOT IN ('granted', 'withdrawn')
     OR NOT (
       (p_purpose = 'email_marketing' AND p_channel = 'email')
       OR (p_purpose = 'sms_marketing' AND p_channel = 'sms')
       OR (p_purpose = 'push_marketing' AND p_channel = 'push')
       OR (p_purpose = 'night_marketing' AND p_channel IN ('email', 'sms', 'push'))
     )
     OR p_policy_version_id IS NULL
     OR p_notice_sha256 IS NULL
     OR p_notice_sha256 !~ '^[0-9a-f]{64}$'
     OR p_source IS DISTINCT FROM 'settings'
     OR p_guardian_verification_id IS NOT NULL
     OR p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$'
     OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'privacy_consent_request_invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-adult-consent:' || p_idempotency_key, 0)
  );
  SELECT * INTO v_existing
  FROM privacy_retention.privacy_consent_events AS event
  WHERE event.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.user_id IS DISTINCT FROM v_user_id
       OR v_existing.subject_kind <> 'self'
       OR v_existing.guardian_verification_id IS NOT NULL
       OR v_existing.purpose IS DISTINCT FROM p_purpose
       OR v_existing.channel IS DISTINCT FROM p_channel
       OR v_existing.decision IS DISTINCT FROM p_decision
       OR v_existing.policy_version_id IS DISTINCT FROM p_policy_version_id
       OR v_existing.notice_sha256 IS DISTINCT FROM p_notice_sha256
       OR v_existing.source IS DISTINCT FROM p_source
       OR v_existing.correlation_id IS DISTINCT FROM p_correlation_id THEN
      RAISE EXCEPTION 'privacy_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    SELECT audit.id INTO v_audit_id
    FROM privacy_retention.privacy_audit_events AS audit
    WHERE audit.operation_id = v_existing.id
      AND audit.event_type = 'consent_recorded'
      AND audit.correlation_id = p_correlation_id
      AND audit.actor_user_id = v_user_id
    ORDER BY audit.created_at DESC, audit.id DESC
    LIMIT 1;
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'privacy_consent_audit_missing' USING ERRCODE = '55000';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'operationId', p_correlation_id::text,
      'status', 'applied',
      'readback', pg_catalog.jsonb_build_object('passed', true, 'checks', pg_catalog.jsonb_build_object('consentEventPresent', true)),
      'auditId', v_audit_id::text,
      'consentEventId', v_existing.id::text
    );
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-policy-publication-state', 0)
  );

  SELECT * INTO v_policy
  FROM privacy_retention.privacy_policy_versions AS policy
  WHERE policy.status = 'published'
    AND policy.effective_at <= pg_catalog.clock_timestamp()
  ORDER BY policy.effective_at DESC, policy.id DESC
  LIMIT 1;
  IF NOT FOUND
     OR v_policy.id IS DISTINCT FROM p_policy_version_id
     OR v_policy.content_sha256 IS DISTINCT FROM p_notice_sha256 THEN
    RAISE EXCEPTION 'privacy_current_policy_required' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_profile
  FROM privacy_retention.privacy_age_profiles AS profile
  WHERE profile.user_id = v_user_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_profile.age_band <> 'age_14_plus'
     OR v_profile.status <> 'eligible' THEN
    RAISE EXCEPTION 'privacy_guardian_workflow_required' USING ERRCODE = '42501';
  END IF;

  INSERT INTO privacy_retention.privacy_consent_events (
    user_id,
    subject_kind,
    purpose,
    channel,
    decision,
    policy_version_id,
    notice_sha256,
    source,
    correlation_id,
    idempotency_key
  ) VALUES (
    v_user_id,
    'self',
    p_purpose,
    p_channel,
    p_decision,
    p_policy_version_id,
    p_notice_sha256,
    'settings',
    p_correlation_id,
    p_idempotency_key
  )
  RETURNING id INTO v_event_id;

  v_audit_id := privacy_retention.append_privacy_audit_event_internal(
    'consent_recorded',
    v_user_id,
    v_user_id,
    v_event_id,
    p_correlation_id,
    'applied',
    'CONSENT_RECORDED',
    pg_catalog.jsonb_build_object('consentEvents', 1),
    pg_catalog.jsonb_build_object('route', '/api/privacy/consent')
  );
  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'operationId', p_correlation_id::text,
    'status', 'applied',
    'readback', pg_catalog.jsonb_build_object('passed', true, 'checks', pg_catalog.jsonb_build_object('consentEventPresent', true)),
    'auditId', v_audit_id::text,
    'consentEventId', v_event_id::text
  );
END;
$function$;
ALTER FUNCTION public.submit_privacy_consent(text, text, text, uuid, text, text, uuid, text, uuid)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.submit_privacy_consent(text, text, text, uuid, text, text, uuid, text, uuid)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.submit_privacy_consent(text, text, text, uuid, text, text, uuid, text, uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_guardian_privacy_consent(
  p_purpose text,
  p_channel text,
  p_decision text,
  p_policy_version_id uuid,
  p_notice_sha256 text,
  p_guardian_verification_id uuid,
  p_idempotency_key text,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_existing privacy_retention.privacy_consent_events%ROWTYPE;
  v_guardian privacy_retention.privacy_guardian_verifications%ROWTYPE;
  v_profile privacy_retention.privacy_age_profiles%ROWTYPE;
  v_policy privacy_retention.privacy_policy_versions%ROWTYPE;
  v_event_id uuid;
  v_audit_id uuid;
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  IF p_purpose IS DISTINCT FROM 'privacy_required'
     OR p_channel IS DISTINCT FROM 'none'
     OR p_decision IS NULL
     OR p_decision NOT IN ('granted', 'withdrawn')
     OR p_policy_version_id IS NULL
     OR p_notice_sha256 IS NULL
     OR p_notice_sha256 !~ '^[0-9a-f]{64}$'
     OR p_guardian_verification_id IS NULL
     OR p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$'
     OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION 'privacy_guardian_consent_request_invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-guardian-consent:' || p_idempotency_key, 0)
  );
  SELECT * INTO v_existing
  FROM privacy_retention.privacy_consent_events AS event
  WHERE event.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.subject_kind <> 'child'
       OR v_existing.guardian_verification_id IS DISTINCT FROM p_guardian_verification_id
       OR v_existing.purpose IS DISTINCT FROM p_purpose
       OR v_existing.channel IS DISTINCT FROM p_channel
       OR v_existing.decision IS DISTINCT FROM p_decision
       OR v_existing.policy_version_id IS DISTINCT FROM p_policy_version_id
       OR v_existing.notice_sha256 IS DISTINCT FROM p_notice_sha256
       OR v_existing.source <> 'guardian'
       OR v_existing.correlation_id IS DISTINCT FROM p_correlation_id THEN
      RAISE EXCEPTION 'privacy_idempotency_conflict' USING ERRCODE = '23505';
    END IF;
    SELECT audit.id INTO v_audit_id
    FROM privacy_retention.privacy_audit_events AS audit
    WHERE audit.operation_id = v_existing.id
      AND audit.event_type = 'consent_recorded'
      AND audit.correlation_id = p_correlation_id
      AND audit.actor_user_id IS NULL
    ORDER BY audit.created_at DESC, audit.id DESC
    LIMIT 1;
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'privacy_consent_audit_missing' USING ERRCODE = '55000';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'operationId', p_correlation_id::text,
      'status', 'applied',
      'readback', pg_catalog.jsonb_build_object('passed', true, 'checks', pg_catalog.jsonb_build_object('consentEventPresent', true)),
      'auditId', v_audit_id::text,
      'consentEventId', v_existing.id::text
    );
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-policy-publication-state', 0)
  );

  SELECT * INTO v_guardian
  FROM privacy_retention.privacy_guardian_verifications AS guardian
  WHERE guardian.id = p_guardian_verification_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_guardian.status <> 'verified'
     OR v_guardian.verified_at IS NULL
     OR v_guardian.verified_at > pg_catalog.clock_timestamp()
     OR v_guardian.expires_at IS NULL
     OR v_guardian.expires_at <= pg_catalog.clock_timestamp()
     OR v_guardian.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'privacy_guardian_verification_required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_profile
  FROM privacy_retention.privacy_age_profiles AS profile
  WHERE profile.user_id = v_guardian.child_user_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_profile.age_band <> 'under_14'
     OR v_profile.status NOT IN ('guardian_pending', 'guardian_verified')
     OR v_profile.policy_version_id IS DISTINCT FROM p_policy_version_id THEN
    RAISE EXCEPTION 'privacy_guardian_child_binding_invalid' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_policy
  FROM privacy_retention.privacy_policy_versions AS policy
  WHERE policy.status = 'published'
    AND policy.effective_at <= pg_catalog.clock_timestamp()
  ORDER BY policy.effective_at DESC, policy.id DESC
  LIMIT 1;
  IF NOT FOUND
     OR v_policy.id IS DISTINCT FROM p_policy_version_id
     OR v_policy.content_sha256 IS DISTINCT FROM p_notice_sha256 THEN
    RAISE EXCEPTION 'privacy_current_policy_required' USING ERRCODE = '23514';
  END IF;

  INSERT INTO privacy_retention.privacy_consent_events (
    user_id,
    subject_kind,
    guardian_verification_id,
    purpose,
    channel,
    decision,
    policy_version_id,
    notice_sha256,
    source,
    correlation_id,
    idempotency_key
  ) VALUES (
    v_guardian.child_user_id,
    'child',
    v_guardian.id,
    'privacy_required',
    'none',
    p_decision,
    p_policy_version_id,
    p_notice_sha256,
    'guardian',
    p_correlation_id,
    p_idempotency_key
  )
  RETURNING id INTO v_event_id;

  v_audit_id := privacy_retention.append_privacy_audit_event_internal(
    'consent_recorded',
    NULL,
    v_guardian.child_user_id,
    v_event_id,
    p_correlation_id,
    'applied',
    'GUARDIAN_CONSENT_RECORDED',
    pg_catalog.jsonb_build_object('consentEvents', 1, 'guardianVerified', true),
    pg_catalog.jsonb_build_object('route', '/api/privacy/guardian')
  );
  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'operationId', p_correlation_id::text,
    'status', 'applied',
    'readback', pg_catalog.jsonb_build_object('passed', true, 'checks', pg_catalog.jsonb_build_object('consentEventPresent', true)),
    'auditId', v_audit_id::text,
    'consentEventId', v_event_id::text
  );
END;
$function$;
ALTER FUNCTION public.submit_guardian_privacy_consent(text, text, text, uuid, text, uuid, text, uuid)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.submit_guardian_privacy_consent(text, text, text, uuid, text, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_guardian_privacy_consent(text, text, text, uuid, text, uuid, text, uuid)
  TO service_role;

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
      p_verified_at,
      p_expires_at,
      CASE WHEN p_status = 'withdrawn' THEN pg_catalog.clock_timestamp() ELSE NULL END,
      pg_catalog.clock_timestamp()
    );
    v_changed := true;
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
    'readback', pg_catalog.jsonb_build_object('passed', true, 'checks', pg_catalog.jsonb_build_object('verificationRecorded', true, 'verified', p_status = 'verified')),
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
CREATE OR REPLACE FUNCTION public.privacy_under_14_is_eligible(
  p_user_id uuid,
  p_policy_version_id uuid
)
RETURNS boolean
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_guardian_verifications AS guardian
    WHERE guardian.child_user_id = p_user_id
      AND guardian.status = 'verified'
      AND guardian.verified_at IS NOT NULL
      AND guardian.verified_at <= pg_catalog.clock_timestamp()
      AND guardian.expires_at > pg_catalog.clock_timestamp()
      AND guardian.withdrawn_at IS NULL
      AND (
        SELECT event.decision
        FROM privacy_retention.privacy_consent_events AS event
        WHERE event.user_id = p_user_id
          AND event.subject_kind = 'child'
          AND event.guardian_verification_id = guardian.id
          AND event.purpose = 'privacy_required'
          AND event.channel = 'none'
          AND event.policy_version_id = p_policy_version_id
          AND event.notice_sha256 = (
            SELECT policy.content_sha256
            FROM privacy_retention.privacy_policy_versions AS policy
            WHERE policy.id = p_policy_version_id
          )
          AND event.source = 'guardian'
        ORDER BY event.occurred_at DESC, event.id DESC
        LIMIT 1
      ) = 'granted'
  );
$function$;
ALTER FUNCTION public.privacy_under_14_is_eligible(uuid, uuid) OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.privacy_under_14_is_eligible(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.privacy_refresh_age_profile(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile privacy_retention.privacy_age_profiles%ROWTYPE;
  v_status text;
BEGIN
  SELECT * INTO v_profile
  FROM privacy_retention.privacy_age_profiles AS profile
  WHERE profile.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_profile.age_band <> 'under_14' THEN
    RETURN;
  END IF;

  IF public.privacy_under_14_is_eligible(p_user_id, v_profile.policy_version_id) THEN
    v_status := 'guardian_verified';
  ELSIF EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_guardian_verifications AS guardian
    WHERE guardian.child_user_id = p_user_id
      AND guardian.status = 'verified'
      AND guardian.verified_at IS NOT NULL
      AND guardian.verified_at <= pg_catalog.clock_timestamp()
      AND guardian.expires_at > pg_catalog.clock_timestamp()
      AND guardian.withdrawn_at IS NULL
  ) THEN
    -- A replacement verification recovers a withdrawn profile only to pending;
    -- a required consent bound to that verification remains mandatory.
    v_status := 'guardian_pending';
  ELSIF EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_guardian_verifications AS guardian
    WHERE guardian.child_user_id = p_user_id
      AND guardian.status = 'withdrawn'
  ) THEN
    v_status := 'guardian_withdrawn';
  ELSE
    v_status := 'guardian_pending';
  END IF;

  UPDATE privacy_retention.privacy_age_profiles AS profile
  SET status = v_status,
      updated_at = pg_catalog.clock_timestamp()
  WHERE profile.user_id = p_user_id
    AND profile.status IS DISTINCT FROM v_status;
END;
$function$;
ALTER FUNCTION public.privacy_refresh_age_profile(uuid) OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.privacy_refresh_age_profile(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.read_privacy_guardian_status(p_child_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_age privacy_retention.privacy_age_profiles%ROWTYPE;
  v_guardian privacy_retention.privacy_guardian_verifications%ROWTYPE;
  v_eligibility jsonb;
  v_live_eligible boolean;
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  IF p_child_user_id IS NULL THEN
    RAISE EXCEPTION 'privacy_guardian_child_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_age
  FROM privacy_retention.privacy_age_profiles AS profile
  WHERE profile.user_id = p_child_user_id;
  IF NOT FOUND OR v_age.age_band <> 'under_14' THEN
    RAISE EXCEPTION 'privacy_guardian_child_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_eligibility := privacy_retention.g014_privacy_eligibility_receipt(p_child_user_id);
  v_live_eligible := (v_eligibility ->> 'eligible')::boolean;
  SELECT * INTO v_guardian
  FROM privacy_retention.privacy_guardian_verifications AS guardian
  WHERE guardian.child_user_id = p_child_user_id
    AND (
      NOT v_live_eligible
      OR (
        guardian.status = 'verified'
        AND guardian.verified_at IS NOT NULL
        AND guardian.verified_at <= pg_catalog.clock_timestamp()
        AND guardian.expires_at > pg_catalog.clock_timestamp()
        AND guardian.withdrawn_at IS NULL
      )
    )
  ORDER BY guardian.updated_at DESC, guardian.id DESC
  LIMIT 1;

  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'userId', p_child_user_id::text,
    'ageStatus', CASE
      WHEN v_live_eligible THEN 'guardian_verified'
      WHEN v_age.status = 'guardian_withdrawn' THEN 'guardian_withdrawn'
      WHEN v_age.status = 'blocked' THEN 'blocked'
      ELSE 'guardian_pending'
    END,
    'guardianStatus', CASE
      WHEN v_live_eligible THEN 'verified'
      WHEN v_guardian.status = 'withdrawn' THEN 'withdrawn'
      WHEN v_guardian.status = 'expired' THEN 'expired'
      ELSE 'pending'
    END,
    'verificationId', CASE WHEN v_guardian.id IS NULL THEN NULL ELSE v_guardian.id::text END,
    'expiresAt', CASE WHEN v_guardian.expires_at IS NULL THEN NULL ELSE pg_catalog.to_char(v_guardian.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'eligible', v_live_eligible,
    'reasonCode', v_eligibility ->> 'reasonCode',
    'policyVersionId', v_eligibility ->> 'policyVersionId',
    'contentSha256', v_eligibility ->> 'contentSha256'
  );
END;
$function$;
ALTER FUNCTION public.read_privacy_guardian_status(uuid) OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.read_privacy_guardian_status(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_privacy_guardian_status(uuid) TO service_role;
GRANT USAGE ON SCHEMA auth TO privacy_workflow_owner;
GRANT SELECT (id) ON TABLE auth.users TO privacy_workflow_owner;
CREATE OR REPLACE FUNCTION public.hold_privacy_onboarding_compensation(
  p_challenge_id uuid,
  p_user_id uuid,
  p_reason_code text,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_existing privacy_retention.privacy_onboarding_compensation_holds%ROWTYPE;
  v_hold privacy_retention.privacy_onboarding_compensation_holds%ROWTYPE;
  v_challenge privacy_retention.privacy_onboarding_challenges%ROWTYPE;
  v_audit_id uuid;
  v_operation_id uuid;
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  IF p_challenge_id IS NULL
     OR p_user_id IS NULL
     OR p_reason_code IS NULL
     OR p_reason_code !~ '^[A-Z][A-Z0-9_]{0,63}$'
     OR p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$' THEN
    RAISE EXCEPTION 'privacy_onboarding_compensation_hold_request_invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'g014-onboarding-compensation-idempotency:' || p_idempotency_key,
      0
    )
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'g014-onboarding-compensation-binding:'
        || p_challenge_id::text || ':' || p_user_id::text,
      0
    )
  );

  SELECT * INTO v_existing
  FROM privacy_retention.privacy_onboarding_compensation_holds AS hold
  WHERE hold.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.challenge_id IS DISTINCT FROM p_challenge_id
       OR v_existing.user_id IS DISTINCT FROM p_user_id
       OR v_existing.operation_code IS DISTINCT FROM 'onboarding_compensation_hold'
       OR v_existing.reason_code IS DISTINCT FROM p_reason_code
       OR v_existing.state IS DISTINCT FROM 'active' THEN
      RAISE EXCEPTION 'privacy_onboarding_compensation_hold_idempotency_mismatch'
        USING ERRCODE = '23505';
    END IF;

    SELECT audit.id INTO v_audit_id
    FROM privacy_retention.privacy_audit_events AS audit
    WHERE audit.id = v_existing.audit_event_id
      AND audit.event_type = 'onboarding_compensation_held'
      AND audit.operation_id = v_existing.operation_id
      AND audit.correlation_id = p_challenge_id
      AND audit.status = 'held'
      AND audit.reason_code = p_reason_code
      AND audit.request_metadata ->> 'requestId' = p_idempotency_key;
    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'privacy_onboarding_compensation_hold_audit_missing' USING ERRCODE = '55000';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'operationId', v_existing.operation_id::text,
      'challengeId', v_existing.challenge_id::text,
      'userId', v_existing.user_id::text,
      'status', 'held',
      'reasonCode', v_existing.reason_code,
      'auditId', v_audit_id::text,
      'readback', pg_catalog.jsonb_build_object(
        'passed', true,
        'holdRecorded', true,
        'auditRecorded', true,
        'active', true
      )
    );
  END IF;
  PERFORM 1
  FROM auth.users AS user_row
  WHERE user_row.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'privacy_onboarding_compensation_hold_user_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_challenge
  FROM privacy_retention.privacy_onboarding_challenges AS challenge
  WHERE challenge.id = p_challenge_id
  FOR UPDATE;
  IF NOT FOUND
     OR (
       v_challenge.consumed_by_user_id IS NOT NULL
       AND v_challenge.consumed_by_user_id IS DISTINCT FROM p_user_id
     ) THEN
    RAISE EXCEPTION 'privacy_onboarding_compensation_hold_binding_mismatch'
      USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_existing
  FROM privacy_retention.privacy_onboarding_compensation_holds AS hold
  WHERE hold.challenge_id = p_challenge_id
    AND hold.user_id = p_user_id
    AND hold.operation_code = 'onboarding_compensation_hold'
  FOR UPDATE;
  IF FOUND THEN
    RAISE EXCEPTION 'privacy_onboarding_compensation_hold_idempotency_mismatch'
      USING ERRCODE = '23505';
  END IF;

  v_operation_id := extensions.gen_random_uuid();
  v_audit_id := privacy_retention.append_privacy_audit_event_internal(
    'onboarding_compensation_held',
    NULL,
    p_user_id,
    v_operation_id,
    p_challenge_id,
    'held',
    p_reason_code,
    pg_catalog.jsonb_build_object('holds', 1),
    pg_catalog.jsonb_build_object(
      'requestId', p_idempotency_key,
      'route', '/api/privacy/onboarding'
    )
  );
  IF v_audit_id IS NULL THEN
    RAISE EXCEPTION 'privacy_onboarding_compensation_hold_audit_missing' USING ERRCODE = '55000';
  END IF;

  INSERT INTO privacy_retention.privacy_onboarding_compensation_holds (
    operation_id,
    audit_event_id,
    challenge_id,
    user_id,
    operation_code,
    idempotency_key,
    reason_code,
    state
  ) VALUES (
    v_operation_id,
    v_audit_id,
    p_challenge_id,
    p_user_id,
    'onboarding_compensation_hold',
    p_idempotency_key,
    p_reason_code,
    'active'
  )
  RETURNING * INTO v_hold;

  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'operationId', v_hold.operation_id::text,
    'challengeId', v_hold.challenge_id::text,
    'userId', v_hold.user_id::text,
    'status', 'held',
    'reasonCode', v_hold.reason_code,
    'auditId', v_audit_id::text,
    'readback', pg_catalog.jsonb_build_object(
      'passed', true,
      'holdRecorded', true,
      'auditRecorded', true,
      'active', true
    )
  );
END;
$function$;
ALTER FUNCTION public.hold_privacy_onboarding_compensation(uuid, uuid, text, text)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.hold_privacy_onboarding_compensation(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.hold_privacy_onboarding_compensation(uuid, uuid, text, text)
  TO service_role;

CREATE OR REPLACE FUNCTION privacy_retention.g014_privacy_eligibility_receipt(
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_policy privacy_retention.privacy_policy_versions%ROWTYPE;
  v_profile privacy_retention.privacy_age_profiles%ROWTYPE;
  v_guardian_id uuid;
  v_guardian_decision text;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'privacy_eligibility_user_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_policy
  FROM privacy_retention.privacy_policy_versions AS policy
  WHERE policy.status = 'published'
    AND policy.effective_at <= pg_catalog.clock_timestamp()
  ORDER BY policy.effective_at DESC, policy.id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'eligible', false,
      'reasonCode', 'PRIVACY_POLICY_UNAVAILABLE',
      'policyVersionId', NULL,
      'contentSha256', NULL
    );
  END IF;
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_onboarding_compensation_holds AS hold
    WHERE hold.user_id = p_user_id
      AND hold.operation_code = 'onboarding_compensation_hold'
      AND hold.state = 'active'
  ) THEN
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'eligible', false,
      'reasonCode', 'PRIVACY_AGE_BLOCKED',
      'policyVersionId', v_policy.id::text,
      'contentSha256', v_policy.content_sha256
    );
  END IF;

  SELECT * INTO v_profile
  FROM privacy_retention.privacy_age_profiles AS profile
  WHERE profile.user_id = p_user_id;
  IF NOT FOUND THEN
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'eligible', false,
      'reasonCode', 'PRIVACY_AGE_ATTESTATION_REQUIRED',
      'policyVersionId', v_policy.id::text,
      'contentSha256', v_policy.content_sha256
    );
  END IF;

  IF v_profile.policy_version_id IS DISTINCT FROM v_policy.id THEN
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'eligible', false,
      'reasonCode', 'PRIVACY_POLICY_REATTESTATION_REQUIRED',
      'policyVersionId', v_policy.id::text,
      'contentSha256', v_policy.content_sha256
    );
  END IF;

  IF v_profile.status = 'blocked' THEN
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'eligible', false,
      'reasonCode', 'PRIVACY_AGE_BLOCKED',
      'policyVersionId', v_policy.id::text,
      'contentSha256', v_policy.content_sha256
    );
  END IF;

  IF v_profile.age_band = 'age_14_plus' AND v_profile.status = 'eligible' THEN
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'eligible', true,
      'reasonCode', 'PRIVACY_ELIGIBLE',
      'policyVersionId', v_policy.id::text,
      'contentSha256', v_policy.content_sha256
    );
  END IF;

  IF v_profile.age_band <> 'under_14' THEN
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'eligible', false,
      'reasonCode', 'PRIVACY_AGE_ATTESTATION_REQUIRED',
      'policyVersionId', v_policy.id::text,
      'contentSha256', v_policy.content_sha256
    );
  END IF;

  SELECT guardian.id INTO v_guardian_id
  FROM privacy_retention.privacy_guardian_verifications AS guardian
  WHERE guardian.child_user_id = p_user_id
    AND guardian.status = 'verified'
    AND guardian.verified_at IS NOT NULL
    AND guardian.verified_at <= pg_catalog.clock_timestamp()
    AND guardian.expires_at > pg_catalog.clock_timestamp()
    AND guardian.withdrawn_at IS NULL
  ORDER BY guardian.updated_at DESC, guardian.id DESC
  LIMIT 1;

  IF v_guardian_id IS NULL THEN
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'eligible', false,
      'reasonCode', 'PRIVACY_GUARDIAN_REQUIRED',
      'policyVersionId', v_policy.id::text,
      'contentSha256', v_policy.content_sha256
    );
  END IF;

  SELECT event.decision INTO v_guardian_decision
  FROM privacy_retention.privacy_consent_events AS event
  WHERE event.user_id = p_user_id
    AND event.subject_kind = 'child'
    AND event.guardian_verification_id = v_guardian_id
    AND event.purpose = 'privacy_required'
    AND event.channel = 'none'
    AND event.policy_version_id = v_policy.id
    AND event.notice_sha256 = v_policy.content_sha256
    AND event.source = 'guardian'
  ORDER BY event.occurred_at DESC, event.id DESC
  LIMIT 1;

  IF v_guardian_decision = 'granted' THEN
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'eligible', true,
      'reasonCode', 'PRIVACY_ELIGIBLE',
      'policyVersionId', v_policy.id::text,
      'contentSha256', v_policy.content_sha256
    );
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'eligible', false,
    'reasonCode', 'PRIVACY_GUARDIAN_CONSENT_REQUIRED',
    'policyVersionId', v_policy.id::text,
    'contentSha256', v_policy.content_sha256
  );
END;
$function$;
ALTER FUNCTION privacy_retention.g014_privacy_eligibility_receipt(uuid)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_privacy_eligibility_receipt(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_current_privacy_eligibility()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_user_id uuid := auth.uid();
BEGIN
  v_role := COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  IF v_role <> 'authenticated' OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'privacy_authentication_required' USING ERRCODE = '42501';
  END IF;

  RETURN privacy_retention.g014_privacy_eligibility_receipt(v_user_id);
END;
$function$;
ALTER FUNCTION public.get_current_privacy_eligibility() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.get_current_privacy_eligibility()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_current_privacy_eligibility() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_privacy_eligibility_for_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'privacy_eligibility_user_required' USING ERRCODE = '22023';
  END IF;
  PERFORM 1
  FROM auth.users AS user_row
  WHERE user_row.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'privacy_eligibility_user_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN privacy_retention.g014_privacy_eligibility_receipt(p_user_id);
END;
$function$;
ALTER FUNCTION public.get_privacy_eligibility_for_user(uuid) OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.get_privacy_eligibility_for_user(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_privacy_eligibility_for_user(uuid) TO service_role;
DO $public_rpc_allowlist_extension$
BEGIN
  INSERT INTO privacy_retention.g014_public_rpc_allowlist (
    function_schema,
    function_name,
    identity_arguments,
    grantee,
    source_signature
  )
  SELECT namespace.nspname,
         procedure.proname,
         procedure.proargtypes::text,
         expected.grantee,
         expected.source_signature
  FROM (
    VALUES
      ('public.append_privacy_audit_event(text,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb)'::text, 'service_role'::name),
      ('public.publish_privacy_policy_version(text,text,text,timestamptz,uuid,text,text)'::text, 'service_role'::name),
      ('public.transition_privacy_onboarding_challenge(uuid,text,text,uuid,text)'::text, 'service_role'::name),
      ('public.submit_guardian_privacy_consent(text,text,text,uuid,text,uuid,text,uuid)'::text, 'service_role'::name),
      ('public.hold_privacy_onboarding_compensation(uuid,uuid,text,text)'::text, 'service_role'::name),
      ('public.get_current_privacy_eligibility()'::text, 'authenticated'::name),
      ('public.get_privacy_eligibility_for_user(uuid)'::text, 'service_role'::name)
  ) AS expected(source_signature, grantee)
  JOIN pg_catalog.pg_proc AS procedure
    ON procedure.oid = pg_catalog.to_regprocedure(expected.source_signature)
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  ON CONFLICT DO NOTHING;

  IF EXISTS (
    SELECT 1
    FROM (
      VALUES
        ('public.append_privacy_audit_event(text,uuid,uuid,uuid,uuid,text,text,jsonb,jsonb)'::text, 'service_role'::name),
        ('public.publish_privacy_policy_version(text,text,text,timestamptz,uuid,text,text)'::text, 'service_role'::name),
        ('public.transition_privacy_onboarding_challenge(uuid,text,text,uuid,text)'::text, 'service_role'::name),
        ('public.submit_guardian_privacy_consent(text,text,text,uuid,text,uuid,text,uuid)'::text, 'service_role'::name),
        ('public.hold_privacy_onboarding_compensation(uuid,uuid,text,text)'::text, 'service_role'::name),
        ('public.get_current_privacy_eligibility()'::text, 'authenticated'::name),
        ('public.get_privacy_eligibility_for_user(uuid)'::text, 'service_role'::name)
    ) AS expected(source_signature, grantee)
    WHERE NOT EXISTS (
      SELECT 1
      FROM privacy_retention.g014_public_rpc_allowlist AS allowed
      WHERE allowed.source_signature = expected.source_signature
        AND allowed.grantee = expected.grantee
    )
  ) THEN
    RAISE EXCEPTION 'G014-02 public RPC allowlist extension is incomplete';
  END IF;
END;
$public_rpc_allowlist_extension$;

-- Reassert that the public Data API roles cannot mutate retained workflow data.
REVOKE ALL ON TABLE privacy_retention.privacy_policy_versions,
                    privacy_retention.privacy_onboarding_challenges,
                    privacy_retention.privacy_guardian_verifications,
                    privacy_retention.privacy_age_profiles,
                    privacy_retention.privacy_consent_events,
                    privacy_retention.privacy_audit_events,
                    privacy_retention.privacy_onboarding_compensation_holds
  FROM PUBLIC, anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
