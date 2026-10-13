-- Retired legacy administrator EXEC must not poison unrelated Storage writes.
-- Admit only the two exact historical banner policies, or their absence in a
-- fresh canonical replay. Private receipt reads remain owner-only; admin reads use the guarded server route.
-- No public function, table grant or RPC is added.
BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL search_path=public,extensions;
SELECT pg_advisory_xact_lock(hashtextextended('tzudong:review-media-catalog:v2',0));
DO $forward$
DECLARE item record; actual record; before_other jsonb; before_functions jsonb;
  before_members jsonb; before_manifest jsonb; before_schema jsonb;
  expression text := $predicate$(bucket_id = 'ad-banner-images' AND EXISTS (
    SELECT 1 FROM public.user_roles AS role_row
    JOIN public.user_account_status AS status_row ON status_row.user_id=role_row.user_id
    WHERE role_row.user_id=(SELECT auth.uid()) AND role_row.role::text='admin'
      AND status_row.account_status='active' AND status_row.disabled_at IS NULL))$predicate$;
BEGIN
  IF current_user<>'postgres' OR session_user<>'postgres' OR current_setting('transaction_read_only')<>'off'
    OR current_setting('server_version_num')::integer/10000 NOT IN (15,17)
    THEN RAISE EXCEPTION 'STORAGE_ADMIN_POLICY_EXECUTOR_DENIED'; END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY oid),'[]') INTO before_other FROM pg_policy p
    WHERE polrelid<>'storage.objects'::regclass OR polname NOT IN ('Admin upload access','Admin delete access','review_verifications_owner_read');
  SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) INTO before_functions FROM pg_proc p
    WHERE pronamespace IN ('public'::regnamespace,'privacy_retention'::regnamespace,'review_media_private'::regnamespace);
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') INTO before_members FROM pg_auth_members m;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key) INTO before_manifest FROM privacy_retention.g014_catalog_contract_manifest m;
  SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) INTO before_schema FROM pg_namespace n;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid='storage.objects'::regclass
    AND polname IN ('Admin upload access','Admin delete access')) NOT IN (0,2)
    THEN RAISE EXCEPTION 'STORAGE_ADMIN_POLICY_INVENTORY_DRIFT'; END IF;
  FOR item IN SELECT * FROM (VALUES ('Admin upload access','a'::"char"),('Admin delete access','d'::"char")) AS expected(name,cmd) LOOP
    SELECT p.*,pg_get_expr(polqual,polrelid) AS using_expr,pg_get_expr(polwithcheck,polrelid) AS check_expr INTO actual
      FROM pg_policy p WHERE polrelid='storage.objects'::regclass AND polname=item.name;
    IF NOT FOUND THEN CONTINUE; END IF;
    IF NOT actual.polpermissive OR actual.polcmd<>item.cmd OR actual.polroles<>ARRAY[0::oid]
      OR (CASE WHEN item.cmd='a' THEN actual.using_expr IS NOT NULL ELSE actual.check_expr IS NOT NULL END)
      OR coalesce(CASE WHEN item.cmd='a' THEN actual.check_expr ELSE actual.using_expr END,'') NOT IN (
        '((bucket_id = ''ad-banner-images''::text) AND is_user_admin(uid()))',
        '((bucket_id = ''ad-banner-images''::text) AND is_user_admin(auth.uid()))')
      OR (SELECT count(*) FROM pg_depend WHERE classid='pg_policy'::regclass AND objid=actual.oid
          AND refclassid='pg_proc'::regclass AND refobjid='public.is_user_admin(uuid)'::regprocedure)<>1
      OR (SELECT count(*) FROM pg_depend WHERE classid='pg_policy'::regclass AND objid=actual.oid
          AND refclassid='pg_proc'::regclass AND refobjid='auth.uid()'::regprocedure)<>1
      THEN RAISE EXCEPTION 'STORAGE_ADMIN_POLICY_SOURCE_DRIFT'; END IF;
    EXECUTE format('ALTER POLICY %I ON storage.objects TO authenticated %s (%s)',item.name,
      CASE WHEN item.cmd='a' THEN 'WITH CHECK' ELSE 'USING' END,expression);
  END LOOP;
  SELECT p.*,pg_get_expr(polqual,polrelid) AS using_expr,pg_get_expr(polwithcheck,polrelid) AS check_expr INTO actual
    FROM pg_policy p WHERE polrelid='storage.objects'::regclass AND polname='review_verifications_owner_read';
  IF NOT FOUND OR actual.polcmd<>'r' OR NOT actual.polpermissive
    OR actual.polroles<>ARRAY['authenticated'::regrole::oid] OR actual.check_expr IS NOT NULL
    OR replace(actual.using_expr,'auth.uid()','uid()') IS DISTINCT FROM
      '((bucket_id = ''review-verifications''::text) AND (((storage.foldername(name))[1] = ( SELECT (uid())::text AS uid)) OR has_role(( SELECT uid() AS uid), ''admin''::app_role)))'
    OR (SELECT count(*) FROM pg_depend WHERE classid='pg_policy'::regclass AND objid=actual.oid
      AND refclassid='pg_proc'::regclass AND refobjid='public.has_role(uuid,public.app_role)'::regprocedure)<>1
    THEN RAISE EXCEPTION 'STORAGE_OWNER_READ_SOURCE_DRIFT'; END IF;
  ALTER POLICY review_verifications_owner_read ON storage.objects TO authenticated
    USING (bucket_id='review-verifications' AND (storage.foldername(name))[1]=(SELECT auth.uid()::text));
  IF (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY oid),'[]') FROM pg_policy p
        WHERE polrelid<>'storage.objects'::regclass OR polname NOT IN ('Admin upload access','Admin delete access','review_verifications_owner_read')) IS DISTINCT FROM before_other
    OR (SELECT jsonb_agg(to_jsonb(p) ORDER BY oid) FROM pg_proc p
        WHERE pronamespace IN ('public'::regnamespace,'privacy_retention'::regnamespace,'review_media_private'::regnamespace)) IS DISTINCT FROM before_functions
    OR (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') FROM pg_auth_members m) IS DISTINCT FROM before_members
    OR (SELECT jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key) FROM privacy_retention.g014_catalog_contract_manifest m) IS DISTINCT FROM before_manifest
    OR (SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) FROM pg_namespace n) IS DISTINCT FROM before_schema
    THEN RAISE EXCEPTION 'STORAGE_ADMIN_POLICY_PRESERVATION_DRIFT'; END IF;
