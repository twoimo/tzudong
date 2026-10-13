-- Retirement must also fence late privileged Storage metadata commits.
-- A BEFORE STATEMENT serializer takes the global lock before row or object locks.
-- Applied SQL, grants, actor authorization and canonical key ownership stay intact.
BEGIN;
SET LOCAL lock_timeout='2s';
SELECT pg_advisory_xact_lock(hashtextextended('tzudong:review-media-catalog:v2',0));
DO $forward$
DECLARE target oid:='review_media_private.guard_references()'::regprocedure;
  definition text; source text; patched text; metadata jsonb;
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
  SELECT pg_get_functiondef(p.oid),p.prosrc,to_jsonb(p)-'prosrc' INTO definition,source,metadata FROM pg_proc p WHERE p.oid=target;
  IF metadata->>'proowner'<>workflow_owner::text OR encode(sha256(convert_to(source,'UTF8')),'hex')<>'846030547ffd76e17596755d7eee4279dcb9b563361435260826071d2f250d59'
    THEN RAISE EXCEPTION 'REVIEW_SHARED_SOURCE_DRIFT'; END IF;
  SELECT to_jsonb(n) INTO before_schema FROM pg_namespace n WHERE n.oid='review_media_private'::regnamespace;
  IF before_schema->>'nspowner'<>runner::text THEN RAISE EXCEPTION 'REVIEW_SHARED_SCHEMA_OWNER_DRIFT'; END IF;
  schema_lease:=NOT has_schema_privilege(workflow_owner,'review_media_private','CREATE');
  IF schema_lease THEN GRANT CREATE ON SCHEMA review_media_private TO privacy_workflow_owner; END IF;
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
DECLARE p text; old_food text[] := ARRAY[]::text[]; old_verification text; purpose text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.user_id = OLD.user_id AND NEW.id = OLD.id THEN
    old_food := COALESCE(OLD.food_photos, ARRAY[]::text[]);
    old_verification := OLD.verification_photo;
  END IF;
  FOR p, purpose IN SELECT value, 'food' FROM unnest(COALESCE(NEW.food_photos, ARRAY[]::text[])) value
    UNION ALL SELECT NEW.verification_photo, 'verification' LOOP
    IF EXISTS (SELECT 1 FROM review_media_private.cleanup c
      WHERE c.path = review_media_private.reference_key(p) AND c.retired) THEN
      RAISE EXCEPTION USING MESSAGE = 'REVIEW_MEDIA_RETIRED', ERRCODE = '23514';
    END IF;
    -- Historical keys may remain unchanged in their original purpose only.
    IF NOT COALESCE(CASE WHEN purpose = 'food' THEN p = ANY(old_food) ELSE p = old_verification END, false) THEN
      IF NOT review_media_private.canonical(p, NEW.user_id, NEW.id, purpose) THEN
        RAISE EXCEPTION USING MESSAGE = 'REVIEW_MEDIA_INVALID', ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END $old$ THEN RAISE EXCEPTION 'REVIEW_SHARED_ANCHOR_DRIFT'; END IF;
  patched:=$new$
DECLARE p text; old_food text[] := ARRAY[]::text[]; old_verification text; purpose text;
BEGIN
  IF TG_TABLE_SCHEMA='storage' AND TG_TABLE_NAME='objects' THEN
    IF NEW.bucket_id IN ('review-photos','review-verifications') AND EXISTS(
      SELECT 1 FROM review_media_private.cleanup WHERE path=NEW.name AND retired)
      THEN RAISE EXCEPTION USING MESSAGE='REVIEW_MEDIA_RETIRED',ERRCODE='23514'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.user_id = OLD.user_id AND NEW.id = OLD.id THEN
    old_food := COALESCE(OLD.food_photos, ARRAY[]::text[]);
    old_verification := OLD.verification_photo;
  END IF;
  FOR p, purpose IN SELECT value, 'food' FROM unnest(COALESCE(NEW.food_photos, ARRAY[]::text[])) value
    UNION ALL SELECT NEW.verification_photo, 'verification' LOOP
    IF EXISTS (SELECT 1 FROM review_media_private.cleanup c
      WHERE c.path = review_media_private.reference_key(p) AND c.retired) THEN
      RAISE EXCEPTION USING MESSAGE = 'REVIEW_MEDIA_RETIRED', ERRCODE = '23514';
    END IF;
    -- Historical keys may remain unchanged in their original purpose only.
    IF NOT COALESCE(CASE WHEN purpose = 'food' THEN p = ANY(old_food) ELSE p = old_verification END, false) THEN
      IF NOT review_media_private.canonical(p, NEW.user_id, NEW.id, purpose) THEN
        RAISE EXCEPTION USING MESSAGE = 'REVIEW_MEDIA_INVALID', ERRCODE = '23514';
      END IF;
    END IF;
  END LOOP;
  RETURN NEW;
