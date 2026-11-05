-- DRAFT / UNAPPLIED: exact provider-budget forward after thumbnail ledger 90.
-- This source is not an execution authorization. The caller must take the shared
-- workflow serializer BEFORE the compiler takes the ledger lock, in the SAME
-- transaction. The unchanged compiler owns prefix, vector, ledger and readback.
-- Ordinary business DML may continue; privileged catalog writers remain in
-- authenticated owner custody until the original attempt is reconciled.

-- A per-transaction marker makes psql per-statement autocommit fail before any
-- persistent feature/role change. It is an accident guard, not an auth token.
DO $provider_budget_install_transaction$
BEGIN
  IF current_user<>'postgres' OR session_user<>'postgres'
     OR pg_catalog.current_setting('is_superuser')<>'off'
     OR pg_catalog.current_setting('server_version_num')::integer<>170006
     OR pg_catalog.current_setting('transaction_read_only')<>'off'
     OR pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'provider_budget_install_executor_denied' USING ERRCODE='42501';
  END IF;
  PERFORM pg_catalog.set_config('search_path','',true);
  PERFORM pg_catalog.set_config('provider_budget_install.xact',pg_catalog.pg_current_xact_id()::text,true);
END $provider_budget_install_transaction$;

DO $provider_budget_install_pre$
DECLARE before_members jsonb; after_members jsonb; assertion_metadata jsonb; checker oid;
BEGIN
  IF pg_catalog.current_setting('provider_budget_install.xact',true) IS DISTINCT FROM pg_catalog.pg_current_xact_id_if_assigned()::text
     OR pg_catalog.current_setting('provider_budget_install.xact',true) IS NULL THEN
    RAISE EXCEPTION 'provider_budget_install_outer_transaction_required' USING ERRCODE='25000';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tzudong:provider-budget-install:v1',0));
  IF pg_catalog.to_regprocedure('provider_budget_private.reserve_admin_provider_budget_core(uuid,text,uuid)') IS NOT NULL
     OR pg_catalog.to_regclass('pg_temp.provider_budget_install_before') IS NOT NULL
     OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace=pg_catalog.pg_my_temp_schema() AND proname='provider_budget_install_g014_check') THEN
    RAISE EXCEPTION 'provider_budget_install_prior_conflict' USING ERRCODE='55000';
  END IF;
  IF pg_catalog.pg_has_role('postgres','privacy_workflow_owner','SET')
     OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','USAGE')
     OR (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole)<>1
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole
       AND grantor='supabase_admin'::regrole AND admin_option AND NOT inherit_option AND NOT set_option) THEN
    RAISE EXCEPTION 'provider_budget_install_membership_denied' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='privacy_retention' AND p.proname IN ('assert_g014_workflow_owner_contract','assert_g014_public_rpc_allowlist','assert_g014_definer_contract','assert_g014_catalog_contract'))<>4
     OR EXISTS(SELECT 1 FROM (VALUES
       ('privacy_retention.assert_g014_workflow_owner_contract()','345aed9acb1da06262740ef06d81e51855a44c7470aa8b431a23e6fa629aab1d',false),
       ('privacy_retention.assert_g014_public_rpc_allowlist()','f23203a0a2366eca16b30b256729e859efc556952df8cb75485924153e1188ef',true),
       ('privacy_retention.assert_g014_definer_contract()','bb8dc8d2e4020f70b2332cbdf6acf465a97cbc4d582f9f14415330247ae34131',true),
       ('privacy_retention.assert_g014_catalog_contract()','5c5971a5578e09db25a41e88474f1da15acfbd658571ba28f29e8c226e4d1883',true)
     ) expected(signature,body_sha256,definer)
     LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(expected.signature)
     WHERE p.oid IS NULL OR p.proowner<>'privacy_workflow_owner'::regrole OR p.prosecdef IS DISTINCT FROM expected.definer
       OR p.prokind<>'f' OR p.prorettype<>'void'::regtype OR p.proretset OR p.pronargs<>0
       OR p.proargnames IS NOT NULL OR p.proargmodes IS NOT NULL OR p.proargdefaults IS NOT NULL
       OR p.pronargdefaults<>0 OR p.provariadic<>0 OR p.prosupport<>0 OR p.procost<>100 OR p.prorows<>0
       OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u'
       OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
       OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
       OR p.proacl::text IS DISTINCT FROM '{privacy_workflow_owner=X/privacy_workflow_owner}'
       OR pg_catalog.octet_length(p.prosrc)>65536
       OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')<>expected.body_sha256) THEN
    RAISE EXCEPTION 'provider_budget_install_assertion_source_drift' USING ERRCODE='55000';
  END IF;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO before_members FROM pg_catalog.pg_auth_members m;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) INTO assertion_metadata FROM pg_catalog.pg_proc p
    WHERE p.oid=ANY(ARRAY['privacy_retention.assert_g014_workflow_owner_contract()'::regprocedure,
      'privacy_retention.assert_g014_public_rpc_allowlist()'::regprocedure,
      'privacy_retention.assert_g014_definer_contract()'::regprocedure,
      'privacy_retention.assert_g014_catalog_contract()'::regprocedure]::oid[]);
  CREATE TEMPORARY TABLE pg_temp.provider_budget_install_before(memberships jsonb NOT NULL,assertions jsonb NOT NULL,unchanged jsonb NOT NULL) ON COMMIT DROP;
  INSERT INTO pg_temp.provider_budget_install_before VALUES(before_members,assertion_metadata,jsonb_build_object(
    'functions',(SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY p.oid) FROM pg_catalog.pg_proc p WHERE p.oid IN (
      'public.reserve_admin_provider_budget(uuid,text,uuid)'::regprocedure,
      'provider_budget_private.consume_admin_provider_counter(text,text,text,integer,timestamptz,timestamptz)'::regprocedure)),
    'tables',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.oid)
      FROM pg_catalog.pg_class c WHERE c.relnamespace='provider_budget_private'::regnamespace AND c.relkind='r'),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
      WHERE c.relnamespace='provider_budget_private'::regnamespace),
    'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_catalog.pg_roles r),
    'defaults',(SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.oid),'[]'::jsonb) FROM pg_catalog.pg_default_acl d)));
  GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
  SET LOCAL ROLE privacy_workflow_owner;
  CREATE FUNCTION pg_temp.provider_budget_install_g014_check(p_phase text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $check$
  BEGIN
    IF session_user<>'postgres' OR current_user<>'privacy_workflow_owner' OR p_phase IS NULL OR p_phase NOT IN ('pre','post') THEN
      RAISE EXCEPTION 'provider_budget_install_check_caller_denied' USING ERRCODE='42501';
    END IF;
    PERFORM privacy_retention.assert_g014_workflow_owner_contract();
    PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
    PERFORM privacy_retention.assert_g014_definer_contract();
    PERFORM privacy_retention.assert_g014_catalog_contract();
    IF p_phase='post' THEN DROP FUNCTION pg_temp.provider_budget_install_g014_check(text); END IF;
  END $check$;
  REVOKE ALL ON FUNCTION pg_temp.provider_budget_install_g014_check(text) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION pg_temp.provider_budget_install_g014_check(text) TO postgres;
  SET LOCAL ROLE postgres;
  REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO after_members FROM pg_catalog.pg_auth_members m;
  IF after_members IS DISTINCT FROM before_members THEN
    RAISE EXCEPTION 'provider_budget_install_pre_membership_drift' USING ERRCODE='55000';
  END IF;
  checker:=pg_catalog.to_regprocedure('pg_temp.provider_budget_install_g014_check(text)');
  IF checker IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=checker
      AND p.proowner='privacy_workflow_owner'::regrole AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[]
      AND (SELECT count(*)=2 AND bool_and(a.privilege_type='EXECUTE' AND NOT a.is_grantable
        AND a.grantee IN ('postgres'::regrole,'privacy_workflow_owner'::regrole)) FROM pg_catalog.aclexplode(p.proacl) a)) THEN
    RAISE EXCEPTION 'provider_budget_install_bridge_drift' USING ERRCODE='55000';
  END IF;
  PERFORM pg_temp.provider_budget_install_g014_check('pre');
