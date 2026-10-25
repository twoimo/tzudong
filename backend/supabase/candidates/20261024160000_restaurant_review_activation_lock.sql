-- Private candidate: review activation lock repair after exact budget ledger 91.
-- The unchanged atomic compiler owns ledger and transaction; its caller takes
-- tzudong:review-media-sql-successor:workflow:v1 before the ledger lock.
-- No assertion grants, component owner lease, policy activation or table grants.

-- A per-transaction marker makes psql per-statement autocommit fail before any
-- persistent feature/role change. It is an accident guard, not an auth token.
DO $review_activation_install_transaction$
BEGIN
  IF current_user<>'postgres' OR session_user<>'postgres'
     OR pg_catalog.current_setting('is_superuser')<>'off'
     OR pg_catalog.current_setting('server_version_num')::integer<>170006
     OR pg_catalog.current_setting('transaction_read_only')<>'off'
     OR pg_catalog.current_setting('transaction_isolation')<>'read committed' THEN
    RAISE EXCEPTION 'review_activation_install_executor_denied' USING ERRCODE='42501';
  END IF;
  PERFORM pg_catalog.set_config('search_path','',true);
  PERFORM pg_catalog.set_config('review_activation_install.xact',pg_catalog.pg_current_xact_id()::text,true);
END $review_activation_install_transaction$;

