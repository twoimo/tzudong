-- Restore six internal workflow EXECUTEs; no Data API allowlist additions.
-- Intentional authorization change: is_user_admin now requires the existing
-- user_roles.admin + user_account_status.active + disabled_at IS NULL policy.
-- Missing status, disabled account, active-with-disabled_at, NULL and non-admin
-- identities return false. Three target legacy RPCs and seven other same-owner
-- callers inherit this predicate; their bodies and external ACL stay unchanged.
-- Reference: 20260812000300_local_admin_data_boundary_convergence.sql,
-- public.privacy_incident_require_admin: identical join and active-admin conditions.
-- Other five helper bodies, all helper owner/config/definer metadata are preserved.
-- Both G014 definer and catalog assertions accept internal owner EXECUTE on exactly three service-only invokers,
-- from the existing postgres owner, without grant option. All other signature
-- checks remain strict. privacy_workflow_owner is never a Data API grantee.
-- PG15 canonical replay is NOT admitted by this migration. Do not weaken its
-- PG17 role or source gates. A reviewed read-only replay verifier/contract must
-- bind this source SHA, predecessors, exact actual PG15 helper/assertion preimages,
-- generated verifier SQL and preservation receipt before local/nightly adoption.
-- No PG15 helper/assertion preimage is claimed here; none has been observed.
-- Fresh owned PG17 preimages after the three guarded record/warning migrations
-- are exact. Unknown source, executor, role, metadata or permissions fail closed.
BEGIN;
SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tzudong:private-workflow-helper-execution:v1',0));
DO $temp_anchor$
DECLARE before_members jsonb; after_members jsonb;
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres'
    OR pg_catalog.current_setting('server_version_num')::integer/10000<>17
    OR (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname='postgres')
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='privacy_workflow_owner'
      AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolinherit)
    OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','SET')
    OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','USAGE')
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole
      AND member='postgres'::regrole AND grantor='postgres'::regrole)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole
      AND member='postgres'::regrole AND admin_option AND NOT inherit_option AND NOT set_option)
    THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_TEMP_ANCHOR_EXECUTOR'; END IF;
 SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO before_members FROM pg_catalog.pg_auth_members m;
 -- Initialize the session temp namespace under its intended private helper owner,
 -- as in the verified full-source reconstruction. No persistent schema ACL change.
 IF pg_catalog.pg_my_temp_schema()<>0 AND NOT EXISTS(SELECT 1 FROM pg_catalog.pg_namespace
    WHERE oid=pg_catalog.pg_my_temp_schema() AND nspowner='privacy_workflow_owner'::regrole)
    THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_EXISTING_TEMP_SCHEMA_OWNER'; END IF;
 IF pg_catalog.to_regprocedure('pg_temp.admin_record_registration()') IS NOT NULL
    OR pg_catalog.to_regprocedure('pg_temp.admin_raw_warning_registration()') IS NOT NULL
    OR pg_catalog.to_regprocedure('pg_temp.private_workflow_contract_registration()') IS NOT NULL
    OR pg_catalog.to_regclass('pg_temp.private_workflow_temp_anchor') IS NOT NULL
    THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_EXISTING_TEMP_HELPER'; END IF;
 EXECUTE 'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres';
 EXECUTE 'SET LOCAL ROLE privacy_workflow_owner';
 CREATE TEMP TABLE private_workflow_temp_anchor(value boolean) ON COMMIT DROP;
 EXECUTE 'RESET ROLE';
 EXECUTE 'REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres';
 SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO after_members FROM pg_catalog.pg_auth_members m;
 IF before_members IS DISTINCT FROM after_members THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_TEMP_ANCHOR_MEMBERSHIP_DRIFT'; END IF;
