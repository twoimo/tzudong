-- Integrate exactly the two preceding review-media sources into G014.
-- CLI 2.117.0 generated this new migration. No assertion body or immutable
-- manifest row is changed. Execute the complete transaction; do not split it.
BEGIN;
SET LOCAL lock_timeout = '2s';
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tzudong:review-media-catalog:v1', 0));
CREATE TEMP TABLE review_media_expected (
  signature text PRIMARY KEY, body_sha256 text NOT NULL, final_body_sha256 text NOT NULL, definer boolean NOT NULL,
  volatility text NOT NULL, language text NOT NULL, result text NOT NULL, argument_names text[] NOT NULL
) ON COMMIT DROP;
INSERT INTO review_media_expected VALUES
    ('public.finish_review_media_cleanup()','f7e925a25dedb987a3166c5ca641ba7db1568a7583bdeca3cee04f27d9189f20','f6c4e71988ed2b789b887484af5fdf2e482bde98f1d1c5b5d4e7ad124c314bd1',true,'v','plpgsql','bigint',ARRAY[]::text[]),
    ('public.mutate_review_with_media(uuid,uuid,text,timestamp with time zone,text,text[],text[])','a257b40fae93d0c163653395b3de7fd78bf980ae5ca512f5cb3b2400d3e94c02','a47b34c81605a515df01a6a2da7c5503c0a7abfea6946028b51ed52bb31a8830',true,'v','plpgsql','text',ARRAY['p_operation_id','p_review_id','p_kind','p_expected_updated_at','p_content','p_categories','p_food_photos']::text[]),
    ('public.pending_review_media_cleanup()','21fa71446354fe855508550a3df78ddbe0ad4c1f7007ea905d04bdb98f1ac766','5a92c8f282c895eabaa77f8cf3f452fb659bac33bd519ed8cf439dc1f2905c7b',true,'v','plpgsql','TABLE(path text, owner_id uuid, review_id uuid, purpose text)',ARRAY[]::text[]),
    ('public.queue_review_upload_cleanup(uuid,text[])','00784e9daa9b6b707432200e4df6592010e9f22d2bc9db831bf8329e14bdb453','89c3b573891f598cac5df6ce9a3217639092801a7439ec0404f338f2097114a8',true,'v','plpgsql','text',ARRAY['p_review_id','p_paths']::text[]),
    ('public.read_review_media_commit(uuid,uuid,text)','c7d2e4e111223150ceeda5893310df0e9656e5930823db053135812a69222081','2f14abfc04864f369467f5ac5f0603defa149b8023d7e6b04e2bb8535f8a268e',true,'v','sql','text',ARRAY['p_operation_id','p_review_id','p_kind']::text[]),
    ('public.review_media_delete_allowed(text)','45fd396f240fb1d9fc084f31bd4feea7ee097017f2fd2b8d12df9c2c59152f78','a75dbd787dd388b0761bee11c82a56d5f410688e4cfd953181bce4d613062ae7',true,'v','plpgsql','boolean',ARRAY['p_path']::text[]),
    ('review_media_private.canonical(text,uuid,uuid,text)','87d8397c36cf4c7b986f75cbc2788979333a76be2cc26dc5522cd362f62414a9','87d8397c36cf4c7b986f75cbc2788979333a76be2cc26dc5522cd362f62414a9',false,'i','sql','boolean',ARRAY['p_path','p_owner','p_review','p_purpose']::text[]),
    ('review_media_private.guard_references()','846030547ffd76e17596755d7eee4279dcb9b563361435260826071d2f250d59','846030547ffd76e17596755d7eee4279dcb9b563361435260826071d2f250d59',true,'v','plpgsql','trigger',ARRAY[]::text[]),
    ('review_media_private.lock_changes()','381d89aa6bbf5a59c2ee0fef2a7392ef705147252b324527201b8b6f74376250','381d89aa6bbf5a59c2ee0fef2a7392ef705147252b324527201b8b6f74376250',true,'v','plpgsql','trigger',ARRAY[]::text[]),
    ('review_media_private.owned_legacy(text,uuid,text)','a2d55f09f03fcaeedd77461198511673da7342a6a4873d37227f9cf612090980','a2d55f09f03fcaeedd77461198511673da7342a6a4873d37227f9cf612090980',false,'i','sql','boolean',ARRAY['p_path','p_owner','p_purpose']::text[]),
    ('review_media_private.reference_key(text)','a8910cb09bfd959951045e8b0b8233b1e2a8bdc45073abeebdfc26b552b1dae7','a8910cb09bfd959951045e8b0b8233b1e2a8bdc45073abeebdfc26b552b1dae7',false,'i','plpgsql','text',ARRAY['p_value']::text[]),
    ('review_media_private.referenced(text)','cc295115d85a3a11b380e1378e2ee91b0d9f7f587c68839653f54ed826c398ce','cc295115d85a3a11b380e1378e2ee91b0d9f7f587c68839653f54ed826c398ce',true,'v','sql','boolean',ARRAY['p_path']::text[]);
REVOKE ALL ON pg_temp.review_media_expected FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON pg_temp.review_media_expected TO privacy_workflow_owner;

DO $integration$
DECLARE
  v_expected record; v_function record; v_oid oid;
  v_owner oid := 'privacy_workflow_owner'::regrole;
  v_runner oid := 'postgres'::regrole;
  v_members jsonb; v_assertions jsonb; v_manifest jsonb; v_functions jsonb;
  v_known oid := (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='privacy_retention' AND p.proname='g014_catalog_protected_relations' AND p.pronargs=0);
  v_definition text;
  v_public jsonb;
  v_self jsonb; v_major integer := current_setting('server_version_num')::integer / 10000;
