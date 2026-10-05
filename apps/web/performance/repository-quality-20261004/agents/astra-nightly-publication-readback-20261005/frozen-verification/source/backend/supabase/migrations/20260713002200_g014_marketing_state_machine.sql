-- G014-03: race-safe, legally truthful, least-privilege marketing dispatch.
-- This migration follows G014-01/02 without rewriting retained history or prior
-- migrations. Provider delivery is always preceded by a durable unknown attempt.

DO $g014_preflight$
BEGIN
  IF pg_catalog.to_regclass('privacy_retention.privacy_consent_events') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.privacy_policy_versions') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.privacy_age_profiles') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.privacy_guardian_verifications') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.privacy_audit_events') IS NULL
     OR pg_catalog.to_regclass('public.notifications') IS NULL
     OR pg_catalog.to_regclass('public.marketing_campaign_operations') IS NULL
     OR pg_catalog.to_regclass('public.marketing_campaign_recipients') IS NULL
     OR pg_catalog.to_regclass('public.marketing_campaign_batches') IS NULL
     OR pg_catalog.to_regclass('public.user_roles') IS NULL
     OR pg_catalog.to_regclass('public.user_account_status') IS NULL THEN
    RAISE EXCEPTION 'G014-03 required G010/G014 relations are missing';
  END IF;
  IF pg_catalog.to_regprocedure('privacy_retention.g014_privacy_eligibility_receipt(uuid)') IS NULL
     OR pg_catalog.to_regprocedure('privacy_retention.g014_require_service_role()') IS NULL THEN
    RAISE EXCEPTION 'G014-03 required privacy evaluator identity is missing';
  END IF;
END;
$g014_preflight$;

-- Actor identity remains auditable after account deletion, while the auth FK no
-- longer prevents deletion. Existing rows are backfilled before NOT NULL is set.
ALTER TABLE public.marketing_campaign_operations
  ADD COLUMN actor_ref_hash text;
UPDATE public.marketing_campaign_operations AS operation
SET actor_ref_hash = pg_catalog.encode(
  extensions.digest('marketing-actor:v1:' || operation.actor_user_id::text, 'sha256'),
  'hex'
)
WHERE operation.actor_ref_hash IS NULL;
ALTER TABLE public.marketing_campaign_operations
  ALTER COLUMN actor_ref_hash SET NOT NULL,
  ADD CONSTRAINT g014_marketing_campaign_operations_actor_ref_hash_check
    CHECK (actor_ref_hash ~ '^[0-9a-f]{64}$') NOT VALID;
-- Hosted preflight: verify actor_ref_hash is populated and 64 lowercase hex.
-- Hosted validation: ALTER TABLE public.marketing_campaign_operations VALIDATE CONSTRAINT g014_marketing_campaign_operations_actor_ref_hash_check;
ALTER TABLE public.marketing_campaign_operations
  DROP CONSTRAINT marketing_campaign_operations_actor_user_id_fkey,
  ALTER COLUMN actor_user_id DROP NOT NULL,
  ADD CONSTRAINT g014_marketing_campaign_operations_actor_user_id_fkey
    FOREIGN KEY (actor_user_id) REFERENCES auth.users(id) ON DELETE SET NULL NOT VALID;
-- Hosted preflight: SELECT count(*) FROM public.marketing_campaign_operations WHERE actor_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users WHERE id = actor_user_id);
-- Hosted validation: ALTER TABLE public.marketing_campaign_operations VALIDATE CONSTRAINT g014_marketing_campaign_operations_actor_user_id_fkey;

ALTER TABLE public.marketing_campaign_batches
  DROP CONSTRAINT marketing_campaign_batches_status_check,
  ADD CONSTRAINT g014_marketing_campaign_batches_status_check
    CHECK (status IN ('prepared', 'claimed', 'provider_failed', 'completed')) NOT VALID,
  ADD COLUMN claim_token uuid,
  ADD COLUMN claimed_at timestamptz;
-- Hosted preflight: SELECT id FROM public.marketing_campaign_batches WHERE status NOT IN ('prepared', 'claimed', 'provider_failed', 'completed');
-- Hosted validation: ALTER TABLE public.marketing_campaign_batches VALIDATE CONSTRAINT g014_marketing_campaign_batches_status_check;
CREATE UNIQUE INDEX g014_marketing_campaign_batches_id_operation_idx
  ON public.marketing_campaign_batches (id, operation_id);
ALTER TABLE public.marketing_campaign_batches
  ADD CONSTRAINT g014_marketing_campaign_batches_id_operation_key
  UNIQUE USING INDEX g014_marketing_campaign_batches_id_operation_idx;
CREATE UNIQUE INDEX g014_marketing_campaign_one_active_batch_idx
  ON public.marketing_campaign_batches (operation_id)
  WHERE status IN ('prepared', 'claimed');

-- The redundant immutable consent key is intentional: composite foreign keys
-- prove that a retained evidence key belongs to the exact user/subject/purpose/
-- channel/granted event, current policy version, and notice hash it records.
CREATE UNIQUE INDEX g014_privacy_consent_events_exact_binding_idx
  ON privacy_retention.privacy_consent_events (
    id, user_id, subject_kind, guardian_verification_id, purpose, channel,
    decision, policy_version_id, notice_sha256
  );
ALTER TABLE privacy_retention.privacy_consent_events
  ADD CONSTRAINT g014_privacy_consent_events_exact_binding_key
  UNIQUE USING INDEX g014_privacy_consent_events_exact_binding_idx;

CREATE TABLE privacy_retention.marketing_campaign_batch_recipients (
  batch_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  status text NOT NULL,
  ordinary_consent_event_id uuid,
  ordinary_subject_kind text,
  ordinary_guardian_verification_id uuid,
  ordinary_purpose text,
  ordinary_channel text,
  ordinary_decision text,
  ordinary_policy_version_id uuid,
  ordinary_notice_sha256 text,
  night_consent_event_id uuid,
  night_subject_kind text,
  night_guardian_verification_id uuid,
  night_purpose text,
  night_channel text,
  night_decision text,
  night_policy_version_id uuid,
  night_notice_sha256 text,
  claim_token uuid,
  claimed_at timestamptz,
  finalized_at timestamptz,
  provider_accepted_at timestamptz,
  notification_eligibility_outcome text NOT NULL DEFAULT 'not_applicable',
  provider_receipt_id text,
  provider_receipt_hash text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT g014_marketing_batch_recipients_pkey PRIMARY KEY (batch_id, user_id),
  CONSTRAINT g014_marketing_batch_recipients_batch_operation_user_key
    UNIQUE (batch_id, operation_id, user_id)
);
ALTER TABLE privacy_retention.marketing_campaign_batch_recipients
  ADD CONSTRAINT g014_marketing_batch_recipients_status_check
    CHECK (status IN ('eligible', 'claimed', 'sent', 'suppressed', 'failed')) NOT VALID,
  ADD CONSTRAINT g014_marketing_batch_recipients_claim_shape_check
    CHECK (
      (status IN ('eligible', 'suppressed', 'failed') AND claim_token IS NULL AND claimed_at IS NULL)
      OR (status IN ('claimed', 'sent', 'suppressed', 'failed') AND claim_token IS NOT NULL AND claimed_at IS NOT NULL)
    ) NOT VALID,
  ADD CONSTRAINT g014_marketing_batch_recipients_receipt_shape_check
    CHECK (
      (provider_receipt_id IS NULL AND provider_receipt_hash IS NULL)
      OR (provider_receipt_id ~ '^[A-Za-z0-9._:-]{1,256}$' AND provider_receipt_hash ~ '^[0-9a-f]{64}$')
    ) NOT VALID,
  ADD CONSTRAINT g014_marketing_batch_recipients_transport_notification_shape_check
    CHECK (
      (provider_accepted_at IS NULL AND notification_eligibility_outcome = 'not_applicable')
      OR (
        provider_accepted_at IS NOT NULL
        AND notification_eligibility_outcome IN (
          'notification_created',
          'notification_suppressed_after_acceptance'
        )
      )
    ) NOT VALID,
  ADD CONSTRAINT g014_marketing_batch_recipients_transport_notification_status_check
    CHECK (
      notification_eligibility_outcome = 'not_applicable'
      OR (notification_eligibility_outcome = 'notification_created' AND status = 'sent')
      OR (
        notification_eligibility_outcome = 'notification_suppressed_after_acceptance'
        AND status = 'suppressed'
      )
    ) NOT VALID,
  ADD CONSTRAINT g014_marketing_batch_recipients_ordinary_shape_check
    CHECK (
      (ordinary_consent_event_id IS NULL AND ordinary_subject_kind IS NULL
       AND ordinary_guardian_verification_id IS NULL AND ordinary_purpose IS NULL
       AND ordinary_channel IS NULL AND ordinary_decision IS NULL
       AND ordinary_policy_version_id IS NULL AND ordinary_notice_sha256 IS NULL)
      OR (ordinary_consent_event_id IS NOT NULL AND ordinary_subject_kind IN ('self', 'child')
          AND ordinary_purpose IN ('email_marketing', 'sms_marketing', 'push_marketing')
          AND ordinary_channel IN ('email', 'sms', 'push')
          AND ordinary_decision = 'granted' AND ordinary_policy_version_id IS NOT NULL
          AND ordinary_notice_sha256 ~ '^[0-9a-f]{64}$')
    ) NOT VALID,
  ADD CONSTRAINT g014_marketing_batch_recipients_night_shape_check
    CHECK (
      (night_consent_event_id IS NULL AND night_subject_kind IS NULL
       AND night_guardian_verification_id IS NULL AND night_purpose IS NULL
       AND night_channel IS NULL AND night_decision IS NULL
       AND night_policy_version_id IS NULL AND night_notice_sha256 IS NULL)
      OR (night_consent_event_id IS NOT NULL AND night_subject_kind IN ('self', 'child')
          AND night_purpose = 'night_marketing' AND night_channel IN ('email', 'sms', 'push')
          AND night_decision = 'granted' AND night_policy_version_id IS NOT NULL
          AND night_notice_sha256 ~ '^[0-9a-f]{64}$')
    ) NOT VALID,
  ADD CONSTRAINT g014_marketing_batch_recipients_batch_operation_fk
    FOREIGN KEY (batch_id, operation_id)
    REFERENCES public.marketing_campaign_batches (id, operation_id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT g014_marketing_batch_recipients_operation_recipient_fk
    FOREIGN KEY (operation_id, user_id)
    REFERENCES public.marketing_campaign_recipients (operation_id, user_id) ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT g014_marketing_batch_recipients_ordinary_consent_binding_fk
    FOREIGN KEY (
      ordinary_consent_event_id, user_id, ordinary_subject_kind,
      ordinary_guardian_verification_id, ordinary_purpose, ordinary_channel,
      ordinary_decision, ordinary_policy_version_id, ordinary_notice_sha256
    ) REFERENCES privacy_retention.privacy_consent_events (
      id, user_id, subject_kind, guardian_verification_id, purpose, channel,
      decision, policy_version_id, notice_sha256
    ) ON DELETE RESTRICT NOT VALID,
  ADD CONSTRAINT g014_marketing_batch_recipients_night_consent_binding_fk
    FOREIGN KEY (
      night_consent_event_id, user_id, night_subject_kind,
      night_guardian_verification_id, night_purpose, night_channel,
      night_decision, night_policy_version_id, night_notice_sha256
    ) REFERENCES privacy_retention.privacy_consent_events (
      id, user_id, subject_kind, guardian_verification_id, purpose, channel,
      decision, policy_version_id, notice_sha256
    ) ON DELETE RESTRICT NOT VALID;
-- Hosted preflight: validate each named G014 batch-recipient FK with anti-joins.
-- Hosted validation: ALTER TABLE privacy_retention.marketing_campaign_batch_recipients VALIDATE CONSTRAINT <each named g014 constraint above>;

CREATE TABLE privacy_retention.marketing_campaign_consent_evidence_keys (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  batch_id uuid NOT NULL,
  operation_id uuid NOT NULL,
  user_id uuid NOT NULL,
  evidence_kind text NOT NULL,
  consent_event_id uuid NOT NULL,
  subject_kind text NOT NULL,
  guardian_verification_id uuid,
  purpose text NOT NULL,
  channel text NOT NULL,
  decision text NOT NULL,
  policy_version_id uuid NOT NULL,
  notice_sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CONSTRAINT g014_marketing_consent_evidence_unique
    UNIQUE (batch_id, user_id, evidence_kind, consent_event_id)
);
ALTER TABLE privacy_retention.marketing_campaign_consent_evidence_keys
  ADD CONSTRAINT g014_marketing_consent_evidence_kind_check
    CHECK (evidence_kind IN ('claim_ordinary', 'claim_night', 'finalize_ordinary', 'finalize_night')) NOT VALID,
  ADD CONSTRAINT g014_marketing_consent_evidence_granted_check
    CHECK (decision = 'granted' AND notice_sha256 ~ '^[0-9a-f]{64}$') NOT VALID,
  ADD CONSTRAINT g014_marketing_consent_evidence_kind_binding_check
    CHECK (
      (evidence_kind IN ('claim_ordinary', 'finalize_ordinary')
       AND purpose IN ('email_marketing', 'sms_marketing', 'push_marketing'))
      OR (evidence_kind IN ('claim_night', 'finalize_night') AND purpose = 'night_marketing')
    ) NOT VALID,
  ADD CONSTRAINT g014_marketing_consent_evidence_batch_recipient_fk
    FOREIGN KEY (batch_id, operation_id, user_id)
    REFERENCES privacy_retention.marketing_campaign_batch_recipients (batch_id, operation_id, user_id)
    ON DELETE CASCADE NOT VALID,
  ADD CONSTRAINT g014_marketing_consent_evidence_exact_consent_fk
    FOREIGN KEY (
      consent_event_id, user_id, subject_kind, guardian_verification_id,
      purpose, channel, decision, policy_version_id, notice_sha256
    ) REFERENCES privacy_retention.privacy_consent_events (
      id, user_id, subject_kind, guardian_verification_id, purpose, channel,
      decision, policy_version_id, notice_sha256
    ) ON DELETE RESTRICT NOT VALID;
-- Hosted preflight: validate G014 evidence-key recipient and exact-consent anti-joins.
-- Hosted validation: ALTER TABLE privacy_retention.marketing_campaign_consent_evidence_keys VALIDATE CONSTRAINT <each named g014 constraint above>;
CREATE OR REPLACE FUNCTION privacy_retention.g014_marketing_canonical_recipient_ids(p_user_ids uuid[])
RETURNS uuid[]
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT COALESCE(
    pg_catalog.array_agg(DISTINCT recipient.user_id ORDER BY recipient.user_id),
    ARRAY[]::uuid[]
  )
  FROM pg_catalog.unnest(p_user_ids) AS recipient(user_id);
$function$;
CREATE OR REPLACE FUNCTION privacy_retention.g014_marketing_accepted_recipient_digest(p_user_ids uuid[])
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(
    extensions.digest(
      COALESCE(
        pg_catalog.array_to_string(
          privacy_retention.g014_marketing_canonical_recipient_ids(p_user_ids),
          ','
        ),
        ''
      ),
      'sha256'
    ),
    'hex'
  );
$function$;
ALTER FUNCTION privacy_retention.g014_marketing_canonical_recipient_ids(uuid[]) OWNER TO privacy_workflow_owner;
ALTER FUNCTION privacy_retention.g014_marketing_accepted_recipient_digest(uuid[]) OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_marketing_canonical_recipient_ids(uuid[]),
  privacy_retention.g014_marketing_accepted_recipient_digest(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE privacy_retention.marketing_campaign_provider_attempts (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  operation_id uuid NOT NULL,
  batch_id uuid NOT NULL,
  claim_token uuid NOT NULL,
  provider_identity text NOT NULL,
  idempotency_key text NOT NULL,
  payload_digest text NOT NULL,
  status text NOT NULL,
  provider_receipt_id text,
  provider_receipt_hash text,
  accepted_recipient_ids uuid[],
  accepted_recipient_digest text,
  provider_error_code text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  outcome_recorded_at timestamptz,
  CONSTRAINT g014_marketing_provider_attempt_unique_claim
    UNIQUE (operation_id, batch_id, claim_token)
);
ALTER TABLE privacy_retention.marketing_campaign_provider_attempts
  ADD CONSTRAINT g014_marketing_provider_attempt_identity_check
    CHECK (provider_identity = 'g014_https_provider_v1') NOT VALID,
  ADD CONSTRAINT g014_marketing_provider_attempt_idempotency_check
    CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{8,128}$' AND payload_digest ~ '^[0-9a-f]{64}$') NOT VALID,
  ADD CONSTRAINT g014_marketing_provider_attempt_status_check
    CHECK (status IN ('unknown', 'accepted', 'failed')) NOT VALID,
  ADD CONSTRAINT g014_marketing_provider_attempt_receipt_check
    CHECK (
      (status = 'unknown'
       AND provider_receipt_id IS NULL
       AND provider_receipt_hash IS NULL
       AND accepted_recipient_ids IS NULL
       AND accepted_recipient_digest IS NULL
       AND provider_error_code IS NULL
       AND outcome_recorded_at IS NULL)
      OR (status = 'accepted'
          AND provider_receipt_id ~ '^[A-Za-z0-9._:-]{1,256}$'
          AND provider_receipt_hash ~ '^[0-9a-f]{64}$'
          AND accepted_recipient_ids IS NOT NULL
          AND accepted_recipient_digest = privacy_retention.g014_marketing_accepted_recipient_digest(accepted_recipient_ids)
          AND provider_error_code IS NULL
          AND outcome_recorded_at IS NOT NULL)
      OR (status = 'failed'
          AND provider_receipt_id ~ '^[A-Za-z0-9._:-]{1,256}$'
          AND provider_receipt_hash ~ '^[0-9a-f]{64}$'
          AND accepted_recipient_ids IS NULL
          AND accepted_recipient_digest IS NULL
          AND provider_error_code IN ('provider_rejected', 'provider_invalid_request')
          AND outcome_recorded_at IS NOT NULL)
    ) NOT VALID,
  ADD CONSTRAINT g014_marketing_provider_attempt_accepted_recipients_canonical_check
    CHECK (
      accepted_recipient_ids IS NULL
      OR accepted_recipient_ids = privacy_retention.g014_marketing_canonical_recipient_ids(accepted_recipient_ids)
    ) NOT VALID,
  ADD CONSTRAINT g014_marketing_provider_attempt_batch_operation_fk
    FOREIGN KEY (batch_id, operation_id)
    REFERENCES public.marketing_campaign_batches (id, operation_id) ON DELETE RESTRICT NOT VALID;
-- Hosted preflight: validate G014 provider-attempt batch anti-joins and status shape.
-- Hosted validation: ALTER TABLE privacy_retention.marketing_campaign_provider_attempts VALIDATE CONSTRAINT <each named g014 constraint above>;

ALTER TABLE privacy_retention.marketing_campaign_batch_recipients OWNER TO privacy_workflow_owner;
ALTER TABLE privacy_retention.marketing_campaign_consent_evidence_keys OWNER TO privacy_workflow_owner;
ALTER TABLE privacy_retention.marketing_campaign_provider_attempts OWNER TO privacy_workflow_owner;
ALTER TABLE privacy_retention.marketing_campaign_batch_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_retention.marketing_campaign_batch_recipients FORCE ROW LEVEL SECURITY;
ALTER TABLE privacy_retention.marketing_campaign_consent_evidence_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_retention.marketing_campaign_consent_evidence_keys FORCE ROW LEVEL SECURITY;
ALTER TABLE privacy_retention.marketing_campaign_provider_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE privacy_retention.marketing_campaign_provider_attempts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE privacy_retention.marketing_campaign_batch_recipients,
  privacy_retention.marketing_campaign_consent_evidence_keys,
  privacy_retention.marketing_campaign_provider_attempts
  FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE privacy_retention.marketing_campaign_batch_recipients,
  privacy_retention.marketing_campaign_consent_evidence_keys,
  privacy_retention.marketing_campaign_provider_attempts
  TO privacy_workflow_owner;
CREATE POLICY g014_privacy_workflow_owner_access
  ON privacy_retention.marketing_campaign_batch_recipients
  FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true);
CREATE POLICY g014_privacy_workflow_owner_access
  ON privacy_retention.marketing_campaign_consent_evidence_keys
  FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true);
