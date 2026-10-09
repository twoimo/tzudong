-- The 20260820 writer migration revoked the service helper grants that were
-- established on 20260817. Current service-invoker admin reads/review require
-- these pure identity helpers. Hosted already has the same grants; fresh
-- source replay must reconstruct them explicitly before registry verification.
BEGIN;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM (VALUES ('public.extract_youtube_video_id(text)'),
      ('public.normalize_restaurant_identity_name(text)'),
      ('public.resolve_restaurant_identity_name(text,text,text,text)')) required(signature)
    LEFT JOIN pg_catalog.pg_proc procedure ON procedure.oid=pg_catalog.to_regprocedure(required.signature)
    WHERE procedure.oid IS NULL OR pg_catalog.pg_get_userbyid(procedure.proowner)<>'postgres'
  ) THEN RAISE EXCEPTION 'SERVICE_IDENTITY_HELPERS_PREREQUISITE_UNAVAILABLE'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.extract_youtube_video_id(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.normalize_restaurant_identity_name(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_restaurant_identity_name(text,text,text,text) TO service_role;
WITH required(signature) AS (VALUES ('public.extract_youtube_video_id(text)'),
  ('public.normalize_restaurant_identity_name(text)'),
  ('public.resolve_restaurant_identity_name(text,text,text,text)'))
INSERT INTO privacy_retention.g014_public_rpc_allowlist(function_schema,function_name,identity_arguments,grantee,source_signature)
SELECT namespace.nspname,procedure.proname,procedure.proargtypes::text,'service_role'::name,required.signature
FROM required JOIN pg_catalog.pg_proc procedure ON procedure.oid=pg_catalog.to_regprocedure(required.signature)
JOIN pg_catalog.pg_namespace namespace ON namespace.oid=procedure.pronamespace
ON CONFLICT(source_signature,grantee) DO UPDATE SET function_schema=EXCLUDED.function_schema,
  function_name=EXCLUDED.function_name,identity_arguments=EXCLUDED.identity_arguments;
COMMIT;
