-- G010 incident workflow database assertions.
-- Run after 20260712000100_g010_privacy_foundation.sql through
-- 20260712000500_g010_incident_workflow.sql in a disposable Supabase test database.
BEGIN;

DO $$
DECLARE
  v_transition_source text;
  v_apply_source text;
  v_detection_source text;
  v_prompt_999 jsonb;
  v_prompt_1000 jsonb;
  v_prompt_sensitive jsonb;
  v_prompt_intrusion jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname = 'privacy_incidents'
       AND relation.relrowsecurity
       AND relation.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'privacy_incidents must enable and force RLS';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class relation
      JOIN pg_catalog.pg_namespace namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname IN ('privacy_incident_notices', 'privacy_incident_actions', 'privacy_incident_transition_previews')
       AND (NOT relation.relrowsecurity OR NOT relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'incident notice/action/preview tables must enable and force RLS';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('anon'::name, 'privacy_incidents'::text, 'SELECT'::text),
        ('anon'::name, 'privacy_incidents'::text, 'INSERT'::text),
        ('anon'::name, 'privacy_incidents'::text, 'UPDATE'::text),
        ('anon'::name, 'privacy_incidents'::text, 'DELETE'::text),
        ('authenticated'::name, 'privacy_incidents'::text, 'SELECT'::text),
        ('authenticated'::name, 'privacy_incidents'::text, 'INSERT'::text),
        ('authenticated'::name, 'privacy_incidents'::text, 'UPDATE'::text),
        ('authenticated'::name, 'privacy_incidents'::text, 'DELETE'::text),
        ('anon'::name, 'privacy_incident_notices'::text, 'SELECT'::text),
        ('authenticated'::name, 'privacy_incident_notices'::text, 'INSERT'::text),
        ('anon'::name, 'privacy_incident_actions'::text, 'SELECT'::text),
        ('authenticated'::name, 'privacy_incident_actions'::text, 'INSERT'::text),
        ('anon'::name, 'privacy_incident_transition_previews'::text, 'SELECT'::text),
        ('authenticated'::name, 'privacy_incident_transition_previews'::text, 'INSERT'::text)
      ) AS grant_check(role_name, relation_name, privilege_name)
     WHERE has_table_privilege(role_name, 'public.' || relation_name, privilege_name)
  ) THEN
    RAISE EXCEPTION 'browser roles must not directly access incident workflow tables';
  END IF;

  IF has_function_privilege('anon', 'public.preview_privacy_incident_transition(uuid,uuid,public.privacy_incident_status,timestamptz,text,jsonb,uuid)', 'execute')
     OR has_function_privilege('authenticated', 'public.apply_privacy_incident_transition(uuid,uuid,uuid,public.privacy_incident_status,timestamptz,text,text,text,jsonb,uuid,text)', 'execute')
     OR has_function_privilege('anon', 'public.record_privacy_incident_detection(uuid,uuid,text,timestamptz,text,uuid)', 'execute')
     OR has_function_privilege('authenticated', 'public.record_privacy_incident_detection(uuid,uuid,text,timestamptz,text,uuid)', 'execute')
     OR NOT has_function_privilege('service_role', 'public.preview_privacy_incident_transition(uuid,uuid,public.privacy_incident_status,timestamptz,text,jsonb,uuid)', 'execute')
     OR NOT has_function_privilege('service_role', 'public.apply_privacy_incident_transition(uuid,uuid,uuid,public.privacy_incident_status,timestamptz,text,text,text,jsonb,uuid,text)', 'execute')
     OR NOT has_function_privilege('service_role', 'public.record_privacy_incident_detection(uuid,uuid,text,timestamptz,text,uuid)', 'execute') THEN
    RAISE EXCEPTION 'only service_role may execute incident workflow RPCs';
  END IF;

  IF NOT public.privacy_incident_transition_is_allowed('detected', 'triaged')
     OR NOT public.privacy_incident_transition_is_allowed('triaged', 'contained')
     OR NOT public.privacy_incident_transition_is_allowed('contained', 'assessed')
     OR NOT public.privacy_incident_transition_is_allowed('assessed', 'notice_drafted')
     OR NOT public.privacy_incident_transition_is_allowed('notice_drafted', 'notice_approved')
     OR NOT public.privacy_incident_transition_is_allowed('notice_approved', 'notified')
     OR NOT public.privacy_incident_transition_is_allowed('notified', 'closed')
     OR public.privacy_incident_transition_is_allowed('detected', 'assessed')
     OR public.privacy_incident_transition_is_allowed('closed', 'detected') THEN
    RAISE EXCEPTION 'incident transitions are not the approved fail-closed chain';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint
     WHERE conrelid = 'public.privacy_incidents'::regclass
       AND conname = 'privacy_incidents_awareness_deadline_check'
       AND pg_get_constraintdef(oid) ILIKE '%awareness_at%'
       AND pg_get_constraintdef(oid) LIKE '%72%'
       AND pg_get_constraintdef(oid) NOT ILIKE '%detected_at%'
  ) THEN
    RAISE EXCEPTION 'deadline must derive only from awareness_at plus 72 hours';
  END IF;

  v_prompt_999 := public.privacy_incident_decision_prompts(999, false, false);
  v_prompt_1000 := public.privacy_incident_decision_prompts(1000, false, false);
  v_prompt_sensitive := public.privacy_incident_decision_prompts(0, true, false);
  v_prompt_intrusion := public.privacy_incident_decision_prompts(0, false, true);
  IF jsonb_array_length(v_prompt_999) <> 1
     OR NOT (v_prompt_1000 @> '[{"code":"count_1000_or_more_human_review"}]'::jsonb)
     OR NOT (v_prompt_sensitive @> '[{"code":"sensitive_or_unique_id_human_review"}]'::jsonb)
     OR NOT (v_prompt_intrusion @> '[{"code":"external_intrusion_human_review"}]'::jsonb)
     OR v_prompt_1000::text ILIKE '%reportable%'
     OR v_prompt_1000::text ILIKE '%accepted%' THEN
    RAISE EXCEPTION 'threshold and sensitivity/intrusion paths must be human prompts only';
  END IF;

  SELECT
    pg_get_functiondef('public.apply_privacy_incident_transition(uuid,uuid,uuid,public.privacy_incident_status,timestamptz,text,text,text,jsonb,uuid,text)'::regprocedure)
    || E'\n'
    || pg_get_functiondef('public.privacy_incident_validate_input(public.privacy_incident_status,jsonb)'::regprocedure)
    || E'\n'
    || pg_get_functiondef('public.privacy_incident_enforce_state_invariants()'::regprocedure)
    INTO v_apply_source;
  IF v_apply_source NOT LIKE '%privacy_incident_external_receipt_required%'
     OR v_apply_source NOT LIKE '%privacy_incident_closure_readback_required%'
     OR v_apply_source NOT LIKE '%readback_status%'
     OR v_apply_source NOT LIKE '%''passed''%'
     OR v_apply_source NOT LIKE '%approved_by IS NOT NULL%'
     OR v_apply_source NOT LIKE '%submitted_by = p_actor_user_id%'
     OR v_apply_source NOT LIKE '%external_receipt_ref = p_transition_input ->> ''externalReceiptRef''%'
     OR v_apply_source NOT LIKE '%PERFORM public.privacy_incident_require_admin%'
     OR v_apply_source NOT LIKE '%PERFORM public.privacy_incident_validate_input%' THEN
    RAISE EXCEPTION 'apply RPC must fail closed for receipt, closure readback, and service role checks';
  END IF;
  SELECT pg_get_functiondef(
    'public.record_privacy_incident_detection(uuid,uuid,text,timestamptz,text,uuid)'::regprocedure
  )
  INTO v_detection_source;

  IF v_detection_source NOT LIKE '%PERFORM public.privacy_incident_require_admin(p_actor_user_id)%'
     OR v_detection_source NOT LIKE '%p_confirmation_text IS DISTINCT FROM ''개인정보 사고 탐지 등록''%'
     OR v_detection_source NOT LIKE '%p_severity NOT IN (''low'', ''medium'', ''high'', ''critical'')%'
     OR v_detection_source NOT LIKE '%p_detected_at > v_now%'
     OR v_detection_source NOT LIKE '%p_detected_at < v_now - interval ''10 years''%'
     OR v_detection_source NOT LIKE '%privacy_incident_detection_idempotency_conflict%'
     OR v_detection_source NOT LIKE '%privacy_incident_detection_readback_failed%'
     OR v_detection_source NOT LIKE '%privacy_incident_audit_retention_until(v_now)%'
     OR v_detection_source NOT LIKE '%jsonb_build_object(''created'', 1)%'
     OR v_detection_source NOT LIKE '%INCIDENT_DETECTION_RECORDED%'
     OR v_detection_source NOT LIKE '%FROM public.privacy_audit_events%'
     OR v_detection_source LIKE '%description%'
     OR v_detection_source LIKE '%evidence%'
     OR v_detection_source LIKE '%location%'
     OR v_detection_source LIKE '%credential%' THEN
    RAISE EXCEPTION 'detection RPC must be minimal, confirmed, audited, and fail closed';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc procedure
     WHERE procedure.oid = 'public.record_privacy_incident_detection(uuid,uuid,text,timestamptz,text,uuid)'::regprocedure
       AND (
         NOT procedure.prosecdef
         OR COALESCE(array_to_string(procedure.proconfig, ','), '') NOT LIKE '%search_path=public, pg_temp%'
       )
  ) THEN
    RAISE EXCEPTION 'detection RPC must be SECURITY DEFINER with a fixed search path';
  END IF;

  IF pg_get_functiondef('public.privacy_incident_audit_retention_until(timestamptz)'::regprocedure)
       NOT LIKE '%public.privacy_resolve_audit_retention_until%'
     OR pg_get_functiondef('public.privacy_incident_audit_retention_until(timestamptz)'::regprocedure)
       NOT LIKE '%''privacy_incident_audit''%' THEN
    RAISE EXCEPTION 'incident audit retention must delegate to the canonical resolver';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_trigger trigger
     WHERE trigger.tgrelid = 'public.privacy_incident_actions'::regclass
       AND trigger.tgname = 'privacy_incident_actions_immutable'
       AND NOT trigger.tgisinternal
  ) THEN
    RAISE EXCEPTION 'incident action history must be immutable';
  END IF;