DO $review_activation_install_pre$
DECLARE before_members jsonb; after_members jsonb; assertion_metadata jsonb; checker oid;
BEGIN
  IF pg_catalog.current_setting('review_activation_install.xact',true) IS DISTINCT FROM pg_catalog.pg_current_xact_id_if_assigned()::text
     OR pg_catalog.current_setting('review_activation_install.xact',true) IS NULL THEN
    RAISE EXCEPTION 'review_activation_install_outer_transaction_required' USING ERRCODE='25000';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tzudong:review-activation-install:v2',0));
  IF pg_catalog.to_regclass('pg_temp.review_activation_install_before') IS NOT NULL
     OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace=pg_catalog.pg_my_temp_schema() AND proname='review_activation_install_g014_check') THEN
    RAISE EXCEPTION 'review_activation_install_prior_conflict' USING ERRCODE='55000';
  END IF;
  IF pg_catalog.pg_has_role('postgres','privacy_workflow_owner','SET')
     OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','USAGE')
     OR (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole)<>1
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole AND member='postgres'::regrole
       AND grantor='supabase_admin'::regrole AND admin_option AND NOT inherit_option AND NOT set_option) THEN
    RAISE EXCEPTION 'review_activation_install_membership_denied' USING ERRCODE='42501';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='privacy_retention' AND p.proname IN ('assert_g014_workflow_owner_contract','assert_g014_public_rpc_allowlist','assert_g014_definer_contract','assert_g014_catalog_contract'))<>4
     OR EXISTS(SELECT 1 FROM (VALUES
       ('privacy_retention.assert_g014_workflow_owner_contract()','345aed9acb1da06262740ef06d81e51855a44c7470aa8b431a23e6fa629aab1d',false),
       ('privacy_retention.assert_g014_public_rpc_allowlist()','f23203a0a2366eca16b30b256729e859efc556952df8cb75485924153e1188ef',true),
       ('privacy_retention.assert_g014_definer_contract()','bb8dc8d2e4020f70b2332cbdf6acf465a97cbc4d582f9f14415330247ae34131',true),
       ('privacy_retention.assert_g014_catalog_contract()','5c5971a5578e09db25a41e88474f1da15acfbd658571ba28f29e8c226e4d1883',true)
     ) expected(signature,body_sha256,definer)
     LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(expected.signature)
     WHERE p.oid IS NULL OR p.proowner<>'privacy_workflow_owner'::regrole OR p.prosecdef IS DISTINCT FROM expected.definer
       OR p.prokind<>'f' OR p.prorettype<>'void'::regtype OR p.proretset OR p.pronargs<>0
       OR p.proargnames IS NOT NULL OR p.proargmodes IS NOT NULL OR p.proargdefaults IS NOT NULL
       OR p.pronargdefaults<>0 OR p.provariadic<>0 OR p.prosupport<>0 OR p.procost<>100 OR p.prorows<>0
       OR p.proisstrict OR p.proleakproof OR p.provolatile<>'v' OR p.proparallel<>'u'
       OR p.prolang<>(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
       OR p.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
       OR p.proacl::text IS DISTINCT FROM '{privacy_workflow_owner=X/privacy_workflow_owner}'
       OR pg_catalog.octet_length(p.prosrc)>65536
       OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')<>expected.body_sha256) THEN
    RAISE EXCEPTION 'review_activation_install_assertion_source_drift' USING ERRCODE='55000';
  END IF;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO before_members FROM pg_catalog.pg_auth_members m;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) INTO assertion_metadata FROM pg_catalog.pg_proc p
    WHERE p.oid=ANY(ARRAY['privacy_retention.assert_g014_workflow_owner_contract()'::regprocedure,
      'privacy_retention.assert_g014_public_rpc_allowlist()'::regprocedure,
      'privacy_retention.assert_g014_definer_contract()'::regprocedure,
      'privacy_retention.assert_g014_catalog_contract()'::regprocedure]::oid[]);
  CREATE TEMPORARY TABLE pg_temp.review_activation_install_before(memberships jsonb NOT NULL,assertions jsonb NOT NULL,unchanged jsonb NOT NULL) ON COMMIT DROP;
  INSERT INTO pg_temp.review_activation_install_before VALUES(before_members,assertion_metadata,jsonb_build_object(
    'configureMetadata',(SELECT to_jsonb(p)-'prosrc' FROM pg_catalog.pg_proc p
      WHERE p.oid='public.restaurant_review_automation_configure(uuid,text,text,text,integer,integer)'::regprocedure),
    'helpers',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_proc p WHERE p.oid IN (
      'pipeline_control.lock_restaurant_review_catalog_revision()'::regprocedure,
      'pipeline_control.assert_restaurant_review_operator(uuid)'::regprocedure,
      'pipeline_control.bump_admin_evaluation_revision()'::regprocedure,
      'public.admin_evaluation_revision()'::regprocedure)),
    'tables',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.oid)
      FROM pg_catalog.pg_class c WHERE c.relnamespace='pipeline_control'::regnamespace AND c.relkind='r'),
    'policies',(SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]'::jsonb) FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
      WHERE c.relnamespace='pipeline_control'::regnamespace),
    'namespaces',(SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_catalog.pg_namespace n
      WHERE n.oid IN ('pipeline_control'::regnamespace,'privacy_retention'::regnamespace)),
    'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_catalog.pg_roles r),
    'defaults',(SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.oid),'[]'::jsonb) FROM pg_catalog.pg_default_acl d)));
  GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE,INHERIT FALSE,SET TRUE GRANTED BY postgres;
  SET LOCAL ROLE privacy_workflow_owner;
  CREATE FUNCTION pg_temp.review_activation_install_g014_check(p_phase text) RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $check$
  BEGIN
    IF session_user<>'postgres' OR current_user<>'privacy_workflow_owner' OR p_phase IS NULL OR p_phase NOT IN ('pre','post') THEN
      RAISE EXCEPTION 'review_activation_install_check_caller_denied' USING ERRCODE='42501';
    END IF;
    PERFORM privacy_retention.assert_g014_workflow_owner_contract();
    PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
    PERFORM privacy_retention.assert_g014_definer_contract();
    PERFORM privacy_retention.assert_g014_catalog_contract();
    IF p_phase='post' THEN DROP FUNCTION pg_temp.review_activation_install_g014_check(text); END IF;
  END $check$;
  REVOKE ALL ON FUNCTION pg_temp.review_activation_install_g014_check(text) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION pg_temp.review_activation_install_g014_check(text) TO postgres;
  SET LOCAL ROLE postgres;
  REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO after_members FROM pg_catalog.pg_auth_members m;
  IF after_members IS DISTINCT FROM before_members THEN
    RAISE EXCEPTION 'review_activation_install_pre_membership_drift' USING ERRCODE='55000';
  END IF;
  checker:=pg_catalog.to_regprocedure('pg_temp.review_activation_install_g014_check(text)');
  IF checker IS NULL OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=checker
      AND p.proowner='privacy_workflow_owner'::regrole AND p.prosecdef AND p.proconfig=ARRAY['search_path=""']::text[]
      AND (SELECT count(*)=2 AND bool_and(a.privilege_type='EXECUTE' AND NOT a.is_grantable
        AND a.grantee IN ('postgres'::regrole,'privacy_workflow_owner'::regrole)) FROM pg_catalog.aclexplode(p.proacl) a)) THEN
    RAISE EXCEPTION 'review_activation_install_bridge_drift' USING ERRCODE='55000';
  END IF;
  PERFORM pg_temp.review_activation_install_g014_check('pre');