END $temp_anchor$;
CREATE TEMP TABLE private_workflow_expected ON COMMIT DROP AS
SELECT * FROM jsonb_to_recordset('[{"acl":["privacy_workflow_owner=X/privacy_workflow_owner"],"owner":"privacy_workflow_owner","config":["search_path=\"\""],"definer":true,"signature":"privacy_retention.assert_g014_catalog_contract()","bodySha256":"50948ddce54dbba9497978964bebc535c27ebe98fb0f46bf05e2ec17ab0b9e01"},{"acl":["privacy_workflow_owner=X/privacy_workflow_owner"],"owner":"privacy_workflow_owner","config":["search_path=\"\""],"definer":true,"signature":"privacy_retention.assert_g014_definer_contract()","bodySha256":"b9e2f7d812783deee6c91d27d22d6c2019be9aa04e4f1221cc7482567775354a"},{"acl":["privacy_workflow_owner=X/privacy_workflow_owner"],"owner":"privacy_workflow_owner","config":["search_path=\"\""],"definer":true,"signature":"privacy_retention.assert_g014_public_rpc_allowlist()","bodySha256":"f23203a0a2366eca16b30b256729e859efc556952df8cb75485924153e1188ef"},{"acl":["privacy_workflow_owner=X/privacy_workflow_owner"],"owner":"privacy_workflow_owner","config":["search_path=\"\""],"definer":false,"signature":"privacy_retention.assert_g014_workflow_owner_contract()","bodySha256":"345aed9acb1da06262740ef06d81e51855a44c7470aa8b431a23e6fa629aab1d"},{"acl":["postgres=X/postgres"],"owner":"postgres","config":["search_path=pg_catalog, public, extensions"],"definer":false,"signature":"public.canonicalize_youtube_link(text)","bodySha256":"e1ed32cb1df6cb36ba0645e328f627f360d8b96cd7bd81ef4040bd9c2fd1cdb7"},{"acl":["postgres=X/postgres","service_role=X/postgres"],"owner":"postgres","config":["search_path=pg_catalog, public, extensions"],"definer":false,"signature":"public.extract_youtube_video_id(text)","bodySha256":"5ecf7a06fa89265b12773210448acf17fc3b612fe80583346bb217358af11016"},{"acl":["postgres=X/postgres"],"owner":"postgres","config":["search_path=public"],"definer":false,"signature":"public.generate_unique_id(text, text, text)","bodySha256":"a46cbfa06f4ae74100b04126faefb4e28898adea5ff277d6604472463f8b6182"},{"acl":["postgres=X/postgres"],"owner":"postgres","config":["search_path=public"],"definer":true,"signature":"public.is_user_admin(uuid)","bodySha256":"9f2486a15c285f90ce383bee7daab323f4dce789278f214e85d50b4128c7c44c"},{"acl":["postgres=X/postgres","service_role=X/postgres"],"owner":"postgres","config":["search_path=pg_catalog, public, extensions"],"definer":false,"signature":"public.normalize_restaurant_identity_name(text)","bodySha256":"706d9005f6978684d01bcd375a6ba0249e3cb51ed46c08e62e4996d5f6f6263a"},{"acl":["postgres=X/postgres","service_role=X/postgres"],"owner":"postgres","config":["search_path=pg_catalog, public, extensions"],"definer":false,"signature":"public.resolve_restaurant_identity_name(text, text, text, text)","bodySha256":"3a63c3941c3e157bb601a8df0dfebcf800e8d47d98bb9e3533ab10fc82487464"}]'::jsonb)
 AS x(signature text,"bodySha256" text,owner text,definer boolean,config text[],acl text[]);
