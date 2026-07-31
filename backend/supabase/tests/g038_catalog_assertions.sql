-- G038 local-lane catalog assertions (H3).
--
-- Applied in Phase 2b ONLY, strictly after P1
-- (20260728000100_g038_deterministic_contract.sql) has been applied by the
-- launcher, and strictly after the H4 exclusion scanner has exited 0.
--
-- Authority: technical authority stage-01-final.md SHA
-- d99ceb632c976bc7c2388b1c7f95571c8b7429a14e7915a9cc09d8aaa99842a4,
-- normative clause A, lines 118-199.
--
-- Every assertion below is a live pg_catalog fact. Nothing here queries
-- hosted state, reads excluded history, or opens an outbound connection.
-- Any failed assertion raises and aborts the enclosing psql run under
-- ON_ERROR_STOP=1, producing zero further writes.
--
-- Scope honesty: these assertions verify catalog shape, ownership, attributes
-- and ACLs. They do NOT verify runtime behaviour, replay equality, TTL
-- fencing, durability, or any hosted property. Those remain unqualified.

\set ON_ERROR_STOP on

DO $assert$
DECLARE
  v_oid              oid;
  v_count            integer;
  v_argtypes         text;
  v_expected_args    text;
  v_prosecdef        boolean;
  v_provolatile      "char";
  v_proconfig        text[];
  v_owner            text;
  v_acl              aclitem[];
  v_rettype          text;
  v_proretset        boolean;
  v_argmodes         "char"[];
  v_argnames         text[];
  v_nargs            integer;
  v_nargdefaults     integer;
  v_grantee          text;
  v_extra_grantees   text;