BEGIN
  IF current_user <> 'postgres' OR session_user <> 'postgres' OR v_major NOT IN (15,17)
     OR current_setting('transaction_read_only') <> 'off'
     OR NOT EXISTS (SELECT 1 FROM pg_roles WHERE oid=v_owner AND NOT rolsuper
         AND NOT rolbypassrls AND NOT rolcanlogin AND NOT rolinherit) THEN
    RAISE EXCEPTION 'review_media_catalog_executor_denied';
  END IF;
  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]')
    INTO v_members FROM pg_auth_members m;
  SELECT to_jsonb(n) INTO v_public FROM pg_namespace n WHERE nspname='public';
  IF NOT has_schema_privilege(v_owner,'public','CREATE') THEN
    RAISE EXCEPTION 'review_media_catalog_existing_public_create_missing';
  END IF;
  SELECT to_jsonb(m) INTO v_self FROM pg_auth_members m
    WHERE roleid=v_owner AND member=v_runner AND grantor=v_runner;
  IF v_self IS NOT NULL AND (v_self->>'admin_option')::boolean THEN
    RAISE EXCEPTION 'review_media_catalog_membership_denied';
  END IF;
  SELECT jsonb_agg(CASE WHEN p.oid=v_known THEN to_jsonb(p)-'prosrc' ELSE to_jsonb(p) END ORDER BY p.oid) INTO v_assertions FROM pg_proc p
    WHERE p.pronamespace='privacy_retention'::regnamespace;
  -- Pre-existing RPC/helper bodies and complete type/default metadata are pinned
  -- before any ownership or grant change. No unknown overload is admitted.
  FOR v_expected IN SELECT * FROM pg_temp.review_media_expected LOOP
    v_oid := to_regprocedure(v_expected.signature);
    SELECT * INTO v_function FROM pg_proc WHERE oid=v_oid;
    IF v_oid IS NULL OR v_function.proowner<>v_runner OR v_function.prokind<>'f'
       OR v_function.prosecdef IS DISTINCT FROM v_expected.definer OR v_function.provolatile::text<>v_expected.volatility
       OR v_function.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
       OR (SELECT lanname FROM pg_language WHERE oid=v_function.prolang)<>v_expected.language
       OR pg_get_function_result(v_oid) IS DISTINCT FROM v_expected.result
       OR coalesce(v_function.proargnames[1:v_function.pronargs],ARRAY[]::text[]) IS DISTINCT FROM v_expected.argument_names
       OR encode(sha256(convert_to(v_function.prosrc,'UTF8')),'hex')<>v_expected.body_sha256
       OR v_function.pronargdefaults<>(CASE WHEN v_function.proname='mutate_review_with_media' THEN 3 ELSE 0 END)
       OR (v_function.pronargdefaults=3 AND pg_get_expr(v_function.proargdefaults,0)<>'NULL::text, NULL::text[], NULL::text[]')
       OR (SELECT count(*) FROM pg_proc x WHERE x.pronamespace=v_function.pronamespace AND x.proname=v_function.proname)<>1 THEN
      RAISE EXCEPTION 'review_media_catalog_source_drift';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace='review_media_private'::regnamespace)<>6 THEN
    RAISE EXCEPTION 'review_media_catalog_identity_conflict';
  END IF;
  SELECT jsonb_agg(to_jsonb(p)-'proowner'-'proacl'-'prosrc' ORDER BY p.oid) INTO v_functions
    FROM pg_proc p JOIN pg_temp.review_media_expected e ON p.oid=to_regprocedure(e.signature);

  -- Use only the existing G014 owner-management authority. This transaction's
  -- noninheriting SET lease is restored exactly before unchanged assertions run.
  -- Never grant a Storage/service role or alter supautils/global configuration.
  IF v_major=17 AND NOT EXISTS (SELECT 1 FROM pg_auth_members
      WHERE roleid=v_owner AND member=v_runner AND admin_option AND grantor<>v_runner) THEN
    RAISE EXCEPTION 'review_media_catalog_existing_owner_admin_missing';
  END IF;
  IF v_major=17 THEN
    EXECUTE 'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres';
  ELSE
    GRANT privacy_workflow_owner TO postgres;
  END IF;
  SET LOCAL ROLE privacy_workflow_owner;
  -- Existing G041 claim boundary: never restore auth-schema access for the
  -- workflow owner. Pin the unchanged helper before substituting auth.uid().
  IF has_schema_privilege(v_owner,'auth','USAGE,CREATE') OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='privacy_retention' AND p.proname='g041_current_claim_user_id'
      AND p.pronargs=0 AND p.proowner=v_owner AND p.prosecdef AND p.prokind='f'
      AND NOT p.proretset AND p.prorettype='uuid'::regtype AND p.provolatile='s'
      AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
      AND p.proconfig=ARRAY['search_path=""']::text[]
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='43f3ff2ed914944802555c4ffe3ff8ecece213e82288e2c1c47ae22efdf81585'
      AND has_function_privilege(v_owner,p.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
  ) THEN RAISE EXCEPTION 'review_media_catalog_claim_boundary_drift'; END IF;
  IF EXISTS (SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist a
      JOIN pg_temp.review_media_expected e ON a.function_name=split_part(split_part(e.signature,'(',1),'.',2)
      WHERE a.function_schema='public') THEN
    RAISE EXCEPTION 'review_media_catalog_identity_conflict';
  END IF;
  SELECT jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key) INTO v_manifest
    FROM privacy_retention.g014_catalog_contract_manifest m;
  PERFORM privacy_retention.assert_g014_catalog_manifest();
  RESET ROLE;
  GRANT USAGE, CREATE ON SCHEMA review_media_private TO privacy_workflow_owner;
  FOR v_expected IN SELECT * FROM pg_temp.review_media_expected LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO privacy_workflow_owner',to_regprocedure(v_expected.signature));
    SET LOCAL ROLE privacy_workflow_owner;
    IF v_expected.signature LIKE 'public.%' THEN
      SELECT pg_get_functiondef(oid) INTO v_definition FROM pg_proc WHERE oid=to_regprocedure(v_expected.signature);
      EXECUTE replace(v_definition,'auth.uid()','privacy_retention.g041_current_claim_user_id()');
    END IF;
    IF (SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') FROM pg_proc
        WHERE oid=to_regprocedure(v_expected.signature)) IS DISTINCT FROM v_expected.final_body_sha256 THEN
      RAISE EXCEPTION 'review_media_catalog_claim_transition_drift';
    END IF;
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',to_regprocedure(v_expected.signature));
    IF v_expected.signature LIKE 'public.%' THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated',to_regprocedure(v_expected.signature));
    END IF;
    RESET ROLE;
  END LOOP;
  REVOKE CREATE ON SCHEMA review_media_private FROM privacy_workflow_owner;
  REVOKE ALL ON SCHEMA review_media_private FROM PUBLIC, anon, authenticated, service_role;
  REVOKE ALL ON TABLE review_media_private.commits, review_media_private.cleanup FROM PUBLIC, anon, authenticated, service_role;
  -- Private tables keep their migration owner. The implementation role receives
  -- only operations used by the reviewed functions, with explicit RLS policies.
  GRANT SELECT, INSERT ON review_media_private.commits TO privacy_workflow_owner;
  GRANT SELECT, INSERT, UPDATE ON review_media_private.cleanup TO privacy_workflow_owner;
  ALTER TABLE review_media_private.commits FORCE ROW LEVEL SECURITY;
  ALTER TABLE review_media_private.cleanup FORCE ROW LEVEL SECURITY;
  CREATE POLICY review_media_commits_select ON review_media_private.commits FOR SELECT TO privacy_workflow_owner USING (true);
  CREATE POLICY review_media_commits_insert ON review_media_private.commits FOR INSERT TO privacy_workflow_owner WITH CHECK (true);
  CREATE POLICY review_media_cleanup_select ON review_media_private.cleanup FOR SELECT TO privacy_workflow_owner USING (true);
  CREATE POLICY review_media_cleanup_insert ON review_media_private.cleanup FOR INSERT TO privacy_workflow_owner WITH CHECK (true);
  CREATE POLICY review_media_cleanup_update ON review_media_private.cleanup FOR UPDATE TO privacy_workflow_owner USING (true) WITH CHECK (true);
  -- Existing account-deletion contracts already require reviews SELECT/DELETE
  -- and storage.objects SELECT. Add only the six columns this RPC updates.
  GRANT UPDATE(content,categories,food_photos,is_verified,admin_note,updated_at)
    ON public.reviews TO privacy_workflow_owner;
  -- Existing supautils.policy_grants may authorize this DDL without table-owner
  -- USAGE/SET membership. Let the actual policy command decide; no fallback grant.
  CREATE POLICY review_media_workflow_read ON storage.objects FOR SELECT TO privacy_workflow_owner
    USING (bucket_id IN ('review-photos','review-verifications'));

  SET LOCAL ROLE privacy_workflow_owner;
  INSERT INTO privacy_retention.g014_public_rpc_allowlist
    (function_schema,function_name,identity_arguments,grantee,source_signature)
  SELECT 'public',p.proname,p.proargtypes::text,'authenticated',e.signature
    FROM pg_temp.review_media_expected e JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
    WHERE e.signature LIKE 'public.%';
  IF NOT FOUND THEN RAISE EXCEPTION 'review_media_catalog_allowlist_missing'; END IF;

  PERFORM privacy_retention.assert_g014_catalog_manifest();
  IF EXISTS (
    WITH expected(relation,ordinal,name,type,not_null,default_expr) AS (VALUES
      ('commits',1,'operation_id','uuid',true,NULL::text),
      ('commits',2,'owner_id','uuid',true,NULL::text),
      ('commits',3,'review_id','uuid',true,NULL::text),
      ('commits',4,'kind','text',true,NULL::text),
      ('commits',5,'request_hash','text',true,NULL::text),
      ('cleanup',1,'path','text',true,NULL::text),
      ('cleanup',2,'owner_id','uuid',true,NULL::text),
      ('cleanup',3,'review_id','uuid',true,NULL::text),
      ('cleanup',4,'purpose','text',true,NULL::text),
      ('cleanup',5,'retired','boolean',true,'false'),
      ('cleanup',6,'complete','boolean',true,'false')
    ), actual AS (
      SELECT c.relname::text,a.attnum::integer,a.attname::text,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,
        pg_catalog.pg_get_expr(d.adbin,d.adrelid)
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE c.relnamespace='review_media_private'::regnamespace AND c.relkind IN ('r','p')
    )
    (SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  ) THEN RAISE EXCEPTION 'review_media_catalog_column_shape_drift'; END IF;
  IF EXISTS (
    WITH expected(relation,name,definition) AS (VALUES
      ('commits','commits_pkey','PRIMARY KEY (operation_id)'),
      ('commits','commits_kind_check','CHECK ((kind = ANY (ARRAY[''edit''::text, ''delete''::text])))'),
      ('cleanup','cleanup_pkey','PRIMARY KEY (path)'),
      ('cleanup','cleanup_purpose_check','CHECK ((purpose = ANY (ARRAY[''food''::text, ''verification''::text])))')
    ), actual AS (
      SELECT c.relname::text,k.conname::text,pg_catalog.pg_get_constraintdef(k.oid)
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_constraint k ON k.conrelid=c.oid
      WHERE c.relnamespace='review_media_private'::regnamespace
    )
    (SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  ) OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
      WHERE c.relnamespace='review_media_private'::regnamespace AND NOT t.tgisinternal)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
      WHERE c.relnamespace='review_media_private'::regnamespace AND (NOT k.convalidated OR k.condeferrable OR k.condeferred))
    OR (SELECT count(*) FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
      WHERE c.relnamespace='review_media_private'::regnamespace)<>2
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
      WHERE c.relnamespace='review_media_private'::regnamespace AND (NOT i.indisprimary OR NOT i.indisvalid OR NOT i.indisready)) THEN
    RAISE EXCEPTION 'review_media_catalog_constraint_shape_drift';
  END IF;
  -- Extend only the declarative protected-relation list, never an assertion.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc WHERE oid=v_known AND proowner=v_owner
      AND prosecdef AND prokind='f' AND proretset AND provolatile='s'
      AND proconfig=ARRAY['search_path=""']::text[]
      AND prolang=(SELECT oid FROM pg_catalog.pg_language WHERE lanname='sql')
      AND pg_catalog.pg_get_function_result(oid)='TABLE(schema_name name, relation_name name)') THEN
    RAISE EXCEPTION 'review_media_catalog_known_identity_metadata_drift';
  END IF;
  SELECT pg_catalog.pg_get_functiondef(v_known) INTO v_definition;
  IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc WHERE oid=v_known)<>'43bf370fe74864708e9efbc6559d899a6afa5b353e6cbc930306e31c9ecdc499'
     OR EXISTS (SELECT 1 FROM privacy_retention.g014_catalog_contract_manifest
       WHERE manifest_key->>'schema'='review_media_private') THEN
    RAISE EXCEPTION 'review_media_catalog_known_identity_source_drift';
  END IF;
  EXECUTE pg_catalog.replace(v_definition,
    $known_anchor$    ('public', 'notifications'),$known_anchor$,
    $known_replacement$    ('review_media_private', 'commits'),
    ('review_media_private', 'cleanup'),
    ('public', 'notifications'),$known_replacement$);
  IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc WHERE oid=v_known)<>'20acd5742d891cf8a33b265a3a1298c65dd9646402c58391cd17829951cf92f2' THEN
    RAISE EXCEPTION 'review_media_catalog_known_identity_post_drift';
  END IF;
  INSERT INTO privacy_retention.g014_catalog_contract_manifest(manifest_kind,manifest_key,manifest_value)
    SELECT manifest_kind,manifest_key,manifest_value FROM privacy_retention.g014_catalog_manifest_rows()
    WHERE manifest_key->>'schema'='review_media_private'
      AND manifest_key->>'relation' IN ('commits','cleanup');
  IF NOT FOUND THEN RAISE EXCEPTION 'review_media_catalog_manifest_append_missing'; END IF;
  PERFORM privacy_retention.assert_g014_catalog_manifest();
  CREATE FUNCTION pg_temp.review_media_g014_assert() RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $bridge$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_temp.review_media_expected e
      JOIN pg_proc p ON p.oid=to_regprocedure(e.signature)
      WHERE e.signature LIKE 'public.%' AND (
        (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist a
          WHERE a.function_schema='public' AND a.function_name=p.proname)<>1
        OR NOT EXISTS (SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist a
          WHERE a.source_signature=e.signature AND a.function_schema='public' AND a.function_name=p.proname
            AND a.identity_arguments=p.proargtypes::text AND a.grantee='authenticated'))) THEN
      RAISE EXCEPTION 'review_media_catalog_allowlist_drift';
    END IF;
    PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
    PERFORM privacy_retention.assert_g014_definer_contract();
    PERFORM privacy_retention.assert_g014_catalog_contract();
    DROP FUNCTION pg_temp.review_media_g014_assert();
  END $bridge$;
  REVOKE ALL ON FUNCTION pg_temp.review_media_g014_assert() FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION pg_temp.review_media_g014_assert() TO postgres;
  IF (SELECT jsonb_agg(to_jsonb(m) ORDER BY manifest_kind,manifest_key)
      FROM privacy_retention.g014_catalog_contract_manifest m
      WHERE m.manifest_key->>'schema' IS DISTINCT FROM 'review_media_private') IS DISTINCT FROM v_manifest THEN
    RAISE EXCEPTION 'review_media_catalog_manifest_drift';
  END IF;
  RESET ROLE;
  IF v_self IS NULL THEN
    IF v_major=17 THEN REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
    ELSE REVOKE privacy_workflow_owner FROM postgres; END IF;
  ELSIF v_major=17 THEN
    EXECUTE format('GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT %s, SET %s GRANTED BY postgres',
      upper(v_self->>'inherit_option'),upper(v_self->>'set_option'));
  END IF;
  IF (SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]') FROM pg_auth_members m) IS DISTINCT FROM v_members
     OR (SELECT to_jsonb(n) FROM pg_namespace n WHERE nspname='public') IS DISTINCT FROM v_public
     OR (SELECT jsonb_agg(CASE WHEN p.oid=v_known THEN to_jsonb(p)-'prosrc' ELSE to_jsonb(p) END ORDER BY p.oid) FROM pg_proc p
         WHERE p.pronamespace='privacy_retention'::regnamespace) IS DISTINCT FROM v_assertions
     OR (SELECT jsonb_agg(to_jsonb(p)-'proowner'-'proacl'-'prosrc' ORDER BY p.oid) FROM pg_proc p
         JOIN pg_temp.review_media_expected e ON p.oid=to_regprocedure(e.signature)) IS DISTINCT FROM v_functions THEN
    RAISE EXCEPTION 'review_media_catalog_preservation_drift';
  END IF;
  PERFORM pg_temp.review_media_g014_assert();
  IF to_regprocedure('pg_temp.review_media_g014_assert()') IS NOT NULL THEN
    RAISE EXCEPTION 'review_media_catalog_bridge_remaining';
  END IF;
