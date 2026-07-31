-- G038 deterministic contract (P1)
--
-- Authority: G007 final SHA d99ceb632c976bc7c2388b1c7f95571c8b7429a14e7915a9cc09d8aaa99842a4,
-- normative clause A (complete reserve ABI). Inventory: G005 source SHA
-- 18b473ebc39da27845a1a88664ed191b90f613a7a90255da03e1aafb2c1e1b8a line 59.
-- Frozen manifest: stage-06-revision.md SHA
-- edb9ed0f637249581587e8703086a90954459b735a0e4821997acbc423756089.
--
-- Extension declaration (frozen clause 4): this file requires NO extension.
-- The only hash primitive used is pg_catalog.sha256(bytea), a PostgreSQL 11+
-- built-in. pgcrypto is deliberately NOT declared, because depending on it
-- would add an unnecessary install-time requirement. pg_catalog is implicitly
-- searched even under search_path='', and every non-catalog reference below is
-- explicitly schema-qualified.
--
-- Scope (frozen clause 5): no scheduler/cron job is created. TTL fencing is
-- expression- and constraint-based only, so no shared_preload_libraries
-- requirement is introduced.
--
-- Scope (frozen clause 6): no protected origin, hosted project reference,
-- credential, key, token, brokerUrl, or jwksUrl literal appears in this file.

BEGIN;

-- ---------------------------------------------------------------------------
-- Roles (frozen clause 3): create every role this file references, guarded.
-- This file deliberately references neither anon, authenticated, nor
-- service_role, because a bare disposable database does not ship them and
-- referencing one would abort under ON_ERROR_STOP=1.
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'privacy_workflow_owner') THEN
    CREATE ROLE privacy_workflow_owner NOLOGIN;
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'g038_route_adapter') THEN
    CREATE ROLE g038_route_adapter NOLOGIN;
  END IF;
END
$$;
-- PostgreSQL requires the migration actor to be a member of a role before
-- transferring object ownership to it. Keep that authority only for the
-- ownership handoff; the membership is revoked below in the same transaction.
DO $membership$
BEGIN
  EXECUTE pg_catalog.format(
    'GRANT privacy_workflow_owner TO %I',
    pg_catalog.current_user
  );
END
$membership$;


-- ---------------------------------------------------------------------------
-- Commitment storage.
--
-- Cryptographic columns are stored but are never projected by the reserve
-- function: normative clause A restricts output to exactly six metadata
-- columns. Replay crypto equality is proven by the constraints below and by
-- checkout validation, not by function output.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.g038_deletion_commitment (
  commitment_id               uuid        PRIMARY KEY,
  assertion_id                uuid        NOT NULL,
  actor_user_id               uuid        NOT NULL,
  target_user_id              uuid        NOT NULL,
  request_id                  uuid        NOT NULL,
  session_id                  uuid        NOT NULL,
  proof_id                    uuid        NOT NULL,
  preview_hash                text        NOT NULL,
  confirmation_text           text        NOT NULL,
  idempotency_key             text        NOT NULL,
  source_manifest_hash        text        NOT NULL,
  confirmation_digest         bytea       NOT NULL,
  idempotency_key_digest      bytea       NOT NULL,
  actor_assertion_digest      bytea       NOT NULL,
  assertion_root_head_sha256  bytea       NOT NULL,
  hmac_head_sha256            bytea       NOT NULL,
  assertion_nonce             uuid        NOT NULL,
  request_digest              bytea       NOT NULL,
  preflight_id                uuid        NOT NULL,
  expires_at                  timestamptz NOT NULL,
  status                      text        NOT NULL,
  mode                        text        NOT NULL,
  response_status             smallint    NOT NULL,
  response_body_sha256        bytea       NOT NULL,
  ciphertext_schema           text        NOT NULL,
  key_reference               text        NOT NULL,
  algorithm                   text        NOT NULL,
  nonce                       bytea       NOT NULL,
  aad                         bytea       NOT NULL,
  aad_sha256                  bytea       NOT NULL,
  ciphertext                  bytea       NOT NULL,
  auth_tag                    bytea       NOT NULL,
  created_at                  timestamptz NOT NULL DEFAULT pg_catalog.now(),

  CONSTRAINT g038_commitment_status_exact
    CHECK (status IN ('AVAILABLE', 'CHECKED_OUT', 'DISPOSED')),
  CONSTRAINT g038_commitment_mode_exact
    CHECK (mode = 'V1_COMPAT'),
  CONSTRAINT g038_commitment_response_status_exact
    CHECK (response_status = 200),

  -- Fixed cryptographic strings. The G005 source declares these as column-level
  -- CHECK constraints with exactly these literals:
  --   ciphertext_schema text NOT NULL CHECK(ciphertext_schema='G038-PREFLIGHT-REPLAY-CIPHERTEXT-V1')
  --   key_reference     text NOT NULL CHECK(key_reference='g038_preflight_replay_aead_v1')
  --   algorithm         text NOT NULL CHECK(algorithm='AES-256-GCM')
  -- and its reserve clause requires "fixed strings" on CREATE. These are
  -- storage-level invariants, not merely runtime validation, so a wrong value
  -- cannot be persisted even if the function body were bypassed.
  --
  -- Frozen clause 6 (no protected origin, hosted reference, credential, key,
  -- token, brokerUrl or jwksUrl literal) is not engaged by any of the three.
  -- `ciphertext_schema` is a schema name and `algorithm` is an algorithm name,
  -- so those two are trivially clear. `key_reference` is neither a schema name
  -- nor an algorithm name, and calling it one would be sloppy: it is a
  -- non-exportable LOGICAL ALIAS for a key, not key material and not a
  -- location. It carries no secret, no origin, and no host. It is also absent
  -- from the G005 WorkloadCredential family (brokerUrl,
  -- workloadCredentialReference, credentialKeyId, issuer, audience, jwksUrl,
  -- jwksSha256), which is the set clause 6 actually targets. Resolving the
  -- alias to a usable key requires the broker, which this contract never
  -- reaches.
  CONSTRAINT g038_commitment_ciphertext_schema_exact
    CHECK (ciphertext_schema = 'G038-PREFLIGHT-REPLAY-CIPHERTEXT-V1'),
  CONSTRAINT g038_commitment_key_reference_exact
    CHECK (key_reference = 'g038_preflight_replay_aead_v1'),
  CONSTRAINT g038_commitment_algorithm_exact
    CHECK (algorithm = 'AES-256-GCM'),

  -- 32-byte digests carried from arguments 01-18.
  CONSTRAINT g038_commitment_confirmation_digest_len
    CHECK (pg_catalog.octet_length(confirmation_digest) = 32),
  CONSTRAINT g038_commitment_idempotency_digest_len
    CHECK (pg_catalog.octet_length(idempotency_key_digest) = 32),
  CONSTRAINT g038_commitment_actor_assertion_digest_len
    CHECK (pg_catalog.octet_length(actor_assertion_digest) = 32),
  CONSTRAINT g038_commitment_assertion_root_head_len
    CHECK (pg_catalog.octet_length(assertion_root_head_sha256) = 32),
  CONSTRAINT g038_commitment_hmac_head_len
    CHECK (pg_catalog.octet_length(hmac_head_sha256) = 32),
  CONSTRAINT g038_commitment_request_digest_len
    CHECK (pg_catalog.octet_length(request_digest) = 32),

  -- CREATE-phase cryptographic bounds.
  CONSTRAINT g038_commitment_response_body_sha256_len
    CHECK (pg_catalog.octet_length(response_body_sha256) = 32),
  CONSTRAINT g038_commitment_aad_sha256_len
    CHECK (pg_catalog.octet_length(aad_sha256) = 32),
  -- AEAD nonce uniqueness. The G005 source declares this column as
  --   nonce bytea NOT NULL UNIQUE CHECK(octet_length(nonce)=12)
  -- i.e. UNIQUE and the length CHECK together, in the same column-list block
  -- that supplies the three fixed-string CHECKs above. Adopting 202-204 as
  -- binding while treating 205's UNIQUE as optional would be cherry-picking one
  -- authority block.
  --
  -- It is also the load-bearing one: reusing a nonce under a fixed key is
  -- catastrophic for AES-256-GCM, breaking both confidentiality and
  -- authenticity. A length check alone does not prevent reuse. This is a
  -- storage-level invariant so reuse cannot be persisted even if the function
  -- body were bypassed.
  CONSTRAINT g038_commitment_nonce_len
    CHECK (pg_catalog.octet_length(nonce) = 12),
  CONSTRAINT g038_commitment_nonce_unique
    UNIQUE (nonce),
  CONSTRAINT g038_commitment_auth_tag_len
    CHECK (pg_catalog.octet_length(auth_tag) = 16),
  CONSTRAINT g038_commitment_aad_bounds
    CHECK (pg_catalog.octet_length(aad) BETWEEN 1 AND 4096),
  CONSTRAINT g038_commitment_ciphertext_bounds
    CHECK (pg_catalog.octet_length(ciphertext) BETWEEN 1 AND 8192),

  -- AAD hash binding is a stored invariant, not a runtime-only check.
  CONSTRAINT g038_commitment_aad_hash_binding
    CHECK (aad_sha256 = pg_catalog.sha256(aad))
);

