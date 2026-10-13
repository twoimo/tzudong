-- Count only retired, unreferenced owner cleanup, excluding live OCR staging.
-- Forward correction preserves applied SQL, RPC metadata, ACLs and G014 rows.
BEGIN;
SET LOCAL lock_timeout='2s';
SELECT pg_advisory_xact_lock(hashtextextended('tzudong:review-media-catalog:v2',0));
DO $forward$
DECLARE target oid:='public.finish_review_media_cleanup()'::regprocedure;
  definition text; source text; patched text; metadata jsonb; defaults text;
  before_members jsonb; before_assertions jsonb; before_manifest jsonb; self_membership jsonb;
  before_schema jsonb; schema_lease boolean;
  workflow_owner oid:='privacy_workflow_owner'::regrole; runner oid:='postgres'::regrole;
  major integer:=current_setting('server_version_num')::integer/10000; pg15_lease boolean:=false;
BEGIN
  IF current_user<>'postgres' OR session_user<>'postgres' OR major NOT IN (15,17)
    OR current_setting('transaction_read_only')<>'off' OR NOT EXISTS(SELECT 1 FROM pg_roles
      WHERE oid=workflow_owner AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolinherit)
    THEN RAISE EXCEPTION 'REVIEW_SHARED_EXECUTOR_DENIED'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') INTO before_members FROM pg_auth_members m;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) INTO before_assertions FROM pg_proc p WHERE pronamespace='privacy_retention'::regnamespace;
  SELECT pg_get_functiondef(p.oid),p.prosrc,to_jsonb(p)-ARRAY['prosrc','proargdefaults'],pg_get_expr(p.proargdefaults,0) INTO definition,source,metadata,defaults FROM pg_proc p WHERE p.oid=target;
  IF metadata->>'proowner'<>workflow_owner::text OR encode(sha256(convert_to(source,'UTF8')),'hex')<>'f6c4e71988ed2b789b887484af5fdf2e482bde98f1d1c5b5d4e7ad124c314bd1'
    THEN RAISE EXCEPTION 'REVIEW_SHARED_SOURCE_DRIFT'; END IF;
  SELECT to_jsonb(n) INTO before_schema FROM pg_namespace n WHERE n.oid='public'::regnamespace;
  IF before_schema->>'nspowner' NOT IN (runner::text,'pg_database_owner'::regrole::oid::text)
    THEN RAISE EXCEPTION 'REVIEW_SHARED_SCHEMA_OWNER_DRIFT'; END IF;
  schema_lease:=NOT has_schema_privilege(workflow_owner,'public','CREATE');
  IF schema_lease THEN GRANT CREATE ON SCHEMA public TO privacy_workflow_owner; END IF;
  SELECT to_jsonb(m) INTO self_membership FROM pg_auth_members m WHERE roleid=workflow_owner AND member=runner AND grantor=runner;
  IF self_membership IS NOT NULL AND (self_membership->>'admin_option')::boolean THEN RAISE EXCEPTION 'REVIEW_MEDIA_FORWARD_MEMBERSHIP_DENIED'; END IF;
  IF major=17 THEN
    IF NOT EXISTS(SELECT 1 FROM pg_auth_members WHERE roleid=workflow_owner AND member=runner AND admin_option AND grantor<>runner)
      THEN RAISE EXCEPTION 'REVIEW_MEDIA_FORWARD_OWNER_AUTHORITY_MISSING'; END IF;
    EXECUTE 'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres';
  ELSE
    pg15_lease:=NOT pg_has_role(runner,workflow_owner,'MEMBER');
    IF pg15_lease THEN GRANT privacy_workflow_owner TO postgres; END IF;
  END IF;
  SET LOCAL ROLE privacy_workflow_owner;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key) INTO before_manifest FROM privacy_retention.g014_catalog_contract_manifest m;

  IF (length(source)-length(replace(source,$old$AND NOT c.complete);$old$,'')))/length($old$AND NOT c.complete);$old$)<>1
    THEN RAISE EXCEPTION 'OWNER_CLEANUP_ANCHOR_DRIFT'; END IF;
  patched:=replace(source,$old$AND NOT c.complete);$old$,$new$AND c.retired AND NOT c.complete AND NOT review_media_private.referenced(c.path));$new$);
  EXECUTE replace(definition,source,patched);
  IF (SELECT to_jsonb(p)-ARRAY['prosrc','proargdefaults'] FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM metadata
    OR (SELECT pg_get_expr(p.proargdefaults,0) FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM defaults
    OR (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p WHERE p.oid=target)<>'a6b4211b2d8486d482f0758ce249eec157249e1a5176be286b76af7e7a775ee9'
    THEN RAISE EXCEPTION 'OWNER_CLEANUP_POST_DRIFT'; END IF;
  CREATE FUNCTION pg_temp.review_shared_assert() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $bridge$
  BEGIN
    PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
    PERFORM privacy_retention.assert_g014_definer_contract();
    PERFORM privacy_retention.assert_g014_catalog_contract();
    DROP FUNCTION pg_temp.review_shared_assert();
  END $bridge$;
  REVOKE ALL ON FUNCTION pg_temp.review_shared_assert() FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION pg_temp.review_shared_assert() TO postgres;
  IF (SELECT jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key) FROM privacy_retention.g014_catalog_contract_manifest m) IS DISTINCT FROM before_manifest
    THEN RAISE EXCEPTION 'REVIEW_SHARED_MANIFEST_DRIFT'; END IF;
  RESET ROLE;
  IF schema_lease THEN REVOKE CREATE ON SCHEMA public FROM privacy_workflow_owner; END IF;
  IF major=15 THEN
    IF pg15_lease THEN REVOKE privacy_workflow_owner FROM postgres; END IF;
  ELSIF self_membership IS NULL THEN
    REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
  ELSE
    EXECUTE format('GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE,INHERIT %s,SET %s GRANTED BY postgres',
      upper(self_membership->>'inherit_option'),upper(self_membership->>'set_option'));
  END IF;

  IF (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') FROM pg_auth_members m) IS DISTINCT FROM before_members
    OR (SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_proc p WHERE pronamespace='privacy_retention'::regnamespace) IS DISTINCT FROM before_assertions
    OR (SELECT to_jsonb(n) FROM pg_namespace n WHERE n.oid='public'::regnamespace) IS DISTINCT FROM before_schema
    THEN RAISE EXCEPTION 'REVIEW_SHARED_PRESERVATION_DRIFT'; END IF;
  PERFORM pg_temp.review_shared_assert();
END $forward$;
-- OWNER_CLEANUP_READBACK_BEGIN
DO $readback$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.finish_review_media_cleanup()'::regprocedure
    AND proowner='privacy_workflow_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]
    AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='a6b4211b2d8486d482f0758ce249eec157249e1a5176be286b76af7e7a775ee9')
    OR has_function_privilege('anon','public.finish_review_media_cleanup()','EXECUTE')
    OR has_function_privilege('service_role','public.finish_review_media_cleanup()','EXECUTE')
    OR NOT has_function_privilege('authenticated','public.finish_review_media_cleanup()','EXECUTE')
    THEN RAISE EXCEPTION 'OWNER_CLEANUP_READBACK_DRIFT'; END IF;
END $readback$;
-- OWNER_CLEANUP_READBACK_END
COMMIT;
