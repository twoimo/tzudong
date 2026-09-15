-- Uninstalled publication API candidate. Requires the immutable edit core and
-- publish core, existing G014 catalog, and an authorized maintenance principal.
-- Deployment and operator release approval are separate from this source file.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TEMP TABLE catalog_publish_membership_snapshot ON COMMIT DROP AS
  SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]'::jsonb) state
  FROM pg_auth_members m;
DO $prerequisites$
BEGIN
  IF to_regprocedure('admin_catalog_publish.prepare(jsonb)') IS NULL
     OR to_regprocedure('admin_catalog_publish.apply(jsonb,text)') IS NULL
     OR to_regprocedure('admin_catalog_publish.readback(uuid,uuid)') IS NULL
     OR to_regprocedure('privacy_retention.assert_g014_catalog_contract()') IS NULL
     OR NOT has_table_privilege('privacy_workflow_owner','public.restaurants','SELECT') THEN
    RAISE EXCEPTION 'catalog_publish_prerequisite_missing';
  END IF;
END;
$prerequisites$;

CREATE FUNCTION public.prepare_restaurant_catalog_publish(p_envelope jsonb)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT admin_catalog_publish.prepare(p_envelope);
$$;
CREATE FUNCTION public.apply_restaurant_catalog_publish(p_envelope jsonb,p_preview_sha256 text)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT admin_catalog_publish.apply(p_envelope,p_preview_sha256);
$$;
CREATE FUNCTION public.readback_restaurant_catalog_publish(p_actor uuid,p_operation uuid)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  SELECT admin_catalog_publish.readback(p_actor,p_operation);
$$;
ALTER FUNCTION public.prepare_restaurant_catalog_publish(jsonb) OWNER TO privacy_workflow_owner;
ALTER FUNCTION public.apply_restaurant_catalog_publish(jsonb,text) OWNER TO privacy_workflow_owner;
ALTER FUNCTION public.readback_restaurant_catalog_publish(uuid,uuid) OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.prepare_restaurant_catalog_publish(jsonb),
  public.apply_restaurant_catalog_publish(jsonb,text),public.readback_restaurant_catalog_publish(uuid,uuid)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.prepare_restaurant_catalog_publish(jsonb),
  public.apply_restaurant_catalog_publish(jsonb,text),public.readback_restaurant_catalog_publish(uuid,uuid)
  TO service_role;

GRANT USAGE ON SCHEMA admin_catalog_edit TO privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION admin_catalog_edit.digest(jsonb),admin_catalog_edit.require_actor(uuid),
  admin_catalog_edit.validate_patch(jsonb),admin_catalog_edit.prepare(uuid,uuid,jsonb),
  admin_catalog_edit.apply(uuid,uuid,jsonb,text,uuid),admin_catalog_edit.readback(uuid,uuid)
  TO privacy_workflow_owner;
GRANT SELECT,INSERT ON admin_catalog_edit.audit_events TO privacy_workflow_owner;
CREATE POLICY owner_publish_edit_audit_read ON admin_catalog_edit.audit_events FOR SELECT TO privacy_workflow_owner
  USING (current_setting('role',true) = 'service_role');
CREATE POLICY owner_publish_edit_audit_insert ON admin_catalog_edit.audit_events FOR INSERT TO privacy_workflow_owner
  WITH CHECK (current_setting('role',true) = 'service_role');
GRANT UPDATE(approved_name,categories,lat,lng,road_address,jibun_address,english_address,
  youtube_link,tzuyang_review,geocoding_success,geocoding_false_stage,updated_by_admin_id,updated_at)
  ON public.restaurants TO privacy_workflow_owner;
CREATE POLICY g014_catalog_publish_update ON public.restaurants FOR UPDATE TO privacy_workflow_owner
  USING (current_setting('role',true) = 'service_role')
  WITH CHECK (current_setting('role',true) = 'service_role');

-- Do not grant role membership to make this step pass. An authorized maintenance
-- context must already be able to set the existing trusted owner role.
SET LOCAL ROLE privacy_workflow_owner;
WITH expected(signature) AS (VALUES
  ('public.prepare_restaurant_catalog_publish(jsonb)'),
  ('public.apply_restaurant_catalog_publish(jsonb,text)'),
  ('public.readback_restaurant_catalog_publish(uuid,uuid)'))
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
DO $membership$
BEGIN
  IF (SELECT state FROM pg_temp.catalog_publish_membership_snapshot) IS DISTINCT FROM
     (SELECT COALESCE(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]'::jsonb) FROM pg_auth_members m) THEN
    RAISE EXCEPTION 'catalog_publish_owner_membership_drift';
  END IF;
END;
$membership$;
COMMIT;
