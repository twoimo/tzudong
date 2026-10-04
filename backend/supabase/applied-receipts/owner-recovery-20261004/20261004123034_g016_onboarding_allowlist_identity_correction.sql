-- Correct the retired G016 five-argument allowlist identity only.
-- The nonce-bound function, ACL and user data stay intact. The catalog assertion
-- changes exactly the same retired identity; all its other checks remain intact.
-- Exact PG17/ledger76 admission. Every assertion and cleanup is in one transaction.
DO $g016_identity_correction$
DECLARE before_state jsonb; after_state jsonb; expected_state jsonb; checker oid;
 catalog_oid oid; catalog_source text; expected_catalog_source text;
BEGIN
  IF pg_catalog.current_setting('transaction_read_only')<>'off' THEN
    RAISE EXCEPTION 'G016_IDENTITY_EXECUTOR_DENIED';
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
  IF EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261004123034') THEN
    RAISE EXCEPTION 'G016_IDENTITY_ALREADY_RECORDED';
  END IF;
  IF pg_catalog.to_regprocedure('public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)') IS NOT NULL
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p
       WHERE p.oid=pg_catalog.to_regprocedure('public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text)')
         AND p.proowner='privacy_workflow_owner'::regrole AND p.prosecdef
         AND p.proconfig=ARRAY['search_path=""']::text[] AND p.pronargs=6
         AND p.pronargdefaults=0 AND p.prokind='f' AND NOT p.proretset
         AND p.prorettype='jsonb'::regtype AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
         AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')='b6a478e40bbb98fbd0d2e4a7993295000d33792093dcf0688b05b33f6363bf4e'
         AND (SELECT count(*) FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))))=2
         AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
           WHERE a.grantee NOT IN ('privacy_workflow_owner'::regrole,'service_role'::regrole)
             OR a.grantor<>'privacy_workflow_owner'::regrole OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
    RAISE EXCEPTION 'G016_NONCE_FUNCTION_DRIFT';
  END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace=pg_catalog.pg_my_temp_schema()
      AND proname='g016_identity_correction') THEN RAISE EXCEPTION 'G016_IDENTITY_HELPER_CONFLICT'; END IF;
  SELECT jsonb_build_object(
 'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_catalog.pg_auth_members m),
 'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_catalog.pg_roles r),
 'schemas',(SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) FROM pg_catalog.pg_namespace n WHERE nspname !~ '^pg_(temp|toast_temp)'),
 'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_(temp|toast_temp)'),
 'default_acls',(SELECT jsonb_agg(to_jsonb(a) ORDER BY oid) FROM pg_catalog.pg_default_acl a),
 'ledger',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name,'count',cardinality(statements),
   'array_sha256',encode(sha256(convert_to(to_json(statements)::text,'UTF8')),'hex')) ORDER BY version) FROM supabase_migrations.schema_migrations)) INTO before_state;
  SELECT p.oid,p.prosrc INTO catalog_oid,catalog_source FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='privacy_retention' AND p.proname='assert_g014_catalog_contract' AND p.pronargs=0;
  expected_catalog_source:=replace(catalog_source,'public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)','public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text)');
  SELECT jsonb_set(before_state,'{functions}',jsonb_agg(
    CASE WHEN (p->>'oid')::oid=catalog_oid THEN jsonb_set(p,'{prosrc}',to_jsonb(expected_catalog_source)) ELSE p END
    ORDER BY (p->>'oid')::oid)) INTO expected_state FROM jsonb_array_elements(before_state->'functions') p;
  GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
  SET LOCAL ROLE privacy_workflow_owner;
  CREATE FUNCTION pg_temp.g016_identity_correction() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $private_correction$
  DECLARE changed integer; before_allowlist jsonb; expected_allowlist jsonb; after_allowlist jsonb;
    definition text; catalog_source text; rewritten text; before_metadata jsonb; after_metadata jsonb; target oid;
  BEGIN
    IF session_user<>'postgres' OR current_user<>'privacy_workflow_owner' THEN
      RAISE EXCEPTION 'G016_IDENTITY_CALLER_DENIED';
    END IF;
  IF EXISTS(
    WITH expected(function_schema,function_name,identity_arguments,grantee,source_signature) AS (VALUES
      ('public','confirm_privacy_onboarding','2950 25 2950 25 2950','service_role','public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)'),
      ('public','confirm_privacy_onboarding','2950 25 2950 25 2950 25','service_role','public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text)')),
    actual AS (SELECT function_schema::text,function_name::text,identity_arguments::text,grantee::text,source_signature::text
      FROM privacy_retention.g014_public_rpc_allowlist WHERE function_schema='public' AND function_name='confirm_privacy_onboarding')
    (SELECT * FROM expected EXCEPT ALL SELECT * FROM actual) UNION ALL
    (SELECT * FROM actual EXCEPT ALL SELECT * FROM expected)) THEN
    RAISE EXCEPTION 'G016_IDENTITY_ALLOWLIST_DRIFT';
  END IF;
  SELECT jsonb_agg(to_jsonb(a) ORDER BY source_signature,grantee) INTO before_allowlist
    FROM privacy_retention.g014_public_rpc_allowlist a;
  SELECT jsonb_agg(to_jsonb(a) ORDER BY source_signature,grantee) INTO expected_allowlist
    FROM privacy_retention.g014_public_rpc_allowlist a
    WHERE NOT(source_signature='public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)' AND grantee='service_role');
    DELETE FROM privacy_retention.g014_public_rpc_allowlist
      WHERE source_signature='public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)' AND grantee='service_role'
        AND function_schema='public' AND function_name='confirm_privacy_onboarding'
        AND identity_arguments='2950 25 2950 25 2950';
    GET DIAGNOSTICS changed=ROW_COUNT;
    IF changed<>1 THEN RAISE EXCEPTION 'G016_IDENTITY_ROW_COUNT_DRIFT'; END IF;
    SELECT p.oid,pg_catalog.pg_get_functiondef(p.oid),p.prosrc,to_jsonb(p)-'prosrc'
      INTO target,definition,catalog_source,before_metadata FROM pg_catalog.pg_proc p
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='privacy_retention' AND p.proname='assert_g014_catalog_contract' AND p.pronargs=0;
    IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(catalog_source,'UTF8')),'hex')<>'9c96bfdf0c80af38fcfe61b4f36bbc22df99aca76be56ce2758e950a7a5e4d28'
      OR (length(catalog_source)-length(replace(catalog_source,'public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)','')))/length('public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)')<>1 THEN
      RAISE EXCEPTION 'G016_CATALOG_IDENTITY_SOURCE_DRIFT';
    END IF;
    rewritten:=replace(catalog_source,'public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)','public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text)');
    IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(rewritten,'UTF8')),'hex')<>'8e9101ecdbb506e25a9ace2a40f7de9cc0dcf3f06d80cc1a75fe07a55effbeab' THEN
      RAISE EXCEPTION 'G016_CATALOG_IDENTITY_REWRITE_DRIFT';
    END IF;
    EXECUTE replace(definition,catalog_source,rewritten);
    SELECT to_jsonb(p)-'prosrc' INTO after_metadata FROM pg_catalog.pg_proc p WHERE oid=target;
    IF after_metadata IS DISTINCT FROM before_metadata THEN RAISE EXCEPTION 'G016_CATALOG_METADATA_DRIFT'; END IF;
    PERFORM privacy_retention.assert_g014_workflow_owner_contract();
    PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
    PERFORM privacy_retention.assert_g014_definer_contract();
    PERFORM privacy_retention.assert_g014_catalog_contract();
    SELECT jsonb_agg(to_jsonb(a) ORDER BY source_signature,grantee) INTO after_allowlist
      FROM privacy_retention.g014_public_rpc_allowlist a;
    IF after_allowlist IS DISTINCT FROM expected_allowlist OR before_allowlist IS NOT DISTINCT FROM after_allowlist THEN
      RAISE EXCEPTION 'G016_IDENTITY_READBACK_DRIFT';
    END IF;
    DROP FUNCTION pg_temp.g016_identity_correction();
  END $private_correction$;
  REVOKE ALL ON FUNCTION pg_temp.g016_identity_correction() FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION pg_temp.g016_identity_correction() TO postgres;
  RESET ROLE;
  REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
  SELECT oid INTO checker FROM pg_catalog.pg_proc WHERE pronamespace=pg_catalog.pg_my_temp_schema()
    AND proname='g016_identity_correction' AND pronargs=0;
  IF checker IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=checker
     AND proowner='privacy_workflow_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[])
     OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
       WHERE p.oid=checker AND(a.grantee NOT IN ('postgres'::regrole,'privacy_workflow_owner'::regrole) OR a.is_grantable)) THEN
    RAISE EXCEPTION 'G016_IDENTITY_HELPER_ACL_DRIFT';
  END IF;
  SELECT jsonb_build_object(
 'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_catalog.pg_auth_members m),
 'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_catalog.pg_roles r),
 'schemas',(SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) FROM pg_catalog.pg_namespace n WHERE nspname !~ '^pg_(temp|toast_temp)'),
 'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_(temp|toast_temp)'),
 'default_acls',(SELECT jsonb_agg(to_jsonb(a) ORDER BY oid) FROM pg_catalog.pg_default_acl a),
 'ledger',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name,'count',cardinality(statements),
   'array_sha256',encode(sha256(convert_to(to_json(statements)::text,'UTF8')),'hex')) ORDER BY version) FROM supabase_migrations.schema_migrations)) INTO after_state;
  IF after_state IS DISTINCT FROM before_state THEN RAISE EXCEPTION 'G016_IDENTITY_RESTORE_DRIFT'; END IF;
  PERFORM pg_temp.g016_identity_correction();
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=checker) THEN
    RAISE EXCEPTION 'G016_IDENTITY_HELPER_REMAINING';
  END IF;
  SELECT jsonb_build_object(
 'memberships',(SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) FROM pg_catalog.pg_auth_members m),
 'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_catalog.pg_roles r),
 'schemas',(SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) FROM pg_catalog.pg_namespace n WHERE nspname !~ '^pg_(temp|toast_temp)'),
 'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_(temp|toast_temp)'),
 'default_acls',(SELECT jsonb_agg(to_jsonb(a) ORDER BY oid) FROM pg_catalog.pg_default_acl a),
 'ledger',(SELECT jsonb_agg(jsonb_build_object('version',version,'name',name,'count',cardinality(statements),
   'array_sha256',encode(sha256(convert_to(to_json(statements)::text,'UTF8')),'hex')) ORDER BY version) FROM supabase_migrations.schema_migrations)) INTO after_state;
  IF after_state IS DISTINCT FROM expected_state THEN RAISE EXCEPTION 'G016_IDENTITY_POST_DRIFT'; END IF;
END $g016_identity_correction$;