END $new$;
  EXECUTE replace(definition,source,patched);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_proc p WHERE p.oid=target) IS DISTINCT FROM metadata
    OR (SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') FROM pg_proc p WHERE p.oid=target)<>'94113c8ae1231e8eae5a698f35a1370a38367e42c79cc87ac62db76c32e735b1'
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
  IF has_function_privilege('postgres','review_media_private.guard_references()','EXECUTE')
    OR has_function_privilege('postgres','review_media_private.lock_changes()','EXECUTE')
    THEN RAISE EXCEPTION 'STORAGE_FENCE_LEASE_BASELINE_DRIFT'; END IF;
  GRANT EXECUTE ON FUNCTION review_media_private.guard_references(),review_media_private.lock_changes() TO postgres;
  RESET ROLE;
  CREATE TRIGGER a00_review_media_storage_serialize BEFORE INSERT OR UPDATE OF bucket_id,name ON storage.objects
    FOR EACH STATEMENT EXECUTE FUNCTION review_media_private.lock_changes();
  CREATE TRIGGER a00_review_media_storage_guard BEFORE INSERT OR UPDATE OF bucket_id,name ON storage.objects
    FOR EACH ROW EXECUTE FUNCTION review_media_private.guard_references();
  SET LOCAL ROLE privacy_workflow_owner;
  REVOKE EXECUTE ON FUNCTION review_media_private.guard_references(),review_media_private.lock_changes() FROM postgres;
  RESET ROLE;
  IF schema_lease THEN REVOKE CREATE ON SCHEMA review_media_private FROM privacy_workflow_owner; END IF;
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
    OR (SELECT to_jsonb(n) FROM pg_namespace n WHERE n.oid='review_media_private'::regnamespace) IS DISTINCT FROM before_schema
    THEN RAISE EXCEPTION 'REVIEW_SHARED_PRESERVATION_DRIFT'; END IF;
  PERFORM pg_temp.review_shared_assert();
END $forward$;
-- STORAGE_RETIREMENT_FENCE_READBACK_BEGIN
DO $readback$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='review_media_private.guard_references()'::regprocedure
    AND proowner='privacy_workflow_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]
    AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='94113c8ae1231e8eae5a698f35a1370a38367e42c79cc87ac62db76c32e735b1')
    OR has_function_privilege('anon','review_media_private.guard_references()','EXECUTE')
    OR has_function_privilege('authenticated','review_media_private.guard_references()','EXECUTE')
    OR has_function_privilege('service_role','review_media_private.guard_references()','EXECUTE')
    OR has_function_privilege('postgres','review_media_private.guard_references()','EXECUTE')
    OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid='review_media_private.lock_changes()'::regprocedure
      AND proowner='privacy_workflow_owner'::regrole AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]
      AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='381d89aa6bbf5a59c2ee0fef2a7392ef705147252b324527201b8b6f74376250')
    OR EXISTS(SELECT 1 FROM unnest(ARRAY['anon','authenticated','service_role','postgres']) r
      WHERE has_function_privilege(r,'review_media_private.lock_changes()','EXECUTE'))
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='storage.objects'::regclass AND tgname='a00_review_media_storage_serialize'
      AND tgenabled='O' AND NOT tgisinternal AND tgfoid='review_media_private.lock_changes()'::regprocedure AND tgtype=22 AND pg_get_triggerdef(oid)='CREATE TRIGGER a00_review_media_storage_serialize BEFORE INSERT OR UPDATE OF bucket_id, name ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION review_media_private.lock_changes()')
    OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='storage.objects'::regclass AND tgname='a00_review_media_storage_guard'
      AND tgenabled='O' AND NOT tgisinternal AND tgfoid='review_media_private.guard_references()'::regprocedure AND tgtype=23 AND pg_get_triggerdef(oid)='CREATE TRIGGER a00_review_media_storage_guard BEFORE INSERT OR UPDATE OF bucket_id, name ON storage.objects FOR EACH ROW EXECUTE FUNCTION review_media_private.guard_references()')
    THEN RAISE EXCEPTION 'STORAGE_RETIREMENT_FENCE_READBACK_DRIFT'; END IF;
END $readback$;
-- STORAGE_RETIREMENT_FENCE_READBACK_END
COMMIT;
