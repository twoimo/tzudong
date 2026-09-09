-- Hosted PG17 only; the read-only replay adapter retains PG15 behavior.
-- PG17 recognizes only the provider bootstrap
-- ADMIN rows and removes the inherited self-grant left by prior operations.
-- No app role receives privileges. Existing grants to the auth bridge remain.
-- Whole-file transaction, exact catalog preview and operator readback required.
DO $pg17_owner_recovery$
DECLARE
  v_major integer:=pg_catalog.current_setting('server_version_num')::integer/10000;
  v_target oid:=(SELECT p.oid FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='privacy_retention' AND p.proname='assert_g014_workflow_owner_contract' AND p.pronargs=0);
  v_before jsonb;
  v_after jsonb;
  v_members jsonb;
  v_expected_members jsonb;
  v_self oid;
  v_catalog_sql constant text := $snapshot$SELECT jsonb_build_object(
    'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_catalog.pg_roles r),
    'functions',(SELECT jsonb_agg(CASE WHEN p.oid=$1 THEN to_jsonb(p)-'prosrc' ELSE to_jsonb(p) END ORDER BY p.oid) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','privacy_retention')),
    'schemas',(SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) FROM pg_catalog.pg_namespace n WHERE nspname IN ('public','privacy_retention','extensions')))
    $snapshot$;
BEGIN
  IF v_major<>17 OR current_user<>'postgres' OR session_user<>'postgres'
     OR pg_catalog.current_setting('transaction_read_only')<>'off' THEN
    RAISE EXCEPTION 'g014_owner_recovery_executor_denied';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid=v_target
      AND proowner='privacy_workflow_owner'::regrole AND NOT prosecdef
      AND prokind='f' AND NOT proretset AND provolatile='v'
      AND prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
      AND prorettype='void'::regtype AND proconfig=ARRAY['search_path=""']::text[]
      AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(proacl,pg_catalog.acldefault('f',proowner))) a
                     WHERE a.grantee<>proowner OR a.is_grantable)
      AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex')='5515d2269ddf0ffa26a414f21989b60dce1a41002440f0a81d3c646b34774b40') THEN
    RAISE EXCEPTION 'g014_owner_recovery_source_drift';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tzudong:g014-pg17-owner-recovery:v1',0));
  EXECUTE v_catalog_sql INTO v_before USING v_target;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO v_members FROM pg_catalog.pg_auth_members m;
    SELECT oid INTO v_self FROM pg_catalog.pg_auth_members
     WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole
       AND grantor='postgres'::regrole AND NOT admin_option AND inherit_option AND NOT set_option;
    IF v_self IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members
       WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole
         AND grantor=10 AND admin_option AND NOT inherit_option AND NOT set_option)
       OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE oid=10 AND rolname='supabase_admin' AND rolsuper)
       OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','SET') THEN
      RAISE EXCEPTION 'g014_owner_recovery_membership_admission_denied';
    END IF;
    SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO v_expected_members
      FROM pg_catalog.pg_auth_members m WHERE oid<>v_self;
    GRANT privacy_workflow_owner TO postgres WITH SET TRUE GRANTED BY postgres;
    SET LOCAL ROLE privacy_workflow_owner;
    EXECUTE 'CREATE OR REPLACE FUNCTION privacy_retention.assert_g014_workflow_owner_contract()
