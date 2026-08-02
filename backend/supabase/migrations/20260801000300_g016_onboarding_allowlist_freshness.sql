
DELETE FROM privacy_retention.g014_public_rpc_allowlist
WHERE source_signature = 'public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid)'
  AND grantee = 'service_role'::name;

INSERT INTO privacy_retention.g014_public_rpc_allowlist (
  function_schema,
  function_name,
  identity_arguments,
  grantee,
  source_signature
)
SELECT namespace.nspname,
       procedure.proname,
       procedure.proargtypes::text,
       'service_role'::name,
       'public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text)'
FROM pg_catalog.pg_proc AS procedure
JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = procedure.pronamespace
WHERE procedure.oid = pg_catalog.to_regprocedure(
  'public.confirm_privacy_onboarding(uuid,text,uuid,text,uuid,text)'
)
ON CONFLICT (source_signature, grantee) DO UPDATE
SET function_schema = EXCLUDED.function_schema,
    function_name = EXCLUDED.function_name,
    identity_arguments = EXCLUDED.identity_arguments;

SELECT privacy_retention.assert_g014_public_rpc_allowlist();
-- pgvector can recreate its public extension helpers after the G014 baseline.
-- Keep them outside the application RPC surface before re-running the catalog
-- assertion, matching the original G014 hardening.
DO $extension_helpers$
DECLARE
  helper regprocedure;
BEGIN
  FOR helper IN
    SELECT procedure.oid::regprocedure
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'cosine_distance',
        'l1_distance',
        'vector_negative_inner_product'
      )
  LOOP
    EXECUTE format(
      'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      helper
    );
  END LOOP;
END
$extension_helpers$;
GRANT EXECUTE ON FUNCTION privacy_retention.assert_g014_catalog_contract()
  TO PUBLIC;
SELECT privacy_retention.assert_g014_catalog_contract();
REVOKE EXECUTE ON FUNCTION privacy_retention.assert_g014_catalog_contract()
  FROM PUBLIC;
NOTIFY pgrst, 'reload schema';