-- Idempotency scope is a PARTIAL unique index, restricted to AVAILABLE rows:
-- exactly one live commitment per actor/target/request/key tuple.
--
-- Rationale, following the G005 source's own pattern for this class ("A partial
-- unique index on assertion where ACTIVE permits one ACTIVE checkout"): the
-- replay lookup below matches only status = 'AVAILABLE', so an unconditional
-- unique index would let a DISPOSED or otherwise terminal row with the same
-- tuple be skipped by the replay SELECT and then collide on INSERT, surfacing a
-- raw unique violation instead of a defined outcome. Restricting the index to
-- AVAILABLE keeps exactly one live commitment per idempotency scope while
-- allowing a fresh commitment after a terminal one.
--
-- The predicate is deliberately immutable (status only). expires_at > now() is
-- not index-legal, so an AVAILABLE-but-expired row remains in the index; that
-- residual case and the concurrent-CREATE race are both mapped to a defined
-- result by the unique_violation handler in the function body rather than
-- escaping as a raw SQLSTATE.
CREATE UNIQUE INDEX IF NOT EXISTS g038_commitment_idempotency_scope
  ON public.g038_deletion_commitment
  (actor_user_id, target_user_id, request_id, idempotency_key_digest)
  WHERE status = 'AVAILABLE';

CREATE TABLE IF NOT EXISTS public.g038_deletion_route (
  route_id      uuid  PRIMARY KEY,
  commitment_id uuid  NOT NULL
                      REFERENCES public.g038_deletion_commitment (commitment_id)
                      ON DELETE RESTRICT,
  route_kind    text  NOT NULL,
  secret_digest bytea NOT NULL,

  CONSTRAINT g038_route_kind_exact
    CHECK (route_kind IN ('POLL', 'RECEIPT', 'RECOVERY', 'CLEANUP')),
  CONSTRAINT g038_route_secret_digest_len
    CHECK (pg_catalog.octet_length(secret_digest) = 32),
  CONSTRAINT g038_route_kind_unique_per_commitment
    UNIQUE (commitment_id, route_kind)
);

