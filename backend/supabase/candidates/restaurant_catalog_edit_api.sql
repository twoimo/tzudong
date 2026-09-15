-- Local-workspace API exposure. Install only through the checkout-bound installer.
-- This is not part of the hosted migration stream.
BEGIN;
DO $guard$
BEGIN
  IF current_user <> 'supabase_admin'
     OR NOT (SELECT rolsuper FROM pg_roles WHERE rolname = current_user)
     OR to_regclass('_tzudong_local.migration_ledger') IS NULL THEN
    RAISE EXCEPTION 'catalog_edit_local_install_required';
  END IF;
END;
$guard$;
CREATE TEMP TABLE catalog_edit_membership_snapshot ON COMMIT DROP AS
  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]'::jsonb) state
  FROM pg_auth_members m;

CREATE FUNCTION public.prepare_local_restaurant_catalog_edit(p_actor uuid,p_restaurant uuid,p_patch jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT admin_catalog_edit.prepare(p_actor,p_restaurant,p_patch);
$$;
CREATE FUNCTION public.apply_local_restaurant_catalog_edit(p_actor uuid,p_restaurant uuid,p_patch jsonb,
  p_preview_sha256 text,p_operation uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT admin_catalog_edit.apply(p_actor,p_restaurant,p_patch,p_preview_sha256,p_operation);
$$;
CREATE FUNCTION public.readback_local_restaurant_catalog_edit(p_actor uuid,p_operation uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT admin_catalog_edit.readback(p_actor,p_operation);
$$;
ALTER FUNCTION public.prepare_local_restaurant_catalog_edit(uuid,uuid,jsonb) OWNER TO privacy_workflow_owner;
ALTER FUNCTION public.apply_local_restaurant_catalog_edit(uuid,uuid,jsonb,text,uuid) OWNER TO privacy_workflow_owner;
ALTER FUNCTION public.readback_local_restaurant_catalog_edit(uuid,uuid) OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.prepare_local_restaurant_catalog_edit(uuid,uuid,jsonb),
  public.apply_local_restaurant_catalog_edit(uuid,uuid,jsonb,text,uuid),
  public.readback_local_restaurant_catalog_edit(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_local_restaurant_catalog_edit(uuid,uuid,jsonb),
  public.apply_local_restaurant_catalog_edit(uuid,uuid,jsonb,text,uuid),
  public.readback_local_restaurant_catalog_edit(uuid,uuid) TO service_role;

GRANT USAGE ON SCHEMA admin_catalog_edit TO privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION admin_catalog_edit.digest(jsonb), admin_catalog_edit.require_actor(uuid),
  admin_catalog_edit.validate_patch(jsonb), admin_catalog_edit.prepare(uuid,uuid,jsonb),
  admin_catalog_edit.apply(uuid,uuid,jsonb,text,uuid), admin_catalog_edit.readback(uuid,uuid)
  TO privacy_workflow_owner;
GRANT SELECT,INSERT ON admin_catalog_edit.audit_events TO privacy_workflow_owner;
CREATE POLICY owner_edit_audit_read ON admin_catalog_edit.audit_events FOR SELECT TO privacy_workflow_owner
  USING (current_setting('role',true) = 'service_role');
CREATE POLICY owner_edit_audit_insert ON admin_catalog_edit.audit_events FOR INSERT TO privacy_workflow_owner
  WITH CHECK (current_setting('role',true) = 'service_role');
-- Existing G014 SELECT permission/policy remains unchanged. Only the edited
-- columns and this service-session update policy are added to its trusted owner.
GRANT UPDATE(approved_name,categories,lat,lng,road_address,jibun_address,english_address,
  youtube_link,tzuyang_review,geocoding_success,geocoding_false_stage,updated_by_admin_id,updated_at)
  ON public.restaurants TO privacy_workflow_owner;
CREATE POLICY g014_local_catalog_edit_update ON public.restaurants FOR UPDATE TO privacy_workflow_owner
  USING (current_setting('role',true) = 'service_role')
  WITH CHECK (current_setting('role',true) = 'service_role');

-- The generated local Supabase bootstrap actor can SET ROLE without granting
-- membership. This also works with the canonical local PG15 catalog.
SET LOCAL ROLE privacy_workflow_owner;
WITH expected(signature) AS (VALUES
  ('public.prepare_local_restaurant_catalog_edit(uuid,uuid,jsonb)'),
  ('public.apply_local_restaurant_catalog_edit(uuid,uuid,jsonb,text,uuid)'),
  ('public.readback_local_restaurant_catalog_edit(uuid,uuid)'))
INSERT INTO privacy_retention.g014_public_rpc_allowlist
  (function_schema,function_name,identity_arguments,grantee,source_signature)
SELECT 'public',p.proname,p.proargtypes::text,'service_role',expected.signature
FROM expected JOIN pg_proc p ON p.oid = to_regprocedure(expected.signature);
DO $assert$
BEGIN
  PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
  PERFORM privacy_retention.assert_g014_definer_contract();
  PERFORM privacy_retention.assert_g014_catalog_contract();
END;
$assert$;
RESET ROLE;
DO $restore$
BEGIN
  IF (SELECT state FROM pg_temp.catalog_edit_membership_snapshot) IS DISTINCT FROM
     (SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]'::jsonb) FROM pg_auth_members m) THEN
    RAISE EXCEPTION 'catalog_edit_owner_membership_drift';
  END IF;
END;
$restore$;
COMMIT;
