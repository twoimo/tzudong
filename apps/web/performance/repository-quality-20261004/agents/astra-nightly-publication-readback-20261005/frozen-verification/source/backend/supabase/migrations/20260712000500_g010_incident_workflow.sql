-- G010 privacy incident workflow.
-- This migration is deliberately operational, not a legal applicability or filing decision.
-- External notices are recorded only after a named operator enters a bounded receipt reference.

DO $$
BEGIN
  IF to_regclass('public.privacy_audit_events') IS NULL THEN
    RAISE EXCEPTION 'g010_privacy_audit_foundation_required';
  END IF;

  IF to_regclass('privacy_retention.privacy_legal_holds') IS NULL THEN
    RAISE EXCEPTION 'g010_retention_separation_required';
  END IF;

  IF to_regprocedure('extensions.digest(text,text)') IS NULL THEN
    RAISE EXCEPTION 'g010_sha256_digest_required';
  END IF;
END;
$$;

CREATE TYPE public.privacy_incident_status AS ENUM (
  'detected',
  'triaged',
  'contained',
  'assessed',
  'notice_drafted',
  'notice_approved',
  'notified',
  'closed'
);

CREATE TYPE public.privacy_incident_data_category AS ENUM (
  'account',
  'contact',
  'authentication',
  'device',
  'usage',
  'location',
  'financial',
  'sensitive',
  'unique_identifier',
  'other'
);

CREATE TYPE public.privacy_incident_notice_audience AS ENUM (
  'data_subjects',
  'pipc',
  'kisa'
);

CREATE TYPE public.privacy_incident_notice_status AS ENUM (
  'draft',
  'approved',
  'submitted',
  'failed'
);

CREATE TYPE public.privacy_incident_readback_status AS ENUM (
  'passed',
  'failed'
);

CREATE TABLE public.privacy_incidents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status public.privacy_incident_status NOT NULL DEFAULT 'detected',
  severity text NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  detected_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  awareness_at timestamptz,
  deadline_at timestamptz,
  affected_count_estimate integer CHECK (affected_count_estimate IS NULL OR (affected_count_estimate >= 0 AND affected_count_estimate <= 1000000000)),
  data_categories public.privacy_incident_data_category[] NOT NULL DEFAULT '{}',
  sensitive_or_unique_id boolean,
  external_intrusion boolean,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id),
  decision_code text CHECK (decision_code IS NULL OR decision_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  assessment_readback_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT privacy_incidents_awareness_deadline_check CHECK (
    (awareness_at IS NULL AND deadline_at IS NULL)
    OR (awareness_at IS NOT NULL AND deadline_at = awareness_at + interval '72 hours')
  ),
  CONSTRAINT privacy_incidents_categories_check CHECK (
    cardinality(data_categories) <= 10
    AND array_position(data_categories, NULL) IS NULL
  ),
  CONSTRAINT privacy_incidents_assessment_check CHECK (
    status NOT IN ('notice_drafted', 'notice_approved', 'notified', 'closed')
    OR (
      awareness_at IS NOT NULL
      AND deadline_at IS NOT NULL
      AND affected_count_estimate IS NOT NULL
      AND cardinality(data_categories) > 0
      AND sensitive_or_unique_id IS NOT NULL
      AND external_intrusion IS NOT NULL
      AND decision_code IS NOT NULL
      AND assessment_readback_at IS NOT NULL
    )
  )
);

CREATE TABLE public.privacy_incident_transition_previews (
  operation_id uuid PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES public.privacy_incidents(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  from_status public.privacy_incident_status NOT NULL,
  to_status public.privacy_incident_status NOT NULL,
  expected_updated_at timestamptz NOT NULL,
  preview_hash text NOT NULL CHECK (preview_hash ~ '^[0-9a-f]{64}$'),
  input_hash text NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  correlation_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT privacy_incident_transition_previews_expiry_check CHECK (expires_at > created_at)
);

CREATE TABLE public.privacy_incident_notices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.privacy_incidents(id) ON DELETE RESTRICT,
  audience public.privacy_incident_notice_audience NOT NULL,
  status public.privacy_incident_notice_status NOT NULL DEFAULT 'draft',
  template_version text NOT NULL CHECK (template_version ~ '^[a-zA-Z0-9._-]{1,64}$'),
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  approved_by uuid REFERENCES auth.users(id),
  approved_at timestamptz,
  submitted_by uuid REFERENCES auth.users(id),
  submitted_at timestamptz,
  external_receipt_ref text CHECK (external_receipt_ref IS NULL OR external_receipt_ref ~ '^[A-Za-z][A-Za-z0-9._:/-]{5,159}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT privacy_incident_notices_state_check CHECK (
    (status = 'draft' AND approved_by IS NULL AND approved_at IS NULL AND submitted_by IS NULL AND submitted_at IS NULL AND external_receipt_ref IS NULL)
    OR (status = 'approved' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND submitted_by IS NULL AND submitted_at IS NULL AND external_receipt_ref IS NULL)
    OR (status = 'submitted' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL AND external_receipt_ref IS NOT NULL)
    OR (status = 'failed' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND submitted_by IS NULL AND submitted_at IS NULL AND external_receipt_ref IS NULL)
  )
);

CREATE TABLE public.privacy_incident_actions (
  id uuid PRIMARY KEY,
  incident_id uuid NOT NULL REFERENCES public.privacy_incidents(id) ON DELETE RESTRICT,
  from_status public.privacy_incident_status NOT NULL,
  to_status public.privacy_incident_status NOT NULL,
  actor_user_id uuid NOT NULL REFERENCES auth.users(id),
  reason_code text NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_]{2,63}$'),
  preview_hash text NOT NULL CHECK (preview_hash ~ '^[0-9a-f]{64}$'),
  input_hash text NOT NULL CHECK (input_hash ~ '^[0-9a-f]{64}$'),
  correlation_id uuid NOT NULL,
  expected_updated_at timestamptz NOT NULL,
  idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
  result_status text NOT NULL CHECK (result_status = 'applied'),
  readback_status public.privacy_incident_readback_status NOT NULL,
  audit_id uuid NOT NULL REFERENCES public.privacy_audit_events(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT privacy_incident_actions_idempotency_unique UNIQUE (actor_user_id, idempotency_key)
);

CREATE INDEX privacy_incidents_status_deadline_idx
  ON public.privacy_incidents (status, deadline_at)
  WHERE status <> 'closed';
