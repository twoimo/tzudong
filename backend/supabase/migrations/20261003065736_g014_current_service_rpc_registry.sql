-- Register existing service-role EXECUTE rights; this grants no new access.
-- Applied predecessors and extension-owned functions are left unchanged.
BEGIN;
CREATE TEMP TABLE current_service_rpc_registry (signature text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO current_service_rpc_registry VALUES
  ('public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text)'),
  ('public.extract_youtube_video_id(text)'),
  ('public.normalize_restaurant_identity_name(text)'),
  ('public.record_app_web_vitals(text,text,text,text,smallint)'),
  ('public.record_app_web_vitals_bounded(text,text,text,text,smallint)'),
  ('public.resolve_restaurant_identity_name(text,text,text,text)');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM current_service_rpc_registry required
    LEFT JOIN pg_catalog.pg_proc procedure ON procedure.oid=pg_catalog.to_regprocedure(required.signature)
    WHERE procedure.oid IS NULL
      OR pg_catalog.pg_get_userbyid(procedure.proowner) NOT IN ('postgres','privacy_workflow_owner')
      OR NOT pg_catalog.has_function_privilege('service_role',procedure.oid,'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'G014_SERVICE_REGISTRY_PREREQUISITE_UNAVAILABLE';
  END IF;
END;
$$;

INSERT INTO privacy_retention.g014_public_rpc_allowlist
  (function_schema,function_name,identity_arguments,grantee,source_signature)
SELECT namespace.nspname,procedure.proname,procedure.proargtypes::text,'service_role'::name,required.signature
FROM current_service_rpc_registry required
JOIN pg_catalog.pg_proc procedure ON procedure.oid=pg_catalog.to_regprocedure(required.signature)
JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
ON CONFLICT (source_signature,grantee) DO UPDATE SET
  function_schema=EXCLUDED.function_schema,
  function_name=EXCLUDED.function_name,
  identity_arguments=EXCLUDED.identity_arguments;
COMMIT;