-- ---------------------------------------------------------------------------
-- Reserve function: exactly one non-overloaded 39-input signature, in the
-- exact ordinal order of normative clause A. No argument carries a default,
-- so no omitted positional suffix and no omitted PostgREST named argument is
-- accepted.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.g038_reserve_account_deletion_commitment(
  p_phase                       text,
  p_assertion_id                uuid,
  p_actor_user_id               uuid,
  p_target_user_id              uuid,
  p_request_id                  uuid,
  p_session_id                  uuid,
  p_proof_id                    uuid,
  p_preview_hash                text,
  p_confirmation_text           text,
  p_idempotency_key             text,
  p_source_manifest_hash        text,
  p_confirmation_digest         bytea,
  p_idempotency_key_digest      bytea,
  p_actor_assertion_digest      bytea,
  p_assertion_root_head_sha256  bytea,
  p_hmac_head_sha256            bytea,
  p_assertion_nonce             uuid,
  p_request_digest              bytea,
  p_preflight_id                uuid,
  p_commitment_id               uuid,
  p_commitment_expires_at       timestamptz,
  p_poll_route_id               uuid,
  p_poll_secret_digest          bytea,
  p_receipt_route_id            uuid,
  p_receipt_secret_digest       bytea,
  p_recovery_route_id           uuid,
  p_recovery_secret_digest      bytea,
  p_cleanup_route_id            uuid,
  p_cleanup_secret_digest       bytea,
  p_response_status             smallint,
  p_response_body_sha256        bytea,
  p_ciphertext_schema           text,
  p_key_reference               text,
  p_algorithm                   text,
  p_nonce                       bytea,
  p_aad                         bytea,
  p_aad_sha256                  bytea,
  p_ciphertext                  bytea,
  p_auth_tag                    bytea
)
RETURNS TABLE(
  result                text,
  commitment_id         uuid,
  expires_at            timestamptz,
  mode                  text,
  response_status       smallint,
  response_body_sha256  bytea
)
LANGUAGE plpgsql
SECURITY DEFINER
VOLATILE
SET search_path = ''
AS $function$
DECLARE
  v_existing   public.g038_deletion_commitment;
  v_route_match integer;
