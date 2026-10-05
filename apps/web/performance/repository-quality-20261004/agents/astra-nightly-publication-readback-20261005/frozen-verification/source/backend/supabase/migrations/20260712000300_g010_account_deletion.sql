-- G010 account deletion is a bounded, policy-versioned technical workflow.
-- It does not promise universal deletion and stores no raw content in its audit trail.

DO $$
BEGIN
  IF to_regprocedure('extensions.digest(text,text)') IS NULL THEN
    RAISE EXCEPTION 'g010_account_deletion_sha256_required' USING ERRCODE = '55000';
  END IF;
END;
$$;

CREATE TABLE public.account_deletion_policies (
  version text PRIMARY KEY CHECK (version ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  preview_ttl interval NOT NULL CHECK (preview_ttl > interval '0 seconds' AND preview_ttl <= interval '1 hour'),
  reauth_max_age interval NOT NULL CHECK (reauth_max_age > interval '0 seconds' AND reauth_max_age <= interval '1 hour'),
  confirmation_text text NOT NULL CHECK (confirmation_text = '계정 삭제'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE UNIQUE INDEX account_deletion_policies_one_active_idx
  ON public.account_deletion_policies ((status))
  WHERE status = 'active';

INSERT INTO public.account_deletion_policies (
  version,
  status,
  preview_ttl,
  reauth_max_age,
  confirmation_text
) VALUES (
  'g010-account-deletion-v1',
  'active',
  interval '10 minutes',
  interval '5 minutes',
  '계정 삭제'
)
ON CONFLICT (version) DO NOTHING;

CREATE TABLE public.account_deletion_data_classes (
  policy_version text NOT NULL REFERENCES public.account_deletion_policies(version) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  disposition text NOT NULL CHECK (disposition IN ('delete', 'anonymize', 'separate', 'retain')),
  mandatory boolean NOT NULL DEFAULT true,
  PRIMARY KEY (policy_version, code)
);

-- These rows enumerate the technical scope. They are not a statement about any
-- retention period, legal obligation, or every data source that may exist.
INSERT INTO public.account_deletion_data_classes (policy_version, code, disposition, mandatory)
VALUES
  ('g010-account-deletion-v1', 'profile_identity', 'anonymize', true),
  ('g010-account-deletion-v1', 'user_statistics', 'delete', true),
  ('g010-account-deletion-v1', 'user_bookmarks', 'delete', true),
  ('g010-account-deletion-v1', 'notifications', 'delete', true),
  ('g010-account-deletion-v1', 'user_preferences', 'delete', true),
  ('g010-account-deletion-v1', 'storyboard_documents', 'delete', true),
  ('g010-account-deletion-v1', 'submission_drafts', 'delete', true),
  ('g010-account-deletion-v1', 'review_likes', 'delete', true),
  ('g010-account-deletion-v1', 'reviews', 'delete', true),
  ('g010-account-deletion-v1', 'restaurant_submissions', 'delete', true),
  ('g010-account-deletion-v1', 'restaurant_requests', 'delete', true),
  ('g010-account-deletion-v1', 'ocr_logs', 'delete', true),
  ('g010-account-deletion-v1', 'marketing_campaign_recipients', 'delete', true),
  ('g010-account-deletion-v1', 'privacy_identity_records', 'delete', true),
  ('g010-account-deletion-v1', 'privacy_audit_actor_references', 'anonymize', true),
  ('g010-account-deletion-v1', 'storage_objects', 'delete', true),
  ('g010-account-deletion-v1', 'auth_identity', 'delete', true),
  ('g010-account-deletion-v1', 'approved_audit_records', 'retain', false),
  ('g010-account-deletion-v1', 'retention_work_items', 'separate', false)
ON CONFLICT (policy_version, code) DO NOTHING;

CREATE TABLE public.account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  policy_version text NOT NULL REFERENCES public.account_deletion_policies(version) ON DELETE RESTRICT,
  preview_hash text NOT NULL CHECK (preview_hash ~ '^[0-9a-f]{64}$'),
  preview_expires_at timestamptz NOT NULL,
  reauthenticated_at timestamptz NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'previewed', 'applying', 'applied', 'partial', 'failed')),
  idempotency_key text CHECK (idempotency_key IS NULL OR idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  count_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  db_readback_passed boolean NOT NULL DEFAULT false,
  storage_readback_passed boolean NOT NULL DEFAULT false,
  session_readback_passed boolean NOT NULL DEFAULT false,
  auth_readback_passed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  applied_at timestamptz,
  CHECK (actor_user_id <> target_user_id OR actor_user_id = target_user_id),
  CHECK (preview_expires_at > reauthenticated_at),
  CHECK (
    status <> 'applied'
    OR (
      db_readback_passed
      AND storage_readback_passed
      AND session_readback_passed
      AND auth_readback_passed
      AND applied_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX account_deletion_requests_actor_idempotency_idx
  ON public.account_deletion_requests (actor_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX account_deletion_requests_target_status_idx
  ON public.account_deletion_requests (target_user_id, status, created_at DESC);

CREATE TABLE public.account_deletion_request_items (
  request_id uuid NOT NULL REFERENCES public.account_deletion_requests(id) ON DELETE RESTRICT,
  data_class_code text NOT NULL,
  disposition text NOT NULL CHECK (disposition IN ('delete', 'anonymize', 'separate', 'retain')),
  mandatory boolean NOT NULL,
  planned_count integer NOT NULL DEFAULT 0 CHECK (planned_count >= 0),
  status text NOT NULL CHECK (status IN ('planned', 'applied', 'retained', 'separated', 'failed')),
  reason_code text NOT NULL CHECK (reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (request_id, data_class_code)
);

CREATE INDEX account_deletion_request_items_status_idx
  ON public.account_deletion_request_items (request_id, status, data_class_code);

ALTER TABLE public.account_deletion_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_data_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_data_classes FORCE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_requests FORCE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_request_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_request_items FORCE ROW LEVEL SECURITY;

CREATE POLICY account_deletion_policies_service_only ON public.account_deletion_policies
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY account_deletion_data_classes_service_only ON public.account_deletion_data_classes
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY account_deletion_requests_service_only ON public.account_deletion_requests
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY account_deletion_request_items_service_only ON public.account_deletion_request_items
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

REVOKE ALL ON TABLE public.account_deletion_policies FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.account_deletion_data_classes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.account_deletion_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.account_deletion_request_items FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.account_deletion_policies TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.account_deletion_data_classes TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.account_deletion_requests TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.account_deletion_request_items TO service_role;

CREATE OR REPLACE FUNCTION public.account_deletion_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog
AS $$
BEGIN
  NEW.updated_at = pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.account_deletion_require_service_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, auth
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'account_deletion_service_role_required' USING ERRCODE = '42501';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.account_deletion_subject_hash(p_user_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, extensions
AS $$
  SELECT pg_catalog.encode(extensions.digest('privacy-subject:v1:' || p_user_id::text, 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.account_deletion_is_active_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles AS role_row
    LEFT JOIN public.user_account_status AS status_row ON status_row.user_id = role_row.user_id
    WHERE role_row.user_id = p_user_id
      AND role_row.role = 'admin'
      AND COALESCE(status_row.account_status, 'active') = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.account_deletion_write_audit(
  p_request public.account_deletion_requests,
  p_status text,
  p_reason_code text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_total integer := 0;
  v_anonymized integer := 0;
  v_retained_or_separated integer := 0;
  v_failed integer := 0;
BEGIN
  SELECT
    COALESCE(SUM(item.planned_count), 0),
    COALESCE(SUM(item.planned_count) FILTER (WHERE item.disposition = 'anonymize'), 0),
    COALESCE(SUM(item.planned_count) FILTER (WHERE item.disposition IN ('retain', 'separate')), 0),
    COALESCE(SUM(item.planned_count) FILTER (WHERE item.status = 'failed'), 0)
  INTO v_total, v_anonymized, v_retained_or_separated, v_failed
  FROM public.account_deletion_request_items AS item
  WHERE item.request_id = p_request.id;

  RETURN public.privacy_append_audit_event(
    'account_deletion',
    NULL,
    p_request.target_user_id,
    p_request.id,
    p_request.id,
    p_status,
    p_reason_code,
    pg_catalog.jsonb_build_object(
      'requested', v_total,
      'updated', v_anonymized,
      'suppressed', v_retained_or_separated,
      'failed', v_failed
    ),
    pg_catalog.jsonb_build_object('route', '/api/account/delete')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_account_deletion(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_reauthenticated_at timestamptz
)
RETURNS TABLE (
  request_id uuid,
  preview_hash text,
  preview_expires_at timestamptz,
  policy_version text,
  status text,
  reason_code text,
  delete_count integer,
  anonymize_count integer,
  separate_count integer,
  retain_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth, extensions
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_policy public.account_deletion_policies%ROWTYPE;
  v_last_sign_in_at timestamptz;
  v_target_is_active_admin boolean := false;
  v_other_active_admins integer := 0;
  v_preview_hash text;
  v_request public.account_deletion_requests%ROWTYPE;
  v_count integer;
  v_profile_count integer := 0;
  v_stats_count integer := 0;
  v_bookmarks_count integer := 0;
  v_notifications_count integer := 0;
  v_preferences_count integer := 0;
  v_documents_count integer := 0;
  v_review_likes_count integer := 0;
  v_reviews_count integer := 0;
  v_submissions_count integer := 0;
  v_requests_count integer := 0;
  v_ocr_logs_count integer := 0;
  v_marketing_recipients_count integer := 0;
  v_storage_count integer := 0;
  v_total_delete integer := 0;
  v_privacy_consent_count integer := 0;
  v_privacy_age_profile_count integer := 0;
  v_privacy_guardian_count integer := 0;
  v_privacy_challenge_count integer := 0;
  v_privacy_identity_count integer := 0;
  v_privacy_audit_actor_reference_count integer := 0;
BEGIN
  PERFORM public.account_deletion_require_service_role();

  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::timestamptz, NULL::text, 'failed'::text, 'ACTOR_OR_TARGET_REQUIRED'::text, 0, 0, 0, 0;
    RETURN;
  END IF;

  IF p_actor_user_id <> p_target_user_id AND NOT public.account_deletion_is_active_admin(p_actor_user_id) THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::timestamptz, NULL::text, 'failed'::text, 'ACTOR_NOT_ALLOWED'::text, 0, 0, 0, 0;
    RETURN;
  END IF;

  SELECT u.last_sign_in_at INTO v_last_sign_in_at
  FROM auth.users AS u
  WHERE u.id = p_actor_user_id;

  IF v_last_sign_in_at IS NULL
    OR p_reauthenticated_at IS NULL
    OR v_last_sign_in_at < v_now - interval '5 minutes'
    OR abs(extract(epoch FROM (p_reauthenticated_at - v_last_sign_in_at))) > 1
  THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::timestamptz, NULL::text, 'failed'::text, 'REAUTH_REQUIRED'::text, 0, 0, 0, 0;
    RETURN;
  END IF;

  SELECT policy.* INTO v_policy
  FROM public.account_deletion_policies AS policy
  WHERE policy.status = 'active'
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::timestamptz, NULL::text, 'failed'::text, 'POLICY_UNAVAILABLE'::text, 0, 0, 0, 0;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_target_user_id::text, 0));

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users AS target_user
    WHERE target_user.id = p_target_user_id
  ) THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::timestamptz, v_policy.version, 'failed'::text, 'TARGET_NOT_FOUND'::text, 0, 0, 0, 0;
    RETURN;
  END IF;

  v_target_is_active_admin := public.account_deletion_is_active_admin(p_target_user_id);
  IF v_target_is_active_admin THEN
    SELECT count(*) INTO v_other_active_admins
    FROM public.user_roles AS role_row
    LEFT JOIN public.user_account_status AS status_row ON status_row.user_id = role_row.user_id
    WHERE role_row.role = 'admin'
      AND role_row.user_id <> p_target_user_id
      AND COALESCE(status_row.account_status, 'active') = 'active';

    IF v_other_active_admins = 0 THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::timestamptz, v_policy.version, 'failed'::text, 'LAST_ADMIN_PROTECTED'::text, 0, 0, 0, 0;
      RETURN;
    END IF;
  END IF;

  -- An active legal hold blocks deletion. A missing retention installation blocks
  -- rather than silently continuing with an unknown retention state.
  IF to_regclass('privacy_retention.privacy_legal_holds') IS NULL THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::timestamptz, v_policy.version, 'failed'::text, 'RETENTION_POLICY_UNAVAILABLE'::text, 0, 0, 0, 0;
    RETURN;
  END IF;

  BEGIN
    PERFORM public.privacy_resolve_audit_retention_until(
      'privacy_account_deletion_audit',
      v_now
    );
  EXCEPTION
    WHEN SQLSTATE '55000' THEN
      RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::timestamptz, v_policy.version, 'failed'::text, 'RETENTION_POLICY_UNAVAILABLE'::text, 0, 0, 0, 0;
      RETURN;
  END;

  EXECUTE
    'SELECT EXISTS (
      SELECT 1 FROM privacy_retention.privacy_legal_holds
      WHERE subject_ref_hash = $1
        AND data_class = ''account_deletion''
        AND status = ''active''
        AND (expires_at IS NULL OR expires_at > $2)
    )'
  INTO v_target_is_active_admin
  USING public.account_deletion_subject_hash(p_target_user_id), v_now;

  IF v_target_is_active_admin THEN
    RETURN QUERY SELECT NULL::uuid, NULL::text, NULL::timestamptz, v_policy.version, 'failed'::text, 'LEGAL_HOLD_ACTIVE'::text, 0, 0, 0, 0;
    RETURN;
  END IF;

  IF to_regclass('public.profiles') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.profiles WHERE user_id = $1' INTO v_profile_count USING p_target_user_id;
  END IF;
  IF to_regclass('public.user_stats') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.user_stats WHERE user_id = $1' INTO v_stats_count USING p_target_user_id;
  END IF;
  IF to_regclass('public.user_bookmarks') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.user_bookmarks WHERE user_id = $1' INTO v_bookmarks_count USING p_target_user_id;
  END IF;
  IF to_regclass('public.notifications') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.notifications WHERE user_id = $1' INTO v_notifications_count USING p_target_user_id;
  END IF;
  IF to_regclass('public.admin_user_preferences') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.admin_user_preferences WHERE user_id = $1' INTO v_preferences_count USING p_target_user_id;
  END IF;
  IF to_regclass('public.documents') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.documents WHERE user_id = $1' INTO v_documents_count USING p_target_user_id;
  END IF;
  IF to_regclass('public.review_likes') IS NOT NULL THEN
    IF to_regclass('public.reviews') IS NOT NULL THEN
      EXECUTE 'SELECT count(*) FROM public.review_likes AS review_like WHERE review_like.user_id = $1 OR review_like.review_id IN (SELECT review_row.id FROM public.reviews AS review_row WHERE review_row.user_id = $1)' INTO v_review_likes_count USING p_target_user_id;
    ELSE
      EXECUTE 'SELECT count(*) FROM public.review_likes WHERE user_id = $1' INTO v_review_likes_count USING p_target_user_id;
    END IF;
  END IF;
  IF to_regclass('public.reviews') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.reviews WHERE user_id = $1' INTO v_reviews_count USING p_target_user_id;
  END IF;
  IF to_regclass('public.restaurant_submissions') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.restaurant_submissions WHERE user_id = $1' INTO v_submissions_count USING p_target_user_id;
  END IF;
  IF to_regclass('public.restaurant_requests') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.restaurant_requests WHERE user_id = $1' INTO v_requests_count USING p_target_user_id;
  END IF;
  IF to_regclass('public.ocr_logs') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.ocr_logs WHERE user_id = $1' INTO v_ocr_logs_count USING p_target_user_id;
  END IF;
  IF to_regclass('public.marketing_campaign_recipients') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.marketing_campaign_recipients WHERE user_id = $1' INTO v_marketing_recipients_count USING p_target_user_id;
  END IF;
  SELECT count(*) INTO v_privacy_consent_count
  FROM public.privacy_consent_events
  WHERE user_id = p_target_user_id;
  SELECT count(*) INTO v_privacy_age_profile_count
  FROM public.privacy_age_profiles
  WHERE user_id = p_target_user_id;
  SELECT count(*) INTO v_privacy_guardian_count
  FROM public.privacy_guardian_verifications
  WHERE child_user_id = p_target_user_id;
  SELECT count(*) INTO v_privacy_challenge_count
  FROM public.privacy_onboarding_challenges
  WHERE consumed_by_user_id = p_target_user_id;
  v_privacy_identity_count := v_privacy_consent_count
    + v_privacy_age_profile_count
    + v_privacy_guardian_count
    + v_privacy_challenge_count;
  SELECT count(*) INTO v_privacy_audit_actor_reference_count
  FROM public.privacy_audit_events
  WHERE actor_user_id = p_target_user_id;
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM storage.objects WHERE owner_id = $1::text' INTO v_storage_count USING p_target_user_id;
  END IF;

  v_total_delete := v_stats_count + v_bookmarks_count + v_notifications_count + v_preferences_count + v_documents_count + v_review_likes_count + v_reviews_count + v_submissions_count + v_requests_count + v_ocr_logs_count + v_marketing_recipients_count + v_privacy_identity_count + v_storage_count + 1;
  v_preview_hash := pg_catalog.encode(
    extensions.digest(
      jsonb_build_object(
        'actor', p_actor_user_id,
        'target', p_target_user_id,
        'policy', v_policy.version,
        'reauthenticatedAt', p_reauthenticated_at,
        'counts', jsonb_build_object(
          'profile_identity', v_profile_count,
          'user_statistics', v_stats_count,
          'user_bookmarks', v_bookmarks_count,
          'notifications', v_notifications_count,
          'user_preferences', v_preferences_count,
          'storyboard_documents', v_documents_count,
          'review_likes', v_review_likes_count,
          'reviews', v_reviews_count,
          'restaurant_submissions', v_submissions_count,
          'restaurant_requests', v_requests_count,
          'ocr_logs', v_ocr_logs_count,
          'marketing_campaign_recipients', v_marketing_recipients_count,
          'privacy_identity_records', v_privacy_identity_count,
          'privacy_audit_actor_references', v_privacy_audit_actor_reference_count,
          'storage_objects', v_storage_count,
          'auth_identity', 1
        ),
        'nonce', gen_random_uuid()
      )::text,
      'sha256'
    ),
    'hex'
  );

  INSERT INTO public.account_deletion_requests (
    actor_user_id,
    target_user_id,
    policy_version,
    preview_hash,
    preview_expires_at,
    reauthenticated_at,
    status,
    reason_code,
    count_summary
  ) VALUES (
    p_actor_user_id,
    p_target_user_id,
    v_policy.version,
    v_preview_hash,
    v_now + v_policy.preview_ttl,
    p_reauthenticated_at,
    'previewed',
    'PREVIEW_READY',
    jsonb_build_object('requested', v_total_delete + v_profile_count + v_privacy_audit_actor_reference_count)
  ) RETURNING * INTO v_request;

  INSERT INTO public.account_deletion_request_items (
    request_id, data_class_code, disposition, mandatory, planned_count, status, reason_code
  )
  SELECT
    v_request.id,
    data_class.code,
    data_class.disposition,
    data_class.mandatory,
    CASE data_class.code
      WHEN 'profile_identity' THEN v_profile_count
      WHEN 'user_statistics' THEN v_stats_count
      WHEN 'user_bookmarks' THEN v_bookmarks_count
      WHEN 'notifications' THEN v_notifications_count
      WHEN 'user_preferences' THEN v_preferences_count
      WHEN 'storyboard_documents' THEN v_documents_count
      WHEN 'review_likes' THEN v_review_likes_count
      WHEN 'reviews' THEN v_reviews_count
      WHEN 'restaurant_submissions' THEN v_submissions_count
      WHEN 'restaurant_requests' THEN v_requests_count
      WHEN 'ocr_logs' THEN v_ocr_logs_count
      WHEN 'marketing_campaign_recipients' THEN v_marketing_recipients_count
      WHEN 'privacy_identity_records' THEN v_privacy_identity_count
      WHEN 'privacy_audit_actor_references' THEN v_privacy_audit_actor_reference_count
      WHEN 'storage_objects' THEN v_storage_count
      WHEN 'auth_identity' THEN 1
      ELSE 0
    END,
    'planned',
    'PREVIEW_READY'
  FROM public.account_deletion_data_classes AS data_class
  WHERE data_class.policy_version = v_policy.version;

  PERFORM public.account_deletion_write_audit(v_request, 'previewed', 'PREVIEW_READY');

  RETURN QUERY SELECT
    v_request.id,
    v_request.preview_hash,
    v_request.preview_expires_at,
    v_request.policy_version,
    v_request.status,
    v_request.reason_code,
    v_total_delete,
    v_profile_count + v_privacy_audit_actor_reference_count,
    0,
    0;
END;
$$;

CREATE OR REPLACE FUNCTION public.begin_account_deletion_apply(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_confirmation_text text,
  p_idempotency_key text,
  p_reauthenticated_at timestamptz
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
  auth_readback_passed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_policy public.account_deletion_policies%ROWTYPE;
  v_last_sign_in_at timestamptz;
  v_delete_count integer := 0;
  v_anonymize_count integer := 0;
  v_separate_count integer := 0;
  v_retain_count integer := 0;
  v_target_is_active_admin boolean := false;
  v_other_active_admins integer := 0;
BEGIN
  PERFORM public.account_deletion_require_service_role();

  IF p_request_id IS NULL OR p_actor_user_id IS NULL OR p_target_user_id IS NULL
    OR p_preview_hash !~ '^[0-9a-f]{64}$'
    OR p_idempotency_key !~ '^[A-Za-z][0-9A-Za-z._:-]{7,127}$'
  THEN
    RETURN QUERY SELECT p_request_id, 'failed'::text, 'INVALID_APPLY_REQUEST'::text, 0, 0, 0, 0, false, false, false, false;
    RETURN;
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_request_id::text, 0));
  SELECT * INTO v_request
  FROM public.account_deletion_requests AS request
  WHERE request.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.actor_user_id <> p_actor_user_id OR v_request.target_user_id <> p_target_user_id THEN
    RETURN QUERY SELECT p_request_id, 'failed'::text, 'PREVIEW_NOT_FOUND'::text, 0, 0, 0, 0, false, false, false, false;
    RETURN;
  END IF;

  SELECT
    COALESCE(SUM(request_item.planned_count) FILTER (WHERE request_item.disposition = 'delete'), 0),
    COALESCE(SUM(request_item.planned_count) FILTER (WHERE request_item.disposition = 'anonymize'), 0),
    COALESCE(SUM(request_item.planned_count) FILTER (WHERE request_item.disposition = 'separate'), 0),
    COALESCE(SUM(request_item.planned_count) FILTER (WHERE request_item.disposition = 'retain'), 0)
  INTO v_delete_count, v_anonymize_count, v_separate_count, v_retain_count
  FROM public.account_deletion_request_items AS request_item
  WHERE request_item.request_id = v_request.id;

  IF v_request.status = 'applied' THEN
    IF v_request.idempotency_key = p_idempotency_key THEN
      RETURN QUERY SELECT v_request.id, v_request.status, v_request.reason_code, v_delete_count, v_anonymize_count, v_separate_count, v_retain_count, v_request.db_readback_passed, v_request.storage_readback_passed, v_request.session_readback_passed, v_request.auth_readback_passed;
    ELSE
      RETURN QUERY SELECT v_request.id, 'failed'::text, 'REPLAYED_PREVIEW'::text, v_delete_count, v_anonymize_count, v_separate_count, v_retain_count, false, false, false, false;
    END IF;
    RETURN;
  END IF;

  IF v_request.idempotency_key IS NOT NULL AND v_request.idempotency_key <> p_idempotency_key THEN
    RETURN QUERY SELECT v_request.id, 'failed'::text, 'IDEMPOTENCY_KEY_MISMATCH'::text, v_delete_count, v_anonymize_count, v_separate_count, v_retain_count, false, false, false, false;
    RETURN;
  END IF;

  IF p_actor_user_id <> p_target_user_id AND NOT public.account_deletion_is_active_admin(p_actor_user_id) THEN
    RETURN QUERY SELECT v_request.id, 'failed'::text, 'ACTOR_NOT_ALLOWED'::text, v_delete_count, v_anonymize_count, v_separate_count, v_retain_count, false, false, false, false;
    RETURN;
  END IF;

  v_target_is_active_admin := public.account_deletion_is_active_admin(p_target_user_id);
  IF v_target_is_active_admin THEN
    SELECT count(*) INTO v_other_active_admins
    FROM public.user_roles AS role_row
    LEFT JOIN public.user_account_status AS status_row ON status_row.user_id = role_row.user_id
    WHERE role_row.role = 'admin'
      AND role_row.user_id <> p_target_user_id
      AND COALESCE(status_row.account_status, 'active') = 'active';

    IF v_other_active_admins = 0 THEN
      RETURN QUERY SELECT v_request.id, 'failed'::text, 'LAST_ADMIN_PROTECTED'::text, v_delete_count, v_anonymize_count, v_separate_count, v_retain_count, false, false, false, false;
      RETURN;
    END IF;
  END IF;

  SELECT policy.* INTO v_policy
  FROM public.account_deletion_policies AS policy
  WHERE policy.version = v_request.policy_version
    AND policy.status = 'active'
  FOR SHARE;

  IF NOT FOUND THEN
    RETURN QUERY SELECT v_request.id, 'failed'::text, 'POLICY_CHANGED'::text, v_delete_count, v_anonymize_count, v_separate_count, v_retain_count, false, false, false, false;
    RETURN;
  END IF;

  SELECT last_sign_in_at INTO v_last_sign_in_at FROM auth.users AS u
  WHERE u.id = p_actor_user_id;
  IF v_last_sign_in_at IS NULL
    OR p_reauthenticated_at IS NULL
    OR v_last_sign_in_at < pg_catalog.clock_timestamp() - v_policy.reauth_max_age
    OR abs(extract(epoch FROM (p_reauthenticated_at - v_last_sign_in_at))) > 1
  THEN
    RETURN QUERY SELECT v_request.id, 'failed'::text, 'REAUTH_REQUIRED'::text, v_delete_count, v_anonymize_count, v_separate_count, v_retain_count, false, false, false, false;
    RETURN;
  END IF;

  IF v_request.preview_hash <> p_preview_hash OR v_request.preview_expires_at <= pg_catalog.clock_timestamp() THEN
    RETURN QUERY SELECT v_request.id, 'failed'::text, 'PREVIEW_EXPIRED'::text, v_delete_count, v_anonymize_count, v_separate_count, v_retain_count, false, false, false, false;
    RETURN;
  END IF;

  IF p_confirmation_text IS DISTINCT FROM v_policy.confirmation_text THEN
    RETURN QUERY SELECT v_request.id, 'failed'::text, 'CONFIRMATION_REQUIRED'::text, v_delete_count, v_anonymize_count, v_separate_count, v_retain_count, false, false, false, false;
    RETURN;
  END IF;

  UPDATE public.account_deletion_requests AS request
  SET status = 'applying', idempotency_key = p_idempotency_key, reason_code = 'APPLY_STARTED'
  WHERE request.id = v_request.id
  RETURNING * INTO v_request;

  RETURN QUERY SELECT v_request.id, v_request.status, v_request.reason_code, v_delete_count, v_anonymize_count, v_separate_count, v_retain_count, v_request.db_readback_passed, v_request.storage_readback_passed, v_request.session_readback_passed, v_request.auth_readback_passed;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_account_deletion_database_cleanup(
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS TABLE (
  request_id uuid,
  status text,
  reason_code text,
  db_readback_passed boolean,
  session_readback_passed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, auth
AS $$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_item public.account_deletion_request_items%ROWTYPE;
  v_db_failed boolean := false;
  v_session_failed boolean := false;
  v_remaining integer := 0;
  v_sessions_remaining integer := 0;
  v_privacy_identity_remaining integer := 0;
  v_privacy_audit_actor_references_remaining integer := 0;
  v_privacy_audit_actor_ids uuid[] := ARRAY[]::uuid[];
  v_privacy_audit_snapshot jsonb := '[]'::jsonb;
  v_privacy_audit_snapshot_after jsonb := '[]'::jsonb;
BEGIN
  PERFORM pg_catalog.set_config('app.account_deletion_user_id', '', true);
  PERFORM public.account_deletion_require_service_role();
  SELECT * INTO v_request
  FROM public.account_deletion_requests AS request
  WHERE request.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.actor_user_id <> p_actor_user_id THEN
    RETURN QUERY SELECT p_request_id, 'failed'::text, 'PREVIEW_NOT_FOUND'::text, false, false;
    RETURN;
  END IF;

  IF v_request.status = 'applied' THEN
    RETURN QUERY SELECT v_request.id, v_request.status, v_request.reason_code, v_request.db_readback_passed, v_request.session_readback_passed;
    RETURN;
  END IF;

  IF v_request.status NOT IN ('applying', 'partial') THEN
    RETURN QUERY SELECT v_request.id, 'failed'::text, 'APPLY_NOT_STARTED'::text, false, false;
    RETURN;
  END IF;

  BEGIN
    IF to_regclass('public.marketing_campaign_recipients') IS NOT NULL THEN
      EXECUTE 'DELETE FROM public.marketing_campaign_recipients WHERE user_id = $1' USING v_request.target_user_id;
      EXECUTE 'SELECT count(*) FROM public.marketing_campaign_recipients WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
      IF v_remaining <> 0 THEN
        RAISE EXCEPTION 'marketing_campaign_recipients_readback_failed';
      END IF;
    END IF;

    UPDATE public.account_deletion_request_items AS request_item
    SET status = 'applied',
        reason_code = 'DB_READBACK_PASSED'
    WHERE request_item.request_id = v_request.id
      AND request_item.data_class_code = 'marketing_campaign_recipients';
  EXCEPTION WHEN OTHERS THEN
    v_db_failed := true;
    UPDATE public.account_deletion_request_items AS request_item
    SET status = 'failed',
        reason_code = 'DB_CLEANUP_FAILED'
    WHERE request_item.request_id = v_request.id
      AND request_item.data_class_code = 'marketing_campaign_recipients';
  END;

  PERFORM pg_catalog.set_config(
    'app.account_deletion_user_id',
    v_request.target_user_id::text,
    true
  );

  BEGIN
    SELECT
      COALESCE(array_agg(audit.id ORDER BY audit.id), ARRAY[]::uuid[]),
      COALESCE(
        jsonb_agg(
          pg_catalog.to_jsonb(audit) - 'actor_user_id'
          ORDER BY audit.id
        ),
        '[]'::jsonb
      )
    INTO v_privacy_audit_actor_ids, v_privacy_audit_snapshot
    FROM public.privacy_audit_events AS audit
    WHERE audit.actor_user_id = v_request.target_user_id;

    DELETE FROM public.privacy_consent_events
    WHERE user_id = v_request.target_user_id;
    DELETE FROM public.privacy_age_profiles
    WHERE user_id = v_request.target_user_id;
    DELETE FROM public.privacy_guardian_verifications
    WHERE child_user_id = v_request.target_user_id;
    DELETE FROM public.privacy_onboarding_challenges
    WHERE consumed_by_user_id = v_request.target_user_id;
    UPDATE public.privacy_audit_events
    SET actor_user_id = NULL
    WHERE actor_user_id = v_request.target_user_id;

    SELECT count(*) INTO v_privacy_identity_remaining
    FROM (
      SELECT consent.id
      FROM public.privacy_consent_events AS consent
      WHERE consent.user_id = v_request.target_user_id
      UNION ALL
      SELECT age_profile.user_id
      FROM public.privacy_age_profiles AS age_profile
      WHERE age_profile.user_id = v_request.target_user_id
      UNION ALL
      SELECT guardian.id
      FROM public.privacy_guardian_verifications AS guardian
      WHERE guardian.child_user_id = v_request.target_user_id
      UNION ALL
      SELECT challenge.id
      FROM public.privacy_onboarding_challenges AS challenge
      WHERE challenge.consumed_by_user_id = v_request.target_user_id
    ) AS remaining_privacy_identity;

    SELECT count(*) INTO v_privacy_audit_actor_references_remaining
    FROM public.privacy_audit_events AS audit
    WHERE audit.actor_user_id = v_request.target_user_id;

    SELECT COALESCE(
      jsonb_agg(
        pg_catalog.to_jsonb(audit) - 'actor_user_id'
        ORDER BY audit.id
      ),
      '[]'::jsonb
    )
    INTO v_privacy_audit_snapshot_after
    FROM public.privacy_audit_events AS audit
    WHERE audit.id = ANY(v_privacy_audit_actor_ids);

    IF v_privacy_identity_remaining <> 0
       OR v_privacy_audit_actor_references_remaining <> 0
       OR v_privacy_audit_snapshot_after IS DISTINCT FROM v_privacy_audit_snapshot THEN
      RAISE EXCEPTION 'privacy_identity_readback_failed';
    END IF;

    UPDATE public.account_deletion_request_items AS request_item
    SET status = 'applied',
        reason_code = 'DB_READBACK_PASSED'
    WHERE request_item.request_id = v_request.id
      AND request_item.data_class_code IN (
        'privacy_identity_records',
        'privacy_audit_actor_references'
      );
  EXCEPTION WHEN OTHERS THEN
    v_db_failed := true;
    UPDATE public.account_deletion_request_items AS request_item
    SET status = 'failed',
        reason_code = 'DB_CLEANUP_FAILED'
    WHERE request_item.request_id = v_request.id
      AND request_item.data_class_code IN (
        'privacy_identity_records',
        'privacy_audit_actor_references'
      );
  END;

  PERFORM pg_catalog.set_config('app.account_deletion_user_id', '', true);

  FOR v_item IN
    SELECT *
    FROM public.account_deletion_request_items AS request_item
    WHERE request_item.request_id = v_request.id
      AND request_item.data_class_code NOT IN (
        'storage_objects',
        'auth_identity',
        'approved_audit_records',
        'retention_work_items',
        'marketing_campaign_recipients',
        'privacy_identity_records',
        'privacy_audit_actor_references'
      )
      ORDER BY CASE request_item.data_class_code
        WHEN 'review_likes' THEN 10
        WHEN 'reviews' THEN 20
        WHEN 'restaurant_submissions' THEN 30
        WHEN 'restaurant_requests' THEN 40
        WHEN 'ocr_logs' THEN 50
        ELSE 100
      END, request_item.data_class_code
    FOR UPDATE
  LOOP
    BEGIN
      IF v_item.data_class_code = 'profile_identity' THEN
        IF to_regclass('public.profiles') IS NOT NULL THEN
          EXECUTE 'UPDATE public.profiles SET nickname = ''탈퇴한 사용자'', username = NULL, avatar_url = NULL WHERE user_id = $1' USING v_request.target_user_id;
          EXECUTE 'SELECT count(*) FROM public.profiles WHERE user_id = $1 AND (nickname IS DISTINCT FROM ''탈퇴한 사용자'' OR username IS NOT NULL OR avatar_url IS NOT NULL)' INTO v_remaining USING v_request.target_user_id;
          IF v_remaining <> 0 THEN
            RAISE EXCEPTION 'profile_anonymization_readback_failed';
          END IF;
        END IF;
      ELSIF v_item.data_class_code = 'user_statistics' AND to_regclass('public.user_stats') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.user_stats WHERE user_id = $1' USING v_request.target_user_id;
        EXECUTE 'SELECT count(*) FROM public.user_stats WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
        IF v_remaining <> 0 THEN RAISE EXCEPTION 'user_statistics_readback_failed'; END IF;
      ELSIF v_item.data_class_code = 'user_bookmarks' AND to_regclass('public.user_bookmarks') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.user_bookmarks WHERE user_id = $1' USING v_request.target_user_id;
        EXECUTE 'SELECT count(*) FROM public.user_bookmarks WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
        IF v_remaining <> 0 THEN RAISE EXCEPTION 'user_bookmarks_readback_failed'; END IF;
      ELSIF v_item.data_class_code = 'notifications' AND to_regclass('public.notifications') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.notifications WHERE user_id = $1' USING v_request.target_user_id;
        EXECUTE 'SELECT count(*) FROM public.notifications WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
        IF v_remaining <> 0 THEN RAISE EXCEPTION 'notifications_readback_failed'; END IF;
      ELSIF v_item.data_class_code = 'user_preferences' AND to_regclass('public.admin_user_preferences') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.admin_user_preferences WHERE user_id = $1' USING v_request.target_user_id;
        EXECUTE 'SELECT count(*) FROM public.admin_user_preferences WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
        IF v_remaining <> 0 THEN RAISE EXCEPTION 'user_preferences_readback_failed'; END IF;
      ELSIF v_item.data_class_code = 'storyboard_documents' AND to_regclass('public.documents') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.documents WHERE user_id = $1' USING v_request.target_user_id;
        EXECUTE 'SELECT count(*) FROM public.documents WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
        IF v_remaining <> 0 THEN RAISE EXCEPTION 'storyboard_documents_readback_failed'; END IF;
      ELSIF v_item.data_class_code = 'review_likes' AND to_regclass('public.review_likes') IS NOT NULL THEN
        IF to_regclass('public.reviews') IS NOT NULL THEN
          EXECUTE 'DELETE FROM public.review_likes AS review_like WHERE review_like.user_id = $1 OR review_like.review_id IN (SELECT review_row.id FROM public.reviews AS review_row WHERE review_row.user_id = $1)' USING v_request.target_user_id;
          EXECUTE 'SELECT count(*) FROM public.review_likes AS review_like WHERE review_like.user_id = $1 OR review_like.review_id IN (SELECT review_row.id FROM public.reviews AS review_row WHERE review_row.user_id = $1)' INTO v_remaining USING v_request.target_user_id;
        ELSE
          EXECUTE 'DELETE FROM public.review_likes WHERE user_id = $1' USING v_request.target_user_id;
          EXECUTE 'SELECT count(*) FROM public.review_likes WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
        END IF;
        IF v_remaining <> 0 THEN RAISE EXCEPTION 'review_likes_readback_failed'; END IF;
      ELSIF v_item.data_class_code = 'reviews' AND to_regclass('public.reviews') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.reviews WHERE user_id = $1' USING v_request.target_user_id;
        EXECUTE 'SELECT count(*) FROM public.reviews WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
        IF v_remaining <> 0 THEN RAISE EXCEPTION 'reviews_readback_failed'; END IF;
      ELSIF v_item.data_class_code = 'restaurant_submissions' AND to_regclass('public.restaurant_submissions') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.restaurant_submissions WHERE user_id = $1' USING v_request.target_user_id;
        EXECUTE 'SELECT count(*) FROM public.restaurant_submissions WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
        IF v_remaining <> 0 THEN RAISE EXCEPTION 'restaurant_submissions_readback_failed'; END IF;
      ELSIF v_item.data_class_code = 'restaurant_requests' AND to_regclass('public.restaurant_requests') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.restaurant_requests WHERE user_id = $1' USING v_request.target_user_id;
        EXECUTE 'SELECT count(*) FROM public.restaurant_requests WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
        IF v_remaining <> 0 THEN RAISE EXCEPTION 'restaurant_requests_readback_failed'; END IF;
      ELSIF v_item.data_class_code = 'ocr_logs' AND to_regclass('public.ocr_logs') IS NOT NULL THEN
        EXECUTE 'DELETE FROM public.ocr_logs WHERE user_id = $1' USING v_request.target_user_id;
        EXECUTE 'SELECT count(*) FROM public.ocr_logs WHERE user_id = $1' INTO v_remaining USING v_request.target_user_id;
        IF v_remaining <> 0 THEN RAISE EXCEPTION 'ocr_logs_readback_failed'; END IF;
      END IF;

      UPDATE public.account_deletion_request_items AS request_item
      SET status = CASE WHEN request_item.disposition = 'retain' THEN 'retained' WHEN request_item.disposition = 'separate' THEN 'separated' ELSE 'applied' END,
          reason_code = 'DB_READBACK_PASSED'
      WHERE request_item.request_id = v_request.id AND request_item.data_class_code = v_item.data_class_code;
    EXCEPTION WHEN OTHERS THEN
      v_db_failed := true;
      UPDATE public.account_deletion_request_items AS request_item
      SET status = 'failed', reason_code = 'DB_CLEANUP_FAILED'
      WHERE request_item.request_id = v_request.id AND request_item.data_class_code = v_item.data_class_code;
    END;
  END LOOP;

  BEGIN
    DELETE FROM auth.sessions AS user_session
    WHERE user_session.user_id = v_request.target_user_id;
    SELECT count(*) INTO v_sessions_remaining
    FROM auth.sessions AS session
    WHERE session.user_id = v_request.target_user_id;
    IF v_sessions_remaining <> 0 THEN
      RAISE EXCEPTION 'session_readback_failed';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_session_failed := true;
    v_sessions_remaining := 1;
  END;

  UPDATE public.account_deletion_requests AS request
  SET
    status = CASE WHEN v_db_failed OR v_session_failed THEN 'partial' ELSE 'applying' END,
    reason_code = CASE WHEN v_db_failed OR v_session_failed THEN 'DB_OR_SESSION_CLEANUP_FAILED' ELSE 'DB_AND_SESSION_READBACK_PASSED' END,
    db_readback_passed = NOT v_db_failed,
    session_readback_passed = NOT v_session_failed
  WHERE request.id = v_request.id
  RETURNING * INTO v_request;

  PERFORM public.account_deletion_write_audit(
    v_request,
    CASE WHEN v_db_failed OR v_session_failed THEN 'partial' ELSE 'readback_passed' END,
    v_request.reason_code
  );

  RETURN QUERY SELECT v_request.id, v_request.status, v_request.reason_code, v_request.db_readback_passed, v_request.session_readback_passed;
EXCEPTION
  WHEN OTHERS THEN
    PERFORM pg_catalog.set_config('app.account_deletion_user_id', '', true);
    RAISE;
END;
$$;

CREATE OR REPLACE FUNCTION public.list_account_deletion_storage_objects(
  p_actor_user_id uuid,
  p_request_id uuid
)
RETURNS TABLE (bucket_id text, object_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, storage
AS $$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
BEGIN
  PERFORM public.account_deletion_require_service_role();
  SELECT * INTO v_request
  FROM public.account_deletion_requests AS request
  WHERE request.id = p_request_id;
  IF NOT FOUND OR v_request.actor_user_id <> p_actor_user_id OR v_request.status <> 'applying' OR NOT v_request.db_readback_passed OR NOT v_request.session_readback_passed THEN
    RAISE EXCEPTION 'account_deletion_storage_not_ready' USING ERRCODE = '55000';
  END IF;

  RETURN QUERY EXECUTE
    'SELECT bucket_id::text, name::text FROM storage.objects WHERE owner_id = $1::text ORDER BY bucket_id, name'
  USING v_request.target_user_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_account_deletion_storage(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_storage_readback_passed boolean
)
RETURNS TABLE (
  request_id uuid,
  status text,
  reason_code text,
  db_readback_passed boolean,
  storage_readback_passed boolean,
  session_readback_passed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
BEGIN
  PERFORM public.account_deletion_require_service_role();
  SELECT * INTO v_request
  FROM public.account_deletion_requests AS request
  WHERE request.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.actor_user_id <> p_actor_user_id THEN
    RETURN QUERY SELECT p_request_id, 'failed'::text, 'PREVIEW_NOT_FOUND'::text, false, false, false;
    RETURN;
  END IF;

  UPDATE public.account_deletion_request_items AS request_item
  SET status = CASE WHEN p_storage_readback_passed THEN 'applied' ELSE 'failed' END,
      reason_code = CASE WHEN p_storage_readback_passed THEN 'STORAGE_READBACK_PASSED' ELSE 'STORAGE_CLEANUP_FAILED' END
  WHERE request_item.request_id = v_request.id AND request_item.data_class_code = 'storage_objects';

  UPDATE public.account_deletion_requests AS request
  SET status = CASE WHEN p_storage_readback_passed THEN 'applying' ELSE 'partial' END,
      reason_code = CASE WHEN p_storage_readback_passed THEN 'STORAGE_READBACK_PASSED' ELSE 'STORAGE_CLEANUP_FAILED' END,
      storage_readback_passed = p_storage_readback_passed
  WHERE request.id = v_request.id
  RETURNING * INTO v_request;

  PERFORM public.account_deletion_write_audit(
    v_request,
    CASE WHEN p_storage_readback_passed THEN 'readback_passed' ELSE 'partial' END,
    v_request.reason_code
  );

  RETURN QUERY SELECT v_request.id, v_request.status, v_request.reason_code, v_request.db_readback_passed, v_request.storage_readback_passed, v_request.session_readback_passed;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_account_deletion_auth(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_auth_readback_passed boolean
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
  auth_readback_passed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_delete_count integer := 0;
  v_anonymize_count integer := 0;
  v_separate_count integer := 0;
  v_retain_count integer := 0;
BEGIN
  PERFORM public.account_deletion_require_service_role();

  SELECT * INTO v_request
  FROM public.account_deletion_requests AS request
  WHERE request.id = p_request_id
  FOR UPDATE;

  IF NOT FOUND OR v_request.actor_user_id <> p_actor_user_id THEN
    RETURN QUERY SELECT p_request_id, 'failed'::text, 'PREVIEW_NOT_FOUND'::text, 0, 0, 0, 0, false, false, false, false;
    RETURN;
  END IF;

  UPDATE public.account_deletion_request_items AS request_item
  SET status = CASE WHEN p_auth_readback_passed THEN 'applied' ELSE 'failed' END,
      reason_code = CASE WHEN p_auth_readback_passed THEN 'AUTH_READBACK_PASSED' ELSE 'AUTH_CLEANUP_FAILED' END
  WHERE request_item.request_id = v_request.id AND request_item.data_class_code = 'auth_identity';

  UPDATE public.account_deletion_requests AS request
  SET
    status = CASE
      WHEN p_auth_readback_passed AND request.db_readback_passed AND request.storage_readback_passed AND request.session_readback_passed THEN 'applied'
      ELSE 'partial'
    END,
    reason_code = CASE
      WHEN p_auth_readback_passed AND request.db_readback_passed AND request.storage_readback_passed AND request.session_readback_passed THEN 'APPLIED'
      ELSE 'AUTH_CLEANUP_FAILED'
    END,
    auth_readback_passed = p_auth_readback_passed,
    applied_at = CASE
      WHEN p_auth_readback_passed AND request.db_readback_passed AND request.storage_readback_passed AND request.session_readback_passed THEN pg_catalog.clock_timestamp()
      ELSE NULL
    END
  WHERE request.id = v_request.id
  RETURNING * INTO v_request;

  SELECT
    COALESCE(SUM(request_item.planned_count) FILTER (WHERE request_item.disposition = 'delete'), 0),
    COALESCE(SUM(request_item.planned_count) FILTER (WHERE request_item.disposition = 'anonymize'), 0),
    COALESCE(SUM(request_item.planned_count) FILTER (WHERE request_item.disposition = 'separate'), 0),
    COALESCE(SUM(request_item.planned_count) FILTER (WHERE request_item.disposition = 'retain'), 0)
  INTO v_delete_count, v_anonymize_count, v_separate_count, v_retain_count
  FROM public.account_deletion_request_items AS request_item
  WHERE request_item.request_id = v_request.id;

  PERFORM public.account_deletion_write_audit(
    v_request,
    CASE WHEN v_request.status = 'applied' THEN 'applied' ELSE 'partial' END,
    v_request.reason_code
  );

  RETURN QUERY SELECT
    v_request.id,
    v_request.status,
    v_request.reason_code,
    v_delete_count,
    v_anonymize_count,
    v_separate_count,
    v_retain_count,
    v_request.db_readback_passed,
    v_request.storage_readback_passed,
    v_request.session_readback_passed,
    v_request.auth_readback_passed;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_account_deletion(
  p_actor_user_id uuid,
  p_request_id uuid,
  p_reason_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
BEGIN
  PERFORM public.account_deletion_require_service_role();
  IF p_reason_code NOT IN ('DB_OR_SESSION_CLEANUP_FAILED', 'STORAGE_CLEANUP_FAILED', 'AUTH_CLEANUP_FAILED') THEN
    RAISE EXCEPTION 'invalid_account_deletion_failure_code' USING ERRCODE = '22023';
  END IF;

  UPDATE public.account_deletion_requests AS request
  SET status = 'partial', reason_code = p_reason_code
  WHERE request.id = p_request_id AND request.actor_user_id = p_actor_user_id
  RETURNING * INTO v_request;

  IF FOUND THEN
    PERFORM public.account_deletion_write_audit(v_request, 'partial', p_reason_code);
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS account_deletion_requests_updated_at ON public.account_deletion_requests;
CREATE TRIGGER account_deletion_requests_updated_at
BEFORE UPDATE ON public.account_deletion_requests
FOR EACH ROW EXECUTE FUNCTION public.account_deletion_set_updated_at();

DROP TRIGGER IF EXISTS account_deletion_request_items_updated_at ON public.account_deletion_request_items;
CREATE TRIGGER account_deletion_request_items_updated_at
BEFORE UPDATE ON public.account_deletion_request_items
FOR EACH ROW EXECUTE FUNCTION public.account_deletion_set_updated_at();

REVOKE ALL ON FUNCTION public.account_deletion_set_updated_at() FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.account_deletion_require_service_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_deletion_subject_hash(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_deletion_is_active_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_deletion_write_audit(public.account_deletion_requests, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preview_account_deletion(uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.begin_account_deletion_apply(uuid, uuid, uuid, text, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_account_deletion_database_cleanup(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.list_account_deletion_storage_objects(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_account_deletion_storage(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finalize_account_deletion_auth(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fail_account_deletion(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_account_deletion(uuid, uuid, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.begin_account_deletion_apply(uuid, uuid, uuid, text, text, text, timestamptz) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_account_deletion_database_cleanup(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.list_account_deletion_storage_objects(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_account_deletion_storage(uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalize_account_deletion_auth(uuid, uuid, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.fail_account_deletion(uuid, uuid, text) TO service_role;

CREATE FUNCTION public.admin_user_audit_reason_code(
  p_action text,
  p_status text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT CASE p_action || ':' || p_status
    WHEN 'admin_user_created:intent' THEN 'ADMIN_USER_CREATE_INTENT'
    WHEN 'admin_user_created:applied' THEN 'ADMIN_USER_CREATE_APPLIED'
    WHEN 'admin_user_created:failed' THEN 'ADMIN_USER_CREATE_FAILED'
    WHEN 'admin_user_profile_updated:intent' THEN 'ADMIN_USER_PROFILE_UPDATE_INTENT'
    WHEN 'admin_user_profile_updated:applied' THEN 'ADMIN_USER_PROFILE_UPDATE_APPLIED'
    WHEN 'admin_user_profile_updated:failed' THEN 'ADMIN_USER_PROFILE_UPDATE_FAILED'
    WHEN 'admin_user_role_granted:intent' THEN 'ADMIN_USER_ROLE_GRANT_INTENT'
    WHEN 'admin_user_role_granted:applied' THEN 'ADMIN_USER_ROLE_GRANT_APPLIED'
    WHEN 'admin_user_role_granted:failed' THEN 'ADMIN_USER_ROLE_GRANT_FAILED'
    WHEN 'admin_user_role_revoked:intent' THEN 'ADMIN_USER_ROLE_REVOKE_INTENT'
    WHEN 'admin_user_role_revoked:applied' THEN 'ADMIN_USER_ROLE_REVOKE_APPLIED'
    WHEN 'admin_user_role_revoked:failed' THEN 'ADMIN_USER_ROLE_REVOKE_FAILED'
    WHEN 'admin_user_disabled:intent' THEN 'ADMIN_USER_DISABLE_INTENT'
    WHEN 'admin_user_disabled:applied' THEN 'ADMIN_USER_DISABLE_APPLIED'
    WHEN 'admin_user_disabled:failed' THEN 'ADMIN_USER_DISABLE_FAILED'
    WHEN 'admin_user_reactivated:intent' THEN 'ADMIN_USER_REACTIVATE_INTENT'
    WHEN 'admin_user_reactivated:applied' THEN 'ADMIN_USER_REACTIVATE_APPLIED'
    WHEN 'admin_user_reactivated:failed' THEN 'ADMIN_USER_REACTIVATE_FAILED'
    ELSE NULL
  END;
$$;

CREATE FUNCTION public.admin_user_audit_counts_are_safe(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT pg_catalog.jsonb_typeof(p_value) = 'object'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(p_value) AS entry(key, value)
      WHERE entry.key NOT IN ('requested', 'created', 'updated', 'failed')
        OR pg_catalog.jsonb_typeof(entry.value) <> 'number'
        OR (entry.value #>> '{}') !~ '^(0|[1-9][0-9]{0,9})$'
    );
$$;

CREATE FUNCTION public.admin_user_audit_flags_are_safe(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT pg_catalog.jsonb_typeof(p_value) = 'object'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(p_value) AS entry(key, value)
      WHERE entry.key NOT IN ('profileChanged', 'roleAdmin', 'accountDisabled')
        OR pg_catalog.jsonb_typeof(entry.value) <> 'boolean'
    );
$$;

CREATE FUNCTION public.admin_user_audit_event_is_safe(
  p_action text,
  p_status text,
  p_reason text,
  p_error_code text,
  p_before_state jsonb,
  p_after_state jsonb,
  p_counts jsonb,
  p_flags jsonb,
  p_request_id text,
  p_ip_hash text,
  p_user_agent_hash text
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT public.admin_user_audit_reason_code(p_action, p_status) IS NOT NULL
    AND p_reason = public.admin_user_audit_reason_code(p_action, p_status)
    AND (
      (p_status = 'failed' AND p_error_code = p_reason)
      OR (p_status <> 'failed' AND p_error_code IS NULL)
    )
    AND p_before_state = '{}'::jsonb
    AND p_after_state = '{}'::jsonb
    AND public.admin_user_audit_counts_are_safe(p_counts)
    AND public.admin_user_audit_flags_are_safe(p_flags)
    AND (p_request_id IS NULL OR p_request_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
    AND (p_ip_hash IS NULL OR p_ip_hash ~ '^[0-9a-f]{64}$')
    AND (p_user_agent_hash IS NULL OR p_user_agent_hash ~ '^[0-9a-f]{64}$');
$$;

ALTER TABLE public.admin_audit_events
  ADD COLUMN IF NOT EXISTS audit_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS audit_flags jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.admin_audit_events
SET
  reason = public.admin_user_audit_reason_code(action, status),
  error_code = CASE
    WHEN status = 'failed' THEN public.admin_user_audit_reason_code(action, status)
    ELSE NULL
  END,
  before_state = '{}'::jsonb,
  after_state = '{}'::jsonb,
  audit_counts = '{}'::jsonb,
  audit_flags = '{}'::jsonb,
  request_id = gen_random_uuid()::text,
  ip_hash = NULL,
  user_agent_hash = NULL
WHERE public.admin_user_audit_reason_code(action, status) IS NOT NULL;

UPDATE public.admin_audit_events
SET
  ip_hash = CASE WHEN ip_hash ~ '^[0-9a-f]{64}$' THEN ip_hash ELSE NULL END,
  user_agent_hash = CASE WHEN user_agent_hash ~ '^[0-9a-f]{64}$' THEN user_agent_hash ELSE NULL END
WHERE (ip_hash IS NOT NULL AND ip_hash !~ '^[0-9a-f]{64}$')
   OR (user_agent_hash IS NOT NULL AND user_agent_hash !~ '^[0-9a-f]{64}$');

ALTER TABLE public.admin_audit_events
  DROP CONSTRAINT IF EXISTS admin_audit_events_whitelisted_contract,
  ADD CONSTRAINT admin_audit_events_whitelisted_contract
  CHECK (
    public.admin_user_audit_event_is_safe(
      action,
      status,
      reason,
      error_code,
      before_state,
      after_state,
      audit_counts,
      audit_flags,
      request_id,
      ip_hash,
      user_agent_hash
    )
  ) NOT VALID;

CREATE OR REPLACE FUNCTION public.apply_admin_user_db_mutation(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_reason text,
  p_before_state jsonb,
  p_after_state jsonb,
  p_correlation_id uuid,
  p_profile jsonb DEFAULT NULL,
  p_next_role text DEFAULT NULL,
  p_next_account_status text DEFAULT NULL,
  p_request_id text DEFAULT NULL,
  p_ip_hash text DEFAULT NULL,
  p_user_agent_hash text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  applied_audit_id uuid;
  v_flags jsonb := '{}'::jsonb;
BEGIN
  IF p_action NOT IN (
    'admin_user_profile_updated',
    'admin_user_role_granted',
    'admin_user_role_revoked',
    'admin_user_disabled',
    'admin_user_reactivated'
  ) THEN
    RAISE EXCEPTION 'admin_user_audit_action_invalid' USING ERRCODE = '22023';
  END IF;

  IF p_before_state IS DISTINCT FROM '{}'::jsonb
    OR p_after_state IS DISTINCT FROM '{}'::jsonb
    OR NOT public.admin_user_audit_event_is_safe(
      p_action,
      'applied',
      p_reason,
      NULL,
      '{}'::jsonb,
      '{}'::jsonb,
      pg_catalog.jsonb_build_object('updated', 1),
      '{}'::jsonb,
      p_request_id,
      p_ip_hash,
      p_user_agent_hash
    )
  THEN
    RAISE EXCEPTION 'admin_user_audit_contract_invalid' USING ERRCODE = '22023';
  END IF;

  IF p_profile IS NOT NULL THEN
    INSERT INTO public.profiles (
      user_id,
      username,
      nickname,
      avatar_url,
      role,
      updated_at
    )
    VALUES (
      p_target_user_id,
      NULLIF(BTRIM(p_profile->>'username'), ''),
      NULLIF(BTRIM(p_profile->>'nickname'), ''),
      NULLIF(BTRIM(p_profile->>'avatar_url'), ''),
      COALESCE(
        (SELECT profile.role FROM public.profiles AS profile WHERE profile.user_id = p_target_user_id),
        CASE
          WHEN EXISTS (
          SELECT 1 FROM public.user_roles AS role_row WHERE role_row.user_id = p_target_user_id AND role_row.role = 'admin'
          )
          THEN 'admin'
          ELSE 'user'
        END
      ),
      now()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET username = EXCLUDED.username,
        nickname = EXCLUDED.nickname,
        avatar_url = EXCLUDED.avatar_url,
        updated_at = now();
  END IF;

  IF p_next_role IS NOT NULL THEN
    IF p_next_role NOT IN ('admin', 'user') THEN
      RAISE EXCEPTION 'admin_user_role_invalid' USING ERRCODE = '22023';
    END IF;

    IF p_next_role = 'admin' THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (p_target_user_id, 'admin')
      ON CONFLICT (user_id, role) DO NOTHING;
    ELSE
      DELETE FROM public.user_roles AS role_row
      WHERE role_row.user_id = p_target_user_id
        AND role_row.role = 'admin';
    END IF;

    INSERT INTO public.profiles (
      user_id,
      username,
      nickname,
      avatar_url,
      role,
      updated_at
    )
    VALUES (
      p_target_user_id,
      COALESCE((SELECT profile.username FROM public.profiles AS profile WHERE profile.user_id = p_target_user_id), 'unknown'),
      COALESCE((SELECT profile.nickname FROM public.profiles AS profile WHERE profile.user_id = p_target_user_id), '닉네임 없음'),
      (SELECT profile.avatar_url FROM public.profiles AS profile WHERE profile.user_id = p_target_user_id),
      p_next_role,
      now()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET role = EXCLUDED.role,
        updated_at = now();
  END IF;

  IF p_next_account_status IS NOT NULL THEN
    IF p_next_account_status NOT IN ('active', 'disabled') THEN
      RAISE EXCEPTION 'admin_user_account_status_invalid' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.user_account_status (
      user_id,
      account_status,
      disabled_at,
      updated_at
    )
    VALUES (
      p_target_user_id,
      p_next_account_status,
      CASE WHEN p_next_account_status = 'disabled' THEN now() ELSE NULL END,
      now()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET account_status = EXCLUDED.account_status,
        disabled_at = EXCLUDED.disabled_at,
        updated_at = now();
  END IF;

  v_flags := CASE p_action
    WHEN 'admin_user_profile_updated' THEN pg_catalog.jsonb_build_object('profileChanged', true)
    WHEN 'admin_user_role_granted' THEN pg_catalog.jsonb_build_object('roleAdmin', true)
    WHEN 'admin_user_role_revoked' THEN pg_catalog.jsonb_build_object('roleAdmin', false)
    WHEN 'admin_user_disabled' THEN pg_catalog.jsonb_build_object('accountDisabled', true)
    WHEN 'admin_user_reactivated' THEN pg_catalog.jsonb_build_object('accountDisabled', false)
    ELSE '{}'::jsonb
  END;

  INSERT INTO public.admin_audit_events (
    actor_user_id,
    target_user_id,
    action,
    reason,
    before_state,
    after_state,
    audit_counts,
    audit_flags,
    status,
    correlation_id,
    applied_at,
    request_id,
    ip_hash,
    user_agent_hash
  )
  VALUES (
    p_actor_user_id,
    p_target_user_id,
    p_action,
    p_reason,
    '{}'::jsonb,
    '{}'::jsonb,
    pg_catalog.jsonb_build_object('updated', 1),
    v_flags,
    'applied',
    p_correlation_id,
    now(),
    p_request_id,
    p_ip_hash,
    p_user_agent_hash
  )
  RETURNING id INTO applied_audit_id;

  RETURN applied_audit_id;
END;
$$;

CREATE FUNCTION public.account_deletion_reason_code_is_safe(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT p_value IN (
    'ACTOR_NOT_ALLOWED',
    'ACTOR_OR_TARGET_REQUIRED',
    'APPLIED',
    'APPLY_NOT_STARTED',
    'APPLY_STARTED',
    'AUTH_CLEANUP_FAILED',
    'AUTH_READBACK_PASSED',
    'CONFIRMATION_REQUIRED',
    'DB_AND_SESSION_READBACK_PASSED',
    'DB_CLEANUP_FAILED',
    'DB_OR_SESSION_CLEANUP_FAILED',
    'DB_READBACK_PASSED',
    'IDEMPOTENCY_KEY_MISMATCH',
    'INVALID_APPLY_REQUEST',
    'LAST_ADMIN_PROTECTED',
    'LEGAL_HOLD_ACTIVE',
    'POLICY_CHANGED',
    'POLICY_UNAVAILABLE',
    'PREVIEW_EXPIRED',
    'PREVIEW_NOT_FOUND',
    'PREVIEW_READY',
    'REAUTH_REQUIRED',
    'REPLAYED_PREVIEW',
    'RETENTION_POLICY_UNAVAILABLE',
    'STORAGE_CLEANUP_FAILED',
    'STORAGE_READBACK_PASSED',
    'TARGET_NOT_FOUND'
  );
$$;

ALTER TABLE public.account_deletion_requests
  DROP CONSTRAINT IF EXISTS account_deletion_requests_reason_code_allowed,
  ADD CONSTRAINT account_deletion_requests_reason_code_allowed
    CHECK (public.account_deletion_reason_code_is_safe(reason_code)) NOT VALID,
  DROP CONSTRAINT IF EXISTS account_deletion_requests_count_summary_safe,
  ADD CONSTRAINT account_deletion_requests_count_summary_safe
    CHECK (public.privacy_audit_count_summary_is_safe(count_summary)) NOT VALID;

ALTER TABLE public.account_deletion_request_items
  DROP CONSTRAINT IF EXISTS account_deletion_request_items_reason_code_allowed,
  ADD CONSTRAINT account_deletion_request_items_reason_code_allowed
    CHECK (public.account_deletion_reason_code_is_safe(reason_code)) NOT VALID;

REVOKE ALL ON FUNCTION public.admin_user_audit_reason_code(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_user_audit_counts_are_safe(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_user_audit_flags_are_safe(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_user_audit_event_is_safe(text, text, text, text, jsonb, jsonb, jsonb, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.account_deletion_reason_code_is_safe(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_admin_user_db_mutation(uuid, uuid, text, text, jsonb, jsonb, uuid, jsonb, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_user_audit_reason_code(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_user_audit_counts_are_safe(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_user_audit_flags_are_safe(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_user_audit_event_is_safe(text, text, text, text, jsonb, jsonb, jsonb, jsonb, text, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.account_deletion_reason_code_is_safe(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_admin_user_db_mutation(uuid, uuid, text, text, jsonb, jsonb, uuid, jsonb, text, text, text, text, text) TO service_role;

NOTIFY pgrst, 'reload schema';
