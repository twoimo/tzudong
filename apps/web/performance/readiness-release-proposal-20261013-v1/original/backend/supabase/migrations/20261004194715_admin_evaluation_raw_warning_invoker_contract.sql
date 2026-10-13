-- Register the raw read RPC in both exact-source G014 invoker assertions.
-- Requires the preceding raw function migration. No permanent role grant.
BEGIN;
DO $raw_registration$
DECLARE before_members jsonb; after_members jsonb; temporary_grant boolean:=false; helper oid;
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres' THEN RAISE EXCEPTION 'G014_RAW_EXECUTOR'; END IF;
 SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO before_members FROM pg_auth_members m;
 IF NOT (SELECT rolsuper FROM pg_roles WHERE rolname=current_user) THEN
  IF current_setting('server_version_num')::int/10000<>17 OR pg_has_role('postgres','privacy_workflow_owner','SET')
   OR pg_has_role('postgres','privacy_workflow_owner','USAGE')
   OR NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole AND admin_option AND NOT inherit_option AND NOT set_option)
   THEN RAISE EXCEPTION 'G014_RAW_MEMBERSHIP'; END IF;
  EXECUTE 'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres';
  temporary_grant:=true;
 END IF;
 IF to_regprocedure('pg_temp.admin_raw_warning_registration()') IS NOT NULL THEN RAISE EXCEPTION 'G014_RAW_HELPER'; END IF;
 EXECUTE 'SET LOCAL ROLE privacy_workflow_owner';
 EXECUTE $definition$
 CREATE FUNCTION pg_temp.admin_raw_warning_registration() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
 DECLARE name text; target oid; definition text; source text; admitted text; metadata jsonb; expected text[]; rewritten text;
  anchor text:=$anchor$      'public.restaurant_review_automation_status()',$anchor$;
  record_addition text:=$record_addition$      'public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)',
$record_addition$;
  addition text:=$addition$      'public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)',
$addition$;
  signature text:='public.admin_evaluation_raw_warning_groups(uuid[],text,jsonb,integer)';
 BEGIN
  IF session_user<>'postgres' OR current_user<>'privacy_workflow_owner' THEN RAISE EXCEPTION 'G014_RAW_EXECUTOR'; END IF;
  IF EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=signature) THEN RAISE EXCEPTION 'G014_RAW_ALLOWLIST_DRIFT'; END IF;
  FOREACH name IN ARRAY ARRAY['definer','catalog'] LOOP
   target:=to_regprocedure('privacy_retention.assert_g014_'||name||'_contract()');
   expected:=CASE WHEN name='definer' THEN ARRAY['f3fe7e01b85da1718b91ff0439e204b2c07f9795b6bda720b277a50e56eb51d8','a5fff8ca63e34d41fc7c56e5a646023d44645750a7abf9ae0c0efc35818aa964']
    ELSE ARRAY['06076b2296e9cf2cef9748ef43390a7805fe90c0a9145f96e9fed8ff62f9f330','8e9101ecdbb506e25a9ace2a40f7de9cc0dcf3f06d80cc1a75fe07a55effbeab'] END;
   SELECT pg_get_functiondef(p.oid),prosrc,to_jsonb(p)-'prosrc' INTO definition,source,metadata FROM pg_proc p
    WHERE oid=target AND proowner='privacy_workflow_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[];
   -- Also admit the separate, exact one-line record-action extension. The
   -- real source is never stripped; this only checks its known preimage hash.
   admitted:=source;
   IF strpos(source,record_addition)>0 THEN
    IF (length(source)-length(replace(source,record_addition||anchor,'')))/length(record_addition||anchor)<>1 THEN RAISE EXCEPTION 'G014_RAW_SOURCE_DRIFT'; END IF;
    admitted:=replace(source,record_addition||anchor,anchor);
   END IF;
   IF definition IS NULL OR NOT(encode(sha256(convert_to(admitted,'UTF8')),'hex')=ANY(expected))
    OR (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1 OR strpos(source,addition)>0 THEN RAISE EXCEPTION 'G014_RAW_SOURCE_DRIFT'; END IF;
   rewritten:=replace(source,anchor,addition||anchor);
   EXECUTE replace(definition,source,rewritten);
   IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE oid=target) IS DISTINCT FROM metadata
    OR (SELECT prosrc FROM pg_proc WHERE oid=target) IS DISTINCT FROM rewritten THEN RAISE EXCEPTION 'G014_RAW_METADATA_DRIFT'; END IF;
  END LOOP;
  INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature)
   SELECT n.nspname,p.proname,p.proargtypes::text,'service_role',signature FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid=to_regprocedure(signature);
  PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
  PERFORM privacy_retention.assert_g014_definer_contract();
  DROP FUNCTION pg_temp.admin_raw_warning_registration();
 END $body$;
 $definition$;
 EXECUTE 'REVOKE ALL ON FUNCTION pg_temp.admin_raw_warning_registration() FROM PUBLIC,anon,authenticated,service_role';
 EXECUTE 'GRANT EXECUTE ON FUNCTION pg_temp.admin_raw_warning_registration() TO postgres';
 EXECUTE 'RESET ROLE';
 IF temporary_grant THEN EXECUTE 'REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres'; END IF;
 SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO after_members FROM pg_auth_members m;
 IF after_members IS DISTINCT FROM before_members THEN RAISE EXCEPTION 'G014_RAW_MEMBERSHIP_DRIFT'; END IF;
 helper:=to_regprocedure('pg_temp.admin_raw_warning_registration()');
 IF NOT EXISTS(SELECT 1 FROM pg_proc p WHERE oid=helper AND proowner='privacy_workflow_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]
  AND (SELECT count(*) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))))=2
  AND NOT EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee NOT IN ('privacy_workflow_owner'::regrole,'postgres'::regrole) OR a.is_grantable))
  THEN RAISE EXCEPTION 'G014_RAW_HELPER'; END IF;
 PERFORM pg_temp.admin_raw_warning_registration();
 IF to_regprocedure('pg_temp.admin_raw_warning_registration()') IS NOT NULL THEN RAISE EXCEPTION 'G014_RAW_HELPER'; END IF;
END $raw_registration$;
NOTIFY pgrst,'reload schema';
COMMIT;