BEGIN
  -- Phase discriminator. Any other or null value rejects with zero writes.
  IF p_phase IS NULL OR p_phase NOT IN ('LOOKUP', 'CREATE') THEN
    RAISE EXCEPTION 'g038_invalid_phase' USING ERRCODE = '22023';
  END IF;

  -- Arguments 01-18 are NOT NULL in both phases.
  IF p_assertion_id IS NULL
     OR p_actor_user_id IS NULL
     OR p_target_user_id IS NULL
     OR p_request_id IS NULL
     OR p_session_id IS NULL
     OR p_proof_id IS NULL
     OR p_preview_hash IS NULL
     OR p_confirmation_text IS NULL
     OR p_idempotency_key IS NULL
     OR p_source_manifest_hash IS NULL
     OR p_confirmation_digest IS NULL
     OR p_idempotency_key_digest IS NULL
     OR p_actor_assertion_digest IS NULL
     OR p_assertion_root_head_sha256 IS NULL
     OR p_hmac_head_sha256 IS NULL
     OR p_assertion_nonce IS NULL
     OR p_request_digest IS NULL THEN
    RAISE EXCEPTION 'g038_required_input_null' USING ERRCODE = '22023';
  END IF;

  -- Every digest-valued bytea among arguments 01-18 is exactly 32 bytes.
  IF pg_catalog.octet_length(p_confirmation_digest) <> 32
     OR pg_catalog.octet_length(p_idempotency_key_digest) <> 32
     OR pg_catalog.octet_length(p_actor_assertion_digest) <> 32
     OR pg_catalog.octet_length(p_assertion_root_head_sha256) <> 32
     OR pg_catalog.octet_length(p_hmac_head_sha256) <> 32
     OR pg_catalog.octet_length(p_request_digest) <> 32 THEN
    RAISE EXCEPTION 'g038_digest_length_invalid' USING ERRCODE = '22023';
  END IF;

  -- LOCK LADDER DIVERGENCE, recorded explicitly so it reads as decided rather
  -- than overlooked.
  --
  -- The G005 source requires LOOKUP to take pg_advisory_xact_lock in the
  -- final-G004 order, then FOR KEY SHARE on immutable heads, then FOR SHARE on
  -- assertion / proof / binding / commitment / replay; and CREATE to take that
  -- same prefix and then FOR UPDATE "as applicable". This file takes no lock at
  -- all, and that needs justifying rather than passing in silence.
  --
  -- Most of the named relations are genuinely out of scope here: this migration
  -- creates exactly two tables (g038_deletion_commitment and
  -- g038_deletion_route). There is no assertion relation, no proof relation, no
  -- binding relation, no immutable-head relation and no separate replay
  -- relation for a lock to be taken on, so for those the ladder is vacuous and
  -- "as applicable" applies straightforwardly.
  --
  -- The two relations that DO exist are read with bare SELECTs. That is the
  -- real divergence. It is deliberate: correctness here is arbitrated by the
  -- partial unique index on the idempotency scope and by
  -- g038_commitment_nonce_unique, not by lock ordering. A concurrent racer
  -- cannot produce a second live commitment in the same scope or reuse a nonce,
  -- because the index rejects it and the unique_violation handler maps the
  -- rejection to a defined result. Taking FOR SHARE on a row the racer has not
  -- inserted yet would not prevent the race either -- there is no row to lock.
  --
  -- Consequence, stated rather than hidden: the loser of a concurrent CREATE
  -- learns this at INSERT time (409) instead of at lock-acquisition time. The
  -- outcome is identical and no durable write occurs on the losing path.
  --
  -- Phase 2b owns confirming this against the full G005 ladder once the
  -- remaining relations exist. Until then the divergence is scoped to the two
  -- relations above and recorded in H5 openForPhase2b.
  IF p_phase = 'LOOKUP' THEN
    -- Arguments 19-39 must each be explicitly SQL NULL. Supplying any
    -- candidate or cryptographic argument rejects with zero writes.
    IF p_preflight_id IS NOT NULL
       OR p_commitment_id IS NOT NULL
       OR p_commitment_expires_at IS NOT NULL
       OR p_poll_route_id IS NOT NULL
       OR p_poll_secret_digest IS NOT NULL
       OR p_receipt_route_id IS NOT NULL
       OR p_receipt_secret_digest IS NOT NULL
       OR p_recovery_route_id IS NOT NULL
       OR p_recovery_secret_digest IS NOT NULL
       OR p_cleanup_route_id IS NOT NULL
       OR p_cleanup_secret_digest IS NOT NULL
       OR p_response_status IS NOT NULL
       OR p_response_body_sha256 IS NOT NULL
       OR p_ciphertext_schema IS NOT NULL
       OR p_key_reference IS NOT NULL
       OR p_algorithm IS NOT NULL
       OR p_nonce IS NOT NULL
       OR p_aad IS NOT NULL
       OR p_aad_sha256 IS NOT NULL
       OR p_ciphertext IS NOT NULL
       OR p_auth_tag IS NOT NULL THEN
      RAISE EXCEPTION 'g038_lookup_forbidden_nonnull' USING ERRCODE = '22023';
    END IF;

    SELECT c.* INTO v_existing
    FROM public.g038_deletion_commitment AS c
    WHERE c.actor_user_id = p_actor_user_id
      AND c.target_user_id = p_target_user_id
      AND c.request_id = p_request_id
      AND c.idempotency_key_digest = p_idempotency_key_digest
      AND c.status = 'AVAILABLE'
      AND c.expires_at > pg_catalog.now();

    IF NOT FOUND THEN
      -- CREATE_REQUIRED: remaining five projection columns are SQL NULL.
      RETURN QUERY
        SELECT 'CREATE_REQUIRED'::text,
               NULL::uuid,
               NULL::timestamptz,
               NULL::text,
               NULL::smallint,
               NULL::bytea;
      RETURN;
    END IF;

    -- REPLAY: the retained AVAILABLE metadata projection, no crypto bytes.
    RETURN QUERY
      SELECT 'REPLAY'::text,
             v_existing.commitment_id,
             v_existing.expires_at,
             v_existing.mode,
             v_existing.response_status,
             v_existing.response_body_sha256;
    RETURN;
  END IF;

  -- p_phase = 'CREATE': arguments 19-39 are each NOT NULL.
  IF p_preflight_id IS NULL
     OR p_commitment_id IS NULL
     OR p_commitment_expires_at IS NULL
     OR p_poll_route_id IS NULL
     OR p_poll_secret_digest IS NULL
     OR p_receipt_route_id IS NULL
     OR p_receipt_secret_digest IS NULL
     OR p_recovery_route_id IS NULL
     OR p_recovery_secret_digest IS NULL
     OR p_cleanup_route_id IS NULL
     OR p_cleanup_secret_digest IS NULL
     OR p_response_status IS NULL
     OR p_response_body_sha256 IS NULL
     OR p_ciphertext_schema IS NULL
     OR p_key_reference IS NULL
     OR p_algorithm IS NULL
     OR p_nonce IS NULL
     OR p_aad IS NULL
     OR p_aad_sha256 IS NULL
     OR p_ciphertext IS NULL
     OR p_auth_tag IS NULL THEN
    RAISE EXCEPTION 'g038_create_required_input_null' USING ERRCODE = '22023';
  END IF;

  -- CREATE-phase byte bounds.
  IF pg_catalog.octet_length(p_poll_secret_digest) <> 32
     OR pg_catalog.octet_length(p_receipt_secret_digest) <> 32
     OR pg_catalog.octet_length(p_recovery_secret_digest) <> 32
     OR pg_catalog.octet_length(p_cleanup_secret_digest) <> 32
     OR pg_catalog.octet_length(p_response_body_sha256) <> 32
     OR pg_catalog.octet_length(p_aad_sha256) <> 32
     OR pg_catalog.octet_length(p_nonce) <> 12
     OR pg_catalog.octet_length(p_auth_tag) <> 16
     OR pg_catalog.octet_length(p_aad) NOT BETWEEN 1 AND 4096
     OR pg_catalog.octet_length(p_ciphertext) NOT BETWEEN 1 AND 8192 THEN
    RAISE EXCEPTION 'g038_create_byte_bounds_invalid' USING ERRCODE = '22023';
  END IF;

  -- Candidate identifier validity: the six candidate UUIDs must be nonnil and
  -- pairwise distinct within the candidate.
  --
  -- G005's CREATE clause requires the candidate identifiers to be nonnil and
  -- pairwise distinct, and clause A carries scoped candidate uniqueness forward
  -- as binding. Neither was checked here before.
  --
  -- Without this guard the failures are real but misclassified. Two equal
  -- supplied route ids trip the route_id primary key INSIDE the sub-block,
  -- enter the unique_violation handler, find no live row for the scope, and
  -- re-raise as 23505 -> 409 -- yet this is a malformed caller input, which
  -- every other input defect in this body reports as 400-class 22023. And a nil
  -- all-zero UUID was accepted outright before this guard existed: it is NOT
  -- NULL, so the nullability checks pass, and nothing else rejected it. The
  -- guard below is what rejects it now.
  --
  -- The six are ordinals 19, 20, 22, 24, 26 and 28: p_preflight_id,
  -- p_commitment_id, and the four route ids. Pairwise distinctness is tested by
  -- comparing the array length against its DISTINCT cardinality, which is
  -- equivalent to all-pairs comparison for six values and does not enumerate
  -- fifteen predicates.
  IF p_preflight_id      = '00000000-0000-0000-0000-000000000000'::uuid
     OR p_commitment_id   = '00000000-0000-0000-0000-000000000000'::uuid
     OR p_poll_route_id   = '00000000-0000-0000-0000-000000000000'::uuid
     OR p_receipt_route_id = '00000000-0000-0000-0000-000000000000'::uuid
     OR p_recovery_route_id = '00000000-0000-0000-0000-000000000000'::uuid
     OR p_cleanup_route_id  = '00000000-0000-0000-0000-000000000000'::uuid
     OR (
       SELECT pg_catalog.count(DISTINCT u)
       FROM pg_catalog.unnest(ARRAY[
         p_preflight_id, p_commitment_id, p_poll_route_id,
         p_receipt_route_id, p_recovery_route_id, p_cleanup_route_id
       ]) AS u
     ) <> 6 THEN
    RAISE EXCEPTION 'g038_candidate_identifier_invalid' USING ERRCODE = '22023';
  END IF;

  -- Fixed literals: status 200, and the three fixed cryptographic strings.
  --
  -- The storage CHECKs added alongside the column declarations are defence in
  -- depth, but they are not sufficient on their own: a wrong value would reach
  -- the INSERT and raise 23514 (check_violation), which is in neither the
  -- accepted 400-class mapping nor the 23505 -> 409 mapping, so it would
  -- surface unmapped. Every other 400-class rejection in this body raises
  -- 22023, so these three are validated here to the same class, before any
  -- durable write. The CHECKs remain as storage invariants.
  IF p_response_status <> 200::smallint THEN
    RAISE EXCEPTION 'g038_response_status_not_200' USING ERRCODE = '22023';
  END IF;

  IF p_ciphertext_schema IS DISTINCT FROM 'G038-PREFLIGHT-REPLAY-CIPHERTEXT-V1'
     OR p_key_reference   IS DISTINCT FROM 'g038_preflight_replay_aead_v1'
     OR p_algorithm       IS DISTINCT FROM 'AES-256-GCM' THEN
    RAISE EXCEPTION 'g038_fixed_string_invalid' USING ERRCODE = '22023';
  END IF;

  -- AAD reconstruction hash must bind.
  IF p_aad_sha256 <> pg_catalog.sha256(p_aad) THEN
    RAISE EXCEPTION 'g038_aad_hash_mismatch' USING ERRCODE = '22023';
  END IF;

  -- Expiry must be in the future at commit time (TTL fencing, no scheduler).
  IF p_commitment_expires_at <= pg_catalog.now() THEN
    RAISE EXCEPTION 'g038_expiry_not_future' USING ERRCODE = '22023';
  END IF;

  -- Replay before insert: an AVAILABLE unexpired commitment wins, but ONLY if
  -- the supplied bytes equal the retained bytes.
  --
  -- G005 source, replay/conflict mapping: "Replay: unequal retained
  -- request/capability/kind/route/bytes 409; equal retained success." and
  -- "Equal replay is no-write; partial/reordered/stale/unequal is zero-write."
  --
  -- Matching the idempotency scope alone is NOT sufficient to return REPLAY. If
  -- a caller reuses the same actor/target/request/key tuple but supplies
  -- different candidate or cryptographic bytes, reporting REPLAY would tell it
  -- its own ciphertext was committed when a different ciphertext is in fact
  -- retained. That is a conflict, not a success.
  SELECT c.* INTO v_existing
  FROM public.g038_deletion_commitment AS c
  WHERE c.actor_user_id = p_actor_user_id
    AND c.target_user_id = p_target_user_id
    AND c.request_id = p_request_id
    AND c.idempotency_key_digest = p_idempotency_key_digest
    AND c.status = 'AVAILABLE'
    AND c.expires_at > pg_catalog.now();

  IF FOUND THEN
    -- Byte equality over the supplied identity, candidate and cryptographic
    -- values that a retained row can carry.
    --
    -- Accounting, so this list is not read as exhaustive by accident. Of the 39
    -- inputs: 1 is p_phase (the discriminator, not stored); 4 are the scope key
    -- itself (actor, target, request, idempotency_key_digest) and are already
    -- equal by the SELECT predicate above; 24 are compared field-by-field
    -- below; 4 are the route secret digests, which live on the ROUTE table
    -- rather than on the commitment row and are therefore compared by the
    -- separate route query after this block; and 6 are deliberately excluded --
    -- p_commitment_id, p_commitment_expires_at and the four route ids -- because
    -- clause A specifies REPLAY returns the RETAINED projection, so a retry may
    -- legitimately supply freshly generated ids and the retained ones remain
    -- authoritative. 1 + 4 + 24 + 4 + 6 = 39.
    IF v_existing.assertion_id            IS DISTINCT FROM p_assertion_id
       OR v_existing.session_id           IS DISTINCT FROM p_session_id
       OR v_existing.proof_id             IS DISTINCT FROM p_proof_id
       OR v_existing.preview_hash         IS DISTINCT FROM p_preview_hash
       OR v_existing.confirmation_text    IS DISTINCT FROM p_confirmation_text
       OR v_existing.idempotency_key      IS DISTINCT FROM p_idempotency_key
       OR v_existing.source_manifest_hash IS DISTINCT FROM p_source_manifest_hash
       OR v_existing.confirmation_digest  IS DISTINCT FROM p_confirmation_digest
       OR v_existing.actor_assertion_digest
            IS DISTINCT FROM p_actor_assertion_digest
       OR v_existing.assertion_root_head_sha256
            IS DISTINCT FROM p_assertion_root_head_sha256
       OR v_existing.hmac_head_sha256     IS DISTINCT FROM p_hmac_head_sha256
       OR v_existing.assertion_nonce      IS DISTINCT FROM p_assertion_nonce
       OR v_existing.request_digest       IS DISTINCT FROM p_request_digest
       OR v_existing.preflight_id         IS DISTINCT FROM p_preflight_id
       OR v_existing.response_status      IS DISTINCT FROM p_response_status
       OR v_existing.response_body_sha256 IS DISTINCT FROM p_response_body_sha256
       OR v_existing.ciphertext_schema    IS DISTINCT FROM p_ciphertext_schema
       OR v_existing.key_reference        IS DISTINCT FROM p_key_reference
       OR v_existing.algorithm            IS DISTINCT FROM p_algorithm
       OR v_existing.nonce                IS DISTINCT FROM p_nonce
       OR v_existing.aad                  IS DISTINCT FROM p_aad
       OR v_existing.aad_sha256           IS DISTINCT FROM p_aad_sha256
       OR v_existing.ciphertext           IS DISTINCT FROM p_ciphertext
       OR v_existing.auth_tag             IS DISTINCT FROM p_auth_tag
    THEN
      -- Conflict class, not invalid-parameter class. ERRCODE 23505 is used
      -- because it is the code the accepted contract already maps to 409, and
      -- clause A directs that existing identifier-free conflict mappings remain
      -- unchanged. No column name or byte value is disclosed in the message.
      RAISE EXCEPTION 'g038_replay_unequal' USING ERRCODE = '23505';
    END IF;

    -- Route capability bytes. G005's conflict mapping names
    -- "request/capability/kind/route/bytes", and the four route secret digests
    -- are exactly those route bytes. They are not columns of v_existing -- the
    -- commitment row carries no secret_digest -- so equality is established by
    -- counting how many of the retained commitment's routes match the supplied
    -- (kind, digest) pairs. Anything other than all four matching is a
    -- conflict, by the same 23505 -> 409 mapping used above.
    SELECT pg_catalog.count(*) INTO v_route_match
    FROM public.g038_deletion_route AS r
    WHERE r.commitment_id = v_existing.commitment_id
      AND (
        (r.route_kind = 'POLL'     AND r.secret_digest = p_poll_secret_digest)
        OR (r.route_kind = 'RECEIPT'  AND r.secret_digest = p_receipt_secret_digest)
        OR (r.route_kind = 'RECOVERY' AND r.secret_digest = p_recovery_secret_digest)
        OR (r.route_kind = 'CLEANUP'  AND r.secret_digest = p_cleanup_secret_digest)
      );

    IF v_route_match IS DISTINCT FROM 4 THEN
      RAISE EXCEPTION 'g038_replay_unequal' USING ERRCODE = '23505';
    END IF;

    RETURN QUERY
      SELECT 'REPLAY'::text,
             v_existing.commitment_id,
             v_existing.expires_at,
             v_existing.mode,
             v_existing.response_status,
             v_existing.response_body_sha256;
    RETURN;
  END IF;

  -- All-or-nothing construction. Any constraint failure aborts the whole
  -- statement, leaving zero durable writes.
  --
  -- The construction is wrapped in a sub-block with a unique_violation handler.
  -- Three distinct collisions can reach it:
  --
  --   1. An AVAILABLE-but-expired row occupying the idempotency scope. The
  --      partial index predicate is status-only because expires_at > now() is
  --      not index-legal, so such a row still occupies the scope while the
  --      replay SELECT (which also requires expires_at > now()) skips it.
  --   2. Two concurrent CREATEs. Both pass the replay SELECT under READ
  --      COMMITTED; the loser hits the index.
  --   3. A nonce collision against g038_commitment_nonce_unique, from any
  --      scope at all.
  --
  -- What the handler actually returns, stated precisely rather than
  -- optimistically. Its REPLAY branch requires the retained row to be
  -- byte-equal across all 24 compared fields AND all four route digests. One of
  -- those 24 is `nonce`. The G005 source requires a freshly generated CSPRNG
  -- nonce per candidate and forbids resubmitting one, and this file enforces
  -- that uniqueness at storage level. So for any conforming caller:
  --
  --   * Collisions 1 and 2 carry a DIFFERENT nonce, fail the equality set, and
  --     re-raise the original 23505 -> 409.
  --   * The REPLAY branch is reachable only if a caller resubmits an identical
  --     nonce, which G005 forbids.
  --
  -- The handler's REPLAY branch is therefore near-unreachable in practice, and
  -- it is retained deliberately: it is the only construction under which
  -- returning REPLAY is safe, so it must stay guarded rather than be widened.
  --
  -- DIVERGENCE, recorded explicitly. G005's CREATE clause resolves a concurrent
  -- equal winner as a metadata-only REPLAY with no candidate writes. Because
  -- nonce equality is required here, this file maps that case to 409 instead.
  -- That is a real divergence, not an oversight. It is fail-closed and lands on
  -- G005's own recovery path -- 409, then LOOKUP, then checkout -- and the
  -- alternative (dropping nonce from the equality set) would reintroduce the
  -- defect where a caller is told its own ciphertext was committed when a
  -- different one is retained. The narrower error is the safer error.
  --
  -- CROSS-SCOPE NONCE COLLISION, mapped deliberately rather than incidentally.
  -- g038_commitment_nonce_unique is table-global, but the handler's replay
  -- SELECT is scope-pinned, so a nonce that collides with a row in a DIFFERENT
  -- idempotency scope yields NOT FOUND and re-raises the original 23505 -> 409.
  -- Arguably that is a malformed input and 22023 would be the more consistent
  -- class. It is left at 409 on purpose: a pre-check would be TOCTOU-racy
  -- (another transaction can insert between the check and the INSERT), so the
  -- constraint must remain the arbiter, and the constraint can only report
  -- 23505. G005 requires a fresh CSPRNG nonce per candidate with collision
  -- retries completed before CREATE, so no conforming caller reaches this path.
  -- The residual disclosure is a global nonce-existence oracle, which is
  -- computationally worthless against 96-bit CSPRNG nonces and reachable only
  -- by the single trusted grantee.
  --
  -- PRECONDITION. This mapping assumes READ COMMITTED, which is the PostgreSQL
  -- default. Under REPEATABLE READ or SERIALIZABLE the concurrent case can
  -- surface 40001 (serialization_failure) instead, which is outside this body's
  -- mapped error set. Phase 2b must pin the isolation level or map 40001.
  --
  -- The sub-block rolls back on failure, so zero-write is preserved on every
  -- path above.
  BEGIN
    INSERT INTO public.g038_deletion_commitment (
      commitment_id, assertion_id, actor_user_id, target_user_id, request_id,
      session_id, proof_id, preview_hash, confirmation_text, idempotency_key,
      source_manifest_hash, confirmation_digest, idempotency_key_digest,
      actor_assertion_digest, assertion_root_head_sha256, hmac_head_sha256,
      assertion_nonce, request_digest, preflight_id, expires_at, status, mode,
      response_status, response_body_sha256, ciphertext_schema, key_reference,
      algorithm, nonce, aad, aad_sha256, ciphertext, auth_tag
    )
    VALUES (
      p_commitment_id, p_assertion_id, p_actor_user_id, p_target_user_id,
      p_request_id, p_session_id, p_proof_id, p_preview_hash,
      p_confirmation_text, p_idempotency_key, p_source_manifest_hash,
      p_confirmation_digest, p_idempotency_key_digest, p_actor_assertion_digest,
      p_assertion_root_head_sha256, p_hmac_head_sha256, p_assertion_nonce,
      p_request_digest, p_preflight_id, p_commitment_expires_at, 'AVAILABLE',
      'V1_COMPAT', p_response_status, p_response_body_sha256,
      p_ciphertext_schema, p_key_reference, p_algorithm, p_nonce, p_aad,
      p_aad_sha256, p_ciphertext, p_auth_tag
    );

    INSERT INTO public.g038_deletion_route (route_id, commitment_id, route_kind, secret_digest)
    VALUES
      (p_poll_route_id,     p_commitment_id, 'POLL',     p_poll_secret_digest),
      (p_receipt_route_id,  p_commitment_id, 'RECEIPT',  p_receipt_secret_digest),
      (p_recovery_route_id, p_commitment_id, 'RECOVERY', p_recovery_secret_digest),
      (p_cleanup_route_id,  p_commitment_id, 'CLEANUP',  p_cleanup_secret_digest);
  EXCEPTION
    WHEN unique_violation THEN
      SELECT c.* INTO v_existing
      FROM public.g038_deletion_commitment AS c
      WHERE c.actor_user_id = p_actor_user_id
        AND c.target_user_id = p_target_user_id
        AND c.request_id = p_request_id
        AND c.idempotency_key_digest = p_idempotency_key_digest
        AND c.status = 'AVAILABLE'
        AND c.expires_at > pg_catalog.now();

      -- Same equality obligation as the main replay path above (G005: "unequal
      -- retained ... 409; equal retained success"). If no live row is visible,
      -- or a live row is visible but its retained bytes differ from the
      -- supplied bytes, this is a genuine conflict and the ORIGINAL
      -- unique_violation is re-raised unchanged -- it is already the 23505 the
      -- accepted contract maps to 409. Only a byte-equal retained row yields
      -- REPLAY.
      IF NOT FOUND
         OR v_existing.assertion_id         IS DISTINCT FROM p_assertion_id
         OR v_existing.session_id           IS DISTINCT FROM p_session_id
         OR v_existing.proof_id             IS DISTINCT FROM p_proof_id
         OR v_existing.preview_hash         IS DISTINCT FROM p_preview_hash
         OR v_existing.confirmation_text    IS DISTINCT FROM p_confirmation_text
         OR v_existing.idempotency_key      IS DISTINCT FROM p_idempotency_key
         OR v_existing.source_manifest_hash IS DISTINCT FROM p_source_manifest_hash
         OR v_existing.confirmation_digest  IS DISTINCT FROM p_confirmation_digest
         OR v_existing.actor_assertion_digest
              IS DISTINCT FROM p_actor_assertion_digest
         OR v_existing.assertion_root_head_sha256
              IS DISTINCT FROM p_assertion_root_head_sha256
         OR v_existing.hmac_head_sha256     IS DISTINCT FROM p_hmac_head_sha256
         OR v_existing.assertion_nonce      IS DISTINCT FROM p_assertion_nonce
         OR v_existing.request_digest       IS DISTINCT FROM p_request_digest
         OR v_existing.preflight_id         IS DISTINCT FROM p_preflight_id
         OR v_existing.response_status      IS DISTINCT FROM p_response_status
         OR v_existing.response_body_sha256 IS DISTINCT FROM p_response_body_sha256
         OR v_existing.ciphertext_schema    IS DISTINCT FROM p_ciphertext_schema
         OR v_existing.key_reference        IS DISTINCT FROM p_key_reference
         OR v_existing.algorithm            IS DISTINCT FROM p_algorithm
         OR v_existing.nonce                IS DISTINCT FROM p_nonce
         OR v_existing.aad                  IS DISTINCT FROM p_aad
         OR v_existing.aad_sha256           IS DISTINCT FROM p_aad_sha256
         OR v_existing.ciphertext           IS DISTINCT FROM p_ciphertext
         OR v_existing.auth_tag             IS DISTINCT FROM p_auth_tag
      THEN
        RAISE;
      END IF;

      -- Route capability bytes, same obligation as the main replay path. The
      -- retained commitment's four routes must match the supplied (kind,
      -- digest) pairs exactly; anything else is a conflict and the original
      -- unique_violation is re-raised unchanged.
      SELECT pg_catalog.count(*) INTO v_route_match
      FROM public.g038_deletion_route AS r
      WHERE r.commitment_id = v_existing.commitment_id
        AND (
          (r.route_kind = 'POLL'     AND r.secret_digest = p_poll_secret_digest)
          OR (r.route_kind = 'RECEIPT'  AND r.secret_digest = p_receipt_secret_digest)
          OR (r.route_kind = 'RECOVERY' AND r.secret_digest = p_recovery_secret_digest)
          OR (r.route_kind = 'CLEANUP'  AND r.secret_digest = p_cleanup_secret_digest)
        );

      IF v_route_match IS DISTINCT FROM 4 THEN
        RAISE;
      END IF;

      RETURN QUERY
        SELECT 'REPLAY'::text,
               v_existing.commitment_id,
               v_existing.expires_at,
               v_existing.mode,
               v_existing.response_status,
               v_existing.response_body_sha256;
      RETURN;
  END;
  -- CREATED: the newly committed-visible projection.
  RETURN QUERY
    SELECT 'CREATED'::text,
           c.commitment_id,
           c.expires_at,
           c.mode,
           c.response_status,
           c.response_body_sha256
    FROM public.g038_deletion_commitment AS c
    WHERE c.commitment_id = p_commitment_id;
