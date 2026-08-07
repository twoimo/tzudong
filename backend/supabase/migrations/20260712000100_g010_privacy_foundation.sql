-- G010 privacy foundation. This migration stores only minimum eligibility evidence;
-- it never stores a date of birth, resident registration number, raw contact data,
-- credentials, or free-form audit payloads.
DO $$
BEGIN
  IF to_regprocedure('extensions.digest(text,text)') IS NULL THEN
    RAISE EXCEPTION 'SHA-256 확장 기능을 사용할 수 없습니다' USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE FUNCTION public.privacy_requested_consents_are_valid(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT pg_catalog.jsonb_typeof(p_value) = 'object'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(p_value) AS entry(key, value)
      WHERE entry.key NOT IN ('email', 'sms', 'push', 'night_email', 'night_sms', 'night_push')
         OR pg_catalog.jsonb_typeof(entry.value) <> 'boolean'
    );
$$;

CREATE FUNCTION public.privacy_audit_count_summary_is_safe(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT pg_catalog.jsonb_typeof(p_value) = 'object'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(p_value) AS entry(key, value)
      WHERE entry.key NOT IN (
        'requested', 'created', 'updated', 'suppressed', 'failed', 'eligible',
        'guardianVerified', 'consentEvents', 'requiredConsent', 'retryCount'
      )
         OR (
           pg_catalog.jsonb_typeof(entry.value) <> 'boolean'
           AND (
             pg_catalog.jsonb_typeof(entry.value) <> 'number'
             OR (entry.value #>> '{}') !~ '^(0|[1-9][0-9]{0,9})$'
           )
         )
    );
$$;

CREATE FUNCTION public.privacy_audit_metadata_is_safe(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT pg_catalog.jsonb_typeof(p_value) = 'object'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(p_value) AS entry(key, value)
      WHERE entry.key NOT IN ('requestId', 'ipHash', 'userAgentFamily', 'route')
         OR pg_catalog.jsonb_typeof(entry.value) <> 'string'
         OR (entry.key = 'requestId' AND (entry.value #>> '{}') !~ '^[A-Za-z0-9_-]{1,128}$')
         OR (entry.key = 'ipHash' AND (entry.value #>> '{}') !~ '^[0-9a-f]{64}$')
         OR (entry.key = 'userAgentFamily' AND (entry.value #>> '{}') !~ '^[A-Za-z0-9 ._-]{1,80}$')
         OR (entry.key = 'route' AND (entry.value #>> '{}') !~ '^/[A-Za-z0-9/_-]{0,159}$')
    );
$$;

CREATE TABLE public.privacy_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE CHECK (version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  locale text NOT NULL DEFAULT 'ko-KR' CHECK (locale = 'ko-KR'),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  effective_at timestamptz NOT NULL,
  published_at timestamptz,
  supersedes_id uuid REFERENCES public.privacy_policy_versions(id) ON DELETE RESTRICT,
  operator_approval_ref text NOT NULL CHECK (operator_approval_ref ~ '^[A-Za-z0-9._:-]{1,128}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK (supersedes_id IS NULL OR supersedes_id <> id),
  CHECK (
    (status = 'draft' AND published_at IS NULL)
    OR (status IN ('published', 'retired') AND published_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX privacy_policy_versions_published_effective_at_idx
  ON public.privacy_policy_versions (effective_at)
  WHERE status = 'published';
CREATE INDEX privacy_policy_versions_current_lookup_idx
  ON public.privacy_policy_versions (effective_at DESC, id DESC)
  WHERE status = 'published';

CREATE TABLE public.privacy_onboarding_challenges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  policy_version_id uuid NOT NULL REFERENCES public.privacy_policy_versions(id) ON DELETE RESTRICT,
  age_band text NOT NULL CHECK (age_band IN ('unknown', 'age_14_plus', 'under_14')),
  requested_consents jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (public.privacy_requested_consents_are_valid(requested_consents)),
  oauth_nonce_hash text CHECK (oauth_nonce_hash IS NULL OR oauth_nonce_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  consumed_by_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK ((consumed_at IS NULL) = (consumed_by_user_id IS NULL)),
  CHECK (expires_at > created_at)
);
CREATE INDEX privacy_onboarding_challenges_active_lookup_idx
  ON public.privacy_onboarding_challenges (expires_at, id)
  WHERE consumed_at IS NULL;

CREATE TABLE public.privacy_guardian_verifications (
  id uuid PRIMARY KEY,
  child_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL CHECK (status IN ('pending', 'verified', 'rejected', 'expired', 'withdrawn')),
  provider text NOT NULL CHECK (provider ~ '^[A-Za-z0-9._-]{1,80}$'),
  provider_reference_hash text NOT NULL CHECK (provider_reference_hash ~ '^[0-9a-f]{64}$'),
  guardian_name_ciphertext bytea,
  guardian_contact_ciphertext bytea,
  verified_at timestamptz,
  expires_at timestamptz,
  withdrawn_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (provider, provider_reference_hash),
  CHECK (
    (status = 'verified' AND verified_at IS NOT NULL AND expires_at IS NOT NULL AND withdrawn_at IS NULL)
    OR (status = 'withdrawn' AND withdrawn_at IS NOT NULL)
    OR (status IN ('pending', 'rejected', 'expired') AND withdrawn_at IS NULL)
  ),
  CHECK (expires_at IS NULL OR verified_at IS NULL OR expires_at > verified_at)
);
CREATE INDEX privacy_guardian_verifications_child_status_idx
  ON public.privacy_guardian_verifications (child_user_id, status, expires_at DESC);

CREATE TABLE public.privacy_age_profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
  age_band text NOT NULL CHECK (age_band IN ('unknown', 'age_14_plus', 'under_14')),
  attested_at timestamptz NOT NULL,
  method text NOT NULL CHECK (method IN ('self_attestation', 'verified_provider')),
  status text NOT NULL CHECK (status IN ('pending', 'eligible', 'blocked', 'guardian_pending', 'guardian_verified', 'guardian_withdrawn')),
  policy_version_id uuid NOT NULL REFERENCES public.privacy_policy_versions(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK (
    (age_band = 'unknown' AND status IN ('pending', 'blocked'))
    OR (age_band = 'age_14_plus' AND status IN ('eligible', 'blocked'))
    OR (age_band = 'under_14' AND status IN ('guardian_pending', 'guardian_verified', 'guardian_withdrawn', 'blocked'))
  )
);
CREATE INDEX privacy_age_profiles_status_idx
  ON public.privacy_age_profiles (status, updated_at DESC);

CREATE TABLE public.privacy_consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  subject_kind text NOT NULL CHECK (subject_kind IN ('self', 'child')),
  guardian_verification_id uuid REFERENCES public.privacy_guardian_verifications(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('privacy_required', 'marketing', 'email_marketing', 'sms_marketing', 'push_marketing', 'night_marketing')),
  channel text NOT NULL CHECK (channel IN ('email', 'sms', 'push', 'in_app', 'none')),
  decision text NOT NULL CHECK (decision IN ('granted', 'withdrawn')),
  policy_version_id uuid NOT NULL REFERENCES public.privacy_policy_versions(id) ON DELETE RESTRICT,
  notice_sha256 text NOT NULL CHECK (notice_sha256 ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  source text NOT NULL CHECK (source IN ('password_signup', 'oauth', 'settings', 'guardian')),
  correlation_id uuid NOT NULL,
  idempotency_key text NOT NULL UNIQUE CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK (
    (purpose = 'privacy_required' AND channel = 'none')
    OR (purpose = 'email_marketing' AND channel = 'email')
    OR (purpose = 'sms_marketing' AND channel = 'sms')
    OR (purpose = 'push_marketing' AND channel = 'push')
    OR (purpose IN ('marketing', 'night_marketing') AND channel IN ('email', 'sms', 'push'))
  ),
  CHECK ((subject_kind = 'self' AND guardian_verification_id IS NULL) OR subject_kind = 'child')
);
CREATE INDEX privacy_consent_events_latest_state_idx
  ON public.privacy_consent_events (user_id, subject_kind, purpose, channel, occurred_at DESC, id DESC);
CREATE INDEX privacy_consent_events_guardian_lookup_idx
  ON public.privacy_consent_events (guardian_verification_id, policy_version_id, occurred_at DESC)
  WHERE subject_kind = 'child';

CREATE TABLE public.privacy_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_]{2,63}$'),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE RESTRICT,
  subject_ref_hash text CHECK (subject_ref_hash IS NULL OR subject_ref_hash ~ '^[0-9a-f]{64}$'),
  operation_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  preview_hash text CHECK (preview_hash IS NULL OR preview_hash ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('previewed', 'confirmed', 'applied', 'partial', 'failed', 'readback_passed', 'readback_failed', 'held')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  error_code text CHECK (error_code IS NULL OR error_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  count_summary jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (public.privacy_audit_count_summary_is_safe(count_summary)),
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (public.privacy_audit_metadata_is_safe(request_metadata)),
  occurred_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  retention_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK (retention_until >= occurred_at)
);
CREATE INDEX privacy_audit_events_operation_idx
  ON public.privacy_audit_events (operation_id, created_at DESC);
CREATE INDEX privacy_audit_events_subject_idx
  ON public.privacy_audit_events (subject_ref_hash, created_at DESC)
  WHERE subject_ref_hash IS NOT NULL;
CREATE INDEX privacy_audit_events_retention_idx
  ON public.privacy_audit_events (retention_until, id);
CREATE FUNCTION public.privacy_resolve_audit_retention_until(
  p_class_code text,
  p_now timestamptz
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '55000', MESSAGE = 'privacy_audit_retention_policy_required';
END;
$$;


CREATE OR REPLACE FUNCTION public.privacy_reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
DECLARE
  v_role text := '';
  v_capability_user_id_text text;
  v_capability_user_id uuid;
BEGIN
  BEGIN
    v_role := COALESCE(
      NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      pg_catalog.current_setting('request.jwt.claim.role', true),
      ''
    );
  EXCEPTION
    WHEN OTHERS THEN
      v_role := '';
  END;

  v_capability_user_id_text := pg_catalog.current_setting('app.account_deletion_user_id', true);
  IF v_capability_user_id_text IS NULL
     OR v_capability_user_id_text !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    RAISE EXCEPTION '기록은 변경하거나 삭제할 수 없습니다' USING ERRCODE = '55000';
  END IF;
  v_capability_user_id := v_capability_user_id_text::uuid;

  IF TG_TABLE_NAME = 'privacy_consent_events' THEN
    IF v_role = 'service_role'
       AND TG_OP = 'DELETE'
       AND OLD.user_id = v_capability_user_id THEN
      RETURN OLD;
    END IF;
  ELSIF TG_TABLE_NAME = 'privacy_audit_events' AND TG_OP = 'UPDATE' THEN
    IF v_role = 'service_role'
       AND OLD.actor_user_id = v_capability_user_id
       AND NEW.actor_user_id IS NULL
       AND (pg_catalog.to_jsonb(NEW) - 'actor_user_id')
           IS NOT DISTINCT FROM (pg_catalog.to_jsonb(OLD) - 'actor_user_id') THEN
      RETURN NEW;
    END IF;
  END IF;

  RAISE EXCEPTION '기록은 변경하거나 삭제할 수 없습니다' USING ERRCODE = '55000';
END;
$$;

CREATE FUNCTION public.privacy_reject_published_policy_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  IF OLD.status IN ('published', 'retired') THEN
    RAISE EXCEPTION '공개된 개인정보 처리 안내 버전은 변경하거나 삭제할 수 없습니다' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER privacy_policy_versions_append_only_after_publication
  BEFORE UPDATE OR DELETE ON public.privacy_policy_versions
  FOR EACH ROW EXECUTE FUNCTION public.privacy_reject_published_policy_mutation();
CREATE TRIGGER privacy_consent_events_append_only
  BEFORE UPDATE OR DELETE ON public.privacy_consent_events
  FOR EACH ROW EXECUTE FUNCTION public.privacy_reject_immutable_mutation();
CREATE TRIGGER privacy_audit_events_append_only
  BEFORE UPDATE OR DELETE ON public.privacy_audit_events
  FOR EACH ROW EXECUTE FUNCTION public.privacy_reject_immutable_mutation();

CREATE FUNCTION public.privacy_under_14_is_eligible(p_user_id uuid, p_policy_version_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.privacy_guardian_verifications AS guardian
    WHERE guardian.child_user_id = p_user_id
      AND guardian.status = 'verified'
      AND guardian.verified_at IS NOT NULL
      AND guardian.verified_at <= CURRENT_TIMESTAMP
      AND guardian.expires_at > CURRENT_TIMESTAMP
      AND guardian.withdrawn_at IS NULL
      AND (
        SELECT event.decision
        FROM public.privacy_consent_events AS event
        WHERE event.user_id = p_user_id
          AND event.subject_kind = 'child'
          AND event.guardian_verification_id = guardian.id
          AND event.purpose = 'privacy_required'
          AND event.channel = 'none'
          AND event.policy_version_id = p_policy_version_id
          AND event.notice_sha256 = (
            SELECT policy.content_sha256
            FROM public.privacy_policy_versions AS policy
            WHERE policy.id = p_policy_version_id
          )
          AND event.source = 'guardian'
        ORDER BY event.occurred_at DESC, event.id DESC
        LIMIT 1
      ) = 'granted'
  );
$$;

CREATE FUNCTION public.privacy_validate_age_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.age_band = 'under_14' AND NEW.status = 'guardian_verified'
     AND NOT public.privacy_under_14_is_eligible(NEW.user_id, NEW.policy_version_id) THEN
    RAISE EXCEPTION '보호자 확인과 일치하는 동의가 필요합니다' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.privacy_validate_consent_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_policy public.privacy_policy_versions%ROWTYPE;
  v_guardian public.privacy_guardian_verifications%ROWTYPE;
BEGIN
  SELECT * INTO v_policy
  FROM public.privacy_policy_versions
  WHERE id = NEW.policy_version_id;

  IF NOT FOUND OR v_policy.status NOT IN ('published', 'retired') THEN
    RAISE EXCEPTION '공개된 개인정보 처리 안내 버전이 필요합니다' USING ERRCODE = '23514';
  END IF;
  IF NEW.decision = 'granted' AND v_policy.status <> 'published' THEN
    RAISE EXCEPTION '현재 공개된 개인정보 처리 안내 버전이 필요합니다' USING ERRCODE = '23514';
  END IF;
  IF NEW.notice_sha256 IS DISTINCT FROM v_policy.content_sha256 THEN
    RAISE EXCEPTION '동의 안내 해시가 일치하지 않습니다' USING ERRCODE = '23514';
  END IF;
  IF NEW.occurred_at > pg_catalog.clock_timestamp() + interval '5 minutes' THEN
    RAISE EXCEPTION '동의 시각이 올바르지 않습니다' USING ERRCODE = '22023';
  END IF;

  IF NEW.subject_kind = 'self' THEN
    IF NEW.guardian_verification_id IS NOT NULL THEN
      RAISE EXCEPTION '본인 동의에는 보호자 확인을 연결할 수 없습니다' USING ERRCODE = '23514';
    END IF;
  ELSE
    IF NEW.guardian_verification_id IS NULL THEN
      RAISE EXCEPTION '아동 동의에는 보호자 확인이 필요합니다' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO v_guardian
    FROM public.privacy_guardian_verifications
    WHERE id = NEW.guardian_verification_id
      AND child_user_id = NEW.user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION '보호자 확인 대상이 일치하지 않습니다' USING ERRCODE = '23514';
    END IF;
    IF NEW.decision = 'granted'
       AND (
         v_guardian.status <> 'verified'
         OR v_guardian.verified_at IS NULL
         OR v_guardian.verified_at > NEW.occurred_at
         OR v_guardian.expires_at <= NEW.occurred_at
         OR v_guardian.withdrawn_at IS NOT NULL
       ) THEN
      RAISE EXCEPTION '유효한 보호자 확인이 필요합니다' USING ERRCODE = '23514';
    END IF;
    IF NEW.source <> 'guardian' THEN
      RAISE EXCEPTION '아동 동의는 보호자 경로로만 기록할 수 있습니다' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF NEW.purpose = 'privacy_required'
     AND NEW.source NOT IN ('password_signup', 'oauth', 'guardian') THEN
    RAISE EXCEPTION '필수 동의의 출처가 올바르지 않습니다' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.privacy_refresh_age_profile(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_profile public.privacy_age_profiles%ROWTYPE;
  v_status text;
BEGIN
  SELECT * INTO v_profile
  FROM public.privacy_age_profiles
  WHERE user_id = p_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_profile.age_band <> 'under_14' THEN
    RETURN;
  END IF;

  IF public.privacy_under_14_is_eligible(p_user_id, v_profile.policy_version_id) THEN
    v_status := 'guardian_verified';
  ELSIF EXISTS (
    SELECT 1
    FROM public.privacy_guardian_verifications AS guardian
    WHERE guardian.child_user_id = p_user_id
      AND guardian.status = 'verified'
      AND guardian.verified_at IS NOT NULL
      AND guardian.verified_at <= CURRENT_TIMESTAMP
      AND guardian.expires_at > CURRENT_TIMESTAMP
      AND guardian.withdrawn_at IS NULL
  ) THEN
    -- A distinct current verification may replace a withdrawn historical one,
    -- but its consent must be recorded before the child is eligible.
    v_status := 'guardian_pending';
  ELSIF EXISTS (
    SELECT 1
    FROM public.privacy_guardian_verifications AS guardian
    WHERE guardian.child_user_id = p_user_id
      AND guardian.status = 'withdrawn'
  ) THEN
    v_status := 'guardian_withdrawn';
  ELSE
    v_status := 'guardian_pending';
  END IF;

  UPDATE public.privacy_age_profiles
  SET status = v_status,
      updated_at = pg_catalog.clock_timestamp()
  WHERE user_id = p_user_id
    AND status IS DISTINCT FROM v_status;
END;
$$;

CREATE FUNCTION public.privacy_refresh_age_profile_after_consent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.subject_kind = 'child' THEN
    PERFORM public.privacy_refresh_age_profile(NEW.user_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE FUNCTION public.privacy_refresh_age_profile_after_guardian()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
BEGIN
  PERFORM public.privacy_refresh_age_profile(NEW.child_user_id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER privacy_age_profiles_guardian_invariant
  BEFORE INSERT OR UPDATE ON public.privacy_age_profiles
  FOR EACH ROW EXECUTE FUNCTION public.privacy_validate_age_profile();
CREATE TRIGGER privacy_consent_events_validate
  BEFORE INSERT ON public.privacy_consent_events
  FOR EACH ROW EXECUTE FUNCTION public.privacy_validate_consent_event();
CREATE TRIGGER privacy_consent_events_refresh_child_eligibility
  AFTER INSERT ON public.privacy_consent_events
  FOR EACH ROW EXECUTE FUNCTION public.privacy_refresh_age_profile_after_consent();
CREATE TRIGGER privacy_guardian_verifications_refresh_child_eligibility
  AFTER INSERT OR UPDATE ON public.privacy_guardian_verifications
  FOR EACH ROW EXECUTE FUNCTION public.privacy_refresh_age_profile_after_guardian();

CREATE VIEW public.privacy_consent_state
WITH (security_barrier = true)
AS
SELECT DISTINCT ON (event.user_id, event.subject_kind, event.purpose, event.channel)
  event.user_id,
  event.subject_kind,
  event.purpose,
  event.channel,
  event.decision,
  event.policy_version_id,
  event.guardian_verification_id,
  event.id AS consent_event_id,
  event.occurred_at
FROM public.privacy_consent_events AS event
WHERE event.user_id = auth.uid()
ORDER BY event.user_id, event.subject_kind, event.purpose, event.channel, event.occurred_at DESC, event.id DESC;

CREATE FUNCTION public.privacy_append_audit_event(
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
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_audit_id uuid;
  v_occurred_at timestamptz := pg_catalog.clock_timestamp();
  v_class_code text;
  v_retention_until timestamptz;
BEGIN
  v_class_code := CASE
    WHEN p_event_type IN (
      'onboarding_challenge_created',
      'onboarding_confirmed',
      'consent_recorded',
      'guardian_verification_recorded'
    ) THEN 'privacy_identity_audit'
    WHEN p_event_type = 'account_deletion' THEN 'privacy_account_deletion_audit'
    ELSE NULL
  END;
  IF v_class_code IS NULL THEN
    RAISE EXCEPTION 'privacy_audit_event_type_not_supported' USING ERRCODE = '22023';
  END IF;

  v_retention_until := public.privacy_resolve_audit_retention_until(
    v_class_code,
    v_occurred_at
  );

  INSERT INTO public.privacy_audit_events (
    event_type, actor_user_id, subject_ref_hash, operation_id, correlation_id,
    status, reason_code, count_summary, request_metadata, occurred_at, retention_until
  )
  VALUES (
    p_event_type,
    p_actor_user_id,
    CASE
      WHEN p_subject_user_id IS NULL THEN NULL
      ELSE pg_catalog.encode(extensions.digest('privacy-subject:v1:' || p_subject_user_id::text, 'sha256'), 'hex')
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
$$;

CREATE FUNCTION public.get_current_privacy_policy_version()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_policy public.privacy_policy_versions%ROWTYPE;
BEGIN
  v_role := COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  IF v_role NOT IN ('authenticated', 'service_role') THEN
    RAISE EXCEPTION '로그인이 필요합니다' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_policy
  FROM public.privacy_policy_versions
  WHERE status = 'published'
    AND effective_at <= pg_catalog.clock_timestamp()
  ORDER BY effective_at DESC, id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION '현재 개인정보 처리 안내를 사용할 수 없습니다' USING ERRCODE = 'P0002';
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
$$;

CREATE FUNCTION public.create_privacy_onboarding_challenge(
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
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_policy_id uuid;
  v_challenge_id uuid;
  v_expires_at timestamptz := COALESCE(p_expires_at, pg_catalog.clock_timestamp() + interval '15 minutes');
  v_audit_id uuid;
BEGIN
  v_role := COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  IF v_role <> 'service_role' THEN
    RAISE EXCEPTION '서비스 권한이 필요합니다' USING ERRCODE = '42501';
  END IF;
  IF p_token_hash IS NULL OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_age_band NOT IN ('unknown', 'age_14_plus', 'under_14')
     OR NOT public.privacy_requested_consents_are_valid(COALESCE(p_requested_consents, '{}'::jsonb))
     OR (p_oauth_nonce_hash IS NOT NULL AND p_oauth_nonce_hash !~ '^[0-9a-f]{64}$')
     OR v_expires_at <= pg_catalog.clock_timestamp()
     OR v_expires_at > pg_catalog.clock_timestamp() + interval '15 minutes' THEN
    RAISE EXCEPTION '온보딩 요청 값이 올바르지 않습니다' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_policy_id
  FROM public.privacy_policy_versions
  WHERE status = 'published'
    AND effective_at <= pg_catalog.clock_timestamp()
  ORDER BY effective_at DESC, id DESC
  LIMIT 1;
  IF v_policy_id IS NULL OR v_policy_id IS DISTINCT FROM p_policy_version_id THEN
    RAISE EXCEPTION '현재 개인정보 처리 안내 버전과 일치하지 않습니다' USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.privacy_onboarding_challenges (
    token_hash, policy_version_id, age_band, requested_consents, oauth_nonce_hash, expires_at
  )
  VALUES (
    p_token_hash, p_policy_version_id, p_age_band, COALESCE(p_requested_consents, '{}'::jsonb), p_oauth_nonce_hash, v_expires_at
  )
  RETURNING id INTO v_challenge_id;

  v_audit_id := public.privacy_append_audit_event(
    'onboarding_challenge_created', NULL, NULL, v_challenge_id, v_challenge_id,
    'applied', 'ONBOARDING_CHALLENGE_CREATED', pg_catalog.jsonb_build_object('requested', 1),
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
$$;

CREATE FUNCTION public.confirm_privacy_onboarding(
  p_challenge_id uuid,
  p_challenge_token text,
  p_user_id uuid,
  p_source text,
  p_guardian_verification_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_challenge public.privacy_onboarding_challenges%ROWTYPE;
  v_policy public.privacy_policy_versions%ROWTYPE;
  v_audit_id uuid;
  v_event_count integer := 0;
  v_status text;
  v_receipt_status text;
  v_error_code text;
  v_existing_audit_id uuid;
  v_event_id uuid;
  v_idempotency_prefix text;
BEGIN
  v_role := COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  IF v_role <> 'service_role' THEN
    RAISE EXCEPTION '서비스 권한이 필요합니다' USING ERRCODE = '42501';
  END IF;
  IF p_challenge_id IS NULL OR p_user_id IS NULL
     OR p_challenge_token IS NULL OR pg_catalog.length(p_challenge_token) NOT BETWEEN 16 AND 512
     OR p_source NOT IN ('password_signup', 'oauth') THEN
    RAISE EXCEPTION '온보딩 확인 값이 올바르지 않습니다' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_challenge
  FROM public.privacy_onboarding_challenges
  WHERE id = p_challenge_id
  FOR UPDATE;
  IF NOT FOUND OR v_challenge.token_hash IS DISTINCT FROM pg_catalog.encode(extensions.digest(p_challenge_token, 'sha256'), 'hex') THEN
    RAISE EXCEPTION '온보딩 확인 정보를 찾을 수 없습니다' USING ERRCODE = 'P0002';
  END IF;
  IF v_challenge.consumed_at IS NOT NULL THEN
    IF v_challenge.consumed_by_user_id IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION '이미 사용된 온보딩 확인 정보입니다' USING ERRCODE = '42501';
    END IF;
    SELECT id INTO v_existing_audit_id
    FROM public.privacy_audit_events
    WHERE operation_id = p_challenge_id
      AND event_type = 'onboarding_confirmed'
    ORDER BY created_at DESC, id DESC
    LIMIT 1;
    SELECT status INTO v_status
    FROM public.privacy_age_profiles
    WHERE user_id = p_user_id;
    v_receipt_status := CASE WHEN v_status IN ('eligible', 'guardian_verified') THEN 'applied' ELSE 'held' END;
    v_error_code := CASE
      WHEN v_status IN ('guardian_pending', 'guardian_withdrawn') THEN 'PRIVACY_GUARDIAN_REQUIRED'
      WHEN v_status IN ('pending', 'blocked') THEN 'PRIVACY_AGE_ATTESTATION_REQUIRED'
      ELSE NULL
    END;
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'operationId', p_challenge_id::text,
      'challengeId', p_challenge_id::text,
      'userId', p_user_id::text,
      'policyVersionId', v_challenge.policy_version_id::text,
      'eligible', v_receipt_status = 'applied',
      'status', v_receipt_status,
      'readback', pg_catalog.jsonb_build_object('passed', true, 'checks', pg_catalog.jsonb_build_object('challengeConsumed', true, 'sameUser', true, 'eligible', v_receipt_status = 'applied')),
      'auditId', v_existing_audit_id::text,
      'errorCode', v_error_code,
      'ageStatus', v_status
    );
  END IF;
  IF v_challenge.expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION '온보딩 확인 정보가 만료되었습니다' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_policy
  FROM public.privacy_policy_versions
  WHERE status = 'published'
    AND effective_at <= pg_catalog.clock_timestamp()
  ORDER BY effective_at DESC, id DESC
  LIMIT 1;
  IF NOT FOUND OR v_policy.id IS DISTINCT FROM v_challenge.policy_version_id THEN
    RAISE EXCEPTION '개인정보 처리 안내 버전이 변경되었습니다' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.privacy_age_profiles WHERE user_id = p_user_id) THEN
    RAISE EXCEPTION '이미 온보딩된 계정입니다' USING ERRCODE = '23505';
  END IF;

  v_status := CASE v_challenge.age_band
    WHEN 'age_14_plus' THEN 'eligible'
    WHEN 'under_14' THEN 'guardian_pending'
    ELSE 'pending'
  END;
  INSERT INTO public.privacy_age_profiles (
    user_id, age_band, attested_at, method, status, policy_version_id
  )
  VALUES (
    p_user_id,
    v_challenge.age_band,
    pg_catalog.clock_timestamp(),
    'self_attestation',
    v_status,
    v_challenge.policy_version_id
  );

  v_idempotency_prefix := 'onb' || pg_catalog.replace(p_challenge_id::text, '-', '');
  IF v_challenge.age_band = 'age_14_plus' THEN
    INSERT INTO public.privacy_consent_events (
      user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256,
      source, correlation_id, idempotency_key
    )
    VALUES (
      p_user_id, 'self', 'privacy_required', 'none', 'granted', v_policy.id, v_policy.content_sha256,
      p_source, p_challenge_id, v_idempotency_prefix || 'required'
    );
    v_event_count := v_event_count + 1;

    IF COALESCE((v_challenge.requested_consents ->> 'email')::boolean, false) THEN
      INSERT INTO public.privacy_consent_events (user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256, source, correlation_id, idempotency_key)
      VALUES (p_user_id, 'self', 'email_marketing', 'email', 'granted', v_policy.id, v_policy.content_sha256, p_source, p_challenge_id, v_idempotency_prefix || 'email');
      v_event_count := v_event_count + 1;
    END IF;
    IF COALESCE((v_challenge.requested_consents ->> 'sms')::boolean, false) THEN
      INSERT INTO public.privacy_consent_events (user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256, source, correlation_id, idempotency_key)
      VALUES (p_user_id, 'self', 'sms_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256, p_source, p_challenge_id, v_idempotency_prefix || 'sms');
      v_event_count := v_event_count + 1;
    END IF;
    IF COALESCE((v_challenge.requested_consents ->> 'push')::boolean, false) THEN
      INSERT INTO public.privacy_consent_events (user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256, source, correlation_id, idempotency_key)
      VALUES (p_user_id, 'self', 'push_marketing', 'push', 'granted', v_policy.id, v_policy.content_sha256, p_source, p_challenge_id, v_idempotency_prefix || 'push');
      v_event_count := v_event_count + 1;
    END IF;
    IF COALESCE((v_challenge.requested_consents ->> 'night_email')::boolean, false) THEN
      INSERT INTO public.privacy_consent_events (user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256, source, correlation_id, idempotency_key)
      VALUES (p_user_id, 'self', 'night_marketing', 'email', 'granted', v_policy.id, v_policy.content_sha256, p_source, p_challenge_id, v_idempotency_prefix || 'nightemail');
      v_event_count := v_event_count + 1;
    END IF;
    IF COALESCE((v_challenge.requested_consents ->> 'night_sms')::boolean, false) THEN
      INSERT INTO public.privacy_consent_events (user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256, source, correlation_id, idempotency_key)
      VALUES (p_user_id, 'self', 'night_marketing', 'sms', 'granted', v_policy.id, v_policy.content_sha256, p_source, p_challenge_id, v_idempotency_prefix || 'nightsms');
      v_event_count := v_event_count + 1;
    END IF;
    IF COALESCE((v_challenge.requested_consents ->> 'night_push')::boolean, false) THEN
      INSERT INTO public.privacy_consent_events (user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256, source, correlation_id, idempotency_key)
      VALUES (p_user_id, 'self', 'night_marketing', 'push', 'granted', v_policy.id, v_policy.content_sha256, p_source, p_challenge_id, v_idempotency_prefix || 'nightpush');
      v_event_count := v_event_count + 1;
    END IF;
  ELSIF v_challenge.age_band = 'under_14' AND p_guardian_verification_id IS NOT NULL THEN
    INSERT INTO public.privacy_consent_events (
      user_id, subject_kind, guardian_verification_id, purpose, channel, decision, policy_version_id,
      notice_sha256, source, correlation_id, idempotency_key
    )
    VALUES (
      p_user_id, 'child', p_guardian_verification_id, 'privacy_required', 'none', 'granted', v_policy.id,
      v_policy.content_sha256, 'guardian', p_challenge_id, v_idempotency_prefix || 'guardianrequired'
    );
    v_event_count := v_event_count + 1;
  END IF;

  UPDATE public.privacy_onboarding_challenges
  SET consumed_at = pg_catalog.clock_timestamp(),
      consumed_by_user_id = p_user_id
  WHERE id = p_challenge_id
    AND consumed_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION '온보딩 확인 정보를 사용할 수 없습니다' USING ERRCODE = '55000';
  END IF;

  SELECT status INTO v_status
  FROM public.privacy_age_profiles
  WHERE user_id = p_user_id;
  v_receipt_status := CASE WHEN v_status IN ('eligible', 'guardian_verified') THEN 'applied' ELSE 'held' END;
  v_error_code := CASE
    WHEN v_status IN ('guardian_pending', 'guardian_withdrawn') THEN 'PRIVACY_GUARDIAN_REQUIRED'
    WHEN v_status IN ('pending', 'blocked') THEN 'PRIVACY_AGE_ATTESTATION_REQUIRED'
    ELSE NULL
  END;
  v_audit_id := public.privacy_append_audit_event(
    'onboarding_confirmed', p_user_id, p_user_id, p_challenge_id, p_challenge_id,
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
$$;

CREATE FUNCTION public.submit_privacy_consent(
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
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_user_id uuid := auth.uid();
  v_existing public.privacy_consent_events%ROWTYPE;
  v_event_id uuid;
  v_audit_id uuid;
BEGIN
  v_role := COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  IF v_role <> 'authenticated' OR v_user_id IS NULL THEN
    RAISE EXCEPTION '로그인이 필요합니다' USING ERRCODE = '42501';
  END IF;
  IF p_purpose NOT IN ('privacy_required', 'marketing', 'email_marketing', 'sms_marketing', 'push_marketing', 'night_marketing')
     OR p_channel NOT IN ('email', 'sms', 'push', 'in_app', 'none')
     OR p_decision NOT IN ('granted', 'withdrawn')
     OR p_policy_version_id IS NULL
     OR p_notice_sha256 IS NULL OR p_notice_sha256 !~ '^[0-9a-f]{64}$'
     OR p_source <> 'settings'
     OR p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9_-]{16,128}$'
     OR p_correlation_id IS NULL THEN
    RAISE EXCEPTION '동의 요청 값이 올바르지 않습니다' USING ERRCODE = '22023';
  END IF;
  IF p_guardian_verification_id IS NOT NULL OR p_purpose = 'privacy_required' THEN
    RAISE EXCEPTION '이 동의는 현재 설정에서 변경할 수 없습니다' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_idempotency_key, 0));
  SELECT * INTO v_existing
  FROM public.privacy_consent_events
  WHERE idempotency_key = p_idempotency_key
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
      RAISE EXCEPTION '동일한 중복 방지 키가 다른 요청에 사용되었습니다' USING ERRCODE = '23505';
    END IF;
    SELECT id INTO v_audit_id
    FROM public.privacy_audit_events
    WHERE operation_id = p_correlation_id
      AND event_type = 'consent_recorded'
    ORDER BY created_at DESC, id DESC
    LIMIT 1;
    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'operationId', p_correlation_id::text,
      'status', 'applied',
      'readback', pg_catalog.jsonb_build_object('passed', true, 'checks', pg_catalog.jsonb_build_object('consentEventPresent', true, 'idempotentReplay', true)),
      'auditId', v_audit_id::text,
      'consentEventId', v_existing.id::text
    );
  END IF;

  INSERT INTO public.privacy_consent_events (
    user_id, subject_kind, purpose, channel, decision, policy_version_id, notice_sha256,
    source, correlation_id, idempotency_key
  )
  VALUES (
    v_user_id, 'self', p_purpose, p_channel, p_decision, p_policy_version_id, p_notice_sha256,
    p_source, p_correlation_id, p_idempotency_key
  )
  RETURNING id INTO v_event_id;

  v_audit_id := public.privacy_append_audit_event(
    'consent_recorded', v_user_id, v_user_id, p_correlation_id, p_correlation_id,
    'applied', 'CONSENT_RECORDED', pg_catalog.jsonb_build_object('consentEvents', 1),
    pg_catalog.jsonb_build_object('route', '/api/privacy/consent')
  );
  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'operationId', p_correlation_id::text,
    'status', 'applied',
    'readback', pg_catalog.jsonb_build_object('passed', true, 'checks', pg_catalog.jsonb_build_object('consentEventPresent', true, 'idempotentReplay', false)),
    'auditId', v_audit_id::text,
    'consentEventId', v_event_id::text
  );
END;
$$;

CREATE FUNCTION public.record_privacy_guardian_verification(
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
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_role text;
  v_existing public.privacy_guardian_verifications%ROWTYPE;
  v_audit_id uuid;
BEGIN
  v_role := COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  IF v_role <> 'service_role' THEN
    RAISE EXCEPTION '서비스 권한이 필요합니다' USING ERRCODE = '42501';
  END IF;
  IF p_verification_id IS NULL OR p_child_user_id IS NULL
     OR p_status NOT IN ('pending', 'verified', 'rejected', 'expired', 'withdrawn')
     OR p_provider IS NULL OR p_provider !~ '^[A-Za-z0-9._-]{1,80}$'
     OR p_provider_reference_hash IS NULL OR p_provider_reference_hash !~ '^[0-9a-f]{64}$'
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
     OR (p_status <> 'verified' AND (p_verified_at IS NOT NULL OR p_expires_at IS NOT NULL)) THEN
    RAISE EXCEPTION '보호자 확인 요청 값이 올바르지 않습니다' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing
  FROM public.privacy_guardian_verifications
  WHERE id = p_verification_id
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.child_user_id IS DISTINCT FROM p_child_user_id
       OR v_existing.provider IS DISTINCT FROM p_provider
       OR v_existing.provider_reference_hash IS DISTINCT FROM p_provider_reference_hash THEN
      RAISE EXCEPTION '보호자 확인 식별자가 다른 대상에 사용되었습니다' USING ERRCODE = '23505';
    END IF;
    IF v_existing.status IS DISTINCT FROM p_status THEN
      IF NOT (
        (v_existing.status = 'pending' AND p_status IN ('verified', 'rejected', 'expired', 'withdrawn'))
        OR (v_existing.status = 'verified' AND p_status IN ('expired', 'withdrawn'))
      ) THEN
        RAISE EXCEPTION '보호자 확인 상태 전환이 올바르지 않습니다' USING ERRCODE = '23514';
      END IF;
      UPDATE public.privacy_guardian_verifications
      SET status = p_status,
          verified_at = p_verified_at,
          expires_at = p_expires_at,
          withdrawn_at = CASE WHEN p_status = 'withdrawn' THEN pg_catalog.clock_timestamp() ELSE NULL END,
          updated_at = pg_catalog.clock_timestamp()
      WHERE id = p_verification_id;
    ELSIF v_existing.verified_at IS DISTINCT FROM p_verified_at
       OR v_existing.expires_at IS DISTINCT FROM p_expires_at THEN
      RAISE EXCEPTION '보호자 확인 식별자가 다른 요청에 사용되었습니다' USING ERRCODE = '23505';
    END IF;
  ELSE
    INSERT INTO public.privacy_guardian_verifications (
      id, child_user_id, status, provider, provider_reference_hash, verified_at, expires_at,
      withdrawn_at, updated_at
    )
    VALUES (
      p_verification_id, p_child_user_id, p_status, p_provider, p_provider_reference_hash, p_verified_at, p_expires_at,
      CASE WHEN p_status = 'withdrawn' THEN pg_catalog.clock_timestamp() ELSE NULL END,
      pg_catalog.clock_timestamp()
    );
  END IF;

  PERFORM public.privacy_refresh_age_profile(p_child_user_id);
  v_audit_id := public.privacy_append_audit_event(
    'guardian_verification_recorded', NULL, p_child_user_id, p_verification_id, p_verification_id,
    'applied', 'GUARDIAN_VERIFICATION_RECORDED',
    pg_catalog.jsonb_build_object('guardianVerified', p_status = 'verified'),
    pg_catalog.jsonb_build_object('route', '/api/privacy/guardian')
  );
  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'operationId', p_verification_id::text,
    'status', 'applied',
    'readback', pg_catalog.jsonb_build_object('passed', true, 'checks', pg_catalog.jsonb_build_object('verificationRecorded', true, 'verified', p_status = 'verified')),
    'auditId', v_audit_id::text,
    'guardianStatus', p_status
  );
END;
$$;

CREATE FUNCTION public.read_privacy_guardian_status(p_child_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_age public.privacy_age_profiles%ROWTYPE;
  v_guardian public.privacy_guardian_verifications%ROWTYPE;
BEGIN
  IF COALESCE(NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', pg_catalog.current_setting('request.jwt.claim.role', true), '') <> 'service_role' THEN
    RAISE EXCEPTION '서비스 역할만 보호자 확인 상태를 조회할 수 있습니다' USING ERRCODE = '42501';
  END IF;
  IF p_child_user_id IS NULL THEN
    RAISE EXCEPTION '아동 계정 식별자가 필요합니다' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_age
  FROM public.privacy_age_profiles
  WHERE user_id = p_child_user_id;
  IF NOT FOUND OR v_age.age_band <> 'under_14' THEN
    RAISE EXCEPTION '보호자 확인 대상 계정을 찾을 수 없습니다' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_guardian
  FROM public.privacy_guardian_verifications
  WHERE child_user_id = p_child_user_id
  ORDER BY updated_at DESC, id DESC
  LIMIT 1;

  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'userId', p_child_user_id::text,
    'ageStatus', v_age.status,
    'guardianStatus', COALESCE(v_guardian.status, 'pending'),
    'verificationId', CASE WHEN v_guardian.id IS NULL THEN NULL ELSE v_guardian.id::text END,
    'expiresAt', CASE WHEN v_guardian.expires_at IS NULL THEN NULL ELSE pg_catalog.to_char(v_guardian.expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'eligible', v_age.status = 'guardian_verified'
  );
END;
$$;

ALTER FUNCTION public.privacy_under_14_is_eligible(uuid, uuid) OWNER TO postgres;
ALTER FUNCTION public.privacy_validate_age_profile() OWNER TO postgres;
ALTER FUNCTION public.privacy_validate_consent_event() OWNER TO postgres;
ALTER FUNCTION public.privacy_refresh_age_profile(uuid) OWNER TO postgres;
ALTER FUNCTION public.privacy_refresh_age_profile_after_consent() OWNER TO postgres;
ALTER FUNCTION public.privacy_refresh_age_profile_after_guardian() OWNER TO postgres;
ALTER FUNCTION public.privacy_append_audit_event(text, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb) OWNER TO postgres;
ALTER FUNCTION public.privacy_resolve_audit_retention_until(text, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.get_current_privacy_policy_version() OWNER TO postgres;
ALTER FUNCTION public.create_privacy_onboarding_challenge(text, uuid, text, jsonb, text, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.confirm_privacy_onboarding(uuid, text, uuid, text, uuid) OWNER TO postgres;
ALTER FUNCTION public.submit_privacy_consent(text, text, text, uuid, text, text, uuid, text, uuid) OWNER TO postgres;
ALTER FUNCTION public.record_privacy_guardian_verification(uuid, uuid, text, text, text, timestamptz, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.read_privacy_guardian_status(uuid) OWNER TO postgres;

ALTER TABLE public.privacy_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_policy_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_onboarding_challenges ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_onboarding_challenges FORCE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_guardian_verifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_guardian_verifications FORCE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_age_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_age_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_consent_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_consent_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_audit_events FORCE ROW LEVEL SECURITY;

CREATE POLICY privacy_policy_versions_internal_only ON public.privacy_policy_versions
  FOR ALL
  USING (current_user = 'postgres' OR auth.role() = 'service_role')
  WITH CHECK (current_user = 'postgres' OR auth.role() = 'service_role');
CREATE POLICY privacy_onboarding_challenges_internal_only ON public.privacy_onboarding_challenges
  FOR ALL
  USING (current_user = 'postgres' OR auth.role() = 'service_role')
  WITH CHECK (current_user = 'postgres' OR auth.role() = 'service_role');
CREATE POLICY privacy_guardian_verifications_internal_only ON public.privacy_guardian_verifications
  FOR ALL
  USING (current_user = 'postgres' OR auth.role() = 'service_role')
  WITH CHECK (current_user = 'postgres' OR auth.role() = 'service_role');
CREATE POLICY privacy_age_profiles_internal_mutation ON public.privacy_age_profiles
  FOR ALL
  USING (current_user = 'postgres')
  WITH CHECK (current_user = 'postgres');
CREATE POLICY privacy_age_profiles_owner_read ON public.privacy_age_profiles
  FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY privacy_consent_events_internal_only ON public.privacy_consent_events
  FOR ALL
  USING (current_user = 'postgres')
  WITH CHECK (current_user = 'postgres');
CREATE POLICY privacy_audit_events_insert_only ON public.privacy_audit_events
  FOR INSERT
  WITH CHECK (current_user = 'postgres' OR auth.role() = 'service_role');
CREATE POLICY privacy_audit_events_internal_read ON public.privacy_audit_events
  FOR SELECT
  USING (current_user = 'postgres');

REVOKE ALL ON TABLE public.privacy_policy_versions FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.privacy_onboarding_challenges FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.privacy_guardian_verifications FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.privacy_age_profiles FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.privacy_consent_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.privacy_audit_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.privacy_consent_state FROM PUBLIC, anon, authenticated, service_role;

GRANT SELECT, INSERT ON TABLE public.privacy_policy_versions TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.privacy_onboarding_challenges TO service_role;
GRANT INSERT ON TABLE public.privacy_audit_events TO service_role;
GRANT SELECT ON TABLE public.privacy_age_profiles TO authenticated;
GRANT SELECT ON TABLE public.privacy_consent_state TO authenticated;

REVOKE ALL ON FUNCTION public.privacy_under_14_is_eligible(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.privacy_validate_age_profile() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.privacy_validate_consent_event() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.privacy_refresh_age_profile(uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.privacy_refresh_age_profile_after_consent() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.privacy_refresh_age_profile_after_guardian() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.privacy_append_audit_event(text, uuid, uuid, uuid, uuid, text, text, jsonb, jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.privacy_resolve_audit_retention_until(text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_current_privacy_policy_version() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.create_privacy_onboarding_challenge(text, uuid, text, jsonb, text, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_privacy_onboarding(uuid, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.submit_privacy_consent(text, text, text, uuid, text, text, uuid, text, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.record_privacy_guardian_verification(uuid, uuid, text, text, text, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_privacy_guardian_status(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.get_current_privacy_policy_version() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_privacy_onboarding_challenge(text, uuid, text, jsonb, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.confirm_privacy_onboarding(uuid, text, uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.submit_privacy_consent(text, text, text, uuid, text, text, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_privacy_guardian_verification(uuid, uuid, text, text, text, timestamptz, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_privacy_guardian_status(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';