CREATE POLICY g014_privacy_workflow_owner_access
  ON privacy_retention.marketing_campaign_provider_attempts
  FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION privacy_retention.g014_marketing_consent_evidence_binding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.decision IS DISTINCT FROM 'granted'
     OR NOT EXISTS (
       SELECT 1
       FROM privacy_retention.privacy_consent_events AS event
       WHERE event.id = NEW.consent_event_id
         AND event.user_id = NEW.user_id
         AND event.subject_kind IS NOT DISTINCT FROM NEW.subject_kind
         AND event.guardian_verification_id IS NOT DISTINCT FROM NEW.guardian_verification_id
         AND event.purpose IS NOT DISTINCT FROM NEW.purpose
         AND event.channel IS NOT DISTINCT FROM NEW.channel
         AND event.decision IS NOT DISTINCT FROM NEW.decision
         AND event.policy_version_id IS NOT DISTINCT FROM NEW.policy_version_id
         AND event.notice_sha256 IS NOT DISTINCT FROM NEW.notice_sha256
         AND event.decision = 'granted'
     ) THEN
    RAISE EXCEPTION 'marketing_consent_evidence_binding_invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION privacy_retention.g014_marketing_consent_evidence_binding() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_marketing_consent_evidence_binding() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER g014_marketing_consent_evidence_binding
  BEFORE INSERT ON privacy_retention.marketing_campaign_consent_evidence_keys
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_marketing_consent_evidence_binding();
CREATE OR REPLACE FUNCTION privacy_retention.g014_marketing_reject_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
DECLARE
  v_deletion_user_id uuid;
  v_role text;
BEGIN
  v_role := COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    pg_catalog.current_setting('request.jwt.claim.role', true),
    ''
  );
  IF TG_OP = 'DELETE'
     AND v_role = 'service_role'
     AND pg_catalog.current_setting('app.account_deletion_user_id', true) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
    v_deletion_user_id := pg_catalog.current_setting('app.account_deletion_user_id', true)::uuid;
    IF OLD.user_id = v_deletion_user_id THEN
      RETURN OLD;
    END IF;
  END IF;
  RAISE EXCEPTION 'marketing_consent_evidence_is_append_only' USING ERRCODE = '55000';
END;
$function$;
ALTER FUNCTION privacy_retention.g014_marketing_reject_evidence_mutation() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_marketing_reject_evidence_mutation() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER g014_marketing_consent_evidence_append_only
  BEFORE UPDATE OR DELETE ON privacy_retention.marketing_campaign_consent_evidence_keys
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_marketing_reject_evidence_mutation();
CREATE OR REPLACE FUNCTION privacy_retention.g014_marketing_provider_attempt_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status IS DISTINCT FROM 'unknown'
       OR NEW.provider_receipt_id IS NOT NULL
       OR NEW.provider_receipt_hash IS NOT NULL
       OR NEW.accepted_recipient_ids IS NOT NULL
       OR NEW.accepted_recipient_digest IS NOT NULL
       OR NEW.provider_error_code IS NOT NULL
       OR NEW.outcome_recorded_at IS NOT NULL THEN
      RAISE EXCEPTION 'marketing_provider_attempt_initial_state_invalid' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
     OR NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.claim_token IS DISTINCT FROM OLD.claim_token
     OR NEW.provider_identity IS DISTINCT FROM OLD.provider_identity
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.payload_digest IS DISTINCT FROM OLD.payload_digest
     OR OLD.status IS DISTINCT FROM 'unknown'
     OR NEW.status NOT IN ('accepted', 'failed') THEN
    RAISE EXCEPTION 'marketing_provider_attempt_transition_invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION privacy_retention.g014_marketing_provider_attempt_transition() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_marketing_provider_attempt_transition() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER g014_marketing_provider_attempt_transition
  BEFORE INSERT OR UPDATE ON privacy_retention.marketing_campaign_provider_attempts
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_marketing_provider_attempt_transition();
CREATE OR REPLACE FUNCTION privacy_retention.g014_marketing_reject_provider_attempt_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION 'marketing_provider_attempt_is_append_only' USING ERRCODE = '55000';
END;
$function$;
ALTER FUNCTION privacy_retention.g014_marketing_reject_provider_attempt_delete() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_marketing_reject_provider_attempt_delete() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER g014_marketing_provider_attempt_no_delete
  BEFORE DELETE ON privacy_retention.marketing_campaign_provider_attempts
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_marketing_reject_provider_attempt_delete();

CREATE OR REPLACE FUNCTION privacy_retention.g014_marketing_batch_recipient_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('eligible', 'suppressed')
       OR NEW.provider_accepted_at IS NOT NULL
       OR NEW.notification_eligibility_outcome IS DISTINCT FROM 'not_applicable' THEN
      RAISE EXCEPTION 'marketing_batch_recipient_initial_state_invalid' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.batch_id IS DISTINCT FROM OLD.batch_id
     OR NEW.operation_id IS DISTINCT FROM OLD.operation_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR (
       OLD.provider_accepted_at IS NOT NULL
       AND NEW.provider_accepted_at IS DISTINCT FROM OLD.provider_accepted_at
     )
     OR (
       OLD.notification_eligibility_outcome IS DISTINCT FROM 'not_applicable'
       AND NEW.notification_eligibility_outcome IS DISTINCT FROM OLD.notification_eligibility_outcome
     )
     OR (
       OLD.provider_accepted_at IS NULL
       AND NEW.provider_accepted_at IS NOT NULL
       AND OLD.status IS DISTINCT FROM 'claimed'
     )
     OR NOT (
       (OLD.status = 'eligible' AND NEW.status IN ('claimed', 'suppressed', 'failed'))
       OR (OLD.status = 'claimed' AND NEW.status IN ('sent', 'suppressed', 'failed'))
       OR NEW.status IS NOT DISTINCT FROM OLD.status
     ) THEN
    RAISE EXCEPTION 'marketing_batch_recipient_transition_invalid' USING ERRCODE = '23514';
  END IF;
  IF NEW.provider_accepted_at IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM privacy_retention.marketing_campaign_provider_attempts AS attempt
       WHERE attempt.operation_id = NEW.operation_id
         AND attempt.batch_id = NEW.batch_id
         AND attempt.claim_token = NEW.claim_token
         AND attempt.status = 'accepted'
         AND NEW.user_id = ANY (attempt.accepted_recipient_ids)
     ) THEN
    RAISE EXCEPTION 'marketing_batch_recipient_transport_binding_invalid' USING ERRCODE = '23514';
  END IF;
  IF NEW.ordinary_consent_event_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM privacy_retention.privacy_consent_events AS event
       WHERE event.id = NEW.ordinary_consent_event_id
         AND event.user_id = NEW.user_id
         AND event.subject_kind IS NOT DISTINCT FROM NEW.ordinary_subject_kind
         AND event.guardian_verification_id IS NOT DISTINCT FROM NEW.ordinary_guardian_verification_id
         AND event.purpose IS NOT DISTINCT FROM NEW.ordinary_purpose
         AND event.channel IS NOT DISTINCT FROM NEW.ordinary_channel
         AND event.decision IS NOT DISTINCT FROM NEW.ordinary_decision
         AND event.policy_version_id IS NOT DISTINCT FROM NEW.ordinary_policy_version_id
         AND event.notice_sha256 IS NOT DISTINCT FROM NEW.ordinary_notice_sha256
         AND event.decision = 'granted'
     ) THEN
    RAISE EXCEPTION 'marketing_ordinary_consent_binding_invalid' USING ERRCODE = '23514';
  END IF;
  IF NEW.night_consent_event_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM privacy_retention.privacy_consent_events AS event
       WHERE event.id = NEW.night_consent_event_id
         AND event.user_id = NEW.user_id
         AND event.subject_kind IS NOT DISTINCT FROM NEW.night_subject_kind
         AND event.guardian_verification_id IS NOT DISTINCT FROM NEW.night_guardian_verification_id
         AND event.purpose IS NOT DISTINCT FROM NEW.night_purpose
         AND event.channel IS NOT DISTINCT FROM NEW.night_channel
         AND event.decision IS NOT DISTINCT FROM NEW.night_decision
         AND event.policy_version_id IS NOT DISTINCT FROM NEW.night_policy_version_id
         AND event.notice_sha256 IS NOT DISTINCT FROM NEW.night_notice_sha256
         AND event.decision = 'granted'
     ) THEN
    RAISE EXCEPTION 'marketing_night_consent_binding_invalid' USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := pg_catalog.clock_timestamp();
  RETURN NEW;
END;
$function$;
ALTER FUNCTION privacy_retention.g014_marketing_batch_recipient_transition() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_marketing_batch_recipient_transition() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER g014_marketing_batch_recipient_transition
  BEFORE INSERT OR UPDATE ON privacy_retention.marketing_campaign_batch_recipients
  FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_marketing_batch_recipient_transition();