CREATE INDEX privacy_incident_notices_incident_idx
  ON public.privacy_incident_notices (incident_id, status, created_at DESC);
CREATE INDEX privacy_incident_actions_incident_idx
  ON public.privacy_incident_actions (incident_id, created_at DESC);
CREATE INDEX privacy_incident_previews_expiry_idx
  ON public.privacy_incident_transition_previews (expires_at)
  WHERE consumed_at IS NULL;

CREATE OR REPLACE FUNCTION public.privacy_incident_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER privacy_incidents_set_updated_at
BEFORE UPDATE ON public.privacy_incidents
FOR EACH ROW EXECUTE FUNCTION public.privacy_incident_set_updated_at();

CREATE TRIGGER privacy_incident_notices_set_updated_at
BEFORE UPDATE ON public.privacy_incident_notices
FOR EACH ROW EXECUTE FUNCTION public.privacy_incident_set_updated_at();

CREATE OR REPLACE FUNCTION public.privacy_incident_actions_are_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION 'privacy_incident_actions_immutable';
END;
$$;

CREATE TRIGGER privacy_incident_actions_immutable
BEFORE UPDATE OR DELETE ON public.privacy_incident_actions
FOR EACH ROW EXECUTE FUNCTION public.privacy_incident_actions_are_immutable();