RETURNS void
LANGUAGE plpgsql
SET search_path = ''''
AS $function$
DECLARE
  v_owner pg_catalog.pg_roles%ROWTYPE;
  v_bridge pg_catalog.pg_roles%ROWTYPE;
BEGIN
  SELECT * INTO v_owner
  FROM pg_catalog.pg_roles
  WHERE rolname = ''privacy_workflow_owner'';
  SELECT * INTO v_bridge
  FROM pg_catalog.pg_roles
  WHERE rolname = ''privacy_auth_bridge'';

  IF v_owner.oid IS NULL OR v_bridge.oid IS NULL THEN
    RAISE EXCEPTION ''privacy workflow bridge roles are missing'';
  END IF;
  IF v_owner.rolsuper OR v_owner.rolinherit OR v_owner.rolcreaterole
     OR v_owner.rolcreatedb OR v_owner.rolreplication
     OR v_owner.rolbypassrls OR v_owner.rolcanlogin
     OR v_bridge.rolsuper OR NOT v_bridge.rolinherit OR v_bridge.rolcreaterole
     OR v_bridge.rolcreatedb OR v_bridge.rolreplication
     OR v_bridge.rolbypassrls OR v_bridge.rolcanlogin THEN
    RAISE EXCEPTION ''privacy workflow bridge role attributes are incompatible'';
  END IF;
  IF pg_catalog.current_setting(''server_version_num'')::integer / 10000 = 15 THEN
  IF (SELECT count(*)
      FROM pg_catalog.pg_auth_members AS membership
      WHERE membership.member = v_owner.oid OR membership.roleid = v_owner.oid) <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_auth_members AS membership
       WHERE membership.roleid = v_owner.oid
         AND membership.member = v_bridge.oid
         AND NOT membership.admin_option
     )
     OR NOT pg_catalog.pg_has_role(v_bridge.oid, v_owner.oid, ''USAGE'') THEN
    RAISE EXCEPTION ''privacy_workflow_owner has unexpected role membership or effective access'';
  END IF;
  ELSIF pg_catalog.current_setting(''server_version_num'')::integer / 10000 = 17 THEN
    -- PG17 automatically grants role creators ADMIN without INHERIT or SET.
    -- The bootstrap grant cannot be revoked by the nonsuperuser creator. It
    -- retains the already trusted DBA''s management authority; it is not a
    -- data-access grant. Reject every self-granted/effective-access lease.
    IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
                   WHERE oid=10 AND rolname=''supabase_admin'' AND rolsuper)
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
                      WHERE rolname=''postgres'' AND NOT rolsuper AND rolcreaterole)
       OR (SELECT count(*) FROM pg_catalog.pg_auth_members
           WHERE member=v_owner.oid OR roleid=v_owner.oid) <> 2
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members
           WHERE roleid=v_owner.oid AND member=v_bridge.oid
             AND grantor=''postgres''::regrole AND NOT admin_option
             AND inherit_option AND set_option)
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members
           WHERE roleid=v_owner.oid AND member=''postgres''::regrole
             AND grantor=10 AND admin_option AND NOT inherit_option AND NOT set_option)
       OR (SELECT count(*) FROM pg_catalog.pg_auth_members
           WHERE member=v_bridge.oid OR roleid=v_bridge.oid) <> 2
       OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_auth_members
           WHERE roleid=v_bridge.oid AND member=''postgres''::regrole
             AND grantor=10 AND admin_option AND NOT inherit_option AND NOT set_option)
       OR NOT pg_catalog.pg_has_role(v_bridge.oid,v_owner.oid,''USAGE'')
       OR pg_catalog.pg_has_role(''postgres'',v_owner.oid,''USAGE'')
       OR pg_catalog.pg_has_role(''postgres'',v_owner.oid,''SET'')
       OR pg_catalog.pg_has_role(''postgres'',v_bridge.oid,''USAGE'')
       OR pg_catalog.pg_has_role(''postgres'',v_bridge.oid,''SET'') THEN
      RAISE EXCEPTION ''g014_pg17_workflow_owner_membership_denied'';
    END IF;
  ELSE
    RAISE EXCEPTION ''g014_workflow_owner_server_version_denied'';
  END IF;
END;
$function$;';
    CREATE FUNCTION pg_temp.g014_owner_recovery_check() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $one_shot$
    BEGIN
      PERFORM privacy_retention.assert_g014_workflow_owner_contract();
      DROP FUNCTION pg_temp.g014_owner_recovery_check();
    END $one_shot$;
    REVOKE ALL ON FUNCTION pg_temp.g014_owner_recovery_check() FROM PUBLIC,anon,authenticated,service_role;
    GRANT EXECUTE ON FUNCTION pg_temp.g014_owner_recovery_check() TO postgres;
    RESET ROLE;
    REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
    PERFORM pg_temp.g014_owner_recovery_check();
    IF pg_catalog.to_regprocedure('pg_temp.g014_owner_recovery_check()') IS NOT NULL THEN
      RAISE EXCEPTION 'g014_owner_recovery_bridge_remaining';
    END IF;
  EXECUTE v_catalog_sql INTO v_after USING v_target;
  IF v_after IS DISTINCT FROM v_before
     OR (SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_catalog.pg_auth_members m) IS DISTINCT FROM v_expected_members
     OR (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc WHERE oid=v_target) <> '345aed9acb1da06262740ef06d81e51855a44c7470aa8b431a23e6fa629aab1d' THEN
    RAISE EXCEPTION 'g014_owner_recovery_post_drift';
  END IF;
END $pg17_owner_recovery$;