CREATE TEMP TABLE private_workflow_proc_before ON COMMIT DROP AS
SELECT p.oid,to_jsonb(p) AS metadata FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT LIKE 'pg_temp_%';
CREATE TEMP TABLE private_workflow_members_before ON COMMIT DROP AS TABLE pg_catalog.pg_auth_members;
CREATE TEMP TABLE private_workflow_roles_before ON COMMIT DROP AS TABLE pg_catalog.pg_roles;
CREATE TEMP TABLE private_workflow_manifest_before ON COMMIT DROP AS TABLE privacy_retention.g014_catalog_contract_manifest;
CREATE TEMP TABLE private_workflow_allowlist_before ON COMMIT DROP AS TABLE privacy_retention.g014_public_rpc_allowlist;
CREATE TEMP TABLE private_workflow_nested_before ON COMMIT DROP AS TABLE privacy_retention.g014_nested_helper_allowlist;
CREATE TEMP TABLE private_workflow_relations_before ON COMMIT DROP AS
SELECT c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%';
CREATE TEMP TABLE private_workflow_triggers_before ON COMMIT DROP AS
SELECT oid,tgrelid,tgname,tgfoid,tgenabled,pg_catalog.pg_get_triggerdef(oid) AS definition FROM pg_catalog.pg_trigger;
DO $admission$
DECLARE e record; p pg_catalog.pg_proc; sig text;
BEGIN
 IF current_user<>'postgres' OR session_user<>'postgres'
    OR pg_catalog.current_setting('server_version_num')::integer/10000<>17
    OR (SELECT rolsuper FROM pg_catalog.pg_roles WHERE rolname='postgres')
    THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_EXECUTOR_DENIED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='privacy_workflow_owner'
    AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolinherit)
    OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','SET')
    OR pg_catalog.pg_has_role('postgres','privacy_workflow_owner','USAGE')
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole
      AND member='postgres'::regrole AND grantor='postgres'::regrole)
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid='privacy_workflow_owner'::regrole
       AND member='postgres'::regrole AND admin_option AND NOT inherit_option AND NOT set_option)
    THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_OWNER_ROLE_DENIED'; END IF;
 IF (SELECT count(*) FROM pg_temp.private_workflow_expected)<>10 THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_PREIMAGE_SET'; END IF;
 FOR e IN SELECT * FROM pg_temp.private_workflow_expected LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=pg_catalog.to_regprocedure(e.signature);
  IF p.oid IS NULL OR pg_catalog.pg_get_userbyid(p.proowner)<>e.owner OR p.prosecdef<>e.definer
   OR p.proconfig IS DISTINCT FROM e.config OR p.proacl::text[] IS DISTINCT FROM e.acl
   OR pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p.prosrc,'UTF8')),'hex')<>e."bodySha256"
   THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_SOURCE_PREIMAGE_DRIFT'; END IF;
 END LOOP;
 FOREACH sig IN ARRAY ARRAY['public.canonicalize_youtube_link(text)','public.extract_youtube_video_id(text)','public.generate_unique_id(text, text, text)','public.is_user_admin(uuid)','public.normalize_restaurant_identity_name(text)','public.resolve_restaurant_identity_name(text, text, text, text)']::text[] LOOP
  IF pg_catalog.has_function_privilege('privacy_workflow_owner',pg_catalog.to_regprocedure(sig),'EXECUTE')
     OR pg_catalog.has_function_privilege('anon',pg_catalog.to_regprocedure(sig),'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',pg_catalog.to_regprocedure(sig),'EXECUTE')
     OR NOT pg_catalog.has_schema_privilege('privacy_workflow_owner','public','USAGE')
     OR EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=sig AND grantee='privacy_workflow_owner')
     THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_HELPER_ENTRANCE_DRIFT'; END IF;
 END LOOP;
END $admission$;
DO $helpers$
DECLARE sig text; source text; definition text; rewritten text:='
    SELECT EXISTS (
        SELECT 1
        FROM public.user_roles AS role_row
        JOIN public.user_account_status AS status_row
          ON status_row.user_id = role_row.user_id
        WHERE role_row.user_id = user_uuid
          AND role_row.role::text = ''admin''
          AND status_row.account_status = ''active''
          AND status_row.disabled_at IS NULL
    )
'; target oid;
BEGIN
 target:='public.is_user_admin(uuid)'::regprocedure;
 SELECT prosrc,pg_catalog.pg_get_functiondef(oid) INTO source,definition FROM pg_catalog.pg_proc WHERE oid=target;
 IF (length(definition)-length(replace(definition,source,'')))/length(source)<>1 THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_ADMIN_REWRITE_IDENTITY'; END IF;
 EXECUTE replace(definition,source,rewritten);
 IF (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid=target) IS DISTINCT FROM rewritten THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_ADMIN_REWRITE_DRIFT'; END IF;
 FOREACH sig IN ARRAY ARRAY['public.canonicalize_youtube_link(text)','public.extract_youtube_video_id(text)','public.generate_unique_id(text, text, text)','public.is_user_admin(uuid)','public.normalize_restaurant_identity_name(text)','public.resolve_restaurant_identity_name(text, text, text, text)']::text[] LOOP
  EXECUTE 'GRANT EXECUTE ON FUNCTION '||sig||' TO privacy_workflow_owner';
 END LOOP;
END $helpers$;