END
$function$;

-- ---------------------------------------------------------------------------
-- Ownership and ACLs (frozen clauses 1 and 2).
--
-- The OWNER TO is explicit: without it the function would be owned by
-- whoever applied this migration, and SECURITY DEFINER would then run as the
-- wrong principal.
--
-- The REVOKE FROM PUBLIC is explicit: PostgreSQL grants EXECUTE to PUBLIC by
-- default on every new function, so the authority's "PUBLIC has no EXECUTE"
-- is unachievable without revoking it.
-- ---------------------------------------------------------------------------

ALTER TABLE public.g038_deletion_commitment OWNER TO privacy_workflow_owner;
ALTER TABLE public.g038_deletion_route      OWNER TO privacy_workflow_owner;

ALTER FUNCTION public.g038_reserve_account_deletion_commitment(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text,
  bytea, bytea, bytea, bytea, bytea, uuid, bytea, uuid, uuid, timestamptz,
  uuid, bytea, uuid, bytea, uuid, bytea, uuid, bytea, smallint, bytea,
  text, text, text, bytea, bytea, bytea, bytea, bytea
) OWNER TO privacy_workflow_owner;
DO $membership$
BEGIN
  EXECUTE pg_catalog.format(
    'REVOKE privacy_workflow_owner FROM %I',
    pg_catalog.current_user
  );
