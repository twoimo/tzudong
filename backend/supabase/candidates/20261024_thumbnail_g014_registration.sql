-- DRAFT / UNAPPLIED: exact G014 registration companion for the thumbnail candidate.
-- No BEGIN/COMMIT and no role grant. A separately admitted outer migration must
-- run full G014 before queue creation with the temporary owner lease absent,
-- install the pinned queue, then run this block with its separately admitted
-- lease. Revoke that self-grant BEFORE full G014 post and preserve the provider's
-- bootstrap membership. All stages and the ledger belong to one outer commit.
-- This block alone is NOT a queue/bucket installer or a full G014 certificate.
DO $thumbnail_g014_registration$
DECLARE
  new_signatures text[] := ARRAY['public.thumbnail_production_auth_worker(text)','public.thumbnail_production_admin(uuid,text,uuid,uuid,text,text,jsonb)','public.thumbnail_production_worker(text,text,uuid,uuid,bigint,text,jsonb)'];
  item record; target oid; source_before text; source_after text; definition_before text;
  anchor text; addition text := $addition$      'public.thumbnail_production_auth_worker(text)',
      'public.thumbnail_production_admin(uuid,text,uuid,uuid,text,text,jsonb)',
      'public.thumbnail_production_worker(text,text,uuid,uuid,bigint,text,jsonb)',
$addition$;
  metadata_before jsonb; metadata_after jsonb; registry_before jsonb; registry_after jsonb;
  old_registry_digest text; rpc_before jsonb; rpc_after jsonb; source_bytes integer;
