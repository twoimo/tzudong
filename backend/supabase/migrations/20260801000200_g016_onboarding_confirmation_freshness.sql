BEGIN;
DO $membership$
BEGIN
  IF pg_catalog.pg_has_role(session_user, 'supabase_admin', 'MEMBER') THEN
    EXECUTE 'SET LOCAL ROLE supabase_admin';
  END IF;
  IF NOT pg_catalog.pg_has_role(session_user, 'privacy_workflow_owner', 'MEMBER') THEN
    EXECUTE pg_catalog.format('GRANT privacy_workflow_owner TO %I', session_user);
    PERFORM pg_catalog.set_config('g016_freshness.temporary_membership', 'true', true);
  ELSE
    PERFORM pg_catalog.set_config('g016_freshness.temporary_membership', 'false', true);
  END IF;
END
$membership$;
RESET ROLE;
SET LOCAL ROLE privacy_workflow_owner;


-- Preserve the audited G014 implementation under the private schema, then expose
-- the same service-only signature with an explicit fresh/replay disposition.
ALTER FUNCTION public.confirm_privacy_onboarding(uuid, text, uuid, text, uuid)
  SET SCHEMA privacy_retention;
ALTER FUNCTION privacy_retention.confirm_privacy_onboarding(uuid, text, uuid, text, uuid)
  RENAME TO g014_confirm_privacy_onboarding_legacy;