END
$membership$;

REVOKE ALL ON FUNCTION public.g038_reserve_account_deletion_commitment(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text,
  bytea, bytea, bytea, bytea, bytea, uuid, bytea, uuid, uuid, timestamptz,
  uuid, bytea, uuid, bytea, uuid, bytea, uuid, bytea, smallint, bytea,
  text, text, text, bytea, bytea, bytea, bytea, bytea
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.g038_reserve_account_deletion_commitment(
  text, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text,
  bytea, bytea, bytea, bytea, bytea, uuid, bytea, uuid, uuid, timestamptz,
  uuid, bytea, uuid, bytea, uuid, bytea, uuid, bytea, smallint, bytea,
  text, text, text, bytea, bytea, bytea, bytea, bytea
) TO g038_route_adapter;

-- Supabase's database image may install default-privilege/event-trigger grants for
-- API and bootstrap roles. Remove those direct EXECUTE grants after creation so
-- the closed ACL remains identical across the disposable target and plain PG17.
DO $acl$
DECLARE
  v_role text;
  v_function regprocedure :=
    'public.g038_reserve_account_deletion_commitment(text,uuid,uuid,uuid,uuid,uuid,uuid,text,text,text,text,bytea,bytea,bytea,bytea,bytea,uuid,bytea,uuid,uuid,timestamptz,uuid,bytea,uuid,bytea,uuid,bytea,uuid,bytea,smallint,bytea,text,text,text,bytea,bytea,bytea,bytea,bytea)'::regprocedure;
BEGIN
  FOREACH v_role IN ARRAY ARRAY[
    'anon', 'authenticated', 'service_role', 'postgres', 'supabase_admin'
  ]
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_role)
       AND v_role NOT IN ('privacy_workflow_owner', 'g038_route_adapter') THEN
      EXECUTE pg_catalog.format(
        'REVOKE EXECUTE ON FUNCTION %s FROM %I',
        v_function,
        v_role
      );
    END IF;
  END LOOP;