END $provider_budget_install_pre$;


GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;

-- BEGIN PINNED BUDGET COMPONENT 7f6847fa83f7e1f87ce8ff289623796182a323a245a3308007fd689aa6ff3c24
-- DRAFT / UNAPPLIED. Local candidate only: no release manifest, ledger or writer-fence admission.
-- Execute only inside a single transaction with the separately verified postgres owner lease.
-- Existing G014 public owner/ACL stay unchanged; the private owner executes the budget domain.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('provider-budget-forward-v1',0));
LOCK TABLE provider_budget_private.admin_provider_budget_policies IN ACCESS EXCLUSIVE MODE;
DO $admission$
BEGIN
  IF current_user <> 'postgres'
     OR current_setting('transaction_read_only') <> 'off'
     OR current_setting('is_superuser') <> 'off'
     OR NOT pg_catalog.pg_has_role('postgres','privacy_workflow_owner','SET') THEN
    RAISE EXCEPTION 'provider_budget_forward_executor_not_admitted' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='privacy_workflow_owner'
        AND NOT rolsuper AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolinherit
        AND NOT rolcanlogin AND NOT rolreplication AND NOT rolbypassrls)
     OR (SELECT count(*) FROM pg_class c WHERE c.relnamespace='provider_budget_private'::regnamespace
         AND c.relname IN ('admin_provider_budget_policies','admin_provider_budget_counters','admin_provider_budget_decisions')
         AND c.relkind='r' AND c.relowner='postgres'::regrole AND c.relrowsecurity AND c.relforcerowsecurity) <> 3
     OR EXISTS (SELECT 1 FROM pg_class c CROSS JOIN LATERAL aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
         WHERE c.relnamespace='provider_budget_private'::regnamespace AND c.relkind='r' AND a.grantee<>'postgres'::regrole)
     OR EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='provider_budget_private'
         AND (roles<>ARRAY['postgres']::name[] OR cmd<>'ALL' OR qual<>'true' OR with_check<>'true'))
     OR (SELECT count(*) FROM pg_policies WHERE schemaname='provider_budget_private') <> 3
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='provider_budget_private.reject_admin_provider_budget_policy_mutation()'::regprocedure
         AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]
         AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='13953b199e4da6dac7fe65f2c334e1a26070b257cea417583d370e441b7b7726') THEN
    RAISE EXCEPTION 'provider_budget_forward_private_boundary_drift' USING ERRCODE='55000';
  END IF;
  IF to_regprocedure('provider_budget_private.reserve_admin_provider_budget_core(uuid,text,uuid)') IS NOT NULL
     OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='public.reserve_admin_provider_budget(uuid,text,uuid)'::regprocedure)
        IS DISTINCT FROM 'bc52ec03840caefdd3f90deb8c00ebf608fc9e1adde0b1b0be5aedf24203386e'
     OR (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc WHERE oid='provider_budget_private.consume_admin_provider_counter(text,text,text,integer,timestamptz,timestamptz)'::regprocedure)
        IS DISTINCT FROM '941ddc06b34547bdfa703094d9175f800cf9921bc869e739e48198c8e0cc9763'
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='public.reserve_admin_provider_budget(uuid,text,uuid)'::regprocedure
        AND proowner='privacy_workflow_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]
        AND proacl::text='{privacy_workflow_owner=X/privacy_workflow_owner,service_role=X/privacy_workflow_owner}')
     OR NOT EXISTS (SELECT 1 FROM pg_proc WHERE oid='provider_budget_private.consume_admin_provider_counter(text,text,text,integer,timestamptz,timestamptz)'::regprocedure
        AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[] AND proacl::text='{postgres=X/postgres}')
     OR (SELECT nspacl::text FROM pg_namespace WHERE nspname='provider_budget_private') IS DISTINCT FROM '{postgres=UC/postgres}' THEN
    RAISE EXCEPTION 'provider_budget_forward_source_drift' USING ERRCODE='55000';
  END IF;
  IF (SELECT jsonb_agg(to_jsonb(p) ORDER BY provider) FROM provider_budget_private.admin_provider_budget_policies p)
       IS DISTINCT FROM '[{"provider":"naver_geocode","actor_per_minute":60,"global_per_minute":600,"global_per_day":20000},{"provider":"naver_local_search","actor_per_minute":30,"global_per_minute":300,"global_per_day":20000},{"provider":"youtube_metadata","actor_per_minute":30,"global_per_minute":300,"global_per_day":9000}]'::jsonb
     OR (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='provider_budget_private.admin_provider_budget_policies'::regclass AND conname='admin_provider_budget_policies_provider_check')
        IS DISTINCT FROM $$CHECK ((provider = ANY (ARRAY['naver_local_search'::text, 'naver_geocode'::text, 'youtube_metadata'::text])))$$
     OR NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='provider_budget_private.admin_provider_budget_policies'::regclass
        AND tgname='admin_provider_budget_policies_immutable' AND tgenabled='O' AND tgtype=31
        AND tgfoid='provider_budget_private.reject_admin_provider_budget_policy_mutation()'::regprocedure) THEN
    RAISE EXCEPTION 'provider_budget_forward_policy_drift' USING ERRCODE='55000';
  END IF;