-- Same narrow PG17 transient membership pattern as guarded registration.
-- Restore every original grantor row before running G014 from the private helper.
DO $registration$
DECLARE helper oid; members jsonb; current_members jsonb;
BEGIN
 SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO members FROM pg_catalog.pg_auth_members m;
 IF pg_catalog.to_regprocedure('pg_temp.private_workflow_contract_registration()') IS NOT NULL THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_TEMP_HELPER_EXISTS'; END IF;
 EXECUTE 'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres';
 EXECUTE 'SET LOCAL ROLE privacy_workflow_owner';
 EXECUTE $definition$
 CREATE FUNCTION pg_temp.private_workflow_contract_registration() RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $body$
 DECLARE source text; definition text; metadata jsonb; target oid; name text; pinned_hash text;
   acl_replacement text; required_replacement text;
   anchor text:='            WHERE acl.grantee NOT IN (p.proowner, ''service_role''::pg_catalog.regrole)
              OR acl.is_grantable';
   replacement text:='            WHERE (acl.grantee NOT IN (p.proowner, ''service_role''::pg_catalog.regrole)
              AND NOT (v_signature IN (
                ''public.extract_youtube_video_id(text)'',
                ''public.normalize_restaurant_identity_name(text)'',
                ''public.resolve_restaurant_identity_name(text,text,text,text)''
              ) AND acl.grantee = ''privacy_workflow_owner''::pg_catalog.regrole
                  AND acl.grantor = p.proowner AND acl.privilege_type = ''EXECUTE''))
              OR acl.is_grantable';
   service_anchor text:='          AND pg_catalog.has_function_privilege(''service_role'', p.oid, ''EXECUTE'')';
   service_replacement text:='          AND (v_signature NOT IN (
                ''public.extract_youtube_video_id(text)'',
                ''public.normalize_restaurant_identity_name(text)'',
                ''public.resolve_restaurant_identity_name(text,text,text,text)''
          ) OR (
            pg_catalog.has_function_privilege(''privacy_workflow_owner'', p.oid, ''EXECUTE'')
            AND EXISTS (
              SELECT 1 FROM pg_catalog.aclexplode(COALESCE(p.proacl, pg_catalog.acldefault(''f'', p.proowner))) AS internal_acl
              WHERE internal_acl.grantee = ''privacy_workflow_owner''::pg_catalog.regrole
                AND internal_acl.grantor = p.proowner
                AND internal_acl.privilege_type = ''EXECUTE'' AND NOT internal_acl.is_grantable
            )
          ))
          AND pg_catalog.has_function_privilege(''service_role'', p.oid, ''EXECUTE'')';
   rewritten text;
 BEGIN
  IF session_user<>'postgres' OR current_user<>'privacy_workflow_owner' THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_REGISTRATION_EXECUTOR'; END IF;
  FOREACH name IN ARRAY ARRAY['definer','catalog'] LOOP
  target:=pg_catalog.to_regprocedure('privacy_retention.assert_g014_'||name||'_contract()');
  pinned_hash:=CASE name WHEN 'definer' THEN 'b9e2f7d812783deee6c91d27d22d6c2019be9aa04e4f1221cc7482567775354a'
    ELSE '50948ddce54dbba9497978964bebc535c27ebe98fb0f46bf05e2ec17ab0b9e01' END;
  acl_replacement:=CASE name WHEN 'catalog' THEN replace(replacement,'v_signature','v_expected.source_signature') ELSE replacement END;
  required_replacement:=CASE name WHEN 'catalog' THEN replace(service_replacement,'v_signature','v_expected.source_signature') ELSE service_replacement END;
  SELECT prosrc,pg_catalog.pg_get_functiondef(oid),to_jsonb(p)-'prosrc' INTO source,definition,metadata FROM pg_catalog.pg_proc p WHERE oid=target;
  IF pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(source,'UTF8')),'hex')<>pinned_hash
    OR (length(source)-length(replace(source,anchor,'')))/length(anchor)<>1
    OR (length(source)-length(replace(source,service_anchor,'')))/length(service_anchor)<>1
    THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_CONTRACT_SOURCE_DRIFT'; END IF;
  rewritten:=replace(replace(source,anchor,acl_replacement),service_anchor,required_replacement);
  EXECUTE replace(definition,source,rewritten);
  IF (SELECT to_jsonb(p)-'prosrc' FROM pg_catalog.pg_proc p WHERE oid=target) IS DISTINCT FROM metadata
     OR (SELECT prosrc FROM pg_catalog.pg_proc WHERE oid=target) IS DISTINCT FROM rewritten
    THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_CONTRACT_METADATA_DRIFT'; END IF;
  END LOOP;
  PERFORM privacy_retention.assert_g014_workflow_owner_contract();
  PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
  PERFORM privacy_retention.assert_g014_definer_contract();
  PERFORM privacy_retention.assert_g014_catalog_contract();
  DROP FUNCTION pg_temp.private_workflow_contract_registration();
 END $body$;
 $definition$;
 EXECUTE 'REVOKE ALL ON FUNCTION pg_temp.private_workflow_contract_registration() FROM PUBLIC,anon,authenticated,service_role';
 EXECUTE 'GRANT EXECUTE ON FUNCTION pg_temp.private_workflow_contract_registration() TO postgres';
 EXECUTE 'RESET ROLE';
 EXECUTE 'REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres';
 SELECT jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor) INTO current_members FROM pg_catalog.pg_auth_members m;
 IF current_members IS DISTINCT FROM members THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_MEMBERSHIP_DRIFT'; END IF;
 helper:=pg_catalog.to_regprocedure('pg_temp.private_workflow_contract_registration()');
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc p WHERE oid=helper AND proowner='privacy_workflow_owner'::regrole
     AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]
     AND (SELECT count(*) FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))))=2
     AND NOT EXISTS(SELECT 1 FROM pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
       WHERE a.grantee NOT IN('privacy_workflow_owner'::regrole,'postgres'::regrole) OR a.is_grantable OR a.privilege_type<>'EXECUTE'))
    THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_REGISTRATION_HELPER_DRIFT'; END IF;
 PERFORM pg_temp.private_workflow_contract_registration();
 IF pg_catalog.to_regprocedure('pg_temp.private_workflow_contract_registration()') IS NOT NULL THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_REGISTRATION_HELPER_REMAINS'; END IF;
