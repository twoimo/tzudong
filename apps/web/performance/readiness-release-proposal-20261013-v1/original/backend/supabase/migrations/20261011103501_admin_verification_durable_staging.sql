-- Persist an owner-bound private verification key before Storage transport.
-- Only retired unreferenced cleanup counts as outstanding work; shared references remain protected.
-- Applied SQL, grants, actor authorization and canonical key ownership stay intact.
BEGIN;
SET LOCAL lock_timeout='2s';
SELECT pg_advisory_xact_lock(hashtextextended('tzudong:review-media-catalog:v2',0));
DO $forward$
DECLARE target oid:='public.admin_review_verification_cleanup(uuid,text,text[])'::regprocedure;
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
  IF metadata->>'proowner'<>workflow_owner::text OR encode(sha256(convert_to(source,'UTF8')),'hex')<>'f4d19bc5b41fe7808635240cae80f796d12f6cad8b13802577a88afbb1f024a7'
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

  IF source IS DISTINCT FROM $old$
DECLARE items jsonb;
BEGIN
  IF p_review_id IS NULL OR p_phase IS NULL OR p_phase NOT IN ('prepare','finish')
     OR current_setting('transaction_isolation') <> 'read committed'
     OR (p_phase = 'prepare' AND p_paths IS NOT NULL)
     OR (p_phase = 'finish' AND (p_paths IS NULL OR cardinality(p_paths) > 20
       OR EXISTS (SELECT 1 FROM unnest(p_paths) x WHERE x IS NULL OR octet_length(x) > 8192)
       OR cardinality(p_paths) <> (SELECT count(DISTINCT x) FROM unnest(p_paths) x))) THEN
    RAISE EXCEPTION 'REVIEW_ADMIN_CLEANUP_INVALID';
  END IF;
  PERFORM pg_advisory_xact_lock(741093, 1);
  IF p_phase = 'prepare' THEN
    UPDATE review_media_private.cleanup c SET retired = true
      WHERE c.review_id = p_review_id AND c.purpose = 'verification'
        AND NOT c.retired AND NOT c.complete AND NOT review_media_private.referenced(c.path);
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.path),'[]'::jsonb) INTO items
      FROM (SELECT c.path,c.owner_id,c.review_id,c.purpose FROM review_media_private.cleanup c
        WHERE c.review_id = p_review_id AND c.purpose = 'verification' AND c.retired AND NOT c.complete
          AND NOT review_media_private.referenced(c.path)
          AND (review_media_private.canonical(c.path,c.owner_id,c.review_id,c.purpose)
            OR review_media_private.owned_legacy(c.path,c.owner_id,c.purpose))
        ORDER BY c.path LIMIT 20) x;
    RETURN jsonb_build_object('status','READY','items',items);
  END IF;
  UPDATE review_media_private.cleanup c SET complete = true
    WHERE c.review_id = p_review_id AND c.purpose = 'verification' AND c.retired AND NOT c.complete
      AND c.path = ANY(p_paths)
      AND (review_media_private.canonical(c.path,c.owner_id,c.review_id,c.purpose)
        OR review_media_private.owned_legacy(c.path,c.owner_id,c.purpose))
      AND NOT review_media_private.referenced(c.path)
      AND NOT EXISTS (SELECT 1 FROM storage.objects o
        WHERE o.bucket_id IN ('review-photos','review-verifications') AND o.name = c.path);
  RETURN jsonb_build_object('remaining',(SELECT count(*) FROM review_media_private.cleanup c
    WHERE c.review_id = p_review_id AND c.purpose = 'verification' AND NOT c.complete));
END
$old$ THEN RAISE EXCEPTION 'REVIEW_SHARED_ANCHOR_DRIFT'; END IF;
  patched:=$new$
