-- Keep Supabase safeupdate enabled while advancing the single catalog revision.
-- This is a forward, source-bound replacement; applied migrations are immutable.
BEGIN;
SET LOCAL lock_timeout='2s';
SELECT pg_advisory_xact_lock(hashtextextended('tzudong:admin-revision-safeupdate:v1',0));
DO $forward$
DECLARE target oid:='pipeline_control.bump_admin_evaluation_revision()'::regprocedure;
  definition text; source text; patched text; metadata jsonb;
  before_members jsonb; before_manifest jsonb; before_schema jsonb;
BEGIN
  IF current_user<>'postgres' OR session_user<>'postgres'
    OR current_setting('transaction_read_only')<>'off'
    OR current_setting('server_version_num')::integer/10000 NOT IN (15,17)
    THEN RAISE EXCEPTION 'ADMIN_REVISION_EXECUTOR_DENIED'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') INTO before_members FROM pg_auth_members m;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key) INTO before_manifest FROM privacy_retention.g014_catalog_contract_manifest m;
  SELECT to_jsonb(n) INTO before_schema FROM pg_namespace n WHERE n.oid='pipeline_control'::regnamespace;
  SELECT pg_get_functiondef(p.oid),p.prosrc,to_jsonb(p)-'prosrc' INTO definition,source,metadata FROM pg_proc p WHERE p.oid=target;
  IF metadata->>'proowner'<>'postgres'::regrole::oid::text
    OR encode(sha256(convert_to(source,'UTF8')),'hex')<>'ed16226885c03b05cb459381cc5ef7c8352506f7ea1f88ae526a6511e4cc1b20'
    OR (SELECT count(*) FROM pipeline_control.admin_evaluation_catalog_revision WHERE singleton)<>1
    THEN RAISE EXCEPTION 'ADMIN_REVISION_SOURCE_DRIFT'; END IF;
  IF (length(source)-length(replace(source,$old$UPDATE pipeline_control.admin_evaluation_catalog_revision SET revision = revision + 1;$old$,'')))/length($old$UPDATE pipeline_control.admin_evaluation_catalog_revision SET revision = revision + 1;$old$)<>1
    THEN RAISE EXCEPTION 'ADMIN_REVISION_ANCHOR_DRIFT'; END IF;
  patched:=replace(source,$old$UPDATE pipeline_control.admin_evaluation_catalog_revision SET revision = revision + 1;$old$,$new$UPDATE pipeline_control.admin_evaluation_catalog_revision SET revision = revision + 1 WHERE singleton;$new$);
  EXECUTE replace(definition,source,patched);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM metadata
    OR (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p WHERE p.oid=target)<>'4a3bf9e7cc7d91fb1a2a5195d01f40de728539daad1a0a8132a7c10404dc7936'
    OR (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') FROM pg_auth_members m) IS DISTINCT FROM before_members
    OR (SELECT jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key) FROM privacy_retention.g014_catalog_contract_manifest m) IS DISTINCT FROM before_manifest
    OR (SELECT to_jsonb(n) FROM pg_namespace n WHERE n.oid='pipeline_control'::regnamespace) IS DISTINCT FROM before_schema
    THEN RAISE EXCEPTION 'ADMIN_REVISION_POST_DRIFT'; END IF;
END $forward$;
-- ADMIN_REVISION_READBACK_BEGIN
DO $readback$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='pipeline_control.bump_admin_evaluation_revision()'::regprocedure
    AND proowner='postgres'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]
    AND proacl=ARRAY['postgres=X/postgres']::aclitem[]
    AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='4a3bf9e7cc7d91fb1a2a5195d01f40de728539daad1a0a8132a7c10404dc7936')
    OR (SELECT count(*) FROM pipeline_control.admin_evaluation_catalog_revision WHERE singleton)<>1
    THEN RAISE EXCEPTION 'ADMIN_REVISION_READBACK_DRIFT'; END IF;
END $readback$;
-- ADMIN_REVISION_READBACK_END
COMMIT;
