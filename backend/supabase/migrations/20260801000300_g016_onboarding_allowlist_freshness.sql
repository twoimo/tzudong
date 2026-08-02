
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
GRANT EXECUTE ON FUNCTION privacy_retention.assert_g014_catalog_contract()
  TO postgres;
SELECT privacy_retention.assert_g014_catalog_contract();
NOTIFY pgrst, 'reload schema';
