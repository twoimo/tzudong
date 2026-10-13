-- A locked, expired preview is definitively unapplied; never infer this from a client clock.
-- Applied receipts remain recoverable after expiry. No Apply is retried here.
BEGIN;
SET LOCAL lock_timeout='2s';
SELECT pg_advisory_xact_lock(hashtextextended('tzudong:admin-preview-expiry:v1',0));
DO $forward$
DECLARE target oid:='public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)'::regprocedure;
  definition text; source text; patched text; metadata jsonb; defaults text;
  before_members jsonb; before_manifest jsonb; before_schema jsonb;
BEGIN
  IF current_user<>'postgres' OR session_user<>'postgres'
    OR current_setting('transaction_read_only')<>'off'
    OR current_setting('server_version_num')::integer/10000 NOT IN (15,17)
    THEN RAISE EXCEPTION 'ADMIN_PREVIEW_EXECUTOR_DENIED'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') INTO before_members FROM pg_auth_members m;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key) INTO before_manifest FROM privacy_retention.g014_catalog_contract_manifest m;
  SELECT to_jsonb(n) INTO before_schema FROM pg_namespace n WHERE n.oid='public'::regnamespace;
  SELECT pg_get_functiondef(p.oid),p.prosrc,to_jsonb(p)-ARRAY['prosrc','proargdefaults'],pg_get_expr(p.proargdefaults,0)
    INTO definition,source,metadata,defaults FROM pg_proc p WHERE p.oid=target;
  IF metadata->>'proowner'<>'postgres'::regrole::oid::text
    OR encode(sha256(convert_to(source,'UTF8')),'hex')<>'2353de06b4d93f45fd603380e678f4edbcc0b16a8bd9860b5967683bea5f1157'
    THEN RAISE EXCEPTION 'ADMIN_PREVIEW_SOURCE_DRIFT'; END IF;
  IF (length(source)-length(replace(source,$old$IF op.id IS NULL THEN RAISE EXCEPTION 'RECORD_ACTION_NOT_FOUND'; END IF;
  RETURN op.receipt||$old$,'')))/length($old$IF op.id IS NULL THEN RAISE EXCEPTION 'RECORD_ACTION_NOT_FOUND'; END IF;
  RETURN op.receipt||$old$)<>1
    THEN RAISE EXCEPTION 'ADMIN_PREVIEW_ANCHOR_DRIFT'; END IF;
  patched:=replace(source,$old$IF op.id IS NULL THEN RAISE EXCEPTION 'RECORD_ACTION_NOT_FOUND'; END IF;
  RETURN op.receipt||$old$,$new$IF op.id IS NULL THEN RAISE EXCEPTION 'RECORD_ACTION_NOT_FOUND'; END IF;
  IF op.state='preview' AND op.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'RECORD_ACTION_PREVIEW_EXPIRED'; END IF;
  RETURN op.receipt||$new$);
  EXECUTE replace(definition,source,patched);
  IF (SELECT to_jsonb(p)-ARRAY['prosrc','proargdefaults'] FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM metadata
    OR (SELECT pg_get_expr(p.proargdefaults,0) FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM defaults
    OR (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p WHERE p.oid=target)<>'50b5900a7b6ca43062d6373dbba75378d714312c9ef02c6939997389f6833ba0'
    OR (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') FROM pg_auth_members m) IS DISTINCT FROM before_members
    OR (SELECT jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key) FROM privacy_retention.g014_catalog_contract_manifest m) IS DISTINCT FROM before_manifest
    OR (SELECT to_jsonb(n) FROM pg_namespace n WHERE n.oid='public'::regnamespace) IS DISTINCT FROM before_schema
    THEN RAISE EXCEPTION 'ADMIN_PREVIEW_POST_DRIFT'; END IF;
END $forward$;
-- ADMIN_PREVIEW_EXPIRY_READBACK_BEGIN
DO $readback$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)'::regprocedure
    AND proowner='postgres'::regrole AND NOT prosecdef AND proconfig=ARRAY['search_path=""']::text[]
    AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='50b5900a7b6ca43062d6373dbba75378d714312c9ef02c6939997389f6833ba0')
    OR has_function_privilege('anon','public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)','EXECUTE')
    OR has_function_privilege('authenticated','public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)','EXECUTE')
    OR NOT has_function_privilege('service_role','public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)','EXECUTE')
    THEN RAISE EXCEPTION 'ADMIN_PREVIEW_READBACK_DRIFT'; END IF;
END $readback$;
-- ADMIN_PREVIEW_EXPIRY_READBACK_END
COMMIT;
