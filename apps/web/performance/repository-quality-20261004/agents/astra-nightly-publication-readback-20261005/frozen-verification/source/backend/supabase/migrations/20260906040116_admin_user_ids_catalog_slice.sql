-- One accepted-source RPC; no prior migration replay or persistent role changes.
-- Source: 20260812000300_local_admin_data_boundary_convergence.sql, body unchanged.
-- Execute as one explicit transaction; parent owns exact current51 ledger preview/insertion.
-- No COMMIT here: the caller MUST wrap the complete file in BEGIN/COMMIT or BEGIN/ROLLBACK.
DO $admin_ids_slice$
DECLARE
  v_signature constant text := 'public.read_admin_user_ids_for_management()';
  v_owner oid := pg_catalog.to_regrole('privacy_workflow_owner');
  v_runner oid := pg_catalog.to_regrole(session_user);
  v_before jsonb;
  v_after jsonb;
  v_snapshot constant text := $snapshot$SELECT jsonb_build_object(
 'memberships',(SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]'::jsonb) FROM pg_catalog.pg_auth_members m),
 'roles',(SELECT jsonb_agg(to_jsonb(r) ORDER BY oid) FROM pg_catalog.pg_roles r),
 'schemas',(SELECT jsonb_agg(to_jsonb(n) ORDER BY oid) FROM pg_catalog.pg_namespace n WHERE nspname IN ('public','privacy_retention')),
 'relations',(SELECT jsonb_agg(to_jsonb(c) ORDER BY oid) FROM pg_catalog.pg_class c WHERE oid IN ('public.user_roles'::regclass,'privacy_retention.g014_public_rpc_allowlist'::regclass)),
 'policies',(SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY oid),'[]'::jsonb) FROM pg_catalog.pg_policy p WHERE polrelid IN ('public.user_roles'::regclass,'privacy_retention.g014_public_rpc_allowlist'::regclass)),
 'columns',(SELECT jsonb_agg(to_jsonb(a) ORDER BY attrelid,attnum) FROM pg_catalog.pg_attribute a WHERE attrelid IN ('public.user_roles'::regclass,'privacy_retention.g014_public_rpc_allowlist'::regclass)),
 'constraints',(SELECT jsonb_agg(to_jsonb(c) ORDER BY oid) FROM pg_catalog.pg_constraint c WHERE conrelid IN ('public.user_roles'::regclass,'privacy_retention.g014_public_rpc_allowlist'::regclass)),
 'functions',(SELECT jsonb_agg(to_jsonb(p) ORDER BY p.oid) FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','privacy_retention') AND NOT (n.nspname='public' AND p.proname='read_admin_user_ids_for_management')),
 'allowlist',(SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY source_signature,grantee),'[]'::jsonb) FROM privacy_retention.g014_public_rpc_allowlist a WHERE source_signature<>'public.read_admin_user_ids_for_management()'))$snapshot$;
  v_oid oid;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17
     OR current_user <> 'postgres' OR session_user <> 'postgres'
     OR pg_catalog.current_setting('transaction_read_only') <> 'off'
     OR v_owner IS NULL THEN
    RAISE EXCEPTION 'admin_ids_executor_denied';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('tzudong:admin-user-ids-catalog-slice:v1',0));
  PERFORM pg_catalog.set_config('lock_timeout','2s',true);
  LOCK TABLE public.user_roles IN SHARE MODE;
  LOCK TABLE privacy_retention.g014_public_rpc_allowlist IN SHARE ROW EXCLUSIVE MODE;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='read_admin_user_ids_for_management')
     OR EXISTS(SELECT 1 FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=v_signature OR (function_schema='public' AND function_name='read_admin_user_ids_for_management')) THEN
    RAISE EXCEPTION 'admin_ids_identity_conflict';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE oid=v_owner AND NOT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls AND NOT rolinherit)
     OR (SELECT count(*) FROM pg_catalog.pg_auth_members WHERE roleid=v_owner AND member=v_runner) <> 2
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid=v_owner AND member=v_runner AND admin_option AND NOT inherit_option AND NOT set_option AND grantor<>v_runner)
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members WHERE roleid=v_owner AND member=v_runner AND grantor=v_runner AND NOT admin_option AND inherit_option AND NOT set_option)
     OR pg_catalog.pg_has_role(v_runner,v_owner,'SET') THEN
    RAISE EXCEPTION 'admin_ids_membership_admission_denied';
  END IF;
  IF NOT pg_catalog.has_schema_privilege(v_owner,'public','USAGE')
     OR NOT pg_catalog.has_schema_privilege(v_owner,'public','CREATE')
     OR NOT pg_catalog.has_column_privilege(v_owner,'public.user_roles','user_id','SELECT')
     OR NOT pg_catalog.has_column_privilege(v_owner,'public.user_roles','role','SELECT')
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_class WHERE oid='public.user_roles'::regclass AND relkind='r' AND relrowsecurity AND NOT relforcerowsecurity AND relowner<>v_owner)
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.user_roles'::regclass AND attname='user_id' AND atttypid='uuid'::regtype AND attnotnull AND NOT attisdropped)
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_attribute WHERE attrelid='public.user_roles'::regclass AND attname='role' AND atttypid='public.app_role'::regtype AND attnotnull AND NOT attisdropped)
     OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_enum WHERE enumtypid='public.app_role'::regtype AND enumlabel='admin') THEN
    RAISE EXCEPTION 'admin_ids_dependency_denied';
  END IF;
  IF NOT EXISTS(
      SELECT 1 FROM pg_catalog.pg_policy p
      WHERE polrelid='public.user_roles'::regclass AND polcmd IN ('r','*') AND polpermissive
        AND pg_catalog.pg_get_expr(polqual,polrelid) IN ('true','(true)')
        AND EXISTS(SELECT 1 FROM pg_catalog.unnest(polroles) r WHERE r=0 OR pg_catalog.pg_has_role(v_owner,r,'USAGE')))
     OR EXISTS(
      SELECT 1 FROM pg_catalog.pg_policy p
      WHERE polrelid='public.user_roles'::regclass AND polcmd IN ('r','*') AND NOT polpermissive
        AND pg_catalog.pg_get_expr(polqual,polrelid) IS DISTINCT FROM 'true'
        AND pg_catalog.pg_get_expr(polqual,polrelid) IS DISTINCT FROM '(true)'
        AND EXISTS(SELECT 1 FROM pg_catalog.unnest(polroles) r WHERE r=0 OR pg_catalog.pg_has_role(v_owner,r,'USAGE'))) THEN
    RAISE EXCEPTION 'admin_ids_rls_visibility_denied';
  END IF;
  EXECUTE v_snapshot INTO v_before;

  -- Temporarily enable SET on the existing self-granted row only.
  -- Preserve its ADMIN=false/INHERIT=true and the foreign ADMIN=true/INHERIT=false row.
  GRANT privacy_workflow_owner TO postgres WITH SET TRUE GRANTED BY postgres;
  SET LOCAL ROLE privacy_workflow_owner;
  -- Transaction-local bridge runs assertions after SET is restored, preserving
  -- G041's membership invariant while checking the real G014 routines unchanged.
  CREATE FUNCTION pg_temp.admin_ids_g014_check() RETURNS void
  LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $bridge$
  BEGIN
    PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
    PERFORM privacy_retention.assert_g014_definer_contract();
    PERFORM privacy_retention.assert_g014_catalog_contract();
  END $bridge$;
  REVOKE ALL ON FUNCTION pg_temp.admin_ids_g014_check() FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION pg_temp.admin_ids_g014_check() TO postgres;
  RESET ROLE;
  GRANT privacy_workflow_owner TO postgres WITH SET FALSE GRANTED BY postgres;
  EXECUTE v_snapshot INTO v_after;
  IF v_after IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'admin_ids_bridge_restore_drift'; END IF;
  PERFORM pg_temp.admin_ids_g014_check();

  GRANT privacy_workflow_owner TO postgres WITH SET TRUE GRANTED BY postgres;
  SET LOCAL ROLE privacy_workflow_owner;
  EXECUTE $rpc$CREATE FUNCTION public.read_admin_user_ids_for_management()
