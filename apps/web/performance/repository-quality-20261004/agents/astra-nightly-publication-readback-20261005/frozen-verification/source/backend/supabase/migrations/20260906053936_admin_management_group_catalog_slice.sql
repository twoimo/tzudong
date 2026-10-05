-- Three accepted-source RPCs only; unchanged August003 bodies.
-- Current52 -> 53 requires independently pinned offline planner and whole-file transaction.
-- Source-local approval is not hosted approval. No history repair or producer freeze exit.
DO $admin_management_group$
DECLARE
 v_owner oid := pg_catalog.to_regrole('privacy_workflow_owner');
 v_runner oid := pg_catalog.to_regrole(session_user);
 v_before jsonb; v_after jsonb; v_oid oid; v_signature text;
 v_rel text; v_forced boolean; v_owned boolean; v_cmd text;
 v_snapshot constant text := $snapshot$SELECT jsonb_build_object(
'types',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(t) AS value FROM pg_catalog.pg_type t JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname !~ '^pg_(temp|toast_temp)') rows),
'enums',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(e) AS value FROM pg_catalog.pg_enum e) rows),
'default_acls',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(a) AS value FROM pg_catalog.pg_default_acl a) rows),
'memberships',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(m) AS value FROM pg_catalog.pg_auth_members m) rows),
'roles',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(r) AS value FROM pg_catalog.pg_roles r) rows),
'schemas',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(n) AS value FROM pg_catalog.pg_namespace n WHERE nspname !~ '^pg_(temp|toast_temp)') rows),
'relations',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(c)-ARRAY['relpages','reltuples','relallvisible','relfrozenxid','relminmxid'] AS value FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','privacy_retention','auth','storage','extensions')) rows),
'functions',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(p) AS value FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname !~ '^pg_(temp|toast_temp)' AND NOT(n.nspname='public' AND p.proname IN ('read_admin_user_management_metadata','read_admin_user_audit_events','append_admin_user_audit_event'))) rows),
'allowlist',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(a) AS value FROM privacy_retention.g014_public_rpc_allowlist a WHERE NOT(source_signature IN ('public.read_admin_user_management_metadata(uuid[])','public.read_admin_user_audit_events(integer)','public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)') OR (function_schema='public' AND function_name IN ('read_admin_user_management_metadata','read_admin_user_audit_events','append_admin_user_audit_event')))) rows),
'policies',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(x) AS value FROM pg_catalog.pg_policy x WHERE polrelid IN (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','privacy_retention','auth','storage','extensions'))) rows),
'columns',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(x) AS value FROM pg_catalog.pg_attribute x WHERE attrelid IN (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','privacy_retention','auth','storage','extensions'))) rows),
'constraints',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(x) AS value FROM pg_catalog.pg_constraint x WHERE conrelid IN (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','privacy_retention','auth','storage','extensions'))) rows),
'indexes',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(x) AS value FROM pg_catalog.pg_index x WHERE indrelid IN (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','privacy_retention','auth','storage','extensions'))) rows),
'defaults',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(x) AS value FROM pg_catalog.pg_attrdef x WHERE adrelid IN (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','privacy_retention','auth','storage','extensions'))) rows),
'triggers',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(x) AS value FROM pg_catalog.pg_trigger x WHERE tgrelid IN (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','privacy_retention','auth','storage','extensions'))) rows),
'rules',(SELECT encode(sha256(convert_to(coalesce(jsonb_agg(value ORDER BY value::text),'[]'::jsonb)::text,'UTF8')),'hex') FROM (SELECT to_jsonb(x) AS value FROM pg_catalog.pg_rewrite x WHERE ev_class IN (SELECT c.oid FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','privacy_retention','auth','storage','extensions'))) rows))$snapshot$;
BEGIN
  PERFORM pg_catalog.set_config('search_path','pg_catalog',true);
  IF pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17
     OR current_user <> 'postgres' OR session_user <> 'postgres'
     OR pg_catalog.current_setting('transaction_read_only') <> 'off'
     OR v_owner IS NULL THEN
    RAISE EXCEPTION 'admin_group_executor_denied';
  END IF;
  PERFORM pg_catalog.set_config('lock_timeout','2s',true);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tzudong:admin-management-group:v1',0));
  PERFORM pg_catalog.set_config('lock_timeout','2s',true);
  LOCK TABLE public.profiles,public.user_roles,public.user_account_status,public.admin_audit_events IN SHARE MODE;
  LOCK TABLE privacy_retention.g014_public_rpc_allowlist IN SHARE ROW EXCLUSIVE MODE;
 IF EXISTS(SELECT 1 FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname IN ('read_admin_user_management_metadata','read_admin_user_audit_events','append_admin_user_audit_event')) OR EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature IN ('public.read_admin_user_management_metadata(uuid[])','public.read_admin_user_audit_events(integer)','public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)') OR (function_schema='public' AND function_name IN ('read_admin_user_management_metadata','read_admin_user_audit_events','append_admin_user_audit_event'))) THEN RAISE EXCEPTION 'admin_group_identity_conflict'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE oid=v_owner AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolinherit)
     OR (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE roleid=v_owner AND member=v_runner) <> 2
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid=v_owner AND member=v_runner AND admin_option AND NOT inherit_option AND NOT set_option AND grantor<>v_runner)
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid=v_owner AND member=v_runner AND grantor=v_runner AND NOT admin_option AND inherit_option AND NOT set_option)
     OR pg_catalog.pg_has_role(v_runner,v_owner,'SET') THEN
    RAISE EXCEPTION 'admin_group_membership_admission_denied';
  END IF;
 IF NOT has_schema_privilege(v_owner,'public','CREATE') THEN RAISE EXCEPTION 'admin_group_create_denied'; END IF;
-- BEGIN DEPENDENCY GUARD (shared read-only replay/readback contract)
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE oid=v_owner AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolinherit)
 OR NOT has_schema_privilege(v_owner,'public','USAGE')
 OR NOT has_schema_privilege('service_role','public','USAGE')
 OR NOT EXISTS(SELECT 1 FROM pg_enum WHERE enumtypid='public.app_role'::regtype AND enumlabel='admin')
 OR EXISTS(SELECT 1 FROM (VALUES ('public.profiles','user_id','uuid',true,false),('public.profiles','username','text',false,false),('public.profiles','nickname','text',true,false),('public.profiles','avatar_url','text',false,false),('public.profiles','role','text',true,false),('public.profiles','created_at','timestamptz',true,false),('public.profiles','updated_at','timestamptz',true,false),('public.user_roles','user_id','uuid',true,false),('public.user_roles','role','public.app_role',true,false),('public.user_account_status','user_id','uuid',true,false),('public.user_account_status','account_status','text',true,false),('public.user_account_status','disabled_at','timestamptz',false,false),('public.admin_audit_events','id','uuid',true,false),('public.admin_audit_events','actor_user_id','uuid',true,true),('public.admin_audit_events','target_user_id','uuid',false,true),('public.admin_audit_events','action','text',true,true),('public.admin_audit_events','reason','text',false,true),('public.admin_audit_events','status','text',true,true),('public.admin_audit_events','correlation_id','uuid',false,true),('public.admin_audit_events','applied_at','timestamptz',false,true),('public.admin_audit_events','error_code','text',false,true),('public.admin_audit_events','created_at','timestamptz',true,false),('public.admin_audit_events','audit_counts','jsonb',true,true),('public.admin_audit_events','audit_flags','jsonb',true,true),('public.admin_audit_events','before_state','jsonb',true,true),('public.admin_audit_events','after_state','jsonb',true,true),('public.admin_audit_events','request_id','text',false,true),('public.admin_audit_events','ip_hash','text',false,true),('public.admin_audit_events','user_agent_hash','text',false,true)) x(rel,col,typ,nn,ins)
   LEFT JOIN pg_attribute a ON a.attrelid=to_regclass(x.rel) AND a.attname=x.col AND NOT a.attisdropped
   WHERE a.attnum IS NULL OR a.atttypid<>to_regtype(x.typ) OR a.attnotnull<>x.nn
     OR NOT has_column_privilege(v_owner,a.attrelid,a.attnum,'SELECT')
     OR (x.ins AND NOT has_column_privilege(v_owner,a.attrelid,a.attnum,'INSERT'))) THEN
 RAISE EXCEPTION 'admin_group_column_dependency_denied'; END IF;
 FOR v_rel,v_forced,v_owned IN SELECT * FROM (VALUES ('public.profiles',true,false),('public.user_roles',false,false),('public.user_account_status',false,false),('public.admin_audit_events',true,true)) x LOOP
   IF NOT EXISTS(SELECT 1 FROM pg_class WHERE oid=to_regclass(v_rel) AND relkind='r' AND relrowsecurity AND relforcerowsecurity=v_forced AND (relowner=v_owner)=v_owned) THEN RAISE EXCEPTION 'admin_group_relation_denied'; END IF;
   FOR v_cmd IN SELECT unnest(CASE WHEN v_rel='public.admin_audit_events' THEN ARRAY['r','a'] ELSE ARRAY['r'] END) LOOP
     IF NOT EXISTS(SELECT 1 FROM pg_policy p WHERE polrelid=to_regclass(v_rel) AND polcmd::text IN (v_cmd,'*') AND polpermissive
       AND (CASE WHEN v_cmd='a' THEN pg_get_expr(coalesce(polwithcheck,polqual),polrelid) ELSE pg_get_expr(polqual,polrelid) END) IN ('true','(true)')
       AND EXISTS(SELECT 1 FROM unnest(polroles) r WHERE r=0 OR pg_has_role(v_owner,r,'USAGE')))
     OR EXISTS(SELECT 1 FROM pg_policy p WHERE polrelid=to_regclass(v_rel) AND polcmd::text IN (v_cmd,'*') AND NOT polpermissive
       AND coalesce((CASE WHEN v_cmd='a' THEN pg_get_expr(coalesce(polwithcheck,polqual),polrelid) ELSE pg_get_expr(polqual,polrelid) END) NOT IN ('true','(true)'),true)
       AND EXISTS(SELECT 1 FROM unnest(polroles) r WHERE r=0 OR pg_has_role(v_owner,r,'USAGE'))) THEN RAISE EXCEPTION 'admin_group_rls_visibility_denied'; END IF;
   END LOOP;
 END LOOP;
 IF EXISTS(SELECT 1 FROM (VALUES('profiles'),('user_account_status')) r(rel) WHERE NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attname='user_id' WHERE i.indrelid=to_regclass('public.'||rel) AND i.indisunique AND i.indisvalid AND i.indisready AND i.indimmediate AND i.indnkeyatts=1 AND i.indkey[0]=a.attnum AND i.indpred IS NULL AND i.indexprs IS NULL)) THEN RAISE EXCEPTION 'admin_group_join_key_denied'; END IF;
 IF (SELECT count(*) FROM pg_attribute WHERE attrelid='public.admin_audit_events'::regclass AND attnum>0 AND NOT attisdropped)<>17
 OR EXISTS(SELECT 1 FROM pg_rewrite WHERE ev_class='public.admin_audit_events'::regclass)
 OR (SELECT count(*) FROM pg_constraint WHERE conrelid='public.admin_audit_events'::regclass)<>4
 OR EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='public.admin_audit_events'::regclass AND (NOT convalidated OR contype='f'))
 OR NOT EXISTS(SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attname='id' WHERE c.conrelid='public.admin_audit_events'::regclass AND c.contype='p' AND c.conkey=ARRAY[a.attnum]::smallint[])
 OR NOT EXISTS(SELECT 1 FROM pg_constraint c WHERE c.conrelid='public.admin_audit_events'::regclass AND c.conname='admin_audit_events_whitelisted_contract' AND c.contype='c' AND c.convalidated AND regexp_replace(pg_get_expr(c.conbin,c.conrelid),'[[:space:]()]','','g')='public.admin_user_audit_event_is_safeaction,status,reason,error_code,before_state,after_state,audit_counts,audit_flags,request_id,ip_hash,user_agent_hash')
 OR (SELECT count(*) FROM pg_trigger WHERE tgrelid='public.admin_audit_events'::regclass AND NOT tgisinternal)<>1
 OR EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.admin_audit_events'::regclass AND (tgtype::int & 4)<>0)
 OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.admin_audit_events'::regclass AND tgname='g014_admin_audit_events_append_only' AND tgtype=27 AND tgenabled='O' AND tgfoid=to_regprocedure('privacy_retention.g014_reject_audit_mutation()'))
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('privacy_retention.g014_reject_audit_mutation()') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='eefd04295b4a2a4ae6a60b3a5e93b430808b0a9a668829e8bf10ba9234f21772')
 THEN RAISE EXCEPTION 'admin_group_audit_contract_denied'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid='public.admin_audit_events'::regclass AND a.attname='id' AND pg_get_expr(d.adbin,d.adrelid) IN ('gen_random_uuid()','pg_catalog.gen_random_uuid()','extensions.gen_random_uuid()'))
 OR NOT EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum WHERE d.adrelid='public.admin_audit_events'::regclass AND a.attname='created_at' AND pg_get_expr(d.adbin,d.adrelid) IN ('now()','pg_catalog.now()'))
 OR NOT has_function_privilege(v_owner,'pg_catalog.gen_random_uuid()','EXECUTE') OR NOT has_function_privilege(v_owner,'pg_catalog.now()','EXECUTE')
 OR EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_depend x ON x.classid='pg_attrdef'::regclass AND x.objid=d.oid JOIN pg_class c ON x.refclassid='pg_class'::regclass AND x.refobjid=c.oid WHERE d.adrelid='public.admin_audit_events'::regclass AND c.relkind='S')
 OR EXISTS(SELECT 1 FROM pg_attrdef d JOIN pg_depend x ON x.classid='pg_attrdef'::regclass AND x.objid=d.oid WHERE d.adrelid='public.admin_audit_events'::regclass AND CASE WHEN x.refclassid='pg_proc'::regclass THEN NOT has_function_privilege(v_owner,x.refobjid,'EXECUTE') ELSE false END)
 THEN RAISE EXCEPTION 'admin_group_default_dependency_denied'; END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='admin_user_audit_event_is_safe')<>1 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.admin_user_audit_event_is_safe(text,text,text,text,jsonb,jsonb,jsonb,jsonb,text,text,text)') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='9594ce8b4eb33861298e6d5f3598d96ca63ec37918ea2647ede25c3315ab23cf' AND has_function_privilege(v_owner,oid,'EXECUTE') AND NOT prosecdef AND provolatile='i' AND proconfig IN (ARRAY['search_path=pg_catalog']::text[],ARRAY['search_path=""']::text[])) THEN RAISE EXCEPTION 'admin_group_helper_denied'; END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='admin_user_audit_reason_code')<>1 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.admin_user_audit_reason_code(text,text)') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='2b9fd117fcf923d0aaf7858af3f349690b125fae5467329c3205c57a216d9cf1' AND has_function_privilege(v_owner,oid,'EXECUTE') AND NOT prosecdef AND provolatile='i' AND proconfig IN (ARRAY['search_path=pg_catalog']::text[],ARRAY['search_path=""']::text[])) THEN RAISE EXCEPTION 'admin_group_helper_denied'; END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='admin_user_audit_counts_are_safe')<>1 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.admin_user_audit_counts_are_safe(jsonb)') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='9add17e04ded01d3dde7cd9687cf96fa4f587b387a31ee23b1475b3615c2e26f' AND has_function_privilege(v_owner,oid,'EXECUTE') AND NOT prosecdef AND provolatile='i' AND proconfig IN (ARRAY['search_path=pg_catalog']::text[],ARRAY['search_path=""']::text[])) THEN RAISE EXCEPTION 'admin_group_helper_denied'; END IF;
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='admin_user_audit_flags_are_safe')<>1 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('public.admin_user_audit_flags_are_safe(jsonb)') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='6d00ddf8bb5a81732cbdffcf414af254cc5ccb87f8d5641df56ee8fbe9e90b36' AND has_function_privilege(v_owner,oid,'EXECUTE') AND NOT prosecdef AND provolatile='i' AND proconfig IN (ARRAY['search_path=pg_catalog']::text[],ARRAY['search_path=""']::text[])) THEN RAISE EXCEPTION 'admin_group_helper_denied'; END IF;
-- END DEPENDENCY GUARD
  EXECUTE v_snapshot INTO v_before;

  -- Temporarily enable SET on the existing self-granted row only.
  -- Preserve its ADMIN=false/INHERIT=true and the foreign ADMIN=true/INHERIT=false row.
  GRANT privacy_workflow_owner TO postgres WITH SET TRUE GRANTED BY postgres;
  SET LOCAL ROLE privacy_workflow_owner;
  -- Transaction-local bridge runs assertions after SET is restored, preserving
  -- G041's membership invariant while checking the real G014 routines unchanged.
  CREATE FUNCTION pg_temp.admin_group_g014_check() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $bridge$
  BEGIN
    PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
    PERFORM privacy_retention.assert_g014_definer_contract();
    PERFORM privacy_retention.assert_g014_catalog_contract();
  END $bridge$;
  REVOKE ALL ON FUNCTION pg_temp.admin_group_g014_check() FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION pg_temp.admin_group_g014_check() TO postgres;
  RESET ROLE;
  GRANT privacy_workflow_owner TO postgres WITH SET FALSE GRANTED BY postgres;
  EXECUTE v_snapshot INTO v_after;
  IF v_after IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'admin_group_bridge_restore_drift'; END IF;
  PERFORM pg_temp.admin_group_g014_check();

  GRANT privacy_workflow_owner TO postgres WITH SET TRUE GRANTED BY postgres;
  SET LOCAL ROLE privacy_workflow_owner;
  EXECUTE $rpc$CREATE FUNCTION public.read_admin_user_management_metadata(
  p_user_ids uuid[]
)
RETURNS TABLE (
  user_id uuid,
  username text,
  nickname text,
  avatar_url text,
  profile_role text,
  profile_created_at timestamptz,
  profile_updated_at timestamptz,
  is_admin boolean,
  account_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  requested_count integer := pg_catalog.cardinality(p_user_ids);
BEGIN
  IF p_user_ids IS NULL
     OR requested_count NOT BETWEEN 1 AND 200
     OR pg_catalog.array_position(p_user_ids, NULL::uuid) IS NOT NULL
     OR (
       SELECT count(DISTINCT requested.user_id)
         FROM pg_catalog.unnest(p_user_ids) AS requested(user_id)
     ) <> requested_count THEN
    RAISE EXCEPTION 'admin_user_metadata_request_invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    requested.user_id,
    profile_row.username,
    profile_row.nickname,
    profile_row.avatar_url,
    profile_row.role AS profile_role,
    profile_row.created_at AS profile_created_at,
    profile_row.updated_at AS profile_updated_at,
    EXISTS (
      SELECT 1
        FROM public.user_roles AS role_row
       WHERE role_row.user_id = requested.user_id
         AND role_row.role::text = 'admin'
    ) AS is_admin,
    status_row.account_status
    FROM pg_catalog.unnest(p_user_ids) WITH ORDINALITY
      AS requested(user_id, request_ordinal)
    LEFT JOIN public.profiles AS profile_row
      ON profile_row.user_id = requested.user_id
    LEFT JOIN public.user_account_status AS status_row
      ON status_row.user_id = requested.user_id
   ORDER BY requested.request_ordinal;
END
$$;$rpc$;
  REVOKE ALL ON FUNCTION public.read_admin_user_management_metadata(uuid[]) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.read_admin_user_management_metadata(uuid[]) TO service_role;
  EXECUTE $rpc$CREATE FUNCTION public.read_admin_user_audit_events(
  p_limit integer
)
RETURNS TABLE (
  id uuid,
  actor_user_id uuid,
  target_user_id uuid,
  action text,
  reason text,
  status text,
  correlation_id uuid,
  applied_at timestamptz,
  error_code text,
  created_at timestamptz,
  audit_counts jsonb,
  audit_flags jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'admin_user_audit_limit_invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    audit_row.id,
    audit_row.actor_user_id,
    audit_row.target_user_id,
    audit_row.action,
    audit_row.reason,
    audit_row.status,
    audit_row.correlation_id,
    audit_row.applied_at,
    audit_row.error_code,
    audit_row.created_at,
    audit_row.audit_counts,
    audit_row.audit_flags
    FROM public.admin_audit_events AS audit_row
   ORDER BY audit_row.created_at DESC, audit_row.id DESC
   LIMIT p_limit;
END
$$;$rpc$;
  REVOKE ALL ON FUNCTION public.read_admin_user_audit_events(integer) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.read_admin_user_audit_events(integer) TO service_role;
  EXECUTE $rpc$CREATE FUNCTION public.append_admin_user_audit_event(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_reason text,
  p_status text,
  p_correlation_id uuid,
  p_audit_counts jsonb,
  p_audit_flags jsonb,
  p_applied_at timestamptz,
  p_error_code text,
  p_request_id uuid,
  p_ip_hash text,
  p_user_agent_hash text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  audit_id uuid;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_request_id IS NULL
     OR p_audit_counts IS NULL
     OR p_audit_flags IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM public.user_roles AS role_row
         JOIN public.user_account_status AS status_row
           ON status_row.user_id = role_row.user_id
        WHERE role_row.user_id = p_actor_user_id
          AND role_row.role::text = 'admin'
          AND status_row.account_status = 'active'
          AND status_row.disabled_at IS NULL
     )
     OR (p_status = 'applied') IS DISTINCT FROM (p_applied_at IS NOT NULL)
     OR NOT public.admin_user_audit_event_is_safe(
       p_action,
       p_status,
       p_reason,
       p_error_code,
       '{}'::jsonb,
       '{}'::jsonb,
       p_audit_counts,
       p_audit_flags,
       p_request_id::text,
       p_ip_hash,
       p_user_agent_hash
     ) THEN
    RAISE EXCEPTION 'admin_user_audit_event_invalid'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.admin_audit_events (
    actor_user_id,
    target_user_id,
    action,
    reason,
    before_state,
    after_state,
    audit_counts,
    audit_flags,
    status,
    correlation_id,
    applied_at,
    error_code,
    request_id,
    ip_hash,
    user_agent_hash
  ) VALUES (
    p_actor_user_id,
    p_target_user_id,
    p_action,
    p_reason,
    '{}'::jsonb,
    '{}'::jsonb,
    p_audit_counts,
    p_audit_flags,
    p_status,
    p_correlation_id,
    p_applied_at,
    p_error_code,
    p_request_id::text,
    p_ip_hash,
    p_user_agent_hash
  )
  RETURNING admin_audit_events.id INTO audit_id;

  RETURN audit_id;
END
$$;$rpc$;
  REVOKE ALL ON FUNCTION public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text) FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text) TO service_role;
  RESET ROLE;
  GRANT privacy_workflow_owner TO postgres WITH SET FALSE GRANTED BY postgres;
 INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature) SELECT 'public',p.proname,p.proargtypes::text,'service_role','public.read_admin_user_management_metadata(uuid[])' FROM pg_proc p WHERE p.oid=to_regprocedure('public.read_admin_user_management_metadata(uuid[])');
 INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature) SELECT 'public',p.proname,p.proargtypes::text,'service_role','public.read_admin_user_audit_events(integer)' FROM pg_proc p WHERE p.oid=to_regprocedure('public.read_admin_user_audit_events(integer)');
 INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature) SELECT 'public',p.proname,p.proargtypes::text,'service_role','public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)' FROM pg_proc p WHERE p.oid=to_regprocedure('public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)');