END;
$admission$;

-- One fixed Directions policy; preserve all existing limits and leave other LLM budgets absent.
ALTER TABLE provider_budget_private.admin_provider_budget_policies DROP CONSTRAINT admin_provider_budget_policies_provider_check;
ALTER TABLE provider_budget_private.admin_provider_budget_policies ADD CONSTRAINT admin_provider_budget_policies_provider_check
  CHECK(provider IN ('naver_local_search','naver_geocode','youtube_metadata','naver_directions'));
ALTER TABLE provider_budget_private.admin_provider_budget_policies DISABLE TRIGGER admin_provider_budget_policies_immutable;
INSERT INTO provider_budget_private.admin_provider_budget_policies(provider,actor_per_minute,global_per_minute,global_per_day)
  VALUES ('naver_directions',20,200,10000);
ALTER TABLE provider_budget_private.admin_provider_budget_policies ENABLE TRIGGER admin_provider_budget_policies_immutable;

CREATE OR REPLACE FUNCTION provider_budget_private.consume_admin_provider_counter(
  p_provider text,
  p_scope text,
  p_bucket_key text,
  p_max_requests integer,
  p_now timestamptz,
  p_expires_at timestamptz
)
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
  v_expires_at timestamptz;
BEGIN
  IF p_provider IS NULL
     OR p_scope IS NULL
     OR p_scope NOT IN ('actor_minute', 'global_minute', 'global_day')
     OR p_bucket_key IS NULL
     OR char_length(p_bucket_key) NOT BETWEEN 1 AND 80
     OR p_max_requests IS NULL
     OR p_max_requests NOT BETWEEN 1 AND 25000
     OR p_now IS NULL
     OR p_expires_at IS NULL
     OR p_expires_at <= p_now THEN
    RAISE EXCEPTION 'admin_provider_counter_invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO provider_budget_private.admin_provider_budget_counters AS counters (
    provider, scope, bucket_key, request_count, window_started_at, expires_at
  ) VALUES (
    p_provider, p_scope, p_bucket_key, 1, p_now, p_expires_at
  )
  ON CONFLICT (provider, scope, bucket_key) DO UPDATE
     SET request_count = CASE WHEN counters.expires_at <= p_now THEN 1 ELSE counters.request_count + 1 END,
         window_started_at = CASE WHEN counters.expires_at <= p_now THEN p_now ELSE counters.window_started_at END,
         expires_at = CASE WHEN counters.expires_at <= p_now THEN p_expires_at ELSE counters.expires_at END
  RETURNING counters.request_count, counters.expires_at
       INTO v_count, v_expires_at;

  allowed := v_count <= p_max_requests;
  retry_after_seconds := CASE
    WHEN allowed THEN 0
    ELSE GREATEST(1, pg_catalog.ceil(EXTRACT(EPOCH FROM v_expires_at - p_now))::integer)
  END;
  RETURN NEXT;