END
$acl$;

-- g038_route_adapter retains no direct table DML or SELECT: it reaches storage
-- only through the SECURITY DEFINER function above.
REVOKE ALL ON TABLE public.g038_deletion_commitment FROM PUBLIC;
REVOKE ALL ON TABLE public.g038_deletion_route      FROM PUBLIC;

-- Row level security is enabled on both tables as defence in depth, with no
-- permissive policy.
--
-- What that actually guarantees is narrow, and the narrow claim is the one made
-- here: RLS is not the primary deny mechanism. The primary mechanism is that no
-- role holds any table grant at all -- PUBLIC is revoked above and no GRANT is
-- issued to any other role. RLS only adds a second barrier if a table grant is
-- later added by mistake, and even then it does not bind a superuser or any
-- role with BYPASSRLS, both of which bypass RLS unconditionally. Claiming that
-- "no role reaches these tables" on the strength of RLS alone would be false.
--
-- FORCE ROW LEVEL SECURITY is deliberately NOT used. FORCE applies RLS to the
-- table owner as well, and there is no permissive policy here, so forcing it
-- would deny every row operation including the ones performed by the
-- SECURITY DEFINER function above, which runs as this same owner
-- (privacy_workflow_owner). That would make the CREATE phase fail at runtime.
-- Owner bypass is the intended mechanism: storage is reachable only through the
-- SECURITY DEFINER function, and no other role holds any table grant.
ALTER TABLE public.g038_deletion_commitment ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.g038_deletion_route      ENABLE ROW LEVEL SECURITY;

COMMIT;