END $forward$;
-- STORAGE_CALLER_BOUND_ADMIN_READBACK_BEGIN
DO $readback$
DECLARE item record; policy_row record; expression text;
BEGIN
  IF EXISTS(SELECT 1 FROM pg_depend d JOIN pg_policy p ON d.classid='pg_policy'::regclass AND d.objid=p.oid
    WHERE p.polrelid='storage.objects'::regclass AND d.refclassid='pg_proc'::regclass
      AND d.refobjid IN ('public.is_user_admin(uuid)'::regprocedure,'public.has_role(uuid,public.app_role)'::regprocedure))
    OR has_function_privilege('anon','public.is_user_admin(uuid)','EXECUTE')
    OR has_function_privilege('authenticated','public.is_user_admin(uuid)','EXECUTE')
    OR has_function_privilege('service_role','public.is_user_admin(uuid)','EXECUTE')
    THEN RAISE EXCEPTION 'STORAGE_ADMIN_POLICY_READBACK_DRIFT'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid='storage.objects'::regclass AND polname='review_verifications_owner_read'
    AND polcmd='r' AND polpermissive AND polroles=ARRAY['authenticated'::regrole::oid] AND polwithcheck IS NULL
    AND replace(pg_get_expr(polqual,polrelid),'auth.uid()','uid()')='((bucket_id = ''review-verifications''::text) AND ((storage.foldername(name))[1] = ( SELECT (uid())::text AS uid)))')
    THEN RAISE EXCEPTION 'STORAGE_OWNER_READ_READBACK_DRIFT'; END IF;
  FOR item IN SELECT * FROM (VALUES ('Admin upload access','a'::"char"),('Admin delete access','d'::"char")) AS expected(name,cmd) LOOP
    SELECT p.*,pg_get_expr(polqual,polrelid) AS using_expr,pg_get_expr(polwithcheck,polrelid) AS check_expr INTO policy_row
      FROM pg_policy p WHERE polrelid='storage.objects'::regclass AND polname=item.name;
    IF NOT FOUND THEN CONTINUE; END IF;
    expression:=coalesce(CASE WHEN item.cmd='a' THEN policy_row.check_expr ELSE policy_row.using_expr END,'');
    IF NOT policy_row.polpermissive OR policy_row.polcmd<>item.cmd
      OR policy_row.polroles<>ARRAY['authenticated'::regrole::oid]
      OR (CASE WHEN item.cmd='a' THEN policy_row.using_expr IS NOT NULL ELSE policy_row.check_expr IS NOT NULL END)
      OR encode(sha256(convert_to(regexp_replace(replace(expression,'auth.uid()','uid()'),'[[:space:]]+',' ','g'),'UTF8')),'hex')<>'049d579041975ddfaa0c560f56e4c57ee06099b2290f742636ba5bd9345463df'
      OR (SELECT count(*) FROM pg_depend WHERE classid='pg_policy'::regclass AND objid=policy_row.oid
        AND refclassid='pg_proc'::regclass AND refobjid='auth.uid()'::regprocedure)<>1
      THEN RAISE EXCEPTION 'STORAGE_ADMIN_POLICY_READBACK_DRIFT'; END IF;
  END LOOP;
END $readback$;
-- STORAGE_CALLER_BOUND_ADMIN_READBACK_END
COMMIT;