BEGIN
  IF current_user <> 'postgres' OR current_setting('is_superuser') <> 'off'
    OR current_setting('transaction_read_only') <> 'off'
    OR current_setting('transaction_isolation') <> 'read committed'
    OR NOT pg_catalog.pg_has_role('postgres','privacy_workflow_owner','SET') THEN
    RAISE EXCEPTION 'thumbnail_g014_executor_not_admitted' USING ERRCODE='42501';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('thumbnail-g014-registration-v1',0));
  EXECUTE 'SET LOCAL ROLE privacy_workflow_owner';
  LOCK TABLE privacy_retention.g014_public_rpc_allowlist IN SHARE ROW EXCLUSIVE MODE;
  -- Bound visible rows and text before sorting/serializing the registry.
  -- This is not a bound on physical MVCC/IO work or arbitrary privileged DDL.
  IF (SELECT count(*) FROM (SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist LIMIT 138) bounded)<>137 THEN
    RAISE EXCEPTION 'thumbnail_g014_registry_cardinality_drift' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist
      WHERE octet_length(identity_arguments)>4096 OR octet_length(source_signature)>4096) THEN
    RAISE EXCEPTION 'thumbnail_g014_registry_size_drift' USING ERRCODE='55000';
  END IF;
  SELECT jsonb_build_object(
 'role',(SELECT jsonb_build_object('login',rolcanlogin,'super',rolsuper,'inherit',rolinherit,'createDb',rolcreatedb,'bypassRls',rolbypassrls,'createRole',rolcreaterole,'replication',rolreplication) FROM pg_catalog.pg_roles WHERE rolname='privacy_workflow_owner'),
 'schema',(SELECT jsonb_build_object('acl',nspacl::text,'owner',pg_catalog.pg_get_userbyid(nspowner)) FROM pg_catalog.pg_namespace WHERE nspname='privacy_retention'),
 'relation',(SELECT jsonb_build_object('acl',relacl::text,'rls',relrowsecurity,'force',relforcerowsecurity,'owner',pg_catalog.pg_get_userbyid(relowner)) FROM pg_catalog.pg_class WHERE oid='privacy_retention.g014_public_rpc_allowlist'::pg_catalog.regclass),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_catalog.pg_policies p WHERE schemaname='privacy_retention' AND tablename='g014_public_rpc_allowlist'),
 'nonInternalTriggers',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'definition',pg_catalog.pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_catalog.pg_trigger WHERE tgrelid='privacy_retention.g014_public_rpc_allowlist'::pg_catalog.regclass AND NOT tgisinternal),'[]'::jsonb),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_catalog.pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_catalog.pg_constraint WHERE conrelid='privacy_retention.g014_public_rpc_allowlist'::pg_catalog.regclass)) INTO registry_before;
  IF registry_before IS DISTINCT FROM $expected${"role":{"login":false,"super":false,"inherit":false,"createDb":false,"bypassRls":false,"createRole":false,"replication":false},"schema":{"acl":"{privacy_workflow_owner=UC/privacy_workflow_owner,privacy_retention_operator_approver=U/privacy_workflow_owner,privacy_retention_legal_approver=U/privacy_workflow_owner,privacy_retention_activation_operator=U/privacy_workflow_owner}","owner":"privacy_workflow_owner"},"policies":[{"cmd":"ALL","qual":"true","roles":["privacy_workflow_owner"],"tablename":"g014_public_rpc_allowlist","permissive":"PERMISSIVE","policyname":"g014_privacy_workflow_owner_access","schemaname":"privacy_retention","with_check":"true"}],"relation":{"acl":"{privacy_workflow_owner=arwdDxtm/privacy_workflow_owner}","rls":true,"force":true,"owner":"privacy_workflow_owner"},"constraints":[{"name":"g014_public_rpc_allowlist_grantee_check","definition":"CHECK ((grantee = ANY (ARRAY['anon'::name, 'authenticated'::name, 'service_role'::name])))"},{"name":"g014_public_rpc_allowlist_pkey","definition":"PRIMARY KEY (function_schema, function_name, identity_arguments, grantee)"},{"name":"g014_public_rpc_allowlist_source_signature_grantee_key","definition":"UNIQUE (source_signature, grantee)"}],"nonInternalTriggers":[]}$expected$::jsonb THEN
    RAISE EXCEPTION 'thumbnail_g014_registry_boundary_drift' USING ERRCODE='55000';
  END IF;
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((SELECT jsonb_agg(jsonb_build_array(function_schema,function_name,identity_arguments,grantee,source_signature)
 ORDER BY function_schema::text COLLATE "C",function_name::text COLLATE "C",identity_arguments COLLATE "C",grantee::text COLLATE "C",source_signature COLLATE "C")::text
 FROM privacy_retention.g014_public_rpc_allowlist WHERE NOT (source_signature=ANY(new_signatures))), 'UTF8')),'hex') INTO old_registry_digest;
  IF old_registry_digest IS DISTINCT FROM 'e18337a71017c051d5e8dd1624806010a07d756aa11b2ffb1338005421ee2c16'
    OR (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist) <> 137
    OR EXISTS (SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=ANY(new_signatures)) THEN
    RAISE EXCEPTION 'thumbnail_g014_registry_drift' USING ERRCODE='55000';
  END IF;
  IF (SELECT count(*) FROM (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname IN ('thumbnail_production_auth_worker','thumbnail_production_admin','thumbnail_production_worker') LIMIT 4) bounded)<>3 THEN
    RAISE EXCEPTION 'thumbnail_g014_rpc_overload_drift' USING ERRCODE='55000';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
      WHERE p.oid=ANY(ARRAY(SELECT pg_catalog.to_regprocedure(signature)::oid FROM unnest(new_signatures) signature))
        AND (octet_length(p.prosrc)>65536 OR octet_length(p.proargdefaults::text)>65536)) THEN
    RAISE EXCEPTION 'thumbnail_g014_rpc_size_drift' USING ERRCODE='55000';
  END IF;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) INTO rpc_before FROM pg_catalog.pg_proc p
    WHERE p.oid=ANY(ARRAY(SELECT pg_catalog.to_regprocedure(signature)::oid FROM unnest(new_signatures) signature));
  FOR item IN SELECT * FROM (VALUES
      ('public.thumbnail_production_auth_worker(text)','7f653bfab4f42410d3aee41128fe9f87ff0f139b1a78509633b39f70e73227c3',ARRAY['p_token_sha256']::text[],0,''),
      ('public.thumbnail_production_admin(uuid,text,uuid,uuid,text,text,jsonb)','54cedae0c0196b81f512294745658a1467b055448565c4942947f88a56fe87db',ARRAY['p_owner_id','p_action','p_job_id','p_request_id','p_input_sha256','p_model','p_input']::text[],5,'NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::jsonb'),
      ('public.thumbnail_production_worker(text,text,uuid,uuid,bigint,text,jsonb)','911c5d0b9aff9281dbc96b3719c62a011fe8a93b643604ddb112ad0ad5ce4e6f',ARRAY['p_token_sha256','p_action','p_job_id','p_attempt_id','p_fence','p_input_sha256','p_payload']::text[],5,'NULL::uuid, NULL::uuid, NULL::bigint, NULL::text, ''{}''::jsonb')
  ) expected(signature,body_sha256,arg_names,default_count,defaults) LOOP
    target := pg_catalog.to_regprocedure(item.signature);
    IF target IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE p.oid=target AND n.nspname='public' AND p.proowner='postgres'::pg_catalog.regrole
       AND p.prokind='f' AND NOT p.prosecdef AND NOT p.proretset AND p.prorettype='jsonb'::pg_catalog.regtype
       AND p.proargnames=item.arg_names AND p.pronargs=cardinality(item.arg_names) AND p.pronargdefaults=item.default_count
       AND p.proargmodes IS NULL AND p.provariadic=0 AND p.prosupport=0 AND p.procost=100 AND p.prorows=0
       AND NOT p.proisstrict AND NOT p.proleakproof AND p.provolatile='v' AND p.proparallel='u'
       AND COALESCE(pg_catalog.pg_get_expr(p.proargdefaults,0),'')=item.defaults
       AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
       AND p.proconfig=ARRAY['search_path=""']::text[]
       AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')=item.body_sha256
       AND pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
       AND NOT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
       AND NOT pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
       AND NOT EXISTS (SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl,pg_catalog.acldefault('f',p.proowner))) acl
         WHERE acl.grantee NOT IN(p.proowner,'service_role'::pg_catalog.regrole) OR acl.is_grantable)
    ) THEN RAISE EXCEPTION 'thumbnail_g014_rpc_drift' USING ERRCODE='55000'; END IF;
  END LOOP;
  FOR item IN SELECT * FROM (VALUES
    ('privacy_retention.assert_g014_definer_contract()','b9e2f7d812783deee6c91d27d22d6c2019be9aa04e4f1221cc7482567775354a','v_signature'),
    ('privacy_retention.assert_g014_catalog_contract()','50948ddce54dbba9497978964bebc535c27ebe98fb0f46bf05e2ec17ab0b9e01','v_expected.source_signature')
  ) expected(signature,body_sha256,variable) LOOP
    target:=pg_catalog.to_regprocedure(item.signature);
    SELECT octet_length(prosrc) INTO source_bytes FROM pg_catalog.pg_proc WHERE oid=target;
    IF source_bytes IS NULL OR source_bytes>65536 THEN
      RAISE EXCEPTION 'thumbnail_g014_assertion_size_drift' USING ERRCODE='55000';
    END IF;
    SELECT p.prosrc,pg_catalog.pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc'
      INTO source_before,definition_before,metadata_before FROM pg_catalog.pg_proc p
      WHERE p.oid=target AND p.proowner='privacy_workflow_owner'::pg_catalog.regrole
       AND p.prosecdef AND p.prokind='f' AND p.prorettype='void'::pg_catalog.regtype AND NOT p.proretset
       AND p.prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='plpgsql')
       AND p.pronargs=0 AND p.proargnames IS NULL AND p.proargmodes IS NULL AND p.proargdefaults IS NULL
       AND p.pronargdefaults=0 AND p.provariadic=0 AND p.prosupport=0 AND p.procost=100 AND p.prorows=0
       AND NOT p.proisstrict AND NOT p.proleakproof AND p.provolatile='v' AND p.proparallel='u'
       AND p.proconfig=ARRAY['search_path=""']::text[]
       AND p.proacl::text='{privacy_workflow_owner=X/privacy_workflow_owner}';
    anchor:='    IF '||item.variable||E' IN (\n      ''public.extract_youtube_video_id(text)'',\n';
    IF source_before IS NULL OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source_before,'UTF8')),'hex')<>item.body_sha256
      OR (length(source_before)-length(replace(source_before,anchor,'')))/length(anchor)<>1
      OR (length(definition_before)-length(replace(definition_before,source_before,'')))/length(source_before)<>1 THEN
      RAISE EXCEPTION 'thumbnail_g014_assertion_source_drift' USING ERRCODE='55000';
    END IF;
    source_after:=replace(source_before,anchor,split_part(anchor,E'\n',1)||E'\n'||addition||substring(anchor FROM strpos(anchor,E'\n')+1));
    IF replace(source_after,addition,'') IS DISTINCT FROM source_before THEN
      RAISE EXCEPTION 'thumbnail_g014_assertion_patch_drift' USING ERRCODE='55000';
    END IF;
    EXECUTE replace(definition_before,source_before,source_after);
    SELECT to_jsonb(p)-'prosrc' INTO metadata_after FROM pg_catalog.pg_proc p WHERE p.oid=target;
    IF metadata_after IS DISTINCT FROM metadata_before OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid=target) IS DISTINCT FROM source_after THEN
      RAISE EXCEPTION 'thumbnail_g014_assertion_readback_drift' USING ERRCODE='55000';
    END IF;
  END LOOP;
  INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature)
    SELECT n.nspname,p.proname,p.proargtypes::text,'service_role',signature
    FROM unnest(new_signatures) signature JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(signature)
    JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace;
  IF (SELECT count(*) FROM (SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist LIMIT 141) bounded)<>140 THEN
    RAISE EXCEPTION 'thumbnail_g014_registry_readback_drift' USING ERRCODE='55000';
  END IF;
  SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to((SELECT jsonb_agg(jsonb_build_array(function_schema,function_name,identity_arguments,grantee,source_signature)
 ORDER BY function_schema::text COLLATE "C",function_name::text COLLATE "C",identity_arguments COLLATE "C",grantee::text COLLATE "C",source_signature COLLATE "C")::text
 FROM privacy_retention.g014_public_rpc_allowlist WHERE NOT (source_signature=ANY(new_signatures))), 'UTF8')),'hex') INTO old_registry_digest;
  SELECT jsonb_build_object(
 'role',(SELECT jsonb_build_object('login',rolcanlogin,'super',rolsuper,'inherit',rolinherit,'createDb',rolcreatedb,'bypassRls',rolbypassrls,'createRole',rolcreaterole,'replication',rolreplication) FROM pg_catalog.pg_roles WHERE rolname='privacy_workflow_owner'),
 'schema',(SELECT jsonb_build_object('acl',nspacl::text,'owner',pg_catalog.pg_get_userbyid(nspowner)) FROM pg_catalog.pg_namespace WHERE nspname='privacy_retention'),
 'relation',(SELECT jsonb_build_object('acl',relacl::text,'rls',relrowsecurity,'force',relforcerowsecurity,'owner',pg_catalog.pg_get_userbyid(relowner)) FROM pg_catalog.pg_class WHERE oid='privacy_retention.g014_public_rpc_allowlist'::pg_catalog.regclass),
 'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_catalog.pg_policies p WHERE schemaname='privacy_retention' AND tablename='g014_public_rpc_allowlist'),
 'nonInternalTriggers',COALESCE((SELECT jsonb_agg(jsonb_build_object('name',tgname,'enabled',tgenabled,'definition',pg_catalog.pg_get_triggerdef(oid)) ORDER BY tgname) FROM pg_catalog.pg_trigger WHERE tgrelid='privacy_retention.g014_public_rpc_allowlist'::pg_catalog.regclass AND NOT tgisinternal),'[]'::jsonb),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_catalog.pg_get_constraintdef(oid)) ORDER BY conname) FROM pg_catalog.pg_constraint WHERE conrelid='privacy_retention.g014_public_rpc_allowlist'::pg_catalog.regclass)) INTO registry_after;
  IF old_registry_digest IS DISTINCT FROM 'e18337a71017c051d5e8dd1624806010a07d756aa11b2ffb1338005421ee2c16' OR registry_after IS DISTINCT FROM registry_before
    OR (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist)<>140
    OR (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist r JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(r.source_signature)
      JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
      WHERE r.source_signature=ANY(new_signatures) AND r.function_schema=n.nspname AND r.function_name=p.proname
       AND r.identity_arguments=p.proargtypes::text AND r.grantee='service_role')<>3 THEN
    RAISE EXCEPTION 'thumbnail_g014_registry_readback_drift' USING ERRCODE='55000';
  END IF;
  SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) INTO rpc_after FROM pg_catalog.pg_proc p
    WHERE p.oid=ANY(ARRAY(SELECT pg_catalog.to_regprocedure(signature)::oid FROM unnest(new_signatures) signature));
  IF rpc_after IS DISTINCT FROM rpc_before THEN
    RAISE EXCEPTION 'thumbnail_g014_rpc_readback_drift' USING ERRCODE='55000';
  END IF;
  EXECUTE 'SET LOCAL ROLE postgres';
END;
$thumbnail_g014_registration$;