END $registration$;

DO $postconditions$
DECLARE p pg_catalog.pg_proc; prior record; helpers oid[]; body_exceptions oid[]; after_acl text[]; expected_acl text[];
BEGIN
 SELECT array_agg(pg_catalog.to_regprocedure(s)::oid) INTO helpers FROM unnest(ARRAY['public.canonicalize_youtube_link(text)','public.extract_youtube_video_id(text)','public.generate_unique_id(text, text, text)','public.is_user_admin(uuid)','public.normalize_restaurant_identity_name(text)','public.resolve_restaurant_identity_name(text, text, text, text)']::text[]) s;
 body_exceptions:=ARRAY['public.is_user_admin(uuid)'::regprocedure::oid,'privacy_retention.assert_g014_definer_contract()'::regprocedure::oid,'privacy_retention.assert_g014_catalog_contract()'::regprocedure::oid];
 IF (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc WHERE oid='public.is_user_admin(uuid)'::regprocedure) IS DISTINCT FROM '7535e6546e7c314e4cb939430ea4a22a233d44afe2d62579852b09105ff6ce76'
    OR (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc WHERE oid='privacy_retention.assert_g014_definer_contract()'::regprocedure) IS DISTINCT FROM '1f8556b4864ffae4b4ebde31b364a887f05f05e8dde7feaf41d2e5390b5088b9'
    OR (SELECT pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex') FROM pg_catalog.pg_proc WHERE oid='privacy_retention.assert_g014_catalog_contract()'::regprocedure) IS DISTINCT FROM '0460ce118cfdcb6a1f86cd85f5699252b1004d13a87734302a745f2dd2917ffb'
    THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_FINAL_BODY_DRIFT'; END IF;
 IF (SELECT count(*) FROM pg_temp.private_workflow_proc_before)<>(SELECT count(*) FROM pg_catalog.pg_proc proc_row JOIN pg_catalog.pg_namespace n ON n.oid=proc_row.pronamespace WHERE n.nspname NOT LIKE 'pg_temp_%') THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_PROC_SET_DRIFT'; END IF;
 FOR prior IN SELECT * FROM pg_temp.private_workflow_proc_before LOOP
  SELECT * INTO p FROM pg_catalog.pg_proc WHERE oid=prior.oid;
  IF p.oid IS NULL OR (to_jsonb(p)-'proacl'-'prosrc') IS DISTINCT FROM (prior.metadata-'proacl'-'prosrc') THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_PROC_METADATA_DRIFT'; END IF;
  IF NOT(p.oid=ANY(body_exceptions)) AND p.prosrc IS DISTINCT FROM prior.metadata->>'prosrc' THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_UNRELATED_BODY_DRIFT'; END IF;
  IF NOT(p.oid=ANY(helpers)) AND to_jsonb(p)->'proacl' IS DISTINCT FROM prior.metadata->'proacl' THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_UNRELATED_ACL_DRIFT'; END IF;
  IF p.oid=ANY(helpers) THEN
   SELECT array_agg(v ORDER BY v) INTO after_acl FROM jsonb_array_elements_text(to_jsonb(p)->'proacl') v;
   SELECT array_agg(v ORDER BY v) INTO expected_acl FROM (
      SELECT v FROM jsonb_array_elements_text(prior.metadata->'proacl') v
      UNION ALL SELECT 'privacy_workflow_owner=X/postgres') x(v);
   IF after_acl IS DISTINCT FROM expected_acl THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_HELPER_ACL_DELTA_DRIFT'; END IF;
   IF NOT pg_catalog.has_function_privilege('privacy_workflow_owner',p.oid,'EXECUTE')
      OR pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') OR pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_EFFECTIVE_EXECUTE_DRIFT'; END IF;
  END IF;
 END LOOP;
 IF EXISTS((TABLE pg_catalog.pg_auth_members EXCEPT TABLE pg_temp.private_workflow_members_before) UNION ALL (TABLE pg_temp.private_workflow_members_before EXCEPT TABLE pg_catalog.pg_auth_members)) THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_FINAL_MEMBERSHIP_DRIFT'; END IF;
 IF EXISTS((TABLE pg_catalog.pg_roles EXCEPT TABLE pg_temp.private_workflow_roles_before) UNION ALL (TABLE pg_temp.private_workflow_roles_before EXCEPT TABLE pg_catalog.pg_roles)) THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_ROLE_ATTRIBUTE_DRIFT'; END IF;
 IF EXISTS((TABLE privacy_retention.g014_catalog_contract_manifest EXCEPT TABLE pg_temp.private_workflow_manifest_before) UNION ALL (TABLE pg_temp.private_workflow_manifest_before EXCEPT TABLE privacy_retention.g014_catalog_contract_manifest)) THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_MANIFEST_DRIFT'; END IF;
 IF EXISTS((TABLE privacy_retention.g014_public_rpc_allowlist EXCEPT TABLE pg_temp.private_workflow_allowlist_before) UNION ALL (TABLE pg_temp.private_workflow_allowlist_before EXCEPT TABLE privacy_retention.g014_public_rpc_allowlist)) THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_DATA_API_ALLOWLIST_DRIFT'; END IF;
 IF EXISTS((TABLE privacy_retention.g014_nested_helper_allowlist EXCEPT TABLE pg_temp.private_workflow_nested_before) UNION ALL (TABLE pg_temp.private_workflow_nested_before EXCEPT TABLE privacy_retention.g014_nested_helper_allowlist)) THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_NESTED_ALLOWLIST_DRIFT'; END IF;
 IF EXISTS((SELECT c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%' EXCEPT TABLE pg_temp.private_workflow_relations_before) UNION ALL (TABLE pg_temp.private_workflow_relations_before EXCEPT SELECT c.oid,c.relowner,c.relacl,c.relrowsecurity,c.relforcerowsecurity FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT LIKE 'pg_temp_%' AND n.nspname NOT LIKE 'pg_toast_temp_%')) THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_RELATION_RLS_ACL_DRIFT'; END IF;
 IF EXISTS((SELECT oid,tgrelid,tgname,tgfoid,tgenabled,pg_catalog.pg_get_triggerdef(oid) FROM pg_catalog.pg_trigger EXCEPT TABLE pg_temp.private_workflow_triggers_before) UNION ALL (TABLE pg_temp.private_workflow_triggers_before EXCEPT SELECT oid,tgrelid,tgname,tgfoid,tgenabled,pg_catalog.pg_get_triggerdef(oid) FROM pg_catalog.pg_trigger)) THEN RAISE EXCEPTION 'PRIVATE_WORKFLOW_TRIGGER_DRIFT'; END IF;
END $postconditions$;
NOTIFY pgrst,'reload schema';
COMMIT;