END;
$$;

CREATE FUNCTION provider_budget_private.reserve_admin_provider_budget_core(
  p_actor_user_id uuid,
  p_provider text,
  p_operation_id uuid
)
RETURNS TABLE (allowed boolean, retry_after_seconds integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_policy provider_budget_private.admin_provider_budget_policies%ROWTYPE;
  v_existing provider_budget_private.admin_provider_budget_decisions%ROWTYPE;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_minute_expiry timestamptz := v_now + interval '1 minute';
  v_day date := (v_now AT TIME ZONE 'Asia/Seoul')::date;
  v_day_expiry timestamptz;
  v_allowed boolean;
  v_retry integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'admin_provider_budget_service_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_actor_user_id IS NULL OR p_provider IS NULL OR p_operation_id IS NULL THEN
    RAISE EXCEPTION 'admin_provider_budget_request_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM public.user_roles AS roles
      JOIN public.user_account_status AS account_status
        ON account_status.user_id = roles.user_id
       AND account_status.account_status = 'active'
     WHERE roles.user_id = p_actor_user_id
       AND roles.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'admin_provider_budget_actor_forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT policies.* INTO v_policy
    FROM provider_budget_private.admin_provider_budget_policies AS policies
   WHERE policies.provider = p_provider;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'admin_provider_budget_provider_invalid' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('admin-provider-operation:' || p_operation_id::text, 0)
  );

  SELECT decisions.* INTO v_existing
    FROM provider_budget_private.admin_provider_budget_decisions AS decisions
   WHERE decisions.operation_id = p_operation_id;
  IF FOUND THEN
    IF v_existing.actor_user_id IS DISTINCT FROM p_actor_user_id
       OR v_existing.provider IS DISTINCT FROM p_provider THEN
      RAISE EXCEPTION 'admin_provider_budget_operation_binding_mismatch' USING ERRCODE = '22023';
    END IF;
    RETURN QUERY SELECT v_existing.allowed, v_existing.retry_after_seconds;
    RETURN;
  END IF;

  WITH expired_counters AS (
    SELECT counters.ctid
      FROM provider_budget_private.admin_provider_budget_counters AS counters
     WHERE counters.expires_at <= v_now - interval '1 hour'
     ORDER BY counters.expires_at
     LIMIT 100
  )
  DELETE FROM provider_budget_private.admin_provider_budget_counters AS counters
  USING expired_counters
  WHERE counters.ctid = expired_counters.ctid;

  WITH expired_decisions AS (
    SELECT decisions.ctid
      FROM provider_budget_private.admin_provider_budget_decisions AS decisions
     WHERE decisions.decided_at < v_now - interval '2 days'
     ORDER BY decisions.decided_at
     LIMIT 100
  )
  DELETE FROM provider_budget_private.admin_provider_budget_decisions AS decisions
  USING expired_decisions
  WHERE decisions.ctid = expired_decisions.ctid;

  SELECT counter.allowed, counter.retry_after_seconds INTO v_allowed, v_retry
    FROM provider_budget_private.consume_admin_provider_counter(
      p_provider, 'actor_minute', p_actor_user_id::text,
      v_policy.actor_per_minute, v_now, v_minute_expiry
    ) AS counter;
  IF NOT v_allowed THEN
    INSERT INTO provider_budget_private.admin_provider_budget_decisions
      (operation_id, actor_user_id, provider, allowed, retry_after_seconds)
    VALUES (p_operation_id, p_actor_user_id, p_provider, false, v_retry);
    RETURN QUERY SELECT false, v_retry;
    RETURN;
  END IF;

  SELECT counter.allowed, counter.retry_after_seconds INTO v_allowed, v_retry
    FROM provider_budget_private.consume_admin_provider_counter(
      p_provider, 'global_minute', 'global',
      v_policy.global_per_minute, v_now, v_minute_expiry
    ) AS counter;
  IF NOT v_allowed THEN
    INSERT INTO provider_budget_private.admin_provider_budget_decisions
      (operation_id, actor_user_id, provider, allowed, retry_after_seconds)
    VALUES (p_operation_id, p_actor_user_id, p_provider, false, v_retry);
    RETURN QUERY SELECT false, v_retry;
    RETURN;
  END IF;

  v_day_expiry := ((v_day + 1)::timestamp AT TIME ZONE 'Asia/Seoul');
  SELECT counter.allowed, counter.retry_after_seconds INTO v_allowed, v_retry
    FROM provider_budget_private.consume_admin_provider_counter(
      p_provider, 'global_day', v_day::text,
      v_policy.global_per_day, v_now, v_day_expiry
    ) AS counter;

  INSERT INTO provider_budget_private.admin_provider_budget_decisions
    (operation_id, actor_user_id, provider, allowed, retry_after_seconds)
  VALUES (p_operation_id, p_actor_user_id, p_provider, v_allowed, v_retry);
  RETURN QUERY SELECT v_allowed, v_retry;