END;
$$;
INSERT INTO auth.users (
  id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000001001', 'authenticated', 'authenticated', 'g010-incident-admin@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()),
  ('00000000-0000-0000-0000-000000001002', 'authenticated', 'authenticated', 'g010-incident-non-admin@example.invalid', 'not-a-real-password', pg_catalog.clock_timestamp(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp());

INSERT INTO public.user_roles (user_id, role)
VALUES ('00000000-0000-0000-0000-000000001001', 'admin');

UPDATE privacy_retention.privacy_retention_classes
   SET data_class = 'privacy_incident_audit',
       basis_code = 'g010_test_basis',
       trigger_type = 'event_occurred',
       retention_period = interval '1 day',
       status = 'active',
       approved_evidence_ref = 'G010-TEST-APPROVAL',
       version = 'g010-test-v1',
       activated_at = pg_catalog.clock_timestamp()
 WHERE code = 'privacy_incident_audit';

SET LOCAL ROLE service_role;
SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT pg_catalog.set_config(
  'g010.incident_detected_at',
  date_trunc('second', pg_catalog.clock_timestamp() - interval '1 minute')::text,
  true
);

DO $$
DECLARE
  v_first jsonb;
  v_replay jsonb;
BEGIN
  BEGIN
    PERFORM public.record_privacy_incident_detection(
      '00000000-0000-0000-0000-000000001002',
      '00000000-0000-0000-0000-000000001003',
      'high',
      pg_catalog.current_setting('g010.incident_detected_at')::timestamptz,
      '개인정보 사고 탐지 등록',
      '00000000-0000-0000-0000-000000001004'
    );
    RAISE EXCEPTION 'non-admin actor unexpectedly registered a detection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%privacy_incident_privacy_admin_required%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.record_privacy_incident_detection(
      '00000000-0000-0000-0000-000000001001',
      '00000000-0000-0000-0000-000000001005',
      'high',
      pg_catalog.current_setting('g010.incident_detected_at')::timestamptz,
      '개인정보 사고 탐지 등록 아님',
      '00000000-0000-0000-0000-000000001006'
    );
    RAISE EXCEPTION 'non-exact confirmation unexpectedly registered a detection';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%privacy_incident_detection_confirmation_required%' THEN
        RAISE;
      END IF;
  END;

  BEGIN
    PERFORM public.record_privacy_incident_detection(
      '00000000-0000-0000-0000-000000001001',
      '00000000-0000-0000-0000-000000001007',
      'high',
      pg_catalog.clock_timestamp() + interval '1 minute',
      '개인정보 사고 탐지 등록',
      '00000000-0000-0000-0000-000000001008'
    );
    RAISE EXCEPTION 'future detection timestamp unexpectedly registered';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%invalid_privacy_incident_detection_request%' THEN
        RAISE;
      END IF;
  END;
  BEGIN
    PERFORM public.record_privacy_incident_detection(
      '00000000-0000-0000-0000-000000001001',
      '00000000-0000-0000-0000-000000001011',
      'unknown',
      pg_catalog.current_setting('g010.incident_detected_at')::timestamptz,
      '개인정보 사고 탐지 등록',
      '00000000-0000-0000-0000-000000001012'
    );
    RAISE EXCEPTION 'invalid detection severity unexpectedly registered';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%invalid_privacy_incident_detection_request%' THEN
        RAISE;
      END IF;
  END;
  BEGIN
    PERFORM public.record_privacy_incident_detection(
      '00000000-0000-0000-0000-000000001001',
      '00000000-0000-0000-0000-000000001013',
      'high',
      pg_catalog.clock_timestamp() - interval '11 years',
      '개인정보 사고 탐지 등록',
      '00000000-0000-0000-0000-000000001014'
    );
    RAISE EXCEPTION 'unbounded historical detection timestamp unexpectedly registered';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%invalid_privacy_incident_detection_request%' THEN
        RAISE;
      END IF;
  END;

  v_first := public.record_privacy_incident_detection(
    '00000000-0000-0000-0000-000000001001',
    '00000000-0000-0000-0000-000000001009',
    'high',
    pg_catalog.current_setting('g010.incident_detected_at')::timestamptz,
    '개인정보 사고 탐지 등록',
    '00000000-0000-0000-0000-000000001010'
  );
  v_replay := public.record_privacy_incident_detection(
    '00000000-0000-0000-0000-000000001001',
    '00000000-0000-0000-0000-000000001009',
    'high',
    pg_catalog.current_setting('g010.incident_detected_at')::timestamptz,
    '개인정보 사고 탐지 등록',
    '00000000-0000-0000-0000-000000001010'
  );

  IF v_first ->> 'operationId' <> '00000000-0000-0000-0000-000000001009'
     OR v_first ->> 'incidentId' <> '00000000-0000-0000-0000-000000001009'
     OR v_first ->> 'status' <> 'detected'
     OR (v_first ->> 'replayed')::boolean IS DISTINCT FROM false
     OR (v_first #>> '{readback,passed}')::boolean IS DISTINCT FROM true
     OR v_first ->> 'auditId' IS NULL
     OR v_replay ->> 'auditId' <> v_first ->> 'auditId'
     OR (v_replay ->> 'replayed')::boolean IS DISTINCT FROM true
     OR (v_replay #>> '{readback,passed}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'detection receipt or exact idempotent replay failed';
  END IF;

  BEGIN
    PERFORM public.record_privacy_incident_detection(
      '00000000-0000-0000-0000-000000001001',
      '00000000-0000-0000-0000-000000001009',
      'critical',
      pg_catalog.current_setting('g010.incident_detected_at')::timestamptz,
      '개인정보 사고 탐지 등록',
      '00000000-0000-0000-0000-000000001010'
    );
    RAISE EXCEPTION 'mismatched incident UUID reuse unexpectedly succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%privacy_incident_detection_idempotency_conflict%' THEN
        RAISE;
      END IF;
  END;
END;
$$;
DO $$
DECLARE
  v_before_triage public.privacy_incidents%rowtype;
  v_after_triage public.privacy_incidents%rowtype;
  v_after_containment public.privacy_incidents%rowtype;
  v_triaged_input jsonb;
  v_triaged_preview jsonb;
  v_triaged_applied jsonb;
  v_triaged_replay jsonb;
  v_contained_preview jsonb;
  v_contained_applied jsonb;
  v_triaged_correlation_id uuid := '00000000-0000-0000-0000-000000001015';
  v_contained_correlation_id uuid := '00000000-0000-0000-0000-000000001016';
  v_triaged_reason_code text := 'incident_triaged';
  v_contained_reason_code text := 'incident_contained';
  v_triaged_idempotency_key text := 'g010-triaged-replay';
BEGIN
  SELECT *
    INTO v_before_triage
    FROM public.privacy_incidents
   WHERE id = '00000000-0000-0000-0000-000000001009';
  IF NOT FOUND
     OR v_before_triage.status <> 'detected'
     OR v_before_triage.severity <> 'high'
     OR v_before_triage.owner_user_id <> '00000000-0000-0000-0000-000000001001'
     OR v_before_triage.detected_at <> pg_catalog.current_setting('g010.incident_detected_at')::timestamptz
     OR v_before_triage.awareness_at IS NOT NULL
     OR v_before_triage.deadline_at IS NOT NULL
     OR v_before_triage.affected_count_estimate IS NOT NULL
     OR cardinality(v_before_triage.data_categories) <> 0
     OR v_before_triage.sensitive_or_unique_id IS NOT NULL
     OR v_before_triage.external_intrusion IS NOT NULL
     OR v_before_triage.decision_code IS NOT NULL
     OR v_before_triage.assessment_readback_at IS NOT NULL THEN
    RAISE EXCEPTION 'detection intake did not persist only the minimal detected incident';
  END IF;


  v_triaged_input := jsonb_build_object('awarenessAt', v_before_triage.detected_at);
  v_triaged_preview := public.preview_privacy_incident_transition(
    '00000000-0000-0000-0000-000000001001',
    v_before_triage.id,
    'triaged',
    v_before_triage.updated_at,
    v_triaged_reason_code,
    v_triaged_input,
    v_triaged_correlation_id
  );
  v_triaged_applied := public.apply_privacy_incident_transition(
    '00000000-0000-0000-0000-000000001001',
    (v_triaged_preview ->> 'operationId')::uuid,
    v_before_triage.id,
    'triaged',
    v_before_triage.updated_at,
    v_triaged_preview ->> 'previewHash',
    '개인정보 사고 조치 적용',
    v_triaged_reason_code,
    v_triaged_input,
    v_triaged_correlation_id,
    v_triaged_idempotency_key
  );

  IF v_triaged_applied ->> 'status' <> 'applied'
     OR (v_triaged_applied ->> 'replayed')::boolean IS DISTINCT FROM false
     OR (v_triaged_applied #>> '{readback,passed}')::boolean IS DISTINCT FROM true
     OR (v_triaged_applied #>> '{readback,checks,statusMatched}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'initial triaged transition did not produce a passed readback';
  END IF;

  SELECT *
    INTO v_after_triage
    FROM public.privacy_incidents
   WHERE id = v_before_triage.id;

  v_contained_preview := public.preview_privacy_incident_transition(
    '00000000-0000-0000-0000-000000001001',
    v_after_triage.id,
    'contained',
    v_after_triage.updated_at,
    v_contained_reason_code,
    '{}'::jsonb,
    v_contained_correlation_id
  );
  v_contained_applied := public.apply_privacy_incident_transition(
    '00000000-0000-0000-0000-000000001001',
    (v_contained_preview ->> 'operationId')::uuid,
    v_after_triage.id,
    'contained',
    v_after_triage.updated_at,
    v_contained_preview ->> 'previewHash',
    '개인정보 사고 조치 적용',
    v_contained_reason_code,
    '{}'::jsonb,
    v_contained_correlation_id,
    'g010-contained-apply'
  );

  IF v_contained_applied ->> 'status' <> 'applied'
     OR (v_contained_applied #>> '{readback,passed}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'later contained transition did not apply';
  END IF;

  SELECT *
    INTO v_after_containment
    FROM public.privacy_incidents
   WHERE id = v_before_triage.id;

  IF v_after_containment.status <> 'contained' THEN
    RAISE EXCEPTION 'later transition did not advance the incident';
  END IF;

  v_triaged_replay := public.apply_privacy_incident_transition(
    '00000000-0000-0000-0000-000000001001',
    (v_triaged_preview ->> 'operationId')::uuid,
    v_before_triage.id,
    'triaged',
    v_before_triage.updated_at,
    v_triaged_preview ->> 'previewHash',
    '개인정보 사고 조치 적용',
    v_triaged_reason_code,
    v_triaged_input,
    v_triaged_correlation_id,
    v_triaged_idempotency_key
  );

  IF v_triaged_replay ->> 'status' <> 'applied'
     OR (v_triaged_replay ->> 'replayed')::boolean IS DISTINCT FROM true
     OR v_triaged_replay ->> 'auditId' <> v_triaged_applied ->> 'auditId'
     OR (v_triaged_replay #>> '{readback,passed}')::boolean IS DISTINCT FROM true
     OR (v_triaged_replay #>> '{readback,checks,statusMatched}')::boolean IS DISTINCT FROM true
     OR (v_triaged_replay #>> '{readback,checks,actionImmutable}')::boolean IS DISTINCT FROM true
     OR (v_triaged_replay #>> '{readback,checks,replayed}')::boolean IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'replayed triaged transition did not preserve the stored passed readback';
  END IF;

  BEGIN
    PERFORM public.apply_privacy_incident_transition(
      '00000000-0000-0000-0000-000000001001',
      '00000000-0000-0000-0000-000000001017',
      v_before_triage.id,
      'triaged',
      v_before_triage.updated_at,
      v_triaged_preview ->> 'previewHash',
      '개인정보 사고 조치 적용',
      v_triaged_reason_code,
      v_triaged_input,
      v_triaged_correlation_id,
      v_triaged_idempotency_key
    );
    RAISE EXCEPTION 'mismatched transition operation replay unexpectedly succeeded';
  EXCEPTION
    WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%privacy_incident_idempotency_conflict%' THEN
        RAISE;
      END IF;
  END;
END;
$$;

RESET ROLE;

DO $$
DECLARE
  v_incident public.privacy_incidents%rowtype;
  v_audit_count integer;
  v_confirmed_count integer;
  v_applied_count integer;
  v_readback_count integer;
BEGIN
  SELECT *
    INTO v_incident
    FROM public.privacy_incidents
   WHERE id = '00000000-0000-0000-0000-000000001009';

  IF NOT FOUND
     OR v_incident.status <> 'contained'
     OR v_incident.severity <> 'high'
     OR v_incident.owner_user_id <> '00000000-0000-0000-0000-000000001001'
     OR v_incident.detected_at <> pg_catalog.current_setting('g010.incident_detected_at')::timestamptz
     OR v_incident.awareness_at IS NULL
     OR v_incident.deadline_at <> v_incident.awareness_at + interval '72 hours'
     OR v_incident.affected_count_estimate IS NOT NULL
     OR cardinality(v_incident.data_categories) <> 0
     OR v_incident.sensitive_or_unique_id IS NOT NULL
     OR v_incident.external_intrusion IS NOT NULL
     OR v_incident.decision_code IS NOT NULL
     OR v_incident.assessment_readback_at IS NOT NULL THEN
    RAISE EXCEPTION 'validated triage and containment did not preserve the expected incident record';
  END IF;

  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'confirmed'),
    count(*) FILTER (WHERE status = 'applied'),
    count(*) FILTER (WHERE status = 'readback_passed')
  INTO v_audit_count, v_confirmed_count, v_applied_count, v_readback_count
  FROM public.privacy_audit_events
  WHERE event_type = 'privacy_incident_detection'
    AND operation_id = '00000000-0000-0000-0000-000000001009';

  IF v_audit_count <> 3
     OR v_confirmed_count <> 1
     OR v_applied_count <> 1
     OR v_readback_count <> 1
     OR EXISTS (
       SELECT 1
         FROM public.privacy_audit_events
        WHERE event_type = 'privacy_incident_detection'
          AND operation_id = '00000000-0000-0000-0000-000000001009'
          AND (
            actor_user_id <> '00000000-0000-0000-0000-000000001001'
            OR correlation_id <> '00000000-0000-0000-0000-000000001010'
            OR reason_code <> 'INCIDENT_DETECTION_RECORDED'
            OR count_summary <> '{"created":1}'::jsonb
            OR request_metadata <> '{"route":"/api/admin/privacy-incidents"}'::jsonb
            OR retention_until <= occurred_at
          )
     ) THEN
    RAISE EXCEPTION 'detection audit/readback was not fixed-code, count-only, and retained';
  END IF;
END;
$$;

ROLLBACK;