REVOKE ALL ON FUNCTION privacy_retention.g014_confirm_privacy_onboarding_legacy(uuid, text, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION privacy_retention.g016_reattest_privacy_onboarding(
  p_challenge_id uuid,
  p_user_id uuid,
  p_source text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_challenge privacy_retention.privacy_onboarding_challenges%ROWTYPE;
  v_policy privacy_retention.privacy_policy_versions%ROWTYPE;
  v_profile privacy_retention.privacy_age_profiles%ROWTYPE;
  v_event_count integer := 0;
  v_audit_id uuid;
  v_idempotency_prefix text := 'onb' || pg_catalog.replace(p_challenge_id::text, '-', '');
BEGIN
  SELECT * INTO v_challenge
  FROM privacy_retention.privacy_onboarding_challenges AS challenge
  WHERE challenge.id = p_challenge_id
  FOR UPDATE;
  SELECT * INTO v_profile
  FROM privacy_retention.privacy_age_profiles AS profile
  WHERE profile.user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_challenge.consumed_at IS NOT NULL
     OR v_challenge.expires_at <= pg_catalog.clock_timestamp()
     OR v_challenge.age_band <> 'age_14_plus'
     OR v_profile.age_band IS DISTINCT FROM v_challenge.age_band
     OR v_profile.status <> 'eligible' THEN
    RAISE EXCEPTION 'privacy_onboarding_reattest_invalid' USING ERRCODE = '23514';
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

  UPDATE privacy_retention.privacy_age_profiles AS profile
  SET attested_at = pg_catalog.clock_timestamp(),
      method = 'self_attestation',
      status = 'eligible',
      policy_version_id = v_policy.id
  WHERE profile.user_id = p_user_id;

  INSERT INTO privacy_retention.privacy_consent_events (
    user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256,
    source, correlation_id, idempotency_key
  ) VALUES (
    p_user_id, 'self', 'privacy_required', 'none', 'granted', v_policy.id, v_policy.content_sha256,
    p_source, p_challenge_id, v_idempotency_prefix || 'required'
  );
  v_event_count := v_event_count + 1;

  IF COALESCE((v_challenge.requested_consents ->> 'email')::boolean, false) THEN
    INSERT INTO privacy_retention.privacy_consent_events (user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256, source, correlation_id, idempotency_key)
    VALUES (p_user_id, 'self', 'email_marketing', 'email', 'granted', v_policy.id, v_policy.content_sha256, p_source, p_challenge_id, v_idempotency_prefix || 'email');
    v_event_count := v_event_count + 1;
  END IF;
  IF COALESCE((v_challenge.requested_consents ->> 'sms')::boolean, false) THEN
    INSERT INTO privacy_retention.privacy_consent_events (user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256, source, correlation_id, idempotency_key)
    VALUES (p_user_id, 'self', 'sms_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256, p_source, p_challenge_id, v_idempotency_prefix || 'sms');
    v_event_count := v_event_count + 1;
  END IF;
  IF COALESCE((v_challenge.requested_consents ->> 'push')::boolean, false) THEN
    INSERT INTO privacy_retention.privacy_consent_events (user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256, source, correlation_id, idempotency_key)
    VALUES (p_user_id, 'self', 'push_marketing', 'push', 'granted', v_policy.id, v_policy.content_sha256, p_source, p_challenge_id, v_idempotency_prefix || 'push');
    v_event_count := v_event_count + 1;
  END IF;
  IF COALESCE((v_challenge.requested_consents ->> 'night_email')::boolean, false) THEN
    INSERT INTO privacy_retention.privacy_consent_events (user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256, source, correlation_id, idempotency_key)
    VALUES (p_user_id, 'self', 'night_marketing', 'email', 'granted', v_policy.id, v_policy.content_sha256, p_source, p_challenge_id, v_idempotency_prefix || 'nightemail');
    v_event_count := v_event_count + 1;
  END IF;
  IF COALESCE((v_challenge.requested_consents ->> 'night_sms')::boolean, false) THEN
    INSERT INTO privacy_retention.privacy_consent_events (user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256, source, correlation_id, idempotency_key)
    VALUES (p_user_id, 'self', 'night_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256, p_source, p_challenge_id, v_idempotency_prefix || 'nightsms');
    v_event_count := v_event_count + 1;
  END IF;
  IF COALESCE((v_challenge.requested_consents ->> 'night_push')::boolean, false) THEN
    INSERT INTO privacy_retention.privacy_consent_events (user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256, source, correlation_id, idempotency_key)
    VALUES (p_user_id, 'self', 'night_marketing', 'push', 'granted', v_policy.id, v_policy.content_sha256, p_source, p_challenge_id, v_idempotency_prefix || 'nightpush');
    v_event_count := v_event_count + 1;
  END IF;

  UPDATE privacy_retention.privacy_onboarding_challenges
  SET consumed_at = pg_catalog.clock_timestamp(), consumed_by_user_id = p_user_id
  WHERE id = p_challenge_id AND consumed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'privacy_onboarding_transition_invalid' USING ERRCODE = '55000';
  END IF;
  v_audit_id := privacy_retention.append_privacy_audit_event_internal(
    'onboarding_confirmed', p_user_id, p_user_id, p_challenge_id, p_challenge_id, 'applied',
    'ONBOARDING_CONFIRMED',
    pg_catalog.jsonb_build_object('consentEvents', v_event_count, 'eligible', true, 'reattest', true),
    pg_catalog.jsonb_build_object('route', '/api/privacy/onboarding')
  );
  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1, 'operationId', p_challenge_id::text, 'challengeId', p_challenge_id::text,
    'userId', p_user_id::text, 'policyVersionId', v_challenge.policy_version_id::text,
    'eligible', true, 'status', 'applied',
    'readback', pg_catalog.jsonb_build_object('passed', true, 'checks', pg_catalog.jsonb_build_object(
      'challengeConsumed', true, 'ageProfileRecorded', true, 'requiredConsentRecorded', true, 'eligible', true
    )),
    'auditId', v_audit_id::text, 'errorCode', NULL, 'ageStatus', 'eligible'
  );
END;
$function$;
ALTER FUNCTION privacy_retention.g016_reattest_privacy_onboarding(uuid, uuid, text)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g016_reattest_privacy_onboarding(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.confirm_privacy_onboarding(
  p_challenge_id uuid,
  p_challenge_token text,
  p_user_id uuid,
  p_source text,
  p_guardian_verification_id uuid,
  p_oauth_nonce_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_was_consumed boolean := false;
  v_challenge_oauth_nonce_hash text;
  v_challenge_token_hash text;
  v_receipt jsonb;
BEGIN
  PERFORM privacy_retention.g014_require_service_role();

  -- Lock before delegating so a concurrent caller cannot misclassify its result
  -- or substitute an OAuth nonce after the challenge has been issued.
  IF p_challenge_id IS NULL
     OR p_user_id IS NULL
     OR p_challenge_token IS NULL
     OR pg_catalog.length(p_challenge_token) NOT BETWEEN 16 AND 512
     OR p_source NOT IN ('password_signup', 'oauth') THEN
    RAISE EXCEPTION 'privacy_onboarding_confirmation_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT
    challenge.consumed_at IS NOT NULL,
    challenge.oauth_nonce_hash,
    challenge.token_hash
    INTO v_was_consumed, v_challenge_oauth_nonce_hash, v_challenge_token_hash
  FROM privacy_retention.privacy_onboarding_challenges AS challenge
  WHERE challenge.id = p_challenge_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_challenge_token_hash IS DISTINCT FROM pg_catalog.encode(extensions.digest(p_challenge_token, 'sha256'), 'hex') THEN
    RAISE EXCEPTION 'privacy_onboarding_challenge_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_source = 'oauth' THEN
    IF p_oauth_nonce_hash IS NULL
      OR p_oauth_nonce_hash !~ '^[0-9a-f]{64}$'
      OR v_challenge_oauth_nonce_hash IS NULL
      OR p_oauth_nonce_hash IS DISTINCT FROM v_challenge_oauth_nonce_hash THEN
      RAISE EXCEPTION 'privacy_oauth_nonce_mismatch' USING ERRCODE = '22023';
    END IF;
  ELSIF v_challenge_oauth_nonce_hash IS NOT NULL OR p_oauth_nonce_hash IS NOT NULL THEN
    RAISE EXCEPTION 'privacy_oauth_nonce_unexpected' USING ERRCODE = '22023';
  END IF;

  IF NOT v_was_consumed AND EXISTS (
    SELECT 1 FROM privacy_retention.privacy_age_profiles AS profile
    WHERE profile.user_id = p_user_id
  ) THEN
    v_receipt := privacy_retention.g016_reattest_privacy_onboarding(
      p_challenge_id, p_user_id, p_source
    );
  ELSE
    v_receipt := privacy_retention.g014_confirm_privacy_onboarding_legacy(
      p_challenge_id,
      p_challenge_token,
      p_user_id,
      p_source,
      p_guardian_verification_id
    );
  END IF;



  RETURN v_receipt || pg_catalog.jsonb_build_object(
    'disposition', CASE WHEN v_was_consumed THEN 'idempotent_replay' ELSE 'fresh' END
  );
END;
$function$;
ALTER FUNCTION public.confirm_privacy_onboarding(uuid, text, uuid, text, uuid, text)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.confirm_privacy_onboarding(uuid, text, uuid, text, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.confirm_privacy_onboarding(uuid, text, uuid, text, uuid, text)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_current_privacy_eligibility()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_role text;
  v_user_id uuid := auth.uid();
  v_receipt jsonb;
  v_policy_version text;
BEGIN
  v_role := COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  IF v_role <> 'authenticated' OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'privacy_authentication_required' USING ERRCODE = '42501';
  END IF;

  v_receipt := privacy_retention.g014_privacy_eligibility_receipt(v_user_id);
  SELECT policy.version INTO v_policy_version
  FROM privacy_retention.privacy_policy_versions AS policy
  WHERE policy.id = NULLIF(v_receipt ->> 'policyVersionId', '')::uuid;

  RETURN v_receipt || pg_catalog.jsonb_build_object('policyVersion', v_policy_version);
END;
$function$;
ALTER FUNCTION public.get_current_privacy_eligibility() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.get_current_privacy_eligibility() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_current_privacy_eligibility() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_privacy_eligibility_for_user(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_receipt jsonb;
  v_policy_version text;
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'privacy_eligibility_user_required' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM auth.users AS user_row WHERE user_row.id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'privacy_eligibility_user_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_receipt := privacy_retention.g014_privacy_eligibility_receipt(p_user_id);
  SELECT policy.version INTO v_policy_version
  FROM privacy_retention.privacy_policy_versions AS policy
  WHERE policy.id = NULLIF(v_receipt ->> 'policyVersionId', '')::uuid;

  RETURN v_receipt || pg_catalog.jsonb_build_object('policyVersion', v_policy_version);
END;
$function$;
ALTER FUNCTION public.get_privacy_eligibility_for_user(uuid) OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.get_privacy_eligibility_for_user(uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_privacy_eligibility_for_user(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
RESET ROLE;
DO $membership$
BEGIN
  IF pg_catalog.pg_has_role(session_user, 'supabase_admin', 'MEMBER') THEN
    EXECUTE 'SET LOCAL ROLE supabase_admin';
  END IF;
  IF pg_catalog.current_setting('g016_freshness.temporary_membership', true) = 'true' THEN
    EXECUTE pg_catalog.format('REVOKE privacy_workflow_owner FROM %I', session_user);
  END IF;
END
$membership$;
RESET ROLE;
COMMIT;
