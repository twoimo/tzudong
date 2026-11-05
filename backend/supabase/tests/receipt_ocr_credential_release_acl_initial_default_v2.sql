-- Disposable PG17 fixture. Run before frozen 106 object creation, then destroy the target.
-- It deliberately persists creator defaults in that disposable target; never run on hosted state.
DO $admission$
BEGIN
  IF current_user <> 'postgres'
    OR session_user <> 'postgres'
    OR pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17
    OR pg_catalog.to_regrole('privacy_workflow_owner') IS NULL
    OR pg_catalog.to_regrole('supabase_admin') IS NULL
    OR pg_catalog.to_regnamespace('ocr_private') IS NULL
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_DEFAULT_FIXTURE_DENIED';
  END IF;
END;
$admission$;

ALTER DEFAULT PRIVILEGES FOR ROLE privacy_workflow_owner
  GRANT EXECUTE ON FUNCTIONS TO supabase_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres
  GRANT EXECUTE ON FUNCTIONS TO supabase_admin;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA ocr_private
  GRANT SELECT ON TABLES TO supabase_admin;

DO $default_acl_readback$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM pg_catalog.pg_default_acl AS default_acl
    CROSS JOIN LATERAL pg_catalog.aclexplode(default_acl.defaclacl) AS acl
    WHERE default_acl.defaclrole = 'privacy_workflow_owner'::pg_catalog.regrole
      AND default_acl.defaclobjtype = 'f'
      AND acl.grantor = 'privacy_workflow_owner'::pg_catalog.regrole
      AND acl.grantee = 'supabase_admin'::pg_catalog.regrole
      AND acl.privilege_type = 'EXECUTE'
      AND NOT acl.is_grantable
  ) <> 1
    OR (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_default_acl AS default_acl
      CROSS JOIN LATERAL pg_catalog.aclexplode(default_acl.defaclacl) AS acl
      WHERE default_acl.defaclrole = 'postgres'::pg_catalog.regrole
        AND default_acl.defaclobjtype = 'f'
        AND acl.grantor = 'postgres'::pg_catalog.regrole
        AND acl.grantee = 'supabase_admin'::pg_catalog.regrole
        AND acl.privilege_type = 'EXECUTE'
        AND NOT acl.is_grantable
    ) <> 1
    OR (
      SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_default_acl AS default_acl
      CROSS JOIN LATERAL pg_catalog.aclexplode(default_acl.defaclacl) AS acl
      WHERE default_acl.defaclrole = 'postgres'::pg_catalog.regrole
        AND default_acl.defaclnamespace = 'ocr_private'::pg_catalog.regnamespace
        AND default_acl.defaclobjtype = 'r'
        AND acl.grantor = 'postgres'::pg_catalog.regrole
        AND acl.grantee = 'supabase_admin'::pg_catalog.regrole
        AND acl.privilege_type = 'SELECT'
        AND NOT acl.is_grantable
    ) <> 1
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_DEFAULT_FIXTURE_READBACK_FAILED';
  END IF;
END;
$default_acl_readback$;