END $integration$;

-- REVIEW_MEDIA_READBACK_BEGIN
-- The same independent catalog-only checks are embedded in canonical readback.
DO $review_media_catalog_readback$
DECLARE
  v_expected record; v_function record; v_relation record;
  v_owner oid := 'privacy_workflow_owner'::regrole;
  v_path text := current_setting('search_path');
BEGIN
  -- Existing G041 claim boundary: never restore auth-schema access for the
  -- workflow owner. Pin the unchanged helper before substituting auth.uid().
  IF has_schema_privilege(v_owner,'auth','USAGE,CREATE') OR NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='privacy_retention' AND p.proname='g041_current_claim_user_id'
      AND p.pronargs=0 AND p.proowner=v_owner AND p.prosecdef AND p.prokind='f'
      AND NOT p.proretset AND p.prorettype='uuid'::regtype AND p.provolatile='s'
      AND p.prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql')
      AND p.proconfig=ARRAY['search_path=""']::text[]
      AND encode(sha256(convert_to(p.prosrc,'UTF8')),'hex')='43f3ff2ed914944802555c4ffe3ff8ecece213e82288e2c1c47ae22efdf81585'
      AND has_function_privilege(v_owner,p.oid,'EXECUTE')
      AND NOT has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND NOT has_function_privilege('service_role',p.oid,'EXECUTE')
  ) THEN RAISE EXCEPTION 'review_media_catalog_claim_boundary_drift'; END IF;
  -- Fix pg_get_expr qualification before comparing the exact parsed predicates.
  PERFORM set_config('search_path','public, pg_catalog',true);
  FOR v_expected IN SELECT * FROM (VALUES
    ('public.finish_review_media_cleanup()','f6c4e71988ed2b789b887484af5fdf2e482bde98f1d1c5b5d4e7ad124c314bd1',true,'v','plpgsql','bigint',ARRAY[]::text[]),
    ('public.mutate_review_with_media(uuid,uuid,text,timestamp with time zone,text,text[],text[])','a47b34c81605a515df01a6a2da7c5503c0a7abfea6946028b51ed52bb31a8830',true,'v','plpgsql','text',ARRAY['p_operation_id','p_review_id','p_kind','p_expected_updated_at','p_content','p_categories','p_food_photos']::text[]),
    ('public.pending_review_media_cleanup()','5a92c8f282c895eabaa77f8cf3f452fb659bac33bd519ed8cf439dc1f2905c7b',true,'v','plpgsql','TABLE(path text, owner_id uuid, review_id uuid, purpose text)',ARRAY[]::text[]),
    ('public.queue_review_upload_cleanup(uuid,text[])','89c3b573891f598cac5df6ce9a3217639092801a7439ec0404f338f2097114a8',true,'v','plpgsql','text',ARRAY['p_review_id','p_paths']::text[]),
    ('public.read_review_media_commit(uuid,uuid,text)','2f14abfc04864f369467f5ac5f0603defa149b8023d7e6b04e2bb8535f8a268e',true,'v','sql','text',ARRAY['p_operation_id','p_review_id','p_kind']::text[]),
    ('public.review_media_delete_allowed(text)','a75dbd787dd388b0761bee11c82a56d5f410688e4cfd953181bce4d613062ae7',true,'v','plpgsql','boolean',ARRAY['p_path']::text[]),
    ('review_media_private.canonical(text,uuid,uuid,text)','87d8397c36cf4c7b986f75cbc2788979333a76be2cc26dc5522cd362f62414a9',false,'i','sql','boolean',ARRAY['p_path','p_owner','p_review','p_purpose']::text[]),
    ('review_media_private.guard_references()','846030547ffd76e17596755d7eee4279dcb9b563361435260826071d2f250d59',true,'v','plpgsql','trigger',ARRAY[]::text[]),
    ('review_media_private.lock_changes()','381d89aa6bbf5a59c2ee0fef2a7392ef705147252b324527201b8b6f74376250',true,'v','plpgsql','trigger',ARRAY[]::text[]),
    ('review_media_private.owned_legacy(text,uuid,text)','a2d55f09f03fcaeedd77461198511673da7342a6a4873d37227f9cf612090980',false,'i','sql','boolean',ARRAY['p_path','p_owner','p_purpose']::text[]),
    ('review_media_private.reference_key(text)','a8910cb09bfd959951045e8b0b8233b1e2a8bdc45073abeebdfc26b552b1dae7',false,'i','plpgsql','text',ARRAY['p_value']::text[]),
    ('review_media_private.referenced(text)','cc295115d85a3a11b380e1378e2ee91b0d9f7f587c68839653f54ed826c398ce',true,'v','sql','boolean',ARRAY['p_path']::text[])
  ) AS expected(signature,body_sha256,definer,volatility,language,result,argument_names) LOOP
    SELECT * INTO v_function FROM pg_proc WHERE oid=to_regprocedure(v_expected.signature);
    IF v_function.oid IS NULL OR v_function.proowner<>v_owner OR v_function.prokind<>'f'
       OR v_function.prosecdef IS DISTINCT FROM v_expected.definer OR v_function.provolatile::text<>v_expected.volatility
       OR v_function.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
       OR (SELECT lanname FROM pg_language WHERE oid=v_function.prolang)<>v_expected.language
       OR pg_get_function_result(v_function.oid) IS DISTINCT FROM v_expected.result
       OR coalesce(v_function.proargnames[1:v_function.pronargs],ARRAY[]::text[]) IS DISTINCT FROM v_expected.argument_names
       OR v_function.pronargdefaults<>(CASE WHEN v_function.proname='mutate_review_with_media' THEN 3 ELSE 0 END)
       OR (v_function.pronargdefaults=3 AND pg_get_expr(v_function.proargdefaults,0)<>'NULL::text, NULL::text[], NULL::text[]')
       OR encode(sha256(convert_to(v_function.prosrc,'UTF8')),'hex')<>v_expected.body_sha256
       OR (SELECT count(*) FROM pg_proc x WHERE x.pronamespace=v_function.pronamespace AND x.proname=v_function.proname)<>1
       OR NOT has_function_privilege(v_owner,v_function.oid,'EXECUTE')
       OR has_function_privilege('anon',v_function.oid,'EXECUTE')
       OR has_function_privilege('service_role',v_function.oid,'EXECUTE')
       OR has_function_privilege('authenticated',v_function.oid,'EXECUTE') IS DISTINCT FROM (v_expected.signature LIKE 'public.%')
       OR EXISTS (SELECT 1 FROM aclexplode(coalesce(v_function.proacl,acldefault('f',v_function.proowner))) a
         WHERE a.is_grantable OR a.privilege_type<>'EXECUTE'
         OR (a.grantee<>v_owner AND NOT (v_expected.signature LIKE 'public.%' AND a.grantee='authenticated'::regrole))) THEN
      RAISE EXCEPTION 'review_media_catalog_function_drift';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_proc WHERE pronamespace='review_media_private'::regnamespace)<>6
     OR (SELECT count(*) FROM pg_class WHERE relnamespace='review_media_private'::regnamespace AND relkind IN ('r','p','v','m','f','S'))<>2
     OR NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='review_media_private' AND nspowner='postgres'::regrole)
     OR NOT has_schema_privilege(v_owner,'review_media_private','USAGE')
     OR has_schema_privilege(v_owner,'review_media_private','CREATE')
     OR EXISTS (SELECT 1 FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a
       WHERE n.nspname='review_media_private' AND a.grantee<>n.nspowner
         AND (a.grantee<>v_owner OR a.privilege_type<>'USAGE' OR a.is_grantable)) THEN
    RAISE EXCEPTION 'review_media_catalog_private_schema_drift';
  END IF;
  FOR v_expected IN SELECT * FROM (VALUES
    ('commits',ARRAY['INSERT','SELECT']::text[]),
    ('cleanup',ARRAY['INSERT','SELECT','UPDATE']::text[])
  ) AS expected(name,privileges) LOOP
    SELECT * INTO v_relation FROM pg_class WHERE oid=to_regclass('review_media_private.'||v_expected.name);
    IF v_relation.relkind<>'r' OR v_relation.relowner<>'postgres'::regrole OR NOT v_relation.relrowsecurity OR NOT v_relation.relforcerowsecurity
       OR (SELECT array_agg(a.privilege_type ORDER BY a.privilege_type) FROM aclexplode(v_relation.relacl) a
           WHERE a.grantee=v_owner) IS DISTINCT FROM v_expected.privileges
       OR EXISTS (SELECT 1 FROM aclexplode(v_relation.relacl) a WHERE a.grantee<>v_relation.relowner AND (a.grantee<>v_owner OR a.is_grantable))
       OR EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid=v_relation.oid AND attacl IS NOT NULL) THEN
      RAISE EXCEPTION 'review_media_catalog_private_table_drift';
    END IF;
  END LOOP;
  IF EXISTS (
    WITH expected(relation, name, cmd, using_expr, check_expr) AS (VALUES
      ('commits','review_media_commits_select','r','true'::text,NULL::text),
      ('commits','review_media_commits_insert','a',NULL::text,'true'),
      ('cleanup','review_media_cleanup_select','r','true',NULL::text),
      ('cleanup','review_media_cleanup_insert','a',NULL::text,'true'),
      ('cleanup','review_media_cleanup_update','w','true','true')
    ), actual AS (
      SELECT c.relname::text,p.polname::text,p.polcmd::text,pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid),p.polpermissive,p.polroles
      FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace='review_media_private'::regnamespace
    ), wanted AS (SELECT *,true,ARRAY[v_owner] FROM expected)
    (SELECT * FROM wanted EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM wanted)
  ) THEN RAISE EXCEPTION 'review_media_catalog_private_policy_drift'; END IF;
  IF EXISTS (
    SELECT 1 FROM (VALUES ('anon'),('authenticated'),('service_role')) r(name)
    WHERE has_schema_privilege(r.name,'review_media_private','USAGE,CREATE')
       OR has_table_privilege(r.name,'review_media_private.commits','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR has_table_privilege(r.name,'review_media_private.cleanup','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
  ) OR NOT has_table_privilege(v_owner,'public.reviews','SELECT')
     OR NOT has_table_privilege(v_owner,'public.reviews','DELETE')
     OR EXISTS (SELECT 1 FROM unnest(ARRAY['content','categories','food_photos','is_verified','admin_note','updated_at']) c(name)
         WHERE NOT has_column_privilege(v_owner,'public.reviews',c.name,'UPDATE'))
     OR has_table_privilege(v_owner,'public.reviews','INSERT,UPDATE,TRUNCATE,REFERENCES,TRIGGER')
     OR EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid='public.reviews'::regclass AND a.attnum>0 AND NOT a.attisdropped
         AND a.attname<>ALL(ARRAY['content','categories','food_photos','is_verified','admin_note','updated_at'])
         AND has_column_privilege(v_owner,a.attrelid,a.attnum,'UPDATE'))
     OR NOT has_table_privilege(v_owner,'storage.objects','SELECT')
     OR has_table_privilege(v_owner,'storage.objects','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') THEN
    RAISE EXCEPTION 'review_media_catalog_minimum_grant_drift';
  END IF;
  IF EXISTS (
    WITH expected(relation,ordinal,name,type,not_null,default_expr) AS (VALUES
      ('commits',1,'operation_id','uuid',true,NULL::text),
      ('commits',2,'owner_id','uuid',true,NULL::text),
      ('commits',3,'review_id','uuid',true,NULL::text),
      ('commits',4,'kind','text',true,NULL::text),
      ('commits',5,'request_hash','text',true,NULL::text),
      ('cleanup',1,'path','text',true,NULL::text),
      ('cleanup',2,'owner_id','uuid',true,NULL::text),
      ('cleanup',3,'review_id','uuid',true,NULL::text),
      ('cleanup',4,'purpose','text',true,NULL::text),
      ('cleanup',5,'retired','boolean',true,'false'),
      ('cleanup',6,'complete','boolean',true,'false')
    ), actual AS (
      SELECT c.relname::text,a.attnum::integer,a.attname::text,pg_catalog.format_type(a.atttypid,a.atttypmod),a.attnotnull,
        pg_catalog.pg_get_expr(d.adbin,d.adrelid)
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
      LEFT JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE c.relnamespace='review_media_private'::regnamespace AND c.relkind IN ('r','p')
    )
    (SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  ) THEN RAISE EXCEPTION 'review_media_catalog_column_shape_drift'; END IF;
  IF EXISTS (
    WITH expected(relation,name,definition) AS (VALUES
      ('commits','commits_pkey','PRIMARY KEY (operation_id)'),
      ('commits','commits_kind_check','CHECK ((kind = ANY (ARRAY[''edit''::text, ''delete''::text])))'),
      ('cleanup','cleanup_pkey','PRIMARY KEY (path)'),
      ('cleanup','cleanup_purpose_check','CHECK ((purpose = ANY (ARRAY[''food''::text, ''verification''::text])))')
    ), actual AS (
      SELECT c.relname::text,k.conname::text,pg_catalog.pg_get_constraintdef(k.oid)
      FROM pg_catalog.pg_class c JOIN pg_catalog.pg_constraint k ON k.conrelid=c.oid
      WHERE c.relnamespace='review_media_private'::regnamespace
    )
    (SELECT * FROM expected EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM expected)
  ) OR EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
      WHERE c.relnamespace='review_media_private'::regnamespace AND NOT t.tgisinternal)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid=k.conrelid
      WHERE c.relnamespace='review_media_private'::regnamespace AND (NOT k.convalidated OR k.condeferrable OR k.condeferred))
    OR (SELECT count(*) FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
      WHERE c.relnamespace='review_media_private'::regnamespace)<>2
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid=i.indrelid
      WHERE c.relnamespace='review_media_private'::regnamespace AND (NOT i.indisprimary OR NOT i.indisvalid OR NOT i.indisready)) THEN
    RAISE EXCEPTION 'review_media_catalog_constraint_shape_drift';
  END IF;
  IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc
      WHERE pronamespace=(SELECT oid FROM pg_namespace WHERE nspname='privacy_retention')
        AND proname='g014_catalog_protected_relations' AND pronargs=0) IS DISTINCT FROM '20acd5742d891cf8a33b265a3a1298c65dd9646402c58391cd17829951cf92f2' THEN
    RAISE EXCEPTION 'review_media_catalog_known_identity_post_drift';
  END IF;
  -- Exact allowlist and unchanged G014 assertions run through the owner bridge
  -- above; canonical readback also runs them before this catalog-only block.
  -- Compare command, role, permissive/restrictive bit and BOTH complete predicates.
  IF EXISTS (
    WITH expected(name,cmd,permissive,role_name,using_expr,check_expr) AS (VALUES
      ('review_media_safe_delete','d',false,'authenticated','((bucket_id <> ''review-photos''::text) OR review_media_delete_allowed(name))',NULL::text),
      ('review_media_workflow_read','r',true,'privacy_workflow_owner','(bucket_id = ANY (ARRAY[''review-photos''::text, ''review-verifications''::text]))',NULL::text),
      ('review_photos_food_insert','a',false,'authenticated',NULL::text,'((bucket_id <> ''review-photos''::text) OR ((split_part(name, ''/''::text, 4) = ''food''::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid))))'),
      ('review_photos_food_update','w',false,'authenticated','((bucket_id <> ''review-photos''::text) OR ((split_part(name, ''/''::text, 4) = ''food''::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid))))','((bucket_id <> ''review-photos''::text) OR ((split_part(name, ''/''::text, 4) = ''food''::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid))))'),
      ('review_verifications_owner_delete','d',true,'authenticated','((bucket_id = ''review-verifications''::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)))',NULL::text),
      ('review_verifications_owner_insert','a',true,'authenticated',NULL::text,'((bucket_id = ''review-verifications''::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)) AND (split_part(name, ''/''::text, 4) = ''verification''::text))'),
      ('review_verifications_owner_read','r',true,'authenticated','((bucket_id = ''review-verifications''::text) AND (((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)) OR has_role(( SELECT auth.uid() AS uid), ''admin''::app_role)))',NULL::text),
      ('review_verifications_safe_delete','d',false,'authenticated','((bucket_id <> ''review-verifications''::text) OR review_media_delete_allowed(name))',NULL::text)
    ), actual AS (
      SELECT p.polname::text,p.polcmd::text,p.polpermissive,p.polroles,
        regexp_replace(pg_get_expr(p.polqual,p.polrelid),'[[:space:]]+',' ','g'),
        regexp_replace(pg_get_expr(p.polwithcheck,p.polrelid),'[[:space:]]+',' ','g')
      FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass
        AND (p.polname LIKE 'review_media_%' OR p.polname LIKE 'review_photos_%' OR p.polname LIKE 'review_verifications_%')
    ), wanted AS (SELECT name,cmd,permissive,ARRAY[to_regrole(role_name)::oid],using_expr,check_expr FROM expected)
    (SELECT * FROM wanted EXCEPT SELECT * FROM actual) UNION ALL (SELECT * FROM actual EXCEPT SELECT * FROM wanted)
  ) THEN RAISE EXCEPTION 'review_media_catalog_storage_policy_drift'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='review-verifications' AND name='review-verifications'
      AND public=false AND file_size_limit=5242880
      AND allowed_mime_types=ARRAY['image/jpeg','image/png','image/webp','image/avif']::text[]) THEN
    RAISE EXCEPTION 'review_media_catalog_private_bucket_drift';
  END IF;
  -- Admit the strict canonical local read policy or the three exact deployed
  -- bucket read identities. All existing API-role reads must match a known
  -- predicate; the private verification bucket is never publicly readable.
  IF EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass
      AND p.polcmd='r' AND p.polpermissive AND p.polroles && ARRAY[0::oid,'anon'::regrole::oid,'authenticated'::regrole::oid]
      AND p.polname NOT IN ('tzudong_public_media_read','Anyone can view review photos','Public read access',
        'Public read access for profile-avatars','local_nightly_avatar_read','review_verifications_owner_read'))
    OR EXISTS (SELECT 1 FROM pg_policy p JOIN (VALUES
      ('Anyone can view review photos','(bucket_id = ''review-photos''::text)'),
      ('Public read access','(bucket_id = ''ad-banner-images''::text)'),
      ('Public read access for profile-avatars','(bucket_id = ''profile-avatars''::text)')
    ) e(name,predicate) ON p.polname=e.name
      WHERE p.polrelid='storage.objects'::regclass AND (p.polcmd<>'r' OR NOT p.polpermissive
        OR p.polroles<>ARRAY[0::oid] OR p.polwithcheck IS NOT NULL OR pg_get_expr(p.polqual,p.polrelid)<>e.predicate))
    OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass
      AND p.polname='tzudong_public_media_read' AND (p.polcmd<>'r' OR NOT p.polpermissive
        OR NOT p.polroles @> ARRAY['anon'::regrole::oid,'authenticated'::regrole::oid] OR cardinality(p.polroles)<>2
        OR p.polwithcheck IS NOT NULL OR pg_get_expr(p.polqual,p.polrelid)<>'(bucket_id = ANY (ARRAY[''profile-avatars''::text, ''review-photos''::text, ''ad-banner-images''::text]))'))
    OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid='storage.objects'::regclass AND p.polname='local_nightly_avatar_read'
      AND (p.polcmd<>'r' OR NOT p.polpermissive OR NOT p.polroles @> ARRAY['anon'::regrole::oid,'authenticated'::regrole::oid]
        OR cardinality(p.polroles)<>2 OR p.polwithcheck IS NOT NULL OR pg_get_expr(p.polqual,p.polrelid)<>'(bucket_id = ''avatars''::text)')) THEN
    RAISE EXCEPTION 'review_media_catalog_public_read_drift';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='storage.objects'::regclass
      AND polname='tzudong_public_media_read' AND polcmd='r' AND polpermissive
      AND polroles @> ARRAY['anon'::regrole::oid,'authenticated'::regrole::oid]
      AND cardinality(polroles)=2 AND polwithcheck IS NULL
      AND pg_get_expr(polqual,polrelid)='(bucket_id = ANY (ARRAY[''profile-avatars''::text, ''review-photos''::text, ''ad-banner-images''::text]))')
    AND (SELECT count(*) FROM pg_policy WHERE polrelid='storage.objects'::regclass
      AND polname IN ('Anyone can view review photos','Public read access','Public read access for profile-avatars'))<>3 THEN
    RAISE EXCEPTION 'review_media_catalog_public_read_drift';
  END IF;
  -- The global reference scan must see all reviews under the trusted role.
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid='public.reviews'::regclass
      AND polname='g014_account_deletion_source_access' AND polcmd='*' AND polpermissive
      AND polroles=ARRAY[v_owner] AND pg_get_expr(polqual,polrelid)='true' AND pg_get_expr(polwithcheck,polrelid)='true') THEN
    RAISE EXCEPTION 'review_media_catalog_reference_visibility_drift';
  END IF;
  PERFORM set_config('search_path',v_path,true);
END $review_media_catalog_readback$;
-- REVIEW_MEDIA_READBACK_END
NOTIFY pgrst, 'reload schema';
COMMIT;