END;
$$;

REVOKE ALL ON FUNCTION provider_budget_private.reserve_admin_provider_budget_core(uuid,text,uuid)
  FROM PUBLIC,anon,authenticated,service_role,privacy_workflow_owner;
GRANT USAGE ON SCHEMA provider_budget_private TO privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION provider_budget_private.reserve_admin_provider_budget_core(uuid,text,uuid) TO privacy_workflow_owner;

SET LOCAL ROLE privacy_workflow_owner;
CREATE OR REPLACE FUNCTION public.reserve_admin_provider_budget(
  p_actor_user_id uuid,p_provider text,p_operation_id uuid
) RETURNS TABLE(allowed boolean,retry_after_seconds integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $wrapper$
BEGIN
  RETURN QUERY SELECT decision.allowed,decision.retry_after_seconds
    FROM provider_budget_private.reserve_admin_provider_budget_core(p_actor_user_id,p_provider,p_operation_id) AS decision;
END;
$wrapper$;
RESET ROLE;
NOTIFY pgrst, 'reload schema';
-- END PINNED BUDGET COMPONENT

REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
DO $provider_budget_install_post$
DECLARE observed_members jsonb; observed_assertions jsonb; unchanged jsonb;
BEGIN
  IF current_user<>'postgres' OR session_user<>'postgres'
     OR pg_catalog.current_setting('provider_budget_install.xact',true) IS DISTINCT FROM pg_catalog.pg_current_xact_id_if_assigned()::text THEN
    RAISE EXCEPTION 'provider_budget_install_post_executor_denied' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO observed_members FROM pg_catalog.pg_auth_members m;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) INTO observed_assertions FROM pg_catalog.pg_proc p
    WHERE p.oid=ANY(ARRAY['privacy_retention.assert_g014_workflow_owner_contract()'::regprocedure,
      'privacy_retention.assert_g014_public_rpc_allowlist()'::regprocedure,
      'privacy_retention.assert_g014_definer_contract()'::regprocedure,
      'privacy_retention.assert_g014_catalog_contract()'::regprocedure]::oid[]);
  SELECT jsonb_build_object(
    'functions',(SELECT jsonb_agg(to_jsonb(p)-'prosrc' ORDER BY p.oid) FROM pg_catalog.pg_proc p WHERE p.oid IN (
      'public.reserve_admin_provider_budget(uuid,text,uuid)'::regprocedure,
      'provider_budget_private.consume_admin_provider_counter(text,text,text,integer,timestamptz,timestamptz)'::regprocedure)),
    'tables',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.oid)
      FROM pg_catalog.pg_class c WHERE c.relnamespace='provider_budget_private'::regnamespace AND c.relkind='r'),
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
      WHERE c.relnamespace='provider_budget_private'::regnamespace),
    'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_catalog.pg_roles r),
    'defaults',(SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.oid),'[]'::jsonb) FROM pg_catalog.pg_default_acl d)) INTO unchanged;
  IF observed_members IS DISTINCT FROM (SELECT b.memberships FROM pg_temp.provider_budget_install_before b)
     OR observed_assertions IS DISTINCT FROM (SELECT b.assertions FROM pg_temp.provider_budget_install_before b)
     OR unchanged IS DISTINCT FROM (SELECT b.unchanged FROM pg_temp.provider_budget_install_before b)
     OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','SET')
     OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','USAGE') THEN
    RAISE EXCEPTION 'provider_budget_install_metadata_drift' USING ERRCODE='55000';
  END IF;
  PERFORM pg_temp.provider_budget_install_g014_check('post');
  DROP TABLE pg_temp.provider_budget_install_before;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace=pg_catalog.pg_my_temp_schema() AND proname='provider_budget_install_g014_check') THEN
    RAISE EXCEPTION 'provider_budget_install_bridge_survived' USING ERRCODE='55000';
  END IF;
END $provider_budget_install_post$;