RETURNS TABLE (user_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  admin_count integer;
BEGIN
  SELECT count(*) INTO admin_count
    FROM public.user_roles AS role_row
   WHERE role_row.role::text = 'admin';

  IF admin_count > 200 THEN
    RAISE EXCEPTION 'admin_user_id_count_exceeded'
      USING ERRCODE = '54000';
  END IF;

  RETURN QUERY
  SELECT role_row.user_id
    FROM public.user_roles AS role_row
   WHERE role_row.role::text = 'admin'
   ORDER BY role_row.user_id;
END
$$;$rpc$;
  REVOKE ALL ON FUNCTION public.read_admin_user_ids_for_management() FROM PUBLIC,anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION public.read_admin_user_ids_for_management() TO service_role;
  RESET ROLE;
  GRANT privacy_workflow_owner TO postgres WITH SET FALSE GRANTED BY postgres;

  v_oid := pg_catalog.to_regprocedure(v_signature);
  INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature)
  SELECT 'public',p.proname,p.proargtypes::text,'service_role',v_signature FROM pg_catalog.pg_proc p WHERE p.oid=v_oid;
  IF NOT FOUND THEN RAISE EXCEPTION 'admin_ids_allowlist_insert_failed'; END IF;

  IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_proc WHERE oid=v_oid AND proowner=v_owner AND prosecdef AND provolatile='s' AND prokind='f' AND proretset AND prorettype='uuid'::regtype AND pronargs=0 AND proconfig=ARRAY['search_path=""']::text[] AND pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex')='be57e320d7a79e6e7382bce9e942b3e684fc50246beb44deaa67c408cb553acd')
     OR (SELECT count(*) FROM privacy_retention.g014_public_rpc_allowlist WHERE source_signature=v_signature)<>1
     OR NOT pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE')
     OR pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE')
     OR EXISTS(SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid=v_oid AND (a.grantee NOT IN (v_owner,'service_role'::regrole) OR a.privilege_type<>'EXECUTE' OR a.is_grantable)) THEN
    RAISE EXCEPTION 'admin_ids_rpc_postcondition_failed';
  END IF;
  EXECUTE v_snapshot INTO v_after;
  IF v_after IS DISTINCT FROM v_before THEN RAISE EXCEPTION 'admin_ids_catalog_restore_drift'; END IF;
  PERFORM pg_temp.admin_ids_g014_check();
  DROP FUNCTION pg_temp.admin_ids_g014_check();
END
$admin_ids_slice$;
NOTIFY pgrst, 'reload schema';