CREATE OR REPLACE FUNCTION public.privacy_incident_enforce_state_invariants()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'notified' AND NOT EXISTS (
    SELECT 1
      FROM public.privacy_incident_notices
     WHERE incident_id = NEW.id
       AND status = 'submitted'
       AND approved_by IS NOT NULL
       AND approved_at IS NOT NULL
       AND submitted_by IS NOT NULL
       AND submitted_at IS NOT NULL
       AND external_receipt_ref IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'privacy_incident_external_receipt_required';
  END IF;

  IF NEW.status = 'closed' AND (
    NEW.assessment_readback_at IS NULL
    OR NEW.affected_count_estimate IS NULL
    OR cardinality(NEW.data_categories) = 0
    OR NEW.sensitive_or_unique_id IS NULL
    OR NEW.external_intrusion IS NULL
    OR NEW.decision_code IS NULL
    OR NOT EXISTS (
      SELECT 1
        FROM public.privacy_incident_actions
       WHERE incident_id = NEW.id
         AND to_status = 'notified'
         AND readback_status = 'passed'
    )
  ) THEN
    RAISE EXCEPTION 'privacy_incident_closure_readback_required';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER privacy_incidents_enforce_state_invariants
BEFORE INSERT OR UPDATE ON public.privacy_incidents
FOR EACH ROW EXECUTE FUNCTION public.privacy_incident_enforce_state_invariants();
CREATE OR REPLACE FUNCTION public.privacy_incident_transition_is_allowed(
  p_from public.privacy_incident_status,
  p_to public.privacy_incident_status
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
  SELECT (p_from, p_to) IN (
    ('detected'::public.privacy_incident_status, 'triaged'::public.privacy_incident_status),
    ('triaged'::public.privacy_incident_status, 'contained'::public.privacy_incident_status),
    ('contained'::public.privacy_incident_status, 'assessed'::public.privacy_incident_status),
    ('assessed'::public.privacy_incident_status, 'notice_drafted'::public.privacy_incident_status),
    ('notice_drafted'::public.privacy_incident_status, 'notice_approved'::public.privacy_incident_status),
    ('notice_approved'::public.privacy_incident_status, 'notified'::public.privacy_incident_status),
    ('notified'::public.privacy_incident_status, 'closed'::public.privacy_incident_status)
  );
$$;

CREATE OR REPLACE FUNCTION public.privacy_incident_require_admin(p_actor_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'privacy_incident_service_role_required';
  END IF;

  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.user_roles
     WHERE user_id = p_actor_user_id
       AND role::text = 'admin'
  ) THEN
    RAISE EXCEPTION 'privacy_incident_privacy_admin_required';
  END IF;
END;
$$;
CREATE OR REPLACE FUNCTION public.privacy_incident_audit_retention_until(p_now timestamptz)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_retention_until timestamptz;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'privacy_incident_service_role_required';
  END IF;

  BEGIN
    v_retention_until := public.privacy_resolve_audit_retention_until(
      'privacy_incident_audit',
      p_now
    );
  EXCEPTION
    WHEN SQLSTATE '55000' THEN
      RAISE EXCEPTION 'privacy_incident_audit_retention_class_required';
  END;

  RETURN v_retention_until;
END;
$$;
CREATE OR REPLACE FUNCTION public.privacy_incident_audit_count_summary(
  p_affected_count integer,
  p_category_count integer
)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT jsonb_build_object(
    'requested', p_affected_count,
    'updated', p_category_count
  );
$$;

CREATE OR REPLACE FUNCTION public.privacy_incident_input_hash(p_input jsonb)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = public, pg_temp
AS $$
  SELECT pg_catalog.encode(extensions.digest(coalesce(p_input, '{}'::jsonb)::text, 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.privacy_incident_validate_input(
  p_to_status public.privacy_incident_status,
  p_input jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_category text;
  v_text text;
  v_count numeric;
BEGIN
  IF p_input IS NULL OR jsonb_typeof(p_input) <> 'object' THEN
    RAISE EXCEPTION 'invalid_privacy_incident_transition_input';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_object_keys(p_input) AS key
     WHERE key NOT IN (
       'awarenessAt',
       'affectedCountEstimate',
       'dataCategories',
       'sensitiveOrUniqueId',
       'externalIntrusion',
       'decisionCode',
       'noticeAudience',
       'templateVersion',
       'contentSha256',
       'noticeId',
       'externalReceiptRef'
     )
  ) THEN
    RAISE EXCEPTION 'invalid_privacy_incident_transition_input';
  END IF;

  IF p_to_status = 'triaged' THEN
    v_text := p_input ->> 'awarenessAt';
    IF v_text IS NULL OR jsonb_object_length(p_input) <> 1 THEN
      RAISE EXCEPTION 'privacy_incident_awareness_confirmation_required';
    END IF;
    BEGIN
      IF v_text::timestamptz > pg_catalog.clock_timestamp() THEN
        RAISE EXCEPTION 'privacy_incident_awareness_confirmation_required';
      END IF;
    EXCEPTION
      WHEN invalid_datetime_format OR datetime_field_overflow THEN
        RAISE EXCEPTION 'privacy_incident_awareness_confirmation_required';
    END;
    RETURN;
  END IF;

  IF p_to_status = 'contained' OR p_to_status = 'closed' THEN
    IF jsonb_object_length(p_input) <> 0 THEN
      RAISE EXCEPTION 'invalid_privacy_incident_transition_input';
    END IF;
    RETURN;
  END IF;

  IF p_to_status = 'assessed' THEN
    IF NOT (p_input ? 'affectedCountEstimate' AND p_input ? 'dataCategories' AND p_input ? 'sensitiveOrUniqueId' AND p_input ? 'externalIntrusion' AND p_input ? 'decisionCode')
       OR jsonb_object_length(p_input) <> 5
       OR jsonb_typeof(p_input -> 'affectedCountEstimate') <> 'number'
       OR jsonb_typeof(p_input -> 'dataCategories') <> 'array'
       OR jsonb_typeof(p_input -> 'sensitiveOrUniqueId') <> 'boolean'
       OR jsonb_typeof(p_input -> 'externalIntrusion') <> 'boolean' THEN
      RAISE EXCEPTION 'privacy_incident_assessment_required';
    END IF;

    v_count := (p_input ->> 'affectedCountEstimate')::numeric;
    IF v_count < 0 OR v_count > 1000000000 OR trunc(v_count) <> v_count OR jsonb_array_length(p_input -> 'dataCategories') < 1 OR jsonb_array_length(p_input -> 'dataCategories') > 10 THEN
      RAISE EXCEPTION 'privacy_incident_assessment_required';
    END IF;

    v_text := p_input ->> 'decisionCode';
    IF v_text IS NULL OR v_text !~ '^[a-z][a-z0-9_]{2,63}$' THEN
      RAISE EXCEPTION 'privacy_incident_assessment_required';
    END IF;

    FOR v_category IN SELECT jsonb_array_elements_text(p_input -> 'dataCategories') LOOP
      IF v_category IS NULL OR v_category NOT IN ('account', 'contact', 'authentication', 'device', 'usage', 'location', 'financial', 'sensitive', 'unique_identifier', 'other') THEN
        RAISE EXCEPTION 'privacy_incident_assessment_required';
      END IF;
    END LOOP;
    RETURN;
  END IF;

  IF p_to_status = 'notice_drafted' THEN
    IF NOT (p_input ? 'noticeAudience' AND p_input ? 'templateVersion' AND p_input ? 'contentSha256')
       OR jsonb_object_length(p_input) <> 3
       OR p_input ->> 'noticeAudience' NOT IN ('data_subjects', 'pipc', 'kisa')
       OR p_input ->> 'templateVersion' !~ '^[a-zA-Z0-9._-]{1,64}$'
       OR p_input ->> 'contentSha256' !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'privacy_incident_notice_draft_required';
    END IF;
    RETURN;
  END IF;

  IF p_to_status = 'notice_approved' THEN
    IF jsonb_object_length(p_input) <> 1 OR p_input ->> 'noticeId' IS NULL THEN
      RAISE EXCEPTION 'privacy_incident_notice_approval_required';
    END IF;
    BEGIN
      PERFORM (p_input ->> 'noticeId')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'privacy_incident_notice_approval_required';
    END;
    RETURN;
  END IF;

  IF p_to_status = 'notified' THEN
    IF jsonb_object_length(p_input) <> 2
       OR p_input ->> 'noticeId' IS NULL
       OR p_input ->> 'externalReceiptRef' !~ '^[A-Za-z][A-Za-z0-9._:/-]{5,159}$' THEN
      RAISE EXCEPTION 'privacy_incident_external_receipt_required';
    END IF;
    BEGIN
      PERFORM (p_input ->> 'noticeId')::uuid;
    EXCEPTION
      WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'privacy_incident_external_receipt_required';
    END;
    RETURN;
  END IF;

  RAISE EXCEPTION 'invalid_privacy_incident_transition_input';
END;
$$;

CREATE OR REPLACE FUNCTION public.privacy_incident_decision_prompts(
  p_affected_count integer,
  p_sensitive_or_unique_id boolean,
  p_external_intrusion boolean
)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_prompts jsonb := jsonb_build_array(
    jsonb_build_object('code', 'human_count_confirmation', 'messageKo', '영향 인원 추정치는 담당자가 사실관계로 확인해야 합니다.')
  );
BEGIN
  IF coalesce(p_affected_count, 0) >= 1000 THEN
    v_prompts := v_prompts || jsonb_build_array(
      jsonb_build_object('code', 'count_1000_or_more_human_review', 'messageKo', '1,000명 이상 추정값입니다. 신고·통지 판단은 담당자와 검토자가 결정해야 합니다.')
    );
  END IF;

  IF p_sensitive_or_unique_id IS TRUE THEN
    v_prompts := v_prompts || jsonb_build_array(
      jsonb_build_object('code', 'sensitive_or_unique_id_human_review', 'messageKo', '민감정보 또는 고유식별정보 여부 입력입니다. 법적 판단은 사람이 확인해야 합니다.')
    );
  END IF;

  IF p_external_intrusion IS TRUE THEN
    v_prompts := v_prompts || jsonb_build_array(
      jsonb_build_object('code', 'external_intrusion_human_review', 'messageKo', '외부 침입 관련 입력입니다. 신고 대상 여부는 사람이 확인해야 합니다.')
    );
  END IF;

  RETURN v_prompts;
END;
$$;

CREATE OR REPLACE FUNCTION public.preview_privacy_incident_transition(
  p_actor_user_id uuid,
  p_incident_id uuid,
  p_to_status public.privacy_incident_status,
  p_expected_updated_at timestamptz,
  p_reason_code text,
  p_transition_input jsonb,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_incident public.privacy_incidents%rowtype;
  v_operation_id uuid := gen_random_uuid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_audit_retention_until timestamptz;
  v_expires_at timestamptz := v_now + interval '15 minutes';
  v_input_hash text;
  v_preview_hash text;
  v_prompt_count integer;
  v_prompt_sensitive boolean;
  v_prompt_intrusion boolean;
BEGIN
  PERFORM public.privacy_incident_require_admin(p_actor_user_id);

  IF p_incident_id IS NULL OR p_expected_updated_at IS NULL OR p_to_status IS NULL OR p_correlation_id IS NULL
     OR p_reason_code IS NULL OR p_reason_code !~ '^[a-z][a-z0-9_]{2,63}$' THEN
    RAISE EXCEPTION 'invalid_privacy_incident_preview_request';
  END IF;

  PERFORM public.privacy_incident_validate_input(p_to_status, coalesce(p_transition_input, '{}'::jsonb));

  SELECT *
    INTO v_incident
    FROM public.privacy_incidents
   WHERE id = p_incident_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'privacy_incident_not_found';
  END IF;

  IF v_incident.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'privacy_incident_version_stale';
  END IF;

  IF NOT public.privacy_incident_transition_is_allowed(v_incident.status, p_to_status) THEN
    RAISE EXCEPTION 'privacy_incident_transition_forbidden';
  END IF;
  v_audit_retention_until := public.privacy_incident_audit_retention_until(v_now);


  IF p_to_status = 'assessed' THEN
    v_prompt_count := (p_transition_input ->> 'affectedCountEstimate')::integer;
    v_prompt_sensitive := (p_transition_input ->> 'sensitiveOrUniqueId')::boolean;
    v_prompt_intrusion := (p_transition_input ->> 'externalIntrusion')::boolean;
  ELSE
    v_prompt_count := v_incident.affected_count_estimate;
    v_prompt_sensitive := v_incident.sensitive_or_unique_id;
    v_prompt_intrusion := v_incident.external_intrusion;
  END IF;

  v_input_hash := public.privacy_incident_input_hash(coalesce(p_transition_input, '{}'::jsonb));
  v_preview_hash := pg_catalog.encode(extensions.digest(jsonb_build_object(
    'workflowVersion', 'g010-incident-v1',
    'actorUserId', p_actor_user_id,
    'incidentId', p_incident_id,
    'fromStatus', v_incident.status,
    'toStatus', p_to_status,
    'expectedUpdatedAt', p_expected_updated_at,
    'reasonCode', p_reason_code,
    'inputHash', v_input_hash,
    'correlationId', p_correlation_id,
    'expiresAt', v_expires_at
  )::text, 'sha256'), 'hex');

  INSERT INTO public.privacy_incident_transition_previews (
    operation_id,
    incident_id,
    actor_user_id,
    from_status,
    to_status,
    expected_updated_at,
    preview_hash,
    input_hash,
    reason_code,
    correlation_id,
    expires_at
  ) VALUES (
    v_operation_id,
    p_incident_id,
    p_actor_user_id,
    v_incident.status,
    p_to_status,
    p_expected_updated_at,
    v_preview_hash,
    v_input_hash,
    p_reason_code,
    p_correlation_id,
    v_expires_at
  );

  INSERT INTO public.privacy_audit_events (
    event_type,
    actor_user_id,
    operation_id,
    correlation_id,
    preview_hash,
    status,
    reason_code,
    count_summary,
    request_metadata,
    occurred_at,
    retention_until
  ) VALUES (
    'privacy_incident_transition',
    p_actor_user_id,
    v_operation_id,
    p_correlation_id,
    v_preview_hash,
    'previewed',
    upper(p_reason_code),
    public.privacy_incident_audit_count_summary(
      coalesce(v_prompt_count, 0),
      CASE
        WHEN p_to_status = 'assessed' THEN jsonb_array_length(p_transition_input -> 'dataCategories')
        ELSE cardinality(v_incident.data_categories)
      END
    ),
    jsonb_build_object('route', '/api/admin/privacy-incidents'),
    v_now,
    v_audit_retention_until
  );

  RETURN jsonb_build_object(
    'ok', true,
    'operationId', v_operation_id,
    'previewHash', v_preview_hash,
    'expiresAt', v_expires_at,
    'requiredConfirmation', '개인정보 사고 조치 적용',
    'summary', jsonb_build_object(
      'incidentId', p_incident_id,
      'fromStatus', v_incident.status,
      'toStatus', p_to_status,
      'expectedUpdatedAt', p_expected_updated_at,
      'deadlineAt', CASE WHEN p_to_status = 'triaged' THEN ((p_transition_input ->> 'awarenessAt')::timestamptz + interval '72 hours') ELSE v_incident.deadline_at END,
      'decisionPrompts', public.privacy_incident_decision_prompts(v_prompt_count, v_prompt_sensitive, v_prompt_intrusion)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_privacy_incident_transition(
  p_actor_user_id uuid,
  p_operation_id uuid,
  p_incident_id uuid,
  p_to_status public.privacy_incident_status,
  p_expected_updated_at timestamptz,
  p_preview_hash text,
  p_confirmation_text text,
  p_reason_code text,
  p_transition_input jsonb,
  p_correlation_id uuid,
  p_idempotency_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_preview public.privacy_incident_transition_previews%rowtype;
  v_action public.privacy_incident_actions%rowtype;
  v_incident public.privacy_incidents%rowtype;
  v_readback_incident public.privacy_incidents%rowtype;
  v_notice public.privacy_incident_notices%rowtype;
  v_readback_notice public.privacy_incident_notices%rowtype;
  v_audit_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_audit_retention_until timestamptz;
  v_input_hash text;
  v_readback_passed boolean := false;
  v_readback_checks jsonb := '{}'::jsonb;
BEGIN
  PERFORM public.privacy_incident_require_admin(p_actor_user_id);

  IF p_operation_id IS NULL OR p_incident_id IS NULL OR p_to_status IS NULL OR p_expected_updated_at IS NULL
     OR p_correlation_id IS NULL OR p_preview_hash IS NULL OR p_preview_hash !~ '^[0-9a-f]{64}$'
     OR p_reason_code IS NULL OR p_reason_code !~ '^[a-z][a-z0-9_]{2,63}$'
     OR p_idempotency_key IS NULL OR char_length(trim(p_idempotency_key)) NOT BETWEEN 8 AND 128 THEN
    RAISE EXCEPTION 'invalid_privacy_incident_apply_request';
  END IF;

  IF p_confirmation_text <> '개인정보 사고 조치 적용' THEN
    RAISE EXCEPTION 'privacy_incident_confirmation_required';
  END IF;

  PERFORM public.privacy_incident_validate_input(p_to_status, coalesce(p_transition_input, '{}'::jsonb));
  v_input_hash := public.privacy_incident_input_hash(coalesce(p_transition_input, '{}'::jsonb));

  PERFORM pg_advisory_xact_lock(hashtextextended(p_actor_user_id::text || ':' || trim(p_idempotency_key), 0));

  SELECT *
    INTO v_action
    FROM public.privacy_incident_actions
   WHERE actor_user_id = p_actor_user_id
     AND idempotency_key = trim(p_idempotency_key);

  IF FOUND THEN
    IF v_action.id = p_operation_id
       AND v_action.incident_id = p_incident_id
       AND v_action.to_status = p_to_status
       AND v_action.preview_hash = p_preview_hash
       AND v_action.expected_updated_at = p_expected_updated_at
       AND v_action.reason_code = p_reason_code
       AND v_action.input_hash = v_input_hash
       AND v_action.correlation_id = p_correlation_id
       AND v_action.readback_status = 'passed' THEN
      RETURN jsonb_build_object(
        'ok', true,
        'operationId', p_operation_id,
        'status', 'applied',
        'replayed', true,
        'auditId', v_action.audit_id,
        'readback', jsonb_build_object(
          'passed', v_action.readback_status = 'passed',
          'checks', jsonb_build_object('statusMatched', v_action.readback_status = 'passed', 'actionImmutable', true, 'replayed', true)
        )
      );
    END IF;
    RAISE EXCEPTION 'privacy_incident_idempotency_conflict';
  END IF;

  SELECT *
    INTO v_preview
    FROM public.privacy_incident_transition_previews
   WHERE operation_id = p_operation_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'privacy_incident_preview_not_found';
  END IF;

  IF v_preview.consumed_at IS NOT NULL OR v_preview.expires_at <= v_now THEN
    RAISE EXCEPTION 'privacy_incident_preview_stale';
  END IF;

  IF v_preview.incident_id <> p_incident_id
     OR v_preview.actor_user_id <> p_actor_user_id
     OR v_preview.to_status <> p_to_status
     OR v_preview.expected_updated_at <> p_expected_updated_at
     OR v_preview.preview_hash <> p_preview_hash
     OR v_preview.input_hash <> v_input_hash
     OR v_preview.reason_code <> p_reason_code
     OR v_preview.correlation_id <> p_correlation_id THEN
    RAISE EXCEPTION 'privacy_incident_preview_stale';
  END IF;

  SELECT *
    INTO v_incident
    FROM public.privacy_incidents
   WHERE id = p_incident_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'privacy_incident_not_found';
  END IF;

  IF v_incident.updated_at <> p_expected_updated_at THEN
    RAISE EXCEPTION 'privacy_incident_version_stale';
  END IF;

  IF v_incident.status <> v_preview.from_status
     OR NOT public.privacy_incident_transition_is_allowed(v_incident.status, p_to_status) THEN
    RAISE EXCEPTION 'privacy_incident_transition_forbidden';
  END IF;
  v_audit_retention_until := public.privacy_incident_audit_retention_until(v_now);
  INSERT INTO public.privacy_audit_events (
    event_type,
    actor_user_id,
    operation_id,
    correlation_id,
    preview_hash,
    status,
    reason_code,
    count_summary,
    request_metadata,
    occurred_at,
    retention_until
  ) VALUES (
    'privacy_incident_transition',
    p_actor_user_id,
    p_operation_id,
    p_correlation_id,
    p_preview_hash,
    'confirmed',
    upper(p_reason_code),
    public.privacy_incident_audit_count_summary(
      coalesce(v_incident.affected_count_estimate, 0),
      cardinality(v_incident.data_categories)
    ),
    jsonb_build_object('route', '/api/admin/privacy-incidents'),
    v_now,
    v_audit_retention_until
  );


  IF p_to_status = 'triaged' THEN
    UPDATE public.privacy_incidents
       SET status = 'triaged',
           awareness_at = (p_transition_input ->> 'awarenessAt')::timestamptz,
           deadline_at = (p_transition_input ->> 'awarenessAt')::timestamptz + interval '72 hours'
     WHERE id = p_incident_id;
  ELSIF p_to_status = 'contained' THEN
    UPDATE public.privacy_incidents SET status = 'contained' WHERE id = p_incident_id;
  ELSIF p_to_status = 'assessed' THEN
    UPDATE public.privacy_incidents
       SET status = 'assessed',
           affected_count_estimate = (p_transition_input ->> 'affectedCountEstimate')::integer,
           data_categories = ARRAY(SELECT jsonb_array_elements_text(p_transition_input -> 'dataCategories')::public.privacy_incident_data_category),
           sensitive_or_unique_id = (p_transition_input ->> 'sensitiveOrUniqueId')::boolean,
           external_intrusion = (p_transition_input ->> 'externalIntrusion')::boolean,
           decision_code = p_transition_input ->> 'decisionCode'
     WHERE id = p_incident_id;
  ELSIF p_to_status = 'notice_drafted' THEN
    INSERT INTO public.privacy_incident_notices (
      incident_id,
      audience,
      status,
      template_version,
      content_sha256
    ) VALUES (
      p_incident_id,
      (p_transition_input ->> 'noticeAudience')::public.privacy_incident_notice_audience,
      'draft',
      p_transition_input ->> 'templateVersion',
      p_transition_input ->> 'contentSha256'
    ) RETURNING * INTO v_notice;

    UPDATE public.privacy_incidents SET status = 'notice_drafted' WHERE id = p_incident_id;
  ELSIF p_to_status = 'notice_approved' THEN
    SELECT *
      INTO v_notice
      FROM public.privacy_incident_notices
     WHERE id = (p_transition_input ->> 'noticeId')::uuid
       AND incident_id = p_incident_id
     FOR UPDATE;

    IF NOT FOUND OR v_notice.status <> 'draft' THEN
      RAISE EXCEPTION 'privacy_incident_notice_approval_required';
    END IF;

    UPDATE public.privacy_incident_notices
       SET status = 'approved',
           approved_by = p_actor_user_id,
           approved_at = v_now
     WHERE id = v_notice.id
     RETURNING * INTO v_notice;

    UPDATE public.privacy_incidents SET status = 'notice_approved' WHERE id = p_incident_id;
  ELSIF p_to_status = 'notified' THEN
    SELECT *
      INTO v_notice
      FROM public.privacy_incident_notices
     WHERE id = (p_transition_input ->> 'noticeId')::uuid
       AND incident_id = p_incident_id
     FOR UPDATE;

    IF NOT FOUND OR v_notice.status <> 'approved' OR v_notice.approved_by IS NULL OR v_notice.approved_at IS NULL THEN
      RAISE EXCEPTION 'privacy_incident_notice_approval_required';
    END IF;

    UPDATE public.privacy_incident_notices
       SET status = 'submitted',
           submitted_by = p_actor_user_id,
           submitted_at = v_now,
           external_receipt_ref = p_transition_input ->> 'externalReceiptRef'
     WHERE id = v_notice.id
     RETURNING * INTO v_notice;

    UPDATE public.privacy_incidents SET status = 'notified' WHERE id = p_incident_id;
  ELSIF p_to_status = 'closed' THEN
    IF v_incident.assessment_readback_at IS NULL
       OR v_incident.affected_count_estimate IS NULL
       OR cardinality(v_incident.data_categories) = 0
       OR v_incident.sensitive_or_unique_id IS NULL
       OR v_incident.external_intrusion IS NULL
       OR v_incident.decision_code IS NULL
       OR NOT EXISTS (
         SELECT 1
           FROM public.privacy_incident_actions
          WHERE incident_id = p_incident_id
            AND to_status = 'notified'
            AND readback_status = 'passed'
       ) THEN
      RAISE EXCEPTION 'privacy_incident_closure_readback_required';
    END IF;

    UPDATE public.privacy_incidents SET status = 'closed' WHERE id = p_incident_id;
  ELSE
    RAISE EXCEPTION 'privacy_incident_transition_forbidden';
  END IF;

  SELECT *
    INTO v_readback_incident
    FROM public.privacy_incidents
   WHERE id = p_incident_id;

  v_readback_passed := v_readback_incident.status = p_to_status;
  v_readback_checks := jsonb_build_object(
    'statusMatched', v_readback_incident.status = p_to_status,
    'expectedVersionWasMatched', true,
    'previewWasBound', true
  );

  IF p_to_status = 'triaged' THEN
    v_readback_passed := v_readback_passed
      AND v_readback_incident.awareness_at = (p_transition_input ->> 'awarenessAt')::timestamptz
      AND v_readback_incident.deadline_at = (p_transition_input ->> 'awarenessAt')::timestamptz + interval '72 hours';
    v_readback_checks := v_readback_checks || jsonb_build_object(
      'awarenessMatched', v_readback_incident.awareness_at = (p_transition_input ->> 'awarenessAt')::timestamptz,
      'deadlineDerivedFromAwareness', v_readback_incident.deadline_at = (p_transition_input ->> 'awarenessAt')::timestamptz + interval '72 hours'
    );
  ELSIF p_to_status = 'assessed' THEN
    v_readback_passed := v_readback_passed
      AND v_readback_incident.affected_count_estimate = (p_transition_input ->> 'affectedCountEstimate')::integer
      AND v_readback_incident.data_categories = ARRAY(SELECT jsonb_array_elements_text(p_transition_input -> 'dataCategories')::public.privacy_incident_data_category)
      AND v_readback_incident.sensitive_or_unique_id = (p_transition_input ->> 'sensitiveOrUniqueId')::boolean
      AND v_readback_incident.external_intrusion = (p_transition_input ->> 'externalIntrusion')::boolean
      AND v_readback_incident.decision_code = p_transition_input ->> 'decisionCode';
    IF v_readback_passed THEN
      UPDATE public.privacy_incidents
         SET assessment_readback_at = v_now
       WHERE id = p_incident_id
       RETURNING * INTO v_readback_incident;
    END IF;
    v_readback_passed := v_readback_passed AND v_readback_incident.assessment_readback_at IS NOT NULL;
    v_readback_checks := v_readback_checks || jsonb_build_object(
      'assessmentRecorded', v_readback_incident.assessment_readback_at IS NOT NULL,
      'affectedCountMatched', v_readback_incident.affected_count_estimate = (p_transition_input ->> 'affectedCountEstimate')::integer,
      'dataCategoriesMatched', v_readback_incident.data_categories = ARRAY(SELECT jsonb_array_elements_text(p_transition_input -> 'dataCategories')::public.privacy_incident_data_category),
      'sensitivityDecisionMatched', v_readback_incident.sensitive_or_unique_id = (p_transition_input ->> 'sensitiveOrUniqueId')::boolean,
      'intrusionDecisionMatched', v_readback_incident.external_intrusion = (p_transition_input ->> 'externalIntrusion')::boolean
    );
  ELSIF p_to_status IN ('notice_drafted', 'notice_approved', 'notified') THEN
    IF p_to_status = 'notice_drafted' THEN
      SELECT *
        INTO v_readback_notice
        FROM public.privacy_incident_notices
       WHERE incident_id = p_incident_id
         AND status = 'draft'
         AND audience = (p_transition_input ->> 'noticeAudience')::public.privacy_incident_notice_audience
         AND template_version = p_transition_input ->> 'templateVersion'
         AND content_sha256 = p_transition_input ->> 'contentSha256'
       ORDER BY created_at DESC
       LIMIT 1;
    ELSE
      SELECT *
        INTO v_readback_notice
        FROM public.privacy_incident_notices
       WHERE id = (p_transition_input ->> 'noticeId')::uuid
         AND incident_id = p_incident_id;
    END IF;

    v_readback_passed := v_readback_passed AND FOUND;
    IF p_to_status = 'notice_approved' THEN
      v_readback_passed := v_readback_passed AND v_readback_notice.status = 'approved' AND v_readback_notice.approved_by = p_actor_user_id AND v_readback_notice.approved_at IS NOT NULL;
    ELSIF p_to_status = 'notified' THEN
      v_readback_passed := v_readback_passed AND v_readback_notice.status = 'submitted' AND v_readback_notice.approved_by IS NOT NULL AND v_readback_notice.submitted_by = p_actor_user_id AND v_readback_notice.submitted_at IS NOT NULL AND v_readback_notice.external_receipt_ref = p_transition_input ->> 'externalReceiptRef';
    END IF;
    v_readback_checks := v_readback_checks || jsonb_build_object(
      'noticeMatched', FOUND,
      'namedApproverPresent', CASE WHEN FOUND THEN v_readback_notice.approved_by IS NOT NULL ELSE false END,
      'namedSubmitterPresent', CASE WHEN FOUND THEN v_readback_notice.submitted_by IS NOT NULL ELSE false END,
      'externalReceiptPresent', CASE WHEN FOUND THEN v_readback_notice.external_receipt_ref IS NOT NULL ELSE false END
    );
  ELSIF p_to_status = 'closed' THEN
    v_readback_passed := v_readback_passed
      AND v_readback_incident.assessment_readback_at IS NOT NULL
      AND EXISTS (
        SELECT 1
          FROM public.privacy_incident_actions
         WHERE incident_id = p_incident_id
           AND to_status = 'notified'
           AND readback_status = 'passed'
      );
    v_readback_checks := v_readback_checks || jsonb_build_object(
      'assessmentReadbackPresent', v_readback_incident.assessment_readback_at IS NOT NULL,
      'notificationReadbackPresent', EXISTS (
        SELECT 1
          FROM public.privacy_incident_actions
         WHERE incident_id = p_incident_id
           AND to_status = 'notified'
           AND readback_status = 'passed'
      )
    );
  END IF;

  IF NOT v_readback_passed THEN
    RAISE EXCEPTION 'privacy_incident_readback_failed';
  END IF;

  INSERT INTO public.privacy_audit_events (
    event_type,
    actor_user_id,
    operation_id,
    correlation_id,
    preview_hash,
    status,
    reason_code,
    count_summary,
    request_metadata,
    occurred_at,
    retention_until
  ) VALUES (
    'privacy_incident_transition',
    p_actor_user_id,
    p_operation_id,
    p_correlation_id,
    p_preview_hash,
    'applied',
    upper(p_reason_code),
    public.privacy_incident_audit_count_summary(
      coalesce(v_readback_incident.affected_count_estimate, 0),
      cardinality(v_readback_incident.data_categories)
    ),
    jsonb_build_object('route', '/api/admin/privacy-incidents'),
    v_now,
    v_audit_retention_until
  );

  INSERT INTO public.privacy_audit_events (
    event_type,
    actor_user_id,
    operation_id,
    correlation_id,
    preview_hash,
    status,
    reason_code,
    count_summary,
    request_metadata,
    occurred_at,
    retention_until
  ) VALUES (
    'privacy_incident_transition',
    p_actor_user_id,
    p_operation_id,
    p_correlation_id,
    p_preview_hash,
    'readback_passed',
    upper(p_reason_code),
    public.privacy_incident_audit_count_summary(
      coalesce(v_readback_incident.affected_count_estimate, 0),
      cardinality(v_readback_incident.data_categories)
    ),
    jsonb_build_object('route', '/api/admin/privacy-incidents'),
    v_now,
    v_audit_retention_until
  ) RETURNING id INTO v_audit_id;

  INSERT INTO public.privacy_incident_actions (
    id,
    incident_id,
    from_status,
    to_status,
    actor_user_id,
    reason_code,
    preview_hash,
    input_hash,
    correlation_id,
    expected_updated_at,
    idempotency_key,
    result_status,
    readback_status,
    audit_id
  ) VALUES (
    p_operation_id,
    p_incident_id,
    v_preview.from_status,
    p_to_status,
    p_actor_user_id,
    p_reason_code,
    p_preview_hash,
    v_input_hash,
    p_correlation_id,
    p_expected_updated_at,
    trim(p_idempotency_key),
    'applied',
    'passed',
    v_audit_id
  );

  UPDATE public.privacy_incident_transition_previews
     SET consumed_at = v_now
   WHERE operation_id = p_operation_id;

  RETURN jsonb_build_object(
    'ok', true,
    'operationId', p_operation_id,
    'status', 'applied',
    'replayed', false,
    'auditId', v_audit_id,
    'readback', jsonb_build_object('passed', true, 'checks', v_readback_checks)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.record_privacy_incident_detection(
  p_actor_user_id uuid,
  p_incident_id uuid,
  p_severity text,
  p_detected_at timestamptz,
  p_confirmation_text text,
  p_correlation_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_incident public.privacy_incidents%rowtype;
  v_readback_incident public.privacy_incidents%rowtype;
  v_audit_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_audit_retention_until timestamptz;
  v_readback_passed boolean := false;
  v_replayed boolean := false;
BEGIN
  PERFORM public.privacy_incident_require_admin(p_actor_user_id);

  IF p_incident_id IS NULL
     OR p_correlation_id IS NULL
     OR p_severity IS NULL
     OR p_severity NOT IN ('low', 'medium', 'high', 'critical')
     OR p_detected_at IS NULL
     OR p_detected_at > v_now
     OR p_detected_at < v_now - interval '10 years' THEN
    RAISE EXCEPTION 'invalid_privacy_incident_detection_request';
  END IF;

  IF p_confirmation_text IS DISTINCT FROM '개인정보 사고 탐지 등록' THEN
    RAISE EXCEPTION 'privacy_incident_detection_confirmation_required';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(p_incident_id::text, 0));

  SELECT *
    INTO v_incident
    FROM public.privacy_incidents
   WHERE id = p_incident_id
   FOR UPDATE;

  IF FOUND THEN
    IF v_incident.status <> 'detected'
       OR v_incident.owner_user_id <> p_actor_user_id
       OR v_incident.severity <> p_severity
       OR v_incident.detected_at <> p_detected_at
       OR v_incident.awareness_at IS NOT NULL
       OR v_incident.deadline_at IS NOT NULL
       OR v_incident.affected_count_estimate IS NOT NULL
       OR cardinality(v_incident.data_categories) <> 0
       OR v_incident.sensitive_or_unique_id IS NOT NULL
       OR v_incident.external_intrusion IS NOT NULL
       OR v_incident.decision_code IS NOT NULL
       OR v_incident.assessment_readback_at IS NOT NULL THEN
      RAISE EXCEPTION 'privacy_incident_detection_idempotency_conflict';
    END IF;

    SELECT id
      INTO v_audit_id
      FROM public.privacy_audit_events
     WHERE event_type = 'privacy_incident_detection'
       AND actor_user_id = p_actor_user_id
       AND operation_id = p_incident_id
       AND correlation_id = p_correlation_id
       AND status = 'readback_passed'
       AND reason_code = 'INCIDENT_DETECTION_RECORDED'
       AND count_summary = jsonb_build_object('created', 1)
       AND request_metadata = jsonb_build_object('route', '/api/admin/privacy-incidents')
     ORDER BY created_at DESC
     LIMIT 1;

    IF v_audit_id IS NULL THEN
      RAISE EXCEPTION 'privacy_incident_detection_idempotency_conflict';
    END IF;

    v_replayed := true;
  ELSE
    v_audit_retention_until := public.privacy_incident_audit_retention_until(v_now);

    INSERT INTO public.privacy_audit_events (
      event_type,
      actor_user_id,
      operation_id,
      correlation_id,
      status,
      reason_code,
      count_summary,
      request_metadata,
      occurred_at,
      retention_until
    ) VALUES (
      'privacy_incident_detection',
      p_actor_user_id,
      p_incident_id,
      p_correlation_id,
      'confirmed',
      'INCIDENT_DETECTION_RECORDED',
      jsonb_build_object('created', 1),
      jsonb_build_object('route', '/api/admin/privacy-incidents'),
      v_now,
      v_audit_retention_until
    );

    INSERT INTO public.privacy_incidents (
      id,
      status,
      severity,
      detected_at,
      owner_user_id
    ) VALUES (
      p_incident_id,
      'detected',
      p_severity,
      p_detected_at,
      p_actor_user_id
    );

    INSERT INTO public.privacy_audit_events (
      event_type,
      actor_user_id,
      operation_id,
      correlation_id,
      status,
      reason_code,
      count_summary,
      request_metadata,
      occurred_at,
      retention_until
    ) VALUES (
      'privacy_incident_detection',
      p_actor_user_id,
      p_incident_id,
      p_correlation_id,
      'applied',
      'INCIDENT_DETECTION_RECORDED',
      jsonb_build_object('created', 1),
      jsonb_build_object('route', '/api/admin/privacy-incidents'),
      v_now,
      v_audit_retention_until
    );
  END IF;

  SELECT *
    INTO v_readback_incident
    FROM public.privacy_incidents
   WHERE id = p_incident_id;

  v_readback_passed := FOUND
    AND v_readback_incident.id = p_incident_id
    AND v_readback_incident.status = 'detected'
    AND v_readback_incident.owner_user_id = p_actor_user_id
    AND v_readback_incident.severity = p_severity
    AND v_readback_incident.detected_at = p_detected_at
    AND v_readback_incident.awareness_at IS NULL
    AND v_readback_incident.deadline_at IS NULL
    AND v_readback_incident.affected_count_estimate IS NULL
    AND cardinality(v_readback_incident.data_categories) = 0
    AND v_readback_incident.sensitive_or_unique_id IS NULL
    AND v_readback_incident.external_intrusion IS NULL
    AND v_readback_incident.decision_code IS NULL
    AND v_readback_incident.assessment_readback_at IS NULL
    AND v_readback_incident.created_at IS NOT NULL
    AND v_readback_incident.updated_at IS NOT NULL;

  IF NOT v_readback_passed THEN
    RAISE EXCEPTION 'privacy_incident_detection_readback_failed';
  END IF;

  IF NOT v_replayed THEN
    INSERT INTO public.privacy_audit_events (
      event_type,
      actor_user_id,
      operation_id,
      correlation_id,
      status,
      reason_code,
      count_summary,
      request_metadata,
      occurred_at,
      retention_until
    ) VALUES (
      'privacy_incident_detection',
      p_actor_user_id,
      p_incident_id,
      p_correlation_id,
      'readback_passed',
      'INCIDENT_DETECTION_RECORDED',
      jsonb_build_object('created', 1),
      jsonb_build_object('route', '/api/admin/privacy-incidents'),
      v_now,
      v_audit_retention_until
    );
  END IF;

  SELECT id
    INTO v_audit_id
    FROM public.privacy_audit_events
   WHERE event_type = 'privacy_incident_detection'
     AND actor_user_id = p_actor_user_id
     AND operation_id = p_incident_id
     AND correlation_id = p_correlation_id
     AND status = 'readback_passed'
     AND reason_code = 'INCIDENT_DETECTION_RECORDED'
     AND count_summary = jsonb_build_object('created', 1)
     AND request_metadata = jsonb_build_object('route', '/api/admin/privacy-incidents')
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_audit_id IS NULL THEN
    RAISE EXCEPTION 'privacy_incident_detection_readback_failed';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'operationId', p_incident_id,
    'incidentId', p_incident_id,
    'status', 'detected',
    'replayed', v_replayed,
    'auditId', v_audit_id,
    'readback', jsonb_build_object(
      'passed', true,
      'checks', jsonb_build_object(
        'incidentIdMatched', true,
        'ownerMatched', true,
        'statusDetected', true,
        'severityMatched', true,
        'detectedAtMatched', true,
        'awarenessUnset', true,
        'deadlineUnset', true,
        'minimalFieldsUnset', true,
        'auditRecorded', true
      )
    )
  );
END;
$$;
ALTER TABLE public.privacy_incidents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_incidents FORCE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_incident_transition_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_incident_transition_previews FORCE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_incident_notices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_incident_notices FORCE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_incident_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_incident_actions FORCE ROW LEVEL SECURITY;

-- No browser/Data API role receives incident, notice, preview, or action access.
REVOKE ALL ON TABLE public.privacy_incidents FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.privacy_incident_transition_previews FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.privacy_incident_notices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.privacy_incident_actions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.privacy_incidents TO service_role;
GRANT SELECT ON TABLE public.privacy_incident_notices TO service_role;
GRANT SELECT ON TABLE public.privacy_incident_actions TO service_role;

REVOKE ALL ON FUNCTION public.privacy_incident_set_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.privacy_incident_actions_are_immutable() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.privacy_incident_enforce_state_invariants() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.privacy_incident_transition_is_allowed(public.privacy_incident_status, public.privacy_incident_status) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.privacy_incident_require_admin(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.privacy_incident_audit_retention_until(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.privacy_incident_audit_count_summary(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.privacy_incident_input_hash(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.privacy_incident_validate_input(public.privacy_incident_status, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.privacy_incident_decision_prompts(integer, boolean, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preview_privacy_incident_transition(uuid, uuid, public.privacy_incident_status, timestamptz, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.apply_privacy_incident_transition(uuid, uuid, uuid, public.privacy_incident_status, timestamptz, text, text, text, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_privacy_incident_detection(uuid, uuid, text, timestamptz, text, uuid) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.preview_privacy_incident_transition(uuid, uuid, public.privacy_incident_status, timestamptz, text, jsonb, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_privacy_incident_transition(uuid, uuid, uuid, public.privacy_incident_status, timestamptz, text, text, text, jsonb, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_privacy_incident_detection(uuid, uuid, text, timestamptz, text, uuid) TO service_role;

-- Retention/legal-hold rows remain owned by the retention workflow. Incident code has no write path to them; audit writes require the human-approved privacy_incident_audit class.