DECLARE items jsonb; owner uuid;
BEGIN
  IF p_review_id IS NULL OR p_phase IS NULL OR p_phase NOT IN ('prepare','finish','stage')
     OR current_setting('transaction_isolation') <> 'read committed'
     OR (p_phase = 'prepare' AND p_paths IS NOT NULL)
     OR (p_phase IN ('finish','stage') AND (p_paths IS NULL OR cardinality(p_paths) > 20
       OR EXISTS (SELECT 1 FROM unnest(p_paths) x WHERE x IS NULL OR octet_length(x) > 8192)
       OR cardinality(p_paths) <> (SELECT count(DISTINCT x) FROM unnest(p_paths) x))) THEN
    RAISE EXCEPTION 'REVIEW_ADMIN_CLEANUP_INVALID';
  END IF;
  PERFORM pg_advisory_xact_lock(741093, 1);
  IF p_phase = 'stage' THEN
    SELECT user_id INTO owner FROM public.reviews WHERE id=p_review_id;
    IF owner IS NULL OR cardinality(p_paths)<>1
      OR NOT review_media_private.canonical(p_paths[1],owner,p_review_id,'verification')
      THEN RAISE EXCEPTION 'REVIEW_ADMIN_CLEANUP_INVALID'; END IF;
    INSERT INTO review_media_private.cleanup(path,owner_id,review_id,purpose,retired)
      VALUES(p_paths[1],owner,p_review_id,'verification',false) ON CONFLICT DO NOTHING;
    IF NOT EXISTS(SELECT 1 FROM review_media_private.cleanup WHERE path=p_paths[1]
      AND owner_id=owner AND review_id=p_review_id AND purpose='verification'
      AND NOT retired AND NOT complete) THEN RAISE EXCEPTION 'REVIEW_ADMIN_UPLOAD_RETIRED'; END IF;
    RETURN jsonb_build_object('status','STAGED');
  END IF;
  IF p_phase = 'prepare' THEN
    UPDATE review_media_private.cleanup c SET retired = true
      WHERE c.review_id = p_review_id AND c.purpose = 'verification'
        AND NOT c.retired AND NOT c.complete AND NOT review_media_private.referenced(c.path);
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.path),'[]'::jsonb) INTO items
      FROM (SELECT c.path,c.owner_id,c.review_id,c.purpose FROM review_media_private.cleanup c
        WHERE c.review_id = p_review_id AND c.purpose = 'verification' AND c.retired AND NOT c.complete
          AND NOT review_media_private.referenced(c.path)
          AND (review_media_private.canonical(c.path,c.owner_id,c.review_id,c.purpose)
            OR review_media_private.owned_legacy(c.path,c.owner_id,c.purpose))
        ORDER BY c.path LIMIT 20) x;
    RETURN jsonb_build_object('status','READY','items',items);
  END IF;
  UPDATE review_media_private.cleanup c SET complete = true
    WHERE c.review_id = p_review_id AND c.purpose = 'verification' AND c.retired AND NOT c.complete
      AND c.path = ANY(p_paths)
      AND (review_media_private.canonical(c.path,c.owner_id,c.review_id,c.purpose)
        OR review_media_private.owned_legacy(c.path,c.owner_id,c.purpose))
      AND NOT review_media_private.referenced(c.path)
      AND NOT EXISTS (SELECT 1 FROM storage.objects o
        WHERE o.bucket_id IN ('review-photos','review-verifications') AND o.name = c.path);
  RETURN jsonb_build_object('remaining',(SELECT count(*) FROM review_media_private.cleanup c
    WHERE c.review_id = p_review_id AND c.purpose = 'verification' AND c.retired AND NOT c.complete
      AND NOT review_media_private.referenced(c.path)));
END
$new$;
  EXECUTE replace(definition,source,patched);
  IF (SELECT to_jsonb(p)-ARRAY['prosrc','proargdefaults'] FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM metadata
    OR (SELECT pg_get_expr(p.proargdefaults,0) FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM defaults
    OR (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p WHERE p.oid=target)<>'468c12ee6c3463876cbccb394fcba8f870459a1f6cf3d945d97307f8551f094b'
    THEN RAISE EXCEPTION 'REVIEW_SHARED_POST_DRIFT'; END IF;
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
-- ADMIN_STAGING_READBACK_BEGIN
DO $readback$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='public.admin_review_verification_cleanup(uuid,text,text[])'::regprocedure
    AND proowner='privacy_workflow_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]
    AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='468c12ee6c3463876cbccb394fcba8f870459a1f6cf3d945d97307f8551f094b')
    OR has_function_privilege('anon','public.admin_review_verification_cleanup(uuid,text,text[])','EXECUTE')
    OR has_function_privilege('authenticated','public.admin_review_verification_cleanup(uuid,text,text[])','EXECUTE')
    OR NOT has_function_privilege('service_role','public.admin_review_verification_cleanup(uuid,text,text[])','EXECUTE')
    THEN RAISE EXCEPTION 'ADMIN_STAGING_READBACK_DRIFT'; END IF;
END $readback$;
-- ADMIN_STAGING_READBACK_END
COMMIT;
