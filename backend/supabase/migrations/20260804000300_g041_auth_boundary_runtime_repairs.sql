-- Repair browser-authenticated privacy and admin guards without granting the
-- workflow owner access to Supabase's platform-owned auth schema.

BEGIN;

DO $preflight$
BEGIN
  IF pg_catalog.to_regrole('privacy_workflow_owner') IS NULL
     OR pg_catalog.to_regprocedure('privacy_retention.g016_reattest_privacy_onboarding(uuid,uuid,text)') IS NULL
     OR pg_catalog.to_regprocedure('privacy_retention.g014_privacy_eligibility_receipt(uuid)') IS NULL
     OR pg_catalog.to_regprocedure('privacy_retention.g014_require_service_role()') IS NULL
     OR pg_catalog.to_regclass('public.release_auth_identities') IS NULL
     OR pg_catalog.to_regclass('public.release_auth_session_leases') IS NULL
     OR pg_catalog.to_regclass('public.user_roles') IS NULL
     OR pg_catalog.to_regclass('public.user_account_status') IS NULL THEN
    RAISE EXCEPTION 'g041_auth_boundary_prerequisite_missing';
  END IF;
END
$preflight$;

DO $membership$
DECLARE
  v_membership_exists boolean;
  v_set_option boolean := true;
  v_supports_set_option boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    WHERE membership.roleid = 'privacy_workflow_owner'::pg_catalog.regrole
      AND membership.member = pg_catalog.to_regrole(session_user)
  ) INTO v_membership_exists;
  SELECT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'pg_catalog.pg_auth_members'::pg_catalog.regclass
      AND attribute.attname = 'set_option'
      AND NOT attribute.attisdropped
  ) INTO v_supports_set_option;

  IF v_membership_exists AND v_supports_set_option THEN
    EXECUTE
      'SELECT membership.set_option FROM pg_catalog.pg_auth_members AS membership '
      || 'WHERE membership.roleid = ''privacy_workflow_owner''::pg_catalog.regrole '
      || 'AND membership.member = pg_catalog.to_regrole(session_user)'
    INTO v_set_option;
  END IF;

  IF NOT v_membership_exists THEN
    EXECUTE pg_catalog.format(
      CASE WHEN v_supports_set_option
        THEN 'GRANT privacy_workflow_owner TO %I WITH SET TRUE'
        ELSE 'GRANT privacy_workflow_owner TO %I'
      END,
      session_user
    );
    PERFORM pg_catalog.set_config('g041_runtime.remove_membership', 'true', true);
    PERFORM pg_catalog.set_config('g041_runtime.restore_set_false', 'false', true);
  ELSIF v_supports_set_option AND NOT v_set_option THEN
    EXECUTE pg_catalog.format('GRANT privacy_workflow_owner TO %I WITH SET TRUE', session_user);
    PERFORM pg_catalog.set_config('g041_runtime.remove_membership', 'false', true);
    PERFORM pg_catalog.set_config('g041_runtime.restore_set_false', 'true', true);
  ELSE
    PERFORM pg_catalog.set_config('g041_runtime.remove_membership', 'false', true);
    PERFORM pg_catalog.set_config('g041_runtime.restore_set_false', 'false', true);
  END IF;
END
$membership$;

SET LOCAL ROLE privacy_workflow_owner;