-- BEGIN TARGET GUARD
 v_signature := 'public.read_admin_user_management_metadata(uuid[])'; v_oid := to_regprocedure(v_signature);
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='read_admin_user_management_metadata')<>1
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=v_oid AND proowner=v_owner AND prosecdef AND provolatile='s' AND prokind='f' AND proretset=true AND prorettype='record'::regtype AND pronargs=1 AND pronargdefaults=0 AND NOT proisstrict AND proparallel='u' AND proallargtypes=ARRAY['uuid[]'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'timestamptz'::regtype::oid,'timestamptz'::regtype::oid,'boolean'::regtype::oid,'text'::regtype::oid] AND proargmodes=ARRAY['i','t','t','t','t','t','t','t','t','t']::"char"[] AND proargnames=ARRAY['p_user_ids','user_id','username','nickname','avatar_url','profile_role','profile_created_at','profile_updated_at','is_admin','account_status']::text[] AND proconfig=ARRAY['search_path=""']::text[] AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='c5bbfc08c18c198680419a192ccc70893f2338786af175555cdd3378ae97f656')
 OR NOT coalesce(has_function_privilege('service_role',v_oid,'EXECUTE'),false)
 OR coalesce(has_function_privilege('anon',v_oid,'EXECUTE'),true)
 OR coalesce(has_function_privilege('authenticated',v_oid,'EXECUTE'),true)
 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=v_oid AND (a.grantee NOT IN (v_owner,'service_role'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
 OR (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=v_signature OR (function_schema='public' AND function_name='read_admin_user_management_metadata'))<>1
 OR NOT EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist a JOIN pg_proc p ON p.oid=v_oid WHERE a.source_signature=v_signature AND a.function_schema='public' AND a.function_name=p.proname AND a.identity_arguments=p.proargtypes::text AND a.grantee='service_role')
 THEN RAISE EXCEPTION 'admin_group_target_contract_denied'; END IF;
 v_signature := 'public.read_admin_user_audit_events(integer)'; v_oid := to_regprocedure(v_signature);
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='read_admin_user_audit_events')<>1
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=v_oid AND proowner=v_owner AND prosecdef AND provolatile='s' AND prokind='f' AND proretset=true AND prorettype='record'::regtype AND pronargs=1 AND pronargdefaults=0 AND NOT proisstrict AND proparallel='u' AND proallargtypes=ARRAY['integer'::regtype::oid,'uuid'::regtype::oid,'uuid'::regtype::oid,'uuid'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'text'::regtype::oid,'uuid'::regtype::oid,'timestamptz'::regtype::oid,'text'::regtype::oid,'timestamptz'::regtype::oid,'jsonb'::regtype::oid,'jsonb'::regtype::oid] AND proargmodes=ARRAY['i','t','t','t','t','t','t','t','t','t','t','t','t']::"char"[] AND proargnames=ARRAY['p_limit','id','actor_user_id','target_user_id','action','reason','status','correlation_id','applied_at','error_code','created_at','audit_counts','audit_flags']::text[] AND proconfig=ARRAY['search_path=""']::text[] AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='b840e6884476b4790fc377fa042c67031d6cfef950caa1ce05d33ac81a8c9c6e')
 OR NOT coalesce(has_function_privilege('service_role',v_oid,'EXECUTE'),false)
 OR coalesce(has_function_privilege('anon',v_oid,'EXECUTE'),true)
 OR coalesce(has_function_privilege('authenticated',v_oid,'EXECUTE'),true)
 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=v_oid AND (a.grantee NOT IN (v_owner,'service_role'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
 OR (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=v_signature OR (function_schema='public' AND function_name='read_admin_user_audit_events'))<>1
 OR NOT EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist a JOIN pg_proc p ON p.oid=v_oid WHERE a.source_signature=v_signature AND a.function_schema='public' AND a.function_name=p.proname AND a.identity_arguments=p.proargtypes::text AND a.grantee='service_role')
 THEN RAISE EXCEPTION 'admin_group_target_contract_denied'; END IF;
 v_signature := 'public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)'; v_oid := to_regprocedure(v_signature);
 IF (SELECT count(*) FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname='append_admin_user_audit_event')<>1
 OR NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=v_oid AND proowner=v_owner AND prosecdef AND provolatile='v' AND prokind='f' AND proretset=false AND prorettype='uuid'::regtype AND pronargs=13 AND pronargdefaults=0 AND NOT proisstrict AND proparallel='u' AND proallargtypes IS NULL AND proargmodes IS NULL AND proargnames=ARRAY['p_actor_user_id','p_target_user_id','p_action','p_reason','p_status','p_correlation_id','p_audit_counts','p_audit_flags','p_applied_at','p_error_code','p_request_id','p_ip_hash','p_user_agent_hash']::text[] AND proconfig=ARRAY['search_path=""']::text[] AND prolang=(SELECT oid FROM pg_language WHERE lanname='plpgsql') AND encode(sha256(convert_to(prosrc,'UTF8')),'hex')='2d4e8d8d1731edc0f5d5ea1cc57fd6c5dd3381faa1374fa96e3fd43a571057a6')
 OR NOT coalesce(has_function_privilege('service_role',v_oid,'EXECUTE'),false)
 OR coalesce(has_function_privilege('anon',v_oid,'EXECUTE'),true)
 OR coalesce(has_function_privilege('authenticated',v_oid,'EXECUTE'),true)
 OR EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid=v_oid AND (a.grantee NOT IN (v_owner,'service_role'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable))
 OR (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=v_signature OR (function_schema='public' AND function_name='append_admin_user_audit_event'))<>1
 OR NOT EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist a JOIN pg_proc p ON p.oid=v_oid WHERE a.source_signature=v_signature AND a.function_schema='public' AND a.function_name=p.proname AND a.identity_arguments=p.proargtypes::text AND a.grantee='service_role')
 THEN RAISE EXCEPTION 'admin_group_target_contract_denied'; END IF;
-- END TARGET GUARD
 EXECUTE v_snapshot INTO v_after;
 IF v_after IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'admin_group_catalog_restore_drift'; END IF;
 PERFORM pg_temp.admin_group_g014_check();
 DROP FUNCTION pg_temp.admin_group_g014_check();
END
$admin_management_group$;
NOTIFY pgrst, 'reload schema';