CREATE OR REPLACE FUNCTION public.g014_marketing_public_recipient_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (
    (OLD.status = 'pending' AND NEW.status IN ('eligible', 'suppressed'))
    OR (OLD.status = 'eligible' AND NEW.status IN ('sent', 'suppressed', 'failed'))
    OR NEW.status IS NOT DISTINCT FROM OLD.status
  ) THEN
    RAISE EXCEPTION 'marketing_recipient_transition_invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION public.g014_marketing_public_recipient_transition() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.g014_marketing_public_recipient_transition() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER g014_marketing_public_recipient_transition
  BEFORE UPDATE ON public.marketing_campaign_recipients
  FOR EACH ROW EXECUTE FUNCTION public.g014_marketing_public_recipient_transition();

CREATE OR REPLACE FUNCTION public.g014_marketing_batch_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NOT (
    (OLD.status = 'prepared' AND NEW.status IN ('claimed', 'provider_failed', 'completed'))
    OR (OLD.status = 'claimed' AND NEW.status = 'completed')
    OR NEW.status IS NOT DISTINCT FROM OLD.status
  ) THEN
    RAISE EXCEPTION 'marketing_batch_transition_invalid' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION public.g014_marketing_batch_transition() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.g014_marketing_batch_transition() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER g014_marketing_batch_transition
  BEFORE UPDATE ON public.marketing_campaign_batches
  FOR EACH ROW EXECUTE FUNCTION public.g014_marketing_batch_transition();

CREATE OR REPLACE FUNCTION public.g014_marketing_operation_terminal_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status IN ('applied', 'partial', 'failed')
     AND EXISTS (
       SELECT 1
       FROM public.marketing_campaign_recipients AS recipient
       WHERE recipient.operation_id = NEW.id
         AND recipient.status IN ('pending', 'eligible')
       UNION ALL
       SELECT 1
       FROM privacy_retention.marketing_campaign_batch_recipients AS recipient
       WHERE recipient.operation_id = NEW.id
         AND recipient.status = 'claimed'
     ) THEN
    RAISE EXCEPTION 'marketing_operation_has_unresolved_recipients' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$function$;
ALTER FUNCTION public.g014_marketing_operation_terminal_guard() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.g014_marketing_operation_terminal_guard() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER g014_marketing_operation_terminal_guard
  BEFORE UPDATE OF status ON public.marketing_campaign_operations
  FOR EACH ROW EXECUTE FUNCTION public.g014_marketing_operation_terminal_guard();