CREATE OR REPLACE FUNCTION privacy_retention.g016_reattest_privacy_onboarding(
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
    pg_catalog.jsonb_build_object('consentEvents', v_event_count, 'eligible', true),
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
REVOKE ALL ON FUNCTION privacy_retention.g016_reattest_privacy_onboarding(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_current_privacy_eligibility()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_claims jsonb := COALESCE(NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_role text;
  v_user_id uuid;
  v_receipt jsonb;
  v_policy_version text;
BEGIN
  v_role := COALESCE(NULLIF(v_claims ->> 'role', ''), pg_catalog.current_setting('request.jwt.claim.role', true), '');
  BEGIN
    v_user_id := NULLIF(COALESCE(NULLIF(v_claims ->> 'sub', ''), pg_catalog.current_setting('request.jwt.claim.sub', true)), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION 'privacy_authentication_required' USING ERRCODE = '42501';
  END;
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
REVOKE ALL ON FUNCTION public.get_current_privacy_eligibility()
  FROM PUBLIC, anon, authenticated, service_role;
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
  v_receipt := privacy_retention.g014_privacy_eligibility_receipt(p_user_id);
  SELECT policy.version INTO v_policy_version
  FROM privacy_retention.privacy_policy_versions AS policy
  WHERE policy.id = NULLIF(v_receipt ->> 'policyVersionId', '')::uuid;
  RETURN v_receipt || pg_catalog.jsonb_build_object('policyVersion', v_policy_version);
END;
$function$;
REVOKE ALL ON FUNCTION public.get_privacy_eligibility_for_user(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_privacy_eligibility_for_user(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.get_current_auth_session_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_claims jsonb := COALESCE(NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_role text;
  v_user_id uuid;
  v_session_id uuid;
BEGIN
  v_role := COALESCE(NULLIF(v_claims ->> 'role', ''), pg_catalog.current_setting('request.jwt.claim.role', true), '');
  BEGIN
    v_user_id := NULLIF(COALESCE(NULLIF(v_claims ->> 'sub', ''), pg_catalog.current_setting('request.jwt.claim.sub', true)), '')::uuid;
    v_session_id := NULLIF(COALESCE(NULLIF(v_claims ->> 'session_id', ''), pg_catalog.current_setting('request.jwt.claim.session_id', true)), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN NULL;
  END;
  IF v_role <> 'authenticated' OR v_user_id IS NULL OR v_session_id IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN v_session_id;
END;
$function$;
REVOKE ALL ON FUNCTION public.get_current_auth_session_id()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_current_auth_session_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.is_current_auth_session_active()
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_claims jsonb := COALESCE(NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_current_session_id uuid;
  v_current_user_id uuid;
  v_lease public.release_auth_session_leases%ROWTYPE;
BEGIN
  BEGIN
    v_current_user_id := NULLIF(COALESCE(NULLIF(v_claims ->> 'sub', ''), pg_catalog.current_setting('request.jwt.claim.sub', true)), '')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;
  v_current_session_id := public.get_current_auth_session_id();
  IF v_current_session_id IS NULL OR v_current_user_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.release_auth_identities AS identity
    WHERE identity.user_id = v_current_user_id
  ) THEN
    RETURN true;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_current_session_id::text, 0));
  SELECT * INTO v_lease
  FROM public.release_auth_session_leases AS lease
  WHERE lease.user_id = v_current_user_id
    AND lease.session_id = v_current_session_id
  FOR UPDATE;
  RETURN FOUND AND v_lease.expires_at > pg_catalog.clock_timestamp();
END;
$function$;
REVOKE ALL ON FUNCTION public.is_current_auth_session_active()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_current_auth_session_active() TO authenticated;

RESET ROLE;
REVOKE ALL PRIVILEGES ON SCHEMA auth FROM privacy_workflow_owner;
REVOKE ALL PRIVILEGES ON TABLE auth.users, auth.sessions, auth.identities, auth.refresh_tokens
  FROM privacy_workflow_owner;
REVOKE SELECT (id, last_sign_in_at) ON TABLE auth.users FROM privacy_workflow_owner;

GRANT SELECT ON TABLE public.release_auth_identities TO privacy_workflow_owner;
GRANT SELECT, UPDATE ON TABLE public.release_auth_session_leases TO privacy_workflow_owner;
REVOKE ALL ON TABLE public.release_auth_identities, public.release_auth_session_leases
  FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT ON TABLE public.user_roles, public.user_account_status TO authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE
  public.user_roles, public.user_account_status
FROM authenticated;
REVOKE ALL ON TABLE public.user_roles, public.user_account_status FROM anon;

DROP POLICY IF EXISTS "Users and admins can view roles" ON public.user_roles;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role)
  FROM PUBLIC, anon, authenticated, service_role;


DO $readback$
DECLARE
  v_function pg_catalog.regprocedure;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'public.get_current_privacy_eligibility()'::pg_catalog.regprocedure,
    'public.get_privacy_eligibility_for_user(uuid)'::pg_catalog.regprocedure,
    'public.get_current_auth_session_id()'::pg_catalog.regprocedure,
    'public.is_current_auth_session_active()'::pg_catalog.regprocedure,
    'privacy_retention.g016_reattest_privacy_onboarding(uuid,uuid,text)'::pg_catalog.regprocedure
  ] LOOP
    IF (SELECT procedure.proowner::pg_catalog.regrole::text FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_function) <> 'privacy_workflow_owner'
       OR NOT (SELECT procedure.prosecdef FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_function)
       OR NOT (SELECT procedure.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""'] FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_function) THEN
      RAISE EXCEPTION 'g041_runtime_function_boundary_invalid: %', v_function;
    END IF;
  END LOOP;

  IF pg_catalog.has_schema_privilege('privacy_workflow_owner', 'auth', 'USAGE')
     OR pg_catalog.has_table_privilege('privacy_workflow_owner', 'auth.users', 'SELECT')
     OR pg_catalog.has_table_privilege('privacy_workflow_owner', 'auth.sessions', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR pg_catalog.has_table_privilege('privacy_workflow_owner', 'auth.identities', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR pg_catalog.has_table_privilege('privacy_workflow_owner', 'auth.refresh_tokens', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER')
     OR pg_catalog.has_column_privilege('privacy_workflow_owner', 'auth.users', 'id', 'SELECT')
     OR pg_catalog.has_column_privilege('privacy_workflow_owner', 'auth.users', 'last_sign_in_at', 'SELECT') THEN
    RAISE EXCEPTION 'g041_runtime_auth_direct_privilege_detected';
  END IF;
  IF NOT pg_catalog.has_table_privilege('privacy_workflow_owner', 'public.release_auth_identities', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('privacy_workflow_owner', 'public.release_auth_session_leases', 'SELECT, UPDATE') THEN
    RAISE EXCEPTION 'g041_runtime_session_guard_privilege_missing';
  END IF;
  IF NOT pg_catalog.has_table_privilege('authenticated', 'public.user_roles', 'SELECT')
     OR NOT pg_catalog.has_table_privilege('authenticated', 'public.user_account_status', 'SELECT') THEN
    RAISE EXCEPTION 'g041_runtime_admin_guard_privilege_missing';
  END IF;
  IF pg_catalog.has_table_privilege('authenticated', 'public.user_roles', 'INSERT, UPDATE, DELETE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.user_account_status', 'INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'g041_runtime_admin_mutation_privilege_detected';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid = 'public.user_roles'::pg_catalog.regclass
      AND polname = 'Users and admins can view roles'
  ) THEN
    RAISE EXCEPTION 'g041_runtime_legacy_role_policy_detected';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid = 'public.user_roles'::pg_catalog.regclass
      AND polname = 'user_roles_select_own'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policy
    WHERE polrelid = 'public.user_account_status'::pg_catalog.regclass
      AND polname = 'user_account_status_select_own'
  ) THEN
    RAISE EXCEPTION 'g041_runtime_admin_guard_rls_policy_missing';
  END IF;
END
$readback$;

DO $membership$
BEGIN
  IF pg_catalog.current_setting('g041_runtime.restore_set_false', true) = 'true' THEN
    EXECUTE pg_catalog.format('GRANT privacy_workflow_owner TO %I WITH SET FALSE', session_user);
  ELSIF pg_catalog.current_setting('g041_runtime.remove_membership', true) = 'true' THEN
    EXECUTE pg_catalog.format('REVOKE privacy_workflow_owner FROM %I', session_user);
  END IF;
END
$membership$;

NOTIFY pgrst, 'reload schema';
COMMIT;
