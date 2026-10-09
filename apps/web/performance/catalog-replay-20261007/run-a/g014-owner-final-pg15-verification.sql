BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL search_path=pg_catalog;
DO $verify$ DECLARE owner_id oid:='privacy_workflow_owner'::regrole; bridge_id oid:='privacy_auth_bridge'::regrole; BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres'
    OR current_setting('server_version_num')::integer/10000<>15 THEN
   RAISE EXCEPTION 'g014_owner_replay_executor_denied';
 END IF;
 IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='privacy_retention' AND p.proname='assert_g014_workflow_owner_contract')<>1
 OR NOT EXISTS(SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='privacy_retention' AND p.proname='assert_g014_workflow_owner_contract'
       AND p.pronargs=0 AND p.prorettype='void'::regtype AND NOT p.prosecdef
       AND p.proowner=owner_id AND p.proconfig=ARRAY['search_path=""']::text[]
       AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='5515d2269ddf0ffa26a414f21989b60dce1a41002440f0a81d3c646b34774b40'
       AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                      WHERE a.grantee<>owner_id OR a.is_grantable)) THEN
   RAISE EXCEPTION 'g014_owner_replay_function_denied';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE oid=owner_id AND NOT rolsuper AND NOT rolinherit
       AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls AND NOT rolcanlogin)
 OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE oid=bridge_id AND NOT rolsuper AND rolinherit
       AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication AND NOT rolbypassrls AND NOT rolcanlogin)
 OR (SELECT count(*) FROM pg_auth_members WHERE member=owner_id OR roleid=owner_id)<>1
 OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=owner_id AND member=bridge_id AND NOT admin_option)
 OR NOT pg_has_role(bridge_id,owner_id,'USAGE') THEN
   RAISE EXCEPTION 'g014_owner_replay_membership_denied';
 END IF;
END $verify$;
SELECT '{"disposition": "legacy-contract-preserved", "hosted_final_verifier_executed": false, "hosted_ledger_admission_verified": false, "predecessor_sha256": "8196f4fd81f2059e0da427d7022f5b7f768a945f7adbe7188f5409b540d25483", "read_only": true, "required_hosted_ledger_count": 77, "required_hosted_pg_major": 17, "schema": "g014-owner-final-pg15-replay-v1", "source_sha256": "a17af9470c5ce0816b673ff9f5ffd5332726875ac3924764547d8f2eb85f9545"}'::jsonb AS receipt;
COMMIT;
