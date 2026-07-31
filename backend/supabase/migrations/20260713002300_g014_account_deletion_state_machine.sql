-- G014-04: account deletion is a manifest-bound, fail-closed state machine.
-- This is additive.  It intentionally does not rewrite applied migrations or
-- historical audit rows.

DO $g014_preflight$
BEGIN
  IF pg_catalog.to_regclass('public.account_deletion_policies') IS NULL
     OR pg_catalog.to_regclass('public.account_deletion_data_classes') IS NULL
     OR pg_catalog.to_regclass('public.account_deletion_requests') IS NULL
     OR pg_catalog.to_regclass('public.account_deletion_request_items') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.privacy_legal_holds') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.privacy_audit_events') IS NULL
     OR pg_catalog.to_regprocedure('extensions.digest(text,text)') IS NULL
     OR pg_catalog.to_regprocedure('extensions.gen_random_uuid()') IS NULL THEN
    RAISE EXCEPTION 'G014-04 required G010/G014 dependencies are missing';
  END IF;
END;
$g014_preflight$;

CREATE TABLE privacy_retention.account_deletion_adapter_registry (
  adapter_name text PRIMARY KEY CHECK (adapter_name ~ '^[a-z][a-z0-9_]{2,63}$'),
  code text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  relation_name text NOT NULL CHECK (relation_name ~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$'),
  subject_column text NOT NULL CHECK (subject_column ~ '^[a-z_][a-z0-9_]*$'),
  subject_type regtype NOT NULL,
  expected_fk_relation text,
  expected_fk_column text,
  disposition text NOT NULL CHECK (disposition IN ('delete', 'anonymize', 'separate', 'retain')),
  ordinal integer NOT NULL UNIQUE CHECK (ordinal BETWEEN 1 AND 999),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  CHECK (
    (expected_fk_relation IS NULL AND expected_fk_column IS NULL)
    OR (expected_fk_relation IS NOT NULL AND expected_fk_column IS NOT NULL)
  )
);

CREATE TABLE privacy_retention.account_deletion_source_manifest (
  policy_version text NOT NULL REFERENCES public.account_deletion_policies(version) ON DELETE RESTRICT,
  code text NOT NULL CHECK (code ~ '^[a-z][a-z0-9_]{2,63}$'),
  relation_name text NOT NULL CHECK (relation_name ~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$'),
  subject_column text NOT NULL CHECK (subject_column ~ '^[a-z_][a-z0-9_]*$'),
  adapter_name text NOT NULL REFERENCES privacy_retention.account_deletion_adapter_registry(adapter_name) ON DELETE RESTRICT,
  required boolean NOT NULL,
  ordinal integer NOT NULL CHECK (ordinal BETWEEN 1 AND 999),
  contract_hash text NOT NULL CHECK (contract_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (policy_version, code),
  UNIQUE (policy_version, ordinal)
);

CREATE TABLE privacy_retention.account_deletion_hold_class_map (
  deletion_class text NOT NULL CHECK (deletion_class ~ '^[a-z][a-z0-9_]{2,79}$'),
  hold_data_class text NOT NULL CHECK (hold_data_class ~ '^[a-z][a-z0-9_]{2,79}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (deletion_class, hold_data_class)
);

CREATE TABLE privacy_retention.account_deletion_client_cleanup_contracts (
  cleanup_code text PRIMARY KEY CHECK (cleanup_code = 'browser_indexeddb_submission_drafts'),
  execution_boundary text NOT NULL CHECK (execution_boundary = 'client_only'),
  required_notice text NOT NULL CHECK (required_notice = 'clear IndexedDB drafts after server workflow confirmation'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE TABLE privacy_retention.account_deletion_admin_guard (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE TABLE privacy_retention.account_deletion_policy_activation_history (
  policy_version text PRIMARY KEY REFERENCES public.account_deletion_policies(version) ON DELETE RESTRICT,
  activated_at timestamptz NOT NULL,
  activation_idempotency_key text,
  operator_approval_ref text,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);
CREATE TABLE privacy_retention.account_deletion_policy_publications (
  policy_version text PRIMARY KEY REFERENCES public.account_deletion_policies(version) ON DELETE RESTRICT,
  publication_idempotency_key text NOT NULL UNIQUE
    CHECK (publication_idempotency_key ~ '^[A-Za-z0-9._:-]{8,128}$'),
  operator_approval_ref text NOT NULL
    CHECK (operator_approval_ref ~ '^[A-Za-z0-9._:-]{8,128}$'),
  publication_input_hash text NOT NULL CHECK (publication_input_hash ~ '^[0-9a-f]{64}$'),
  source_manifest_hash text NOT NULL CHECK (source_manifest_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp()
);

CREATE TABLE privacy_retention.account_deletion_admin_reservations (
  request_id uuid PRIMARY KEY REFERENCES public.account_deletion_requests(id) ON DELETE RESTRICT,
  target_user_id uuid NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'completed', 'released')),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  reconciled_at timestamptz,
  CHECK ((status = 'active' AND reconciled_at IS NULL) OR (status IN ('completed', 'released') AND reconciled_at IS NOT NULL))
);
CREATE UNIQUE INDEX g014_account_deletion_one_active_admin_reservation_idx
  ON privacy_retention.account_deletion_admin_reservations (target_user_id)
  WHERE status = 'active';

CREATE TABLE privacy_retention.account_deletion_external_phase_leases (
  request_id uuid NOT NULL REFERENCES public.account_deletion_requests(id) ON DELETE RESTRICT,
  phase text NOT NULL CHECK (phase IN ('storage', 'auth')),
  target_user_id uuid NOT NULL,
  lease_token uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  status text NOT NULL CHECK (status IN ('active', 'consumed', 'released')),
  claimed_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  lease_expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  PRIMARY KEY (request_id, phase),
  UNIQUE (lease_token),
  CHECK (lease_expires_at > claimed_at),
  CHECK ((status = 'active' AND consumed_at IS NULL) OR (status IN ('consumed', 'released') AND consumed_at IS NOT NULL))
);
CREATE UNIQUE INDEX g014_account_deletion_one_active_external_lease_idx
  ON privacy_retention.account_deletion_external_phase_leases (target_user_id, phase)
  WHERE status = 'active';
CREATE TABLE privacy_retention.account_deletion_evidence_cleanup_leases (
  request_id uuid PRIMARY KEY REFERENCES public.account_deletion_requests(id) ON DELETE RESTRICT,
  target_user_id uuid NOT NULL,
  lease_token uuid NOT NULL DEFAULT extensions.gen_random_uuid(),
  status text NOT NULL CHECK (status IN ('active', 'released')),
  claimed_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  lease_expires_at timestamptz NOT NULL,
  released_at timestamptz,
  UNIQUE (lease_token),
  CHECK (lease_expires_at > claimed_at),
  CHECK ((status = 'active' AND released_at IS NULL) OR (status = 'released' AND released_at IS NOT NULL))
);

CREATE TABLE privacy_retention.account_deletion_evidence_separations (
  request_id uuid NOT NULL REFERENCES public.account_deletion_requests(id) ON DELETE RESTRICT,
  data_class_code text NOT NULL,
  source_count integer NOT NULL CHECK (source_count >= 0),
  source_snapshot_hash text NOT NULL CHECK (source_snapshot_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (request_id, data_class_code)
);

CREATE TABLE privacy_retention.account_deletion_storage_objects (
  request_id uuid NOT NULL REFERENCES public.account_deletion_requests(id) ON DELETE RESTRICT,
  object_locator_hash text NOT NULL CHECK (object_locator_hash ~ '^[0-9a-f]{64}$'),
  object_version_hash text NOT NULL CHECK (object_version_hash ~ '^[0-9a-f]{64}$'),
  object_id uuid NOT NULL,
  object_version text NOT NULL CHECK (object_version ~ '^[A-Za-z0-9._:-]{1,256}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (request_id, object_id, object_version),
  CONSTRAINT g014_account_deletion_storage_object_locator_version_key
    UNIQUE (request_id, object_locator_hash, object_version_hash),
  CONSTRAINT g014_account_deletion_storage_object_exact_key
    UNIQUE (
      request_id, object_locator_hash, object_version_hash, object_id, object_version
    )
);

CREATE TABLE privacy_retention.account_deletion_provider_receipt_proofs (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  phase text NOT NULL CHECK (phase IN ('storage', 'auth')),
  request_id uuid NOT NULL REFERENCES public.account_deletion_requests(id) ON DELETE RESTRICT,
  actor_user_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  lease_token uuid NOT NULL,
  manifest_hash text NOT NULL CHECK (manifest_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  preview_hash text NOT NULL CHECK (preview_hash ~ '^[0-9a-f]{64}$'),
  predecessor_receipts_hash text,
  provider_kind text NOT NULL CHECK (provider_kind IN ('storage_object_delete', 'admin_auth_delete')),
  canonical_payload_hash text NOT NULL CHECK (canonical_payload_hash ~ '^[0-9a-f]{64}$'),
  provider_receipt_ref text NOT NULL CHECK (provider_receipt_ref ~ '^[A-Za-z0-9._:-]{8,256}$'),
  provider_receipt_hash text NOT NULL CHECK (provider_receipt_hash ~ '^[0-9a-f]{64}$'),
  object_locator_hash text,
  object_version_hash text,
  verified_at timestamptz NOT NULL,
  verifier_identity text NOT NULL CHECK (verifier_identity ~ '^[A-Za-z0-9._:-]{8,128}$'),
  proof_hash text NOT NULL CHECK (proof_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (phase, request_id, provider_receipt_ref),
  CHECK (
    (phase = 'storage'
      AND provider_kind = 'storage_object_delete'
      AND object_locator_hash ~ '^[0-9a-f]{64}$'
      AND object_version_hash ~ '^[0-9a-f]{64}$'
      AND predecessor_receipts_hash IS NULL)
    OR (phase = 'auth'
      AND provider_kind = 'admin_auth_delete'
      AND object_locator_hash IS NULL
      AND object_version_hash IS NULL
      AND predecessor_receipts_hash ~ '^[0-9a-f]{64}$')
  )
);

CREATE TABLE privacy_retention.account_deletion_storage_receipts (
  request_id uuid NOT NULL REFERENCES public.account_deletion_requests(id) ON DELETE RESTRICT,
  object_locator_hash text NOT NULL CHECK (object_locator_hash ~ '^[0-9a-f]{64}$'),
  object_version_hash text NOT NULL CHECK (object_version_hash ~ '^[0-9a-f]{64}$'),
  provider_receipt_ref text NOT NULL CHECK (provider_receipt_ref ~ '^[A-Za-z0-9._:-]{8,256}$'),
  provider_receipt_hash text NOT NULL CHECK (provider_receipt_hash ~ '^[0-9a-f]{64}$'),
  proof_hash text NOT NULL CHECK (proof_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  PRIMARY KEY (request_id, object_locator_hash),
  UNIQUE (request_id, provider_receipt_ref)
);

INSERT INTO privacy_retention.account_deletion_admin_guard (singleton)
VALUES (true)
ON CONFLICT (singleton) DO NOTHING;
INSERT INTO privacy_retention.account_deletion_client_cleanup_contracts (
  cleanup_code, execution_boundary, required_notice
) VALUES (
  'browser_indexeddb_submission_drafts',
  'client_only',
  'clear IndexedDB drafts after server workflow confirmation'
) ON CONFLICT (cleanup_code) DO NOTHING;

ALTER TABLE public.account_deletion_requests
  DROP CONSTRAINT IF EXISTS account_deletion_requests_status_check;
ALTER TABLE public.account_deletion_requests
  ADD CONSTRAINT g014_account_deletion_request_status_check
  CHECK (status IN (
    'draft', 'previewed', 'applying', 'applied', 'partial', 'failed',
    'expired', 'cancelled'
  ));
ALTER TABLE public.account_deletion_requests
  ADD COLUMN source_manifest_hash text CHECK (source_manifest_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN storage_receipts_hash text CHECK (storage_receipts_hash IS NULL OR storage_receipts_hash ~ '^[0-9a-f]{64}$'),
  ADD COLUMN auth_receipt_ref text CHECK (auth_receipt_ref IS NULL OR auth_receipt_ref ~ '^[A-Za-z0-9._:-]{8,256}$');

ALTER TABLE public.account_deletion_requests
  ADD CONSTRAINT g014_account_deletion_applied_receipt_check
  CHECK (
    status <> 'applied'
    OR (
      db_readback_passed IS TRUE
      AND session_readback_passed IS TRUE
      AND storage_readback_passed IS TRUE
      AND auth_readback_passed IS TRUE
      AND applied_at IS NOT NULL
      AND auth_receipt_ref IS NOT NULL
      AND auth_receipt_ref ~ '^auth:[0-9a-f]{64}$'
    )
  ) NOT VALID;

CREATE UNIQUE INDEX g014_account_deletion_one_nonterminal_target_idx
  ON public.account_deletion_requests (target_user_id)
  WHERE status IN ('previewed', 'applying', 'partial');

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_subject_hash(p_user_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(
    extensions.digest('privacy-subject:v1:' || p_user_id::text, 'sha256'),
    'hex'
  );
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_manifest_contract_hash(
  p_policy_version text,
  p_code text,
  p_relation_name text,
  p_subject_column text,
  p_adapter_name text,
  p_required boolean,
  p_ordinal integer
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.concat_ws(
        ':',
        'g014-account-deletion-source-v2',
        p_policy_version,
        p_code,
        p_relation_name,
        p_subject_column,
        p_adapter_name,
        p_required::text,
        p_ordinal::text,
        COALESCE(registry.subject_type::text, '<missing>'),
        COALESCE(registry.expected_fk_relation, '<none>'),
        COALESCE(registry.expected_fk_column, '<none>'),
        COALESCE(registry.disposition, '<missing>'),
        COALESCE(registry.ordinal::text, '<missing>')
      ),
      'sha256'
    ),
    'hex'
  )
  FROM (SELECT 1) AS singleton
  LEFT JOIN privacy_retention.account_deletion_adapter_registry AS registry
    ON registry.adapter_name = p_adapter_name;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_manifest_hash(p_policy_version text)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(
    extensions.digest(
      COALESCE(
        (
          SELECT pg_catalog.string_agg(
            pg_catalog.concat_ws(
              ':', manifest.policy_version, manifest.code, manifest.relation_name,
              manifest.subject_column, manifest.adapter_name, manifest.required::text,
              manifest.ordinal::text, manifest.contract_hash
            ),
            E'\n' ORDER BY manifest.ordinal, manifest.code
          )
          FROM privacy_retention.account_deletion_source_manifest AS manifest
          WHERE manifest.policy_version = p_policy_version
        ),
        ''
      ),
      'sha256'
    ),
    'hex'
  );
$function$;
DROP FUNCTION IF EXISTS privacy_retention.g014_account_deletion_receipt_payload_hash(
  text,uuid,uuid,uuid,text,text,text,text,text,text,text,text,text
);
CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_receipt_payload_hash(
  p_phase text,
  p_request_id uuid,
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_manifest_hash text,
  p_idempotency_key text,
  p_preview_hash text,
  p_lease_token uuid,
  p_provider_kind text,
  p_provider_receipt_ref text,
  p_provider_receipt_hash text,
  p_object_locator_hash text,
  p_object_version_hash text,
  p_predecessor_receipts_hash text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT pg_catalog.encode(
    extensions.digest(
      pg_catalog.jsonb_build_object(
        'phase', p_phase,
        'requestId', p_request_id,
        'actorUserId', p_actor_user_id,
        'targetUserId', p_target_user_id,
        'manifestHash', p_manifest_hash,
        'idempotencyKey', p_idempotency_key,
        'previewHash', p_preview_hash,
        'leaseToken', p_lease_token,
        'providerKind', p_provider_kind,
        'providerReceiptRef', p_provider_receipt_ref,
        'providerReceiptHash', p_provider_receipt_hash,
        'objectLocatorHash', p_object_locator_hash,
        'objectVersionHash', p_object_version_hash,
        'predecessorReceiptsHash', p_predecessor_receipts_hash
      )::text,
      'sha256'
    ),
    'hex'
  );
$function$;
CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_storage_receipt_refs(
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SET search_path = ''
AS $function$
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'object_locator_hash', receipt.object_locator_hash,
        'object_version_hash', receipt.object_version_hash,
        'provider_receipt_ref', receipt.provider_receipt_ref,
        'provider_receipt_hash', receipt.provider_receipt_hash
      )
      ORDER BY receipt.object_locator_hash
    ),
    '[]'::jsonb
  )
  FROM privacy_retention.account_deletion_storage_receipts AS receipt
  WHERE receipt.request_id = p_request_id;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_require_service_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'account_deletion_service_role_required' USING ERRCODE = '42501';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_is_active_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles AS role_row
    LEFT JOIN public.user_account_status AS status_row
      ON status_row.user_id = role_row.user_id
    WHERE role_row.user_id = p_user_id
      AND role_row.role = 'admin'
      AND COALESCE(status_row.account_status, 'active') = 'active'
  );
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_lock_target(p_target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'account_deletion_target_required' USING ERRCODE = '22004';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'g014-account-deletion-target-hash:' ||
      privacy_retention.g014_account_deletion_subject_hash(p_target_user_id),
      0
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_subject_hash text;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_lock_target(p_target_user_id);
  v_subject_hash := privacy_retention.g014_account_deletion_subject_hash(p_target_user_id);
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_legal_holds AS hold_row
    JOIN privacy_retention.account_deletion_hold_class_map AS map_row
      ON map_row.hold_data_class = hold_row.data_class
    WHERE map_row.deletion_class = 'account_deletion'
      AND hold_row.subject_ref_hash = v_subject_hash
      AND hold_row.status = 'active'
      AND (hold_row.expires_at IS NULL OR hold_row.expires_at > pg_catalog.clock_timestamp())
  ) THEN
    RAISE EXCEPTION 'account_deletion_legal_hold_active' USING ERRCODE = '55000';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_assert_actor_allowed(
  p_actor_user_id uuid,
  p_target_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_other_active_admins integer;
BEGIN
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'account_deletion_actor_and_target_required' USING ERRCODE = '22004';
  END IF;
  IF p_actor_user_id IS DISTINCT FROM p_target_user_id
     AND NOT privacy_retention.g014_account_deletion_is_active_admin(p_actor_user_id) THEN
    RAISE EXCEPTION 'account_deletion_actor_not_allowed' USING ERRCODE = '42501';
  END IF;

  -- The singleton serializes the final-admin calculation.  The row locks fence
  -- concurrent role/status changes even when different targets are deleted.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-account-deletion-active-admin-guard', 0)
  );
  PERFORM 1 FROM privacy_retention.account_deletion_admin_guard WHERE singleton FOR UPDATE;
  PERFORM 1 FROM public.user_roles AS role_row WHERE role_row.role = 'admin' FOR UPDATE;
  PERFORM 1
  FROM public.user_account_status AS status_row
  WHERE EXISTS (
    SELECT 1 FROM public.user_roles AS role_row
    WHERE role_row.user_id = status_row.user_id AND role_row.role = 'admin'
  )
  FOR UPDATE;

  IF privacy_retention.g014_account_deletion_is_active_admin(p_target_user_id) THEN
    SELECT count(*) INTO v_other_active_admins
    FROM public.user_roles AS role_row
    LEFT JOIN public.user_account_status AS status_row
      ON status_row.user_id = role_row.user_id
    WHERE role_row.role = 'admin'
      AND role_row.user_id IS DISTINCT FROM p_target_user_id
      AND COALESCE(status_row.account_status, 'active') = 'active'
      AND NOT EXISTS (
        SELECT 1
        FROM privacy_retention.account_deletion_admin_reservations AS reservation
        WHERE reservation.target_user_id = role_row.user_id
          AND reservation.status = 'active'
      );
    IF v_other_active_admins = 0 THEN
      RAISE EXCEPTION 'account_deletion_last_admin_protected' USING ERRCODE = '55000';
    END IF;
  END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_reserve_admin_slot(
  p_request_id uuid,
  p_target_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_other_available_admins integer;
BEGIN
  IF p_request_id IS NULL OR p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'account_deletion_admin_reservation_arguments_required' USING ERRCODE = '22004';
  END IF;
  IF NOT privacy_retention.g014_account_deletion_is_active_admin(p_target_user_id) THEN
    RETURN;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-account-deletion-active-admin-guard', 0)
  );
  PERFORM 1 FROM privacy_retention.account_deletion_admin_guard WHERE singleton FOR UPDATE;
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_admin_reservations AS reservation
    WHERE reservation.target_user_id = p_target_user_id
      AND reservation.status = 'active'
      AND reservation.request_id IS DISTINCT FROM p_request_id
  ) THEN
    RAISE EXCEPTION 'account_deletion_admin_reservation_conflict' USING ERRCODE = '55000';
  END IF;
  SELECT count(*) INTO v_other_available_admins
  FROM public.user_roles AS role_row
  LEFT JOIN public.user_account_status AS status_row ON status_row.user_id = role_row.user_id
  WHERE role_row.role = 'admin'
    AND role_row.user_id IS DISTINCT FROM p_target_user_id
    AND COALESCE(status_row.account_status, 'active') = 'active'
    AND NOT EXISTS (
      SELECT 1
      FROM privacy_retention.account_deletion_admin_reservations AS reservation
      WHERE reservation.target_user_id = role_row.user_id
        AND reservation.status = 'active'
    );
  IF v_other_available_admins = 0 THEN
    RAISE EXCEPTION 'account_deletion_last_admin_reservation_protected' USING ERRCODE = '55000';
  END IF;
  INSERT INTO privacy_retention.account_deletion_admin_reservations (
    request_id, target_user_id, status
  ) VALUES (
    p_request_id, p_target_user_id, 'active'
  ) ON CONFLICT (request_id) DO NOTHING;
END;
$function$;
CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_admin_removal_fence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_target_user_id uuid;
  v_available_active_admins integer;
BEGIN
  IF TG_TABLE_NAME = 'user_roles' THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD.role IS DISTINCT FROM 'admin' THEN
        RETURN OLD;
      END IF;
      v_target_user_id := OLD.user_id;
    ELSIF OLD.role = 'admin' AND NEW.role IS DISTINCT FROM 'admin' THEN
      v_target_user_id := OLD.user_id;
    ELSE
      RETURN NEW;
    END IF;
  ELSIF TG_TABLE_NAME = 'user_account_status' THEN
    IF NEW.account_status = 'active'
       OR (TG_OP = 'UPDATE' AND OLD.account_status IS DISTINCT FROM 'active') THEN
      RETURN NEW;
    END IF;
    v_target_user_id := NEW.user_id;
    IF NOT EXISTS (
      SELECT 1
      FROM public.user_roles AS role_row
      WHERE role_row.user_id = v_target_user_id
        AND role_row.role = 'admin'
    ) THEN
      RETURN NEW;
    END IF;
  ELSE
    RAISE EXCEPTION 'account_deletion_admin_removal_fence_unexpected_relation' USING ERRCODE = '55000';
  END IF;

  -- Share both G014 and legacy role/status locks so every removal, demotion,
  -- reservation, and final Auth cascade sees one available-admin snapshot.
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-account-deletion-active-admin-guard', 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('tzudong-admin-role-delete')
  );
  PERFORM 1
  FROM privacy_retention.account_deletion_admin_guard
  WHERE singleton
  FOR UPDATE;
  PERFORM 1 FROM public.user_roles AS role_row WHERE role_row.role = 'admin' FOR UPDATE;
  PERFORM 1
  FROM public.user_account_status AS status_row
  WHERE EXISTS (
    SELECT 1
    FROM public.user_roles AS role_row
    WHERE role_row.user_id = status_row.user_id
      AND role_row.role = 'admin'
  )
  FOR UPDATE;

  SELECT count(*) INTO v_available_active_admins
  FROM public.user_roles AS role_row
  LEFT JOIN public.user_account_status AS status_row
    ON status_row.user_id = role_row.user_id
  WHERE role_row.role = 'admin'
    AND role_row.user_id IS DISTINCT FROM v_target_user_id
    AND COALESCE(status_row.account_status, 'active') = 'active'
    AND NOT EXISTS (
      SELECT 1
      FROM privacy_retention.account_deletion_admin_reservations AS reservation
      WHERE reservation.target_user_id = role_row.user_id
        AND reservation.status = 'active'
    );
  IF v_available_active_admins < 1 THEN
    RAISE EXCEPTION 'account_deletion_admin_removal_available_admin_required' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
DROP TRIGGER IF EXISTS g014_account_deletion_admin_role_removal_fence ON public.user_roles;
CREATE TRIGGER g014_account_deletion_admin_role_removal_fence
BEFORE DELETE OR UPDATE OF role ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_account_deletion_admin_removal_fence();
DROP TRIGGER IF EXISTS g014_account_deletion_admin_status_removal_fence ON public.user_account_status;
CREATE TRIGGER g014_account_deletion_admin_status_removal_fence
BEFORE INSERT OR UPDATE OF account_status ON public.user_account_status
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_account_deletion_admin_removal_fence();
DROP FUNCTION IF EXISTS public.claim_account_deletion_external_phase(uuid,uuid,uuid,text,text,text,text);
CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_assert_external_lease(
  p_request_id uuid,
  p_target_user_id uuid,
  p_phase text,
  p_lease_token uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_request_id IS NULL OR p_target_user_id IS NULL OR p_phase IS NULL OR p_lease_token IS NULL THEN
    RAISE EXCEPTION 'account_deletion_external_lease_arguments_required' USING ERRCODE = '22004';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_lock_target(p_target_user_id);
  IF NOT EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_external_phase_leases AS lease_row
    WHERE lease_row.request_id = p_request_id
      AND lease_row.target_user_id = p_target_user_id
      AND lease_row.phase = p_phase
      AND lease_row.lease_token = p_lease_token
      AND lease_row.status = 'active'
      AND lease_row.lease_expires_at > pg_catalog.clock_timestamp()
  ) THEN
    RAISE EXCEPTION 'account_deletion_external_lease_binding_mismatch' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id);
END;
$function$;
CREATE OR REPLACE FUNCTION public.claim_account_deletion_external_phase(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_phase text
)
RETURNS TABLE (
  request_id uuid, phase text, lease_token uuid, lease_expires_at timestamptz, source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_lease privacy_retention.account_deletion_external_phase_leases%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM privacy_retention.g014_account_deletion_require_service_role();
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_request_id IS NULL
     OR p_preview_hash IS NULL OR p_idempotency_key IS NULL
     OR p_source_manifest_hash IS NULL OR p_phase IS NULL THEN
    RAISE EXCEPTION 'account_deletion_external_claim_arguments_required' USING ERRCODE = '22004';
  END IF;
  IF p_phase NOT IN ('storage', 'auth') THEN
    RAISE EXCEPTION 'account_deletion_external_claim_phase_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_request FROM public.account_deletion_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND
     OR v_request.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v_request.target_user_id IS DISTINCT FROM p_target_user_id
     OR v_request.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_request.idempotency_key IS DISTINCT FROM p_idempotency_key
     OR v_request.source_manifest_hash IS DISTINCT FROM p_source_manifest_hash THEN
    RAISE EXCEPTION 'account_deletion_external_claim_binding_mismatch' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_lock_target(p_target_user_id);
  PERFORM privacy_retention.g014_account_deletion_assert_actor_allowed(p_actor_user_id, p_target_user_id);
  PERFORM privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id);
  IF v_request.status NOT IN ('applying', 'partial')
     OR (p_phase = 'storage' AND (NOT v_request.db_readback_passed OR NOT v_request.session_readback_passed OR v_request.storage_readback_passed))
     OR (p_phase = 'auth' AND (NOT v_request.storage_readback_passed OR v_request.auth_readback_passed)) THEN
    RAISE EXCEPTION 'account_deletion_external_claim_predecessor_invalid' USING ERRCODE = '55000';
  END IF;
  UPDATE privacy_retention.account_deletion_external_phase_leases
  SET status = 'released', consumed_at = v_now
  WHERE target_user_id = p_target_user_id
    AND phase = p_phase
    AND status = 'active'
    AND lease_expires_at <= v_now;
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_external_phase_leases
    WHERE target_user_id = p_target_user_id
      AND phase = p_phase
      AND status = 'active'
      AND request_id IS DISTINCT FROM p_request_id
  ) THEN
    RAISE EXCEPTION 'account_deletion_external_claim_target_busy' USING ERRCODE = '55000';
  END IF;
  INSERT INTO privacy_retention.account_deletion_external_phase_leases (
    request_id, phase, target_user_id, lease_token, status, claimed_at, lease_expires_at
  ) VALUES (
    p_request_id, p_phase, p_target_user_id, extensions.gen_random_uuid(),
    'active', v_now, v_now + interval '5 minutes'
  ) ON CONFLICT (request_id, phase) DO UPDATE
    SET target_user_id = EXCLUDED.target_user_id,
        lease_token = EXCLUDED.lease_token,
        status = EXCLUDED.status,
        claimed_at = EXCLUDED.claimed_at,
        lease_expires_at = EXCLUDED.lease_expires_at,
        consumed_at = NULL
    WHERE privacy_retention.account_deletion_external_phase_leases.status = 'released';
  SELECT * INTO v_lease
  FROM privacy_retention.account_deletion_external_phase_leases
  WHERE request_id = p_request_id AND phase = p_phase
  FOR UPDATE;
  IF v_lease.target_user_id IS DISTINCT FROM p_target_user_id
     OR v_lease.status IS DISTINCT FROM 'active'
     OR v_lease.lease_expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'account_deletion_external_claim_replay_invalid' USING ERRCODE = '55000';
  END IF;
  RETURN QUERY SELECT
    v_request.id, p_phase, v_lease.lease_token, v_lease.lease_expires_at, v_request.source_manifest_hash;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_source_count(
  p_relation_name text,
  p_subject_column text,
  p_subject_value text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_count integer;
  v_relation regclass;
BEGIN
  v_relation := pg_catalog.to_regclass(p_relation_name);
  IF v_relation IS NULL THEN
    RAISE EXCEPTION 'account_deletion_source_relation_missing: %', p_relation_name USING ERRCODE = '55000';
  END IF;
  EXECUTE pg_catalog.format(
    'SELECT count(*)::integer FROM %s WHERE %I::text = $1',
    v_relation,
    p_subject_column
  ) INTO v_count USING p_subject_value;
  RETURN v_count;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_validate_manifest(
  p_policy_version text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_manifest privacy_retention.account_deletion_source_manifest%ROWTYPE;
  v_registry privacy_retention.account_deletion_adapter_registry%ROWTYPE;
  v_class public.account_deletion_data_classes%ROWTYPE;
  v_relation regclass;
  v_attnum smallint;
  v_actual_type oid;
  v_expected_fk regclass;
  v_expected_fk_attnum smallint;
BEGIN
  IF p_policy_version IS NULL THEN
    RAISE EXCEPTION 'account_deletion_policy_version_required' USING ERRCODE = '22004';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.account_deletion_data_classes AS data_class
    FULL JOIN privacy_retention.account_deletion_source_manifest AS manifest
      ON manifest.policy_version = data_class.policy_version
     AND manifest.code = data_class.code
    WHERE COALESCE(data_class.policy_version, manifest.policy_version) = p_policy_version
      AND (
        data_class.code IS NULL
        OR manifest.code IS NULL
        OR manifest.required IS DISTINCT FROM data_class.mandatory
      )
  ) THEN
    RAISE EXCEPTION 'account_deletion_source_manifest_class_coverage_invalid' USING ERRCODE = '55000';
  END IF;

  FOR v_manifest IN
    SELECT *
    FROM privacy_retention.account_deletion_source_manifest
    WHERE policy_version = p_policy_version
    ORDER BY ordinal, code
  LOOP
    SELECT * INTO v_registry
    FROM privacy_retention.account_deletion_adapter_registry
    WHERE adapter_name = v_manifest.adapter_name;

    SELECT * INTO v_class
    FROM public.account_deletion_data_classes
    WHERE policy_version = p_policy_version
      AND code = v_manifest.code;

    IF NOT FOUND
       OR v_registry.code IS DISTINCT FROM v_manifest.code
       OR v_registry.relation_name IS DISTINCT FROM v_manifest.relation_name
       OR v_registry.subject_column IS DISTINCT FROM v_manifest.subject_column
       OR v_registry.disposition IS DISTINCT FROM v_class.disposition
       OR v_registry.ordinal IS DISTINCT FROM v_manifest.ordinal
       OR v_manifest.contract_hash IS DISTINCT FROM
          privacy_retention.g014_account_deletion_manifest_contract_hash(
            v_manifest.policy_version, v_manifest.code, v_manifest.relation_name,
            v_manifest.subject_column, v_manifest.adapter_name, v_manifest.required,
            v_manifest.ordinal
          ) THEN
      RAISE EXCEPTION 'account_deletion_source_manifest_adapter_contract_invalid: %',
        v_manifest.code USING ERRCODE = '55000';
    END IF;

    v_relation := pg_catalog.to_regclass(v_manifest.relation_name);
    IF v_relation IS NULL THEN
      RAISE EXCEPTION 'account_deletion_source_relation_missing: %',
        v_manifest.relation_name USING ERRCODE = '55000';
    END IF;
    SELECT attribute.attnum, attribute.atttypid
    INTO v_attnum, v_actual_type
    FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = v_relation
      AND attribute.attname = v_manifest.subject_column
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped;
    IF NOT FOUND OR v_actual_type IS DISTINCT FROM v_registry.subject_type::oid THEN
      RAISE EXCEPTION 'account_deletion_source_column_or_type_invalid: %.%',
        v_manifest.relation_name, v_manifest.subject_column USING ERRCODE = '55000';
    END IF;

    IF v_registry.expected_fk_relation IS NULL THEN
      IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_row
        WHERE constraint_row.conrelid = v_relation
          AND constraint_row.contype = 'f'
          AND v_attnum = ANY (constraint_row.conkey)
      ) THEN
        RAISE EXCEPTION 'account_deletion_source_unexpected_fk: %.%',
          v_manifest.relation_name, v_manifest.subject_column USING ERRCODE = '55000';
      END IF;
    ELSE
      v_expected_fk := pg_catalog.to_regclass(v_registry.expected_fk_relation);
      IF v_expected_fk IS NULL THEN
        RAISE EXCEPTION 'account_deletion_source_fk_invalid: %.%',
          v_manifest.relation_name, v_manifest.subject_column USING ERRCODE = '55000';
      END IF;
      SELECT attribute.attnum INTO v_expected_fk_attnum
      FROM pg_catalog.pg_attribute AS attribute
      WHERE attribute.attrelid = v_expected_fk
        AND attribute.attname = v_registry.expected_fk_column
        AND attribute.attnum > 0
        AND NOT attribute.attisdropped;
      IF NOT FOUND
         OR (SELECT count(*)
             FROM pg_catalog.pg_constraint AS constraint_row
             WHERE constraint_row.conrelid = v_relation
               AND constraint_row.contype = 'f'
               AND v_attnum = ANY (constraint_row.conkey)) <> 1
         OR NOT EXISTS (
           SELECT 1
           FROM pg_catalog.pg_constraint AS constraint_row
           WHERE constraint_row.conrelid = v_relation
             AND constraint_row.contype = 'f'
             AND constraint_row.confrelid = v_expected_fk
             AND constraint_row.conkey = ARRAY[v_attnum]
             AND constraint_row.confkey = ARRAY[v_expected_fk_attnum]
         ) THEN
        RAISE EXCEPTION 'account_deletion_source_fk_invalid: %.%',
          v_manifest.relation_name, v_manifest.subject_column USING ERRCODE = '55000';
      END IF;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM privacy_retention.account_deletion_source_manifest
    WHERE policy_version = p_policy_version
  ) THEN
    RAISE EXCEPTION 'account_deletion_source_manifest_missing' USING ERRCODE = '55000';
  END IF;
  RETURN privacy_retention.g014_account_deletion_manifest_hash(p_policy_version);
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_append_audit(
  p_request public.account_deletion_requests,
  p_status text,
  p_reason_code text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_requested integer;
BEGIN
  SELECT COALESCE(sum(item.planned_count), 0)::integer INTO v_requested
  FROM public.account_deletion_request_items AS item
  WHERE item.request_id = p_request.id;
  -- The request binds actor/target immutably.  The retained audit is deliberately
  -- minimized: it stores only the subject hash produced by its trusted appender.
  RETURN privacy_retention.append_privacy_audit_event_internal(
    'account_deletion',
    NULL,
    p_request.target_user_id,
    p_request.id,
    p_request.id,
    p_status,
    p_reason_code,
    pg_catalog.jsonb_build_object('requested', v_requested),
    pg_catalog.jsonb_build_object('route', '/api/account/delete')
  );
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_evidence_cleanup_allowed(
  p_request_id uuid,
  p_target_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_request_id IS NULL
     OR p_target_user_id IS NULL
     OR pg_catalog.current_setting('app.account_deletion_request_id', true) IS DISTINCT FROM p_request_id::text
     OR pg_catalog.current_setting('app.account_deletion_target_user_id', true) IS DISTINCT FROM p_target_user_id::text
     OR pg_catalog.current_setting('app.account_deletion_evidence_cleanup', true) IS DISTINCT FROM 'g014-v1'
     OR pg_catalog.current_setting('app.account_deletion_evidence_lease_token', true) IS NULL THEN
    RETURN false;
  END IF;
  RETURN EXISTS (
    SELECT 1
    FROM public.account_deletion_requests AS request_row
    JOIN privacy_retention.account_deletion_evidence_cleanup_leases AS lease_row
      ON lease_row.request_id = request_row.id
     AND lease_row.target_user_id = request_row.target_user_id
    WHERE request_row.id = p_request_id
      AND request_row.target_user_id = p_target_user_id
      AND request_row.status IN ('applying', 'partial')
      AND lease_row.lease_token::text =
          pg_catalog.current_setting('app.account_deletion_evidence_lease_token', true)
      AND lease_row.status = 'active'
      AND lease_row.lease_expires_at > pg_catalog.clock_timestamp()
  ) AND NOT EXISTS (
    SELECT 1
    FROM privacy_retention.privacy_legal_holds AS hold_row
    JOIN privacy_retention.account_deletion_hold_class_map AS map_row
      ON map_row.hold_data_class = hold_row.data_class
    WHERE map_row.deletion_class = 'account_deletion'
      AND hold_row.subject_ref_hash = privacy_retention.g014_account_deletion_subject_hash(p_target_user_id)
      AND hold_row.status = 'active'
      AND (hold_row.expires_at IS NULL OR hold_row.expires_at > pg_catalog.clock_timestamp())
  );
END;
$function$;
DROP FUNCTION IF EXISTS privacy_retention.g014_account_deletion_enable_evidence_cleanup(uuid,uuid);
CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_enable_evidence_cleanup(
  p_request_id uuid,
  p_target_user_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_lease privacy_retention.account_deletion_evidence_cleanup_leases%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  PERFORM privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id);
  IF NOT EXISTS (
    SELECT 1
    FROM public.account_deletion_requests AS request_row
    WHERE request_row.id = p_request_id
      AND request_row.target_user_id = p_target_user_id
      AND request_row.status IN ('applying', 'partial')
  ) THEN
    RAISE EXCEPTION 'account_deletion_evidence_cleanup_request_invalid' USING ERRCODE = '55000';
  END IF;
  UPDATE privacy_retention.account_deletion_evidence_cleanup_leases
  SET status = 'released', released_at = v_now
  WHERE request_id = p_request_id
    AND status = 'active'
    AND lease_expires_at <= v_now;
  INSERT INTO privacy_retention.account_deletion_evidence_cleanup_leases (
    request_id, target_user_id, lease_token, status, claimed_at, lease_expires_at
  ) VALUES (
    p_request_id, p_target_user_id, extensions.gen_random_uuid(),
    'active', v_now, v_now + interval '5 minutes'
  ) ON CONFLICT (request_id) DO UPDATE
    SET target_user_id = EXCLUDED.target_user_id,
        lease_token = EXCLUDED.lease_token,
        status = EXCLUDED.status,
        claimed_at = EXCLUDED.claimed_at,
        lease_expires_at = EXCLUDED.lease_expires_at,
        released_at = NULL
    WHERE privacy_retention.account_deletion_evidence_cleanup_leases.status = 'released';
  SELECT * INTO v_lease
  FROM privacy_retention.account_deletion_evidence_cleanup_leases
  WHERE request_id = p_request_id
    AND target_user_id = p_target_user_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_lease.status IS DISTINCT FROM 'active'
     OR v_lease.lease_expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'account_deletion_evidence_cleanup_lease_invalid' USING ERRCODE = '55000';
  END IF;
  PERFORM pg_catalog.set_config('app.account_deletion_request_id', p_request_id::text, true);
  PERFORM pg_catalog.set_config('app.account_deletion_target_user_id', p_target_user_id::text, true);
  PERFORM pg_catalog.set_config('app.account_deletion_evidence_cleanup', 'g014-v1', true);
  PERFORM pg_catalog.set_config('app.account_deletion_evidence_lease_token', v_lease.lease_token::text, true);
  RETURN v_lease.lease_token;
END;
$function$;
CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_release_evidence_cleanup(
  p_request_id uuid,
  p_target_user_id uuid,
  p_lease_token uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_request_id IS NULL OR p_target_user_id IS NULL OR p_lease_token IS NULL THEN
    RAISE EXCEPTION 'account_deletion_evidence_cleanup_release_arguments_required' USING ERRCODE = '22004';
  END IF;
  UPDATE privacy_retention.account_deletion_evidence_cleanup_leases
  SET status = 'released', released_at = pg_catalog.clock_timestamp()
  WHERE request_id = p_request_id
    AND target_user_id = p_target_user_id
    AND lease_token = p_lease_token
    AND status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_evidence_cleanup_release_invalid' USING ERRCODE = '55000';
  END IF;
END;
$function$;
CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_provider_proof_lease_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_external_phase_leases AS lease_row
    WHERE lease_row.request_id = NEW.request_id
      AND lease_row.target_user_id = NEW.target_user_id
      AND lease_row.phase = NEW.phase
      AND lease_row.lease_token = NEW.lease_token
      AND lease_row.status = 'active'
      AND lease_row.lease_expires_at > pg_catalog.clock_timestamp()
      AND NEW.verified_at >= lease_row.claimed_at
      AND NEW.verified_at <= lease_row.lease_expires_at
  ) THEN
    RAISE EXCEPTION 'account_deletion_provider_proof_lease_invalid' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS g014_account_deletion_provider_proof_lease_guard
  ON privacy_retention.account_deletion_provider_receipt_proofs;
CREATE TRIGGER g014_account_deletion_provider_proof_lease_guard
BEFORE INSERT ON privacy_retention.account_deletion_provider_receipt_proofs
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_account_deletion_provider_proof_lease_guard();

CREATE OR REPLACE FUNCTION public.privacy_reject_immutable_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request_id uuid;
  v_target_user_id uuid;
BEGIN
  BEGIN
    v_request_id := pg_catalog.current_setting('app.account_deletion_request_id', true)::uuid;
    v_target_user_id := pg_catalog.current_setting('app.account_deletion_target_user_id', true)::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'privacy_append_only_mutation_denied' USING ERRCODE = '55000';
  END;

  IF TG_TABLE_NAME = 'privacy_consent_events'
     AND TG_OP = 'DELETE'
     AND OLD.user_id = v_target_user_id
     AND privacy_retention.g014_account_deletion_evidence_cleanup_allowed(v_request_id, v_target_user_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'privacy_append_only_mutation_denied' USING ERRCODE = '55000';
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_marketing_reject_evidence_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request_id uuid;
  v_target_user_id uuid;
BEGIN
  BEGIN
    v_request_id := pg_catalog.current_setting('app.account_deletion_request_id', true)::uuid;
    v_target_user_id := pg_catalog.current_setting('app.account_deletion_target_user_id', true)::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'marketing_consent_evidence_is_append_only' USING ERRCODE = '55000';
  END;
  IF TG_OP = 'DELETE'
     AND OLD.user_id = v_target_user_id
     AND privacy_retention.g014_account_deletion_evidence_cleanup_allowed(v_request_id, v_target_user_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'marketing_consent_evidence_is_append_only' USING ERRCODE = '55000';
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_apply_adapter(
  p_adapter_name text,
  p_request_id uuid,
  p_target_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_registry privacy_retention.account_deletion_adapter_registry%ROWTYPE;
  v_evidence_count integer;
BEGIN
  IF p_adapter_name IS NULL OR p_request_id IS NULL OR p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'account_deletion_adapter_arguments_required' USING ERRCODE = '22004';
  END IF;
  SELECT * INTO v_registry
  FROM privacy_retention.account_deletion_adapter_registry
  WHERE adapter_name = p_adapter_name;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_unregistered_adapter: %', p_adapter_name USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id);

  CASE p_adapter_name
    WHEN 'marketing_campaign_recipients_adapter' THEN
      PERFORM privacy_retention.g014_account_deletion_enable_evidence_cleanup(p_request_id, p_target_user_id);
      SELECT count(*) INTO v_evidence_count
      FROM privacy_retention.marketing_campaign_consent_evidence_keys
      WHERE user_id = p_target_user_id;
      INSERT INTO privacy_retention.account_deletion_evidence_separations (
        request_id, data_class_code, source_count, source_snapshot_hash
      ) VALUES (
        p_request_id, 'marketing_campaign_recipients', v_evidence_count,
        pg_catalog.encode(extensions.digest(
          pg_catalog.jsonb_build_object('class', 'marketing_campaign_recipients', 'count', v_evidence_count)::text,
          'sha256'
        ), 'hex')
      ) ON CONFLICT (request_id, data_class_code) DO NOTHING;
      DELETE FROM privacy_retention.marketing_campaign_consent_evidence_keys
      WHERE user_id = p_target_user_id;
      DELETE FROM privacy_retention.marketing_campaign_batch_recipients
      WHERE user_id = p_target_user_id;
      DELETE FROM public.notifications
      WHERE user_id = p_target_user_id;
      DELETE FROM public.marketing_campaign_recipients
      WHERE user_id = p_target_user_id;
      UPDATE public.marketing_campaign_operations
      SET actor_user_id = NULL
      WHERE actor_user_id = p_target_user_id;
      IF EXISTS (SELECT 1 FROM privacy_retention.marketing_campaign_consent_evidence_keys WHERE user_id = p_target_user_id)
         OR EXISTS (SELECT 1 FROM privacy_retention.marketing_campaign_batch_recipients WHERE user_id = p_target_user_id)
         OR EXISTS (SELECT 1 FROM public.notifications WHERE user_id = p_target_user_id)
         OR EXISTS (SELECT 1 FROM public.marketing_campaign_recipients WHERE user_id = p_target_user_id)
         OR EXISTS (SELECT 1 FROM public.marketing_campaign_operations WHERE actor_user_id = p_target_user_id) THEN
        RAISE EXCEPTION 'account_deletion_marketing_source_readback_failed' USING ERRCODE = '55000';
      END IF;

    WHEN 'notifications_adapter' THEN
      DELETE FROM public.notifications WHERE user_id = p_target_user_id;
      IF EXISTS (SELECT 1 FROM public.notifications WHERE user_id = p_target_user_id) THEN
        RAISE EXCEPTION 'account_deletion_notifications_source_readback_failed' USING ERRCODE = '55000';
      END IF;

    WHEN 'privacy_identity_adapter' THEN
      PERFORM privacy_retention.g014_account_deletion_enable_evidence_cleanup(p_request_id, p_target_user_id);
      SELECT count(*) INTO v_evidence_count
      FROM privacy_retention.privacy_consent_events
      WHERE user_id = p_target_user_id;
      INSERT INTO privacy_retention.account_deletion_evidence_separations (
        request_id, data_class_code, source_count, source_snapshot_hash
      ) VALUES (
        p_request_id, 'privacy_identity_records', v_evidence_count,
        pg_catalog.encode(extensions.digest(
          pg_catalog.jsonb_build_object('class', 'privacy_identity_records', 'count', v_evidence_count)::text,
          'sha256'
        ), 'hex')
      ) ON CONFLICT (request_id, data_class_code) DO NOTHING;
      DELETE FROM public.notifications AS notification
      USING privacy_retention.privacy_consent_events AS consent
      WHERE notification.consent_event_id = consent.id
        AND consent.user_id = p_target_user_id;
      DELETE FROM privacy_retention.marketing_campaign_consent_evidence_keys
      WHERE user_id = p_target_user_id;
      DELETE FROM privacy_retention.marketing_campaign_batch_recipients
      WHERE user_id = p_target_user_id;
      DELETE FROM privacy_retention.privacy_consent_events
      WHERE user_id = p_target_user_id;
      DELETE FROM privacy_retention.privacy_age_profiles
      WHERE user_id = p_target_user_id;
      DELETE FROM privacy_retention.privacy_guardian_verifications
      WHERE child_user_id = p_target_user_id;
      DELETE FROM privacy_retention.privacy_onboarding_challenges
      WHERE consumed_by_user_id = p_target_user_id;
      IF EXISTS (SELECT 1 FROM privacy_retention.marketing_campaign_consent_evidence_keys WHERE user_id = p_target_user_id)
         OR EXISTS (SELECT 1 FROM privacy_retention.privacy_consent_events WHERE user_id = p_target_user_id)
         OR EXISTS (SELECT 1 FROM privacy_retention.privacy_age_profiles WHERE user_id = p_target_user_id)
         OR EXISTS (SELECT 1 FROM privacy_retention.privacy_guardian_verifications WHERE child_user_id = p_target_user_id)
         OR EXISTS (SELECT 1 FROM privacy_retention.privacy_onboarding_challenges WHERE consumed_by_user_id = p_target_user_id) THEN
        RAISE EXCEPTION 'account_deletion_privacy_source_readback_failed' USING ERRCODE = '55000';
      END IF;

    WHEN 'privacy_audit_adapter' THEN
      SELECT count(*) INTO v_evidence_count
      FROM privacy_retention.privacy_audit_events
      WHERE actor_user_id = p_target_user_id;
      INSERT INTO privacy_retention.account_deletion_evidence_separations (
        request_id, data_class_code, source_count, source_snapshot_hash
      ) VALUES (
        p_request_id, 'privacy_audit_actor_references', v_evidence_count,
        pg_catalog.encode(extensions.digest(
          pg_catalog.jsonb_build_object(
            'class', 'privacy_audit_actor_references',
            'count', v_evidence_count,
            'subjectHash', privacy_retention.g014_account_deletion_subject_hash(p_target_user_id)
          )::text,
          'sha256'
        ), 'hex')
      ) ON CONFLICT (request_id, data_class_code) DO NOTHING;
      -- Audit rows are append-only detached history.  Their immutable actor
      -- UUID is not live Auth attribution and must never be rewritten.
      IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_row
        JOIN pg_catalog.pg_attribute AS attribute
          ON attribute.attrelid = constraint_row.conrelid
         AND attribute.attnum = ANY (constraint_row.conkey)
        WHERE constraint_row.conrelid = 'privacy_retention.privacy_audit_events'::regclass
          AND constraint_row.contype = 'f'
          AND constraint_row.confrelid = 'auth.users'::regclass
          AND attribute.attname = 'actor_user_id'
      ) OR (SELECT count(*)
            FROM privacy_retention.privacy_audit_events
            WHERE actor_user_id = p_target_user_id) IS DISTINCT FROM v_evidence_count THEN
        RAISE EXCEPTION 'account_deletion_audit_separation_readback_failed' USING ERRCODE = '55000';
      END IF;
      PERFORM privacy_retention.g014_account_deletion_append_audit(
        (SELECT request_row FROM public.account_deletion_requests AS request_row WHERE id = p_request_id),
        'readback_passed',
        'AUDIT_ACTOR_REFERENCE_SEPARATED'
      );

    WHEN 'approved_audit_adapter' THEN
      -- Retained approved history accepts detached immutable actor UUIDs.  Its
      -- readback is the absence of an Auth FK, not absence of historical rows.
      IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_constraint AS constraint_row
        JOIN pg_catalog.pg_attribute AS attribute
          ON attribute.attrelid = constraint_row.conrelid
         AND attribute.attnum = ANY (constraint_row.conkey)
        WHERE constraint_row.conrelid = 'privacy_retention.privacy_audit_events'::regclass
          AND constraint_row.contype = 'f'
          AND constraint_row.confrelid = 'auth.users'::regclass
          AND attribute.attname = 'actor_user_id'
      ) THEN
        RAISE EXCEPTION 'account_deletion_approved_audit_auth_fk_retained' USING ERRCODE = '55000';
      END IF;

    WHEN 'profile_identity_adapter' THEN
      UPDATE public.profiles
      SET nickname = '탈퇴한 사용자', username = NULL, avatar_url = NULL
      WHERE user_id = p_target_user_id;
      IF EXISTS (
        SELECT 1 FROM public.profiles
        WHERE user_id = p_target_user_id
          AND (nickname IS DISTINCT FROM '탈퇴한 사용자' OR username IS NOT NULL OR avatar_url IS NOT NULL)
      ) THEN
        RAISE EXCEPTION 'account_deletion_profile_source_readback_failed' USING ERRCODE = '55000';
      END IF;

    WHEN 'user_statistics_adapter' THEN
      DELETE FROM public.user_stats WHERE user_id = p_target_user_id;
      IF EXISTS (SELECT 1 FROM public.user_stats WHERE user_id = p_target_user_id) THEN
        RAISE EXCEPTION 'account_deletion_user_statistics_source_readback_failed' USING ERRCODE = '55000';
      END IF;
    WHEN 'user_bookmarks_adapter' THEN
      DELETE FROM public.user_bookmarks WHERE user_id = p_target_user_id;
      IF EXISTS (SELECT 1 FROM public.user_bookmarks WHERE user_id = p_target_user_id) THEN
        RAISE EXCEPTION 'account_deletion_user_bookmarks_source_readback_failed' USING ERRCODE = '55000';
      END IF;
    WHEN 'user_preferences_adapter' THEN
      DELETE FROM public.admin_user_preferences WHERE user_id = p_target_user_id;
      IF EXISTS (SELECT 1 FROM public.admin_user_preferences WHERE user_id = p_target_user_id) THEN
        RAISE EXCEPTION 'account_deletion_preferences_source_readback_failed' USING ERRCODE = '55000';
      END IF;
    WHEN 'storyboard_documents_adapter' THEN
      DELETE FROM public.documents WHERE user_id = p_target_user_id;
      IF EXISTS (SELECT 1 FROM public.documents WHERE user_id = p_target_user_id) THEN
        RAISE EXCEPTION 'account_deletion_documents_source_readback_failed' USING ERRCODE = '55000';
      END IF;
    WHEN 'review_likes_adapter' THEN
      DELETE FROM public.review_likes AS review_like
      WHERE review_like.user_id = p_target_user_id
         OR review_like.review_id IN (
           SELECT review.id FROM public.reviews AS review WHERE review.user_id = p_target_user_id
         );
      IF EXISTS (
        SELECT 1 FROM public.review_likes AS review_like
        WHERE review_like.user_id = p_target_user_id
           OR review_like.review_id IN (
             SELECT review.id FROM public.reviews AS review WHERE review.user_id = p_target_user_id
           )
      ) THEN
        RAISE EXCEPTION 'account_deletion_review_likes_source_readback_failed' USING ERRCODE = '55000';
      END IF;
    WHEN 'reviews_adapter' THEN
      DELETE FROM public.reviews WHERE user_id = p_target_user_id;
      IF EXISTS (SELECT 1 FROM public.reviews WHERE user_id = p_target_user_id) THEN
        RAISE EXCEPTION 'account_deletion_reviews_source_readback_failed' USING ERRCODE = '55000';
      END IF;
    WHEN 'submission_drafts_adapter', 'restaurant_submissions_adapter' THEN
      IF pg_catalog.to_regclass('public.restaurant_submission_items') IS NULL THEN
        RAISE EXCEPTION 'account_deletion_submission_child_relation_missing' USING ERRCODE = '55000';
      END IF;
      EXECUTE
        'DELETE FROM public.restaurant_submission_items AS item
           USING public.restaurant_submissions AS submission
         WHERE item.submission_id = submission.id
           AND submission.user_id = $1'
        USING p_target_user_id;
      DELETE FROM public.restaurant_submissions WHERE user_id = p_target_user_id;
      IF EXISTS (SELECT 1 FROM public.restaurant_submissions WHERE user_id = p_target_user_id) THEN
        RAISE EXCEPTION 'account_deletion_restaurant_submissions_readback_failed' USING ERRCODE = '55000';
      END IF;
    WHEN 'restaurant_requests_adapter' THEN
      DELETE FROM public.restaurant_requests WHERE user_id = p_target_user_id;
      IF EXISTS (SELECT 1 FROM public.restaurant_requests WHERE user_id = p_target_user_id) THEN
        RAISE EXCEPTION 'account_deletion_restaurant_requests_source_readback_failed' USING ERRCODE = '55000';
      END IF;
    WHEN 'ocr_logs_adapter' THEN
      DELETE FROM public.ocr_logs WHERE user_id = p_target_user_id;
      IF EXISTS (SELECT 1 FROM public.ocr_logs WHERE user_id = p_target_user_id) THEN
        RAISE EXCEPTION 'account_deletion_ocr_logs_source_readback_failed' USING ERRCODE = '55000';
      END IF;
    WHEN 'retention_work_items_adapter' THEN
      IF EXISTS (
        SELECT 1 FROM privacy_retention.privacy_retention_work_items
        WHERE subject_ref_hash = p_target_user_id::text
      ) THEN
        RAISE EXCEPTION 'account_deletion_retention_work_item_raw_subject_found' USING ERRCODE = '55000';
      END IF;
    WHEN 'storage_objects_adapter', 'auth_identity_adapter' THEN
      NULL;
    ELSE
      RAISE EXCEPTION 'account_deletion_unregistered_adapter: %', p_adapter_name USING ERRCODE = '55000';
  END CASE;
  PERFORM privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id);
END;
$function$;

INSERT INTO privacy_retention.account_deletion_adapter_registry (
  adapter_name, code, relation_name, subject_column, subject_type,
  expected_fk_relation, expected_fk_column, disposition, ordinal
) VALUES
  ('marketing_campaign_recipients_adapter', 'marketing_campaign_recipients', 'public.marketing_campaign_recipients', 'user_id', 'uuid', 'auth.users', 'id', 'delete', 10),
  ('notifications_adapter', 'notifications', 'public.notifications', 'user_id', 'uuid', 'auth.users', 'id', 'delete', 20),
  ('privacy_identity_adapter', 'privacy_identity_records', 'privacy_retention.privacy_consent_events', 'user_id', 'uuid', 'auth.users', 'id', 'delete', 30),
  ('privacy_audit_adapter', 'privacy_audit_actor_references', 'privacy_retention.privacy_audit_events', 'actor_user_id', 'uuid', NULL, NULL, 'separate', 40),
  ('profile_identity_adapter', 'profile_identity', 'public.profiles', 'user_id', 'uuid', 'auth.users', 'id', 'anonymize', 50),
  ('user_statistics_adapter', 'user_statistics', 'public.user_stats', 'user_id', 'uuid', 'auth.users', 'id', 'delete', 60),
  ('user_bookmarks_adapter', 'user_bookmarks', 'public.user_bookmarks', 'user_id', 'uuid', 'auth.users', 'id', 'delete', 70),
  ('user_preferences_adapter', 'user_preferences', 'public.admin_user_preferences', 'user_id', 'uuid', 'auth.users', 'id', 'delete', 80),
  ('storyboard_documents_adapter', 'storyboard_documents', 'public.documents', 'user_id', 'uuid', 'auth.users', 'id', 'delete', 90),
  ('review_likes_adapter', 'review_likes', 'public.review_likes', 'user_id', 'uuid', 'auth.users', 'id', 'delete', 100),
  ('reviews_adapter', 'reviews', 'public.reviews', 'user_id', 'uuid', 'auth.users', 'id', 'delete', 110),
  ('submission_drafts_adapter', 'submission_drafts', 'public.restaurant_submissions', 'user_id', 'uuid', 'auth.users', 'id', 'delete', 120),
  ('restaurant_submissions_adapter', 'restaurant_submissions', 'public.restaurant_submissions', 'user_id', 'uuid', 'auth.users', 'id', 'delete', 130),
  ('restaurant_requests_adapter', 'restaurant_requests', 'public.restaurant_requests', 'user_id', 'uuid', 'auth.users', 'id', 'delete', 140),
  ('ocr_logs_adapter', 'ocr_logs', 'public.ocr_logs', 'user_id', 'uuid', 'auth.users', 'id', 'delete', 150),
  ('approved_audit_adapter', 'approved_audit_records', 'privacy_retention.privacy_audit_events', 'actor_user_id', 'uuid', NULL, NULL, 'retain', 160),
  ('retention_work_items_adapter', 'retention_work_items', 'privacy_retention.privacy_retention_work_items', 'subject_ref_hash', 'text', NULL, NULL, 'separate', 170),
  ('storage_objects_adapter', 'storage_objects', 'storage.objects', 'owner_id', 'text', NULL, NULL, 'delete', 180),
  ('auth_identity_adapter', 'auth_identity', 'auth.users', 'id', 'uuid', NULL, NULL, 'delete', 190)
ON CONFLICT (adapter_name) DO NOTHING;

-- Each canonical data class has exactly one immutable source contract.  An
-- adapter can perform ordered child cleanup, but cannot be reused for another
-- class or relation.
INSERT INTO privacy_retention.account_deletion_source_manifest (
  policy_version, code, relation_name, subject_column, adapter_name, required, ordinal, contract_hash
)
SELECT
  data_class.policy_version,
  data_class.code,
  registry.relation_name,
  registry.subject_column,
  registry.adapter_name,
  data_class.mandatory,
  registry.ordinal,
  privacy_retention.g014_account_deletion_manifest_contract_hash(
    data_class.policy_version, data_class.code, registry.relation_name,
    registry.subject_column, registry.adapter_name, data_class.mandatory, registry.ordinal
  )
FROM public.account_deletion_data_classes AS data_class
JOIN privacy_retention.account_deletion_adapter_registry AS registry
  ON registry.code = data_class.code
ON CONFLICT (policy_version, code) DO NOTHING;
INSERT INTO privacy_retention.account_deletion_policy_publications (
  policy_version,
  publication_idempotency_key,
  operator_approval_ref,
  publication_input_hash,
  source_manifest_hash
)
SELECT
  policy.version,
  'g014-bootstrap:' || policy.version,
  'g014-bootstrap-approval',
  pg_catalog.encode(extensions.digest(
    pg_catalog.concat_ws(
      ':',
      'g014-bootstrap-publication',
      policy.version,
      policy.preview_ttl::text,
      policy.reauth_max_age::text,
      policy.confirmation_text,
      privacy_retention.g014_account_deletion_manifest_hash(policy.version)
    ),
    'sha256'
  ), 'hex'),
  privacy_retention.g014_account_deletion_manifest_hash(policy.version)
FROM public.account_deletion_policies AS policy
ON CONFLICT (policy_version) DO NOTHING;

INSERT INTO privacy_retention.account_deletion_hold_class_map (deletion_class, hold_data_class)
SELECT 'account_deletion', class_code
FROM (VALUES
  ('account_deletion'), ('marketing_campaign_recipients'), ('notifications'),
  ('privacy_identity_records'), ('privacy_audit_actor_references'), ('profile_identity'),
  ('user_statistics'), ('user_bookmarks'), ('user_preferences'), ('storyboard_documents'),
  ('review_likes'), ('reviews'), ('submission_drafts'), ('restaurant_submissions'),
  ('restaurant_requests'), ('ocr_logs'), ('approved_audit_records'), ('retention_work_items'),
  ('storage_objects'), ('auth_identity')
) AS destructive(class_code)
ON CONFLICT (deletion_class, hold_data_class) DO NOTHING;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_hold_subject_lock()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-account-deletion-target-hash:' || NEW.subject_ref_hash, 0)
  );
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_external_phase_leases AS lease_row
    WHERE lease_row.status = 'active'
      AND lease_row.lease_expires_at > pg_catalog.clock_timestamp()
      AND privacy_retention.g014_account_deletion_subject_hash(lease_row.target_user_id)
        IS NOT DISTINCT FROM NEW.subject_ref_hash
  ) THEN
    RAISE EXCEPTION 'account_deletion_external_lease_blocks_hold_creation' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS g014_account_deletion_hold_subject_lock ON privacy_retention.privacy_legal_holds;
CREATE TRIGGER g014_account_deletion_hold_subject_lock
BEFORE INSERT OR UPDATE ON privacy_retention.privacy_legal_holds
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_account_deletion_hold_subject_lock();
INSERT INTO privacy_retention.account_deletion_policy_activation_history (
  policy_version, activated_at, activation_idempotency_key, operator_approval_ref
)
SELECT
  policy.version,
  policy.created_at,
  'g014-bootstrap-activation:' || policy.version,
  'g014-bootstrap-approval'
FROM public.account_deletion_policies AS policy
WHERE policy.status = 'active'
ON CONFLICT (policy_version) DO NOTHING;


CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_prevent_activated_policy_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM privacy_retention.account_deletion_policy_activation_history
    WHERE policy_version = OLD.version
  ) THEN
    RAISE EXCEPTION 'ever_activated_account_deletion_policy_is_immutable' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND EXISTS (
    SELECT 1 FROM privacy_retention.account_deletion_policy_activation_history
    WHERE policy_version = OLD.version
  ) AND NOT (
    OLD.status = 'active'
    AND NEW.status = 'disabled'
    AND NEW.version IS NOT DISTINCT FROM OLD.version
    AND NEW.preview_ttl IS NOT DISTINCT FROM OLD.preview_ttl
    AND NEW.reauth_max_age IS NOT DISTINCT FROM OLD.reauth_max_age
    AND NEW.confirmation_text IS NOT DISTINCT FROM OLD.confirmation_text
  ) THEN
    RAISE EXCEPTION 'ever_activated_account_deletion_policy_is_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
DROP TRIGGER IF EXISTS g014_account_deletion_policy_immutable ON public.account_deletion_policies;
CREATE TRIGGER g014_account_deletion_policy_immutable
BEFORE UPDATE OR DELETE ON public.account_deletion_policies
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_account_deletion_prevent_activated_policy_mutation();
CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_prevent_activated_class_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_policy_activation_history AS history
    WHERE history.policy_version = CASE WHEN TG_OP = 'INSERT' THEN NEW.policy_version ELSE OLD.policy_version END
  ) THEN
    RAISE EXCEPTION 'ever_activated_account_deletion_class_is_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
DROP TRIGGER IF EXISTS g014_account_deletion_data_class_immutable ON public.account_deletion_data_classes;
CREATE TRIGGER g014_account_deletion_data_class_immutable
BEFORE INSERT OR UPDATE OR DELETE ON public.account_deletion_data_classes
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_account_deletion_prevent_activated_class_mutation();

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_prevent_manifest_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_policy_activation_history AS history
    WHERE history.policy_version = CASE WHEN TG_OP = 'INSERT' THEN NEW.policy_version ELSE OLD.policy_version END
  ) THEN
    RAISE EXCEPTION 'ever_activated_account_deletion_manifest_is_immutable' USING ERRCODE = '55000';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;
DROP TRIGGER IF EXISTS g014_account_deletion_manifest_immutable ON privacy_retention.account_deletion_source_manifest;
CREATE TRIGGER g014_account_deletion_manifest_immutable
BEFORE INSERT OR UPDATE OR DELETE ON privacy_retention.account_deletion_source_manifest
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_account_deletion_prevent_manifest_mutation();

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_SCHEMA || '.' || TG_TABLE_NAME USING ERRCODE = '55000';
  RETURN OLD;
END;
$function$;

DO $append_only$
DECLARE
  v_table regclass;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'privacy_retention.account_deletion_adapter_registry'::regclass,
    'privacy_retention.account_deletion_hold_class_map'::regclass,
    'privacy_retention.account_deletion_client_cleanup_contracts'::regclass,
    'privacy_retention.account_deletion_policy_activation_history'::regclass,
    'privacy_retention.account_deletion_policy_publications'::regclass,
    'privacy_retention.account_deletion_evidence_separations'::regclass,
    'privacy_retention.account_deletion_storage_objects'::regclass,
    'privacy_retention.account_deletion_provider_receipt_proofs'::regclass,
    'privacy_retention.account_deletion_storage_receipts'::regclass
  ] LOOP
    EXECUTE pg_catalog.format('DROP TRIGGER IF EXISTS g014_account_deletion_append_only ON %s', v_table);
    EXECUTE pg_catalog.format(
      'CREATE TRIGGER g014_account_deletion_append_only BEFORE UPDATE OR DELETE ON %s FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_account_deletion_append_only()',
      v_table
    );
  END LOOP;
END;
$append_only$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_request_binding_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
     OR NEW.target_user_id IS DISTINCT FROM OLD.target_user_id
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.preview_hash IS DISTINCT FROM OLD.preview_hash
     OR NEW.preview_expires_at IS DISTINCT FROM OLD.preview_expires_at
     OR NEW.reauthenticated_at IS DISTINCT FROM OLD.reauthenticated_at
     OR NEW.source_manifest_hash IS DISTINCT FROM OLD.source_manifest_hash
     OR (OLD.idempotency_key IS NOT NULL AND NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key)
     OR (OLD.storage_receipts_hash IS NOT NULL AND NEW.storage_receipts_hash IS DISTINCT FROM OLD.storage_receipts_hash)
     OR (OLD.auth_receipt_ref IS NOT NULL AND NEW.auth_receipt_ref IS DISTINCT FROM OLD.auth_receipt_ref) THEN
    RAISE EXCEPTION 'account_deletion_request_binding_is_immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'previewed' AND NEW.status IN ('previewed', 'applying', 'partial', 'expired', 'cancelled'))
    OR (OLD.status = 'applying' AND NEW.status IN ('applying', 'partial', 'applied'))
    OR (OLD.status = 'partial' AND NEW.status IN ('partial', 'applying', 'applied'))
    OR (OLD.status IN ('applied', 'expired', 'cancelled') AND NEW.status = OLD.status)
  ) THEN
    RAISE EXCEPTION 'account_deletion_predecessor_state_invalid' USING ERRCODE = '55000';
  END IF;
  IF NEW.status = 'applied' AND NOT (
    NEW.db_readback_passed AND NEW.session_readback_passed
    AND NEW.storage_readback_passed AND NEW.auth_readback_passed
    AND NEW.applied_at IS NOT NULL
    AND NEW.auth_receipt_ref IS NOT NULL
    AND NEW.auth_receipt_ref ~ '^auth:[0-9a-f]{64}$'
  ) THEN
    RAISE EXCEPTION 'account_deletion_applied_receipt_invalid' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_item_binding_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $function$
BEGIN
  IF NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.data_class_code IS DISTINCT FROM OLD.data_class_code
     OR NEW.disposition IS DISTINCT FROM OLD.disposition
     OR NEW.mandatory IS DISTINCT FROM OLD.mandatory
     OR NEW.planned_count IS DISTINCT FROM OLD.planned_count THEN
    RAISE EXCEPTION 'account_deletion_item_binding_is_immutable' USING ERRCODE = '55000';
  END IF;
  IF NOT (
    (OLD.status = 'planned' AND NEW.status IN ('planned', 'applied', 'retained', 'separated', 'failed'))
    OR (OLD.status IN ('applied', 'retained', 'separated', 'failed') AND NEW.status = OLD.status)
  ) THEN
    RAISE EXCEPTION 'account_deletion_item_predecessor_invalid' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS g014_account_deletion_item_binding_guard ON public.account_deletion_request_items;
CREATE TRIGGER g014_account_deletion_item_binding_guard
BEFORE UPDATE ON public.account_deletion_request_items
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_account_deletion_item_binding_guard();

UPDATE public.account_deletion_requests AS request
SET source_manifest_hash = privacy_retention.g014_account_deletion_manifest_hash(request.policy_version)
WHERE request.source_manifest_hash IS NULL;
ALTER TABLE public.account_deletion_requests
  ALTER COLUMN source_manifest_hash SET NOT NULL;
DROP TRIGGER IF EXISTS g014_account_deletion_request_binding_guard ON public.account_deletion_requests;
CREATE TRIGGER g014_account_deletion_request_binding_guard
BEFORE UPDATE ON public.account_deletion_requests
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_account_deletion_request_binding_guard();

CREATE OR REPLACE FUNCTION public.account_deletion_require_service_role()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM privacy_retention.g014_account_deletion_require_service_role();
END;
$function$;

CREATE OR REPLACE FUNCTION public.account_deletion_subject_hash(p_user_id uuid)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT privacy_retention.g014_account_deletion_subject_hash(p_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.account_deletion_is_active_admin(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT privacy_retention.g014_account_deletion_is_active_admin(p_user_id);
$function$;

CREATE OR REPLACE FUNCTION public.account_deletion_write_audit(
  p_request public.account_deletion_requests,
  p_status text,
  p_reason_code text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_request.id IS NULL OR p_status IS NULL OR p_reason_code IS NULL THEN
    RAISE EXCEPTION 'account_deletion_audit_arguments_required' USING ERRCODE = '22004';
  END IF;
  RETURN privacy_retention.g014_account_deletion_append_audit(p_request, p_status, p_reason_code);
END;
$function$;
CREATE OR REPLACE FUNCTION public.account_deletion_reason_code_is_safe(p_value text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $function$
  SELECT p_value = ANY (ARRAY[
    'ACTOR_NOT_ALLOWED', 'ACTOR_OR_TARGET_REQUIRED', 'APPLIED', 'APPLY_NOT_STARTED',
    'APPLY_STARTED', 'AUTH_CLEANUP_FAILED', 'AUTH_READBACK_PASSED',
    'CONFIRMATION_REQUIRED', 'DB_AND_SESSION_READBACK_PASSED', 'DB_CLEANUP_FAILED',
    'DB_OR_SESSION_CLEANUP_FAILED', 'DB_READBACK_PASSED', 'IDEMPOTENCY_KEY_MISMATCH',
    'INVALID_APPLY_REQUEST', 'LAST_ADMIN_PROTECTED', 'LEGAL_HOLD_ACTIVE',
    'POLICY_CHANGED', 'POLICY_UNAVAILABLE', 'PREVIEW_CANCELLED', 'PREVIEW_EXPIRED',
    'PREVIEW_NOT_FOUND', 'PREVIEW_READY', 'REAUTH_REQUIRED', 'REPLAYED_PREVIEW',
    'RETENTION_POLICY_UNAVAILABLE', 'SESSION_READBACK_REQUIRED',
    'STORAGE_CLEANUP_FAILED', 'STORAGE_READBACK_PASSED'
  ]::text[]);
$function$;
CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_transition_preview_terminal(
  p_target_user_id uuid,
  p_request_id uuid,
  p_terminal_status text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_reason_code text;
BEGIN
  IF p_target_user_id IS NULL
     OR p_request_id IS NULL
     OR p_terminal_status NOT IN ('expired', 'cancelled') THEN
    RAISE EXCEPTION 'account_deletion_preview_terminal_arguments_invalid'
      USING ERRCODE = '22004';
  END IF;

  PERFORM privacy_retention.g014_account_deletion_lock_target(p_target_user_id);
  SELECT * INTO v_request
  FROM public.account_deletion_requests
  WHERE id = p_request_id
    AND target_user_id = p_target_user_id
  FOR UPDATE;
  IF NOT FOUND OR v_request.status <> 'previewed' THEN
    RETURN false;
  END IF;
  IF p_terminal_status = 'expired'
     AND v_request.preview_expires_at > pg_catalog.clock_timestamp() THEN
    RETURN false;
  END IF;

  v_reason_code := CASE p_terminal_status
    WHEN 'expired' THEN 'PREVIEW_EXPIRED'
    ELSE 'PREVIEW_CANCELLED'
  END;
  UPDATE public.account_deletion_requests
  SET status = p_terminal_status,
      reason_code = v_reason_code
  WHERE id = v_request.id
  RETURNING * INTO v_request;
  PERFORM privacy_retention.g014_account_deletion_append_audit(
    v_request, p_terminal_status, v_reason_code
  );
  RETURN true;
END;
$function$;
ALTER FUNCTION privacy_retention.g014_account_deletion_transition_preview_terminal(uuid,uuid,text)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_account_deletion_transition_preview_terminal(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated, service_role;

DROP FUNCTION IF EXISTS public.preview_account_deletion(uuid, uuid, timestamptz);

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
  retain_count integer,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_policy public.account_deletion_policies%ROWTYPE;
  v_request public.account_deletion_requests%ROWTYPE;
  v_manifest_hash text;
  v_last_sign_in_at timestamptz;
  v_counts jsonb := '{}'::jsonb;
  v_subject_value text;
  v_item record;
  v_count integer;
  v_abandoned_request_id uuid;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_require_service_role();
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_reauthenticated_at IS NULL THEN
    RAISE EXCEPTION 'account_deletion_preview_arguments_required' USING ERRCODE = '22004';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_lock_target(p_target_user_id);
  PERFORM privacy_retention.g014_account_deletion_assert_actor_allowed(p_actor_user_id, p_target_user_id);
  PERFORM privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id);
  SELECT user_row.last_sign_in_at INTO v_last_sign_in_at
  FROM auth.users AS user_row WHERE user_row.id = p_actor_user_id;
  IF v_last_sign_in_at IS NULL OR abs(EXTRACT(EPOCH FROM (p_reauthenticated_at - v_last_sign_in_at))) > 1 THEN
    RAISE EXCEPTION 'account_deletion_reauthentication_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_policy
  FROM public.account_deletion_policies AS policy
  WHERE policy.status = 'active'
  FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'account_deletion_policy_unavailable' USING ERRCODE = '55000'; END IF;
  IF v_last_sign_in_at < pg_catalog.clock_timestamp() - v_policy.reauth_max_age
     OR NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_target_user_id) THEN
    RAISE EXCEPTION 'account_deletion_target_or_reauthentication_invalid' USING ERRCODE = '55000';
  END IF;
  v_manifest_hash := privacy_retention.g014_account_deletion_validate_manifest(v_policy.version);
  FOR v_item IN
    SELECT manifest.*, registry.subject_type
    FROM privacy_retention.account_deletion_source_manifest AS manifest
    JOIN privacy_retention.account_deletion_adapter_registry AS registry ON registry.adapter_name = manifest.adapter_name
    WHERE manifest.policy_version = v_policy.version
    ORDER BY manifest.ordinal, manifest.code
  LOOP
    v_subject_value := CASE WHEN v_item.subject_type = 'text'::regtype
      THEN privacy_retention.g014_account_deletion_subject_hash(p_target_user_id)
      ELSE p_target_user_id::text END;
    v_count := privacy_retention.g014_account_deletion_source_count(
      v_item.relation_name, v_item.subject_column, v_subject_value
    );
    v_counts := pg_catalog.jsonb_set(
      v_counts,
      ARRAY[v_item.code],
      pg_catalog.to_jsonb(COALESCE((v_counts ->> v_item.code)::integer, 0) + v_count),
      true
    );
  END LOOP;
  SELECT request_row.id INTO v_abandoned_request_id
  FROM public.account_deletion_requests AS request_row
  WHERE request_row.target_user_id = p_target_user_id
    AND request_row.status = 'previewed'
    AND request_row.preview_expires_at <= pg_catalog.clock_timestamp()
  FOR UPDATE;

  IF FOUND THEN
    PERFORM privacy_retention.g014_account_deletion_transition_preview_terminal(
      p_target_user_id, v_abandoned_request_id, 'expired'
    );
  END IF;
  INSERT INTO public.account_deletion_requests (
    actor_user_id, target_user_id, policy_version, preview_hash, preview_expires_at,
    reauthenticated_at, status, reason_code, count_summary, source_manifest_hash
  ) VALUES (
    p_actor_user_id, p_target_user_id, v_policy.version,
    pg_catalog.encode(extensions.digest(
      pg_catalog.jsonb_build_object(
        'actor', p_actor_user_id, 'target', p_target_user_id, 'policy', v_policy.version,
        'manifest', v_manifest_hash, 'reauthenticatedAt', p_reauthenticated_at, 'counts', v_counts,
        'nonce', extensions.gen_random_uuid()
      )::text, 'sha256'
    ), 'hex'),
    pg_catalog.clock_timestamp() + v_policy.preview_ttl,
    p_reauthenticated_at, 'previewed', 'PREVIEW_READY',
    pg_catalog.jsonb_build_object('requested', COALESCE((SELECT sum((value #>> '{}')::integer) FROM pg_catalog.jsonb_each(v_counts)), 0)),
    v_manifest_hash
  ) RETURNING * INTO v_request;
  INSERT INTO public.account_deletion_request_items (
    request_id, data_class_code, disposition, mandatory, planned_count, status, reason_code
  )
  SELECT
    v_request.id, data_class.code, data_class.disposition, data_class.mandatory,
    COALESCE((v_counts ->> data_class.code)::integer, 0), 'planned', 'PREVIEW_READY'
  FROM public.account_deletion_data_classes AS data_class
  WHERE data_class.policy_version = v_policy.version;
  PERFORM privacy_retention.g014_account_deletion_append_audit(v_request, 'previewed', 'PREVIEW_READY');
  RETURN QUERY SELECT
    v_request.id, v_request.preview_hash, v_request.preview_expires_at, v_request.policy_version,
    v_request.status, v_request.reason_code,
    COALESCE((SELECT sum(planned_count) FILTER (WHERE disposition = 'delete') FROM public.account_deletion_request_items WHERE request_id = v_request.id), 0)::integer,
    COALESCE((SELECT sum(planned_count) FILTER (WHERE disposition = 'anonymize') FROM public.account_deletion_request_items WHERE request_id = v_request.id), 0)::integer,
    COALESCE((SELECT sum(planned_count) FILTER (WHERE disposition = 'separate') FROM public.account_deletion_request_items WHERE request_id = v_request.id), 0)::integer,
    COALESCE((SELECT sum(planned_count) FILTER (WHERE disposition = 'retain') FROM public.account_deletion_request_items WHERE request_id = v_request.id), 0)::integer,
    v_request.source_manifest_hash;
END;
$function$;
-- OUT schemas and signatures are intentionally replaced, never overloaded.
DROP FUNCTION IF EXISTS public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz);
DROP FUNCTION IF EXISTS public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text);
DROP FUNCTION IF EXISTS public.apply_account_deletion_database_cleanup(uuid,uuid);
DROP FUNCTION IF EXISTS public.apply_account_deletion_database_cleanup(uuid,uuid,uuid,text,text,text);
DROP FUNCTION IF EXISTS public.list_account_deletion_storage_objects(uuid,uuid);
DROP FUNCTION IF EXISTS public.list_account_deletion_storage_objects(uuid,uuid,uuid,text,text,text);
DROP FUNCTION IF EXISTS public.list_account_deletion_storage_objects(uuid,uuid,uuid,text,text,text,uuid);
DROP FUNCTION IF EXISTS public.get_account_deletion_storage_work_items(uuid,uuid,text);
DROP FUNCTION IF EXISTS public.finalize_account_deletion_storage(uuid,uuid,boolean);
DROP FUNCTION IF EXISTS public.finalize_account_deletion_storage(uuid,uuid,text,jsonb);
DROP FUNCTION IF EXISTS public.finalize_account_deletion_storage(uuid,uuid,text,uuid,jsonb);
DROP FUNCTION IF EXISTS public.finalize_account_deletion_storage(uuid,uuid,uuid,text,text,text,uuid,jsonb);
DROP FUNCTION IF EXISTS public.finalize_account_deletion_auth(uuid,uuid,boolean);
DROP FUNCTION IF EXISTS public.finalize_account_deletion_auth(uuid,uuid,text,text);
DROP FUNCTION IF EXISTS public.finalize_account_deletion_auth(uuid,uuid,text,uuid,text);
DROP FUNCTION IF EXISTS public.finalize_account_deletion_auth(uuid,uuid,uuid,text,text,text,uuid,text);
DROP FUNCTION IF EXISTS public.fail_account_deletion(uuid,uuid,text);
DROP FUNCTION IF EXISTS public.fail_account_deletion(uuid,uuid,uuid,text,text,text,text);

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_assert_final_items(
  p_request_id uuid,
  p_target_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_request_id IS NULL OR p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'account_deletion_final_item_arguments_required' USING ERRCODE = '22004';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.account_deletion_request_items AS item
    WHERE item.request_id = p_request_id
      AND item.mandatory
      AND (
        (item.disposition IN ('delete', 'anonymize') AND item.status IS DISTINCT FROM 'applied')
        OR (item.disposition = 'separate' AND item.status IS DISTINCT FROM 'separated')
        OR (item.disposition = 'retain' AND item.status IS DISTINCT FROM 'retained')
      )
  ) THEN
    RAISE EXCEPTION 'account_deletion_final_item_state_invalid' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.account_deletion_request_items AS item
    JOIN public.account_deletion_requests AS request_row
      ON request_row.id = item.request_id
    JOIN privacy_retention.account_deletion_source_manifest AS manifest
      ON manifest.policy_version = request_row.policy_version
     AND manifest.code = item.data_class_code
    JOIN privacy_retention.account_deletion_adapter_registry AS registry
      ON registry.adapter_name = manifest.adapter_name
    WHERE item.request_id = p_request_id
      AND item.mandatory
      AND item.disposition = 'delete'
      AND item.data_class_code NOT IN ('storage_objects', 'auth_identity')
      AND privacy_retention.g014_account_deletion_source_count(
        manifest.relation_name,
        manifest.subject_column,
        CASE WHEN registry.subject_type = 'text'::regtype
          THEN privacy_retention.g014_account_deletion_subject_hash(p_target_user_id)
          ELSE p_target_user_id::text
        END
      ) <> 0
  ) THEN
    RAISE EXCEPTION 'account_deletion_final_source_readback_failed' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.profiles AS profile_row
    WHERE profile_row.user_id = p_target_user_id
      AND (
        profile_row.nickname IS DISTINCT FROM '탈퇴한 사용자'
        OR profile_row.username IS NOT NULL
        OR profile_row.avatar_url IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'account_deletion_final_anonymization_readback_failed' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.account_deletion_requests AS request_row
    WHERE request_row.id = p_request_id
      AND request_row.storage_receipts_hash ~ '^[0-9a-f]{64}$'
      AND (SELECT count(*) FROM privacy_retention.account_deletion_storage_receipts
           WHERE request_id = request_row.id) =
          (SELECT count(*) FROM privacy_retention.account_deletion_storage_objects
           WHERE request_id = request_row.id)
  ) THEN
    RAISE EXCEPTION 'account_deletion_final_storage_receipt_readback_failed' USING ERRCODE = '55000';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.begin_account_deletion_apply(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_confirmation_text text,
  p_idempotency_key text,
  p_reauthenticated_at timestamptz,
  p_source_manifest_hash text
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
  auth_readback_passed boolean,
  storage_receipt_refs jsonb,
  auth_receipt_ref text,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_policy public.account_deletion_policies%ROWTYPE;
  v_last_sign_in_at timestamptz;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_require_service_role();
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_request_id IS NULL
     OR p_preview_hash IS NULL OR p_confirmation_text IS NULL OR p_idempotency_key IS NULL
     OR p_reauthenticated_at IS NULL OR p_source_manifest_hash IS NULL THEN
    RAISE EXCEPTION 'account_deletion_begin_arguments_required' USING ERRCODE = '22004';
  END IF;
  IF p_preview_hash !~ '^[0-9a-f]{64}$'
     OR p_source_manifest_hash !~ '^[0-9a-f]{64}$'
     OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$' THEN
    RAISE EXCEPTION 'account_deletion_begin_arguments_invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_lock_target(p_target_user_id);
  SELECT * INTO v_request
  FROM public.account_deletion_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_request.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v_request.target_user_id IS DISTINCT FROM p_target_user_id
     OR v_request.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_request.reauthenticated_at IS DISTINCT FROM p_reauthenticated_at
     OR v_request.source_manifest_hash IS DISTINCT FROM p_source_manifest_hash THEN
    RAISE EXCEPTION 'account_deletion_begin_binding_mismatch' USING ERRCODE = '55000';
  END IF;
  IF v_request.idempotency_key IS NOT NULL
     AND v_request.idempotency_key IS DISTINCT FROM p_idempotency_key THEN
    RAISE EXCEPTION 'account_deletion_idempotency_binding_mismatch' USING ERRCODE = '55000';
  END IF;
  IF v_request.status NOT IN ('previewed', 'applying', 'partial') THEN
    RAISE EXCEPTION 'account_deletion_begin_predecessor_invalid' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_assert_actor_allowed(p_actor_user_id, p_target_user_id);
  PERFORM privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id);
  IF v_request.source_manifest_hash IS DISTINCT FROM
       privacy_retention.g014_account_deletion_validate_manifest(v_request.policy_version) THEN
    RAISE EXCEPTION 'account_deletion_source_manifest_binding_mismatch' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_policy
  FROM public.account_deletion_policies
  WHERE version = v_request.policy_version
    AND status = 'active'
  FOR SHARE;
  IF NOT FOUND
     OR p_confirmation_text IS DISTINCT FROM v_policy.confirmation_text
     OR v_request.preview_expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'account_deletion_preview_or_policy_predecessor_invalid' USING ERRCODE = '55000';
  END IF;
  SELECT user_row.last_sign_in_at INTO v_last_sign_in_at
  FROM auth.users AS user_row
  WHERE user_row.id = p_actor_user_id;
  IF v_last_sign_in_at IS NULL
     OR v_last_sign_in_at < pg_catalog.clock_timestamp() - v_policy.reauth_max_age
     OR abs(EXTRACT(EPOCH FROM (p_reauthenticated_at - v_last_sign_in_at))) > 1 THEN
    RAISE EXCEPTION 'account_deletion_reauthentication_required' USING ERRCODE = '42501';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_reserve_admin_slot(p_request_id, p_target_user_id);
  UPDATE public.account_deletion_requests
  SET status = 'applying',
      idempotency_key = p_idempotency_key,
      reason_code = 'APPLY_STARTED'
  WHERE id = v_request.id
  RETURNING * INTO v_request;
  RETURN QUERY SELECT
    v_request.id,
    v_request.status,
    v_request.reason_code,
    COALESCE((SELECT sum(planned_count) FILTER (WHERE disposition = 'delete') FROM public.account_deletion_request_items WHERE request_id = v_request.id), 0)::integer,
    COALESCE((SELECT sum(planned_count) FILTER (WHERE disposition = 'anonymize') FROM public.account_deletion_request_items WHERE request_id = v_request.id), 0)::integer,
    COALESCE((SELECT sum(planned_count) FILTER (WHERE disposition = 'separate') FROM public.account_deletion_request_items WHERE request_id = v_request.id), 0)::integer,
    COALESCE((SELECT sum(planned_count) FILTER (WHERE disposition = 'retain') FROM public.account_deletion_request_items WHERE request_id = v_request.id), 0)::integer,
    v_request.db_readback_passed,
    v_request.storage_readback_passed,
    v_request.session_readback_passed,
    v_request.auth_readback_passed,
    CASE WHEN v_request.storage_readback_passed THEN privacy_retention.g014_account_deletion_storage_receipt_refs(v_request.id) ELSE NULL END,
    CASE WHEN v_request.auth_readback_passed THEN v_request.auth_receipt_ref ELSE NULL END,
    v_request.source_manifest_hash;
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_account_deletion_database_cleanup(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text
)
RETURNS TABLE (
  request_id uuid,
  status text,
  reason_code text,
  db_readback_passed boolean,
  session_readback_passed boolean,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_manifest privacy_retention.account_deletion_source_manifest%ROWTYPE;
  v_session_absent boolean;
  v_evidence_cleanup_lease_token uuid;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_require_service_role();
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_request_id IS NULL
     OR p_preview_hash IS NULL OR p_idempotency_key IS NULL OR p_source_manifest_hash IS NULL THEN
    RAISE EXCEPTION 'account_deletion_database_arguments_required' USING ERRCODE = '22004';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_lock_target(p_target_user_id);
  SELECT * INTO v_request FROM public.account_deletion_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND
     OR v_request.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v_request.target_user_id IS DISTINCT FROM p_target_user_id
     OR v_request.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_request.idempotency_key IS DISTINCT FROM p_idempotency_key
     OR v_request.source_manifest_hash IS DISTINCT FROM p_source_manifest_hash THEN
    RAISE EXCEPTION 'account_deletion_database_binding_mismatch' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_assert_actor_allowed(p_actor_user_id, p_target_user_id);
  PERFORM privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id);
  IF v_request.status NOT IN ('applying', 'partial')
     OR v_request.source_manifest_hash IS DISTINCT FROM privacy_retention.g014_account_deletion_validate_manifest(v_request.policy_version) THEN
    RAISE EXCEPTION 'account_deletion_database_predecessor_invalid' USING ERRCODE = '55000';
  END IF;
  FOR v_manifest IN
    SELECT manifest.*
    FROM privacy_retention.account_deletion_source_manifest AS manifest
    WHERE manifest.policy_version = v_request.policy_version
      AND manifest.code NOT IN ('storage_objects', 'auth_identity')
    ORDER BY manifest.ordinal, manifest.code
  LOOP
    PERFORM privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id);
    PERFORM privacy_retention.g014_account_deletion_apply_adapter(v_manifest.adapter_name, v_request.id, p_target_user_id);
    UPDATE public.account_deletion_request_items AS item
    SET status = CASE item.disposition WHEN 'retain' THEN 'retained' WHEN 'separate' THEN 'separated' ELSE 'applied' END,
        reason_code = 'DB_READBACK_PASSED'
    WHERE item.request_id = v_request.id
      AND item.data_class_code = v_manifest.code;
  END LOOP;
  PERFORM privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id);
  v_evidence_cleanup_lease_token := pg_catalog.nullif(
    pg_catalog.current_setting('app.account_deletion_evidence_lease_token', true),
    ''
  )::uuid;
  IF v_evidence_cleanup_lease_token IS NOT NULL THEN
    PERFORM privacy_retention.g014_account_deletion_release_evidence_cleanup(
      v_request.id, p_target_user_id, v_evidence_cleanup_lease_token
    );
  END IF;
  SELECT NOT EXISTS (SELECT 1 FROM auth.sessions AS session_row WHERE session_row.user_id = p_target_user_id)
  INTO v_session_absent;
  UPDATE public.account_deletion_requests
  SET status = CASE WHEN v_session_absent THEN 'applying' ELSE 'partial' END,
      reason_code = CASE WHEN v_session_absent THEN 'DB_AND_SESSION_READBACK_PASSED' ELSE 'SESSION_READBACK_REQUIRED' END,
      db_readback_passed = true,
      session_readback_passed = v_session_absent
  WHERE id = v_request.id
  RETURNING * INTO v_request;
  PERFORM privacy_retention.g014_account_deletion_append_audit(v_request, CASE WHEN v_session_absent THEN 'readback_passed' ELSE 'partial' END, v_request.reason_code);
  RETURN QUERY SELECT v_request.id, v_request.status, v_request.reason_code, v_request.db_readback_passed, v_request.session_readback_passed, v_request.source_manifest_hash;
END;
$function$;

CREATE OR REPLACE FUNCTION public.list_account_deletion_storage_objects(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_lease_token uuid
)
RETURNS TABLE (
  bucket_id text,
  object_name text,
  object_locator_hash text,
  object_version_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_require_service_role();
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_request_id IS NULL
     OR p_preview_hash IS NULL OR p_idempotency_key IS NULL
     OR p_source_manifest_hash IS NULL OR p_lease_token IS NULL THEN
    RAISE EXCEPTION 'account_deletion_storage_list_arguments_required' USING ERRCODE = '22004';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_assert_external_lease(p_request_id, p_target_user_id, 'storage', p_lease_token);
  SELECT * INTO v_request FROM public.account_deletion_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND
     OR v_request.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v_request.target_user_id IS DISTINCT FROM p_target_user_id
     OR v_request.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_request.idempotency_key IS DISTINCT FROM p_idempotency_key
     OR v_request.source_manifest_hash IS DISTINCT FROM p_source_manifest_hash THEN
    RAISE EXCEPTION 'account_deletion_storage_list_binding_mismatch' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_assert_actor_allowed(p_actor_user_id, p_target_user_id);
  IF v_request.status NOT IN ('applying', 'partial')
     OR NOT v_request.db_readback_passed
     OR NOT v_request.session_readback_passed
     OR v_request.storage_readback_passed
     OR v_request.source_manifest_hash IS DISTINCT FROM privacy_retention.g014_account_deletion_validate_manifest(v_request.policy_version) THEN
    RAISE EXCEPTION 'account_deletion_storage_predecessor_invalid' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_attribute AS attribute
    WHERE attribute.attrelid = 'storage.objects'::regclass
      AND attribute.attname = 'version'
      AND attribute.attnum > 0
      AND NOT attribute.attisdropped
  ) THEN
    RAISE EXCEPTION 'account_deletion_storage_version_contract_missing' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1 FROM storage.objects AS object_row
    WHERE object_row.owner_id::text = p_target_user_id::text
      AND ((pg_catalog.to_jsonb(object_row) ->> 'version') IS NULL
        OR pg_catalog.btrim(pg_catalog.to_jsonb(object_row) ->> 'version') = '')
  ) THEN
    RAISE EXCEPTION 'account_deletion_storage_version_missing' USING ERRCODE = '55000';
  END IF;
  INSERT INTO privacy_retention.account_deletion_storage_objects (
    request_id, bucket_id, object_name, object_locator_hash, object_version_hash
  )
  SELECT
    v_request.id,
    object_row.bucket_id::text,
    object_row.name::text,
    pg_catalog.encode(extensions.digest(object_row.bucket_id::text || E'\n' || object_row.name::text, 'sha256'), 'hex'),
    pg_catalog.encode(extensions.digest(pg_catalog.to_jsonb(object_row) ->> 'version', 'sha256'), 'hex')
  FROM storage.objects AS object_row
  WHERE object_row.owner_id::text = p_target_user_id::text
  ON CONFLICT (request_id, bucket_id, object_name) DO NOTHING;
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_storage_objects AS expected
    JOIN storage.objects AS object_row
      ON object_row.bucket_id::text = expected.bucket_id
     AND object_row.name::text = expected.object_name
    WHERE expected.request_id = v_request.id
      AND (
        object_row.owner_id::text IS DISTINCT FROM p_target_user_id::text
        OR expected.object_version_hash IS DISTINCT FROM
           pg_catalog.encode(
             extensions.digest(pg_catalog.to_jsonb(object_row) ->> 'version', 'sha256'),
             'hex'
           )
      )
  ) THEN
    RAISE EXCEPTION 'account_deletion_storage_version_stale_or_changed' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_assert_external_lease(p_request_id, p_target_user_id, 'storage', p_lease_token);
  RETURN QUERY
  SELECT
    expected.bucket_id,
    expected.object_name,
    expected.object_locator_hash,
    expected.object_version_hash
  FROM privacy_retention.account_deletion_storage_objects AS expected
  JOIN storage.objects AS object_row
    ON object_row.bucket_id::text = expected.bucket_id
   AND object_row.name::text = expected.object_name
  WHERE expected.request_id = v_request.id
    AND object_row.owner_id::text = p_target_user_id::text
    AND expected.object_version_hash IS NOT DISTINCT FROM
        pg_catalog.encode(
          extensions.digest(pg_catalog.to_jsonb(object_row) ->> 'version', 'sha256'),
          'hex'
        )
  ORDER BY expected.bucket_id, expected.object_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_account_deletion_storage(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_lease_token uuid,
  p_receipts_json jsonb
)
RETURNS TABLE (
  request_id uuid,
  status text,
  reason_code text,
  db_readback_passed boolean,
  storage_readback_passed boolean,
  session_readback_passed boolean,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_receipts_hash text;
  v_receipt_count integer;
  v_object_count integer;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_require_service_role();
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_request_id IS NULL
     OR p_preview_hash IS NULL OR p_idempotency_key IS NULL
     OR p_source_manifest_hash IS NULL OR p_lease_token IS NULL
     OR p_receipts_json IS NULL THEN
    RAISE EXCEPTION 'account_deletion_storage_finalize_arguments_required' USING ERRCODE = '22004';
  END IF;
  IF p_preview_hash !~ '^[0-9a-f]{64}$'
     OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
     OR p_source_manifest_hash !~ '^[0-9a-f]{64}$'
     OR pg_catalog.jsonb_typeof(p_receipts_json) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'account_deletion_storage_finalize_arguments_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_request FROM public.account_deletion_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND
     OR v_request.id IS DISTINCT FROM p_request_id
     OR v_request.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v_request.target_user_id IS DISTINCT FROM p_target_user_id
     OR v_request.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_request.idempotency_key IS DISTINCT FROM p_idempotency_key
     OR v_request.source_manifest_hash IS DISTINCT FROM p_source_manifest_hash THEN
    RAISE EXCEPTION 'account_deletion_storage_finalize_binding_mismatch' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_assert_external_lease(
    p_request_id, p_target_user_id, 'storage', p_lease_token
  );
  PERFORM privacy_retention.g014_account_deletion_assert_actor_allowed(p_actor_user_id, p_target_user_id);
  IF v_request.status NOT IN ('applying', 'partial')
     OR NOT v_request.db_readback_passed
     OR NOT v_request.session_readback_passed
     OR v_request.storage_readback_passed
     OR v_request.source_manifest_hash IS DISTINCT FROM privacy_retention.g014_account_deletion_validate_manifest(v_request.policy_version) THEN
    RAISE EXCEPTION 'account_deletion_storage_finalize_predecessor_invalid' USING ERRCODE = '55000';
  END IF;
SELECT count(*) INTO v_object_count
FROM privacy_retention.account_deletion_storage_objects
WHERE request_id = v_request.id;
SELECT count(*) INTO v_receipt_count
FROM pg_catalog.jsonb_array_elements(p_receipts_json);
IF EXISTS (
  SELECT 1
  FROM pg_catalog.jsonb_array_elements(p_receipts_json) AS entry(value)
  WHERE pg_catalog.jsonb_typeof(entry.value) IS DISTINCT FROM 'object'
     OR NOT (entry.value ?& ARRAY[
       'objectLocatorHash', 'objectVersionHash', 'providerReceiptRef', 'providerReceiptHash'
     ])
     OR CASE
       WHEN pg_catalog.jsonb_typeof(entry.value) = 'object' THEN EXISTS (
         SELECT 1
         FROM pg_catalog.jsonb_object_keys(entry.value) AS key_row(key_name)
         WHERE key_row.key_name NOT IN (
           'objectLocatorHash', 'objectVersionHash', 'providerReceiptRef', 'providerReceiptHash'
         )
       )
       ELSE false
     END
) THEN
  RAISE EXCEPTION 'account_deletion_storage_receipt_shape_invalid' USING ERRCODE = '22023';
END IF;
IF v_receipt_count IS DISTINCT FROM v_object_count
   OR EXISTS (
     SELECT 1
     FROM privacy_retention.account_deletion_storage_objects AS expected
     FULL JOIN pg_catalog.jsonb_to_recordset(p_receipts_json) AS receipt(
       "objectLocatorHash" text, "objectVersionHash" text,
       "providerReceiptRef" text, "providerReceiptHash" text
     ) ON expected.object_locator_hash = receipt."objectLocatorHash"
     WHERE expected.request_id = v_request.id
       AND (
         expected.object_locator_hash IS NULL OR receipt."objectLocatorHash" IS NULL
         OR expected.object_version_hash IS DISTINCT FROM receipt."objectVersionHash"
         OR receipt."providerReceiptRef" IS NULL OR receipt."providerReceiptHash" IS NULL
         OR receipt."providerReceiptRef" !~ '^[A-Za-z0-9._:-]{8,256}$'
         OR receipt."providerReceiptHash" !~ '^[0-9a-f]{64}$'
       )
   )
   OR EXISTS (
     SELECT 1
     FROM pg_catalog.jsonb_to_recordset(p_receipts_json) AS receipt(
       "objectLocatorHash" text, "objectVersionHash" text,
       "providerReceiptRef" text, "providerReceiptHash" text
     )
     GROUP BY receipt."objectLocatorHash"
     HAVING count(*) <> 1
   ) THEN
  RAISE EXCEPTION 'account_deletion_storage_receipt_set_invalid' USING ERRCODE = '55000';
END IF;
IF EXISTS (
  SELECT 1
  FROM privacy_retention.account_deletion_storage_objects AS expected
  JOIN pg_catalog.jsonb_to_recordset(p_receipts_json) AS receipt(
    "objectLocatorHash" text, "objectVersionHash" text,
    "providerReceiptRef" text, "providerReceiptHash" text
  ) ON expected.object_locator_hash = receipt."objectLocatorHash"
  LEFT JOIN privacy_retention.account_deletion_provider_receipt_proofs AS proof
    ON proof.phase = 'storage'
   AND proof.request_id = v_request.id
   AND proof.actor_user_id = p_actor_user_id
   AND proof.target_user_id = p_target_user_id
   AND proof.lease_token = p_lease_token
   AND proof.manifest_hash = p_source_manifest_hash
   AND proof.idempotency_key IS NOT DISTINCT FROM v_request.idempotency_key
   AND proof.preview_hash IS NOT DISTINCT FROM v_request.preview_hash
   AND proof.provider_kind = 'storage_object_delete'
   AND proof.provider_receipt_ref = receipt."providerReceiptRef"
   AND proof.provider_receipt_hash = receipt."providerReceiptHash"
   AND proof.object_locator_hash = expected.object_locator_hash
   AND proof.object_version_hash = expected.object_version_hash
   AND proof.canonical_payload_hash IS NOT DISTINCT FROM privacy_retention.g014_account_deletion_receipt_payload_hash(
     'storage', v_request.id, p_actor_user_id, p_target_user_id,
     p_source_manifest_hash, p_idempotency_key, p_preview_hash, p_lease_token,
     'storage_object_delete', receipt."providerReceiptRef", receipt."providerReceiptHash",
     expected.object_locator_hash, expected.object_version_hash, NULL
   )
  WHERE expected.request_id = v_request.id
    AND proof.id IS NULL
) THEN
  RAISE EXCEPTION 'account_deletion_storage_provider_proof_unavailable' USING ERRCODE = '55000';
END IF;
IF EXISTS (
  SELECT 1 FROM storage.objects
  WHERE owner_id::text = v_request.target_user_id::text
) THEN
  RAISE EXCEPTION 'account_deletion_storage_authoritative_absence_failed' USING ERRCODE = '55000';
END IF;
PERFORM privacy_retention.g014_account_deletion_assert_external_lease(
  p_request_id, p_target_user_id, 'storage', p_lease_token
);
INSERT INTO privacy_retention.account_deletion_storage_receipts (
  request_id, object_locator_hash, object_version_hash,
  provider_receipt_ref, provider_receipt_hash, proof_hash
)
SELECT
  v_request.id,
  receipt."objectLocatorHash",
  receipt."objectVersionHash",
  receipt."providerReceiptRef",
  receipt."providerReceiptHash",
  proof.proof_hash
FROM pg_catalog.jsonb_to_recordset(p_receipts_json) AS receipt(
  "objectLocatorHash" text, "objectVersionHash" text,
  "providerReceiptRef" text, "providerReceiptHash" text
)
JOIN privacy_retention.account_deletion_storage_objects AS expected
  ON expected.request_id = v_request.id
 AND expected.object_locator_hash = receipt."objectLocatorHash"
JOIN privacy_retention.account_deletion_provider_receipt_proofs AS proof
  ON proof.phase = 'storage'
 AND proof.request_id = v_request.id
 AND proof.actor_user_id = p_actor_user_id
 AND proof.target_user_id = p_target_user_id
 AND proof.lease_token = p_lease_token
 AND proof.manifest_hash = p_source_manifest_hash
 AND proof.idempotency_key IS NOT DISTINCT FROM v_request.idempotency_key
 AND proof.preview_hash IS NOT DISTINCT FROM v_request.preview_hash
 AND proof.provider_kind = 'storage_object_delete'
 AND proof.provider_receipt_ref = receipt."providerReceiptRef"
 AND proof.provider_receipt_hash = receipt."providerReceiptHash"
 AND proof.object_locator_hash = expected.object_locator_hash
 AND proof.object_version_hash = expected.object_version_hash
 AND proof.canonical_payload_hash IS NOT DISTINCT FROM privacy_retention.g014_account_deletion_receipt_payload_hash(
   'storage', v_request.id, p_actor_user_id, p_target_user_id,
   p_source_manifest_hash, p_idempotency_key, p_preview_hash, p_lease_token,
   'storage_object_delete', receipt."providerReceiptRef", receipt."providerReceiptHash",
   expected.object_locator_hash, expected.object_version_hash, NULL
 );
SELECT pg_catalog.encode(
  extensions.digest(
    COALESCE(
      (
        SELECT pg_catalog.jsonb_agg(
          pg_catalog.jsonb_build_object(
            'objectLocatorHash', receipt."objectLocatorHash",
            'objectVersionHash', receipt."objectVersionHash",
            'providerReceiptRef', receipt."providerReceiptRef",
            'providerReceiptHash', receipt."providerReceiptHash"
          )
          ORDER BY receipt."objectLocatorHash"
        )::text
        FROM pg_catalog.jsonb_to_recordset(p_receipts_json) AS receipt(
          "objectLocatorHash" text, "objectVersionHash" text,
          "providerReceiptRef" text, "providerReceiptHash" text
        )
      ),
      '[]'
    ),
    'sha256'
  ),
  'hex'
) INTO v_receipts_hash;
  UPDATE public.account_deletion_request_items
  SET status = 'applied', reason_code = 'STORAGE_READBACK_PASSED'
  WHERE request_id = v_request.id AND data_class_code = 'storage_objects';
  UPDATE public.account_deletion_requests
  SET status = 'applying',
      reason_code = 'STORAGE_READBACK_PASSED',
      storage_readback_passed = true,
      storage_receipts_hash = v_receipts_hash
  WHERE id = v_request.id
  RETURNING * INTO v_request;
  UPDATE privacy_retention.account_deletion_external_phase_leases
  SET status = 'consumed', consumed_at = pg_catalog.clock_timestamp()
  WHERE request_id = v_request.id
    AND phase = 'storage'
    AND lease_token = p_lease_token
    AND status = 'active'
    AND lease_expires_at > pg_catalog.clock_timestamp();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_storage_lease_consumption_failed' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_append_audit(v_request, 'readback_passed', 'STORAGE_READBACK_PASSED');
  RETURN QUERY SELECT
    v_request.id, v_request.status, v_request.reason_code,
    v_request.db_readback_passed, v_request.storage_readback_passed,
    v_request.session_readback_passed, v_request.source_manifest_hash;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finalize_account_deletion_auth(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_lease_token uuid,
  p_auth_receipt_ref text
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
  auth_readback_passed boolean,
  storage_receipt_refs jsonb,
  auth_receipt_ref text,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_proof privacy_retention.account_deletion_provider_receipt_proofs%ROWTYPE;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_require_service_role();
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_request_id IS NULL
     OR p_preview_hash IS NULL OR p_idempotency_key IS NULL
     OR p_source_manifest_hash IS NULL OR p_lease_token IS NULL
     OR p_auth_receipt_ref IS NULL THEN
    RAISE EXCEPTION 'account_deletion_auth_finalize_arguments_required' USING ERRCODE = '22004';
  END IF;
  IF p_preview_hash !~ '^[0-9a-f]{64}$'
     OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'
     OR p_source_manifest_hash !~ '^[0-9a-f]{64}$'
     OR p_auth_receipt_ref !~ '^[A-Za-z0-9._:-]{8,256}$' THEN
    RAISE EXCEPTION 'account_deletion_auth_finalize_arguments_invalid' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_request FROM public.account_deletion_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND
     OR v_request.id IS DISTINCT FROM p_request_id
     OR v_request.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v_request.target_user_id IS DISTINCT FROM p_target_user_id
     OR v_request.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_request.idempotency_key IS DISTINCT FROM p_idempotency_key
     OR v_request.source_manifest_hash IS DISTINCT FROM p_source_manifest_hash THEN
    RAISE EXCEPTION 'account_deletion_auth_finalize_binding_mismatch' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_assert_external_lease(
    p_request_id, p_target_user_id, 'auth', p_lease_token
  );
  PERFORM privacy_retention.g014_account_deletion_assert_actor_allowed(p_actor_user_id, p_target_user_id);
  IF v_request.status NOT IN ('applying', 'partial')
     OR NOT v_request.db_readback_passed
     OR NOT v_request.session_readback_passed
     OR NOT v_request.storage_readback_passed
     OR v_request.auth_readback_passed
     OR v_request.source_manifest_hash IS DISTINCT FROM privacy_retention.g014_account_deletion_validate_manifest(v_request.policy_version) THEN
    RAISE EXCEPTION 'account_deletion_auth_finalize_predecessor_invalid' USING ERRCODE = '55000';
  END IF;
  IF pg_catalog.to_regclass('auth.identities') IS NULL
     OR pg_catalog.to_regclass('auth.refresh_tokens') IS NULL
     OR pg_catalog.to_regclass('auth.sessions') IS NULL
     OR pg_catalog.to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'account_deletion_auth_catalog_contract_missing' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_proof
  FROM privacy_retention.account_deletion_provider_receipt_proofs AS proof
  WHERE proof.phase = 'auth'
    AND proof.request_id = v_request.id
    AND proof.actor_user_id = p_actor_user_id
    AND proof.target_user_id = p_target_user_id
    AND proof.lease_token = p_lease_token
    AND proof.manifest_hash = p_source_manifest_hash
    AND proof.idempotency_key IS NOT DISTINCT FROM v_request.idempotency_key
    AND proof.preview_hash IS NOT DISTINCT FROM v_request.preview_hash
    AND proof.provider_kind = 'admin_auth_delete'
    AND proof.provider_receipt_ref = p_auth_receipt_ref
    AND proof.predecessor_receipts_hash IS NOT DISTINCT FROM v_request.storage_receipts_hash
    AND proof.canonical_payload_hash IS NOT DISTINCT FROM privacy_retention.g014_account_deletion_receipt_payload_hash(
      'auth', v_request.id, p_actor_user_id, p_target_user_id,
      p_source_manifest_hash, p_idempotency_key, p_preview_hash, p_lease_token,
      'admin_auth_delete', p_auth_receipt_ref, proof.provider_receipt_hash,
      NULL, NULL, v_request.storage_receipts_hash
    )
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_auth_provider_proof_unavailable' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (SELECT 1 FROM auth.users WHERE id = v_request.target_user_id)
     OR EXISTS (SELECT 1 FROM auth.sessions WHERE user_id = v_request.target_user_id)
     OR EXISTS (SELECT 1 FROM auth.identities WHERE user_id = v_request.target_user_id)
     OR EXISTS (SELECT 1 FROM auth.refresh_tokens WHERE user_id = v_request.target_user_id) THEN
    RAISE EXCEPTION 'account_deletion_auth_authoritative_absence_failed' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_assert_external_lease(p_request_id, p_target_user_id, 'auth', p_lease_token);
  UPDATE public.account_deletion_request_items
  SET status = 'applied', reason_code = 'AUTH_READBACK_PASSED'
  WHERE request_id = v_request.id AND data_class_code = 'auth_identity';
  PERFORM privacy_retention.g014_account_deletion_assert_final_items(v_request.id, v_request.target_user_id);
  UPDATE public.account_deletion_requests
  SET status = 'applied',
      reason_code = 'APPLIED',
      auth_readback_passed = true,
      auth_receipt_ref = p_auth_receipt_ref,
      applied_at = pg_catalog.clock_timestamp()
  WHERE id = v_request.id
  RETURNING * INTO v_request;
  UPDATE privacy_retention.account_deletion_admin_reservations
  SET status = 'completed', reconciled_at = pg_catalog.clock_timestamp()
  WHERE request_id = v_request.id AND status = 'active';
  UPDATE privacy_retention.account_deletion_external_phase_leases
  SET status = 'consumed', consumed_at = pg_catalog.clock_timestamp()
  WHERE request_id = v_request.id
    AND phase = 'auth'
    AND lease_token = p_lease_token
    AND status = 'active'
    AND lease_expires_at > pg_catalog.clock_timestamp();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_auth_lease_consumption_failed' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_append_audit(v_request, 'applied', 'APPLIED');
  RETURN QUERY SELECT
    v_request.id,
    v_request.status,
    v_request.reason_code,
    COALESCE((SELECT sum(planned_count) FILTER (WHERE disposition = 'delete') FROM public.account_deletion_request_items WHERE request_id = v_request.id), 0)::integer,
    COALESCE((SELECT sum(planned_count) FILTER (WHERE disposition = 'anonymize') FROM public.account_deletion_request_items WHERE request_id = v_request.id), 0)::integer,
    COALESCE((SELECT sum(planned_count) FILTER (WHERE disposition = 'separate') FROM public.account_deletion_request_items WHERE request_id = v_request.id), 0)::integer,
    COALESCE((SELECT sum(planned_count) FILTER (WHERE disposition = 'retain') FROM public.account_deletion_request_items WHERE request_id = v_request.id), 0)::integer,
    v_request.db_readback_passed,
    v_request.storage_readback_passed,
    v_request.session_readback_passed,
    v_request.auth_readback_passed,
    privacy_retention.g014_account_deletion_storage_receipt_refs(v_request.id),
    v_request.auth_receipt_ref,
    v_request.source_manifest_hash;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fail_account_deletion(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_reason_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_require_service_role();
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_request_id IS NULL
     OR p_preview_hash IS NULL OR p_idempotency_key IS NULL
     OR p_source_manifest_hash IS NULL OR p_reason_code IS NULL THEN
    RAISE EXCEPTION 'account_deletion_failure_arguments_required' USING ERRCODE = '22004';
  END IF;
  IF p_reason_code NOT IN (
    'DB_OR_SESSION_CLEANUP_FAILED',
    'SESSION_READBACK_REQUIRED'
  ) THEN
    RAISE EXCEPTION 'account_deletion_failure_reason_invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_lock_target(p_target_user_id);
  SELECT * INTO v_request FROM public.account_deletion_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND
     OR v_request.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v_request.target_user_id IS DISTINCT FROM p_target_user_id
     OR v_request.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_request.idempotency_key IS DISTINCT FROM p_idempotency_key
     OR v_request.source_manifest_hash IS DISTINCT FROM p_source_manifest_hash THEN
    RAISE EXCEPTION 'account_deletion_failure_binding_mismatch' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_assert_actor_allowed(p_actor_user_id, p_target_user_id);
  PERFORM privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id);
  IF v_request.status NOT IN ('previewed', 'applying', 'partial') THEN
    RAISE EXCEPTION 'account_deletion_failure_predecessor_invalid' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_external_phase_leases AS lease_row
    WHERE lease_row.request_id = v_request.id
      AND lease_row.target_user_id = p_target_user_id
      AND lease_row.status = 'active'
  ) THEN
    RAISE EXCEPTION 'account_deletion_failure_external_lease_active' USING ERRCODE = '55000';
  END IF;
  UPDATE public.account_deletion_requests
  SET status = 'partial', reason_code = p_reason_code
  WHERE id = v_request.id
  RETURNING * INTO v_request;
  UPDATE privacy_retention.account_deletion_evidence_cleanup_leases
  SET status = 'released', released_at = pg_catalog.clock_timestamp()
  WHERE request_id = v_request.id
    AND target_user_id = p_target_user_id
    AND status = 'active';
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_evidence_cleanup_leases
    WHERE request_id = v_request.id
      AND target_user_id = p_target_user_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'account_deletion_failure_lease_reconciliation_failed' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_append_audit(v_request, 'partial', p_reason_code);
END;
$function$;
DROP FUNCTION IF EXISTS public.fail_account_deletion_external_phase(uuid,uuid,uuid,text,text,text,text,uuid,text);
CREATE OR REPLACE FUNCTION public.fail_account_deletion_external_phase(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_phase text,
  p_lease_token uuid,
  p_reason_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_lease privacy_retention.account_deletion_external_phase_leases%ROWTYPE;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_require_service_role();
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_request_id IS NULL
     OR p_preview_hash IS NULL OR p_idempotency_key IS NULL
     OR p_source_manifest_hash IS NULL OR p_phase IS NULL
     OR p_lease_token IS NULL OR p_reason_code IS NULL THEN
    RAISE EXCEPTION 'account_deletion_external_failure_arguments_required' USING ERRCODE = '22004';
  END IF;
  IF (p_phase = 'storage' AND p_reason_code = 'STORAGE_CLEANUP_FAILED')
     OR (p_phase = 'auth' AND p_reason_code = 'AUTH_CLEANUP_FAILED') THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'account_deletion_external_failure_phase_reason_invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM privacy_retention.g014_account_deletion_lock_target(p_target_user_id);
  SELECT * INTO v_request
  FROM public.account_deletion_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_request.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v_request.target_user_id IS DISTINCT FROM p_target_user_id
     OR v_request.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_request.idempotency_key IS DISTINCT FROM p_idempotency_key
     OR v_request.source_manifest_hash IS DISTINCT FROM p_source_manifest_hash THEN
    RAISE EXCEPTION 'account_deletion_external_failure_binding_mismatch' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_assert_actor_allowed(
    p_actor_user_id, p_target_user_id
  );
  IF v_request.status NOT IN ('applying', 'partial') THEN
    RAISE EXCEPTION 'account_deletion_external_failure_predecessor_invalid' USING ERRCODE = '55000';
  END IF;

  -- Failure reconciliation intentionally accepts an active lease that just
  -- expired, but only the exact request/target/phase/token can release it.
  SELECT * INTO v_lease
  FROM privacy_retention.account_deletion_external_phase_leases
  WHERE request_id = p_request_id
    AND target_user_id = p_target_user_id
    AND phase = p_phase
    AND lease_token = p_lease_token
    AND status = 'active'
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_external_failure_lease_mismatch' USING ERRCODE = '55000';
  END IF;

  UPDATE public.account_deletion_requests
  SET status = 'partial',
      reason_code = p_reason_code
  WHERE id = v_request.id
  RETURNING * INTO v_request;
  UPDATE privacy_retention.account_deletion_external_phase_leases
  SET status = 'released',
      consumed_at = pg_catalog.clock_timestamp()
  WHERE request_id = p_request_id
    AND target_user_id = p_target_user_id
    AND phase = p_phase
    AND lease_token = p_lease_token
    AND status = 'active';
  IF NOT FOUND OR EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_external_phase_leases
    WHERE request_id = p_request_id
      AND target_user_id = p_target_user_id
      AND phase = p_phase
      AND lease_token = p_lease_token
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'account_deletion_external_failure_lease_reconciliation_failed' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_append_audit(
    v_request, 'partial', p_reason_code
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.publish_account_deletion_policy(
  p_version text,
  p_preview_ttl interval,
  p_reauth_max_age interval,
  p_confirmation_text text,
  p_manifest jsonb,
  p_operator_approval_ref text,
  p_idempotency_key text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_input_hash text;
  v_manifest_hash text;
  v_existing privacy_retention.account_deletion_policy_publications%ROWTYPE;
  v_row record;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_require_service_role();
  IF p_version IS NULL OR p_preview_ttl IS NULL OR p_reauth_max_age IS NULL
     OR p_confirmation_text IS NULL OR p_manifest IS NULL
     OR p_operator_approval_ref IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'account_deletion_policy_publication_arguments_required' USING ERRCODE = '22004';
  END IF;
  IF p_version !~ '^[a-z0-9][a-z0-9._-]{2,63}$'
     OR p_confirmation_text IS DISTINCT FROM '계정 삭제'
     OR p_operator_approval_ref !~ '^[A-Za-z0-9._:-]{8,128}$'
     OR p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$'
     OR pg_catalog.jsonb_typeof(p_manifest) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'account_deletion_policy_publication_arguments_invalid' USING ERRCODE = '22023';
  END IF;
  v_input_hash := pg_catalog.encode(extensions.digest(
    pg_catalog.jsonb_build_object(
      'version', p_version,
      'previewTtl', p_preview_ttl::text,
      'reauthMaxAge', p_reauth_max_age::text,
      'confirmationText', p_confirmation_text,
      'manifest', p_manifest,
      'approval', p_operator_approval_ref
    )::text, 'sha256'
  ), 'hex');
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-account-deletion-policy-version:' || p_version, 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-account-deletion-policy-publication:' || p_idempotency_key, 0)
  );
  SELECT * INTO v_existing
  FROM privacy_retention.account_deletion_policy_publications
  WHERE policy_version = p_version OR publication_idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.policy_version IS DISTINCT FROM p_version
       OR v_existing.publication_idempotency_key IS DISTINCT FROM p_idempotency_key
       OR v_existing.operator_approval_ref IS DISTINCT FROM p_operator_approval_ref
       OR v_existing.publication_input_hash IS DISTINCT FROM v_input_hash THEN
      RAISE EXCEPTION 'account_deletion_policy_publication_replay_mismatch' USING ERRCODE = '55000';
    END IF;
    RETURN p_version;
  END IF;
  INSERT INTO public.account_deletion_policies (version, status, preview_ttl, reauth_max_age, confirmation_text)
  VALUES (p_version, 'disabled', p_preview_ttl, p_reauth_max_age, p_confirmation_text);
  INSERT INTO public.account_deletion_data_classes (policy_version, code, disposition, mandatory)
  SELECT p_version, data_class.code, data_class.disposition, data_class.mandatory
  FROM public.account_deletion_data_classes AS data_class
  JOIN public.account_deletion_policies AS policy
    ON policy.version = data_class.policy_version
   AND policy.status = 'active';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_policy_publication_template_unavailable' USING ERRCODE = '55000';
  END IF;
  FOR v_row IN
    SELECT * FROM pg_catalog.jsonb_to_recordset(p_manifest) AS manifest(
      code text, relation_name text, subject_column text, adapter_name text,
      required boolean, ordinal integer, contract_hash text
    )
  LOOP
    IF v_row.code IS NULL OR v_row.relation_name IS NULL OR v_row.subject_column IS NULL
       OR v_row.adapter_name IS NULL OR v_row.required IS NULL
       OR v_row.ordinal IS NULL OR v_row.contract_hash IS NULL
       OR NOT EXISTS (
         SELECT 1
         FROM privacy_retention.account_deletion_adapter_registry AS registry
         WHERE registry.code = v_row.code
           AND registry.adapter_name = v_row.adapter_name
           AND registry.relation_name = v_row.relation_name
           AND registry.subject_column = v_row.subject_column
           AND registry.ordinal = v_row.ordinal
       )
       OR v_row.contract_hash IS DISTINCT FROM privacy_retention.g014_account_deletion_manifest_contract_hash(
         p_version, v_row.code, v_row.relation_name, v_row.subject_column,
         v_row.adapter_name, v_row.required, v_row.ordinal
       ) THEN
      RAISE EXCEPTION 'account_deletion_policy_manifest_binding_invalid' USING ERRCODE = '22023';
    END IF;
    INSERT INTO privacy_retention.account_deletion_source_manifest (
      policy_version, code, relation_name, subject_column, adapter_name, required, ordinal, contract_hash
    ) VALUES (
      p_version, v_row.code, v_row.relation_name, v_row.subject_column,
      v_row.adapter_name, v_row.required, v_row.ordinal, v_row.contract_hash
    );
  END LOOP;
  v_manifest_hash := privacy_retention.g014_account_deletion_validate_manifest(p_version);
  INSERT INTO privacy_retention.account_deletion_policy_publications (
    policy_version, publication_idempotency_key, operator_approval_ref,
    publication_input_hash, source_manifest_hash
  ) VALUES (
    p_version, p_idempotency_key, p_operator_approval_ref, v_input_hash, v_manifest_hash
  );
  RETURN p_version;
END;
$function$;

CREATE OR REPLACE FUNCTION public.activate_account_deletion_policy(
  p_version text,
  p_idempotency_key text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_publication privacy_retention.account_deletion_policy_publications%ROWTYPE;
  v_history privacy_retention.account_deletion_policy_activation_history%ROWTYPE;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_require_service_role();
  IF p_version IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'account_deletion_policy_activation_arguments_required' USING ERRCODE = '22004';
  END IF;
  IF p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,128}$' THEN
    RAISE EXCEPTION 'account_deletion_policy_activation_arguments_invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-account-deletion-policy-activation-state', 0)
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-account-deletion-policy-activation:' || p_version || ':' || p_idempotency_key, 0)
  );
  SELECT * INTO v_history
  FROM privacy_retention.account_deletion_policy_activation_history
  WHERE policy_version = p_version
  FOR UPDATE;
  IF FOUND THEN
    IF v_history.activation_idempotency_key IS DISTINCT FROM p_idempotency_key THEN
      RAISE EXCEPTION 'account_deletion_policy_activation_replay_mismatch' USING ERRCODE = '55000';
    END IF;
    RETURN p_version;
  END IF;
  SELECT * INTO v_publication
  FROM privacy_retention.account_deletion_policy_publications
  WHERE policy_version = p_version
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_policy_publication_missing' USING ERRCODE = '55000';
  END IF;
  IF v_publication.source_manifest_hash IS DISTINCT FROM privacy_retention.g014_account_deletion_validate_manifest(p_version) THEN
    RAISE EXCEPTION 'account_deletion_policy_activation_manifest_mismatch' USING ERRCODE = '55000';
  END IF;
  UPDATE public.account_deletion_policies
  SET status = 'disabled'
  WHERE status = 'active' AND version IS DISTINCT FROM p_version;
  UPDATE public.account_deletion_policies
  SET status = 'active'
  WHERE version = p_version AND status = 'disabled';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_policy_activation_predecessor_invalid' USING ERRCODE = '55000';
  END IF;
  INSERT INTO privacy_retention.account_deletion_policy_activation_history (
    policy_version, activated_at, activation_idempotency_key, operator_approval_ref
  ) VALUES (
    p_version, pg_catalog.clock_timestamp(), p_idempotency_key, v_publication.operator_approval_ref
  );
  RETURN p_version;
END;
$function$;
-- The public workflow state is default-deny and service role gets capabilities,
-- never table DML.  Private manifests, proofs, and adapters are owner-only.
DO $ownership$
DECLARE
  v_relation regclass;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'privacy_retention.account_deletion_adapter_registry'::regclass,
    'privacy_retention.account_deletion_source_manifest'::regclass,
    'privacy_retention.account_deletion_hold_class_map'::regclass,
    'privacy_retention.account_deletion_client_cleanup_contracts'::regclass,
    'privacy_retention.account_deletion_admin_guard'::regclass,
    'privacy_retention.account_deletion_policy_activation_history'::regclass,
    'privacy_retention.account_deletion_policy_publications'::regclass,
    'privacy_retention.account_deletion_admin_reservations'::regclass,
    'privacy_retention.account_deletion_external_phase_leases'::regclass,
    'privacy_retention.account_deletion_evidence_cleanup_leases'::regclass,
    'privacy_retention.account_deletion_evidence_separations'::regclass,
    'privacy_retention.account_deletion_storage_objects'::regclass,
    'privacy_retention.account_deletion_provider_receipt_proofs'::regclass,
    'privacy_retention.account_deletion_storage_receipts'::regclass
  ] LOOP
    EXECUTE pg_catalog.format('ALTER TABLE %s OWNER TO privacy_workflow_owner', v_relation);
    EXECUTE pg_catalog.format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', v_relation);
    EXECUTE pg_catalog.format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', v_relation);
    EXECUTE pg_catalog.format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated, service_role', v_relation);
    EXECUTE pg_catalog.format('GRANT ALL ON TABLE %s TO privacy_workflow_owner', v_relation);
    EXECUTE pg_catalog.format('CREATE POLICY g014_account_deletion_owner_access ON %s FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true)', v_relation);
  END LOOP;
END;
$ownership$;

REVOKE ALL ON TABLE public.account_deletion_policies, public.account_deletion_data_classes,
  public.account_deletion_requests, public.account_deletion_request_items
  FROM PUBLIC, anon, authenticated, service_role;
GRANT ALL ON TABLE public.account_deletion_policies, public.account_deletion_data_classes,
  public.account_deletion_requests, public.account_deletion_request_items TO privacy_workflow_owner;
CREATE POLICY g014_account_deletion_owner_fence_read
  ON public.account_deletion_requests
  FOR SELECT TO privacy_workflow_owner USING (true);

DO $source_grants$
DECLARE
  v_relation regclass;
  v_update_relation regclass;
  v_read_relation regclass;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'public.user_stats'::regclass,
    'public.user_bookmarks'::regclass,
    'public.notifications'::regclass,
    'public.admin_user_preferences'::regclass,
    'public.documents'::regclass,
    'public.review_likes'::regclass,
    'public.reviews'::regclass,
    'public.restaurant_submission_items'::regclass,
    'public.restaurant_submissions'::regclass,
    'public.restaurant_requests'::regclass,
    'public.ocr_logs'::regclass,
    'public.marketing_campaign_recipients'::regclass,
    'privacy_retention.marketing_campaign_batch_recipients'::regclass,
    'privacy_retention.marketing_campaign_consent_evidence_keys'::regclass,
    'privacy_retention.privacy_consent_events'::regclass,
    'privacy_retention.privacy_age_profiles'::regclass,
    'privacy_retention.privacy_guardian_verifications'::regclass,
    'privacy_retention.privacy_onboarding_challenges'::regclass
  ] LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON TABLE %s FROM privacy_workflow_owner', v_relation);
    EXECUTE pg_catalog.format('GRANT SELECT, DELETE ON TABLE %s TO privacy_workflow_owner', v_relation);
  END LOOP;
  FOREACH v_update_relation IN ARRAY ARRAY[
    'public.profiles'::regclass,
    'public.marketing_campaign_operations'::regclass
  ] LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON TABLE %s FROM privacy_workflow_owner', v_update_relation);
    EXECUTE pg_catalog.format('GRANT SELECT, UPDATE ON TABLE %s TO privacy_workflow_owner', v_update_relation);
  END LOOP;
  FOREACH v_read_relation IN ARRAY ARRAY[
    'privacy_retention.privacy_audit_events'::regclass
  ] LOOP
    EXECUTE pg_catalog.format('REVOKE ALL ON TABLE %s FROM privacy_workflow_owner', v_read_relation);
    EXECUTE pg_catalog.format('GRANT SELECT, INSERT ON TABLE %s TO privacy_workflow_owner', v_read_relation);
  END LOOP;
END;
$source_grants$;

DO $source_rls$
DECLARE
  v_relation regclass;
  v_read_relation regclass;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'public.profiles'::regclass,
    'public.user_stats'::regclass,
    'public.user_bookmarks'::regclass,
    'public.notifications'::regclass,
    'public.admin_user_preferences'::regclass,
    'public.documents'::regclass,
    'public.review_likes'::regclass,
    'public.reviews'::regclass,
    'public.restaurant_submission_items'::regclass,
    'public.restaurant_submissions'::regclass,
    'public.restaurant_requests'::regclass,
    'public.ocr_logs'::regclass,
    'public.marketing_campaign_recipients'::regclass,
    'public.marketing_campaign_operations'::regclass,
    'privacy_retention.marketing_campaign_batch_recipients'::regclass,
    'privacy_retention.marketing_campaign_consent_evidence_keys'::regclass,
    'privacy_retention.privacy_consent_events'::regclass,
    'privacy_retention.privacy_age_profiles'::regclass,
    'privacy_retention.privacy_guardian_verifications'::regclass,
    'privacy_retention.privacy_onboarding_challenges'::regclass
  ] LOOP
    EXECUTE pg_catalog.format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', v_relation);
    EXECUTE pg_catalog.format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', v_relation);
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS g014_privacy_workflow_owner_access ON %s', v_relation);
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS g014_account_deletion_source_access ON %s', v_relation);
    EXECUTE pg_catalog.format(
      'CREATE POLICY g014_account_deletion_source_access ON %s FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true)',
      v_relation
    );
  END LOOP;
  FOREACH v_read_relation IN ARRAY ARRAY[
    'privacy_retention.privacy_audit_events'::regclass
  ] LOOP
    EXECUTE pg_catalog.format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', v_read_relation);
    EXECUTE pg_catalog.format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', v_read_relation);
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS g014_privacy_workflow_owner_access ON %s', v_read_relation);
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS g014_account_deletion_source_access ON %s', v_read_relation);
    EXECUTE pg_catalog.format('DROP POLICY IF EXISTS g014_account_deletion_audit_append_access ON %s', v_read_relation);
    EXECUTE pg_catalog.format(
      'CREATE POLICY g014_account_deletion_source_access ON %s FOR SELECT TO privacy_workflow_owner USING (true)',
      v_read_relation
    );
    EXECUTE pg_catalog.format(
      'CREATE POLICY g014_account_deletion_audit_append_access ON %s FOR INSERT TO privacy_workflow_owner WITH CHECK (true)',
      v_read_relation
    );
  END LOOP;
END;
$source_rls$;

GRANT USAGE ON SCHEMA auth, storage TO privacy_workflow_owner;
GRANT SELECT (id, last_sign_in_at) ON TABLE auth.users TO privacy_workflow_owner;
GRANT SELECT ON TABLE auth.sessions, auth.identities, auth.refresh_tokens, storage.objects TO privacy_workflow_owner;

DROP FUNCTION IF EXISTS public.finalize_account_deletion_storage(uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.finalize_account_deletion_auth(uuid, uuid, boolean);

DO $function_owner$
DECLARE
  v_signature text;
  v_oid oid;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.account_deletion_require_service_role()',
    'public.account_deletion_subject_hash(uuid)',
    'public.account_deletion_is_active_admin(uuid)',
    'public.account_deletion_write_audit(public.account_deletion_requests,text,text)',
    'public.account_deletion_reason_code_is_safe(text)',
    'public.privacy_reject_immutable_mutation()',
    'public.preview_account_deletion(uuid,uuid,timestamptz)',
    'public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)',
    'public.apply_account_deletion_database_cleanup(uuid,uuid,uuid,text,text,text)',
    'public.list_account_deletion_storage_objects(uuid,uuid,uuid,text,text,text,uuid)',
    'public.finalize_account_deletion_storage(uuid,uuid,uuid,text,text,text,uuid,jsonb)',
    'public.finalize_account_deletion_auth(uuid,uuid,uuid,text,text,text,uuid,text)',
    'public.claim_account_deletion_external_phase(uuid,uuid,uuid,text,text,text,text)',
    'public.fail_account_deletion(uuid,uuid,uuid,text,text,text,text)',
    'public.fail_account_deletion_external_phase(uuid,uuid,uuid,text,text,text,text,uuid,text)',
    'public.publish_account_deletion_policy(text,interval,interval,text,jsonb,text,text)',
    'public.activate_account_deletion_policy(text,text)'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN RAISE EXCEPTION 'G014-04 required deletion RPC missing: %', v_signature; END IF;
    EXECUTE pg_catalog.format('ALTER FUNCTION %s OWNER TO privacy_workflow_owner', v_oid::regprocedure);
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_oid::regprocedure);
  END LOOP;
END;
$function_owner$;
DO $private_function_owner$
DECLARE
  v_signature text;
  v_oid oid;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'privacy_retention.g014_account_deletion_subject_hash(uuid)',
    'privacy_retention.g014_account_deletion_manifest_contract_hash(text,text,text,text,text,boolean,integer)',
    'privacy_retention.g014_account_deletion_manifest_hash(text)',
    'privacy_retention.g014_account_deletion_receipt_payload_hash(text,uuid,uuid,uuid,text,text,text,uuid,text,text,text,text,text,text)',
    'privacy_retention.g014_account_deletion_assert_external_lease(uuid,uuid,text,uuid)',
    'privacy_retention.g014_account_deletion_evidence_cleanup_allowed(uuid,uuid)',
    'privacy_retention.g014_account_deletion_enable_evidence_cleanup(uuid,uuid)',
    'privacy_retention.g014_account_deletion_release_evidence_cleanup(uuid,uuid,uuid)',
    'privacy_retention.g014_account_deletion_provider_proof_lease_guard()',
    'privacy_retention.g014_marketing_reject_evidence_mutation()',
    'privacy_retention.g014_account_deletion_assert_final_items(uuid,uuid)',
    'privacy_retention.g014_account_deletion_storage_receipt_refs(uuid)',
    'privacy_retention.g014_account_deletion_require_service_role()',
    'privacy_retention.g014_account_deletion_is_active_admin(uuid)',
    'privacy_retention.g014_account_deletion_lock_target(uuid)',
    'privacy_retention.g014_account_deletion_assert_no_hold(uuid)',
    'privacy_retention.g014_account_deletion_assert_actor_allowed(uuid,uuid)',
    'privacy_retention.g014_account_deletion_reserve_admin_slot(uuid,uuid)',
    'privacy_retention.g014_account_deletion_admin_removal_fence()',
    'privacy_retention.g014_account_deletion_source_count(text,text,text)',
    'privacy_retention.g014_account_deletion_validate_manifest(text)',
    'privacy_retention.g014_account_deletion_append_audit(public.account_deletion_requests,text,text)',
    'privacy_retention.g014_account_deletion_apply_adapter(text,uuid,uuid)',
    'privacy_retention.g014_account_deletion_hold_subject_lock()',
    'privacy_retention.g014_account_deletion_prevent_activated_policy_mutation()',
    'privacy_retention.g014_account_deletion_prevent_activated_class_mutation()',
    'privacy_retention.g014_account_deletion_prevent_manifest_mutation()',
    'privacy_retention.g014_account_deletion_append_only()',
    'privacy_retention.g014_account_deletion_request_binding_guard()',
    'privacy_retention.g014_account_deletion_item_binding_guard()'
  ] LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN RAISE EXCEPTION 'G014-04 required private deletion function missing: %', v_signature; END IF;
    EXECUTE pg_catalog.format('ALTER FUNCTION %s OWNER TO privacy_workflow_owner', v_oid::regprocedure);
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_oid::regprocedure);
  END LOOP;
END;
$private_function_owner$;

REVOKE ALL ON FUNCTION public.account_deletion_require_service_role(),
  public.account_deletion_subject_hash(uuid),
  public.account_deletion_is_active_admin(uuid),
  public.account_deletion_write_audit(public.account_deletion_requests,text,text),
  public.account_deletion_reason_code_is_safe(text),
  public.account_deletion_set_updated_at()
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public.preview_account_deletion(uuid, uuid, timestamptz),
  public.begin_account_deletion_apply(uuid, uuid, uuid, text, text, text, timestamptz, text),
  public.apply_account_deletion_database_cleanup(uuid, uuid, uuid, text, text, text),
  public.list_account_deletion_storage_objects(uuid, uuid, uuid, text, text, text, uuid),
  public.finalize_account_deletion_storage(uuid, uuid, uuid, text, text, text, uuid, jsonb),
  public.finalize_account_deletion_auth(uuid, uuid, uuid, text, text, text, uuid, text),
  public.claim_account_deletion_external_phase(uuid, uuid, uuid, text, text, text, text),
  public.fail_account_deletion(uuid, uuid, uuid, text, text, text, text),
  public.fail_account_deletion_external_phase(uuid, uuid, uuid, text, text, text, text, uuid, text),
  public.publish_account_deletion_policy(text, interval, interval, text, jsonb, text, text),
  public.activate_account_deletion_policy(text, text)
TO service_role;

REVOKE ALL ON FUNCTION privacy_retention.g014_account_deletion_subject_hash(uuid),
  privacy_retention.g014_account_deletion_manifest_contract_hash(text,text,text,text,text,boolean,integer),
  privacy_retention.g014_account_deletion_manifest_hash(text),
  privacy_retention.g014_account_deletion_receipt_payload_hash(text,uuid,uuid,uuid,text,text,text,uuid,text,text,text,text,text,text),
  privacy_retention.g014_account_deletion_storage_receipt_refs(uuid),
  privacy_retention.g014_account_deletion_require_service_role(),
  privacy_retention.g014_account_deletion_is_active_admin(uuid),
  privacy_retention.g014_account_deletion_lock_target(uuid),
  privacy_retention.g014_account_deletion_assert_no_hold(uuid),
  privacy_retention.g014_account_deletion_assert_actor_allowed(uuid,uuid),
  privacy_retention.g014_account_deletion_reserve_admin_slot(uuid,uuid),
  privacy_retention.g014_account_deletion_admin_removal_fence(),
  privacy_retention.g014_account_deletion_source_count(text,text,text),
  privacy_retention.g014_account_deletion_validate_manifest(text),
  privacy_retention.g014_account_deletion_append_audit(public.account_deletion_requests,text,text),
  privacy_retention.g014_account_deletion_apply_adapter(text,uuid,uuid),
  privacy_retention.g014_account_deletion_assert_external_lease(uuid,uuid,text,uuid),
  privacy_retention.g014_account_deletion_evidence_cleanup_allowed(uuid,uuid),
  privacy_retention.g014_account_deletion_enable_evidence_cleanup(uuid,uuid),
  privacy_retention.g014_account_deletion_release_evidence_cleanup(uuid,uuid,uuid),
  privacy_retention.g014_account_deletion_provider_proof_lease_guard(),
  privacy_retention.g014_marketing_reject_evidence_mutation(),
  privacy_retention.g014_account_deletion_assert_final_items(uuid,uuid)
FROM PUBLIC, anon, authenticated, service_role;
DO $g014_account_deletion_rpc_allowlist$
DECLARE
  v_missing text;
BEGIN
  DELETE FROM privacy_retention.g014_public_rpc_allowlist
  WHERE function_schema = 'public'
    AND function_name IN (
      'preview_account_deletion',
      'begin_account_deletion_apply',
      'apply_account_deletion_database_cleanup',
      'claim_account_deletion_external_phase',
      'list_account_deletion_storage_objects',
      'get_account_deletion_storage_work_items',
      'finalize_account_deletion_storage',
      'finalize_account_deletion_auth',
      'fail_account_deletion',
      'fail_account_deletion_external_phase',
      'publish_account_deletion_policy',
      'activate_account_deletion_policy'
    );

  CREATE TEMPORARY TABLE pg_temp.g014_account_deletion_expected_rpc (
    source_signature text NOT NULL,
    grantee name NOT NULL,
    PRIMARY KEY (source_signature, grantee)
  ) ON COMMIT DROP;
  INSERT INTO pg_temp.g014_account_deletion_expected_rpc (source_signature, grantee)
  VALUES
    ('public.preview_account_deletion(uuid,uuid,timestamptz)', 'service_role'::name),
    ('public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)', 'service_role'::name),
    ('public.apply_account_deletion_database_cleanup(uuid,uuid,uuid,text,text,text)', 'service_role'::name),
    ('public.claim_account_deletion_external_phase(uuid,uuid,uuid,text,text,text,text)', 'service_role'::name),
    ('public.list_account_deletion_storage_objects(uuid,uuid,uuid,text,text,text,uuid)', 'service_role'::name),
    ('public.finalize_account_deletion_storage(uuid,uuid,uuid,text,text,text,uuid,jsonb)', 'service_role'::name),
    ('public.finalize_account_deletion_auth(uuid,uuid,uuid,text,text,text,uuid,text)', 'service_role'::name),
    ('public.fail_account_deletion(uuid,uuid,uuid,text,text,text,text)', 'service_role'::name),
    ('public.fail_account_deletion_external_phase(uuid,uuid,uuid,text,text,text,text,uuid,text)', 'service_role'::name),
    ('public.publish_account_deletion_policy(text,interval,interval,text,jsonb,text,text)', 'service_role'::name),
    ('public.activate_account_deletion_policy(text,text)', 'service_role'::name);
  SELECT expected.source_signature INTO v_missing
  FROM pg_temp.g014_account_deletion_expected_rpc AS expected
  WHERE pg_catalog.to_regprocedure(expected.source_signature) IS NULL
  ORDER BY expected.source_signature
  LIMIT 1;
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'G014-04 required public RPC identity is missing: %', v_missing;
  END IF;
  INSERT INTO privacy_retention.g014_public_rpc_allowlist (
    function_schema, function_name, identity_arguments, grantee, source_signature
  )
  SELECT namespace.nspname, procedure.proname,
         procedure.proargtypes::text,
         expected.grantee, expected.source_signature
  FROM pg_temp.g014_account_deletion_expected_rpc AS expected
  JOIN LATERAL pg_catalog.to_regprocedure(expected.source_signature) AS resolved(procedure_oid) ON true
  JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = resolved.procedure_oid
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
  ON CONFLICT DO NOTHING;
  IF EXISTS (
    (SELECT expected.source_signature, expected.grantee
     FROM pg_temp.g014_account_deletion_expected_rpc AS expected)
    EXCEPT
    (SELECT allowed.source_signature, allowed.grantee
     FROM privacy_retention.g014_public_rpc_allowlist AS allowed)
  ) THEN
    RAISE EXCEPTION 'G014-04 public RPC allowlist insert failed';
  END IF;
END;
$g014_account_deletion_rpc_allowlist$;
SELECT privacy_retention.assert_g014_public_rpc_allowlist();

-- G014-05 recovery: external deletion work is durable, single-attempt, and
-- reconciled from authoritative readback.  These objects supersede the
-- short-lived phase leases above; the legacy external RPCs are revoked below.

CREATE TABLE privacy_retention.account_deletion_external_jobs (
  request_id uuid NOT NULL REFERENCES public.account_deletion_requests(id) ON DELETE RESTRICT,
  phase text NOT NULL CHECK (phase IN ('session', 'storage', 'auth')),
  actor_user_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  preview_hash text NOT NULL CHECK (preview_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  source_manifest_hash text NOT NULL CHECK (source_manifest_hash ~ '^[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'leased', 'egress_unknown', 'reconciliation_required', 'completed')),
  current_attempt_token uuid,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  PRIMARY KEY (request_id, phase),
  CHECK ((state = 'completed') = (completed_at IS NOT NULL))
);

CREATE TABLE privacy_retention.account_deletion_external_job_attempts (
  attempt_token uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  request_id uuid NOT NULL,
  phase text NOT NULL CHECK (phase IN ('session', 'storage', 'auth')),
  state text NOT NULL DEFAULT 'leased'
    CHECK (state IN ('leased', 'egress_unknown', 'released', 'completed', 'reconciliation_required')),
  claimed_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  lease_expires_at timestamptz NOT NULL,
  unknown_outcome_at timestamptz,
  reconciled_at timestamptz,
  completed_at timestamptz,
  FOREIGN KEY (request_id, phase)
    REFERENCES privacy_retention.account_deletion_external_jobs(request_id, phase)
    ON DELETE RESTRICT,
  CHECK (lease_expires_at > claimed_at),
  CHECK (
    (state = 'leased' AND unknown_outcome_at IS NULL AND completed_at IS NULL)
    OR (state = 'egress_unknown' AND unknown_outcome_at IS NOT NULL AND completed_at IS NULL)
    OR (state IN ('released', 'reconciliation_required') AND reconciled_at IS NOT NULL AND completed_at IS NULL)
    OR (state = 'completed' AND completed_at IS NOT NULL)
  )
);
CREATE UNIQUE INDEX g014_account_deletion_one_live_job_attempt_idx
  ON privacy_retention.account_deletion_external_job_attempts (request_id, phase)
  WHERE state IN ('leased', 'egress_unknown', 'reconciliation_required');

CREATE TABLE privacy_retention.account_deletion_external_job_checkpoints (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  request_id uuid NOT NULL,
  phase text NOT NULL CHECK (phase IN ('session', 'storage', 'auth')),
  attempt_token uuid NOT NULL,
  checkpoint_kind text NOT NULL CHECK (
    checkpoint_kind IN ('egress_unknown', 'provider_proof_recorded', 'authoritative_absent')
  ),
  checkpoint_state text NOT NULL CHECK (checkpoint_state IN ('unknown', 'confirmed')),
  proof_hash text NOT NULL CHECK (proof_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (request_id, phase, attempt_token, checkpoint_kind),
  FOREIGN KEY (attempt_token)
    REFERENCES privacy_retention.account_deletion_external_job_attempts(attempt_token)
    ON DELETE RESTRICT
);

CREATE TABLE privacy_retention.account_deletion_external_job_provider_proofs (
  id uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  request_id uuid NOT NULL,
  phase text NOT NULL CHECK (phase IN ('storage', 'auth')),
  attempt_token uuid NOT NULL,
  actor_user_id uuid NOT NULL,
  target_user_id uuid NOT NULL,
  preview_hash text NOT NULL CHECK (preview_hash ~ '^[0-9a-f]{64}$'),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  source_manifest_hash text NOT NULL CHECK (source_manifest_hash ~ '^[0-9a-f]{64}$'),
  provider_receipt_ref text NOT NULL CHECK (provider_receipt_ref ~ '^[A-Za-z0-9._:-]{8,256}$'),
  provider_receipt_hash text NOT NULL CHECK (provider_receipt_hash ~ '^[0-9a-f]{64}$'),
  object_locator_hash text,
  object_version_hash text,
  proof_hash text NOT NULL CHECK (proof_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.clock_timestamp(),
  UNIQUE (request_id, phase, provider_receipt_ref),
  CHECK (
    (phase = 'storage'
      AND object_locator_hash ~ '^[0-9a-f]{64}$'
      AND object_version_hash ~ '^[0-9a-f]{64}$')
    OR (phase = 'auth' AND object_locator_hash IS NULL AND object_version_hash IS NULL)
  ),
  FOREIGN KEY (attempt_token)
    REFERENCES privacy_retention.account_deletion_external_job_attempts(attempt_token)
    ON DELETE RESTRICT
);
CREATE UNIQUE INDEX g014_account_deletion_one_storage_job_proof_idx
  ON privacy_retention.account_deletion_external_job_provider_proofs (
    request_id, phase, object_locator_hash
  )
  WHERE phase = 'storage';

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_seed_external_jobs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_phase text;
BEGIN
  IF NEW.status NOT IN ('applying', 'partial')
     OR NEW.actor_user_id IS NULL
     OR NEW.target_user_id IS NULL
     OR NEW.preview_hash IS NULL
     OR NEW.idempotency_key IS NULL
     OR NEW.source_manifest_hash IS NULL THEN
    RETURN NEW;
  END IF;

  FOREACH v_phase IN ARRAY ARRAY['session', 'storage', 'auth'] LOOP
    INSERT INTO privacy_retention.account_deletion_external_jobs (
      request_id, phase, actor_user_id, target_user_id, preview_hash,
      idempotency_key, source_manifest_hash
    ) VALUES (
      NEW.id, v_phase, NEW.actor_user_id, NEW.target_user_id, NEW.preview_hash,
      NEW.idempotency_key, NEW.source_manifest_hash
    )
    ON CONFLICT (request_id, phase) DO NOTHING;
  END LOOP;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS g014_account_deletion_seed_external_jobs
  ON public.account_deletion_requests;
CREATE TRIGGER g014_account_deletion_seed_external_jobs
AFTER INSERT OR UPDATE OF status, idempotency_key ON public.account_deletion_requests
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_account_deletion_seed_external_jobs();

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_assert_external_job_binding(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_phase text,
  p_attempt_token uuid,
  p_require_live_lease boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt privacy_retention.account_deletion_external_job_attempts%ROWTYPE;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_require_service_role();
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_request_id IS NULL
     OR p_preview_hash IS NULL OR p_idempotency_key IS NULL
     OR p_source_manifest_hash IS NULL OR p_phase IS NULL OR p_attempt_token IS NULL THEN
    RAISE EXCEPTION 'account_deletion_external_job_binding_arguments_required'
      USING ERRCODE = '22004';
  END IF;

  PERFORM privacy_retention.g014_account_deletion_lock_target(p_target_user_id);
  PERFORM privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id);

  SELECT attempt.* INTO v_attempt
  FROM privacy_retention.account_deletion_external_job_attempts AS attempt
  JOIN privacy_retention.account_deletion_external_jobs AS job
    ON job.request_id = attempt.request_id AND job.phase = attempt.phase
  JOIN public.account_deletion_requests AS request_row
    ON request_row.id = job.request_id
  WHERE attempt.attempt_token = p_attempt_token
    AND job.request_id = p_request_id
    AND job.phase = p_phase
    AND job.actor_user_id = p_actor_user_id
    AND job.target_user_id = p_target_user_id
    AND job.preview_hash = p_preview_hash
    AND job.idempotency_key = p_idempotency_key
    AND job.source_manifest_hash = p_source_manifest_hash
    AND request_row.actor_user_id = p_actor_user_id
    AND request_row.target_user_id = p_target_user_id
    AND request_row.preview_hash = p_preview_hash
    AND request_row.idempotency_key = p_idempotency_key
    AND request_row.source_manifest_hash = p_source_manifest_hash
  FOR UPDATE OF attempt;

  IF NOT FOUND
     OR (
       p_require_live_lease
       AND v_attempt.state NOT IN ('leased', 'egress_unknown')
     )
     OR (
       NOT p_require_live_lease
       AND v_attempt.state NOT IN ('leased', 'egress_unknown', 'reconciliation_required', 'completed')
     ) THEN
    RAISE EXCEPTION 'account_deletion_external_job_attempt_binding_mismatch'
      USING ERRCODE = '55000';
  END IF;
  IF p_require_live_lease AND v_attempt.lease_expires_at <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'account_deletion_external_job_attempt_expired'
      USING ERRCODE = '55000';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_assert_external_job_predecessor(
  p_request public.account_deletion_requests,
  p_phase text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_request.status NOT IN ('applying', 'partial')
     OR p_request.source_manifest_hash IS DISTINCT FROM
        privacy_retention.g014_account_deletion_validate_manifest(p_request.policy_version)
     OR (
       p_phase = 'session'
       AND (NOT p_request.db_readback_passed OR p_request.session_readback_passed)
     )
     OR (
       p_phase = 'storage'
       AND (
         NOT p_request.db_readback_passed
         OR NOT p_request.session_readback_passed
         OR p_request.storage_readback_passed
       )
     )
     OR (
       p_phase = 'auth'
       AND (
         NOT p_request.db_readback_passed
         OR NOT p_request.session_readback_passed
         OR NOT p_request.storage_readback_passed
         OR p_request.auth_readback_passed
       )
     ) THEN
    RAISE EXCEPTION 'account_deletion_external_job_predecessor_invalid'
      USING ERRCODE = '55000';
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_complete_external_job_phase(
  p_request_id uuid,
  p_phase text,
  p_attempt_token uuid
)
RETURNS public.account_deletion_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_storage_receipts_hash text;
BEGIN
  SELECT * INTO v_request
  FROM public.account_deletion_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_external_job_request_missing' USING ERRCODE = '55000';
  END IF;

  PERFORM privacy_retention.g014_account_deletion_assert_no_hold(v_request.target_user_id);

  IF p_phase = 'session' THEN
    UPDATE public.account_deletion_requests
    SET status = 'applying',
        reason_code = 'DB_AND_SESSION_READBACK_PASSED',
        session_readback_passed = true
    WHERE id = v_request.id
    RETURNING * INTO v_request;
  ELSIF p_phase = 'storage' THEN
    SELECT pg_catalog.encode(
      extensions.digest(
        COALESCE((
          SELECT pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'objectLocatorHash', proof.object_locator_hash,
              'objectVersionHash', proof.object_version_hash,
              'providerReceiptRef', proof.provider_receipt_ref,
              'providerReceiptHash', proof.provider_receipt_hash
            )
            ORDER BY proof.object_locator_hash
          )::text
          FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
          WHERE proof.request_id = v_request.id AND proof.phase = 'storage'
        ), '[]'),
        'sha256'
      ),
      'hex'
    ) INTO v_storage_receipts_hash;

    UPDATE public.account_deletion_request_items
    SET status = 'applied', reason_code = 'STORAGE_READBACK_PASSED'
    WHERE request_id = v_request.id AND data_class_code = 'storage_objects';

    UPDATE public.account_deletion_requests
    SET status = 'applying',
        reason_code = 'STORAGE_READBACK_PASSED',
        storage_readback_passed = true,
        storage_receipts_hash = v_storage_receipts_hash
    WHERE id = v_request.id
    RETURNING * INTO v_request;
  ELSIF p_phase = 'auth' THEN
    UPDATE public.account_deletion_request_items
    SET status = 'applied', reason_code = 'AUTH_READBACK_PASSED'
    WHERE request_id = v_request.id AND data_class_code = 'auth_identity';

    PERFORM privacy_retention.g014_account_deletion_assert_final_items(
      v_request.id, v_request.target_user_id
    );

    UPDATE public.account_deletion_requests
    SET status = 'applied',
        reason_code = 'APPLIED',
        auth_readback_passed = true,
        applied_at = pg_catalog.clock_timestamp()
    WHERE id = v_request.id
    RETURNING * INTO v_request;

    UPDATE privacy_retention.account_deletion_admin_reservations
    SET status = 'completed', reconciled_at = pg_catalog.clock_timestamp()
    WHERE request_id = v_request.id AND status = 'active';
  ELSE
    RAISE EXCEPTION 'account_deletion_external_job_phase_invalid' USING ERRCODE = '22023';
  END IF;

  UPDATE privacy_retention.account_deletion_external_job_attempts
  SET state = 'completed', completed_at = pg_catalog.clock_timestamp()
  WHERE attempt_token = p_attempt_token
    AND state IN ('leased', 'egress_unknown', 'reconciliation_required');

  UPDATE privacy_retention.account_deletion_external_jobs
  SET state = 'completed',
      current_attempt_token = p_attempt_token,
      completed_at = pg_catalog.clock_timestamp(),
      updated_at = pg_catalog.clock_timestamp()
  WHERE request_id = v_request.id AND phase = p_phase;

  INSERT INTO privacy_retention.account_deletion_external_job_checkpoints (
    request_id, phase, attempt_token, checkpoint_kind, checkpoint_state, proof_hash
  ) VALUES (
    v_request.id, p_phase, p_attempt_token, 'authoritative_absent', 'confirmed',
    pg_catalog.encode(
      extensions.digest(
        'g014-authoritative-absent:v1:' || v_request.id::text || ':' || p_phase,
        'sha256'
      ),
      'hex'
    )
  )
  ON CONFLICT (request_id, phase, attempt_token, checkpoint_kind) DO NOTHING;

  PERFORM privacy_retention.g014_account_deletion_append_audit(
    v_request,
    CASE WHEN p_phase = 'auth' THEN 'applied' ELSE 'readback_passed' END,
    v_request.reason_code
  );
  RETURN v_request;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_reconcile_expired_attempt(
  p_request_id uuid,
  p_phase text,
  p_attempt_token uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_job privacy_retention.account_deletion_external_jobs%ROWTYPE;
  v_attempt privacy_retention.account_deletion_external_job_attempts%ROWTYPE;
  v_current_count integer;
  v_missing_proof_count integer;
  v_absent boolean;
  v_has_egress_unknown_checkpoint boolean;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  SELECT * INTO v_job
  FROM privacy_retention.account_deletion_external_jobs
  WHERE request_id = p_request_id AND phase = p_phase
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_external_job_missing' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_attempt
  FROM privacy_retention.account_deletion_external_job_attempts
  WHERE attempt_token = p_attempt_token
    AND request_id = p_request_id
    AND phase = p_phase
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_external_job_attempt_missing' USING ERRCODE = '55000';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_external_job_checkpoints AS checkpoint
    WHERE checkpoint.request_id = p_request_id
      AND checkpoint.phase = p_phase
      AND checkpoint.attempt_token = p_attempt_token
      AND checkpoint.checkpoint_kind = 'egress_unknown'
      AND checkpoint.checkpoint_state = 'unknown'
  ) INTO v_has_egress_unknown_checkpoint;

  IF v_attempt.state = 'leased' AND NOT v_has_egress_unknown_checkpoint THEN
    IF v_attempt.lease_expires_at > v_now THEN
      RAISE EXCEPTION 'account_deletion_external_job_attempt_not_expired'
        USING ERRCODE = '55000';
    END IF;

    UPDATE privacy_retention.account_deletion_external_job_attempts
    SET state = 'released', reconciled_at = v_now
    WHERE attempt_token = p_attempt_token
      AND state = 'leased';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'account_deletion_external_job_attempt_release_failed'
        USING ERRCODE = '55000';
    END IF;

    UPDATE privacy_retention.account_deletion_external_jobs
    SET state = 'pending',
        current_attempt_token = NULL,
        updated_at = v_now
    WHERE request_id = p_request_id
      AND phase = p_phase
      AND state = 'leased'
      AND current_attempt_token = p_attempt_token;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'account_deletion_external_job_release_failed'
        USING ERRCODE = '55000';
    END IF;
    RETURN 'released';
  END IF;

  IF v_attempt.state = 'egress_unknown' AND NOT v_has_egress_unknown_checkpoint THEN
    RAISE EXCEPTION 'account_deletion_external_job_egress_checkpoint_missing'
      USING ERRCODE = '55000';
  END IF;

  IF p_phase = 'session' THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM auth.sessions WHERE user_id = v_job.target_user_id
      UNION ALL
      SELECT 1 FROM auth.refresh_tokens WHERE user_id = v_job.target_user_id
    ) INTO v_absent;
    IF v_absent THEN
      PERFORM privacy_retention.g014_account_deletion_complete_external_job_phase(
        p_request_id, p_phase, p_attempt_token
      );
      RETURN 'completed';
    END IF;
  ELSIF p_phase = 'storage' THEN
    SELECT count(*) INTO v_current_count
    FROM storage.objects
    WHERE owner_id::text = v_job.target_user_id::text;
    SELECT count(*) INTO v_missing_proof_count
    FROM privacy_retention.account_deletion_storage_objects AS captured
    WHERE captured.request_id = p_request_id
      AND NOT EXISTS (
        SELECT 1
        FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
        WHERE proof.request_id = p_request_id
          AND proof.phase = 'storage'
          AND proof.object_locator_hash = captured.object_locator_hash
          AND proof.object_version_hash = captured.object_version_hash
      );

    IF v_current_count = 0 AND v_missing_proof_count = 0 THEN
      PERFORM privacy_retention.g014_account_deletion_complete_external_job_phase(
        p_request_id, p_phase, p_attempt_token
      );
      RETURN 'completed';
    ELSIF v_current_count = 0 THEN
      UPDATE privacy_retention.account_deletion_external_job_attempts
      SET state = 'reconciliation_required', reconciled_at = v_now
      WHERE attempt_token = p_attempt_token
        AND state IN ('leased', 'egress_unknown');
      UPDATE privacy_retention.account_deletion_external_jobs
      SET state = 'reconciliation_required', updated_at = v_now
      WHERE request_id = p_request_id AND phase = p_phase;
      RETURN 'reconciliation_required';
    END IF;
  ELSIF p_phase = 'auth' THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM auth.users WHERE id = v_job.target_user_id
      UNION ALL
      SELECT 1 FROM auth.sessions WHERE user_id = v_job.target_user_id
      UNION ALL
      SELECT 1 FROM auth.identities WHERE user_id = v_job.target_user_id
      UNION ALL
      SELECT 1 FROM auth.refresh_tokens WHERE user_id = v_job.target_user_id
    ) INTO v_absent;
    IF v_absent THEN
      PERFORM privacy_retention.g014_account_deletion_complete_external_job_phase(
        p_request_id, p_phase, p_attempt_token
      );
      RETURN 'completed';
    END IF;
  ELSE
    RAISE EXCEPTION 'account_deletion_external_job_phase_invalid' USING ERRCODE = '22023';
  END IF;

  UPDATE privacy_retention.account_deletion_external_job_attempts
  SET state = 'reconciliation_required', reconciled_at = v_now
  WHERE attempt_token = p_attempt_token
    AND state IN ('leased', 'egress_unknown');
  UPDATE privacy_retention.account_deletion_external_jobs
  SET state = 'reconciliation_required',
      current_attempt_token = p_attempt_token,
      updated_at = v_now
  WHERE request_id = p_request_id AND phase = p_phase;
  RETURN 'reconciliation_required';
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_account_deletion_external_job(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_phase text,
  p_attempt_token uuid
)
RETURNS TABLE (
  request_id uuid,
  phase text,
  claim_status text,
  attempt_token uuid,
  lease_expires_at timestamptz,
  job_state text,
  checkpoint_state text,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_job privacy_retention.account_deletion_external_jobs%ROWTYPE;
  v_attempt privacy_retention.account_deletion_external_job_attempts%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_reconcile_status text;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_require_service_role();
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_request_id IS NULL
     OR p_preview_hash IS NULL OR p_idempotency_key IS NULL
     OR p_source_manifest_hash IS NULL OR p_phase NOT IN ('session', 'storage', 'auth') THEN
    RAISE EXCEPTION 'account_deletion_external_job_claim_arguments_invalid'
      USING ERRCODE = '22004';
  END IF;

  PERFORM privacy_retention.g014_account_deletion_lock_target(p_target_user_id);
  SELECT * INTO v_request
  FROM public.account_deletion_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_request.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v_request.target_user_id IS DISTINCT FROM p_target_user_id
     OR v_request.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_request.idempotency_key IS DISTINCT FROM p_idempotency_key
     OR v_request.source_manifest_hash IS DISTINCT FROM p_source_manifest_hash THEN
    RAISE EXCEPTION 'account_deletion_external_job_claim_binding_mismatch'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_job
  FROM privacy_retention.account_deletion_external_jobs
  WHERE request_id = p_request_id AND phase = p_phase
  FOR UPDATE;
  IF FOUND THEN
    IF v_job.actor_user_id IS DISTINCT FROM p_actor_user_id
       OR v_job.target_user_id IS DISTINCT FROM p_target_user_id
       OR v_job.preview_hash IS DISTINCT FROM p_preview_hash
       OR v_job.idempotency_key IS DISTINCT FROM p_idempotency_key
       OR v_job.source_manifest_hash IS DISTINCT FROM p_source_manifest_hash THEN
      RAISE EXCEPTION 'account_deletion_external_job_claim_binding_mismatch'
        USING ERRCODE = '55000';
    END IF;

    IF v_job.state = 'completed' THEN
      SELECT * INTO v_attempt
      FROM privacy_retention.account_deletion_external_job_attempts
      WHERE attempt_token = v_job.current_attempt_token
        AND request_id = p_request_id
        AND phase = p_phase
        AND state = 'completed'
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_deletion_external_job_completed_receipt_invalid'
          USING ERRCODE = '55000';
      END IF;
      IF p_attempt_token IS NOT NULL
         AND p_attempt_token IS DISTINCT FROM v_attempt.attempt_token THEN
        RAISE EXCEPTION 'account_deletion_external_job_completed_receipt_binding_mismatch'
          USING ERRCODE = '55000';
      END IF;
      RETURN QUERY SELECT p_request_id, p_phase, 'completed', v_attempt.attempt_token,
        NULL::timestamptz, 'completed', 'authoritative_absent', p_source_manifest_hash;
      RETURN;
    END IF;
  END IF;

  PERFORM privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id);
  PERFORM privacy_retention.g014_account_deletion_assert_external_job_predecessor(v_request, p_phase);

  IF v_job.request_id IS NULL THEN
    INSERT INTO privacy_retention.account_deletion_external_jobs (
      request_id, phase, actor_user_id, target_user_id, preview_hash,
      idempotency_key, source_manifest_hash
    ) VALUES (
      p_request_id, p_phase, p_actor_user_id, p_target_user_id, p_preview_hash,
      p_idempotency_key, p_source_manifest_hash
    );
    SELECT * INTO v_job
    FROM privacy_retention.account_deletion_external_jobs
    WHERE request_id = p_request_id AND phase = p_phase
    FOR UPDATE;
  END IF;

  SELECT * INTO v_attempt
  FROM privacy_retention.account_deletion_external_job_attempts
  WHERE request_id = p_request_id
    AND phase = p_phase
    AND state IN ('leased', 'egress_unknown', 'reconciliation_required')
  ORDER BY claimed_at DESC
  LIMIT 1
  FOR UPDATE;
  IF FOUND
     AND p_attempt_token IS NOT NULL
     AND p_attempt_token IS DISTINCT FROM v_attempt.attempt_token THEN
    RETURN QUERY SELECT p_request_id, p_phase, 'busy', NULL::uuid, NULL::timestamptz,
      v_job.state, v_attempt.state, p_source_manifest_hash;
    RETURN;
  END IF;

  IF FOUND AND v_attempt.state = 'egress_unknown' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM privacy_retention.account_deletion_external_job_checkpoints AS checkpoint
      WHERE checkpoint.request_id = p_request_id
        AND checkpoint.phase = p_phase
        AND checkpoint.attempt_token = v_attempt.attempt_token
        AND checkpoint.checkpoint_kind = 'egress_unknown'
        AND checkpoint.checkpoint_state = 'unknown'
    ) THEN
      RAISE EXCEPTION 'account_deletion_external_job_egress_checkpoint_missing'
        USING ERRCODE = '55000';
    END IF;

    IF p_attempt_token IS NOT NULL AND p_attempt_token = v_attempt.attempt_token THEN
      RETURN QUERY SELECT p_request_id, p_phase, 'replayed', v_attempt.attempt_token,
        NULL::timestamptz, 'egress_unknown', 'verify_absence_only', p_source_manifest_hash;
    ELSE
      RETURN QUERY SELECT p_request_id, p_phase, 'busy', NULL::uuid, NULL::timestamptz,
        'egress_unknown', 'verify_absence_only', p_source_manifest_hash;
    END IF;
    RETURN;
  END IF;

  IF FOUND AND v_attempt.state = 'reconciliation_required' THEN
    RETURN QUERY SELECT p_request_id, p_phase, 'replayed', v_attempt.attempt_token,
      NULL::timestamptz, v_job.state, 'verify_absence_only', p_source_manifest_hash;
    RETURN;
  END IF;

  IF FOUND AND v_attempt.state = 'leased' AND v_attempt.lease_expires_at > v_now THEN
    IF p_attempt_token IS NOT NULL AND p_attempt_token = v_attempt.attempt_token THEN
      RETURN QUERY SELECT p_request_id, p_phase, 'replayed', v_attempt.attempt_token,
        v_attempt.lease_expires_at, v_job.state, 'delete_then_verify', p_source_manifest_hash;
    ELSE
      RETURN QUERY SELECT p_request_id, p_phase, 'busy', NULL::uuid, NULL::timestamptz,
        v_job.state, v_attempt.state, p_source_manifest_hash;
    END IF;
    RETURN;
  END IF;

  IF FOUND THEN
    v_reconcile_status := privacy_retention.g014_account_deletion_reconcile_expired_attempt(
      p_request_id, p_phase, v_attempt.attempt_token
    );
    SELECT * INTO v_job
    FROM privacy_retention.account_deletion_external_jobs
    WHERE request_id = p_request_id AND phase = p_phase
    FOR UPDATE;
    IF v_reconcile_status = 'completed' THEN
      RETURN QUERY SELECT p_request_id, p_phase, 'completed', v_job.current_attempt_token,
        NULL::timestamptz, 'completed', 'authoritative_absent', p_source_manifest_hash;
      RETURN;
    ELSIF v_reconcile_status = 'reconciliation_required' THEN
      RETURN QUERY SELECT p_request_id, p_phase, 'replayed', v_attempt.attempt_token,
        NULL::timestamptz, v_job.state, 'verify_absence_only', p_source_manifest_hash;
      RETURN;
    ELSIF v_reconcile_status <> 'released' THEN
      RAISE EXCEPTION 'account_deletion_external_job_reconciliation_result_invalid'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF v_job.state IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'account_deletion_external_job_attempt_state_invalid'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO privacy_retention.account_deletion_external_job_attempts (
    request_id, phase, state, claimed_at, lease_expires_at
  ) VALUES (
    p_request_id, p_phase, 'leased', v_now, v_now + interval '5 minutes'
  )
  RETURNING * INTO v_attempt;

  UPDATE privacy_retention.account_deletion_external_jobs
  SET state = 'leased',
      current_attempt_token = v_attempt.attempt_token,
      updated_at = v_now
  WHERE request_id = p_request_id AND phase = p_phase;

  RETURN QUERY SELECT p_request_id, p_phase, 'claimed', v_attempt.attempt_token,
    v_attempt.lease_expires_at, 'leased', 'delete_then_verify', p_source_manifest_hash;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_account_deletion_external_egress(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_phase text,
  p_attempt_token uuid
)
RETURNS TABLE (
  request_id uuid,
  phase text,
  attempt_token uuid,
  egress_state text,
  provider_idempotency_key text,
  lease_expires_at timestamptz,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt privacy_retention.account_deletion_external_job_attempts%ROWTYPE;
  v_key text;
  v_absent boolean;
  v_missing_proof_count integer;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_assert_external_job_binding(
    p_actor_user_id, p_target_user_id, p_request_id, p_preview_hash,
    p_idempotency_key, p_source_manifest_hash, p_phase, p_attempt_token, true
  );
  SELECT * INTO v_attempt
  FROM privacy_retention.account_deletion_external_job_attempts
  WHERE attempt_token = p_attempt_token
  FOR UPDATE;
  IF v_attempt.state IS DISTINCT FROM 'leased' THEN
    RAISE EXCEPTION 'account_deletion_external_egress_already_prepared'
      USING ERRCODE = '55000';
  END IF;
  IF p_phase = 'auth' THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM auth.users WHERE id = p_target_user_id
      UNION ALL SELECT 1 FROM auth.sessions WHERE user_id = p_target_user_id
      UNION ALL SELECT 1 FROM auth.identities WHERE user_id = p_target_user_id
      UNION ALL SELECT 1 FROM auth.refresh_tokens WHERE user_id = p_target_user_id
    ) INTO v_absent;
    IF v_absent THEN
      PERFORM privacy_retention.g014_account_deletion_complete_external_job_phase(
        p_request_id, 'auth', p_attempt_token
      );
      RETURN QUERY SELECT p_request_id, p_phase, p_attempt_token, 'authoritative_absent',
        NULL::text, v_attempt.lease_expires_at, p_source_manifest_hash;
      RETURN;
    END IF;
  END IF;
  IF p_phase = 'storage' THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM storage.objects WHERE owner_id::text = p_target_user_id::text
    ) INTO v_absent;
    IF v_absent THEN
      SELECT count(*) INTO v_missing_proof_count
      FROM privacy_retention.account_deletion_storage_objects AS captured
      WHERE captured.request_id = p_request_id
        AND NOT EXISTS (
          SELECT 1
          FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
          WHERE proof.request_id = p_request_id
            AND proof.phase = 'storage'
            AND proof.object_locator_hash = captured.object_locator_hash
            AND proof.object_version_hash = captured.object_version_hash
        );
      IF v_missing_proof_count = 0 THEN
        PERFORM privacy_retention.g014_account_deletion_complete_external_job_phase(
          p_request_id, 'storage', p_attempt_token
        );
        RETURN QUERY SELECT p_request_id, p_phase, p_attempt_token, 'authoritative_absent',
          NULL::text, v_attempt.lease_expires_at, p_source_manifest_hash;
        RETURN;
      END IF;
      RAISE EXCEPTION 'account_deletion_storage_reconciliation_required'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  v_key := CASE p_phase
    WHEN 'storage' THEN 'g014-storage-' || pg_catalog.substr(p_request_id::text, 1, 8) || '-' || p_attempt_token::text
    WHEN 'auth' THEN 'g014-auth-' || pg_catalog.substr(p_request_id::text, 1, 8) || '-' || p_attempt_token::text
    ELSE 'g014-session-' || pg_catalog.substr(p_request_id::text, 1, 8) || '-' || p_attempt_token::text
  END;

  UPDATE privacy_retention.account_deletion_external_job_attempts
  SET state = 'egress_unknown', unknown_outcome_at = pg_catalog.clock_timestamp()
  WHERE attempt_token = p_attempt_token;
  UPDATE privacy_retention.account_deletion_external_jobs
  SET state = 'egress_unknown', updated_at = pg_catalog.clock_timestamp()
  WHERE request_id = p_request_id AND phase = p_phase;
  INSERT INTO privacy_retention.account_deletion_external_job_checkpoints (
    request_id, phase, attempt_token, checkpoint_kind, checkpoint_state, proof_hash
  ) VALUES (
    p_request_id, p_phase, p_attempt_token, 'egress_unknown', 'unknown',
    pg_catalog.encode(
      extensions.digest('g014-egress-unknown:v1:' || p_request_id::text || ':' || p_phase || ':' || p_attempt_token::text, 'sha256'),
      'hex'
    )
  );

  RETURN QUERY SELECT p_request_id, p_phase, p_attempt_token, 'egress_unknown',
    v_key, v_attempt.lease_expires_at, p_source_manifest_hash;
END;
$function$;

CREATE OR REPLACE FUNCTION public.read_account_deletion_external_job(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_phase text,
  p_attempt_token uuid
)
RETURNS TABLE (
  request_id uuid,
  phase text,
  attempt_token uuid,
  job_state text,
  attempt_state text,
  lease_expires_at timestamptz,
  authoritative_absent boolean,
  provider_proof_count integer,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_job privacy_retention.account_deletion_external_jobs%ROWTYPE;
  v_attempt privacy_retention.account_deletion_external_job_attempts%ROWTYPE;
  v_absent boolean;
  v_proof_count integer;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_assert_external_job_binding(
    p_actor_user_id, p_target_user_id, p_request_id, p_preview_hash,
    p_idempotency_key, p_source_manifest_hash, p_phase, p_attempt_token, false
  );
  SELECT * INTO v_job FROM privacy_retention.account_deletion_external_jobs
  WHERE request_id = p_request_id AND phase = p_phase;
  SELECT * INTO v_attempt FROM privacy_retention.account_deletion_external_job_attempts
  WHERE attempt_token = p_attempt_token;

  IF p_phase = 'session' THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM auth.sessions WHERE user_id = p_target_user_id
      UNION ALL
      SELECT 1 FROM auth.refresh_tokens WHERE user_id = p_target_user_id
    ) INTO v_absent;
  ELSIF p_phase = 'storage' THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM storage.objects WHERE owner_id::text = p_target_user_id::text
    ) INTO v_absent;
  ELSE
    SELECT NOT EXISTS (
      SELECT 1 FROM auth.users WHERE id = p_target_user_id
      UNION ALL SELECT 1 FROM auth.sessions WHERE user_id = p_target_user_id
      UNION ALL SELECT 1 FROM auth.identities WHERE user_id = p_target_user_id
      UNION ALL SELECT 1 FROM auth.refresh_tokens WHERE user_id = p_target_user_id
    ) INTO v_absent;
  END IF;

  SELECT count(*) INTO v_proof_count
  FROM privacy_retention.account_deletion_external_job_provider_proofs
  WHERE request_id = p_request_id AND phase = p_phase;

  RETURN QUERY SELECT p_request_id, p_phase, p_attempt_token, v_job.state, v_attempt.state,
    v_attempt.lease_expires_at, v_absent, v_proof_count, p_source_manifest_hash;
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_account_deletion_session_family_cleanup(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_attempt_token uuid
)
RETURNS TABLE (
  request_id uuid,
  status text,
  session_readback_passed boolean,
  job_state text,
  checkpoint_state text,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_attempt privacy_retention.account_deletion_external_job_attempts%ROWTYPE;
  v_absent boolean;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_assert_external_job_binding(
    p_actor_user_id, p_target_user_id, p_request_id, p_preview_hash,
    p_idempotency_key, p_source_manifest_hash, 'session', p_attempt_token, false
  );
  SELECT * INTO v_attempt
  FROM privacy_retention.account_deletion_external_job_attempts
  WHERE attempt_token = p_attempt_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_session_cleanup_not_prepared' USING ERRCODE = '55000';
  END IF;

  IF v_attempt.state IN ('egress_unknown', 'reconciliation_required') THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM auth.sessions WHERE user_id = p_target_user_id
      UNION ALL
      SELECT 1 FROM auth.refresh_tokens WHERE user_id = p_target_user_id
    ) INTO v_absent;
    IF v_absent THEN
      v_request := privacy_retention.g014_account_deletion_complete_external_job_phase(
        p_request_id, 'session', p_attempt_token
      );
      RETURN QUERY SELECT v_request.id, v_request.status, v_request.session_readback_passed,
        'completed', 'authoritative_absent', v_request.source_manifest_hash;
      RETURN;
    END IF;

    SELECT * INTO v_request
    FROM public.account_deletion_requests
    WHERE id = p_request_id;
    RETURN QUERY SELECT v_request.id, v_request.status, false,
      v_attempt.state, 'verify_absence_only', v_request.source_manifest_hash;
    RETURN;
  END IF;

  PERFORM privacy_retention.g014_account_deletion_assert_external_job_binding(
    p_actor_user_id, p_target_user_id, p_request_id, p_preview_hash,
    p_idempotency_key, p_source_manifest_hash, 'session', p_attempt_token, true
  );
  IF v_attempt.state IS DISTINCT FROM 'leased' THEN
    RAISE EXCEPTION 'account_deletion_session_cleanup_not_prepared' USING ERRCODE = '55000';
  END IF;

  UPDATE privacy_retention.account_deletion_external_job_attempts
  SET state = 'egress_unknown', unknown_outcome_at = pg_catalog.clock_timestamp()
  WHERE attempt_token = p_attempt_token
    AND state = 'leased';
  UPDATE privacy_retention.account_deletion_external_jobs
  SET state = 'egress_unknown', updated_at = pg_catalog.clock_timestamp()
  WHERE request_id = p_request_id AND phase = 'session';
  INSERT INTO privacy_retention.account_deletion_external_job_checkpoints (
    request_id, phase, attempt_token, checkpoint_kind, checkpoint_state, proof_hash
  ) VALUES (
    p_request_id, 'session', p_attempt_token, 'egress_unknown', 'unknown',
    pg_catalog.encode(
      extensions.digest('g014-egress-unknown:v1:' || p_request_id::text || ':session:' || p_attempt_token::text, 'sha256'),
      'hex'
    )
  );

  DELETE FROM auth.refresh_tokens WHERE user_id = p_target_user_id;
  DELETE FROM auth.sessions WHERE user_id = p_target_user_id;
  SELECT NOT EXISTS (
    SELECT 1 FROM auth.sessions WHERE user_id = p_target_user_id
    UNION ALL
    SELECT 1 FROM auth.refresh_tokens WHERE user_id = p_target_user_id
  ) INTO v_absent;

  IF v_absent THEN
    v_request := privacy_retention.g014_account_deletion_complete_external_job_phase(
      p_request_id, 'session', p_attempt_token
    );
    RETURN QUERY SELECT v_request.id, v_request.status, v_request.session_readback_passed,
      'completed', 'authoritative_absent', v_request.source_manifest_hash;
    RETURN;
  END IF;

  UPDATE public.account_deletion_requests
  SET status = 'partial', reason_code = 'SESSION_READBACK_REQUIRED'
  WHERE id = p_request_id
  RETURNING * INTO v_request;
  RETURN QUERY SELECT v_request.id, v_request.status, false,
    'egress_unknown', 'verify_absence_only', v_request.source_manifest_hash;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_account_deletion_storage_work(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_attempt_token uuid
)
RETURNS TABLE (
  bucket_id text,
  object_name text,
  object_locator_hash text,
  object_version_hash text,
  provider_idempotency_key text,
  work_state text,
  work_mode text,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt privacy_retention.account_deletion_external_job_attempts%ROWTYPE;
  v_current_count integer;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_assert_external_job_binding(
    p_actor_user_id, p_target_user_id, p_request_id, p_preview_hash,
    p_idempotency_key, p_source_manifest_hash, 'storage', p_attempt_token, false
  );
  SELECT * INTO v_attempt
  FROM privacy_retention.account_deletion_external_job_attempts
  WHERE attempt_token = p_attempt_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_storage_work_not_prepared' USING ERRCODE = '55000';
  END IF;

IF v_attempt.state = 'egress_unknown' THEN
  RETURN QUERY
  SELECT
    captured.bucket_id,
    captured.object_name,
    captured.object_locator_hash,
    captured.object_version_hash,
    'g014-storage-' || pg_catalog.substr(captured.object_locator_hash, 1, 40),
    'verify_absence_only',
    'verify_absence_only',
    p_source_manifest_hash
  FROM privacy_retention.account_deletion_storage_objects AS captured
  WHERE captured.request_id = p_request_id
    AND NOT EXISTS (
      SELECT 1
      FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
      WHERE proof.request_id = p_request_id
        AND proof.phase = 'storage'
        AND proof.object_locator_hash = captured.object_locator_hash
        AND proof.object_version_hash = captured.object_version_hash
    )
  ORDER BY captured.bucket_id, captured.object_name;
  RETURN;
END IF;

IF v_attempt.state = 'reconciliation_required' THEN
  SELECT count(*) INTO v_current_count
  FROM storage.objects
  WHERE owner_id::text = p_target_user_id::text;
  IF v_current_count <> 0 THEN
    RAISE EXCEPTION 'account_deletion_storage_reconciliation_absence_not_confirmed'
      USING ERRCODE = '55000';
  END IF;

  RETURN QUERY
  SELECT
    captured.bucket_id,
    captured.object_name,
    captured.object_locator_hash,
    captured.object_version_hash,
    'g014-storage-' || pg_catalog.substr(captured.object_locator_hash, 1, 40),
    'verify_absence_only',
    'verify_absence_only',
    p_source_manifest_hash
  FROM privacy_retention.account_deletion_storage_objects AS captured
  WHERE captured.request_id = p_request_id
    AND NOT EXISTS (
      SELECT 1
      FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
      WHERE proof.request_id = p_request_id
        AND proof.phase = 'storage'
        AND proof.object_locator_hash = captured.object_locator_hash
        AND proof.object_version_hash = captured.object_version_hash
    )
  ORDER BY captured.bucket_id, captured.object_name;
  RETURN;
END IF;

PERFORM privacy_retention.g014_account_deletion_assert_external_job_binding(
  p_actor_user_id, p_target_user_id, p_request_id, p_preview_hash,
  p_idempotency_key, p_source_manifest_hash, 'storage', p_attempt_token, true
);
IF v_attempt.state IS DISTINCT FROM 'leased' THEN
  RAISE EXCEPTION 'account_deletion_storage_work_not_prepared' USING ERRCODE = '55000';
END IF;

INSERT INTO privacy_retention.account_deletion_storage_objects (
  request_id, bucket_id, object_name, object_locator_hash, object_version_hash
)
SELECT
  p_request_id,
  object_row.bucket_id::text,
  object_row.name::text,
  pg_catalog.encode(extensions.digest(object_row.bucket_id::text || E'\n' || object_row.name::text, 'sha256'), 'hex'),
  pg_catalog.encode(extensions.digest(pg_catalog.to_jsonb(object_row) ->> 'version', 'sha256'), 'hex')
FROM storage.objects AS object_row
WHERE object_row.owner_id::text = p_target_user_id::text
ON CONFLICT (request_id, bucket_id, object_name) DO NOTHING;

RETURN QUERY
SELECT
  captured.bucket_id,
  captured.object_name,
  captured.object_locator_hash,
  captured.object_version_hash,
  'g014-storage-' || pg_catalog.substr(captured.object_locator_hash, 1, 40),
  'delete_then_verify',
  'delete_then_verify',
  p_source_manifest_hash
FROM privacy_retention.account_deletion_storage_objects AS captured
JOIN storage.objects AS object_row
  ON object_row.bucket_id::text = captured.bucket_id
 AND object_row.name::text = captured.object_name
WHERE captured.request_id = p_request_id
  AND object_row.owner_id::text = p_target_user_id::text
  AND captured.object_version_hash = pg_catalog.encode(
    extensions.digest(pg_catalog.to_jsonb(object_row) ->> 'version', 'sha256'), 'hex'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
    WHERE proof.request_id = p_request_id
      AND proof.phase = 'storage'
      AND proof.object_locator_hash = captured.object_locator_hash
      AND proof.object_version_hash = captured.object_version_hash
  )
ORDER BY captured.bucket_id, captured.object_name;
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_account_deletion_external_provider_proof(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_phase text,
  p_attempt_token uuid,
  p_provider_receipt_ref text,
  p_provider_receipt_hash text,
  p_object_locator_hash text,
  p_object_version_hash text
)
RETURNS TABLE (
  request_id uuid,
  phase text,
  attempt_token uuid,
  provider_receipt_ref text,
  proof_hash text,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_proof_hash text;
BEGIN
  IF p_phase NOT IN ('storage', 'auth')
     OR p_provider_receipt_ref !~ '^[A-Za-z0-9._:-]{8,256}$'
     OR p_provider_receipt_hash !~ '^[0-9a-f]{64}$'
     OR (
       p_phase = 'storage'
       AND (p_object_locator_hash !~ '^[0-9a-f]{64}$' OR p_object_version_hash !~ '^[0-9a-f]{64}$')
     )
     OR (
       p_phase = 'auth'
       AND (p_object_locator_hash IS NOT NULL OR p_object_version_hash IS NOT NULL)
     ) THEN
    RAISE EXCEPTION 'account_deletion_external_provider_proof_arguments_invalid'
      USING ERRCODE = '22023';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_assert_external_job_binding(
    p_actor_user_id, p_target_user_id, p_request_id, p_preview_hash,
    p_idempotency_key, p_source_manifest_hash, p_phase, p_attempt_token, false
  );
  IF NOT EXISTS (
    SELECT 1 FROM privacy_retention.account_deletion_external_job_attempts
    WHERE attempt_token = p_attempt_token
      AND state IN ('egress_unknown', 'reconciliation_required')
  ) THEN
    RAISE EXCEPTION 'account_deletion_external_provider_proof_not_prepared'
      USING ERRCODE = '55000';
  END IF;
  IF p_phase = 'storage' AND NOT EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_storage_objects
    WHERE request_id = p_request_id
      AND object_locator_hash = p_object_locator_hash
      AND object_version_hash = p_object_version_hash
  ) THEN
    RAISE EXCEPTION 'account_deletion_external_provider_proof_storage_binding_mismatch'
      USING ERRCODE = '55000';
  END IF;

  v_proof_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.concat_ws(
        ':', 'g014-external-provider-proof-v1', p_request_id::text, p_phase,
        p_attempt_token::text, p_provider_receipt_ref, p_provider_receipt_hash,
        COALESCE(p_object_locator_hash, '<none>'), COALESCE(p_object_version_hash, '<none>')
      ),
      'sha256'
    ),
    'hex'
  );
  INSERT INTO privacy_retention.account_deletion_external_job_provider_proofs (
    request_id, phase, attempt_token, actor_user_id, target_user_id, preview_hash,
    idempotency_key, source_manifest_hash, provider_receipt_ref, provider_receipt_hash,
    object_locator_hash, object_version_hash, proof_hash
  ) VALUES (
    p_request_id, p_phase, p_attempt_token, p_actor_user_id, p_target_user_id, p_preview_hash,
    p_idempotency_key, p_source_manifest_hash, p_provider_receipt_ref, p_provider_receipt_hash,
    p_object_locator_hash, p_object_version_hash, v_proof_hash
  )
  ON CONFLICT (request_id, phase, provider_receipt_ref) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_external_job_provider_proofs
    WHERE request_id = p_request_id
      AND phase = p_phase
      AND attempt_token = p_attempt_token
      AND provider_receipt_ref = p_provider_receipt_ref
      AND proof_hash = v_proof_hash
  ) THEN
    RAISE EXCEPTION 'account_deletion_external_provider_proof_replay_mismatch'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO privacy_retention.account_deletion_external_job_checkpoints (
    request_id, phase, attempt_token, checkpoint_kind, checkpoint_state, proof_hash
  ) VALUES (
    p_request_id, p_phase, p_attempt_token, 'provider_proof_recorded', 'confirmed', v_proof_hash
  )
  ON CONFLICT (request_id, phase, attempt_token, checkpoint_kind) DO NOTHING;

  RETURN QUERY SELECT p_request_id, p_phase, p_attempt_token, p_provider_receipt_ref,
    v_proof_hash, p_source_manifest_hash;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_account_deletion_storage_job(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_attempt_token uuid
)
RETURNS TABLE (
  request_id uuid,
  status text,
  storage_readback_passed boolean,
  job_state text,
  expected_work_count integer,
  provider_proof_count integer,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_current_count integer;
  v_expected_count integer;
  v_missing_proof_count integer;
  v_proof_count integer;
  v_job_state text;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_assert_external_job_binding(
    p_actor_user_id, p_target_user_id, p_request_id, p_preview_hash,
    p_idempotency_key, p_source_manifest_hash, 'storage', p_attempt_token, false
  );
  SELECT count(*) INTO v_current_count
  FROM storage.objects WHERE owner_id::text = p_target_user_id::text;
  SELECT count(*) INTO v_expected_count
  FROM privacy_retention.account_deletion_storage_objects WHERE request_id = p_request_id;
  SELECT count(*) INTO v_missing_proof_count
  FROM privacy_retention.account_deletion_storage_objects AS captured
  WHERE captured.request_id = p_request_id
    AND NOT EXISTS (
      SELECT 1 FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
      WHERE proof.request_id = p_request_id
        AND proof.phase = 'storage'
        AND proof.object_locator_hash = captured.object_locator_hash
        AND proof.object_version_hash = captured.object_version_hash
    );
  SELECT count(*) INTO v_proof_count
  FROM privacy_retention.account_deletion_external_job_provider_proofs
  WHERE request_id = p_request_id AND phase = 'storage';

  IF v_current_count = 0 AND v_missing_proof_count = 0 THEN
    v_request := privacy_retention.g014_account_deletion_complete_external_job_phase(
      p_request_id, 'storage', p_attempt_token
    );
    RETURN QUERY SELECT v_request.id, v_request.status, v_request.storage_readback_passed,
      'completed', v_expected_count, v_proof_count, v_request.source_manifest_hash;
    RETURN;
  END IF;

  SELECT * INTO v_request FROM public.account_deletion_requests WHERE id = p_request_id;
  SELECT state INTO v_job_state
  FROM privacy_retention.account_deletion_external_jobs
  WHERE request_id = p_request_id AND phase = 'storage';
  RETURN QUERY SELECT v_request.id, v_request.status, false,
    v_job_state, v_expected_count, v_proof_count, v_request.source_manifest_hash;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_account_deletion_auth_job(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_attempt_token uuid
)
RETURNS TABLE (
  request_id uuid,
  status text,
  auth_readback_passed boolean,
  job_state text,
  provider_proof_count integer,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_absent boolean;
  v_proof_count integer;
  v_job_state text;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_assert_external_job_binding(
    p_actor_user_id, p_target_user_id, p_request_id, p_preview_hash,
    p_idempotency_key, p_source_manifest_hash, 'auth', p_attempt_token, false
  );
  SELECT NOT EXISTS (
    SELECT 1 FROM auth.users WHERE id = p_target_user_id
    UNION ALL SELECT 1 FROM auth.sessions WHERE user_id = p_target_user_id
    UNION ALL SELECT 1 FROM auth.identities WHERE user_id = p_target_user_id
    UNION ALL SELECT 1 FROM auth.refresh_tokens WHERE user_id = p_target_user_id
  ) INTO v_absent;
  SELECT count(*) INTO v_proof_count
  FROM privacy_retention.account_deletion_external_job_provider_proofs
  WHERE request_id = p_request_id AND phase = 'auth';

  IF v_absent THEN
    v_request := privacy_retention.g014_account_deletion_complete_external_job_phase(
      p_request_id, 'auth', p_attempt_token
    );
    RETURN QUERY SELECT v_request.id, v_request.status, v_request.auth_readback_passed,
      'completed', v_proof_count, v_request.source_manifest_hash;
    RETURN;
  END IF;

  SELECT * INTO v_request FROM public.account_deletion_requests WHERE id = p_request_id;
  SELECT state INTO v_job_state
  FROM privacy_retention.account_deletion_external_jobs
  WHERE request_id = p_request_id AND phase = 'auth';
  RETURN QUERY SELECT v_request.id, v_request.status, false,
    v_job_state, v_proof_count, v_request.source_manifest_hash;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_hold_subject_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('g014-account-deletion-target-hash:' || NEW.subject_ref_hash, 0)
  );

  IF NEW.status = 'active'
     AND (NEW.expires_at IS NULL OR NEW.expires_at > pg_catalog.clock_timestamp())
     AND EXISTS (
       SELECT 1
       FROM privacy_retention.account_deletion_hold_class_map AS hold_map
       WHERE hold_map.deletion_class = 'account_deletion'
         AND hold_map.hold_data_class = NEW.data_class
     )
     AND EXISTS (
       SELECT 1
       FROM privacy_retention.account_deletion_external_job_attempts AS attempt
       JOIN privacy_retention.account_deletion_external_jobs AS job
         ON job.request_id = attempt.request_id AND job.phase = attempt.phase
       WHERE attempt.state IN ('leased', 'egress_unknown', 'reconciliation_required')
         AND privacy_retention.g014_account_deletion_subject_hash(job.target_user_id)
             = NEW.subject_ref_hash
     ) THEN
    RAISE EXCEPTION 'account_deletion_external_job_blocks_hold_activation'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS g014_account_deletion_hold_subject_lock
  ON privacy_retention.privacy_legal_holds;
CREATE TRIGGER g014_account_deletion_hold_subject_lock
BEFORE INSERT OR UPDATE OF status, expires_at, subject_ref_hash, data_class
ON privacy_retention.privacy_legal_holds
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_account_deletion_hold_subject_lock();

CREATE OR REPLACE FUNCTION public.apply_account_deletion_database_cleanup(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text
)
RETURNS TABLE (
  request_id uuid,
  status text,
  reason_code text,
  db_readback_passed boolean,
  session_readback_passed boolean,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_manifest privacy_retention.account_deletion_source_manifest%ROWTYPE;
  v_evidence_cleanup_lease_token uuid;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_require_service_role();
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_request_id IS NULL
     OR p_preview_hash IS NULL OR p_idempotency_key IS NULL OR p_source_manifest_hash IS NULL THEN
    RAISE EXCEPTION 'account_deletion_database_arguments_required' USING ERRCODE = '22004';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_lock_target(p_target_user_id);
  SELECT * INTO v_request FROM public.account_deletion_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND
     OR v_request.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v_request.target_user_id IS DISTINCT FROM p_target_user_id
     OR v_request.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_request.idempotency_key IS DISTINCT FROM p_idempotency_key
     OR v_request.source_manifest_hash IS DISTINCT FROM p_source_manifest_hash THEN
    RAISE EXCEPTION 'account_deletion_database_binding_mismatch' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_assert_actor_allowed(p_actor_user_id, p_target_user_id);
  PERFORM privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id);
  IF v_request.status NOT IN ('applying', 'partial')
     OR v_request.source_manifest_hash IS DISTINCT FROM
        privacy_retention.g014_account_deletion_validate_manifest(v_request.policy_version) THEN
    RAISE EXCEPTION 'account_deletion_database_predecessor_invalid' USING ERRCODE = '55000';
  END IF;

  FOR v_manifest IN
    SELECT manifest.*
    FROM privacy_retention.account_deletion_source_manifest AS manifest
    WHERE manifest.policy_version = v_request.policy_version
      AND manifest.code NOT IN ('storage_objects', 'auth_identity')
    ORDER BY manifest.ordinal, manifest.code
  LOOP
    PERFORM privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id);
    PERFORM privacy_retention.g014_account_deletion_apply_adapter(
      v_manifest.adapter_name, v_request.id, p_target_user_id
    );
    UPDATE public.account_deletion_request_items AS item
    SET status = CASE item.disposition
      WHEN 'retain' THEN 'retained'
      WHEN 'separate' THEN 'separated'
      ELSE 'applied'
    END,
    reason_code = 'DB_READBACK_PASSED'
    WHERE item.request_id = v_request.id AND item.data_class_code = v_manifest.code;
  END LOOP;

  v_evidence_cleanup_lease_token := pg_catalog.nullif(
    pg_catalog.current_setting('app.account_deletion_evidence_lease_token', true), ''
  )::uuid;
  IF v_evidence_cleanup_lease_token IS NOT NULL THEN
    PERFORM privacy_retention.g014_account_deletion_release_evidence_cleanup(
      v_request.id, p_target_user_id, v_evidence_cleanup_lease_token
    );
  END IF;

  UPDATE public.account_deletion_requests
  SET status = 'applying',
      reason_code = 'DB_READBACK_PASSED',
      db_readback_passed = true,
      session_readback_passed = false
  WHERE id = v_request.id
  RETURNING * INTO v_request;
  PERFORM privacy_retention.g014_account_deletion_append_audit(
    v_request, 'readback_passed', 'DB_READBACK_PASSED'
  );
  RETURN QUERY SELECT v_request.id, v_request.status, v_request.reason_code,
    v_request.db_readback_passed, v_request.session_readback_passed,
    v_request.source_manifest_hash;
END;
$function$;

DO $g014_account_deletion_external_jobs_security$
DECLARE
  v_relation regclass;
  v_signature text;
BEGIN
  FOREACH v_relation IN ARRAY ARRAY[
    'privacy_retention.account_deletion_external_jobs'::regclass,
    'privacy_retention.account_deletion_external_job_attempts'::regclass,
    'privacy_retention.account_deletion_external_job_checkpoints'::regclass,
    'privacy_retention.account_deletion_external_job_provider_proofs'::regclass
  ] LOOP
    EXECUTE pg_catalog.format('ALTER TABLE %s OWNER TO privacy_workflow_owner', v_relation);
    EXECUTE pg_catalog.format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', v_relation);
    EXECUTE pg_catalog.format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', v_relation);
    EXECUTE pg_catalog.format('REVOKE ALL ON TABLE %s FROM PUBLIC, anon, authenticated, service_role', v_relation);
    EXECUTE pg_catalog.format('GRANT ALL ON TABLE %s TO privacy_workflow_owner', v_relation);
    EXECUTE pg_catalog.format(
      'CREATE POLICY g014_account_deletion_owner_access ON %s FOR ALL TO privacy_workflow_owner USING (true) WITH CHECK (true)',
      v_relation
    );
  END LOOP;

  FOREACH v_signature IN ARRAY ARRAY[
    'privacy_retention.g014_account_deletion_seed_external_jobs()',
    'privacy_retention.g014_account_deletion_assert_external_job_binding(uuid,uuid,uuid,text,text,text,text,uuid,boolean)',
    'privacy_retention.g014_account_deletion_assert_external_job_predecessor(public.account_deletion_requests,text)',
    'privacy_retention.g014_account_deletion_complete_external_job_phase(uuid,text,uuid)',
    'privacy_retention.g014_account_deletion_reconcile_expired_attempt(uuid,text,uuid)',
    'privacy_retention.g014_account_deletion_hold_subject_lock()',
    'public.apply_account_deletion_database_cleanup(uuid,uuid,uuid,text,text,text)',
    'public.claim_account_deletion_external_job(uuid,uuid,uuid,text,text,text,text,uuid)',
    'public.prepare_account_deletion_external_egress(uuid,uuid,uuid,text,text,text,text,uuid)',
    'public.read_account_deletion_external_job(uuid,uuid,uuid,text,text,text,text,uuid)',
    'public.run_account_deletion_session_family_cleanup(uuid,uuid,uuid,text,text,text,uuid)',
    'public.get_account_deletion_storage_work(uuid,uuid,uuid,text,text,text,uuid)',
    'public.record_account_deletion_external_provider_proof(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text)',
    'public.reconcile_account_deletion_storage_job(uuid,uuid,uuid,text,text,text,uuid)',
    'public.reconcile_account_deletion_auth_job(uuid,uuid,uuid,text,text,text,uuid)'
  ] LOOP
    EXECUTE pg_catalog.format('ALTER FUNCTION %s OWNER TO privacy_workflow_owner', v_signature);
    EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role', v_signature);
  END LOOP;
END;
$g014_account_deletion_external_jobs_security$;

GRANT USAGE ON SCHEMA auth, storage TO privacy_workflow_owner;
GRANT SELECT, DELETE ON TABLE auth.sessions, auth.refresh_tokens TO privacy_workflow_owner;
REVOKE ALL ON TABLE auth.sessions, auth.refresh_tokens, auth.identities, auth.users, storage.objects
  FROM service_role;

REVOKE ALL ON FUNCTION
  public.claim_account_deletion_external_phase(uuid,uuid,uuid,text,text,text,text),
  public.list_account_deletion_storage_objects(uuid,uuid,uuid,text,text,text,uuid),
  public.finalize_account_deletion_storage(uuid,uuid,uuid,text,text,text,uuid,jsonb),
  public.finalize_account_deletion_auth(uuid,uuid,uuid,text,text,text,uuid,text),
  public.fail_account_deletion_external_phase(uuid,uuid,uuid,text,text,text,text,uuid,text)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION
  public.apply_account_deletion_database_cleanup(uuid,uuid,uuid,text,text,text),
  public.claim_account_deletion_external_job(uuid,uuid,uuid,text,text,text,text,uuid),
  public.prepare_account_deletion_external_egress(uuid,uuid,uuid,text,text,text,text,uuid),
  public.read_account_deletion_external_job(uuid,uuid,uuid,text,text,text,text,uuid),
  public.run_account_deletion_session_family_cleanup(uuid,uuid,uuid,text,text,text,uuid),
  public.get_account_deletion_storage_work(uuid,uuid,uuid,text,text,text,uuid),
  public.record_account_deletion_external_provider_proof(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text),
  public.reconcile_account_deletion_storage_job(uuid,uuid,uuid,text,text,text,uuid),
  public.reconcile_account_deletion_auth_job(uuid,uuid,uuid,text,text,text,uuid)
TO service_role;

DELETE FROM privacy_retention.g014_public_rpc_allowlist
WHERE function_schema = 'public'
  AND function_name IN (
    'claim_account_deletion_external_phase',
    'list_account_deletion_storage_objects',
    'finalize_account_deletion_storage',
    'finalize_account_deletion_auth',
    'fail_account_deletion_external_phase'
  );

INSERT INTO privacy_retention.g014_public_rpc_allowlist (
  function_schema, function_name, identity_arguments, grantee, source_signature
)
SELECT namespace.nspname,
       procedure.proname,
       procedure.proargtypes::text,
       'service_role'::name,
       expected.source_signature
FROM (
  VALUES
    ('public.claim_account_deletion_external_job(uuid,uuid,uuid,text,text,text,text,uuid)'),
    ('public.prepare_account_deletion_external_egress(uuid,uuid,uuid,text,text,text,text,uuid)'),
    ('public.read_account_deletion_external_job(uuid,uuid,uuid,text,text,text,text,uuid)'),
    ('public.run_account_deletion_session_family_cleanup(uuid,uuid,uuid,text,text,text,uuid)'),
    ('public.get_account_deletion_storage_work(uuid,uuid,uuid,text,text,text,uuid)'),
    ('public.record_account_deletion_external_provider_proof(uuid,uuid,uuid,text,text,text,text,uuid,text,text,text,text)'),
    ('public.reconcile_account_deletion_storage_job(uuid,uuid,uuid,text,text,text,uuid)'),
    ('public.reconcile_account_deletion_auth_job(uuid,uuid,uuid,text,text,text,uuid)')
) AS expected(source_signature)
JOIN LATERAL pg_catalog.to_regprocedure(expected.source_signature) AS resolved(procedure_oid) ON true
JOIN pg_catalog.pg_proc AS procedure ON procedure.oid = resolved.procedure_oid
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
ON CONFLICT DO NOTHING;

SELECT privacy_retention.assert_g014_public_rpc_allowlist();
-- The existing begin/readback RPC exposes this privacy-safe receipt shape.  Its
-- source is the durable worker proof ledger, never the retired lease receipt
-- table, so an Auth-resume completion has the same browser-cleanup readback.
CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_storage_receipt_refs(
  p_request_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT COALESCE(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'object_locator_hash', proof.object_locator_hash,
        'object_version_hash', proof.object_version_hash,
        'provider_receipt_ref', proof.provider_receipt_ref,
        'provider_receipt_hash', proof.provider_receipt_hash
      )
      ORDER BY proof.object_locator_hash
    ),
    '[]'::jsonb
  )
  FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
  WHERE proof.request_id = p_request_id
    AND proof.phase = 'storage';
$function$;
ALTER FUNCTION privacy_retention.g014_account_deletion_storage_receipt_refs(uuid)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_account_deletion_storage_receipt_refs(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_assert_final_items(
  p_request_id uuid,
  p_target_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_request_id IS NULL OR p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'account_deletion_final_item_arguments_required' USING ERRCODE = '22004';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.account_deletion_request_items AS item
    WHERE item.request_id = p_request_id
      AND item.mandatory
      AND (
        (item.disposition IN ('delete', 'anonymize') AND item.status IS DISTINCT FROM 'applied')
        OR (item.disposition = 'separate' AND item.status IS DISTINCT FROM 'separated')
        OR (item.disposition = 'retain' AND item.status IS DISTINCT FROM 'retained')
      )
  ) THEN
    RAISE EXCEPTION 'account_deletion_final_item_state_invalid' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.account_deletion_request_items AS item
    JOIN public.account_deletion_requests AS request_row ON request_row.id = item.request_id
    JOIN privacy_retention.account_deletion_source_manifest AS manifest
      ON manifest.policy_version = request_row.policy_version
     AND manifest.code = item.data_class_code
    JOIN privacy_retention.account_deletion_adapter_registry AS registry
      ON registry.adapter_name = manifest.adapter_name
    WHERE item.request_id = p_request_id
      AND item.mandatory
      AND item.disposition = 'delete'
      AND item.data_class_code NOT IN ('storage_objects', 'auth_identity')
      AND privacy_retention.g014_account_deletion_source_count(
        manifest.relation_name,
        manifest.subject_column,
        CASE WHEN registry.subject_type = 'text'::regtype
          THEN privacy_retention.g014_account_deletion_subject_hash(p_target_user_id)
          ELSE p_target_user_id::text
        END
      ) <> 0
  ) THEN
    RAISE EXCEPTION 'account_deletion_final_source_readback_failed' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.profiles AS profile_row
    WHERE profile_row.user_id = p_target_user_id
      AND (
        profile_row.nickname IS DISTINCT FROM '탈퇴한 사용자'
        OR profile_row.username IS NOT NULL
        OR profile_row.avatar_url IS NOT NULL
      )
  ) THEN
    RAISE EXCEPTION 'account_deletion_final_anonymization_readback_failed' USING ERRCODE = '55000';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.account_deletion_requests AS request_row
    WHERE request_row.id = p_request_id
      AND request_row.storage_receipts_hash ~ '^[0-9a-f]{64}$'
      AND (
        SELECT count(*)
        FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
        WHERE proof.request_id = request_row.id AND proof.phase = 'storage'
      ) = (
        SELECT count(*)
        FROM privacy_retention.account_deletion_storage_objects
        WHERE request_id = request_row.id
      )
  ) THEN
    RAISE EXCEPTION 'account_deletion_final_storage_receipt_readback_failed' USING ERRCODE = '55000';
  END IF;
END;
$function$;
ALTER FUNCTION privacy_retention.g014_account_deletion_assert_final_items(uuid,uuid)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_account_deletion_assert_final_items(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
-- Generic failure remains limited to pre-external work.  It cannot alter a
-- request while an exact durable external attempt still owns reconciliation.
CREATE OR REPLACE FUNCTION public.fail_account_deletion(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_reason_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_require_service_role();
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_request_id IS NULL
     OR p_preview_hash IS NULL OR p_idempotency_key IS NULL
     OR p_source_manifest_hash IS NULL OR p_reason_code IS NULL THEN
    RAISE EXCEPTION 'account_deletion_failure_arguments_required' USING ERRCODE = '22004';
  END IF;
  IF p_reason_code NOT IN ('DB_OR_SESSION_CLEANUP_FAILED', 'SESSION_READBACK_REQUIRED') THEN
    RAISE EXCEPTION 'account_deletion_failure_reason_invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM privacy_retention.g014_account_deletion_lock_target(p_target_user_id);
  SELECT * INTO v_request
  FROM public.account_deletion_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_request.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v_request.target_user_id IS DISTINCT FROM p_target_user_id
     OR v_request.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_request.idempotency_key IS DISTINCT FROM p_idempotency_key
     OR v_request.source_manifest_hash IS DISTINCT FROM p_source_manifest_hash THEN
    RAISE EXCEPTION 'account_deletion_failure_binding_mismatch' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_assert_actor_allowed(
    p_actor_user_id, p_target_user_id
  );
  PERFORM privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id);
  IF v_request.status NOT IN ('previewed', 'applying', 'partial') THEN
    RAISE EXCEPTION 'account_deletion_failure_predecessor_invalid' USING ERRCODE = '55000';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_external_phase_leases AS lease_row
    WHERE lease_row.request_id = v_request.id
      AND lease_row.target_user_id = p_target_user_id
      AND lease_row.status = 'active'
  ) OR EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_external_job_attempts AS attempt
    WHERE attempt.request_id = v_request.id
      AND attempt.state IN ('leased', 'egress_unknown', 'reconciliation_required')
  ) THEN
    RAISE EXCEPTION 'account_deletion_failure_external_lease_active' USING ERRCODE = '55000';
  END IF;

  UPDATE public.account_deletion_requests
  SET status = 'partial', reason_code = p_reason_code
  WHERE id = v_request.id
  RETURNING * INTO v_request;
  UPDATE privacy_retention.account_deletion_evidence_cleanup_leases
  SET status = 'released', released_at = pg_catalog.clock_timestamp()
  WHERE request_id = v_request.id
    AND target_user_id = p_target_user_id
    AND status = 'active';
  IF EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_evidence_cleanup_leases
    WHERE request_id = v_request.id
      AND target_user_id = p_target_user_id
      AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'account_deletion_failure_lease_reconciliation_failed' USING ERRCODE = '55000';
  END IF;
  PERFORM privacy_retention.g014_account_deletion_append_audit(
    v_request, 'partial', p_reason_code
  );
END;
$function$;
ALTER FUNCTION public.fail_account_deletion(uuid,uuid,uuid,text,text,text,text)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.fail_account_deletion(uuid,uuid,uuid,text,text,text,text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fail_account_deletion(uuid,uuid,uuid,text,text,text,text)
  TO service_role;
CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_external_job_binding_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.phase IS DISTINCT FROM OLD.phase
     OR NEW.actor_user_id IS DISTINCT FROM OLD.actor_user_id
     OR NEW.target_user_id IS DISTINCT FROM OLD.target_user_id
     OR NEW.preview_hash IS DISTINCT FROM OLD.preview_hash
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.source_manifest_hash IS DISTINCT FROM OLD.source_manifest_hash THEN
    RAISE EXCEPTION 'account_deletion_external_job_binding_immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_external_attempt_binding_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.attempt_token IS DISTINCT FROM OLD.attempt_token
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.phase IS DISTINCT FROM OLD.phase
     OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
     OR NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at THEN
    RAISE EXCEPTION 'account_deletion_external_attempt_binding_immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS g014_account_deletion_external_job_binding_guard
  ON privacy_retention.account_deletion_external_jobs;
CREATE TRIGGER g014_account_deletion_external_job_binding_guard
BEFORE UPDATE ON privacy_retention.account_deletion_external_jobs
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_account_deletion_external_job_binding_guard();

DROP TRIGGER IF EXISTS g014_account_deletion_external_attempt_binding_guard
  ON privacy_retention.account_deletion_external_job_attempts;
CREATE TRIGGER g014_account_deletion_external_attempt_binding_guard
BEFORE UPDATE ON privacy_retention.account_deletion_external_job_attempts
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_account_deletion_external_attempt_binding_guard();

DROP TRIGGER IF EXISTS g014_account_deletion_external_checkpoint_append_only
  ON privacy_retention.account_deletion_external_job_checkpoints;
CREATE TRIGGER g014_account_deletion_external_checkpoint_append_only
BEFORE UPDATE OR DELETE ON privacy_retention.account_deletion_external_job_checkpoints
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_account_deletion_append_only();

DROP TRIGGER IF EXISTS g014_account_deletion_external_proof_append_only
  ON privacy_retention.account_deletion_external_job_provider_proofs;
CREATE TRIGGER g014_account_deletion_external_proof_append_only
BEFORE UPDATE OR DELETE ON privacy_retention.account_deletion_external_job_provider_proofs
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_account_deletion_append_only();

ALTER FUNCTION privacy_retention.g014_account_deletion_external_job_binding_guard()
  OWNER TO privacy_workflow_owner;
ALTER FUNCTION privacy_retention.g014_account_deletion_external_attempt_binding_guard()
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION
  privacy_retention.g014_account_deletion_external_job_binding_guard(),
  privacy_retention.g014_account_deletion_external_attempt_binding_guard()
FROM PUBLIC, anon, authenticated, service_role;
-- G014-06 recovery hardening: a storage egress attempt is bound to one
-- immutable captured object.  A completed storage sub-attempt returns the
-- phase job to pending until every captured object has its own proof and the
-- authoritative source is empty.
ALTER TABLE privacy_retention.account_deletion_storage_objects
  ADD CONSTRAINT g014_account_deletion_storage_object_identity_binding
    CHECK (
      object_id IS NOT NULL
      AND object_version ~ '^[A-Za-z0-9._:-]{1,256}$'
    );

ALTER TABLE privacy_retention.account_deletion_external_job_attempts
  ADD COLUMN storage_object_locator_hash text,
  ADD COLUMN storage_object_version_hash text,
  ADD COLUMN storage_object_id uuid,
  ADD COLUMN storage_object_version text,
  ADD CONSTRAINT g014_account_deletion_attempt_storage_object_binding
    CHECK (
      (
        phase = 'storage'
        AND (
          (
            storage_object_locator_hash ~ '^[0-9a-f]{64}$'
            AND storage_object_version_hash ~ '^[0-9a-f]{64}$'
          )
          OR (
            storage_object_locator_hash IS NULL
            AND storage_object_version_hash IS NULL
          )
        )
      )
      OR (
        phase IN ('session', 'auth')
        AND storage_object_locator_hash IS NULL
        AND storage_object_version_hash IS NULL
      )
    ),
  ADD CONSTRAINT g014_account_deletion_attempt_storage_object_exact_binding
    CHECK (
      (
        phase = 'storage'
        AND (
          (
            storage_object_locator_hash IS NULL
            AND storage_object_version_hash IS NULL
            AND storage_object_id IS NULL
            AND storage_object_version IS NULL
          )
          OR (
            storage_object_locator_hash IS NOT NULL
            AND storage_object_version_hash IS NOT NULL
            AND storage_object_id IS NOT NULL
            AND storage_object_version ~ '^[A-Za-z0-9._:-]{1,256}$'
          )
        )
      )
      OR (
        phase IN ('session', 'auth')
        AND storage_object_id IS NULL
        AND storage_object_version IS NULL
      )
    ),
  ADD CONSTRAINT g014_account_deletion_attempt_storage_object_fk
    FOREIGN KEY (
      request_id, storage_object_locator_hash, storage_object_version_hash
    ) REFERENCES privacy_retention.account_deletion_storage_objects (
      request_id, object_locator_hash, object_version_hash
    ) ON DELETE RESTRICT,
  ADD CONSTRAINT g014_account_deletion_attempt_storage_object_exact_fk
    FOREIGN KEY (
      request_id, storage_object_locator_hash, storage_object_version_hash,
      storage_object_id, storage_object_version
    ) REFERENCES privacy_retention.account_deletion_storage_objects (
      request_id, object_locator_hash, object_version_hash, object_id, object_version
    ) ON DELETE RESTRICT;
ALTER TABLE privacy_retention.account_deletion_external_job_provider_proofs
  ADD COLUMN object_id uuid,
  ADD COLUMN object_version text,
  ADD CONSTRAINT g014_account_deletion_job_proof_exact_binding
    CHECK (
      (
        phase = 'storage'
        AND object_id IS NOT NULL
        AND object_version ~ '^[A-Za-z0-9._:-]{1,256}$'
      )
      OR (
        phase = 'auth'
        AND object_id IS NULL
        AND object_version IS NULL
      )
    ),
  ADD CONSTRAINT g014_account_deletion_job_proof_exact_fk
    FOREIGN KEY (
      request_id, object_locator_hash, object_version_hash, object_id, object_version
    ) REFERENCES privacy_retention.account_deletion_storage_objects (
      request_id, object_locator_hash, object_version_hash, object_id, object_version
    ) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_claim_storage_object(
  p_request_id uuid,
  p_target_user_id uuid
)
RETURNS privacy_retention.account_deletion_storage_objects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_object storage.objects%ROWTYPE;
  v_captured privacy_retention.account_deletion_storage_objects%ROWTYPE;
  v_version text;
  v_version_hash text;
BEGIN
  SELECT object_row.* INTO v_object
  FROM storage.objects AS object_row
  WHERE object_row.owner_id::text = p_target_user_id::text
    AND NOT EXISTS (
      SELECT 1
      FROM privacy_retention.account_deletion_storage_objects AS captured
      JOIN privacy_retention.account_deletion_external_job_provider_proofs AS proof
        ON proof.request_id = captured.request_id
       AND proof.phase = 'storage'
       AND proof.object_locator_hash = captured.object_locator_hash
       AND proof.object_version_hash = captured.object_version_hash
       AND proof.object_id = captured.object_id
       AND proof.object_version = captured.object_version
      WHERE captured.request_id = p_request_id
        AND captured.bucket_id = object_row.bucket_id::text
        AND captured.object_name = object_row.name::text
    )
  ORDER BY object_row.bucket_id, object_row.name
  LIMIT 1
  FOR UPDATE OF object_row;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_version := pg_catalog.to_jsonb(v_object) ->> 'version';
  IF v_object.id IS NULL
     OR v_version !~ '^[A-Za-z0-9._:-]{1,256}$' THEN
    RAISE EXCEPTION 'account_deletion_storage_exact_identity_missing'
      USING ERRCODE = '55000';
  END IF;
  v_version_hash := pg_catalog.encode(
    extensions.digest(v_version, 'sha256'),
    'hex'
  );

  INSERT INTO privacy_retention.account_deletion_storage_objects (
    request_id, bucket_id, object_name, object_locator_hash, object_version_hash,
    object_id, object_version
  ) VALUES (
    p_request_id,
    v_object.bucket_id::text,
    v_object.name::text,
    pg_catalog.encode(
      extensions.digest(v_object.bucket_id::text || E'\n' || v_object.name::text, 'sha256'),
      'hex'
    ),
    v_version_hash,
    v_object.id,
    v_version
  )
  ON CONFLICT (request_id, bucket_id, object_name) DO NOTHING;

  SELECT * INTO v_captured
  FROM privacy_retention.account_deletion_storage_objects
  WHERE request_id = p_request_id
    AND bucket_id = v_object.bucket_id::text
    AND object_name = v_object.name::text
  FOR SHARE;

  IF NOT FOUND
     OR v_captured.object_id IS DISTINCT FROM v_object.id
     OR v_captured.object_version IS DISTINCT FROM v_version
     OR v_captured.object_version_hash IS DISTINCT FROM v_version_hash THEN
    RAISE EXCEPTION 'account_deletion_storage_manifest_version_mismatch'
      USING ERRCODE = '55000';
  END IF;

  RETURN v_captured;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_complete_external_job_phase(
  p_request_id uuid,
  p_phase text,
  p_attempt_token uuid
)
RETURNS public.account_deletion_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_attempt privacy_retention.account_deletion_external_job_attempts%ROWTYPE;
  v_storage_receipts_hash text;
  v_auth_receipt_ref text;
  v_object_absent boolean;
  v_object_proved boolean;
  v_storage_absent boolean;
  v_missing_proof_count integer;
  v_storage_phase_complete boolean := false;
BEGIN
  SELECT * INTO v_request
  FROM public.account_deletion_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_external_job_request_missing' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_attempt
  FROM privacy_retention.account_deletion_external_job_attempts
  WHERE attempt_token = p_attempt_token
    AND request_id = p_request_id
    AND phase = p_phase
  FOR UPDATE;
  IF NOT FOUND
     OR v_attempt.state NOT IN ('leased', 'egress_unknown', 'reconciliation_required') THEN
    RAISE EXCEPTION 'account_deletion_external_job_attempt_completion_invalid'
      USING ERRCODE = '55000';
  END IF;

  PERFORM privacy_retention.g014_account_deletion_assert_no_hold(v_request.target_user_id);

  IF p_phase = 'session' THEN
    UPDATE public.account_deletion_requests
    SET status = 'applying',
        reason_code = 'DB_AND_SESSION_READBACK_PASSED',
        session_readback_passed = true
    WHERE id = v_request.id
    RETURNING * INTO v_request;
    UPDATE privacy_retention.account_deletion_external_job_attempts
    SET state = 'completed', completed_at = pg_catalog.clock_timestamp()
    WHERE attempt_token = p_attempt_token
      AND state IN ('leased', 'egress_unknown', 'reconciliation_required');

    UPDATE privacy_retention.account_deletion_external_jobs
    SET state = 'completed',
        current_attempt_token = p_attempt_token,
        completed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    WHERE request_id = v_request.id AND phase = p_phase;
  ELSIF p_phase = 'storage' THEN
    IF v_attempt.storage_object_locator_hash IS NOT NULL THEN
      SELECT NOT EXISTS (
        SELECT 1
        FROM storage.objects AS object_row
        WHERE object_row.owner_id::text = v_request.target_user_id::text
          AND object_row.bucket_id::text = (
            SELECT captured.bucket_id
            FROM privacy_retention.account_deletion_storage_objects AS captured
            WHERE captured.request_id = p_request_id
              AND captured.object_locator_hash = v_attempt.storage_object_locator_hash
              AND captured.object_version_hash = v_attempt.storage_object_version_hash
              AND captured.object_id = v_attempt.storage_object_id
              AND captured.object_version = v_attempt.storage_object_version
          )
          AND object_row.name::text = (
            SELECT captured.object_name
            FROM privacy_retention.account_deletion_storage_objects AS captured
            WHERE captured.request_id = p_request_id
              AND captured.object_locator_hash = v_attempt.storage_object_locator_hash
              AND captured.object_version_hash = v_attempt.storage_object_version_hash
              AND captured.object_id = v_attempt.storage_object_id
              AND captured.object_version = v_attempt.storage_object_version
          )
          AND object_row.id = v_attempt.storage_object_id
          AND pg_catalog.to_jsonb(object_row) ->> 'version'
              = v_attempt.storage_object_version
      ) INTO v_object_absent;

      SELECT EXISTS (
        SELECT 1
        FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
        WHERE proof.request_id = p_request_id
          AND proof.phase = 'storage'
          AND proof.attempt_token = p_attempt_token
          AND proof.object_locator_hash = v_attempt.storage_object_locator_hash
          AND proof.object_version_hash = v_attempt.storage_object_version_hash
          AND proof.object_id = v_attempt.storage_object_id
          AND proof.object_version = v_attempt.storage_object_version
      ) INTO v_object_proved;

      IF NOT v_object_absent OR NOT v_object_proved THEN
        RAISE EXCEPTION 'account_deletion_storage_subattempt_not_reconciled'
          USING ERRCODE = '55000';
      END IF;
    END IF;

    SELECT NOT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE owner_id::text = v_request.target_user_id::text
    ) INTO v_storage_absent;
    SELECT count(*) INTO v_missing_proof_count
    FROM privacy_retention.account_deletion_storage_objects AS captured
    WHERE captured.request_id = p_request_id
      AND NOT EXISTS (
        SELECT 1
        FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
        WHERE proof.request_id = p_request_id
          AND proof.phase = 'storage'
          AND proof.object_locator_hash = captured.object_locator_hash
          AND proof.object_version_hash = captured.object_version_hash
          AND proof.object_id = captured.object_id
          AND proof.object_version = captured.object_version
      );

    IF NOT v_storage_absent OR v_missing_proof_count <> 0 THEN
      UPDATE privacy_retention.account_deletion_external_job_attempts
      SET state = 'completed', completed_at = pg_catalog.clock_timestamp()
      WHERE attempt_token = p_attempt_token
        AND state IN ('leased', 'egress_unknown', 'reconciliation_required');

      UPDATE privacy_retention.account_deletion_external_jobs
      SET state = 'pending',
          current_attempt_token = NULL,
          updated_at = pg_catalog.clock_timestamp()
      WHERE request_id = p_request_id
        AND phase = 'storage'
        AND current_attempt_token = p_attempt_token;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_deletion_storage_subattempt_completion_failed'
          USING ERRCODE = '55000';
      END IF;
    ELSE
      SELECT pg_catalog.encode(
        extensions.digest(
          COALESCE((
            SELECT pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'objectLocatorHash', proof.object_locator_hash,
                'objectVersionHash', proof.object_version_hash,
                'objectId', proof.object_id,
                'objectVersion', proof.object_version,
                'providerReceiptRef', proof.provider_receipt_ref,
                'providerReceiptHash', proof.provider_receipt_hash
              )
              ORDER BY proof.object_locator_hash, proof.object_version_hash
            )::text
            FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
            WHERE proof.request_id = v_request.id AND proof.phase = 'storage'
          ), '[]'),
          'sha256'
        ),
        'hex'
      ) INTO v_storage_receipts_hash;

      UPDATE public.account_deletion_request_items
      SET status = 'applied', reason_code = 'STORAGE_READBACK_PASSED'
      WHERE request_id = v_request.id AND data_class_code = 'storage_objects';

      UPDATE public.account_deletion_requests
      SET status = 'applying',
          reason_code = 'STORAGE_READBACK_PASSED',
          storage_readback_passed = true,
          storage_receipts_hash = v_storage_receipts_hash
      WHERE id = v_request.id
      RETURNING * INTO v_request;

      UPDATE privacy_retention.account_deletion_external_job_attempts
      SET state = 'completed', completed_at = pg_catalog.clock_timestamp()
      WHERE attempt_token = p_attempt_token
        AND state IN ('leased', 'egress_unknown', 'reconciliation_required');

      UPDATE privacy_retention.account_deletion_external_jobs
      SET state = 'completed',
          current_attempt_token = p_attempt_token,
          completed_at = pg_catalog.clock_timestamp(),
          updated_at = pg_catalog.clock_timestamp()
      WHERE request_id = v_request.id AND phase = p_phase;

      v_storage_phase_complete := true;
    END IF;
  ELSIF p_phase = 'auth' THEN
    SELECT NOT EXISTS (
      SELECT 1
      FROM storage.objects
      WHERE owner_id::text = v_request.target_user_id::text
    ) INTO v_storage_absent;
    IF NOT v_storage_absent THEN
      RAISE EXCEPTION 'account_deletion_auth_storage_authoritative_absence_failed'
        USING ERRCODE = '55000';
    END IF;
    UPDATE public.account_deletion_request_items
    SET status = 'applied', reason_code = 'AUTH_READBACK_PASSED'
    WHERE request_id = v_request.id AND data_class_code = 'auth_identity';

    PERFORM privacy_retention.g014_account_deletion_assert_final_items(
      v_request.id, v_request.target_user_id
    );

    v_auth_receipt_ref := 'auth:' || pg_catalog.encode(
      extensions.digest(
        pg_catalog.concat_ws(
          E'\n',
          v_request.id::text,
          v_request.target_user_id::text,
          v_request.source_manifest_hash,
          p_attempt_token::text,
          'authoritative_absent'
        ),
        'sha256'
      ),
      'hex'
    );
    UPDATE public.account_deletion_requests
    SET status = 'applied',
        reason_code = 'APPLIED',
        auth_readback_passed = true,
        auth_receipt_ref = v_auth_receipt_ref,
        applied_at = pg_catalog.clock_timestamp()
    WHERE id = v_request.id
    RETURNING * INTO v_request;

    UPDATE privacy_retention.account_deletion_admin_reservations
    SET status = 'completed', reconciled_at = pg_catalog.clock_timestamp()
    WHERE request_id = v_request.id AND status = 'active';

    UPDATE privacy_retention.account_deletion_external_job_attempts
    SET state = 'completed', completed_at = pg_catalog.clock_timestamp()
    WHERE attempt_token = p_attempt_token
      AND state IN ('leased', 'egress_unknown', 'reconciliation_required');

    UPDATE privacy_retention.account_deletion_external_jobs
    SET state = 'completed',
        current_attempt_token = p_attempt_token,
        completed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    WHERE request_id = v_request.id AND phase = p_phase;
  ELSE
    RAISE EXCEPTION 'account_deletion_external_job_phase_invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO privacy_retention.account_deletion_external_job_checkpoints (
    request_id, phase, attempt_token, checkpoint_kind, checkpoint_state, proof_hash
  ) VALUES (
    v_request.id, p_phase, p_attempt_token, 'authoritative_absent', 'confirmed',
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.concat_ws(
          ':',
          'g014-authoritative-absent:v3',
          v_request.id::text,
          p_phase,
          p_attempt_token::text,
          COALESCE(v_attempt.storage_object_locator_hash, '<none>'),
          COALESCE(v_attempt.storage_object_version_hash, '<none>'),
          COALESCE(v_attempt.storage_object_id::text, '<none>'),
          COALESCE(v_attempt.storage_object_version, '<none>')
        ),
        'sha256'
      ),
      'hex'
    )
  )
  ON CONFLICT (request_id, phase, attempt_token, checkpoint_kind) DO NOTHING;

  IF p_phase <> 'storage' OR v_storage_phase_complete THEN
    PERFORM privacy_retention.g014_account_deletion_append_audit(
      v_request,
      CASE WHEN p_phase = 'auth' THEN 'applied' ELSE 'readback_passed' END,
      v_request.reason_code
    );
  END IF;
  RETURN v_request;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_reconcile_expired_attempt(
  p_request_id uuid,
  p_phase text,
  p_attempt_token uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_job privacy_retention.account_deletion_external_jobs%ROWTYPE;
  v_attempt privacy_retention.account_deletion_external_job_attempts%ROWTYPE;
  v_absent boolean;
  v_object_proved boolean;
  v_has_egress_unknown_checkpoint boolean;
  v_job_state text;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  SELECT * INTO v_job
  FROM privacy_retention.account_deletion_external_jobs
  WHERE request_id = p_request_id AND phase = p_phase
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_external_job_missing' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_attempt
  FROM privacy_retention.account_deletion_external_job_attempts
  WHERE attempt_token = p_attempt_token
    AND request_id = p_request_id
    AND phase = p_phase
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_external_job_attempt_missing' USING ERRCODE = '55000';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_external_job_checkpoints AS checkpoint
    WHERE checkpoint.request_id = p_request_id
      AND checkpoint.phase = p_phase
      AND checkpoint.attempt_token = p_attempt_token
      AND checkpoint.checkpoint_kind = 'egress_unknown'
      AND checkpoint.checkpoint_state = 'unknown'
  ) INTO v_has_egress_unknown_checkpoint;

  IF v_attempt.state = 'leased' AND NOT v_has_egress_unknown_checkpoint THEN
    IF v_attempt.lease_expires_at > v_now THEN
      RAISE EXCEPTION 'account_deletion_external_job_attempt_not_expired'
        USING ERRCODE = '55000';
    END IF;

    UPDATE privacy_retention.account_deletion_external_job_attempts
    SET state = 'released', reconciled_at = v_now
    WHERE attempt_token = p_attempt_token
      AND state = 'leased';

    UPDATE privacy_retention.account_deletion_external_jobs
    SET state = 'pending',
        current_attempt_token = NULL,
        updated_at = v_now
    WHERE request_id = p_request_id
      AND phase = p_phase
      AND state = 'leased'
      AND current_attempt_token = p_attempt_token;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'account_deletion_external_job_release_failed'
        USING ERRCODE = '55000';
    END IF;
    RETURN 'released';
  END IF;

  IF v_attempt.state = 'egress_unknown' AND NOT v_has_egress_unknown_checkpoint THEN
    RAISE EXCEPTION 'account_deletion_external_job_egress_checkpoint_missing'
      USING ERRCODE = '55000';
  END IF;

  IF p_phase = 'storage' THEN
    IF v_attempt.storage_object_locator_hash IS NULL THEN
      SELECT NOT EXISTS (
        SELECT 1 FROM storage.objects
        WHERE owner_id::text = v_job.target_user_id::text
      ) INTO v_absent;
      SELECT NOT EXISTS (
        SELECT 1
        FROM privacy_retention.account_deletion_storage_objects AS captured
        WHERE captured.request_id = p_request_id
          AND NOT EXISTS (
            SELECT 1
            FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
            WHERE proof.request_id = p_request_id
              AND proof.phase = 'storage'
              AND proof.object_locator_hash = captured.object_locator_hash
              AND proof.object_version_hash = captured.object_version_hash
              AND proof.object_id = captured.object_id
              AND proof.object_version = captured.object_version
          )
      ) INTO v_object_proved;
    ELSE
      SELECT NOT EXISTS (
        SELECT 1
        FROM storage.objects AS object_row
        JOIN privacy_retention.account_deletion_storage_objects AS captured
          ON captured.request_id = p_request_id
         AND captured.object_locator_hash = v_attempt.storage_object_locator_hash
         AND captured.object_version_hash = v_attempt.storage_object_version_hash
         AND captured.object_id = v_attempt.storage_object_id
         AND captured.object_version = v_attempt.storage_object_version
         AND captured.bucket_id = object_row.bucket_id::text
         AND captured.object_name = object_row.name::text
        WHERE object_row.owner_id::text = v_job.target_user_id::text
          AND object_row.id = v_attempt.storage_object_id
          AND pg_catalog.to_jsonb(object_row) ->> 'version'
              = v_attempt.storage_object_version
      ) INTO v_absent;
      SELECT EXISTS (
        SELECT 1
        FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
        WHERE proof.request_id = p_request_id
          AND proof.phase = 'storage'
          AND proof.attempt_token = p_attempt_token
          AND proof.object_locator_hash = v_attempt.storage_object_locator_hash
          AND proof.object_version_hash = v_attempt.storage_object_version_hash
          AND proof.object_id = v_attempt.storage_object_id
          AND proof.object_version = v_attempt.storage_object_version
      ) INTO v_object_proved;
    END IF;

    IF v_absent AND v_object_proved THEN
      PERFORM privacy_retention.g014_account_deletion_complete_external_job_phase(
        p_request_id, p_phase, p_attempt_token
      );
      SELECT state INTO v_job_state
      FROM privacy_retention.account_deletion_external_jobs
      WHERE request_id = p_request_id AND phase = p_phase;
      RETURN CASE WHEN v_job_state = 'completed' THEN 'completed' ELSE 'released' END;
    END IF;
  ELSIF p_phase = 'session' THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM auth.sessions WHERE user_id = v_job.target_user_id
      UNION ALL
      SELECT 1 FROM auth.refresh_tokens WHERE user_id = v_job.target_user_id
    ) INTO v_absent;
    IF v_absent THEN
      PERFORM privacy_retention.g014_account_deletion_complete_external_job_phase(
        p_request_id, p_phase, p_attempt_token
      );
      RETURN 'completed';
    END IF;
  ELSIF p_phase = 'auth' THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM auth.users WHERE id = v_job.target_user_id
      UNION ALL
      SELECT 1 FROM auth.sessions WHERE user_id = v_job.target_user_id
      UNION ALL
      SELECT 1 FROM auth.identities WHERE user_id = v_job.target_user_id
      UNION ALL
      SELECT 1 FROM auth.refresh_tokens WHERE user_id = v_job.target_user_id
    ) INTO v_absent;
    IF v_absent THEN
      PERFORM privacy_retention.g014_account_deletion_complete_external_job_phase(
        p_request_id, p_phase, p_attempt_token
      );
      RETURN 'completed';
    END IF;
  ELSE
    RAISE EXCEPTION 'account_deletion_external_job_phase_invalid' USING ERRCODE = '22023';
  END IF;

  UPDATE privacy_retention.account_deletion_external_job_attempts
  SET state = 'reconciliation_required', reconciled_at = v_now
  WHERE attempt_token = p_attempt_token
    AND state IN ('leased', 'egress_unknown');
  UPDATE privacy_retention.account_deletion_external_jobs
  SET state = 'reconciliation_required',
      current_attempt_token = p_attempt_token,
      updated_at = v_now
  WHERE request_id = p_request_id AND phase = p_phase;
  RETURN 'reconciliation_required';
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_account_deletion_external_job(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_phase text,
  p_attempt_token uuid
)
RETURNS TABLE (
  request_id uuid,
  phase text,
  claim_status text,
  attempt_token uuid,
  lease_expires_at timestamptz,
  job_state text,
  checkpoint_state text,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_job privacy_retention.account_deletion_external_jobs%ROWTYPE;
  v_attempt privacy_retention.account_deletion_external_job_attempts%ROWTYPE;
  v_storage_object privacy_retention.account_deletion_storage_objects%ROWTYPE;
  v_storage_absent boolean;
  v_missing_proof_count integer;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_reconcile_status text;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_require_service_role();
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_request_id IS NULL
     OR p_preview_hash IS NULL OR p_idempotency_key IS NULL
     OR p_source_manifest_hash IS NULL OR p_phase NOT IN ('session', 'storage', 'auth') THEN
    RAISE EXCEPTION 'account_deletion_external_job_claim_arguments_invalid'
      USING ERRCODE = '22004';
  END IF;

  PERFORM privacy_retention.g014_account_deletion_lock_target(p_target_user_id);
  SELECT * INTO v_request
  FROM public.account_deletion_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_request.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v_request.target_user_id IS DISTINCT FROM p_target_user_id
     OR v_request.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_request.idempotency_key IS DISTINCT FROM p_idempotency_key
     OR v_request.source_manifest_hash IS DISTINCT FROM p_source_manifest_hash THEN
    RAISE EXCEPTION 'account_deletion_external_job_claim_binding_mismatch'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_job
  FROM privacy_retention.account_deletion_external_jobs
  WHERE request_id = p_request_id AND phase = p_phase
  FOR UPDATE;
  IF FOUND THEN
    IF v_job.actor_user_id IS DISTINCT FROM p_actor_user_id
       OR v_job.target_user_id IS DISTINCT FROM p_target_user_id
       OR v_job.preview_hash IS DISTINCT FROM p_preview_hash
       OR v_job.idempotency_key IS DISTINCT FROM p_idempotency_key
       OR v_job.source_manifest_hash IS DISTINCT FROM p_source_manifest_hash THEN
      RAISE EXCEPTION 'account_deletion_external_job_claim_binding_mismatch'
        USING ERRCODE = '55000';
    END IF;

    IF v_job.state = 'completed' THEN
      SELECT * INTO v_attempt
      FROM privacy_retention.account_deletion_external_job_attempts
      WHERE attempt_token = v_job.current_attempt_token
        AND request_id = p_request_id
        AND phase = p_phase
        AND state = 'completed'
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_deletion_external_job_completed_receipt_invalid'
          USING ERRCODE = '55000';
      END IF;
      IF p_attempt_token IS NOT NULL
         AND p_attempt_token IS DISTINCT FROM v_attempt.attempt_token THEN
        RAISE EXCEPTION 'account_deletion_external_job_completed_receipt_binding_mismatch'
          USING ERRCODE = '55000';
      END IF;
      RETURN QUERY SELECT p_request_id, p_phase, 'completed', v_attempt.attempt_token,
        NULL::timestamptz, 'completed', 'authoritative_absent', p_source_manifest_hash;
      RETURN;
    END IF;
  END IF;

  PERFORM privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id);
  PERFORM privacy_retention.g014_account_deletion_assert_external_job_predecessor(v_request, p_phase);

  IF v_job.request_id IS NULL THEN
    INSERT INTO privacy_retention.account_deletion_external_jobs (
      request_id, phase, actor_user_id, target_user_id, preview_hash,
      idempotency_key, source_manifest_hash
    ) VALUES (
      p_request_id, p_phase, p_actor_user_id, p_target_user_id, p_preview_hash,
      p_idempotency_key, p_source_manifest_hash
    );
    SELECT * INTO v_job
    FROM privacy_retention.account_deletion_external_jobs
    WHERE request_id = p_request_id AND phase = p_phase
    FOR UPDATE;
  END IF;

  SELECT * INTO v_attempt
  FROM privacy_retention.account_deletion_external_job_attempts
  WHERE request_id = p_request_id
    AND phase = p_phase
    AND state IN ('leased', 'egress_unknown', 'reconciliation_required')
  ORDER BY claimed_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND
     AND p_attempt_token IS NOT NULL
     AND p_attempt_token IS DISTINCT FROM v_attempt.attempt_token THEN
    RETURN QUERY SELECT p_request_id, p_phase, 'busy', NULL::uuid, NULL::timestamptz,
      v_job.state, v_attempt.state, p_source_manifest_hash;
    RETURN;
  END IF;

  IF FOUND AND v_attempt.state = 'egress_unknown' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM privacy_retention.account_deletion_external_job_checkpoints AS checkpoint
      WHERE checkpoint.request_id = p_request_id
        AND checkpoint.phase = p_phase
        AND checkpoint.attempt_token = v_attempt.attempt_token
        AND checkpoint.checkpoint_kind = 'egress_unknown'
        AND checkpoint.checkpoint_state = 'unknown'
    ) THEN
      RAISE EXCEPTION 'account_deletion_external_job_egress_checkpoint_missing'
        USING ERRCODE = '55000';
    END IF;

    RETURN QUERY SELECT p_request_id, p_phase, 'replayed', v_attempt.attempt_token,
      NULL::timestamptz, 'egress_unknown', 'verify_absence_only', p_source_manifest_hash;
    RETURN;
  END IF;

  IF FOUND AND v_attempt.state = 'reconciliation_required' THEN
    RETURN QUERY SELECT p_request_id, p_phase, 'replayed', v_attempt.attempt_token,
      NULL::timestamptz, v_job.state, 'verify_absence_only', p_source_manifest_hash;
    RETURN;
  END IF;

  IF FOUND AND v_attempt.state = 'leased' AND v_attempt.lease_expires_at > v_now THEN
    IF p_attempt_token IS NOT NULL AND p_attempt_token = v_attempt.attempt_token THEN
      RETURN QUERY SELECT p_request_id, p_phase, 'replayed', v_attempt.attempt_token,
        v_attempt.lease_expires_at, v_job.state, 'delete_then_verify', p_source_manifest_hash;
    ELSE
      RETURN QUERY SELECT p_request_id, p_phase, 'busy', NULL::uuid, NULL::timestamptz,
        v_job.state, v_attempt.state, p_source_manifest_hash;
    END IF;
    RETURN;
  END IF;

  IF FOUND THEN
    v_reconcile_status := privacy_retention.g014_account_deletion_reconcile_expired_attempt(
      p_request_id, p_phase, v_attempt.attempt_token
    );
    SELECT * INTO v_job
    FROM privacy_retention.account_deletion_external_jobs
    WHERE request_id = p_request_id AND phase = p_phase
    FOR UPDATE;
    IF v_reconcile_status = 'completed' THEN
      RETURN QUERY SELECT p_request_id, p_phase, 'completed', v_job.current_attempt_token,
        NULL::timestamptz, 'completed', 'authoritative_absent', p_source_manifest_hash;
      RETURN;
    ELSIF v_reconcile_status = 'reconciliation_required' THEN
      RETURN QUERY SELECT p_request_id, p_phase, 'replayed', v_attempt.attempt_token,
        NULL::timestamptz, v_job.state, 'verify_absence_only', p_source_manifest_hash;
      RETURN;
    ELSIF v_reconcile_status <> 'released' THEN
      RAISE EXCEPTION 'account_deletion_external_job_reconciliation_result_invalid'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF v_job.state IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'account_deletion_external_job_attempt_state_invalid'
      USING ERRCODE = '55000';
  END IF;

  IF p_phase = 'storage' THEN
    v_storage_object := privacy_retention.g014_account_deletion_claim_storage_object(
      p_request_id, p_target_user_id
    );
    IF v_storage_object.request_id IS NULL THEN
      SELECT NOT EXISTS (
        SELECT 1 FROM storage.objects
        WHERE owner_id::text = p_target_user_id::text
      ) INTO v_storage_absent;
      SELECT count(*) INTO v_missing_proof_count
      FROM privacy_retention.account_deletion_storage_objects AS captured
      WHERE captured.request_id = p_request_id
        AND NOT EXISTS (
          SELECT 1
          FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
          WHERE proof.request_id = p_request_id
            AND proof.phase = 'storage'
            AND proof.object_locator_hash = captured.object_locator_hash
            AND proof.object_version_hash = captured.object_version_hash
            AND proof.object_id = captured.object_id
            AND proof.object_version = captured.object_version
        );
      IF NOT v_storage_absent OR v_missing_proof_count <> 0 THEN
        RAISE EXCEPTION 'account_deletion_storage_manifest_reconciliation_required'
          USING ERRCODE = '55000';
      END IF;
    END IF;
  END IF;

  INSERT INTO privacy_retention.account_deletion_external_job_attempts (
    request_id, phase, state, claimed_at, lease_expires_at,
    storage_object_locator_hash, storage_object_version_hash,
    storage_object_id, storage_object_version
  ) VALUES (
    p_request_id, p_phase, 'leased', v_now, v_now + interval '5 minutes',
    v_storage_object.object_locator_hash, v_storage_object.object_version_hash,
    v_storage_object.object_id, v_storage_object.object_version
  )
  RETURNING * INTO v_attempt;

  UPDATE privacy_retention.account_deletion_external_jobs
  SET state = 'leased',
      current_attempt_token = v_attempt.attempt_token,
      updated_at = v_now
  WHERE request_id = p_request_id AND phase = p_phase;

  RETURN QUERY SELECT p_request_id, p_phase, 'claimed', v_attempt.attempt_token,
    v_attempt.lease_expires_at, 'leased', 'delete_then_verify', p_source_manifest_hash;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_account_deletion_external_egress(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_phase text,
  p_attempt_token uuid
)
RETURNS TABLE (
  request_id uuid,
  phase text,
  attempt_token uuid,
  egress_state text,
  provider_idempotency_key text,
  lease_expires_at timestamptz,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt privacy_retention.account_deletion_external_job_attempts%ROWTYPE;
  v_key text;
  v_absent boolean;
  v_missing_proof_count integer;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_assert_external_job_binding(
    p_actor_user_id, p_target_user_id, p_request_id, p_preview_hash,
    p_idempotency_key, p_source_manifest_hash, p_phase, p_attempt_token, true
  );
  SELECT * INTO v_attempt
  FROM privacy_retention.account_deletion_external_job_attempts
  WHERE attempt_token = p_attempt_token
  FOR UPDATE;
  IF v_attempt.state IS DISTINCT FROM 'leased' THEN
    RAISE EXCEPTION 'account_deletion_external_egress_already_prepared'
      USING ERRCODE = '55000';
  END IF;

  IF p_phase = 'auth' THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM auth.users WHERE id = p_target_user_id
      UNION ALL SELECT 1 FROM auth.sessions WHERE user_id = p_target_user_id
      UNION ALL SELECT 1 FROM auth.identities WHERE user_id = p_target_user_id
      UNION ALL SELECT 1 FROM auth.refresh_tokens WHERE user_id = p_target_user_id
    ) INTO v_absent;
    IF v_absent THEN
      PERFORM privacy_retention.g014_account_deletion_complete_external_job_phase(
        p_request_id, 'auth', p_attempt_token
      );
      RETURN QUERY SELECT p_request_id, p_phase, p_attempt_token, 'authoritative_absent',
        NULL::text, v_attempt.lease_expires_at, p_source_manifest_hash;
      RETURN;
    END IF;
  ELSIF p_phase = 'storage' AND v_attempt.storage_object_locator_hash IS NULL THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM storage.objects WHERE owner_id::text = p_target_user_id::text
    ) INTO v_absent;
    SELECT count(*) INTO v_missing_proof_count
    FROM privacy_retention.account_deletion_storage_objects AS captured
    WHERE captured.request_id = p_request_id
      AND NOT EXISTS (
        SELECT 1
        FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
        WHERE proof.request_id = p_request_id
          AND proof.phase = 'storage'
          AND proof.object_locator_hash = captured.object_locator_hash
          AND proof.object_version_hash = captured.object_version_hash
          AND proof.object_id = captured.object_id
          AND proof.object_version = captured.object_version
      );
    IF v_absent AND v_missing_proof_count = 0 THEN
      PERFORM privacy_retention.g014_account_deletion_complete_external_job_phase(
        p_request_id, 'storage', p_attempt_token
      );
      RETURN QUERY SELECT p_request_id, p_phase, p_attempt_token, 'authoritative_absent',
        NULL::text, v_attempt.lease_expires_at, p_source_manifest_hash;
      RETURN;
    END IF;
    RAISE EXCEPTION 'account_deletion_storage_reconciliation_required'
      USING ERRCODE = '55000';
  ELSIF p_phase = 'storage' AND NOT EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_storage_objects AS captured
    JOIN storage.objects AS object_row
      ON object_row.bucket_id::text = captured.bucket_id
     AND object_row.name::text = captured.object_name
    WHERE captured.request_id = p_request_id
      AND captured.object_locator_hash = v_attempt.storage_object_locator_hash
      AND captured.object_version_hash = v_attempt.storage_object_version_hash
      AND captured.object_id = v_attempt.storage_object_id
      AND captured.object_version = v_attempt.storage_object_version
      AND object_row.owner_id::text = p_target_user_id::text
      AND object_row.id = v_attempt.storage_object_id
      AND pg_catalog.to_jsonb(object_row) ->> 'version'
          = v_attempt.storage_object_version
  ) THEN
    RAISE EXCEPTION 'account_deletion_storage_attempt_exact_binding_stale'
      USING ERRCODE = '55000';
  END IF;

  v_key := CASE p_phase
    WHEN 'storage' THEN
      'g014-storage-' || pg_catalog.substr(p_request_id::text, 1, 8)
      || '-' || p_attempt_token::text
      || '-' || pg_catalog.substr(v_attempt.storage_object_locator_hash, 1, 40)
    WHEN 'auth' THEN 'g014-auth-' || pg_catalog.substr(p_request_id::text, 1, 8) || '-' || p_attempt_token::text
    ELSE 'g014-session-' || pg_catalog.substr(p_request_id::text, 1, 8) || '-' || p_attempt_token::text
  END;

  UPDATE privacy_retention.account_deletion_external_job_attempts
  SET state = 'egress_unknown', unknown_outcome_at = pg_catalog.clock_timestamp()
  WHERE attempt_token = p_attempt_token;
  UPDATE privacy_retention.account_deletion_external_jobs
  SET state = 'egress_unknown', updated_at = pg_catalog.clock_timestamp()
  WHERE request_id = p_request_id AND phase = p_phase;
  INSERT INTO privacy_retention.account_deletion_external_job_checkpoints (
    request_id, phase, attempt_token, checkpoint_kind, checkpoint_state, proof_hash
  ) VALUES (
    p_request_id, p_phase, p_attempt_token, 'egress_unknown', 'unknown',
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.concat_ws(
          ':',
          'g014-egress-unknown:v3',
          p_request_id::text,
          p_phase,
          p_attempt_token::text,
          COALESCE(v_attempt.storage_object_locator_hash, '<none>'),
          COALESCE(v_attempt.storage_object_version_hash, '<none>'),
          COALESCE(v_attempt.storage_object_id::text, '<none>'),
          COALESCE(v_attempt.storage_object_version, '<none>')
        ),
        'sha256'
      ),
      'hex'
    )
  );

  RETURN QUERY SELECT p_request_id, p_phase, p_attempt_token, 'egress_unknown',
    v_key, v_attempt.lease_expires_at, p_source_manifest_hash;
END;
$function$;

DROP FUNCTION public.get_account_deletion_storage_work(uuid,uuid,uuid,text,text,text,uuid);
CREATE OR REPLACE FUNCTION public.get_account_deletion_storage_work(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_attempt_token uuid
)
RETURNS TABLE (
  bucket_id text,
  object_name text,
  object_id uuid,
  object_version text,
  object_locator_hash text,
  object_version_hash text,
  provider_idempotency_key text,
  work_state text,
  work_mode text,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt privacy_retention.account_deletion_external_job_attempts%ROWTYPE;
  v_mode text;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_assert_external_job_binding(
    p_actor_user_id, p_target_user_id, p_request_id, p_preview_hash,
    p_idempotency_key, p_source_manifest_hash, 'storage', p_attempt_token, false
  );
  SELECT * INTO v_attempt
  FROM privacy_retention.account_deletion_external_job_attempts
  WHERE attempt_token = p_attempt_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_storage_work_not_prepared' USING ERRCODE = '55000';
  END IF;

  IF v_attempt.state IN ('egress_unknown', 'reconciliation_required') THEN
    v_mode := 'verify_absence_only';
  ELSIF v_attempt.state = 'leased' THEN
    PERFORM privacy_retention.g014_account_deletion_assert_external_job_binding(
      p_actor_user_id, p_target_user_id, p_request_id, p_preview_hash,
      p_idempotency_key, p_source_manifest_hash, 'storage', p_attempt_token, true
    );
    v_mode := 'delete_then_verify';
  ELSE
    RAISE EXCEPTION 'account_deletion_storage_work_not_prepared' USING ERRCODE = '55000';
  END IF;

  IF v_attempt.storage_object_locator_hash IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    captured.bucket_id,
    captured.object_name,
    captured.object_id,
    captured.object_version,
    captured.object_locator_hash,
    captured.object_version_hash,
    'g014-storage-' || pg_catalog.substr(p_request_id::text, 1, 8)
      || '-' || p_attempt_token::text
      || '-' || pg_catalog.substr(captured.object_locator_hash, 1, 40),
    v_mode,
    v_mode,
    p_source_manifest_hash
  FROM privacy_retention.account_deletion_storage_objects AS captured
  WHERE captured.request_id = p_request_id
    AND captured.object_locator_hash = v_attempt.storage_object_locator_hash
    AND captured.object_version_hash = v_attempt.storage_object_version_hash
    AND captured.object_id = v_attempt.storage_object_id
    AND captured.object_version = v_attempt.storage_object_version
    AND (
      v_mode = 'verify_absence_only'
      OR EXISTS (
        SELECT 1
        FROM storage.objects AS object_row
        WHERE object_row.owner_id::text = p_target_user_id::text
          AND object_row.bucket_id::text = captured.bucket_id
          AND object_row.name::text = captured.object_name
          AND object_row.id = captured.object_id
          AND pg_catalog.to_jsonb(object_row) ->> 'version'
              = captured.object_version
      )
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.record_account_deletion_external_provider_proof(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_phase text,
  p_attempt_token uuid,
  p_provider_receipt_ref text,
  p_provider_receipt_hash text,
  p_object_locator_hash text,
  p_object_version_hash text
)
RETURNS TABLE (
  request_id uuid,
  phase text,
  attempt_token uuid,
  provider_receipt_ref text,
  proof_hash text,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt privacy_retention.account_deletion_external_job_attempts%ROWTYPE;
  v_proof_hash text;
BEGIN
  IF p_phase NOT IN ('storage', 'auth')
     OR p_provider_receipt_ref !~ '^[A-Za-z0-9._:-]{8,256}$'
     OR p_provider_receipt_hash !~ '^[0-9a-f]{64}$'
     OR (
       p_phase = 'storage'
       AND (p_object_locator_hash !~ '^[0-9a-f]{64}$' OR p_object_version_hash !~ '^[0-9a-f]{64}$')
     )
     OR (
       p_phase = 'auth'
       AND (p_object_locator_hash IS NOT NULL OR p_object_version_hash IS NOT NULL)
     ) THEN
    RAISE EXCEPTION 'account_deletion_external_provider_proof_arguments_invalid'
      USING ERRCODE = '22023';
  END IF;

  PERFORM privacy_retention.g014_account_deletion_assert_external_job_binding(
    p_actor_user_id, p_target_user_id, p_request_id, p_preview_hash,
    p_idempotency_key, p_source_manifest_hash, p_phase, p_attempt_token, false
  );
  SELECT * INTO v_attempt
  FROM privacy_retention.account_deletion_external_job_attempts
  WHERE attempt_token = p_attempt_token
    AND state IN ('egress_unknown', 'reconciliation_required')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_external_provider_proof_not_prepared'
      USING ERRCODE = '55000';
  END IF;

  IF p_phase = 'storage'
     AND (
       v_attempt.storage_object_locator_hash IS DISTINCT FROM p_object_locator_hash
       OR v_attempt.storage_object_version_hash IS DISTINCT FROM p_object_version_hash
       OR v_attempt.storage_object_id IS NULL
       OR v_attempt.storage_object_version IS NULL
     ) THEN
    RAISE EXCEPTION 'account_deletion_external_provider_proof_storage_binding_mismatch'
      USING ERRCODE = '55000';
  END IF;

  v_proof_hash := pg_catalog.encode(
    extensions.digest(
      pg_catalog.concat_ws(
        ':', 'g014-external-provider-proof-v3', p_request_id::text, p_phase,
        p_attempt_token::text, p_provider_receipt_ref, p_provider_receipt_hash,
        COALESCE(p_object_locator_hash, '<none>'), COALESCE(p_object_version_hash, '<none>'),
        COALESCE(v_attempt.storage_object_id::text, '<none>'),
        COALESCE(v_attempt.storage_object_version, '<none>')
      ),
      'sha256'
    ),
    'hex'
  );
  INSERT INTO privacy_retention.account_deletion_external_job_provider_proofs (
    request_id, phase, attempt_token, actor_user_id, target_user_id, preview_hash,
    idempotency_key, source_manifest_hash, provider_receipt_ref, provider_receipt_hash,
    object_locator_hash, object_version_hash, object_id, object_version, proof_hash
  ) VALUES (
    p_request_id, p_phase, p_attempt_token, p_actor_user_id, p_target_user_id, p_preview_hash,
    p_idempotency_key, p_source_manifest_hash, p_provider_receipt_ref, p_provider_receipt_hash,
    p_object_locator_hash, p_object_version_hash, v_attempt.storage_object_id,
    v_attempt.storage_object_version, v_proof_hash
  )
  ON CONFLICT (request_id, phase, provider_receipt_ref) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_external_job_provider_proofs
    WHERE request_id = p_request_id
      AND phase = p_phase
      AND attempt_token = p_attempt_token
      AND provider_receipt_ref = p_provider_receipt_ref
      AND proof_hash = v_proof_hash
  ) THEN
    RAISE EXCEPTION 'account_deletion_external_provider_proof_replay_mismatch'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO privacy_retention.account_deletion_external_job_checkpoints (
    request_id, phase, attempt_token, checkpoint_kind, checkpoint_state, proof_hash
  ) VALUES (
    p_request_id, p_phase, p_attempt_token, 'provider_proof_recorded', 'confirmed', v_proof_hash
  )
  ON CONFLICT (request_id, phase, attempt_token, checkpoint_kind) DO NOTHING;

  RETURN QUERY SELECT p_request_id, p_phase, p_attempt_token, p_provider_receipt_ref,
    v_proof_hash, p_source_manifest_hash;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_account_deletion_storage_job(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_attempt_token uuid
)
RETURNS TABLE (
  request_id uuid,
  status text,
  storage_readback_passed boolean,
  job_state text,
  expected_work_count integer,
  provider_proof_count integer,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_attempt privacy_retention.account_deletion_external_job_attempts%ROWTYPE;
  v_object_absent boolean;
  v_object_proved boolean;
  v_expected_count integer;
  v_proof_count integer;
  v_job_state text;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_assert_external_job_binding(
    p_actor_user_id, p_target_user_id, p_request_id, p_preview_hash,
    p_idempotency_key, p_source_manifest_hash, 'storage', p_attempt_token, false
  );
  SELECT * INTO v_attempt
  FROM privacy_retention.account_deletion_external_job_attempts
  WHERE attempt_token = p_attempt_token
  FOR UPDATE;
  IF NOT FOUND
     OR v_attempt.state NOT IN ('egress_unknown', 'reconciliation_required') THEN
    RAISE EXCEPTION 'account_deletion_storage_reconcile_not_prepared'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO v_expected_count
  FROM privacy_retention.account_deletion_storage_objects
  WHERE request_id = p_request_id;
  SELECT count(*) INTO v_proof_count
  FROM privacy_retention.account_deletion_external_job_provider_proofs
  WHERE request_id = p_request_id AND phase = 'storage';

  IF v_attempt.storage_object_locator_hash IS NULL THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE owner_id::text = p_target_user_id::text
    ) INTO v_object_absent;
    SELECT v_proof_count = v_expected_count INTO v_object_proved;
  ELSE
    SELECT NOT EXISTS (
      SELECT 1
      FROM storage.objects AS object_row
      JOIN privacy_retention.account_deletion_storage_objects AS captured
        ON captured.request_id = p_request_id
       AND captured.object_locator_hash = v_attempt.storage_object_locator_hash
       AND captured.object_version_hash = v_attempt.storage_object_version_hash
       AND captured.object_id = v_attempt.storage_object_id
       AND captured.object_version = v_attempt.storage_object_version
       AND captured.bucket_id = object_row.bucket_id::text
       AND captured.object_name = object_row.name::text
      WHERE object_row.owner_id::text = p_target_user_id::text
        AND object_row.id = v_attempt.storage_object_id
        AND pg_catalog.to_jsonb(object_row) ->> 'version'
            = v_attempt.storage_object_version
    ) INTO v_object_absent;
    SELECT EXISTS (
      SELECT 1
      FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
      WHERE proof.request_id = p_request_id
        AND proof.phase = 'storage'
        AND proof.attempt_token = p_attempt_token
        AND proof.object_locator_hash = v_attempt.storage_object_locator_hash
        AND proof.object_version_hash = v_attempt.storage_object_version_hash
        AND proof.object_id = v_attempt.storage_object_id
        AND proof.object_version = v_attempt.storage_object_version
    ) INTO v_object_proved;
  END IF;

  IF v_object_absent AND v_object_proved THEN
    v_request := privacy_retention.g014_account_deletion_complete_external_job_phase(
      p_request_id, 'storage', p_attempt_token
    );
    SELECT state INTO v_job_state
    FROM privacy_retention.account_deletion_external_jobs
    WHERE request_id = p_request_id AND phase = 'storage';
    RETURN QUERY SELECT v_request.id, v_request.status, v_request.storage_readback_passed,
      v_job_state, v_expected_count, v_proof_count, v_request.source_manifest_hash;
    RETURN;
  END IF;

  UPDATE privacy_retention.account_deletion_external_job_attempts
  SET state = 'reconciliation_required', reconciled_at = pg_catalog.clock_timestamp()
  WHERE attempt_token = p_attempt_token
    AND state IN ('egress_unknown', 'reconciliation_required');
  UPDATE privacy_retention.account_deletion_external_jobs
  SET state = 'reconciliation_required',
      current_attempt_token = p_attempt_token,
      updated_at = pg_catalog.clock_timestamp()
  WHERE request_id = p_request_id AND phase = 'storage';

  SELECT * INTO v_request
  FROM public.account_deletion_requests
  WHERE id = p_request_id;
  RETURN QUERY SELECT v_request.id, v_request.status, false,
    'reconciliation_required', v_expected_count, v_proof_count, v_request.source_manifest_hash;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_external_attempt_binding_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.attempt_token IS DISTINCT FROM OLD.attempt_token
     OR NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.phase IS DISTINCT FROM OLD.phase
     OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
     OR NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at
     OR NEW.storage_object_locator_hash IS DISTINCT FROM OLD.storage_object_locator_hash
     OR NEW.storage_object_version_hash IS DISTINCT FROM OLD.storage_object_version_hash
     OR NEW.storage_object_id IS DISTINCT FROM OLD.storage_object_id
     OR NEW.storage_object_version IS DISTINCT FROM OLD.storage_object_version THEN
    RAISE EXCEPTION 'account_deletion_external_attempt_binding_immutable'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;
CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_storage_write_fence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_new_owner_id text := NEW.owner_id::text;
  v_old_owner_id text;
  v_new_bucket_id text := NEW.bucket_id::text;
  v_new_object_name text := NEW.name::text;
  v_old_bucket_id text;
  v_old_object_name text;
  v_owner_id text;
  v_owner_uuid uuid;
  v_lifecycle_seen boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_owner_id := OLD.owner_id::text;
    v_old_bucket_id := OLD.bucket_id::text;
    v_old_object_name := OLD.name::text;
  END IF;

  FOR v_owner_id IN
    SELECT DISTINCT owner_row.owner_id
    FROM (VALUES (v_new_owner_id), (v_old_owner_id)) AS owner_row(owner_id)
    WHERE owner_row.owner_id IS NOT NULL
      AND owner_row.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ORDER BY owner_row.owner_id
  LOOP
    v_owner_uuid := v_owner_id::uuid;
    SELECT EXISTS (
      SELECT 1
      FROM public.account_deletion_requests AS request_row
      WHERE request_row.target_user_id = v_owner_uuid
        AND request_row.status IN ('previewed', 'applying', 'partial')
    ) INTO v_lifecycle_seen;

    PERFORM privacy_retention.g014_account_deletion_lock_target(v_owner_uuid);

    IF v_lifecycle_seen OR EXISTS (
      SELECT 1
      FROM public.account_deletion_requests AS request_row
      WHERE request_row.target_user_id = v_owner_uuid
        AND request_row.status IN ('previewed', 'applying', 'partial')
    ) THEN
      RAISE EXCEPTION 'account_deletion_storage_owner_write_fenced'
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_storage_objects AS captured
    JOIN privacy_retention.account_deletion_external_jobs AS job
      ON job.request_id = captured.request_id
     AND job.phase = 'storage'
    WHERE job.state IN ('pending', 'leased', 'egress_unknown', 'reconciliation_required')
      AND (
        (captured.bucket_id = v_new_bucket_id AND captured.object_name = v_new_object_name)
        OR (
          v_old_bucket_id IS NOT NULL
          AND captured.bucket_id = v_old_bucket_id
          AND captured.object_name = v_old_object_name
        )
      )
  ) THEN
    RAISE EXCEPTION 'account_deletion_storage_object_write_fenced'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;
DROP TRIGGER IF EXISTS g014_account_deletion_storage_write_fence ON storage.objects;
CREATE TRIGGER g014_account_deletion_storage_write_fence
BEFORE INSERT OR UPDATE ON storage.objects
FOR EACH ROW EXECUTE FUNCTION privacy_retention.g014_account_deletion_storage_write_fence();
ALTER FUNCTION privacy_retention.g014_account_deletion_storage_write_fence()
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_account_deletion_storage_write_fence()
  FROM PUBLIC, anon, authenticated, service_role;

ALTER FUNCTION public.get_account_deletion_storage_work(uuid,uuid,uuid,text,text,text,uuid)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.get_account_deletion_storage_work(uuid,uuid,uuid,text,text,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_account_deletion_storage_work(uuid,uuid,uuid,text,text,text,uuid)
  TO service_role;
ALTER FUNCTION privacy_retention.g014_account_deletion_claim_storage_object(uuid,uuid)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_account_deletion_claim_storage_object(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION privacy_retention.g014_account_deletion_external_attempt_binding_guard()
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_account_deletion_external_attempt_binding_guard()
  FROM PUBLIC, anon, authenticated, service_role;
SELECT privacy_retention.assert_g014_public_rpc_allowlist();
-- G014-07 recovery dispatch: the scheduler receives only an immutable worker
-- binding. Object locators, browser/session state, and provider diagnostics
-- remain behind the owner-scoped worker RPCs.
CREATE OR REPLACE FUNCTION public.claim_next_account_deletion_external_job()
RETURNS TABLE (
  actor_user_id uuid,
  target_user_id uuid,
  request_id uuid,
  preview_hash text,
  idempotency_key text,
  source_manifest_hash text,
  phase text,
  attempt_token uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_job record;
  v_claim record;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_require_service_role();

  -- Discovery deliberately does not lock a job first: the exact claim RPC takes
  -- the target lock before its job lock, so concurrent schedulers serialize at
  -- the same durable one-winner boundary without inversion.
  FOR v_job IN
    SELECT
      job.actor_user_id,
      job.target_user_id,
      job.request_id,
      job.preview_hash,
      job.idempotency_key,
      job.source_manifest_hash,
      job.phase,
      job.current_attempt_token
    FROM privacy_retention.account_deletion_external_jobs AS job
    JOIN public.account_deletion_requests AS request_row
      ON request_row.id = job.request_id
    WHERE job.state IN ('pending', 'leased', 'egress_unknown', 'reconciliation_required')
      AND request_row.status IN ('applying', 'partial')
      AND request_row.source_manifest_hash = job.source_manifest_hash
      AND (
        (job.phase = 'session'
          AND request_row.db_readback_passed
          AND NOT request_row.session_readback_passed)
        OR (job.phase = 'storage'
          AND request_row.db_readback_passed
          AND request_row.session_readback_passed
          AND NOT request_row.storage_readback_passed)
        OR (job.phase = 'auth'
          AND request_row.db_readback_passed
          AND request_row.session_readback_passed
          AND request_row.storage_readback_passed
          AND NOT request_row.auth_readback_passed)
      )
      AND (
        job.state <> 'leased'
        OR NOT EXISTS (
          SELECT 1
          FROM privacy_retention.account_deletion_external_job_attempts AS attempt
          WHERE attempt.attempt_token = job.current_attempt_token
            AND attempt.state = 'leased'
            AND attempt.lease_expires_at > pg_catalog.clock_timestamp()
        )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM privacy_retention.privacy_legal_holds AS hold_row
        JOIN privacy_retention.account_deletion_hold_class_map AS hold_map
          ON hold_map.hold_data_class = hold_row.data_class
        WHERE hold_map.deletion_class = 'account_deletion'
          AND hold_row.subject_ref_hash =
              privacy_retention.g014_account_deletion_subject_hash(job.target_user_id)
          AND hold_row.status = 'active'
          AND (
            hold_row.expires_at IS NULL
            OR hold_row.expires_at > pg_catalog.clock_timestamp()
          )
      )
    ORDER BY
      request_row.created_at,
      CASE job.phase
        WHEN 'session' THEN 1
        WHEN 'storage' THEN 2
        ELSE 3
      END,
      job.request_id
    LIMIT 64
  LOOP
    BEGIN
      SELECT * INTO v_claim
      FROM public.claim_account_deletion_external_job(
        v_job.actor_user_id,
        v_job.target_user_id,
        v_job.request_id,
        v_job.preview_hash,
        v_job.idempotency_key,
        v_job.source_manifest_hash,
        v_job.phase,
        v_job.current_attempt_token
      );
    EXCEPTION WHEN SQLSTATE '55000' THEN
      -- A stale or independently reconciled candidate must not abort dispatch
      -- for later jobs. The owner-scoped claim remains the only authority.
      CONTINUE;
    END;

    -- Another scheduler may have won after our read. The nested claim is the
    -- only ownership boundary, so move on rather than returning a stale lease.
    IF v_claim.claim_status = 'busy' THEN
      CONTINUE;
    END IF;
    IF v_claim.claim_status IN ('claimed', 'replayed')
       AND v_claim.attempt_token IS NOT NULL THEN
      RETURN QUERY SELECT
        v_job.actor_user_id,
        v_job.target_user_id,
        v_job.request_id,
        v_job.preview_hash,
        v_job.idempotency_key,
        v_job.source_manifest_hash,
        v_job.phase,
        v_claim.attempt_token;
      RETURN;
    END IF;
  END LOOP;
END;
$function$;

ALTER FUNCTION public.claim_next_account_deletion_external_job()
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.claim_next_account_deletion_external_job()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_next_account_deletion_external_job()
  TO service_role;

INSERT INTO privacy_retention.g014_public_rpc_allowlist (
  function_schema, function_name, identity_arguments, grantee, source_signature
)
SELECT
  namespace.nspname,
  procedure.proname,
  procedure.proargtypes::text,
  'service_role'::name,
  'public.claim_next_account_deletion_external_job()'
FROM pg_catalog.pg_proc AS procedure
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = procedure.pronamespace
WHERE procedure.oid = pg_catalog.to_regprocedure(
  'public.claim_next_account_deletion_external_job()'
)
ON CONFLICT DO NOTHING;

SELECT privacy_retention.assert_g014_public_rpc_allowlist();
-- G014-08 recovery readback: the initiating user can poll only the exact
-- self-owned request. The durable worker remains the only external executor.
DO $g014_account_deletion_owner_status_preflight$
BEGIN
  IF pg_catalog.to_regclass('public.account_deletion_requests') IS NULL
     OR pg_catalog.to_regclass('public.account_deletion_request_items') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.g014_public_rpc_allowlist') IS NULL
     OR pg_catalog.to_regprocedure('auth.uid()') IS NULL
     OR pg_catalog.to_regprocedure('extensions.digest(text,text)') IS NULL THEN
    RAISE EXCEPTION 'G014-08 account-deletion owner status dependencies are missing';
  END IF;
END;
$g014_account_deletion_owner_status_preflight$;

CREATE OR REPLACE FUNCTION public.read_current_account_deletion_status(
  p_request_id uuid,
  p_preview_hash text,
  p_source_manifest_hash text
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
  auth_readback_passed boolean,
  auth_receipt_ref text,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_owner_id uuid := auth.uid();
BEGIN
  IF v_owner_id IS NULL
     OR p_request_id IS NULL
     OR p_preview_hash IS NULL
     OR p_source_manifest_hash IS NULL
     OR p_preview_hash !~ '^[0-9a-f]{64}$'
     OR p_source_manifest_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    request_row.id,
    request_row.status,
    request_row.reason_code,
    LEAST(
      COALESCE(
        (
          SELECT sum(item.planned_count)
          FROM public.account_deletion_request_items AS item
          WHERE item.request_id = request_row.id
            AND item.disposition = 'delete'
        ),
        0
      ),
      2147483647
    )::integer,
    LEAST(
      COALESCE(
        (
          SELECT sum(item.planned_count)
          FROM public.account_deletion_request_items AS item
          WHERE item.request_id = request_row.id
            AND item.disposition = 'anonymize'
        ),
        0
      ),
      2147483647
    )::integer,
    LEAST(
      COALESCE(
        (
          SELECT sum(item.planned_count)
          FROM public.account_deletion_request_items AS item
          WHERE item.request_id = request_row.id
            AND item.disposition = 'separate'
        ),
        0
      ),
      2147483647
    )::integer,
    LEAST(
      COALESCE(
        (
          SELECT sum(item.planned_count)
          FROM public.account_deletion_request_items AS item
          WHERE item.request_id = request_row.id
            AND item.disposition = 'retain'
        ),
        0
      ),
      2147483647
    )::integer,
    request_row.db_readback_passed,
    request_row.storage_readback_passed,
    request_row.session_readback_passed,
    request_row.auth_readback_passed,
    CASE
      WHEN request_row.status = 'applied'
        AND request_row.db_readback_passed
        AND request_row.storage_readback_passed
        AND request_row.session_readback_passed
        AND request_row.auth_readback_passed
        AND request_row.applied_at IS NOT NULL
        AND request_row.auth_receipt_ref ~ '^[A-Za-z0-9._:-]{8,256}$'
      THEN request_row.auth_receipt_ref
      ELSE NULL
    END,
    request_row.source_manifest_hash
  FROM public.account_deletion_requests AS request_row
  WHERE request_row.id = p_request_id
    AND request_row.actor_user_id = v_owner_id
    AND request_row.target_user_id = v_owner_id
    AND request_row.preview_hash = p_preview_hash
    AND request_row.source_manifest_hash = p_source_manifest_hash
    AND request_row.status IN ('applying', 'partial', 'failed', 'applied', 'expired', 'cancelled')
    AND public.account_deletion_reason_code_is_safe(request_row.reason_code);
END;
$function$;

ALTER FUNCTION public.read_current_account_deletion_status(uuid, text, text)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.read_current_account_deletion_status(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.read_current_account_deletion_status(uuid, text, text)
  TO authenticated;

INSERT INTO privacy_retention.g014_public_rpc_allowlist (
  function_schema, function_name, identity_arguments, grantee, source_signature
)
SELECT
  namespace.nspname,
  procedure.proname,
  procedure.proargtypes::text,
  'authenticated'::name,
  'public.read_current_account_deletion_status(uuid,text,text)'
FROM pg_catalog.pg_proc AS procedure
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = procedure.pronamespace
WHERE procedure.oid = pg_catalog.to_regprocedure(
  'public.read_current_account_deletion_status(uuid,text,text)'
)
ON CONFLICT DO NOTHING;

DO $g014_account_deletion_owner_status_catalog_assertion$
DECLARE
  v_status_rpc oid := pg_catalog.to_regprocedure(
    'public.read_current_account_deletion_status(uuid,text,text)'
  );
BEGIN
  IF v_status_rpc IS NULL
     OR pg_catalog.pg_get_userbyid(
       (SELECT procedure.proowner FROM pg_catalog.pg_proc AS procedure
        WHERE procedure.oid = v_status_rpc)
     ) IS DISTINCT FROM 'privacy_workflow_owner'
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', v_status_rpc, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('anon', v_status_rpc, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', v_status_rpc, 'EXECUTE')
     OR NOT EXISTS (
       SELECT 1
       FROM privacy_retention.g014_public_rpc_allowlist AS allowed
       WHERE allowed.source_signature =
             'public.read_current_account_deletion_status(uuid,text,text)'
         AND allowed.grantee = 'authenticated'::name
     ) THEN
    RAISE EXCEPTION 'G014-08 account-deletion owner status RPC grant or catalog assertion failed';
  END IF;
END;
$g014_account_deletion_owner_status_catalog_assertion$;

SELECT privacy_retention.assert_g014_public_rpc_allowlist();
-- G014-09 liveness and opaque-storage recovery. Captured evidence is immutable
-- opaque identity; live locators are resolved only from locked storage rows.
DROP FUNCTION IF EXISTS public.list_account_deletion_storage_objects(
  uuid,uuid,uuid,text,text,text,uuid
);

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_claim_storage_object(
  p_request_id uuid,
  p_target_user_id uuid
)
RETURNS privacy_retention.account_deletion_storage_objects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_object storage.objects%ROWTYPE;
  v_captured privacy_retention.account_deletion_storage_objects%ROWTYPE;
  v_version text;
  v_version_hash text;
BEGIN
  SELECT object_row.* INTO v_object
  FROM storage.objects AS object_row
  WHERE object_row.owner_id::text = p_target_user_id::text
    AND NOT EXISTS (
      SELECT 1
      FROM privacy_retention.account_deletion_storage_objects AS captured
      JOIN privacy_retention.account_deletion_external_job_provider_proofs AS proof
        ON proof.request_id = captured.request_id
       AND proof.phase = 'storage'
       AND proof.object_locator_hash = captured.object_locator_hash
       AND proof.object_version_hash = captured.object_version_hash
       AND proof.object_id = captured.object_id
       AND proof.object_version = captured.object_version
      WHERE captured.request_id = p_request_id
        AND captured.object_id = object_row.id
        AND captured.object_version = pg_catalog.to_jsonb(object_row) ->> 'version'
    )
  ORDER BY object_row.id
  LIMIT 1
  FOR UPDATE OF object_row;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_version := pg_catalog.to_jsonb(v_object) ->> 'version';
  IF v_object.id IS NULL
     OR v_version !~ '^[A-Za-z0-9._:-]{1,256}$' THEN
    RAISE EXCEPTION 'account_deletion_storage_exact_identity_missing'
      USING ERRCODE = '55000';
  END IF;
  v_version_hash := pg_catalog.encode(
    extensions.digest(v_version, 'sha256'),
    'hex'
  );

  INSERT INTO privacy_retention.account_deletion_storage_objects (
    request_id, object_locator_hash, object_version_hash, object_id, object_version
  ) VALUES (
    p_request_id,
    pg_catalog.encode(
      extensions.digest(v_object.bucket_id::text || E'\n' || v_object.name::text, 'sha256'),
      'hex'
    ),
    v_version_hash,
    v_object.id,
    v_version
  )
  ON CONFLICT (request_id, object_id, object_version) DO NOTHING;

  SELECT * INTO v_captured
  FROM privacy_retention.account_deletion_storage_objects
  WHERE request_id = p_request_id
    AND object_id = v_object.id
    AND object_version = v_version
  FOR SHARE;

  IF NOT FOUND
     OR v_captured.object_version_hash IS DISTINCT FROM v_version_hash THEN
    RAISE EXCEPTION 'account_deletion_storage_manifest_version_mismatch'
      USING ERRCODE = '55000';
  END IF;

  RETURN v_captured;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_complete_external_job_phase(
  p_request_id uuid,
  p_phase text,
  p_attempt_token uuid
)
RETURNS public.account_deletion_requests
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_attempt privacy_retention.account_deletion_external_job_attempts%ROWTYPE;
  v_storage_receipts_hash text;
  v_auth_receipt_ref text;
  v_object_absent boolean;
  v_object_proved boolean;
  v_storage_absent boolean;
  v_missing_proof_count integer;
  v_storage_phase_complete boolean := false;
BEGIN
  SELECT * INTO v_request
  FROM public.account_deletion_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_external_job_request_missing' USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_attempt
  FROM privacy_retention.account_deletion_external_job_attempts
  WHERE attempt_token = p_attempt_token
    AND request_id = p_request_id
    AND phase = p_phase
  FOR UPDATE;
  IF NOT FOUND
     OR v_attempt.state NOT IN ('leased', 'egress_unknown', 'reconciliation_required') THEN
    RAISE EXCEPTION 'account_deletion_external_job_attempt_completion_invalid'
      USING ERRCODE = '55000';
  END IF;

  PERFORM privacy_retention.g014_account_deletion_assert_no_hold(v_request.target_user_id);

  IF p_phase = 'session' THEN
    UPDATE public.account_deletion_requests
    SET status = 'applying',
        reason_code = 'DB_AND_SESSION_READBACK_PASSED',
        session_readback_passed = true
    WHERE id = v_request.id
    RETURNING * INTO v_request;
    UPDATE privacy_retention.account_deletion_external_job_attempts
    SET state = 'completed', completed_at = pg_catalog.clock_timestamp()
    WHERE attempt_token = p_attempt_token
      AND state IN ('leased', 'egress_unknown', 'reconciliation_required');
    UPDATE privacy_retention.account_deletion_external_jobs
    SET state = 'completed',
        current_attempt_token = p_attempt_token,
        completed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    WHERE request_id = v_request.id AND phase = p_phase;
  ELSIF p_phase = 'storage' THEN
    IF v_attempt.storage_object_locator_hash IS NOT NULL THEN
      SELECT NOT EXISTS (
        SELECT 1
        FROM storage.objects AS object_row
        WHERE object_row.owner_id::text = v_request.target_user_id::text
          AND object_row.id = v_attempt.storage_object_id
          AND pg_catalog.to_jsonb(object_row) ->> 'version'
              = v_attempt.storage_object_version
      ) INTO v_object_absent;
      SELECT EXISTS (
        SELECT 1
        FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
        WHERE proof.request_id = p_request_id
          AND proof.phase = 'storage'
          AND proof.attempt_token = p_attempt_token
          AND proof.object_locator_hash = v_attempt.storage_object_locator_hash
          AND proof.object_version_hash = v_attempt.storage_object_version_hash
          AND proof.object_id = v_attempt.storage_object_id
          AND proof.object_version = v_attempt.storage_object_version
      ) INTO v_object_proved;
      IF NOT v_object_absent OR NOT v_object_proved THEN
        RAISE EXCEPTION 'account_deletion_storage_subattempt_not_reconciled'
          USING ERRCODE = '55000';
      END IF;
    END IF;

    SELECT NOT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE owner_id::text = v_request.target_user_id::text
    ) INTO v_storage_absent;
    SELECT count(*) INTO v_missing_proof_count
    FROM privacy_retention.account_deletion_storage_objects AS captured
    WHERE captured.request_id = p_request_id
      AND NOT EXISTS (
        SELECT 1
        FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
        WHERE proof.request_id = p_request_id
          AND proof.phase = 'storage'
          AND proof.object_locator_hash = captured.object_locator_hash
          AND proof.object_version_hash = captured.object_version_hash
          AND proof.object_id = captured.object_id
          AND proof.object_version = captured.object_version
      );

    IF NOT v_storage_absent OR v_missing_proof_count <> 0 THEN
      UPDATE privacy_retention.account_deletion_external_job_attempts
      SET state = 'completed', completed_at = pg_catalog.clock_timestamp()
      WHERE attempt_token = p_attempt_token
        AND state IN ('leased', 'egress_unknown', 'reconciliation_required');
      UPDATE privacy_retention.account_deletion_external_jobs
      SET state = 'pending',
          current_attempt_token = NULL,
          updated_at = pg_catalog.clock_timestamp()
      WHERE request_id = p_request_id
        AND phase = 'storage'
        AND current_attempt_token = p_attempt_token;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_deletion_storage_subattempt_completion_failed'
          USING ERRCODE = '55000';
      END IF;
    ELSE
      SELECT pg_catalog.encode(
        extensions.digest(
          COALESCE((
            SELECT pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object(
                'objectLocatorHash', proof.object_locator_hash,
                'objectVersionHash', proof.object_version_hash,
                'objectId', proof.object_id,
                'objectVersion', proof.object_version,
                'providerReceiptRef', proof.provider_receipt_ref,
                'providerReceiptHash', proof.provider_receipt_hash
              )
              ORDER BY proof.object_locator_hash, proof.object_version_hash
            )::text
            FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
            WHERE proof.request_id = v_request.id AND proof.phase = 'storage'
          ), '[]'),
          'sha256'
        ),
        'hex'
      ) INTO v_storage_receipts_hash;
      UPDATE public.account_deletion_request_items
      SET status = 'applied', reason_code = 'STORAGE_READBACK_PASSED'
      WHERE request_id = v_request.id AND data_class_code = 'storage_objects';
      UPDATE public.account_deletion_requests
      SET status = 'applying',
          reason_code = 'STORAGE_READBACK_PASSED',
          storage_readback_passed = true,
          storage_receipts_hash = v_storage_receipts_hash
      WHERE id = v_request.id
      RETURNING * INTO v_request;
      UPDATE privacy_retention.account_deletion_external_job_attempts
      SET state = 'completed', completed_at = pg_catalog.clock_timestamp()
      WHERE attempt_token = p_attempt_token
        AND state IN ('leased', 'egress_unknown', 'reconciliation_required');
      UPDATE privacy_retention.account_deletion_external_jobs
      SET state = 'completed',
          current_attempt_token = p_attempt_token,
          completed_at = pg_catalog.clock_timestamp(),
          updated_at = pg_catalog.clock_timestamp()
      WHERE request_id = v_request.id AND phase = p_phase;
      v_storage_phase_complete := true;
    END IF;
  ELSIF p_phase = 'auth' THEN
    SELECT NOT EXISTS (
      SELECT 1
      FROM storage.objects
      WHERE owner_id::text = v_request.target_user_id::text
    ) INTO v_storage_absent;
    IF NOT v_storage_absent THEN
      RAISE EXCEPTION 'account_deletion_auth_storage_authoritative_absence_failed'
        USING ERRCODE = '55000';
    END IF;
    UPDATE public.account_deletion_request_items
    SET status = 'applied', reason_code = 'AUTH_READBACK_PASSED'
    WHERE request_id = v_request.id AND data_class_code = 'auth_identity';
    PERFORM privacy_retention.g014_account_deletion_assert_final_items(
      v_request.id, v_request.target_user_id
    );
    v_auth_receipt_ref := 'auth:' || pg_catalog.encode(
      extensions.digest(
        pg_catalog.concat_ws(
          E'\n',
          v_request.id::text,
          v_request.target_user_id::text,
          v_request.source_manifest_hash,
          p_attempt_token::text,
          'authoritative_absent'
        ),
        'sha256'
      ),
      'hex'
    );
    UPDATE public.account_deletion_requests
    SET status = 'applied',
        reason_code = 'APPLIED',
        auth_readback_passed = true,
        auth_receipt_ref = v_auth_receipt_ref,
        applied_at = pg_catalog.clock_timestamp()
    WHERE id = v_request.id
    RETURNING * INTO v_request;
    UPDATE privacy_retention.account_deletion_admin_reservations
    SET status = 'completed', reconciled_at = pg_catalog.clock_timestamp()
    WHERE request_id = v_request.id AND status = 'active';
    UPDATE privacy_retention.account_deletion_external_job_attempts
    SET state = 'completed', completed_at = pg_catalog.clock_timestamp()
    WHERE attempt_token = p_attempt_token
      AND state IN ('leased', 'egress_unknown', 'reconciliation_required');
    UPDATE privacy_retention.account_deletion_external_jobs
    SET state = 'completed',
        current_attempt_token = p_attempt_token,
        completed_at = pg_catalog.clock_timestamp(),
        updated_at = pg_catalog.clock_timestamp()
    WHERE request_id = v_request.id AND phase = p_phase;
  ELSE
    RAISE EXCEPTION 'account_deletion_external_job_phase_invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO privacy_retention.account_deletion_external_job_checkpoints (
    request_id, phase, attempt_token, checkpoint_kind, checkpoint_state, proof_hash
  ) VALUES (
    v_request.id, p_phase, p_attempt_token, 'authoritative_absent', 'confirmed',
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.concat_ws(
          ':',
          'g014-authoritative-absent:v4',
          v_request.id::text,
          p_phase,
          p_attempt_token::text,
          COALESCE(v_attempt.storage_object_locator_hash, '<none>'),
          COALESCE(v_attempt.storage_object_version_hash, '<none>'),
          COALESCE(v_attempt.storage_object_id::text, '<none>'),
          COALESCE(v_attempt.storage_object_version, '<none>')
        ),
        'sha256'
      ),
      'hex'
    )
  )
  ON CONFLICT (request_id, phase, attempt_token, checkpoint_kind) DO NOTHING;

  IF p_phase <> 'storage' OR v_storage_phase_complete THEN
    PERFORM privacy_retention.g014_account_deletion_append_audit(
      v_request,
      CASE WHEN p_phase = 'auth' THEN 'applied' ELSE 'readback_passed' END,
      v_request.reason_code
    );
  END IF;
  RETURN v_request;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_reconcile_expired_attempt(
  p_request_id uuid,
  p_phase text,
  p_attempt_token uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_job privacy_retention.account_deletion_external_jobs%ROWTYPE;
  v_attempt privacy_retention.account_deletion_external_job_attempts%ROWTYPE;
  v_absent boolean;
  v_object_proved boolean;
  v_has_egress_unknown_checkpoint boolean;
  v_job_state text;
  v_now timestamptz := pg_catalog.clock_timestamp();
BEGIN
  SELECT * INTO v_job
  FROM privacy_retention.account_deletion_external_jobs
  WHERE request_id = p_request_id AND phase = p_phase
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_external_job_missing' USING ERRCODE = '55000';
  END IF;
  SELECT * INTO v_attempt
  FROM privacy_retention.account_deletion_external_job_attempts
  WHERE attempt_token = p_attempt_token
    AND request_id = p_request_id
    AND phase = p_phase
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_external_job_attempt_missing' USING ERRCODE = '55000';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_external_job_checkpoints AS checkpoint
    WHERE checkpoint.request_id = p_request_id
      AND checkpoint.phase = p_phase
      AND checkpoint.attempt_token = p_attempt_token
      AND checkpoint.checkpoint_kind = 'egress_unknown'
      AND checkpoint.checkpoint_state = 'unknown'
  ) INTO v_has_egress_unknown_checkpoint;

  IF v_attempt.state = 'leased' AND NOT v_has_egress_unknown_checkpoint THEN
    IF v_attempt.lease_expires_at > v_now THEN
      RAISE EXCEPTION 'account_deletion_external_job_attempt_not_expired'
        USING ERRCODE = '55000';
    END IF;
    UPDATE privacy_retention.account_deletion_external_job_attempts
    SET state = 'released', reconciled_at = v_now
    WHERE attempt_token = p_attempt_token
      AND state = 'leased';
    UPDATE privacy_retention.account_deletion_external_jobs
    SET state = 'pending',
        current_attempt_token = NULL,
        updated_at = v_now
    WHERE request_id = p_request_id
      AND phase = p_phase
      AND state = 'leased'
      AND current_attempt_token = p_attempt_token;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'account_deletion_external_job_release_failed'
        USING ERRCODE = '55000';
    END IF;
    RETURN 'released';
  END IF;

  IF v_attempt.state = 'egress_unknown' AND NOT v_has_egress_unknown_checkpoint THEN
    RAISE EXCEPTION 'account_deletion_external_job_egress_checkpoint_missing'
      USING ERRCODE = '55000';
  END IF;

  IF p_phase = 'storage' THEN
    IF v_attempt.storage_object_locator_hash IS NULL THEN
      SELECT NOT EXISTS (
        SELECT 1 FROM storage.objects
        WHERE owner_id::text = v_job.target_user_id::text
      ) INTO v_absent;
      SELECT NOT EXISTS (
        SELECT 1
        FROM privacy_retention.account_deletion_storage_objects AS captured
        WHERE captured.request_id = p_request_id
          AND NOT EXISTS (
            SELECT 1
            FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
            WHERE proof.request_id = p_request_id
              AND proof.phase = 'storage'
              AND proof.object_locator_hash = captured.object_locator_hash
              AND proof.object_version_hash = captured.object_version_hash
              AND proof.object_id = captured.object_id
              AND proof.object_version = captured.object_version
          )
      ) INTO v_object_proved;
    ELSE
      SELECT NOT EXISTS (
        SELECT 1
        FROM storage.objects AS object_row
        WHERE object_row.owner_id::text = v_job.target_user_id::text
          AND object_row.id = v_attempt.storage_object_id
          AND pg_catalog.to_jsonb(object_row) ->> 'version'
              = v_attempt.storage_object_version
      ) INTO v_absent;
      SELECT EXISTS (
        SELECT 1
        FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
        WHERE proof.request_id = p_request_id
          AND proof.phase = 'storage'
          AND proof.attempt_token = p_attempt_token
          AND proof.object_locator_hash = v_attempt.storage_object_locator_hash
          AND proof.object_version_hash = v_attempt.storage_object_version_hash
          AND proof.object_id = v_attempt.storage_object_id
          AND proof.object_version = v_attempt.storage_object_version
      ) INTO v_object_proved;
    END IF;
    IF v_absent AND v_object_proved THEN
      PERFORM privacy_retention.g014_account_deletion_complete_external_job_phase(
        p_request_id, p_phase, p_attempt_token
      );
      SELECT state INTO v_job_state
      FROM privacy_retention.account_deletion_external_jobs
      WHERE request_id = p_request_id AND phase = p_phase;
      RETURN CASE WHEN v_job_state = 'completed' THEN 'completed' ELSE 'released' END;
    END IF;
  ELSIF p_phase = 'session' THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM auth.sessions WHERE user_id = v_job.target_user_id
      UNION ALL
      SELECT 1 FROM auth.refresh_tokens WHERE user_id = v_job.target_user_id
    ) INTO v_absent;
    IF v_absent THEN
      PERFORM privacy_retention.g014_account_deletion_complete_external_job_phase(
        p_request_id, p_phase, p_attempt_token
      );
      RETURN 'completed';
    END IF;
  ELSIF p_phase = 'auth' THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM auth.users WHERE id = v_job.target_user_id
      UNION ALL SELECT 1 FROM auth.sessions WHERE user_id = v_job.target_user_id
      UNION ALL SELECT 1 FROM auth.identities WHERE user_id = v_job.target_user_id
      UNION ALL SELECT 1 FROM auth.refresh_tokens WHERE user_id = v_job.target_user_id
    ) INTO v_absent;
    IF v_absent THEN
      PERFORM privacy_retention.g014_account_deletion_complete_external_job_phase(
        p_request_id, p_phase, p_attempt_token
      );
      RETURN 'completed';
    END IF;
  ELSE
    RAISE EXCEPTION 'account_deletion_external_job_phase_invalid' USING ERRCODE = '22023';
  END IF;

  UPDATE privacy_retention.account_deletion_external_job_attempts
  SET state = 'reconciliation_required', reconciled_at = v_now
  WHERE attempt_token = p_attempt_token
    AND state IN ('leased', 'egress_unknown');
  UPDATE privacy_retention.account_deletion_external_jobs
  SET state = 'reconciliation_required',
      current_attempt_token = p_attempt_token,
      updated_at = v_now
  WHERE request_id = p_request_id AND phase = p_phase;
  RETURN 'reconciliation_required';
END;
$function$;

CREATE OR REPLACE FUNCTION public.claim_account_deletion_external_job(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_phase text,
  p_attempt_token uuid
)
RETURNS TABLE (
  request_id uuid,
  phase text,
  claim_status text,
  attempt_token uuid,
  lease_expires_at timestamptz,
  job_state text,
  checkpoint_state text,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_job privacy_retention.account_deletion_external_jobs%ROWTYPE;
  v_attempt privacy_retention.account_deletion_external_job_attempts%ROWTYPE;
  v_storage_object privacy_retention.account_deletion_storage_objects%ROWTYPE;
  v_storage_absent boolean;
  v_missing_proof_count integer;
  v_storage_verifier_only boolean := false;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_reconcile_status text;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_require_service_role();
  IF p_actor_user_id IS NULL OR p_target_user_id IS NULL OR p_request_id IS NULL
     OR p_preview_hash IS NULL OR p_idempotency_key IS NULL
     OR p_source_manifest_hash IS NULL OR p_phase NOT IN ('session', 'storage', 'auth') THEN
    RAISE EXCEPTION 'account_deletion_external_job_claim_arguments_invalid'
      USING ERRCODE = '22004';
  END IF;

  PERFORM privacy_retention.g014_account_deletion_lock_target(p_target_user_id);
  SELECT * INTO v_request
  FROM public.account_deletion_requests
  WHERE id = p_request_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_request.actor_user_id IS DISTINCT FROM p_actor_user_id
     OR v_request.target_user_id IS DISTINCT FROM p_target_user_id
     OR v_request.preview_hash IS DISTINCT FROM p_preview_hash
     OR v_request.idempotency_key IS DISTINCT FROM p_idempotency_key
     OR v_request.source_manifest_hash IS DISTINCT FROM p_source_manifest_hash THEN
    RAISE EXCEPTION 'account_deletion_external_job_claim_binding_mismatch'
      USING ERRCODE = '55000';
  END IF;

  SELECT * INTO v_job
  FROM privacy_retention.account_deletion_external_jobs
  WHERE request_id = p_request_id AND phase = p_phase
  FOR UPDATE;
  IF FOUND THEN
    IF v_job.actor_user_id IS DISTINCT FROM p_actor_user_id
       OR v_job.target_user_id IS DISTINCT FROM p_target_user_id
       OR v_job.preview_hash IS DISTINCT FROM p_preview_hash
       OR v_job.idempotency_key IS DISTINCT FROM p_idempotency_key
       OR v_job.source_manifest_hash IS DISTINCT FROM p_source_manifest_hash THEN
      RAISE EXCEPTION 'account_deletion_external_job_claim_binding_mismatch'
        USING ERRCODE = '55000';
    END IF;
    IF v_job.state = 'completed' THEN
      SELECT * INTO v_attempt
      FROM privacy_retention.account_deletion_external_job_attempts
      WHERE attempt_token = v_job.current_attempt_token
        AND request_id = p_request_id
        AND phase = p_phase
        AND state = 'completed'
      FOR SHARE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_deletion_external_job_completed_receipt_invalid'
          USING ERRCODE = '55000';
      END IF;
      IF p_attempt_token IS NOT NULL
         AND p_attempt_token IS DISTINCT FROM v_attempt.attempt_token THEN
        RAISE EXCEPTION 'account_deletion_external_job_completed_receipt_binding_mismatch'
          USING ERRCODE = '55000';
      END IF;
      RETURN QUERY SELECT p_request_id, p_phase, 'completed', v_attempt.attempt_token,
        NULL::timestamptz, 'completed', 'authoritative_absent', p_source_manifest_hash;
      RETURN;
    END IF;
  END IF;

  PERFORM privacy_retention.g014_account_deletion_assert_no_hold(p_target_user_id);
  PERFORM privacy_retention.g014_account_deletion_assert_external_job_predecessor(v_request, p_phase);

  IF v_job.request_id IS NULL THEN
    INSERT INTO privacy_retention.account_deletion_external_jobs (
      request_id, phase, actor_user_id, target_user_id, preview_hash,
      idempotency_key, source_manifest_hash
    ) VALUES (
      p_request_id, p_phase, p_actor_user_id, p_target_user_id, p_preview_hash,
      p_idempotency_key, p_source_manifest_hash
    );
    SELECT * INTO v_job
    FROM privacy_retention.account_deletion_external_jobs
    WHERE request_id = p_request_id AND phase = p_phase
    FOR UPDATE;
  END IF;

  SELECT * INTO v_attempt
  FROM privacy_retention.account_deletion_external_job_attempts
  WHERE request_id = p_request_id
    AND phase = p_phase
    AND state IN ('leased', 'egress_unknown', 'reconciliation_required')
  ORDER BY claimed_at DESC
  LIMIT 1
  FOR UPDATE;

  IF FOUND
     AND p_attempt_token IS NOT NULL
     AND p_attempt_token IS DISTINCT FROM v_attempt.attempt_token THEN
    RETURN QUERY SELECT p_request_id, p_phase, 'busy', NULL::uuid, NULL::timestamptz,
      v_job.state, v_attempt.state, p_source_manifest_hash;
    RETURN;
  END IF;
  IF FOUND AND v_attempt.state = 'egress_unknown' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM privacy_retention.account_deletion_external_job_checkpoints AS checkpoint
      WHERE checkpoint.request_id = p_request_id
        AND checkpoint.phase = p_phase
        AND checkpoint.attempt_token = v_attempt.attempt_token
        AND checkpoint.checkpoint_kind = 'egress_unknown'
        AND checkpoint.checkpoint_state = 'unknown'
    ) THEN
      RAISE EXCEPTION 'account_deletion_external_job_egress_checkpoint_missing'
        USING ERRCODE = '55000';
    END IF;
    RETURN QUERY SELECT p_request_id, p_phase, 'replayed', v_attempt.attempt_token,
      NULL::timestamptz, 'egress_unknown', 'verify_absence_only', p_source_manifest_hash;
    RETURN;
  END IF;
  IF FOUND AND v_attempt.state = 'reconciliation_required' THEN
    RETURN QUERY SELECT p_request_id, p_phase, 'replayed', v_attempt.attempt_token,
      NULL::timestamptz, v_job.state, 'verify_absence_only', p_source_manifest_hash;
    RETURN;
  END IF;
  IF FOUND AND v_attempt.state = 'leased' AND v_attempt.lease_expires_at > v_now THEN
    IF p_attempt_token IS NOT NULL AND p_attempt_token = v_attempt.attempt_token THEN
      RETURN QUERY SELECT p_request_id, p_phase, 'replayed', v_attempt.attempt_token,
        v_attempt.lease_expires_at, v_job.state, 'delete_then_verify', p_source_manifest_hash;
    ELSE
      RETURN QUERY SELECT p_request_id, p_phase, 'busy', NULL::uuid, NULL::timestamptz,
        v_job.state, v_attempt.state, p_source_manifest_hash;
    END IF;
    RETURN;
  END IF;
  IF FOUND THEN
    v_reconcile_status := privacy_retention.g014_account_deletion_reconcile_expired_attempt(
      p_request_id, p_phase, v_attempt.attempt_token
    );
    SELECT * INTO v_job
    FROM privacy_retention.account_deletion_external_jobs
    WHERE request_id = p_request_id AND phase = p_phase
    FOR UPDATE;
    IF v_reconcile_status = 'completed' THEN
      RETURN QUERY SELECT p_request_id, p_phase, 'completed', v_job.current_attempt_token,
        NULL::timestamptz, 'completed', 'authoritative_absent', p_source_manifest_hash;
      RETURN;
    ELSIF v_reconcile_status = 'reconciliation_required' THEN
      RETURN QUERY SELECT p_request_id, p_phase, 'replayed', v_attempt.attempt_token,
        NULL::timestamptz, v_job.state, 'verify_absence_only', p_source_manifest_hash;
      RETURN;
    ELSIF v_reconcile_status <> 'released' THEN
      RAISE EXCEPTION 'account_deletion_external_job_reconciliation_result_invalid'
        USING ERRCODE = '55000';
    END IF;
  END IF;

  IF v_job.state IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'account_deletion_external_job_attempt_state_invalid'
      USING ERRCODE = '55000';
  END IF;

  IF p_phase = 'storage' THEN
    v_storage_object := privacy_retention.g014_account_deletion_claim_storage_object(
      p_request_id, p_target_user_id
    );
    IF v_storage_object.request_id IS NULL THEN
      SELECT * INTO v_storage_object
      FROM privacy_retention.account_deletion_storage_objects AS captured
      WHERE captured.request_id = p_request_id
        AND NOT EXISTS (
          SELECT 1
          FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
          WHERE proof.request_id = p_request_id
            AND proof.phase = 'storage'
            AND proof.object_locator_hash = captured.object_locator_hash
            AND proof.object_version_hash = captured.object_version_hash
            AND proof.object_id = captured.object_id
            AND proof.object_version = captured.object_version
        )
        AND NOT EXISTS (
          SELECT 1
          FROM storage.objects AS object_row
          WHERE object_row.owner_id::text = p_target_user_id::text
            AND object_row.id = captured.object_id
            AND pg_catalog.to_jsonb(object_row) ->> 'version' = captured.object_version
        )
      ORDER BY captured.object_locator_hash, captured.object_version_hash
      LIMIT 1
      FOR SHARE;
      IF FOUND THEN
        v_storage_verifier_only := true;
      ELSE
        SELECT NOT EXISTS (
          SELECT 1 FROM storage.objects
          WHERE owner_id::text = p_target_user_id::text
        ) INTO v_storage_absent;
        SELECT count(*) INTO v_missing_proof_count
        FROM privacy_retention.account_deletion_storage_objects AS captured
        WHERE captured.request_id = p_request_id
          AND NOT EXISTS (
            SELECT 1
            FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
            WHERE proof.request_id = p_request_id
              AND proof.phase = 'storage'
              AND proof.object_locator_hash = captured.object_locator_hash
              AND proof.object_version_hash = captured.object_version_hash
              AND proof.object_id = captured.object_id
              AND proof.object_version = captured.object_version
          );
        IF NOT v_storage_absent OR v_missing_proof_count <> 0 THEN
          RAISE EXCEPTION 'account_deletion_storage_manifest_reconciliation_required'
            USING ERRCODE = '55000';
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO privacy_retention.account_deletion_external_job_attempts (
    request_id, phase, state, claimed_at, lease_expires_at, reconciled_at,
    storage_object_locator_hash, storage_object_version_hash,
    storage_object_id, storage_object_version
  ) VALUES (
    p_request_id, p_phase,
    CASE WHEN v_storage_verifier_only THEN 'reconciliation_required' ELSE 'leased' END,
    v_now, v_now + interval '5 minutes',
    CASE WHEN v_storage_verifier_only THEN v_now ELSE NULL END,
    v_storage_object.object_locator_hash, v_storage_object.object_version_hash,
    v_storage_object.object_id, v_storage_object.object_version
  )
  RETURNING * INTO v_attempt;

  UPDATE privacy_retention.account_deletion_external_jobs
  SET state = CASE WHEN v_storage_verifier_only THEN 'reconciliation_required' ELSE 'leased' END,
      current_attempt_token = v_attempt.attempt_token,
      updated_at = v_now
  WHERE request_id = p_request_id AND phase = p_phase;

  RETURN QUERY SELECT p_request_id, p_phase,
    CASE WHEN v_storage_verifier_only THEN 'replayed' ELSE 'claimed' END,
    v_attempt.attempt_token, v_attempt.lease_expires_at,
    CASE WHEN v_storage_verifier_only THEN 'reconciliation_required' ELSE 'leased' END,
    CASE WHEN v_storage_verifier_only THEN 'verify_absence_only' ELSE 'delete_then_verify' END,
    p_source_manifest_hash;
END;
$function$;

CREATE OR REPLACE FUNCTION public.prepare_account_deletion_external_egress(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_phase text,
  p_attempt_token uuid
)
RETURNS TABLE (
  request_id uuid,
  phase text,
  attempt_token uuid,
  egress_state text,
  provider_idempotency_key text,
  lease_expires_at timestamptz,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt privacy_retention.account_deletion_external_job_attempts%ROWTYPE;
  v_key text;
  v_absent boolean;
  v_missing_proof_count integer;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_assert_external_job_binding(
    p_actor_user_id, p_target_user_id, p_request_id, p_preview_hash,
    p_idempotency_key, p_source_manifest_hash, p_phase, p_attempt_token, true
  );
  SELECT * INTO v_attempt
  FROM privacy_retention.account_deletion_external_job_attempts
  WHERE attempt_token = p_attempt_token
  FOR UPDATE;
  IF v_attempt.state IS DISTINCT FROM 'leased' THEN
    RAISE EXCEPTION 'account_deletion_external_egress_already_prepared'
      USING ERRCODE = '55000';
  END IF;

  IF p_phase = 'auth' THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM auth.users WHERE id = p_target_user_id
      UNION ALL SELECT 1 FROM auth.sessions WHERE user_id = p_target_user_id
      UNION ALL SELECT 1 FROM auth.identities WHERE user_id = p_target_user_id
      UNION ALL SELECT 1 FROM auth.refresh_tokens WHERE user_id = p_target_user_id
    ) INTO v_absent;
    IF v_absent THEN
      PERFORM privacy_retention.g014_account_deletion_complete_external_job_phase(
        p_request_id, 'auth', p_attempt_token
      );
      RETURN QUERY SELECT p_request_id, p_phase, p_attempt_token, 'authoritative_absent',
        NULL::text, v_attempt.lease_expires_at, p_source_manifest_hash;
      RETURN;
    END IF;
  ELSIF p_phase = 'storage' AND v_attempt.storage_object_locator_hash IS NULL THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM storage.objects WHERE owner_id::text = p_target_user_id::text
    ) INTO v_absent;
    SELECT count(*) INTO v_missing_proof_count
    FROM privacy_retention.account_deletion_storage_objects AS captured
    WHERE captured.request_id = p_request_id
      AND NOT EXISTS (
        SELECT 1
        FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
        WHERE proof.request_id = p_request_id
          AND proof.phase = 'storage'
          AND proof.object_locator_hash = captured.object_locator_hash
          AND proof.object_version_hash = captured.object_version_hash
          AND proof.object_id = captured.object_id
          AND proof.object_version = captured.object_version
      );
    IF v_absent AND v_missing_proof_count = 0 THEN
      PERFORM privacy_retention.g014_account_deletion_complete_external_job_phase(
        p_request_id, 'storage', p_attempt_token
      );
      RETURN QUERY SELECT p_request_id, p_phase, p_attempt_token, 'authoritative_absent',
        NULL::text, v_attempt.lease_expires_at, p_source_manifest_hash;
      RETURN;
    END IF;
    RAISE EXCEPTION 'account_deletion_storage_reconciliation_required'
      USING ERRCODE = '55000';
  ELSIF p_phase = 'storage' AND NOT EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_storage_objects AS captured
    JOIN storage.objects AS object_row
      ON object_row.id = captured.object_id
     AND pg_catalog.to_jsonb(object_row) ->> 'version' = captured.object_version
    WHERE captured.request_id = p_request_id
      AND captured.object_locator_hash = v_attempt.storage_object_locator_hash
      AND captured.object_version_hash = v_attempt.storage_object_version_hash
      AND captured.object_id = v_attempt.storage_object_id
      AND captured.object_version = v_attempt.storage_object_version
      AND object_row.owner_id::text = p_target_user_id::text
  ) THEN
    RAISE EXCEPTION 'account_deletion_storage_attempt_exact_binding_stale'
      USING ERRCODE = '55000';
  END IF;

  v_key := CASE p_phase
    WHEN 'storage' THEN
      'g014-storage-' || pg_catalog.substr(p_request_id::text, 1, 8)
      || '-' || p_attempt_token::text
      || '-' || pg_catalog.substr(v_attempt.storage_object_locator_hash, 1, 40)
    WHEN 'auth' THEN
      'g014-auth-' || pg_catalog.substr(p_request_id::text, 1, 8) || '-' || p_attempt_token::text
    ELSE 'g014-session-' || pg_catalog.substr(p_request_id::text, 1, 8) || '-' || p_attempt_token::text
  END;

  UPDATE privacy_retention.account_deletion_external_job_attempts
  SET state = 'egress_unknown', unknown_outcome_at = pg_catalog.clock_timestamp()
  WHERE attempt_token = p_attempt_token;
  UPDATE privacy_retention.account_deletion_external_jobs
  SET state = 'egress_unknown', updated_at = pg_catalog.clock_timestamp()
  WHERE request_id = p_request_id AND phase = p_phase;
  INSERT INTO privacy_retention.account_deletion_external_job_checkpoints (
    request_id, phase, attempt_token, checkpoint_kind, checkpoint_state, proof_hash
  ) VALUES (
    p_request_id, p_phase, p_attempt_token, 'egress_unknown', 'unknown',
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.concat_ws(
          ':',
          'g014-egress-unknown:v4',
          p_request_id::text,
          p_phase,
          p_attempt_token::text,
          COALESCE(v_attempt.storage_object_locator_hash, '<none>'),
          COALESCE(v_attempt.storage_object_version_hash, '<none>'),
          COALESCE(v_attempt.storage_object_id::text, '<none>'),
          COALESCE(v_attempt.storage_object_version, '<none>')
        ),
        'sha256'
      ),
      'hex'
    )
  );

  RETURN QUERY SELECT p_request_id, p_phase, p_attempt_token, 'egress_unknown',
    v_key, v_attempt.lease_expires_at, p_source_manifest_hash;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_account_deletion_storage_work(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_attempt_token uuid
)
RETURNS TABLE (
  bucket_id text,
  object_name text,
  object_id uuid,
  object_version text,
  object_locator_hash text,
  object_version_hash text,
  provider_idempotency_key text,
  work_state text,
  work_mode text,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_attempt privacy_retention.account_deletion_external_job_attempts%ROWTYPE;
  v_mode text;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_assert_external_job_binding(
    p_actor_user_id, p_target_user_id, p_request_id, p_preview_hash,
    p_idempotency_key, p_source_manifest_hash, 'storage', p_attempt_token, false
  );
  SELECT * INTO v_attempt
  FROM privacy_retention.account_deletion_external_job_attempts
  WHERE attempt_token = p_attempt_token
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_deletion_storage_work_not_prepared' USING ERRCODE = '55000';
  END IF;

  IF v_attempt.state IN ('egress_unknown', 'reconciliation_required') THEN
    v_mode := 'verify_absence_only';
  ELSIF v_attempt.state = 'leased' THEN
    PERFORM privacy_retention.g014_account_deletion_assert_external_job_binding(
      p_actor_user_id, p_target_user_id, p_request_id, p_preview_hash,
      p_idempotency_key, p_source_manifest_hash, 'storage', p_attempt_token, true
    );
    v_mode := 'delete_then_verify';
  ELSE
    RAISE EXCEPTION 'account_deletion_storage_work_not_prepared' USING ERRCODE = '55000';
  END IF;

  IF v_attempt.storage_object_locator_hash IS NULL THEN
    RETURN;
  END IF;

  IF v_mode = 'verify_absence_only' THEN
    RETURN QUERY
    SELECT
      NULL::text,
      NULL::text,
      captured.object_id,
      captured.object_version,
      captured.object_locator_hash,
      captured.object_version_hash,
      'g014-storage-' || pg_catalog.substr(p_request_id::text, 1, 8)
        || '-' || p_attempt_token::text
        || '-' || pg_catalog.substr(captured.object_locator_hash, 1, 40),
      v_mode,
      v_mode,
      p_source_manifest_hash
    FROM privacy_retention.account_deletion_storage_objects AS captured
    WHERE captured.request_id = p_request_id
      AND captured.object_locator_hash = v_attempt.storage_object_locator_hash
      AND captured.object_version_hash = v_attempt.storage_object_version_hash
      AND captured.object_id = v_attempt.storage_object_id
      AND captured.object_version = v_attempt.storage_object_version;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    object_row.bucket_id::text,
    object_row.name::text,
    captured.object_id,
    captured.object_version,
    captured.object_locator_hash,
    captured.object_version_hash,
    'g014-storage-' || pg_catalog.substr(p_request_id::text, 1, 8)
      || '-' || p_attempt_token::text
      || '-' || pg_catalog.substr(captured.object_locator_hash, 1, 40),
    v_mode,
    v_mode,
    p_source_manifest_hash
  FROM privacy_retention.account_deletion_storage_objects AS captured
  JOIN storage.objects AS object_row
    ON object_row.id = captured.object_id
   AND pg_catalog.to_jsonb(object_row) ->> 'version' = captured.object_version
  WHERE captured.request_id = p_request_id
    AND captured.object_locator_hash = v_attempt.storage_object_locator_hash
    AND captured.object_version_hash = v_attempt.storage_object_version_hash
    AND captured.object_id = v_attempt.storage_object_id
    AND captured.object_version = v_attempt.storage_object_version
    AND object_row.owner_id::text = p_target_user_id::text;
END;
$function$;

CREATE OR REPLACE FUNCTION public.reconcile_account_deletion_storage_job(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_request_id uuid,
  p_preview_hash text,
  p_idempotency_key text,
  p_source_manifest_hash text,
  p_attempt_token uuid
)
RETURNS TABLE (
  request_id uuid,
  status text,
  storage_readback_passed boolean,
  job_state text,
  expected_work_count integer,
  provider_proof_count integer,
  source_manifest_hash text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_request public.account_deletion_requests%ROWTYPE;
  v_attempt privacy_retention.account_deletion_external_job_attempts%ROWTYPE;
  v_object_absent boolean;
  v_object_proved boolean;
  v_expected_count integer;
  v_proof_count integer;
  v_job_state text;
BEGIN
  PERFORM privacy_retention.g014_account_deletion_assert_external_job_binding(
    p_actor_user_id, p_target_user_id, p_request_id, p_preview_hash,
    p_idempotency_key, p_source_manifest_hash, 'storage', p_attempt_token, false
  );
  SELECT * INTO v_attempt
  FROM privacy_retention.account_deletion_external_job_attempts
  WHERE attempt_token = p_attempt_token
  FOR UPDATE;
  IF NOT FOUND
     OR v_attempt.state NOT IN ('egress_unknown', 'reconciliation_required') THEN
    RAISE EXCEPTION 'account_deletion_storage_reconcile_not_prepared'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO v_expected_count
  FROM privacy_retention.account_deletion_storage_objects
  WHERE request_id = p_request_id;
  SELECT count(*) INTO v_proof_count
  FROM privacy_retention.account_deletion_external_job_provider_proofs
  WHERE request_id = p_request_id AND phase = 'storage';

  IF v_attempt.storage_object_locator_hash IS NULL THEN
    SELECT NOT EXISTS (
      SELECT 1 FROM storage.objects
      WHERE owner_id::text = p_target_user_id::text
    ) INTO v_object_absent;
    SELECT v_proof_count = v_expected_count INTO v_object_proved;
  ELSE
    SELECT NOT EXISTS (
      SELECT 1
      FROM storage.objects AS object_row
      WHERE object_row.owner_id::text = p_target_user_id::text
        AND object_row.id = v_attempt.storage_object_id
        AND pg_catalog.to_jsonb(object_row) ->> 'version'
            = v_attempt.storage_object_version
    ) INTO v_object_absent;
    SELECT EXISTS (
      SELECT 1
      FROM privacy_retention.account_deletion_external_job_provider_proofs AS proof
      WHERE proof.request_id = p_request_id
        AND proof.phase = 'storage'
        AND proof.attempt_token = p_attempt_token
        AND proof.object_locator_hash = v_attempt.storage_object_locator_hash
        AND proof.object_version_hash = v_attempt.storage_object_version_hash
        AND proof.object_id = v_attempt.storage_object_id
        AND proof.object_version = v_attempt.storage_object_version
    ) INTO v_object_proved;
  END IF;

  IF v_object_absent AND v_object_proved THEN
    v_request := privacy_retention.g014_account_deletion_complete_external_job_phase(
      p_request_id, 'storage', p_attempt_token
    );
    SELECT state INTO v_job_state
    FROM privacy_retention.account_deletion_external_jobs
    WHERE request_id = p_request_id AND phase = 'storage';
    RETURN QUERY SELECT v_request.id, v_request.status, v_request.storage_readback_passed,
      v_job_state, v_expected_count, v_proof_count, v_request.source_manifest_hash;
    RETURN;
  END IF;

  UPDATE privacy_retention.account_deletion_external_job_attempts
  SET state = 'reconciliation_required', reconciled_at = pg_catalog.clock_timestamp()
  WHERE attempt_token = p_attempt_token
    AND state IN ('egress_unknown', 'reconciliation_required');
  UPDATE privacy_retention.account_deletion_external_jobs
  SET state = 'reconciliation_required',
      current_attempt_token = p_attempt_token,
      updated_at = pg_catalog.clock_timestamp()
  WHERE request_id = p_request_id AND phase = 'storage';

  SELECT * INTO v_request
  FROM public.account_deletion_requests
  WHERE id = p_request_id;
  RETURN QUERY SELECT v_request.id, v_request.status, false,
    'reconciliation_required', v_expected_count, v_proof_count, v_request.source_manifest_hash;
END;
$function$;

CREATE OR REPLACE FUNCTION privacy_retention.g014_account_deletion_storage_write_fence()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_new_owner_id text := NEW.owner_id::text;
  v_old_owner_id text;
  v_object_id uuid := NEW.id;
  v_owner_id text;
  v_owner_uuid uuid;
  v_lifecycle_seen boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    v_old_owner_id := OLD.owner_id::text;
    v_object_id := COALESCE(NEW.id, OLD.id);
  END IF;

  FOR v_owner_id IN
    SELECT DISTINCT owner_row.owner_id
    FROM (VALUES (v_new_owner_id), (v_old_owner_id)) AS owner_row(owner_id)
    WHERE owner_row.owner_id IS NOT NULL
      AND owner_row.owner_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ORDER BY owner_row.owner_id
  LOOP
    v_owner_uuid := v_owner_id::uuid;
    SELECT EXISTS (
      SELECT 1
      FROM public.account_deletion_requests AS request_row
      WHERE request_row.target_user_id = v_owner_uuid
        AND request_row.status IN ('previewed', 'applying', 'partial')
    ) INTO v_lifecycle_seen;

    PERFORM privacy_retention.g014_account_deletion_lock_target(v_owner_uuid);

    IF v_lifecycle_seen OR EXISTS (
      SELECT 1
      FROM public.account_deletion_requests AS request_row
      WHERE request_row.target_user_id = v_owner_uuid
        AND request_row.status IN ('previewed', 'applying', 'partial')
    ) THEN
      RAISE EXCEPTION 'account_deletion_storage_owner_write_fenced'
        USING ERRCODE = '55000';
    END IF;
  END LOOP;

  IF v_object_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM privacy_retention.account_deletion_storage_objects AS captured
    JOIN privacy_retention.account_deletion_external_jobs AS job
      ON job.request_id = captured.request_id
     AND job.phase = 'storage'
    WHERE job.state IN ('pending', 'leased', 'egress_unknown', 'reconciliation_required')
      AND captured.object_id = v_object_id
  ) THEN
    RAISE EXCEPTION 'account_deletion_storage_object_write_fenced'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$function$;

ALTER FUNCTION privacy_retention.g014_account_deletion_claim_storage_object(uuid,uuid)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_account_deletion_claim_storage_object(uuid,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION privacy_retention.g014_account_deletion_reconcile_expired_attempt(uuid,text,uuid)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_account_deletion_reconcile_expired_attempt(uuid,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION privacy_retention.g014_account_deletion_complete_external_job_phase(uuid,text,uuid)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_account_deletion_complete_external_job_phase(uuid,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION privacy_retention.g014_account_deletion_storage_write_fence()
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION privacy_retention.g014_account_deletion_storage_write_fence()
  FROM PUBLIC, anon, authenticated, service_role;
DROP INDEX IF EXISTS privacy_retention.g014_account_deletion_one_storage_job_proof_idx;
CREATE UNIQUE INDEX g014_account_deletion_one_storage_job_proof_idx
  ON privacy_retention.account_deletion_external_job_provider_proofs (
    request_id, phase, object_locator_hash, object_version_hash, object_id, object_version
  )
  WHERE phase = 'storage';
SELECT privacy_retention.assert_g014_public_rpc_allowlist();
