-- Separate final verification AFTER the 13-file chain AND recorded original
-- 20260906064252 owner recovery. Never aliases or re-executes that source.
-- Reuses the catalog-slice transaction-local definer checker pattern.
-- One atomic DO statement; caller must include its ledger receipt in the same
-- transaction. On any error/disconnect PostgreSQL rolls back helper and grants.
DO $g014_owner_final$
DECLARE before_state jsonb; after_state jsonb; checker oid;
BEGIN
  IF pg_catalog.current_setting('transaction_read_only')<>'off' THEN
    RAISE EXCEPTION 'G014_OWNER_STAGE_EXECUTOR_DENIED';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tzudong:g014-pg17-owner-recovery:v1',0));
  IF current_user <> 'postgres' OR session_user <> 'postgres'
     OR pg_catalog.current_setting('server_version_num')::integer/10000 <> 17 THEN
    RAISE EXCEPTION 'G014_OWNER_STAGE_EXECUTOR_DENIED';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE oid=10 AND rolname='supabase_admin' AND rolsuper)
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='postgres' AND NOT rolsuper AND rolinherit
         AND rolcreaterole AND rolcreatedb AND rolcanlogin AND rolreplication AND rolbypassrls)
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='privacy_workflow_owner' AND NOT rolsuper AND NOT rolinherit
         AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolcanlogin AND NOT rolreplication AND NOT rolbypassrls)
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='privacy_auth_bridge' AND NOT rolsuper AND rolinherit
         AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolcanlogin AND NOT rolreplication AND NOT rolbypassrls) THEN
    RAISE EXCEPTION 'G014_OWNER_STAGE_ROLE_DRIFT';
  END IF;
  IF EXISTS(
    WITH expected(role_name,member_name,grantor_name,admin_option,inherit_option,set_option) AS (VALUES
      ('privacy_workflow_owner','postgres','supabase_admin',true,false,false),
      ('privacy_auth_bridge','postgres','supabase_admin',true,false,false),
      ('privacy_workflow_owner','privacy_auth_bridge','postgres',false,true,true)),
    actual AS (SELECT r.rolname::text,m.rolname::text,g.rolname::text,a.admin_option,a.inherit_option,a.set_option
      FROM pg_catalog.pg_auth_members a JOIN pg_catalog.pg_roles r ON r.oid=a.roleid
      JOIN pg_catalog.pg_roles m ON m.oid=a.member JOIN pg_catalog.pg_roles g ON g.oid=a.grantor
      WHERE r.rolname IN ('privacy_workflow_owner','privacy_auth_bridge') OR m.rolname IN ('privacy_workflow_owner','privacy_auth_bridge'))
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected) UNION ALL
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual))
    OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','USAGE') IS DISTINCT FROM false
    OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','SET')
    OR pg_catalog.pg_has_role('postgres','privacy_auth_bridge','USAGE')
    OR pg_catalog.pg_has_role('postgres','privacy_auth_bridge','SET')
    OR NOT pg_catalog.pg_has_role('privacy_auth_bridge','privacy_workflow_owner','USAGE') THEN
    RAISE EXCEPTION 'G014_OWNER_STAGE_MEMBERSHIP_DRIFT';
  END IF;
  IF EXISTS(
    WITH expected(name,body_sha256,definer) AS (VALUES
      ('assert_g014_public_rpc_allowlist','f23203a0a2366eca16b30b256729e859efc556952df8cb75485924153e1188ef',true),
      ('assert_g014_definer_contract','a5fff8ca63e34d41fc7c56e5a646023d44645750a7abf9ae0c0efc35818aa964',true),
      ('assert_g014_catalog_contract','9c96bfdf0c80af38fcfe61b4f36bbc22df99aca76be56ce2758e950a7a5e4d28',true),
      ('assert_g014_workflow_owner_contract','345aed9acb1da06262740ef06d81e51855a44c7470aa8b431a23e6fa629aab1d',false))
    SELECT 1 FROM expected e WHERE
      (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='privacy_retention' AND p.proname=e.name)<>1
      OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='privacy_retention' AND p.proname=e.name AND p.pronargs=0
          AND p.proowner='privacy_workflow_owner'::regrole AND p.prosecdef=e.definer
          AND p.prokind='f' AND NOT p.proretset AND p.provolatile='v' AND p.prorettype='void'::regtype
          AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
          AND p.proconfig=ARRAY['search_path=""']::text[]
          AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')=e.body_sha256
          AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
            WHERE a.grantee<>p.proowner OR a.is_grantable))) THEN
    RAISE EXCEPTION 'G014_OWNER_STAGE_FUNCTION_DRIFT';
  END IF;
  IF (SELECT count(*) FROM supabase_migrations.schema_migrations)<>76
     OR EXISTS(SELECT 1 FROM (VALUES
      ('20261003171449','restaurant_review_manual_guards'),
      ('20261003172126','restaurant_review_manual_invoker_contract'),
      ('20261003182338','storyboard_service_role_bridge'),
      ('20261003193717','restaurant_review_claim_progress'),
      ('20261003205335','storyboard_uncertain_lease_recovery'),
      ('20261003212017','admin_evaluation_read_helpers'),
      ('20261003215116','admin_evaluation_keyset_queries'),
      ('20261003220841','admin_evaluation_page_invoker_contract'),
      ('20261004003503','admin_evaluation_display_revision'),
      ('20261004010334','restaurant_review_identity_evidence'),
      ('20261004023841','storyboard_claim_capability_order'),
      ('20261004045404','restaurant_review_category_contract'),
      ('20261004120000','restaurant_review_gemini_decision'),
      ('20260906064252','g014_pg17_workflow_owner_contract')) expected(version,name)
       LEFT JOIN supabase_migrations.schema_migrations m USING(version)
       WHERE m.name IS DISTINCT FROM expected.name OR coalesce(cardinality(m.statements),0)<1)
     OR EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261004115554')
      THEN
    RAISE EXCEPTION 'G014_OWNER_STAGE_LEDGER_DRIFT';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations
    WHERE version='20260906064252' AND name='g014_pg17_workflow_owner_contract' AND cardinality(statements)=1
      AND encode(sha256(convert_to(statements[1],'UTF8')),'hex')='92e475c2ca55bb82ad8132ced6b0ecda473508f2b035f59d3d6140b2e2481f8d'
      AND encode(sha256(convert_to(to_json(statements)::text,'UTF8')),'hex')='42af1eec6543319af14934859b15cbb3c77e6a6ceea80cdc1d9432783491b0aa') THEN
    RAISE EXCEPTION 'G014_OWNER_RECOVERY_RECEIPT_DRIFT';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace=pg_catalog.pg_my_temp_schema()
     AND proname='g014_pg17_owner_final_check') THEN
    RAISE EXCEPTION 'G014_OWNER_FINAL_HELPER_CONFLICT';
  END IF;
  SELECT jsonb_build_object(
 'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_catalog.pg_auth_members m),
 'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_catalog.pg_roles r),
 'schemas',(SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) FROM pg_catalog.pg_namespace n WHERE nspname !~ '^pg_(temp|toast_temp)'),
 'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_(temp|toast_temp)'),
 'default_acls',(SELECT jsonb_agg(to_jsonb(a) ORDER BY oid) FROM pg_catalog.pg_default_acl a),
 'ledger',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name,'count',cardinality(statements),
   'array_sha256',encode(sha256(convert_to(to_json(statements)::text,'UTF8')),'hex')) ORDER BY version) FROM supabase_migrations.schema_migrations)) INTO before_state;
  -- A new self-grant is temporary, carries no ADMIN or INHERIT, and is removed
  -- BEFORE assertions run. Provider bootstrap membership is never altered.
  GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
  SET LOCAL ROLE privacy_workflow_owner;
  CREATE FUNCTION pg_temp.g014_pg17_owner_final_check() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $private_check$
  BEGIN
    IF session_user<>'postgres' OR current_user<>'privacy_workflow_owner' THEN
      RAISE EXCEPTION 'G014_OWNER_FINAL_CALLER_DENIED';
    END IF;
    PERFORM privacy_retention.assert_g014_workflow_owner_contract();
    PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
    PERFORM privacy_retention.assert_g014_definer_contract();
    PERFORM privacy_retention.assert_g014_catalog_contract();
    DROP FUNCTION pg_temp.g014_pg17_owner_final_check();
  END $private_check$;
  REVOKE ALL ON FUNCTION pg_temp.g014_pg17_owner_final_check() FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION pg_temp.g014_pg17_owner_final_check() TO postgres;
  RESET ROLE;
  REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
  SELECT oid INTO checker FROM pg_catalog.pg_proc
    WHERE pronamespace=pg_catalog.pg_my_temp_schema() AND proname='g014_pg17_owner_final_check' AND pronargs=0;
  IF checker IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE oid=checker
      AND proowner='privacy_workflow_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[])
      OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
        WHERE p.oid=checker AND (a.grantee NOT IN ('postgres'::regrole,'privacy_workflow_owner'::regrole) OR a.is_grantable))
      OR pg_catalog.has_function_privilege('anon',checker,'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated',checker,'EXECUTE')
      OR pg_catalog.has_function_privilege('service_role',checker,'EXECUTE') THEN
    RAISE EXCEPTION 'G014_OWNER_FINAL_HELPER_ACL_DRIFT';
  END IF;
  SELECT jsonb_build_object(
 'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_catalog.pg_auth_members m),
 'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_catalog.pg_roles r),
 'schemas',(SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) FROM pg_catalog.pg_namespace n WHERE nspname !~ '^pg_(temp|toast_temp)'),
 'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_(temp|toast_temp)'),
 'default_acls',(SELECT jsonb_agg(to_jsonb(a) ORDER BY oid) FROM pg_catalog.pg_default_acl a),
 'ledger',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name,'count',cardinality(statements),
   'array_sha256',encode(sha256(convert_to(to_json(statements)::text,'UTF8')),'hex')) ORDER BY version) FROM supabase_migrations.schema_migrations)) INTO after_state;
  IF after_state IS DISTINCT FROM before_state THEN
    RAISE EXCEPTION 'G014_OWNER_FINAL_RESTORE_DRIFT';
  END IF;
  PERFORM pg_temp.g014_pg17_owner_final_check();
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=checker) THEN
    RAISE EXCEPTION 'G014_OWNER_FINAL_HELPER_REMAINING';
  END IF;
  SELECT jsonb_build_object(
 'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_catalog.pg_auth_members m),
 'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_catalog.pg_roles r),
 'schemas',(SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) FROM pg_catalog.pg_namespace n WHERE nspname !~ '^pg_(temp|toast_temp)'),
 'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_(temp|toast_temp)'),
 'default_acls',(SELECT jsonb_agg(to_jsonb(a) ORDER BY oid) FROM pg_catalog.pg_default_acl a),
 'ledger',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name,'count',cardinality(statements),
   'array_sha256',encode(sha256(convert_to(to_json(statements)::text,'UTF8')),'hex')) ORDER BY version) FROM supabase_migrations.schema_migrations)) INTO after_state;
  IF after_state IS DISTINCT FROM before_state THEN
    RAISE EXCEPTION 'G014_OWNER_FINAL_POST_DRIFT';
  END IF;
END $g014_owner_final$;