BEGIN
  -- ---------------------------------------------------------------------
  -- A1. Exactly one function with this schema-qualified name. No overload,
  --     no defaulted variant, no alias.
  -- ---------------------------------------------------------------------
  SELECT count(*) INTO v_count
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'g038_reserve_account_deletion_commitment';

  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'A1 FAILED: expected exactly 1 pg_proc row for public.g038_reserve_account_deletion_commitment, found %',
      v_count;
  END IF;

  SELECT p.oid INTO v_oid
  FROM pg_catalog.pg_proc p
  JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'g038_reserve_account_deletion_commitment';

  RAISE NOTICE 'A1 PASSED: exactly one non-overloaded pg_proc row (oid %)', v_oid;

  -- ---------------------------------------------------------------------
  -- A2. Exactly 39 input arguments, in exact ordinal order, exact types.
  -- ---------------------------------------------------------------------
  SELECT p.pronargs, p.pronargdefaults
    INTO v_nargs, v_nargdefaults
  FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;

  IF v_nargs <> 39 THEN
    RAISE EXCEPTION 'A2 FAILED: expected pronargs = 39, found %', v_nargs;
  END IF;

  v_expected_args :=
    'text, uuid, uuid, uuid, uuid, uuid, uuid, text, text, text, text, '
    || 'bytea, bytea, bytea, bytea, bytea, uuid, bytea, uuid, uuid, '
    || 'timestamp with time zone, uuid, bytea, uuid, bytea, uuid, bytea, '
    || 'uuid, bytea, smallint, bytea, text, text, text, bytea, bytea, '
    || 'bytea, bytea, bytea';

  -- pg_get_function_arguments includes parameter names; compare the type
  -- vector positionally instead so the assertion is name-independent.
  SELECT string_agg(pg_catalog.format_type(t.oid, NULL), ', ' ORDER BY s.ord)
    INTO v_argtypes
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL unnest(p.proargtypes) WITH ORDINALITY AS s(argtype, ord)
  JOIN pg_catalog.pg_type t ON t.oid = s.argtype
  WHERE p.oid = v_oid;

  IF v_argtypes IS DISTINCT FROM v_expected_args THEN
    RAISE EXCEPTION E'A2 FAILED: argument type vector mismatch.\nexpected: %\nactual:   %',
      v_expected_args, v_argtypes;
  END IF;

  -- Parameter NAMES, in exact ordinal order. clause A fixes the 39 input names,
  -- and PostgREST named-argument calls resolve on them, so a correct type
  -- vector with a renamed parameter would still break the accepted call shape.
  -- The type-vector check above is deliberately name-independent; this is the
  -- companion check that closes that gap.
  --
  -- proargnames carries the six RETURNS TABLE column names after the 39 inputs,
  -- so proargmodes is filtered to 'i' rather than slicing by position.
  SELECT array_agg(nm ORDER BY ord)
    INTO v_argnames
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL unnest(p.proargnames, p.proargmodes)
                     WITH ORDINALITY AS s(nm, md, ord)
  WHERE p.oid = v_oid
    AND s.md = 'i';

  IF v_argnames IS DISTINCT FROM ARRAY[
    'p_phase', 'p_assertion_id', 'p_actor_user_id', 'p_target_user_id',
    'p_request_id', 'p_session_id', 'p_proof_id', 'p_preview_hash',
    'p_confirmation_text', 'p_idempotency_key', 'p_source_manifest_hash',
    'p_confirmation_digest', 'p_idempotency_key_digest',
    'p_actor_assertion_digest', 'p_assertion_root_head_sha256',
    'p_hmac_head_sha256', 'p_assertion_nonce', 'p_request_digest',
    'p_preflight_id', 'p_commitment_id', 'p_commitment_expires_at',
    'p_poll_route_id', 'p_poll_secret_digest', 'p_receipt_route_id',
    'p_receipt_secret_digest', 'p_recovery_route_id',
    'p_recovery_secret_digest', 'p_cleanup_route_id',
    'p_cleanup_secret_digest', 'p_response_status', 'p_response_body_sha256',
    'p_ciphertext_schema', 'p_key_reference', 'p_algorithm', 'p_nonce',
    'p_aad', 'p_aad_sha256', 'p_ciphertext', 'p_auth_tag'
  ]::text[] THEN
    RAISE EXCEPTION E'A2 FAILED: input parameter name vector mismatch.\nactual: %',
      v_argnames;
  END IF;

  RAISE NOTICE 'A2 PASSED: 39 input arguments in exact ordinal order and types';

  -- ---------------------------------------------------------------------
  -- A3. No argument has a default. No omitted-positional call shape exists.
  -- ---------------------------------------------------------------------
  IF v_nargdefaults <> 0 THEN
    RAISE EXCEPTION 'A3 FAILED: expected pronargdefaults = 0, found %', v_nargdefaults;
  END IF;

  RAISE NOTICE 'A3 PASSED: zero argument defaults';

  -- ---------------------------------------------------------------------
  -- A4. Exactly six OUT columns, in order, with exact types; returns setof.
  -- ---------------------------------------------------------------------
  SELECT p.proretset INTO v_proretset FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;
  IF NOT v_proretset THEN
    RAISE EXCEPTION 'A4 FAILED: expected proretset = true (RETURNS TABLE)';
  END IF;

  SELECT
    array_agg(am ORDER BY ord),
    array_agg(an ORDER BY ord)
    INTO v_argmodes, v_argnames
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL unnest(p.proargmodes, p.proargnames)
    WITH ORDINALITY AS s(am, an, ord)
  WHERE p.oid = v_oid AND s.am = 't';

  -- OUT arity. v_argmodes is aggregated above and would otherwise be dead
  -- output. Element values are 't' by construction (the aggregation filters
  -- WHERE s.am = 't'), so this constrains vector length and non-NULL-ness
  -- only. It runs before the name and type checks so an arity fault reports
  -- as arity rather than as a name or type mismatch.
  IF v_argmodes IS DISTINCT FROM ARRAY['t', 't', 't', 't', 't', 't']::"char"[] THEN
    RAISE EXCEPTION
      'A4 FAILED: expected exactly 6 TABLE-mode OUT columns, found mode vector %',
      v_argmodes;
  END IF;

  IF v_argnames IS DISTINCT FROM ARRAY[
      'result', 'commitment_id', 'expires_at', 'mode',
      'response_status', 'response_body_sha256'
    ] THEN
    RAISE EXCEPTION 'A4 FAILED: OUT column names/order mismatch: %', v_argnames;
  END IF;

  SELECT string_agg(pg_catalog.format_type(t.oid, NULL), ', ' ORDER BY s.ord)
    INTO v_rettype
  FROM pg_catalog.pg_proc p
  CROSS JOIN LATERAL unnest(p.proallargtypes, p.proargmodes)
    WITH ORDINALITY AS s(argtype, am, ord)
  JOIN pg_catalog.pg_type t ON t.oid = s.argtype
  WHERE p.oid = v_oid AND s.am = 't';

  IF v_rettype IS DISTINCT FROM
     'text, uuid, timestamp with time zone, text, smallint, bytea' THEN
    RAISE EXCEPTION 'A4 FAILED: OUT column type vector mismatch: %', v_rettype;
  END IF;

  RAISE NOTICE 'A4 PASSED: exactly six metadata OUT columns in exact order/types';

  -- ---------------------------------------------------------------------
  -- A5. Attributes are exactly SECURITY DEFINER VOLATILE SET search_path=''.
  -- PostgreSQL 17 stores that SQL clause canonically as search_path="".
  -- ---------------------------------------------------------------------
  SELECT p.prosecdef, p.provolatile, p.proconfig
    INTO v_prosecdef, v_provolatile, v_proconfig
  FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;

  IF NOT v_prosecdef THEN
    RAISE EXCEPTION 'A5 FAILED: expected SECURITY DEFINER (prosecdef = true)';
  END IF;

  IF v_provolatile <> 'v' THEN
    RAISE EXCEPTION 'A5 FAILED: expected VOLATILE (provolatile = v), found %', v_provolatile;
  END IF;

  IF v_proconfig IS DISTINCT FROM ARRAY['search_path=""'] THEN
    RAISE EXCEPTION 'A5 FAILED: expected proconfig = {search_path=""}, found %', v_proconfig;
  END IF;

  RAISE NOTICE 'A5 PASSED: SECURITY DEFINER VOLATILE with canonical empty search_path';

  -- ---------------------------------------------------------------------
  -- A6. Owner is privacy_workflow_owner.
  -- ---------------------------------------------------------------------
  SELECT pg_catalog.pg_get_userbyid(p.proowner) INTO v_owner
  FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;

  IF v_owner <> 'privacy_workflow_owner' THEN
    RAISE EXCEPTION 'A6 FAILED: expected owner privacy_workflow_owner, found %', v_owner;
  END IF;

  RAISE NOTICE 'A6 PASSED: owner is privacy_workflow_owner';

  -- ---------------------------------------------------------------------
  -- A7. EXECUTE is granted to g038_route_adapter and to nobody else.
  --     PUBLIC in particular must hold no EXECUTE. A NULL proacl would mean
  --     the PostgreSQL default (EXECUTE to PUBLIC) and is a hard failure.
  -- ---------------------------------------------------------------------
  SELECT p.proacl INTO v_acl FROM pg_catalog.pg_proc p WHERE p.oid = v_oid;

  IF v_acl IS NULL THEN
    RAISE EXCEPTION
      'A7 FAILED: proacl is NULL, which means the default EXECUTE-to-PUBLIC grant is in force';
  END IF;

  IF pg_catalog.has_function_privilege('public', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'A7 FAILED: PUBLIC holds EXECUTE';
  END IF;

  IF NOT pg_catalog.has_function_privilege('g038_route_adapter', v_oid, 'EXECUTE') THEN
    RAISE EXCEPTION 'A7 FAILED: g038_route_adapter does not hold EXECUTE';
  END IF;

  -- Enumerate every non-owner grantee holding EXECUTE. Only
  -- g038_route_adapter is permitted. The owner appears in proacl by
  -- construction and is excluded.
  SELECT string_agg(grantee_name, ', ' ORDER BY grantee_name)
    INTO v_extra_grantees
  FROM (
    SELECT CASE WHEN (a).grantee = 0
                THEN 'PUBLIC'
                ELSE pg_catalog.pg_get_userbyid((a).grantee)
           END AS grantee_name
    FROM (SELECT pg_catalog.aclexplode(v_acl) AS a) AS x
    WHERE (a).privilege_type = 'EXECUTE'
      AND CASE WHEN (a).grantee = 0
               THEN 'PUBLIC'
               ELSE pg_catalog.pg_get_userbyid((a).grantee)
          END NOT IN ('privacy_workflow_owner', 'g038_route_adapter')
  ) AS g;

  IF v_extra_grantees IS NOT NULL THEN
    RAISE EXCEPTION 'A7 FAILED: unexpected EXECUTE grantee(s): %', v_extra_grantees;
  END IF;

  RAISE NOTICE 'A7 PASSED: EXECUTE held only by g038_route_adapter; PUBLIC has none';

  -- ---------------------------------------------------------------------
  -- A8. Roles named by the contract exist; roles the contract forbids
  --     referencing are NOT granted EXECUTE. anon/authenticated/
  --     service_role are checked defensively: if the container happens to
  --     ship them, they must still hold no EXECUTE.
  -- ---------------------------------------------------------------------
  FOR v_grantee IN
    SELECT unnest(ARRAY['anon', 'authenticated', 'service_role'])
  LOOP
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = v_grantee) THEN
      IF pg_catalog.has_function_privilege(v_grantee, v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'A8 FAILED: forbidden role % holds EXECUTE', v_grantee;
      END IF;
      RAISE NOTICE 'A8 note: role % exists in this container and correctly holds no EXECUTE', v_grantee;
    END IF;
  END LOOP;

  RAISE NOTICE 'A8 PASSED: no forbidden role holds EXECUTE';

  -- ---------------------------------------------------------------------
  -- A9. g038_route_adapter holds no direct table DML/SELECT on the
  --     contract's own tables. Its only authority is the function.
  --
  -- The negative check below asserts count(*) = 0 over a relname filter, so
  -- a wrong or renamed table name would make it pass unconditionally rather
  -- than fail. That is exactly how an earlier revision of this file was
  -- silently vacuous. A positive existence assertion therefore runs first:
  -- both tables must exist as ordinary relations before the absence of
  -- privileges on them means anything.
  -- ---------------------------------------------------------------------
  SELECT count(*) INTO v_count
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname IN (
      'g038_deletion_commitment',
      'g038_deletion_route'
    );

  IF v_count <> 2 THEN
    RAISE EXCEPTION
      'A9 FAILED: expected exactly 2 contract tables to exist, found %; '
      'the privilege check below would be vacuous',
      v_count;
  END IF;

  SELECT count(*) INTO v_count
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL (
    SELECT unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS priv
  ) AS p
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname IN (
      'g038_deletion_commitment',
      'g038_deletion_route'
    )
    AND pg_catalog.has_table_privilege('g038_route_adapter', c.oid, p.priv);

  IF v_count <> 0 THEN
    RAISE EXCEPTION
      'A9 FAILED: g038_route_adapter holds % direct table privilege(s) on contract tables',
      v_count;
  END IF;

  RAISE NOTICE 'A9 PASSED: g038_route_adapter holds no direct table DML/SELECT';

  RAISE NOTICE '--- all catalog assertions A1..A9 PASSED ---';
END
$assert$;