CREATE OR REPLACE FUNCTION privacy_retention.g014_marketing_permission_evidence(
  p_user_id uuid,
  p_channel text,
  p_scheduled_at timestamptz,
  p_timezone text
)
RETURNS TABLE (
  allowed boolean,
  reason_code text,
  ordinary_consent_event_id uuid,
  night_consent_event_id uuid,
  subject_kind text,
  guardian_verification_id uuid,
  policy_version_id uuid,
  policy_content_sha256 text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_policy privacy_retention.privacy_policy_versions%ROWTYPE;
  v_profile privacy_retention.privacy_age_profiles%ROWTYPE;
  v_ordinary privacy_retention.privacy_consent_events%ROWTYPE;
  v_night privacy_retention.privacy_consent_events%ROWTYPE;
  v_guardian_id uuid;
  v_eligibility jsonb;
  v_subject_kind text;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  IF p_user_id IS NULL
     OR p_channel IS NULL
     OR p_channel NOT IN ('email', 'sms', 'push')
     OR p_scheduled_at IS NULL
     OR p_timezone IS DISTINCT FROM 'Asia/Seoul' THEN
    RAISE EXCEPTION 'marketing_permission_input_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_policy
  FROM privacy_retention.privacy_policy_versions AS policy
  WHERE policy.status = 'published'
    AND policy.effective_at <= v_now
  ORDER BY policy.effective_at DESC, policy.id DESC
  LIMIT 1;
  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'privacy_policy_unavailable'::text, NULL::uuid, NULL::uuid,
      NULL::text, NULL::uuid, NULL::uuid, NULL::text;
    RETURN;
  END IF;

  v_eligibility := privacy_retention.g014_privacy_eligibility_receipt(p_user_id);
  IF COALESCE((v_eligibility ->> 'eligible')::boolean, false) IS DISTINCT FROM true
     OR (v_eligibility ->> 'policyVersionId') IS DISTINCT FROM v_policy.id::text
     OR (v_eligibility ->> 'contentSha256') IS DISTINCT FROM v_policy.content_sha256 THEN
    RETURN QUERY SELECT false, 'privacy_eligibility_required'::text, NULL::uuid, NULL::uuid,
      NULL::text, NULL::uuid, v_policy.id, v_policy.content_sha256;
    RETURN;
  END IF;

  SELECT * INTO v_profile
  FROM privacy_retention.privacy_age_profiles AS profile
  WHERE profile.user_id = p_user_id;
  IF NOT FOUND OR v_profile.policy_version_id IS DISTINCT FROM v_policy.id THEN
    RETURN QUERY SELECT false, 'privacy_eligibility_required'::text, NULL::uuid, NULL::uuid,
      NULL::text, NULL::uuid, v_policy.id, v_policy.content_sha256;
    RETURN;
  END IF;

  IF v_profile.age_band = 'under_14' THEN
    v_subject_kind := 'child';
    SELECT guardian.id INTO v_guardian_id
    FROM privacy_retention.privacy_guardian_verifications AS guardian
    WHERE guardian.child_user_id = p_user_id
      AND guardian.status = 'verified'
      AND guardian.verified_at IS NOT NULL
      AND guardian.verified_at <= v_now
      AND guardian.expires_at IS NOT NULL
      AND guardian.expires_at > v_now
      AND guardian.withdrawn_at IS NULL
    ORDER BY guardian.updated_at DESC, guardian.id DESC
    LIMIT 1;
    IF v_guardian_id IS NULL THEN
      RETURN QUERY SELECT false, 'guardian_eligibility_required'::text, NULL::uuid, NULL::uuid,
        v_subject_kind, NULL::uuid, v_policy.id, v_policy.content_sha256;
      RETURN;
    END IF;
  ELSIF v_profile.age_band = 'age_14_plus' AND v_profile.status = 'eligible' THEN
    v_subject_kind := 'self';
    v_guardian_id := NULL;
  ELSE
    RETURN QUERY SELECT false, 'privacy_eligibility_required'::text, NULL::uuid, NULL::uuid,
      NULL::text, NULL::uuid, v_policy.id, v_policy.content_sha256;
    RETURN;
  END IF;

  SELECT * INTO v_ordinary
  FROM privacy_retention.privacy_consent_events AS event
  WHERE event.user_id = p_user_id
    AND event.subject_kind = v_subject_kind
    AND event.guardian_verification_id IS NOT DISTINCT FROM v_guardian_id
    AND event.purpose = p_channel || '_marketing'
    AND event.channel = p_channel
    AND event.occurred_at <= v_now
  ORDER BY event.occurred_at DESC, event.id DESC
  LIMIT 1;
  IF NOT FOUND OR v_ordinary.decision IS DISTINCT FROM 'granted' THEN
    RETURN QUERY SELECT false, 'ordinary_consent_missing'::text, NULL::uuid, NULL::uuid,
      v_subject_kind, v_guardian_id, v_policy.id, v_policy.content_sha256;
    RETURN;
  END IF;
  IF v_ordinary.policy_version_id IS DISTINCT FROM v_policy.id
     OR v_ordinary.notice_sha256 IS DISTINCT FROM v_policy.content_sha256 THEN
    RETURN QUERY SELECT false, 'ordinary_consent_stale'::text, NULL::uuid, NULL::uuid,
      v_subject_kind, v_guardian_id, v_policy.id, v_policy.content_sha256;
    RETURN;
  END IF;

  IF p_channel <> 'email'
     AND public.is_marketing_night_window(p_scheduled_at, p_timezone) THEN
    SELECT * INTO v_night
    FROM privacy_retention.privacy_consent_events AS event
    WHERE event.user_id = p_user_id
      AND event.subject_kind = v_subject_kind
      AND event.guardian_verification_id IS NOT DISTINCT FROM v_guardian_id
      AND event.purpose = 'night_marketing'
      AND event.channel = p_channel
      AND event.occurred_at <= v_now
    ORDER BY event.occurred_at DESC, event.id DESC
    LIMIT 1;
    IF NOT FOUND OR v_night.decision IS DISTINCT FROM 'granted' THEN
      RETURN QUERY SELECT false, 'night_consent_missing'::text, NULL::uuid, NULL::uuid,
        v_subject_kind, v_guardian_id, v_policy.id, v_policy.content_sha256;
      RETURN;
    END IF;
    IF v_night.policy_version_id IS DISTINCT FROM v_policy.id
       OR v_night.notice_sha256 IS DISTINCT FROM v_policy.content_sha256 THEN
      RETURN QUERY SELECT false, 'night_consent_stale'::text, NULL::uuid, NULL::uuid,
        v_subject_kind, v_guardian_id, v_policy.id, v_policy.content_sha256;
      RETURN;
    END IF;
  END IF;

  RETURN QUERY SELECT true, 'allowed'::text, v_ordinary.id, v_night.id,
    v_subject_kind, v_guardian_id, v_policy.id, v_policy.content_sha256;
END;
$function$;
ALTER FUNCTION privacy_retention.g014_marketing_permission_evidence(uuid, text, timestamptz, text)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_marketing_permission_evidence(uuid, text, timestamptz, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_marketing_service_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
END;
$function$;
ALTER FUNCTION public.assert_marketing_service_role() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.assert_marketing_service_role() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION privacy_retention.g014_require_active_admin_actor(
  p_actor_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_user_id uuid;
BEGIN
  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'marketing_admin_actor_forbidden' USING ERRCODE = '42501';
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
    RAISE EXCEPTION 'marketing_admin_actor_forbidden' USING ERRCODE = '42501';
  END IF;
END;
$function$;
ALTER FUNCTION privacy_retention.g014_require_active_admin_actor(uuid)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_require_active_admin_actor(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION privacy_retention.g014_require_active_admin_actor(uuid)
  TO privacy_workflow_owner;

CREATE OR REPLACE FUNCTION public.evaluate_notification_marketing_permission(
  p_user_id uuid,
  p_channel text,
  p_scheduled_at timestamptz,
  p_timezone text DEFAULT 'Asia/Seoul'
)
RETURNS TABLE (allowed boolean, reason_code text, consent_event_id uuid, night_consent_event_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  IF p_timezone IS DISTINCT FROM 'Asia/Seoul' THEN
    RAISE EXCEPTION 'marketing_permission_input_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT evidence.allowed,
         evidence.reason_code,
         CASE WHEN evidence.allowed THEN evidence.ordinary_consent_event_id END,
         CASE WHEN evidence.allowed THEN evidence.night_consent_event_id END
  FROM privacy_retention.g014_marketing_permission_evidence(
    p_user_id, p_channel, p_scheduled_at, p_timezone
  ) AS evidence;
END;
$function$;
ALTER FUNCTION public.evaluate_notification_marketing_permission(uuid, text, timestamptz, text)
  OWNER TO privacy_workflow_owner;

CREATE OR REPLACE FUNCTION public.privacy_audit_count_summary_is_safe(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $function$
  SELECT pg_catalog.jsonb_typeof(p_value) = 'object'
    AND NOT EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_each(p_value) AS entry(key, value)
      WHERE entry.key NOT IN (
        'requested', 'created', 'updated', 'suppressed', 'failed', 'eligible',
        'guardianVerified', 'consentEvents', 'requiredConsent', 'retryCount',
        'transportAccepted', 'notificationSuppressedAfterAcceptance'
      )
         OR (
           pg_catalog.jsonb_typeof(entry.value) <> 'boolean'
           AND (
             pg_catalog.jsonb_typeof(entry.value) <> 'number'
             OR (entry.value #>> '{}') !~ '^(0|[1-9][0-9]{0,9})$'
           )
         )
    );
$function$;
CREATE OR REPLACE FUNCTION privacy_retention.g014_marketing_write_audit(
  p_operation_id uuid,
  p_preview_hash text,
  p_status text,
  p_reason_code text,
  p_error_code text,
  p_requested integer,
  p_eligible integer,
  p_suppressed integer,
  p_failed integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_audit_id uuid;
  v_transport_accepted integer := 0;
  v_notification_suppressed_after_acceptance integer := 0;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  SELECT count(*)::integer
    INTO v_transport_accepted
    FROM (
      SELECT DISTINCT accepted.user_id
      FROM privacy_retention.marketing_campaign_provider_attempts AS attempt
      CROSS JOIN LATERAL pg_catalog.unnest(
        COALESCE(attempt.accepted_recipient_ids, ARRAY[]::uuid[])
      ) AS accepted(user_id)
      WHERE attempt.operation_id = p_operation_id
        AND attempt.status = 'accepted'
    ) AS accepted;
  SELECT count(*)::integer
    INTO v_notification_suppressed_after_acceptance
    FROM privacy_retention.marketing_campaign_batch_recipients AS recipient
    WHERE recipient.operation_id = p_operation_id
      AND recipient.notification_eligibility_outcome = 'notification_suppressed_after_acceptance';
  INSERT INTO privacy_retention.privacy_audit_events (
    event_type, actor_user_id, subject_ref_hash, operation_id, correlation_id,
    preview_hash, status, reason_code, error_code, count_summary,
    request_metadata, occurred_at, retention_until
  ) VALUES (
    'g014_marketing_campaign', NULL, NULL, p_operation_id, p_operation_id,
    p_preview_hash, p_status, p_reason_code, p_error_code,
    pg_catalog.jsonb_build_object(
      'requested', pg_catalog.greatest(COALESCE(p_requested, 0), 0),
      'eligible', pg_catalog.greatest(COALESCE(p_eligible, 0), 0),
      'suppressed', pg_catalog.greatest(COALESCE(p_suppressed, 0), 0),
      'failed', pg_catalog.greatest(COALESCE(p_failed, 0), 0),
      'transportAccepted', pg_catalog.greatest(COALESCE(v_transport_accepted, 0), 0),
      'notificationSuppressedAfterAcceptance',
        pg_catalog.greatest(COALESCE(v_notification_suppressed_after_acceptance, 0), 0)
    ),
    pg_catalog.jsonb_build_object('route', '/api/admin/marketing-campaigns'),
    v_now,
    public.privacy_resolve_audit_retention_until('privacy_marketing_audit', v_now)
  ) RETURNING id INTO v_audit_id;
  RETURN v_audit_id;
END;
$function$;
ALTER FUNCTION privacy_retention.g014_marketing_write_audit(uuid, text, text, text, text, integer, integer, integer, integer)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_marketing_write_audit(uuid, text, text, text, text, integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.marketing_campaign_receipt(p_operation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.marketing_campaign_operations%ROWTYPE;
  v_requested integer := 0;
  v_sent integer := 0;
  v_suppressed integer := 0;
  v_failed integer := 0;
  v_unresolved integer := 0;
  v_rows integer := 0;
  v_notification_rows_expected integer := 0;
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  IF p_operation_id IS NULL THEN
    RAISE EXCEPTION 'marketing_operation_required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_operation
  FROM public.marketing_campaign_operations AS operation
  WHERE operation.id = p_operation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'marketing_operation_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*)::integer,
         count(*) FILTER (
           WHERE recipient.status = 'suppressed'
             AND NOT EXISTS (
               SELECT 1
               FROM privacy_retention.marketing_campaign_batch_recipients AS batch_recipient
               WHERE batch_recipient.operation_id = p_operation_id
                 AND batch_recipient.user_id = recipient.user_id
                 AND batch_recipient.provider_accepted_at IS NOT NULL
             )
         )::integer,
         count(*) FILTER (WHERE recipient.status = 'failed')::integer,
         count(*) FILTER (WHERE recipient.status IN ('pending', 'eligible'))::integer
  INTO v_requested, v_suppressed, v_failed, v_unresolved
  FROM public.marketing_campaign_recipients AS recipient
  WHERE recipient.operation_id = p_operation_id;
  SELECT count(*)::integer
    INTO v_sent
    FROM (
      SELECT DISTINCT accepted.user_id
      FROM privacy_retention.marketing_campaign_provider_attempts AS attempt
      CROSS JOIN LATERAL pg_catalog.unnest(
        COALESCE(attempt.accepted_recipient_ids, ARRAY[]::uuid[])
      ) AS accepted(user_id)
      WHERE attempt.operation_id = p_operation_id
        AND attempt.status = 'accepted'
    ) AS accepted;
  SELECT count(*)::integer INTO v_unresolved
  FROM (
    SELECT recipient.user_id
    FROM public.marketing_campaign_recipients AS recipient
    WHERE recipient.operation_id = p_operation_id
      AND recipient.status IN ('pending', 'eligible')
    UNION
    SELECT recipient.user_id
    FROM privacy_retention.marketing_campaign_batch_recipients AS recipient
    WHERE recipient.operation_id = p_operation_id
      AND recipient.status = 'claimed'
  ) AS unresolved;
  SELECT count(*)::integer INTO v_rows
  FROM public.notifications AS notification
  WHERE notification.campaign_operation_id = p_operation_id
    AND notification.classification = 'marketing';
  SELECT count(*)::integer
    INTO v_notification_rows_expected
    FROM privacy_retention.marketing_campaign_batch_recipients AS recipient
    WHERE recipient.operation_id = p_operation_id
      AND recipient.notification_eligibility_outcome = 'notification_created';

  RETURN pg_catalog.jsonb_build_object(
    'operationId', v_operation.id::text,
    'status', v_operation.status,
    'auditId', CASE WHEN v_operation.audit_id IS NULL THEN NULL ELSE v_operation.audit_id::text END,
    'counts', pg_catalog.jsonb_build_object(
      'requested', COALESCE(v_requested, 0),
      'sent', COALESCE(v_sent, 0),
      'suppressed', COALESCE(v_suppressed, 0),
      'failed', COALESCE(v_failed, 0)
    ),
    'readback', pg_catalog.jsonb_build_object(
      'passed', v_operation.status IN ('applied', 'partial', 'failed')
        AND v_unresolved = 0
        AND v_rows = v_notification_rows_expected
        AND v_rows <= COALESCE(v_sent, 0),
      'notificationRows', COALESCE(v_rows, 0)
    )
  );
END;
$function$;
ALTER FUNCTION public.marketing_campaign_receipt(uuid) OWNER TO privacy_workflow_owner;

CREATE OR REPLACE FUNCTION public.preview_marketing_campaign(
  p_actor_user_id uuid,
  p_channel text,
  p_recipient_user_ids uuid[],
  p_title text,
  p_message text,
  p_data jsonb,
  p_preview_hash text,
  p_expires_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation_id uuid := extensions.gen_random_uuid();
  v_requested integer;
  v_audit_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  IF p_actor_user_id IS NULL
     OR p_channel IS NULL
     OR p_channel NOT IN ('email', 'sms', 'push')
     OR p_preview_hash IS NULL
     OR p_preview_hash !~ '^[0-9a-f]{64}$'
     OR p_expires_at IS NULL
     OR p_expires_at <= v_now
     OR p_expires_at > v_now + interval '15 minutes'
     OR p_recipient_user_ids IS NULL
     OR p_title IS NULL
     OR p_message IS NULL THEN
    RAISE EXCEPTION 'marketing_preview_invalid' USING ERRCODE = '22023';
  END IF;
  v_requested := COALESCE(pg_catalog.array_length(p_recipient_user_ids, 1), 0);
  IF v_requested NOT BETWEEN 1 AND 100
     OR (SELECT count(DISTINCT recipient.user_id) FROM pg_catalog.unnest(p_recipient_user_ids) AS recipient(user_id)) <> v_requested THEN
    RAISE EXCEPTION 'marketing_recipient_batch_invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM public.assert_notification_content_safe(p_title, p_message, COALESCE(p_data, '{}'::jsonb));
  PERFORM privacy_retention.g014_require_active_admin_actor(p_actor_user_id);

  INSERT INTO public.marketing_campaign_operations (
    id, actor_user_id, actor_ref_hash, channel, title, message, data, preview_hash, expires_at
  ) VALUES (
    v_operation_id, p_actor_user_id,
    pg_catalog.encode(extensions.digest('marketing-actor:v1:' || p_actor_user_id::text, 'sha256'), 'hex'),
    p_channel, pg_catalog.btrim(p_title), pg_catalog.btrim(p_message), COALESCE(p_data, '{}'::jsonb),
    p_preview_hash, p_expires_at
  );
  INSERT INTO public.marketing_campaign_recipients (operation_id, user_id)
  SELECT v_operation_id, recipient.user_id
  FROM pg_catalog.unnest(p_recipient_user_ids) AS recipient(user_id);
  v_audit_id := privacy_retention.g014_marketing_write_audit(
    v_operation_id, p_preview_hash, 'previewed', 'MARKETING_CAMPAIGN_PREVIEW', NULL,
    v_requested, 0, 0, 0
  );
  UPDATE public.marketing_campaign_operations AS operation
  SET audit_id = v_audit_id, updated_at = v_now
  WHERE operation.id = v_operation_id;

  RETURN pg_catalog.jsonb_build_object(
    'operationId', v_operation_id::text,
    'expiresAt', p_expires_at,
    'requestedCount', v_requested,
    'batchCap', 100
  );
END;
$function$;
ALTER FUNCTION public.preview_marketing_campaign(uuid, text, uuid[], text, text, jsonb, text, timestamptz)
  OWNER TO privacy_workflow_owner;

CREATE OR REPLACE FUNCTION public.prepare_marketing_campaign_batch(
  p_operation_id uuid,
  p_actor_user_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_batch_limit integer DEFAULT 100,
  p_timezone text DEFAULT 'Asia/Seoul'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.marketing_campaign_operations%ROWTYPE;
  v_batch public.marketing_campaign_batches%ROWTYPE;
  v_recipient public.marketing_campaign_recipients%ROWTYPE;
  v_permission record;
  v_batch_id uuid;
  v_requested integer := 0;
  v_eligible integer := 0;
  v_suppressed integer := 0;
  v_pending integer := 0;
  v_audit_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  IF p_operation_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_preview_hash IS NULL
     OR p_preview_hash !~ '^[0-9a-f]{64}$'
     OR p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$'
     OR p_batch_limit IS NULL
     OR p_batch_limit NOT BETWEEN 1 AND 100
     OR p_timezone IS DISTINCT FROM 'Asia/Seoul' THEN
    RAISE EXCEPTION 'marketing_apply_invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM privacy_retention.g014_require_active_admin_actor(p_actor_user_id);

  SELECT * INTO v_operation
  FROM public.marketing_campaign_operations AS operation
  WHERE operation.id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'marketing_operation_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_operation.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v_operation.preview_hash IS DISTINCT FROM p_preview_hash THEN
    RAISE EXCEPTION 'marketing_preview_mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_operation.expires_at <= v_now THEN
    RAISE EXCEPTION 'marketing_preview_expired' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_batch
  FROM public.marketing_campaign_batches AS batch
  WHERE batch.operation_id = p_operation_id
    AND batch.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_batch.status IN ('completed', 'provider_failed') THEN
      RETURN pg_catalog.jsonb_build_object(
        'status', 'completed', 'replayed', true,
        'receipt', public.marketing_campaign_receipt(p_operation_id)
      );
    END IF;
    IF v_batch.status = 'claimed' THEN
      RAISE EXCEPTION 'marketing_provider_outcome_unknown' USING ERRCODE = '55000';
    END IF;
    RETURN pg_catalog.jsonb_build_object(
      'status', 'prepared', 'replayed', true,
      'operationId', p_operation_id::text, 'batchId', v_batch.id::text
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.marketing_campaign_batches AS batch
    WHERE batch.operation_id = p_operation_id
      AND batch.status IN ('prepared', 'claimed')
  ) THEN
    RAISE EXCEPTION 'marketing_operation_batch_active' USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.marketing_campaign_batches (
    operation_id, idempotency_key, status, eligible_count
  ) VALUES (p_operation_id, p_idempotency_key, 'prepared', 0)
  RETURNING id INTO v_batch_id;

  FOR v_recipient IN
    SELECT *
    FROM public.marketing_campaign_recipients AS recipient
    WHERE recipient.operation_id = p_operation_id
      AND recipient.status = 'pending'
    ORDER BY recipient.user_id
    LIMIT p_batch_limit
    FOR UPDATE
  LOOP
    SELECT * INTO v_permission
    FROM privacy_retention.g014_marketing_permission_evidence(
      v_recipient.user_id, v_operation.channel, v_now, p_timezone
    );
    IF v_permission.allowed IS TRUE THEN
      UPDATE public.marketing_campaign_recipients AS recipient
      SET status = 'eligible',
          consent_event_id = v_permission.ordinary_consent_event_id,
          night_consent_event_id = v_permission.night_consent_event_id,
          updated_at = v_now
      WHERE recipient.operation_id = p_operation_id
        AND recipient.user_id = v_recipient.user_id;
      INSERT INTO privacy_retention.marketing_campaign_batch_recipients (
        batch_id, operation_id, user_id, status,
        ordinary_consent_event_id, ordinary_subject_kind, ordinary_guardian_verification_id,
        ordinary_purpose, ordinary_channel, ordinary_decision, ordinary_policy_version_id, ordinary_notice_sha256,
        night_consent_event_id, night_subject_kind, night_guardian_verification_id,
        night_purpose, night_channel, night_decision, night_policy_version_id, night_notice_sha256
      ) VALUES (
        v_batch_id, p_operation_id, v_recipient.user_id, 'eligible',
        v_permission.ordinary_consent_event_id, v_permission.subject_kind, v_permission.guardian_verification_id,
        v_operation.channel || '_marketing', v_operation.channel, 'granted', v_permission.policy_version_id, v_permission.policy_content_sha256,
        v_permission.night_consent_event_id,
        CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE v_permission.subject_kind END,
        CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE v_permission.guardian_verification_id END,
        CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE 'night_marketing' END,
        CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE v_operation.channel END,
        CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE 'granted' END,
        CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE v_permission.policy_version_id END,
        CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE v_permission.policy_content_sha256 END
      );
      v_eligible := v_eligible + 1;
    ELSE
      UPDATE public.marketing_campaign_recipients AS recipient
      SET status = 'suppressed', consent_event_id = NULL, night_consent_event_id = NULL, updated_at = v_now
      WHERE recipient.operation_id = p_operation_id
        AND recipient.user_id = v_recipient.user_id;
      INSERT INTO privacy_retention.marketing_campaign_batch_recipients (
        batch_id, operation_id, user_id, status
      ) VALUES (v_batch_id, p_operation_id, v_recipient.user_id, 'suppressed');
      v_suppressed := v_suppressed + 1;
    END IF;
  END LOOP;

  SELECT count(*)::integer INTO v_requested
  FROM public.marketing_campaign_recipients AS recipient
  WHERE recipient.operation_id = p_operation_id;
  SELECT count(*)::integer INTO v_pending
  FROM public.marketing_campaign_recipients AS recipient
  WHERE recipient.operation_id = p_operation_id
    AND recipient.status IN ('pending', 'eligible');

  IF v_eligible = 0 THEN
    UPDATE public.marketing_campaign_batches AS batch
    SET status = 'completed', completed_at = v_now
    WHERE batch.id = v_batch_id;
    IF v_pending = 0 THEN
      v_audit_id := privacy_retention.g014_marketing_write_audit(
        p_operation_id, p_preview_hash, 'applied', 'MARKETING_CAMPAIGN_SUPPRESSED', NULL,
        v_requested, 0, v_suppressed, 0
      );
      UPDATE public.marketing_campaign_operations AS operation
      SET status = 'applied', audit_id = v_audit_id, updated_at = v_now
      WHERE operation.id = p_operation_id;
      RETURN pg_catalog.jsonb_build_object(
        'status', 'completed', 'replayed', false,
        'receipt', public.marketing_campaign_receipt(p_operation_id)
      );
    END IF;
    v_audit_id := privacy_retention.g014_marketing_write_audit(
      p_operation_id, p_preview_hash, 'confirmed', 'MARKETING_BATCH_SUPPRESSED', NULL,
      v_requested, 0, v_suppressed, 0
    );
    UPDATE public.marketing_campaign_operations AS operation
    SET status = 'applying', audit_id = v_audit_id, updated_at = v_now
    WHERE operation.id = p_operation_id;
    RETURN pg_catalog.jsonb_build_object(
      'status', 'suppressed', 'operationId', p_operation_id::text, 'batchId', v_batch_id::text,
      'remainingRecipients', v_pending
    );
  END IF;

  UPDATE public.marketing_campaign_batches AS batch
  SET eligible_count = v_eligible
  WHERE batch.id = v_batch_id;
  v_audit_id := privacy_retention.g014_marketing_write_audit(
    p_operation_id, p_preview_hash, 'confirmed', 'MARKETING_CAMPAIGN_CONFIRMED', NULL,
    v_requested, v_eligible, v_suppressed, 0
  );
  UPDATE public.marketing_campaign_operations AS operation
  SET status = 'applying', audit_id = v_audit_id, updated_at = v_now
  WHERE operation.id = p_operation_id;
  RETURN pg_catalog.jsonb_build_object(
    'status', 'prepared', 'replayed', false,
    'operationId', p_operation_id::text, 'batchId', v_batch_id::text
  );
END;
$function$;
ALTER FUNCTION public.prepare_marketing_campaign_batch(uuid, uuid, text, text, integer, text)
  OWNER TO privacy_workflow_owner;

CREATE OR REPLACE FUNCTION public.claim_marketing_campaign_dispatch(
  p_operation_id uuid,
  p_batch_id uuid,
  p_actor_user_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_timezone text DEFAULT 'Asia/Seoul'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.marketing_campaign_operations%ROWTYPE;
  v_batch public.marketing_campaign_batches%ROWTYPE;
  v_recipient privacy_retention.marketing_campaign_batch_recipients%ROWTYPE;
  v_permission record;
  v_claim_token uuid := extensions.gen_random_uuid();
  v_attempt_id uuid := extensions.gen_random_uuid();
  v_payload jsonb;
  v_payload_digest text;
  v_claimed integer := 0;
  v_suppressed integer := 0;
  v_requested integer := 0;
  v_pending integer := 0;
  v_audit_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  IF p_operation_id IS NULL
     OR p_batch_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_preview_hash IS NULL
     OR p_preview_hash !~ '^[0-9a-f]{64}$'
     OR p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9_-]{8,128}$'
     OR p_timezone IS DISTINCT FROM 'Asia/Seoul' THEN
    RAISE EXCEPTION 'marketing_claim_invalid' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_operation
  FROM public.marketing_campaign_operations AS operation
  WHERE operation.id = p_operation_id
  FOR UPDATE;
  SELECT * INTO v_batch
  FROM public.marketing_campaign_batches AS batch
  WHERE batch.id = p_batch_id
    AND batch.operation_id = p_operation_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_operation.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v_operation.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_batch.idempotency_key IS DISTINCT FROM p_idempotency_key THEN
    RAISE EXCEPTION 'marketing_batch_not_found' USING ERRCODE = '42501';
  END IF;
  IF v_operation.expires_at <= v_now THEN
    RAISE EXCEPTION 'marketing_preview_expired' USING ERRCODE = '22023';
  END IF;
  IF v_batch.status = 'completed' THEN
    RETURN pg_catalog.jsonb_build_object('status', 'completed', 'receipt', public.marketing_campaign_receipt(p_operation_id));
  END IF;
  IF v_batch.status IS DISTINCT FROM 'prepared' THEN
    RAISE EXCEPTION 'marketing_provider_outcome_unknown' USING ERRCODE = '55000';
  END IF;

  FOR v_recipient IN
    SELECT *
    FROM privacy_retention.marketing_campaign_batch_recipients AS recipient
    WHERE recipient.batch_id = p_batch_id
      AND recipient.operation_id = p_operation_id
      AND recipient.status = 'eligible'
    ORDER BY recipient.user_id
    FOR UPDATE
  LOOP
    SELECT * INTO v_permission
    FROM privacy_retention.g014_marketing_permission_evidence(
      v_recipient.user_id, v_operation.channel, v_now, p_timezone
    );
    IF v_permission.allowed IS TRUE THEN
      UPDATE privacy_retention.marketing_campaign_batch_recipients AS recipient
      SET status = 'claimed',
          ordinary_consent_event_id = v_permission.ordinary_consent_event_id,
          ordinary_subject_kind = v_permission.subject_kind,
          ordinary_guardian_verification_id = v_permission.guardian_verification_id,
          ordinary_purpose = v_operation.channel || '_marketing',
          ordinary_channel = v_operation.channel,
          ordinary_decision = 'granted',
          ordinary_policy_version_id = v_permission.policy_version_id,
          ordinary_notice_sha256 = v_permission.policy_content_sha256,
          night_consent_event_id = v_permission.night_consent_event_id,
          night_subject_kind = CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE v_permission.subject_kind END,
          night_guardian_verification_id = CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE v_permission.guardian_verification_id END,
          night_purpose = CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE 'night_marketing' END,
          night_channel = CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE v_operation.channel END,
          night_decision = CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE 'granted' END,
          night_policy_version_id = CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE v_permission.policy_version_id END,
          night_notice_sha256 = CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE v_permission.policy_content_sha256 END,
          claim_token = v_claim_token,
          claimed_at = v_now
      WHERE recipient.batch_id = p_batch_id AND recipient.user_id = v_recipient.user_id;
      INSERT INTO privacy_retention.marketing_campaign_consent_evidence_keys (
        batch_id, operation_id, user_id, evidence_kind, consent_event_id, subject_kind,
        guardian_verification_id, purpose, channel, decision, policy_version_id, notice_sha256
      ) VALUES (
        p_batch_id, p_operation_id, v_recipient.user_id, 'claim_ordinary',
        v_permission.ordinary_consent_event_id, v_permission.subject_kind,
        v_permission.guardian_verification_id, v_operation.channel || '_marketing',
        v_operation.channel, 'granted', v_permission.policy_version_id, v_permission.policy_content_sha256
      );
      IF v_permission.night_consent_event_id IS NOT NULL THEN
        INSERT INTO privacy_retention.marketing_campaign_consent_evidence_keys (
          batch_id, operation_id, user_id, evidence_kind, consent_event_id, subject_kind,
          guardian_verification_id, purpose, channel, decision, policy_version_id, notice_sha256
        ) VALUES (
          p_batch_id, p_operation_id, v_recipient.user_id, 'claim_night',
          v_permission.night_consent_event_id, v_permission.subject_kind,
          v_permission.guardian_verification_id, 'night_marketing',
          v_operation.channel, 'granted', v_permission.policy_version_id, v_permission.policy_content_sha256
        );
      END IF;
      UPDATE public.marketing_campaign_recipients AS recipient
      SET consent_event_id = v_permission.ordinary_consent_event_id,
          night_consent_event_id = v_permission.night_consent_event_id,
          updated_at = v_now
      WHERE recipient.operation_id = p_operation_id AND recipient.user_id = v_recipient.user_id;
      v_claimed := v_claimed + 1;
    ELSE
      UPDATE privacy_retention.marketing_campaign_batch_recipients AS recipient
      SET status = 'suppressed', finalized_at = v_now
      WHERE recipient.batch_id = p_batch_id AND recipient.user_id = v_recipient.user_id;
      UPDATE public.marketing_campaign_recipients AS recipient
      SET status = 'suppressed', consent_event_id = NULL, night_consent_event_id = NULL, updated_at = v_now
      WHERE recipient.operation_id = p_operation_id AND recipient.user_id = v_recipient.user_id;
      v_suppressed := v_suppressed + 1;
    END IF;
  END LOOP;

  SELECT count(*)::integer INTO v_requested
  FROM public.marketing_campaign_recipients AS recipient
  WHERE recipient.operation_id = p_operation_id;
  SELECT count(*)::integer INTO v_pending
  FROM public.marketing_campaign_recipients AS recipient
  WHERE recipient.operation_id = p_operation_id
    AND recipient.status IN ('pending', 'eligible');

  IF v_claimed = 0 THEN
    PERFORM privacy_retention.g014_require_active_admin_actor(p_actor_user_id);
    UPDATE public.marketing_campaign_batches AS batch
    SET status = 'completed', completed_at = v_now
    WHERE batch.id = p_batch_id;
    IF v_pending = 0 THEN
      v_audit_id := privacy_retention.g014_marketing_write_audit(
        p_operation_id, p_preview_hash, 'applied', 'MARKETING_CLAIM_SUPPRESSED', NULL,
        v_requested, 0, v_suppressed, 0
      );
      UPDATE public.marketing_campaign_operations AS operation
      SET status = 'applied', audit_id = v_audit_id, updated_at = v_now
      WHERE operation.id = p_operation_id;
      RETURN pg_catalog.jsonb_build_object('status', 'completed', 'receipt', public.marketing_campaign_receipt(p_operation_id));
    END IF;
    RETURN pg_catalog.jsonb_build_object('status', 'suppressed', 'operationId', p_operation_id::text, 'batchId', p_batch_id::text);
  END IF;

  SELECT pg_catalog.jsonb_build_object(
    'operationId', p_operation_id::text,
    'batchId', p_batch_id::text,
    'claimToken', v_claim_token::text,
    'providerAttemptId', v_attempt_id::text,
    'idempotencyKey', v_batch.idempotency_key,
    'channel', v_operation.channel,
    'title', v_operation.title,
    'message', v_operation.message,
    'data', v_operation.data,
    'recipientUserIds', pg_catalog.jsonb_agg(recipient.user_id::text ORDER BY recipient.user_id)
  ) INTO v_payload
  FROM privacy_retention.marketing_campaign_batch_recipients AS recipient
  WHERE recipient.batch_id = p_batch_id
    AND recipient.operation_id = p_operation_id
    AND recipient.status = 'claimed'
    AND recipient.claim_token = v_claim_token;
  v_payload_digest := pg_catalog.encode(extensions.digest(v_payload::text, 'sha256'), 'hex');
  -- This second authority check is intentionally adjacent to the durable unknown
  -- attempt. Its row locks fence admin-role/account revocation through egress.
  PERFORM privacy_retention.g014_require_active_admin_actor(p_actor_user_id);
  INSERT INTO privacy_retention.marketing_campaign_provider_attempts (
    id, operation_id, batch_id, claim_token, provider_identity, idempotency_key,
    payload_digest, status
  ) VALUES (
    v_attempt_id, p_operation_id, p_batch_id, v_claim_token, 'g014_https_provider_v1',
    v_batch.idempotency_key, v_payload_digest, 'unknown'
  );
  UPDATE public.marketing_campaign_batches AS batch
  SET status = 'claimed', claim_token = v_claim_token, claimed_at = v_now
  WHERE batch.id = p_batch_id;
  v_audit_id := privacy_retention.g014_marketing_write_audit(
    p_operation_id, p_preview_hash, 'confirmed', 'MARKETING_DISPATCH_CLAIMED', NULL,
    v_requested, v_claimed, v_suppressed, 0
  );
  UPDATE public.marketing_campaign_operations AS operation
  SET status = 'applying', audit_id = v_audit_id, updated_at = v_now
  WHERE operation.id = p_operation_id;

  RETURN pg_catalog.jsonb_build_object(
    'status', 'claimed',
    'operationId', p_operation_id::text,
    'batchId', p_batch_id::text,
    'claimToken', v_claim_token::text,
    'providerAttemptId', v_attempt_id::text,
    'providerIdentity', 'g014_https_provider_v1',
    'idempotencyKey', v_batch.idempotency_key,
    'payloadDigest', v_payload_digest,
    'payload', v_payload
  );
END;
$function$;
ALTER FUNCTION public.claim_marketing_campaign_dispatch(uuid, uuid, uuid, text, text, text)
  OWNER TO privacy_workflow_owner;

CREATE OR REPLACE FUNCTION public.fail_marketing_campaign_batch(
  p_operation_id uuid,
  p_batch_id uuid,
  p_actor_user_id uuid,
  p_preview_hash text,
  p_error_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.marketing_campaign_operations%ROWTYPE;
  v_batch public.marketing_campaign_batches%ROWTYPE;
  v_requested integer := 0;
  v_suppressed integer := 0;
  v_failed integer := 0;
  v_pending integer := 0;
  v_audit_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  IF p_operation_id IS NULL
     OR p_batch_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_preview_hash IS NULL
     OR p_preview_hash !~ '^[0-9a-f]{64}$'
     OR p_error_code IS NULL
     OR p_error_code NOT IN ('provider_unavailable', 'provider_request_failed', 'provider_response_invalid') THEN
    RAISE EXCEPTION 'marketing_provider_error_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_operation FROM public.marketing_campaign_operations AS operation
  WHERE operation.id = p_operation_id FOR UPDATE;
  SELECT * INTO v_batch FROM public.marketing_campaign_batches AS batch
  WHERE batch.id = p_batch_id AND batch.operation_id = p_operation_id FOR UPDATE;
  IF NOT FOUND
     OR v_operation.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v_operation.preview_hash IS DISTINCT FROM p_preview_hash THEN
    RAISE EXCEPTION 'marketing_batch_not_found' USING ERRCODE = '42501';
  END IF;
  -- A claimed row has a durable unknown egress attempt. It must be reconciled,
  -- never converted to failed merely because a caller retried or timed out.
  IF v_batch.status IS DISTINCT FROM 'prepared' THEN
    RAISE EXCEPTION 'marketing_provider_outcome_unknown' USING ERRCODE = '55000';
  END IF;

  UPDATE privacy_retention.marketing_campaign_batch_recipients AS recipient
  SET status = 'failed', finalized_at = v_now
  WHERE recipient.batch_id = p_batch_id AND recipient.operation_id = p_operation_id
    AND recipient.status = 'eligible';
  UPDATE public.marketing_campaign_recipients AS recipient
  SET status = 'failed', updated_at = v_now
  WHERE recipient.operation_id = p_operation_id AND recipient.status = 'eligible';
  UPDATE public.marketing_campaign_batches AS batch
  SET status = 'provider_failed', completed_at = v_now
  WHERE batch.id = p_batch_id;

  SELECT count(*)::integer,
         count(*) FILTER (WHERE recipient.status = 'suppressed')::integer,
         count(*) FILTER (WHERE recipient.status = 'failed')::integer,
         count(*) FILTER (WHERE recipient.status IN ('pending', 'eligible'))::integer
  INTO v_requested, v_suppressed, v_failed, v_pending
  FROM public.marketing_campaign_recipients AS recipient
  WHERE recipient.operation_id = p_operation_id;
  IF v_pending = 0 THEN
    v_audit_id := privacy_retention.g014_marketing_write_audit(
      p_operation_id, p_preview_hash, 'failed', 'MARKETING_CAMPAIGN_PROVIDER_FAILED',
      pg_catalog.upper(p_error_code), v_requested, 0, v_suppressed, v_failed
    );
    UPDATE public.marketing_campaign_operations AS operation
    SET status = 'failed', audit_id = v_audit_id, updated_at = v_now
    WHERE operation.id = p_operation_id;
  END IF;
  RETURN public.marketing_campaign_receipt(p_operation_id);
END;
$function$;
ALTER FUNCTION public.fail_marketing_campaign_batch(uuid, uuid, uuid, text, text)
  OWNER TO privacy_workflow_owner;

-- The G010 signature remains present for callers that resolve it, but it cannot
-- finalize without the G014 claim token, attempt identity, and receipt binding.
CREATE OR REPLACE FUNCTION public.finalize_marketing_campaign_batch(
  p_operation_id uuid,
  p_batch_id uuid,
  p_actor_user_id uuid,
  p_preview_hash text,
  p_accepted_user_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  RAISE EXCEPTION 'marketing_claim_token_required' USING ERRCODE = '42501';
END;
$function$;
ALTER FUNCTION public.finalize_marketing_campaign_batch(uuid, uuid, uuid, text, uuid[])
  OWNER TO privacy_workflow_owner;

CREATE OR REPLACE FUNCTION public.finalize_marketing_campaign_batch(
  p_operation_id uuid,
  p_batch_id uuid,
  p_actor_user_id uuid,
  p_preview_hash text,
  p_claim_token uuid,
  p_provider_attempt_id uuid,
  p_provider_receipt_id text,
  p_provider_receipt_hash text,
  p_provider_payload_digest text,
  p_accepted_user_ids uuid[],
  p_timezone text DEFAULT 'Asia/Seoul'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.marketing_campaign_operations%ROWTYPE;
  v_batch public.marketing_campaign_batches%ROWTYPE;
  v_attempt privacy_retention.marketing_campaign_provider_attempts%ROWTYPE;
  v_recipient privacy_retention.marketing_campaign_batch_recipients%ROWTYPE;
  v_permission record;
  v_accepted_user_ids uuid[];
  v_accepted_recipient_digest text;
  v_requested integer := 0;
  v_sent integer := 0;
  v_suppressed integer := 0;
  v_failed integer := 0;
  v_unresolved integer := 0;
  v_status text;
  v_audit_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  IF p_operation_id IS NULL
     OR p_batch_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_preview_hash IS NULL
     OR p_preview_hash !~ '^[0-9a-f]{64}$'
     OR p_claim_token IS NULL
     OR p_provider_attempt_id IS NULL
     OR p_provider_receipt_id IS NULL
     OR p_provider_receipt_id !~ '^[A-Za-z0-9._:-]{1,256}$'
     OR p_provider_receipt_hash IS NULL
     OR p_provider_receipt_hash !~ '^[0-9a-f]{64}$'
     OR p_provider_payload_digest IS NULL
     OR p_provider_payload_digest !~ '^[0-9a-f]{64}$'
     OR p_accepted_user_ids IS NULL
     OR pg_catalog.array_length(p_accepted_user_ids, 1) > 100
     OR pg_catalog.array_position(p_accepted_user_ids, NULL) IS NOT NULL
     OR (SELECT count(DISTINCT accepted.user_id) FROM pg_catalog.unnest(p_accepted_user_ids) AS accepted(user_id))
        IS DISTINCT FROM COALESCE(pg_catalog.array_length(p_accepted_user_ids, 1), 0)
     OR p_timezone IS DISTINCT FROM 'Asia/Seoul' THEN
    RAISE EXCEPTION 'marketing_provider_result_invalid' USING ERRCODE = '22023';
  END IF;
  v_accepted_user_ids := privacy_retention.g014_marketing_canonical_recipient_ids(p_accepted_user_ids);
  v_accepted_recipient_digest := privacy_retention.g014_marketing_accepted_recipient_digest(v_accepted_user_ids);

  SELECT * INTO v_operation FROM public.marketing_campaign_operations AS operation
  WHERE operation.id = p_operation_id FOR UPDATE;
  SELECT * INTO v_batch FROM public.marketing_campaign_batches AS batch
  WHERE batch.id = p_batch_id AND batch.operation_id = p_operation_id FOR UPDATE;
  SELECT * INTO v_attempt FROM privacy_retention.marketing_campaign_provider_attempts AS attempt
  WHERE attempt.id = p_provider_attempt_id FOR UPDATE;
  IF NOT FOUND
     OR v_operation.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v_operation.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_batch.claim_token IS DISTINCT FROM p_claim_token
     OR v_attempt.operation_id IS DISTINCT FROM p_operation_id
     OR v_attempt.batch_id IS DISTINCT FROM p_batch_id
     OR v_attempt.claim_token IS DISTINCT FROM p_claim_token
     OR v_attempt.provider_identity IS DISTINCT FROM 'g014_https_provider_v1'
     OR v_attempt.payload_digest IS DISTINCT FROM p_provider_payload_digest THEN
    RAISE EXCEPTION 'marketing_claim_binding_mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_attempt.status = 'accepted'
     AND v_batch.status = 'completed' THEN
    IF v_attempt.provider_receipt_id IS NOT DISTINCT FROM p_provider_receipt_id
       AND v_attempt.provider_receipt_hash IS NOT DISTINCT FROM p_provider_receipt_hash
       AND v_attempt.payload_digest IS NOT DISTINCT FROM p_provider_payload_digest
       AND v_attempt.accepted_recipient_ids IS NOT DISTINCT FROM v_accepted_user_ids
       AND v_attempt.accepted_recipient_digest IS NOT DISTINCT FROM v_accepted_recipient_digest THEN
      RETURN public.marketing_campaign_receipt(p_operation_id);
    END IF;
    RAISE EXCEPTION 'marketing_provider_result_binding_mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_batch.status IS DISTINCT FROM 'claimed'
     OR v_attempt.status IS DISTINCT FROM 'unknown' THEN
    RAISE EXCEPTION 'marketing_provider_outcome_unknown' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.unnest(v_accepted_user_ids) AS accepted(user_id)
    WHERE NOT EXISTS (
      SELECT 1
      FROM privacy_retention.marketing_campaign_batch_recipients AS recipient
      WHERE recipient.batch_id = p_batch_id
        AND recipient.operation_id = p_operation_id
        AND recipient.user_id = accepted.user_id
        AND recipient.status = 'claimed'
        AND recipient.claim_token = p_claim_token
    )
  ) THEN
    RAISE EXCEPTION 'marketing_provider_result_invalid' USING ERRCODE = '22023';
  END IF;
  -- Provider acceptance is durable external transport truth before any mutable
  -- in-app eligibility cleanup is evaluated.
  UPDATE privacy_retention.marketing_campaign_provider_attempts AS attempt
  SET status = 'accepted',
      provider_receipt_id = p_provider_receipt_id,
      provider_receipt_hash = p_provider_receipt_hash,
      accepted_recipient_ids = v_accepted_user_ids,
      accepted_recipient_digest = v_accepted_recipient_digest,
      outcome_recorded_at = v_now
  WHERE attempt.id = p_provider_attempt_id;

  -- Revalidate only the in-app artifact immediately before creation. A later
  -- withdrawal suppresses that artifact without rewriting provider acceptance.
  FOR v_recipient IN
    SELECT *
    FROM privacy_retention.marketing_campaign_batch_recipients AS recipient
    WHERE recipient.batch_id = p_batch_id
      AND recipient.operation_id = p_operation_id
      AND recipient.status = 'claimed'
      AND recipient.claim_token = p_claim_token
    ORDER BY recipient.user_id
    FOR UPDATE
  LOOP
    SELECT * INTO v_permission
    FROM privacy_retention.g014_marketing_permission_evidence(
      v_recipient.user_id, v_operation.channel, v_now, p_timezone
    );
    IF v_permission.allowed IS TRUE
       AND v_recipient.user_id = ANY (v_accepted_user_ids) THEN
      INSERT INTO public.notifications (
        user_id, type, title, message, data, classification, channel,
        consent_event_id, retention_class, campaign_operation_id, delivered_at
      ) VALUES (
        v_recipient.user_id, 'marketing_campaign', v_operation.title, v_operation.message,
        v_operation.data, 'marketing', v_operation.channel, v_permission.ordinary_consent_event_id,
        'notifications_operational', p_operation_id, v_now
      ) ON CONFLICT (campaign_operation_id, user_id)
        WHERE campaign_operation_id IS NOT NULL DO NOTHING;
      UPDATE privacy_retention.marketing_campaign_batch_recipients AS recipient
      SET status = 'sent',
          provider_accepted_at = v_now,
          notification_eligibility_outcome = 'notification_created',
          ordinary_consent_event_id = v_permission.ordinary_consent_event_id,
          ordinary_subject_kind = v_permission.subject_kind,
          ordinary_guardian_verification_id = v_permission.guardian_verification_id,
          ordinary_purpose = v_operation.channel || '_marketing',
          ordinary_channel = v_operation.channel,
          ordinary_decision = 'granted',
          ordinary_policy_version_id = v_permission.policy_version_id,
          ordinary_notice_sha256 = v_permission.policy_content_sha256,
          night_consent_event_id = v_permission.night_consent_event_id,
          night_subject_kind = CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE v_permission.subject_kind END,
          night_guardian_verification_id = CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE v_permission.guardian_verification_id END,
          night_purpose = CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE 'night_marketing' END,
          night_channel = CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE v_operation.channel END,
          night_decision = CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE 'granted' END,
          night_policy_version_id = CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE v_permission.policy_version_id END,
          night_notice_sha256 = CASE WHEN v_permission.night_consent_event_id IS NULL THEN NULL ELSE v_permission.policy_content_sha256 END,
          finalized_at = v_now,
          provider_receipt_id = p_provider_receipt_id,
          provider_receipt_hash = p_provider_receipt_hash
      WHERE recipient.batch_id = p_batch_id AND recipient.user_id = v_recipient.user_id;
      INSERT INTO privacy_retention.marketing_campaign_consent_evidence_keys (
        batch_id, operation_id, user_id, evidence_kind, consent_event_id, subject_kind,
        guardian_verification_id, purpose, channel, decision, policy_version_id, notice_sha256
      ) VALUES (
        p_batch_id, p_operation_id, v_recipient.user_id, 'finalize_ordinary',
        v_permission.ordinary_consent_event_id, v_permission.subject_kind,
        v_permission.guardian_verification_id, v_operation.channel || '_marketing',
        v_operation.channel, 'granted', v_permission.policy_version_id, v_permission.policy_content_sha256
      );
      IF v_permission.night_consent_event_id IS NOT NULL THEN
        INSERT INTO privacy_retention.marketing_campaign_consent_evidence_keys (
          batch_id, operation_id, user_id, evidence_kind, consent_event_id, subject_kind,
          guardian_verification_id, purpose, channel, decision, policy_version_id, notice_sha256
        ) VALUES (
          p_batch_id, p_operation_id, v_recipient.user_id, 'finalize_night',
          v_permission.night_consent_event_id, v_permission.subject_kind,
          v_permission.guardian_verification_id, 'night_marketing',
          v_operation.channel, 'granted', v_permission.policy_version_id, v_permission.policy_content_sha256
        );
      END IF;
      UPDATE public.marketing_campaign_recipients AS recipient
      SET status = 'sent', consent_event_id = v_permission.ordinary_consent_event_id,
          night_consent_event_id = v_permission.night_consent_event_id, updated_at = v_now
      WHERE recipient.operation_id = p_operation_id AND recipient.user_id = v_recipient.user_id;
    ELSIF v_recipient.user_id = ANY (v_accepted_user_ids) THEN
      DELETE FROM public.notifications AS notification
      WHERE notification.campaign_operation_id = p_operation_id
        AND notification.user_id = v_recipient.user_id
        AND notification.classification = 'marketing';
      UPDATE privacy_retention.marketing_campaign_batch_recipients AS recipient
      SET status = 'suppressed',
          provider_accepted_at = v_now,
          notification_eligibility_outcome = 'notification_suppressed_after_acceptance',
          finalized_at = v_now,
          provider_receipt_id = p_provider_receipt_id,
          provider_receipt_hash = p_provider_receipt_hash
      WHERE recipient.batch_id = p_batch_id AND recipient.user_id = v_recipient.user_id;
      UPDATE public.marketing_campaign_recipients AS recipient
      SET status = 'sent', updated_at = v_now
      WHERE recipient.operation_id = p_operation_id AND recipient.user_id = v_recipient.user_id;
    ELSIF v_permission.allowed IS TRUE THEN
      UPDATE privacy_retention.marketing_campaign_batch_recipients AS recipient
      SET status = 'failed', finalized_at = v_now,
          provider_receipt_id = p_provider_receipt_id, provider_receipt_hash = p_provider_receipt_hash
      WHERE recipient.batch_id = p_batch_id AND recipient.user_id = v_recipient.user_id;
      UPDATE public.marketing_campaign_recipients AS recipient
      SET status = 'failed', updated_at = v_now
      WHERE recipient.operation_id = p_operation_id AND recipient.user_id = v_recipient.user_id;
    ELSE
      UPDATE privacy_retention.marketing_campaign_batch_recipients AS recipient
      SET status = 'suppressed', finalized_at = v_now,
          provider_receipt_id = p_provider_receipt_id, provider_receipt_hash = p_provider_receipt_hash
      WHERE recipient.batch_id = p_batch_id AND recipient.user_id = v_recipient.user_id;
      UPDATE public.marketing_campaign_recipients AS recipient
      SET status = 'suppressed', consent_event_id = NULL, night_consent_event_id = NULL, updated_at = v_now
      WHERE recipient.operation_id = p_operation_id AND recipient.user_id = v_recipient.user_id;
    END IF;
  END LOOP;

  UPDATE public.marketing_campaign_batches AS batch
  SET status = 'completed', completed_at = v_now
  WHERE batch.id = p_batch_id;

  SELECT count(*)::integer,
         count(*) FILTER (
           WHERE recipient.status = 'suppressed'
             AND NOT EXISTS (
               SELECT 1
               FROM privacy_retention.marketing_campaign_batch_recipients AS batch_recipient
               WHERE batch_recipient.operation_id = p_operation_id
                 AND batch_recipient.user_id = recipient.user_id
                 AND batch_recipient.provider_accepted_at IS NOT NULL
             )
         )::integer,
         count(*) FILTER (WHERE recipient.status = 'failed')::integer
  INTO v_requested, v_suppressed, v_failed
  FROM public.marketing_campaign_recipients AS recipient
  WHERE recipient.operation_id = p_operation_id;
  SELECT count(*)::integer
    INTO v_sent
    FROM (
      SELECT DISTINCT accepted.user_id
      FROM privacy_retention.marketing_campaign_provider_attempts AS attempt
      CROSS JOIN LATERAL pg_catalog.unnest(
        COALESCE(attempt.accepted_recipient_ids, ARRAY[]::uuid[])
      ) AS accepted(user_id)
      WHERE attempt.operation_id = p_operation_id
        AND attempt.status = 'accepted'
    ) AS accepted;
  SELECT count(*)::integer INTO v_unresolved
  FROM (
    SELECT recipient.user_id FROM public.marketing_campaign_recipients AS recipient
    WHERE recipient.operation_id = p_operation_id AND recipient.status IN ('pending', 'eligible')
    UNION
    SELECT recipient.user_id FROM privacy_retention.marketing_campaign_batch_recipients AS recipient
    WHERE recipient.operation_id = p_operation_id AND recipient.status = 'claimed'
  ) AS unresolved;

  IF v_unresolved = 0 THEN
    v_status := CASE WHEN v_failed = 0 THEN 'applied' ELSE 'partial' END;
    v_audit_id := privacy_retention.g014_marketing_write_audit(
      p_operation_id, p_preview_hash, v_status,
      CASE WHEN v_status = 'applied' THEN 'MARKETING_CAMPAIGN_APPLIED' ELSE 'MARKETING_CAMPAIGN_PARTIAL' END,
      NULL, v_requested, v_sent, v_suppressed, v_failed
    );
    UPDATE public.marketing_campaign_operations AS operation
    SET status = v_status, audit_id = v_audit_id, updated_at = v_now
    WHERE operation.id = p_operation_id;
  ELSE
    v_audit_id := privacy_retention.g014_marketing_write_audit(
      p_operation_id, p_preview_hash, 'confirmed', 'MARKETING_BATCH_FINALIZED', NULL,
      v_requested, v_sent, v_suppressed, v_failed
    );
    UPDATE public.marketing_campaign_operations AS operation
    SET status = 'applying', audit_id = v_audit_id, updated_at = v_now
    WHERE operation.id = p_operation_id;
  END IF;
  RETURN public.marketing_campaign_receipt(p_operation_id);
END;
$function$;
ALTER FUNCTION public.finalize_marketing_campaign_batch(uuid, uuid, uuid, text, uuid, uuid, text, text, text, uuid[], text)
  OWNER TO privacy_workflow_owner;

-- A provider may explicitly reject a request while echoing the same stable
-- attempt/idempotency/receipt binding. Only that known outcome can become failed;
-- transport failures and malformed responses remain unknown and unretryable.
CREATE OR REPLACE FUNCTION public.fail_marketing_campaign_provider_attempt(
  p_operation_id uuid,
  p_batch_id uuid,
  p_actor_user_id uuid,
  p_preview_hash text,
  p_claim_token uuid,
  p_provider_attempt_id uuid,
  p_provider_receipt_id text,
  p_provider_receipt_hash text,
  p_provider_payload_digest text,
  p_error_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_operation public.marketing_campaign_operations%ROWTYPE;
  v_batch public.marketing_campaign_batches%ROWTYPE;
  v_attempt privacy_retention.marketing_campaign_provider_attempts%ROWTYPE;
  v_requested integer := 0;
  v_suppressed integer := 0;
  v_failed integer := 0;
  v_unresolved integer := 0;
  v_audit_id uuid;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  IF p_operation_id IS NULL
     OR p_batch_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_preview_hash IS NULL
     OR p_preview_hash !~ '^[0-9a-f]{64}$'
     OR p_claim_token IS NULL
     OR p_provider_attempt_id IS NULL
     OR p_provider_receipt_id IS NULL
     OR p_provider_receipt_id !~ '^[A-Za-z0-9._:-]{1,256}$'
     OR p_provider_receipt_hash IS NULL
     OR p_provider_receipt_hash !~ '^[0-9a-f]{64}$'
     OR p_provider_payload_digest IS NULL
     OR p_provider_payload_digest !~ '^[0-9a-f]{64}$'
     OR p_error_code IS NULL
     OR p_error_code NOT IN ('provider_rejected', 'provider_invalid_request') THEN
    RAISE EXCEPTION 'marketing_provider_result_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_operation FROM public.marketing_campaign_operations AS operation
  WHERE operation.id = p_operation_id FOR UPDATE;
  SELECT * INTO v_batch FROM public.marketing_campaign_batches AS batch
  WHERE batch.id = p_batch_id AND batch.operation_id = p_operation_id FOR UPDATE;
  SELECT * INTO v_attempt FROM privacy_retention.marketing_campaign_provider_attempts AS attempt
  WHERE attempt.id = p_provider_attempt_id FOR UPDATE;
  IF NOT FOUND
     OR v_operation.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v_operation.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_batch.claim_token IS DISTINCT FROM p_claim_token
     OR v_attempt.operation_id IS DISTINCT FROM p_operation_id
     OR v_attempt.batch_id IS DISTINCT FROM p_batch_id
     OR v_attempt.claim_token IS DISTINCT FROM p_claim_token
     OR v_attempt.provider_identity IS DISTINCT FROM 'g014_https_provider_v1'
     OR v_attempt.payload_digest IS DISTINCT FROM p_provider_payload_digest THEN
    RAISE EXCEPTION 'marketing_claim_binding_mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_attempt.status = 'failed'
     AND v_batch.status = 'completed' THEN
    IF v_attempt.provider_receipt_id IS NOT DISTINCT FROM p_provider_receipt_id
       AND v_attempt.provider_receipt_hash IS NOT DISTINCT FROM p_provider_receipt_hash
       AND v_attempt.payload_digest IS NOT DISTINCT FROM p_provider_payload_digest
       AND v_attempt.provider_error_code IS NOT DISTINCT FROM p_error_code THEN
      RETURN public.marketing_campaign_receipt(p_operation_id);
    END IF;
    RAISE EXCEPTION 'marketing_provider_result_binding_mismatch' USING ERRCODE = '42501';
  END IF;
  IF v_batch.status IS DISTINCT FROM 'claimed'
     OR v_attempt.status IS DISTINCT FROM 'unknown' THEN
    RAISE EXCEPTION 'marketing_provider_outcome_unknown' USING ERRCODE = '55000';
  END IF;

  UPDATE privacy_retention.marketing_campaign_provider_attempts AS attempt
  SET status = 'failed',
      provider_receipt_id = p_provider_receipt_id,
      provider_receipt_hash = p_provider_receipt_hash,
      provider_error_code = p_error_code,
      outcome_recorded_at = v_now
  WHERE attempt.id = p_provider_attempt_id;
  UPDATE privacy_retention.marketing_campaign_batch_recipients AS recipient
  SET status = 'failed', finalized_at = v_now,
      provider_receipt_id = p_provider_receipt_id, provider_receipt_hash = p_provider_receipt_hash
  WHERE recipient.batch_id = p_batch_id
    AND recipient.operation_id = p_operation_id
    AND recipient.status = 'claimed'
    AND recipient.claim_token = p_claim_token;
  UPDATE public.marketing_campaign_recipients AS recipient
  SET status = 'failed', updated_at = v_now
  WHERE recipient.operation_id = p_operation_id
    AND recipient.status = 'eligible';
  UPDATE public.marketing_campaign_batches AS batch
  SET status = 'completed', completed_at = v_now
  WHERE batch.id = p_batch_id;

  SELECT count(*)::integer,
         count(*) FILTER (WHERE recipient.status = 'suppressed')::integer,
         count(*) FILTER (WHERE recipient.status = 'failed')::integer
  INTO v_requested, v_suppressed, v_failed
  FROM public.marketing_campaign_recipients AS recipient
  WHERE recipient.operation_id = p_operation_id;
  SELECT count(*)::integer INTO v_unresolved
  FROM (
    SELECT recipient.user_id FROM public.marketing_campaign_recipients AS recipient
    WHERE recipient.operation_id = p_operation_id AND recipient.status IN ('pending', 'eligible')
    UNION
    SELECT recipient.user_id FROM privacy_retention.marketing_campaign_batch_recipients AS recipient
    WHERE recipient.operation_id = p_operation_id AND recipient.status = 'claimed'
  ) AS unresolved;
  IF v_unresolved = 0 THEN
    v_audit_id := privacy_retention.g014_marketing_write_audit(
      p_operation_id, p_preview_hash, 'failed', 'MARKETING_PROVIDER_REJECTED',
      pg_catalog.upper(p_error_code), v_requested, 0, v_suppressed, v_failed
    );
    UPDATE public.marketing_campaign_operations AS operation
    SET status = 'failed', audit_id = v_audit_id, updated_at = v_now
    WHERE operation.id = p_operation_id;
  END IF;
  RETURN public.marketing_campaign_receipt(p_operation_id);
END;
$function$;
ALTER FUNCTION public.fail_marketing_campaign_provider_attempt(uuid, uuid, uuid, text, uuid, uuid, text, text, text, text)
  OWNER TO privacy_workflow_owner;

-- Provider errors that occur before egress may be recorded as failed. Network
-- timeouts and malformed responses after an egress attempt remain unknown.
-- Provider errors that occur before egress may be recorded as failed. Network
-- timeouts and malformed responses after an egress attempt remain unknown.
CREATE OR REPLACE FUNCTION public.record_marketing_campaign_audit(
  p_operation_id uuid,
  p_actor_user_id uuid,
  p_preview_hash text,
  p_status text,
  p_reason_code text,
  p_error_code text,
  p_requested integer,
  p_eligible integer,
  p_suppressed integer,
  p_failed integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM privacy_retention.g014_require_service_role();
  IF p_operation_id IS NULL
     OR p_preview_hash IS NULL
     OR p_preview_hash !~ '^[0-9a-f]{64}$'
     OR p_status IS NULL
     OR p_status NOT IN ('previewed', 'confirmed', 'applied', 'partial', 'failed')
     OR p_reason_code IS NULL
     OR p_reason_code !~ '^[A-Z][A-Z0-9_]{0,63}$' THEN
    RAISE EXCEPTION 'marketing_audit_invalid' USING ERRCODE = '22023';
  END IF;
  RETURN privacy_retention.g014_marketing_write_audit(
    p_operation_id, p_preview_hash, p_status, p_reason_code, p_error_code,
    p_requested, p_eligible, p_suppressed, p_failed
  );
END;
$function$;
ALTER FUNCTION public.record_marketing_campaign_audit(uuid, uuid, text, text, text, text, integer, integer, integer, integer)
  OWNER TO privacy_workflow_owner;

-- Transactional notification writers are distinct from marketing dispatch. They
-- accept only service-role calls, derive all authority from current database
-- rows, and return compact receipts that routes must read back exactly.
CREATE OR REPLACE FUNCTION public.create_admin_transactional_notification(
  p_actor_user_id uuid,
  p_recipient_user_id uuid,
  p_type text,
  p_title text,
  p_message text,
  p_data jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_actor_user_id uuid;
  v_notification public.notifications%ROWTYPE;
  v_data_key_count integer;
BEGIN
  PERFORM privacy_retention.g014_require_service_role();

  IF p_actor_user_id IS NULL
     OR p_recipient_user_id IS NULL
     OR p_type IS NULL
     OR p_type NOT IN (
       'submission_approved',
       'submission_rejected',
       'review_approved',
       'review_rejected',
       'user_ranking'
     )
     OR p_title IS NULL
     OR p_title <> pg_catalog.btrim(p_title)
     OR pg_catalog.char_length(p_title) NOT BETWEEN 1 AND 120
     OR p_title ~ '[[:cntrl:]]'
     OR p_message IS NULL
     OR p_message <> pg_catalog.btrim(p_message)
     OR pg_catalog.char_length(p_message) NOT BETWEEN 1 AND 500
     OR p_message ~ '[[:cntrl:]]'
     OR p_data IS NULL
     OR pg_catalog.jsonb_typeof(p_data) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'admin_transactional_notification_request_invalid'
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
    RAISE EXCEPTION 'admin_transactional_notification_actor_forbidden'
      USING ERRCODE = '42501';
  END IF;

  PERFORM 1
    FROM auth.users AS recipient
   WHERE recipient.id = p_recipient_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_transactional_notification_recipient_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT count(*)::integer
    INTO v_data_key_count
    FROM pg_catalog.jsonb_object_keys(p_data) AS data_key(key);

  IF p_type <> 'user_ranking' AND p_data <> '{}'::jsonb THEN
    RAISE EXCEPTION 'admin_transactional_notification_data_invalid'
      USING ERRCODE = '22023';
  END IF;

  IF p_type = 'user_ranking'
     AND (
       p_data <> '{}'::jsonb
       AND (
         v_data_key_count <> 2
         OR NOT (p_data ? 'ranking' AND p_data ? 'period')
         OR pg_catalog.jsonb_typeof(p_data -> 'ranking') <> 'number'
         OR (p_data ->> 'ranking') !~ '^[1-9][0-9]{0,6}$'
         OR (p_data ->> 'ranking')::integer > 1000000
         OR pg_catalog.jsonb_typeof(p_data -> 'period') <> 'string'
         OR p_data ->> 'period' <> pg_catalog.btrim(p_data ->> 'period')
         OR pg_catalog.char_length(p_data ->> 'period') NOT BETWEEN 1 AND 40
         OR p_data ->> 'period' ~ '[[:cntrl:]]'
       )
     ) THEN
    RAISE EXCEPTION 'admin_transactional_notification_data_invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM public.assert_notification_content_safe(p_title, p_message, p_data);

  INSERT INTO public.notifications (
    user_id,
    type,
    title,
    message,
    data,
    classification,
    channel,
    consent_event_id,
    retention_class,
    campaign_operation_id,
    delivered_at,
    is_read
  )
  VALUES (
    p_recipient_user_id,
    p_type,
    p_title,
    p_message,
    p_data,
    'transactional',
    'in_app',
    NULL,
    'notifications_operational',
    NULL,
    NULL,
    false
  )
  RETURNING * INTO v_notification;

  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'status', 'created',
    'notificationId', v_notification.id::text,
    'actorUserId', p_actor_user_id::text,
    'recipientUserId', p_recipient_user_id::text,
    'type', p_type
  );
END;
$function$;
ALTER FUNCTION public.create_admin_transactional_notification(uuid, uuid, text, text, text, jsonb)
  OWNER TO privacy_workflow_owner;

CREATE OR REPLACE FUNCTION public.create_review_like_notification(
  p_actor_user_id uuid,
  p_review_id uuid,
  p_like_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_like public.review_likes%ROWTYPE;
  v_existing public.notifications%ROWTYPE;
  v_notification public.notifications%ROWTYPE;
  v_recipient_user_id uuid;
  v_restaurant_id uuid;
  v_approved_name text;
  v_restaurant_name text;
  v_restaurant_label text;
  v_title constant text := '리뷰에 좋아요가 눌렸어요!';
  v_message text;
  v_data jsonb;
BEGIN
  PERFORM privacy_retention.g014_require_service_role();

  IF p_actor_user_id IS NULL
     OR p_review_id IS NULL
     OR p_like_id IS NULL THEN
    RAISE EXCEPTION 'review_like_notification_request_invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-review-like:' || p_like_id::text, 0)
  );

  SELECT review_like.*
    INTO v_like
    FROM public.review_likes AS review_like
   WHERE review_like.id = p_like_id
     AND review_like.review_id = p_review_id
     AND review_like.user_id = p_actor_user_id
   FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'review_like_notification_source_forbidden'
      USING ERRCODE = '42501';
  END IF;

  SELECT review_row.user_id,
         review_row.restaurant_id,
         restaurant_row.approved_name,
         restaurant_row.name
    INTO v_recipient_user_id,
         v_restaurant_id,
         v_approved_name,
         v_restaurant_name
    FROM public.reviews AS review_row
    JOIN public.restaurants AS restaurant_row
      ON restaurant_row.id = review_row.restaurant_id
    JOIN auth.users AS recipient
      ON recipient.id = review_row.user_id
   WHERE review_row.id = p_review_id
     AND review_row.id = v_like.review_id
   FOR KEY SHARE OF review_row, restaurant_row;

  IF NOT FOUND
     OR v_recipient_user_id IS NULL
     OR v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'review_like_notification_source_not_found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_recipient_user_id = p_actor_user_id THEN
    RAISE EXCEPTION 'review_like_notification_self_forbidden'
      USING ERRCODE = '42501';
  END IF;

  v_restaurant_label := pg_catalog.btrim(
    pg_catalog.regexp_replace(
      pg_catalog.regexp_replace(
        COALESCE(v_approved_name, v_restaurant_name, '해당 맛집'),
        '[[:cntrl:]]',
        ' ',
        'g'
      ),
      '[[:space:]]+',
      ' ',
      'g'
    )
  );
  IF v_restaurant_label = ''
     OR pg_catalog.char_length(v_restaurant_label) > 80 THEN
    v_restaurant_label := '해당 맛집';
  END IF;

  v_data := pg_catalog.jsonb_build_object(
    'reviewId', p_review_id::text,
    'restaurantId', v_restaurant_id::text,
    'sourceLikeId', p_like_id::text
  );
  v_message := '회원님이 ' || v_restaurant_label || ' 리뷰에 좋아요를 눌렀습니다.';

  BEGIN
    PERFORM public.assert_notification_content_safe(v_title, v_message, v_data);
  EXCEPTION WHEN OTHERS THEN
    v_message := '회원님이 해당 맛집 리뷰에 좋아요를 눌렀습니다.';
    PERFORM public.assert_notification_content_safe(v_title, v_message, v_data);
  END;

  SELECT notification.*
    INTO v_existing
    FROM public.notifications AS notification
   WHERE notification.user_id = v_recipient_user_id
     AND notification.type = 'review_like'
     AND notification.data = v_data
   FOR UPDATE;

  IF FOUND THEN
    IF v_existing.title IS DISTINCT FROM v_title
       OR v_existing.message IS DISTINCT FROM v_message
       OR v_existing.classification IS DISTINCT FROM 'transactional'
       OR v_existing.channel IS DISTINCT FROM 'in_app'
       OR v_existing.is_read IS NULL THEN
      RAISE EXCEPTION 'review_like_notification_replay_invalid'
        USING ERRCODE = '55000';
    END IF;

    RETURN pg_catalog.jsonb_build_object(
      'schemaVersion', 1,
      'status', 'replayed',
      'notificationId', v_existing.id::text,
      'reviewId', p_review_id::text,
      'recipientUserId', v_recipient_user_id::text
    );
  END IF;

  INSERT INTO public.notifications (
    user_id,
    type,
    title,
    message,
    data,
    classification,
    channel,
    consent_event_id,
    retention_class,
    campaign_operation_id,
    delivered_at,
    is_read
  )
  VALUES (
    v_recipient_user_id,
    'review_like',
    v_title,
    v_message,
    v_data,
    'transactional',
    'in_app',
    NULL,
    'notifications_operational',
    NULL,
    NULL,
    false
  )
  RETURNING * INTO v_notification;

  RETURN pg_catalog.jsonb_build_object(
    'schemaVersion', 1,
    'status', 'created',
    'notificationId', v_notification.id::text,
    'reviewId', p_review_id::text,
    'recipientUserId', v_recipient_user_id::text
  );
END;
$function$;
ALTER FUNCTION public.create_review_like_notification(uuid, uuid, uuid)
  OWNER TO privacy_workflow_owner;
-- The NOLOGIN workflow owner needs only source reads for the source-bound
-- review-like definer. These policies do not grant any Data API role access.
GRANT SELECT ON TABLE public.review_likes, public.reviews, public.restaurants
  TO privacy_workflow_owner;
DROP POLICY IF EXISTS g014_privacy_workflow_owner_review_likes_source ON public.review_likes;
CREATE POLICY g014_privacy_workflow_owner_review_likes_source
  ON public.review_likes
  FOR SELECT TO privacy_workflow_owner USING (true);
DROP POLICY IF EXISTS g014_privacy_workflow_owner_reviews_source ON public.reviews;
CREATE POLICY g014_privacy_workflow_owner_reviews_source
  ON public.reviews
  FOR SELECT TO privacy_workflow_owner USING (true);
DROP POLICY IF EXISTS g014_privacy_workflow_owner_restaurants_source ON public.restaurants;
CREATE POLICY g014_privacy_workflow_owner_restaurants_source
  ON public.restaurants
  FOR SELECT TO privacy_workflow_owner USING (true);

-- Data API roles only have the minimal direct readback surface. Every mutation,
-- including TRUNCATE, is through the exact SECURITY DEFINER RPCs above.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.notifications,
  public.marketing_campaign_operations,
  public.marketing_campaign_recipients,
  public.marketing_campaign_batches
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE privacy_retention.marketing_campaign_batch_recipients,
  privacy_retention.marketing_campaign_consent_evidence_keys,
  privacy_retention.marketing_campaign_provider_attempts
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.notifications,
  public.marketing_campaign_operations,
  public.marketing_campaign_recipients,
  public.marketing_campaign_batches
  TO service_role;

REVOKE ALL ON FUNCTION public.evaluate_notification_marketing_permission(uuid, text, timestamptz, text),
  public.marketing_campaign_receipt(uuid),
  public.preview_marketing_campaign(uuid, text, uuid[], text, text, jsonb, text, timestamptz),
  public.prepare_marketing_campaign_batch(uuid, uuid, text, text, integer, text),
  public.claim_marketing_campaign_dispatch(uuid, uuid, uuid, text, text, text),
  public.fail_marketing_campaign_batch(uuid, uuid, uuid, text, text),
  public.fail_marketing_campaign_provider_attempt(uuid, uuid, uuid, text, uuid, uuid, text, text, text, text),
  public.finalize_marketing_campaign_batch(uuid, uuid, uuid, text, uuid[]),
  public.finalize_marketing_campaign_batch(uuid, uuid, uuid, text, uuid, uuid, text, text, text, uuid[], text),
  public.record_marketing_campaign_audit(uuid, uuid, text, text, text, text, integer, integer, integer, integer),
  public.create_admin_transactional_notification(uuid, uuid, text, text, text, jsonb),
  public.create_review_like_notification(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_notification_marketing_permission(uuid, text, timestamptz, text),
  public.marketing_campaign_receipt(uuid),
  public.preview_marketing_campaign(uuid, text, uuid[], text, text, jsonb, text, timestamptz),
  public.prepare_marketing_campaign_batch(uuid, uuid, text, text, integer, text),
  public.claim_marketing_campaign_dispatch(uuid, uuid, uuid, text, text, text),
  public.fail_marketing_campaign_batch(uuid, uuid, uuid, text, text),
  public.fail_marketing_campaign_provider_attempt(uuid, uuid, uuid, text, uuid, uuid, text, text, text, text),
  public.finalize_marketing_campaign_batch(uuid, uuid, uuid, text, uuid[]),
  public.finalize_marketing_campaign_batch(uuid, uuid, uuid, text, uuid, uuid, text, text, text, uuid[], text),
  public.create_admin_transactional_notification(uuid, uuid, text, text, text, jsonb),
  public.create_review_like_notification(uuid, uuid, uuid)
  TO service_role;

-- Extend the persisted G014 RPC allowlist rather than rewriting its G014-01
-- baseline. This rejects missing or colliding identities before grants are used.
DO $g014_marketing_rpc_allowlist$
DECLARE
  v_missing text;
BEGIN
  CREATE TEMPORARY TABLE pg_temp.g014_marketing_expected_rpc (
    source_signature text NOT NULL,
    grantee name NOT NULL,
    PRIMARY KEY (source_signature, grantee)
  ) ON COMMIT DROP;
  INSERT INTO pg_temp.g014_marketing_expected_rpc (source_signature, grantee)
  VALUES
    ('public.claim_marketing_campaign_dispatch(uuid,uuid,uuid,text,text,text)', 'service_role'::name),
    ('public.fail_marketing_campaign_provider_attempt(uuid,uuid,uuid,text,uuid,uuid,text,text,text,text)', 'service_role'::name),
    ('public.finalize_marketing_campaign_batch(uuid,uuid,uuid,text,uuid,uuid,text,text,text,uuid[],text)', 'service_role'::name),
    ('public.create_admin_transactional_notification(uuid,uuid,text,text,text,jsonb)', 'service_role'::name),
    ('public.create_review_like_notification(uuid,uuid,uuid)', 'service_role'::name);
  SELECT expected.source_signature INTO v_missing
  FROM pg_temp.g014_marketing_expected_rpc AS expected
  WHERE pg_catalog.to_regprocedure(expected.source_signature) IS NULL
  ORDER BY expected.source_signature
  LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'G014-03 required public RPC identity is missing: %', v_missing;
  END IF;
  INSERT INTO privacy_retention.g014_public_rpc_allowlist (
    function_schema, function_name, identity_arguments, grantee, source_signature
  )
  SELECT namespace.nspname, procedure.proname,
         procedure.proargtypes::text,
         expected.grantee, expected.source_signature
  FROM pg_temp.g014_marketing_expected_rpc AS expected
  JOIN LATERAL pg_catalog.to_regprocedure(expected.source_signature) AS resolved(procedure_oid) ON true
  JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = resolved.procedure_oid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  ON CONFLICT DO NOTHING;
  IF EXISTS (
    (SELECT expected.source_signature, expected.grantee
     FROM pg_temp.g014_marketing_expected_rpc AS expected)
    EXCEPT
    (SELECT allowed.source_signature, allowed.grantee
     FROM privacy_retention.g014_public_rpc_allowlist AS allowed)
  ) THEN
    RAISE EXCEPTION 'G014-03 public RPC allowlist insert failed';
  END IF;
END;
$g014_marketing_rpc_allowlist$;

SELECT privacy_retention.assert_g014_public_rpc_allowlist();

DO $g014_transactional_notification_catalog_assertion$
DECLARE
  v_expected record;
  v_procedure oid;
  v_owner name;
  v_is_definer boolean;
  v_search_path text;
  v_role name;
BEGIN
  FOR v_expected IN
    SELECT *
    FROM (
      VALUES
        (
          'public.create_admin_transactional_notification(uuid,uuid,text,text,text,jsonb)'::text,
          'create_admin_transactional_notification'::name
        ),
        (
          'public.create_review_like_notification(uuid,uuid,uuid)'::text,
          'create_review_like_notification'::name
        )
    ) AS expected(source_signature, function_name)
  LOOP
    v_procedure := pg_catalog.to_regprocedure(v_expected.source_signature);
    IF v_procedure IS NULL THEN
      RAISE EXCEPTION 'G014 transactional notification RPC is missing: %',
        v_expected.source_signature;
    END IF;

    SELECT pg_catalog.pg_get_userbyid(procedure.proowner),
           procedure.prosecdef,
           setting.value
      INTO v_owner, v_is_definer, v_search_path
      FROM pg_catalog.pg_proc AS procedure
      LEFT JOIN LATERAL (
        SELECT config.value
        FROM pg_catalog.unnest(procedure.proconfig) AS config(value)
        WHERE config.value LIKE 'search_path=%'
      ) AS setting ON true
     WHERE procedure.oid = v_procedure;

    IF v_owner IS DISTINCT FROM 'privacy_workflow_owner'::name
       OR v_is_definer IS DISTINCT FROM true
       OR (
         v_search_path IS DISTINCT FROM 'search_path='
         AND v_search_path IS DISTINCT FROM 'search_path=""'
       ) THEN
      RAISE EXCEPTION 'G014 transactional notification RPC security contract failed: %',
        v_expected.source_signature;
    END IF;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      WHERE namespace.nspname = 'public'
        AND procedure.proname = v_expected.function_name
        AND procedure.oid <> v_procedure
    ) THEN
      RAISE EXCEPTION 'G014 transactional notification RPC has an unexpected overload: %',
        v_expected.function_name;
    END IF;

    FOR v_role IN
      SELECT role_matrix.grantee
      FROM (VALUES ('anon'::name), ('authenticated'::name), ('service_role'::name))
        AS role_matrix(grantee)
    LOOP
      IF pg_catalog.has_function_privilege(v_role, v_procedure, 'EXECUTE')
         IS DISTINCT FROM (v_role = 'service_role'::name) THEN
        RAISE EXCEPTION 'G014 transactional notification RPC grant contract failed: %',
          v_expected.source_signature;
      END IF;
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.aclexplode(
        COALESCE(
          (SELECT procedure.proacl FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_procedure),
          pg_catalog.acldefault(
            'f',
            (SELECT procedure.proowner FROM pg_catalog.pg_proc AS procedure WHERE procedure.oid = v_procedure)
          )
        )
      ) AS acl
      WHERE acl.grantee = 0
        AND acl.privilege_type = 'EXECUTE'
    ) THEN
      RAISE EXCEPTION 'G014 transactional notification RPC has PUBLIC EXECUTE: %',
        v_expected.source_signature;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('INSERT'::text), ('UPDATE'::text), ('DELETE'::text), ('TRUNCATE'::text))
      AS required_privilege(privilege)
    WHERE pg_catalog.has_table_privilege(
      'service_role',
      'public.notifications',
      required_privilege.privilege
    )
  ) THEN
    RAISE EXCEPTION 'G014 service_role retains direct notifications mutation';
  END IF;
END;
$g014_transactional_notification_catalog_assertion$;