END $review_activation_install_pre$;

-- BEGIN CONFIGURE COMPONENT: exact old-to-new prosrc replacement
-- Repair service-only activation using the already installed fixed lock helper.
-- Preserve the public SECURITY INVOKER identity, actor check, preview token and limits.
-- No table grants, helper creation, policy activation or provider calls.
DO $review_activation_lock$
DECLARE
  target oid := 'public.restaurant_review_automation_configure(uuid,text,text,text,integer,integer)'::regprocedure;
  helper oid := 'pipeline_control.lock_restaurant_review_catalog_revision()'::regprocedure;
  source text; before_meta jsonb; after_meta jsonb;
  old_sha constant text := '6fe71abbb6fd73ce34758f5584b6bf5ad6d033f075c22b64161a710d69da1c57';
  new_sha constant text := '602fffdcdc81fd7b96c70a40ff04a225c53c9a43c4320b778681cd5e7237bf5c';
  anchor constant text := $anchor$    PERFORM 1 FROM pipeline_control.admin_evaluation_catalog_revision WHERE singleton FOR UPDATE;$anchor$;
  replacement constant text := '    PERFORM pipeline_control.lock_restaurant_review_catalog_revision();';
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres'
    THEN RAISE EXCEPTION 'REVIEW_ACTIVATION_LOCK_EXECUTOR'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=helper
    AND p.proowner='postgres'::regrole AND p.prosecdef
    AND p.prorettype='void'::regtype AND p.pronargs=0 AND p.pronargdefaults=0
    AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
    AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
    AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset
    AND p.proconfig=ARRAY['search_path=""','lock_timeout=2s']::text[]
    AND p.proacl=ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[]
    AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')=
      '5fe3230899d7669896f562b5a7afa5e088761b3ecc26f531c13cf0953a569413')
    OR pg_catalog.has_function_privilege('anon',helper,'EXECUTE')
    OR pg_catalog.has_function_privilege('authenticated',helper,'EXECUTE')
    OR NOT pg_catalog.has_function_privilege('service_role',helper,'EXECUTE')
    OR pg_catalog.has_table_privilege('service_role','pipeline_control.admin_evaluation_catalog_revision','UPDATE')
    THEN RAISE EXCEPTION 'REVIEW_ACTIVATION_LOCK_HELPER_DRIFT'; END IF;
  SELECT p.prosrc,pg_catalog.to_jsonb(p)-'prosrc' INTO source,before_meta
    FROM pg_catalog.pg_proc p WHERE p.oid=target;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p WHERE p.oid=target
    AND p.proowner='postgres'::regrole AND NOT p.prosecdef
    AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
    AND p.prorettype='jsonb'::regtype AND p.prokind='f' AND p.provolatile='v' AND p.proparallel='u'
    AND NOT p.proisstrict AND NOT p.proleakproof AND NOT p.proretset
    AND p.proconfig=ARRAY['search_path=""']::text[]
    AND p.proacl=ARRAY['postgres=X/postgres','service_role=X/postgres']::aclitem[])
    THEN RAISE EXCEPTION 'REVIEW_ACTIVATION_LOCK_METADATA_DRIFT'; END IF;
  IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source,'UTF8')),'hex') <> new_sha THEN
    IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source,'UTF8')),'hex') <> old_sha
      OR (pg_catalog.length(source)-pg_catalog.length(pg_catalog.replace(source,anchor,''))) <> pg_catalog.length(anchor)
      THEN RAISE EXCEPTION 'REVIEW_ACTIVATION_LOCK_SOURCE_DRIFT'; END IF;
    EXECUTE pg_catalog.replace(pg_catalog.pg_get_functiondef(target),source,pg_catalog.replace(source,anchor,replacement));
  END IF;
  SELECT p.prosrc,pg_catalog.to_jsonb(p)-'prosrc' INTO source,after_meta
    FROM pg_catalog.pg_proc p WHERE p.oid=target;
  IF after_meta IS DISTINCT FROM before_meta
    OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source,'UTF8')),'hex') <> new_sha
    THEN RAISE EXCEPTION 'REVIEW_ACTIVATION_LOCK_READBACK_DRIFT'; END IF;
END;
$review_activation_lock$;

-- END CONFIGURE COMPONENT

DO $review_activation_install_post$
DECLARE observed_members jsonb; observed_assertions jsonb; unchanged jsonb;
BEGIN
  IF current_user<>'postgres' OR session_user<>'postgres'
     OR pg_catalog.current_setting('review_activation_install.xact',true) IS DISTINCT FROM pg_catalog.pg_current_xact_id_if_assigned()::text THEN
    RAISE EXCEPTION 'review_activation_install_post_executor_denied' USING ERRCODE='42501';
  END IF;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO observed_members FROM pg_catalog.pg_auth_members m;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) INTO observed_assertions FROM pg_catalog.pg_proc p
    WHERE p.oid=ANY(ARRAY['privacy_retention.assert_g014_workflow_owner_contract()'::regprocedure,
      'privacy_retention.assert_g014_public_rpc_allowlist()'::regprocedure,
      'privacy_retention.assert_g014_definer_contract()'::regprocedure,
      'privacy_retention.assert_g014_catalog_contract()'::regprocedure]::oid[]);
  SELECT jsonb_build_object(
    'configureMetadata',(SELECT to_jsonb(p)-'prosrc' FROM pg_catalog.pg_proc p
      WHERE p.oid='public.restaurant_review_automation_configure(uuid,text,text,text,integer,integer)'::regprocedure),
    'helpers',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_proc p WHERE p.oid IN (
      'pipeline_control.lock_restaurant_review_catalog_revision()'::regprocedure,
      'pipeline_control.assert_restaurant_review_operator(uuid)'::regprocedure,
      'pipeline_control.bump_admin_evaluation_revision()'::regprocedure,
      'public.admin_evaluation_revision()'::regprocedure)),
    'tables',(SELECT jsonb_agg(jsonb_build_array(c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity) ORDER BY c.oid)
      FROM pg_catalog.pg_class c WHERE c.relnamespace='pipeline_control'::regnamespace AND c.relkind='r'),
    'policies',(SELECT COALESCE(jsonb_agg(to_jsonb(p) ORDER BY p.oid),'[]'::jsonb) FROM pg_catalog.pg_policy p JOIN pg_catalog.pg_class c ON c.oid=p.polrelid
      WHERE c.relnamespace='pipeline_control'::regnamespace),
    'namespaces',(SELECT jsonb_agg(to_jsonb(n) ORDER BY n.oid) FROM pg_catalog.pg_namespace n
      WHERE n.oid IN ('pipeline_control'::regnamespace,'privacy_retention'::regnamespace)),
    'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY r.oid) FROM pg_catalog.pg_roles r),
    'defaults',(SELECT COALESCE(jsonb_agg(to_jsonb(d) ORDER BY d.oid),'[]'::jsonb) FROM pg_catalog.pg_default_acl d)) INTO unchanged;
  IF observed_members IS DISTINCT FROM (SELECT b.memberships FROM pg_temp.review_activation_install_before b)
     OR observed_assertions IS DISTINCT FROM (SELECT b.assertions FROM pg_temp.review_activation_install_before b)
     OR unchanged IS DISTINCT FROM (SELECT b.unchanged FROM pg_temp.review_activation_install_before b)
     OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','SET')
     OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','USAGE') THEN
    RAISE EXCEPTION 'review_activation_install_metadata_drift' USING ERRCODE='55000';
  END IF;
  PERFORM pg_temp.review_activation_install_g014_check('post');
  DROP TABLE pg_temp.review_activation_install_before;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE pronamespace=pg_catalog.pg_my_temp_schema() AND proname='review_activation_install_g014_check') THEN
    RAISE EXCEPTION 'review_activation_install_bridge_survived' USING ERRCODE='55000';
  END IF;
END $review_activation_install_post$;
