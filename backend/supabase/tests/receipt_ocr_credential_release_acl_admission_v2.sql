-- Execute only after a compiled 105 -> 106 -> 107 target reports v2 ready.
-- Every mutation is transaction-local and rolled back.
BEGIN;

DO $ready_precondition$
BEGIN
  IF public.get_receipt_ocr_credential_release_capability() IS DISTINCT FROM
    '{"schema_version":1,"status":"ready","capability_version":"receipt-ocr-definitive-credential-release-v2"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_READY_PRECONDITION_FAILED';
  END IF;
END;
$ready_precondition$;

CREATE FUNCTION pg_temp.refresh_receipt_ocr_acl_v2_seal()
RETURNS void
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fixture$
  UPDATE ocr_private.receipt_credential_release_catalog_contract AS contract_row
  SET function_contract = (
        SELECT pg_catalog.jsonb_object_agg(
                 required.signature,
                 pg_catalog.jsonb_build_object(
                   'definition_sha256', pg_catalog.encode(
                     extensions.digest(
                       pg_catalog.convert_to(pg_catalog.pg_get_functiondef(procedure.oid), 'UTF8'),
                       'sha256'
                     ),
                     'hex'
                   ),
                   'language', language.lanname,
                   'volatility', procedure.provolatile::text,
                   'owner', pg_catalog.pg_get_userbyid(procedure.proowner),
                   'acl', (
                     SELECT coalesce(
                              pg_catalog.jsonb_agg(
                                pg_catalog.jsonb_build_object(
                                  'grantor', pg_catalog.pg_get_userbyid(acl.grantor),
                                  'grantee', CASE
                                    WHEN acl.grantee = 0 THEN 'PUBLIC'
                                    ELSE pg_catalog.pg_get_userbyid(acl.grantee)::text
                                  END,
                                  'privilege', acl.privilege_type,
                                  'grantable', acl.is_grantable
                                )
                                ORDER BY acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
                              ),
                              '[]'::jsonb
                            )
                     FROM pg_catalog.aclexplode(
                       coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
                     ) AS acl
                   )
                 )
                 ORDER BY required.signature
               )
        FROM (VALUES
          ('public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'::text),
          ('ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'::text),
          ('public.get_receipt_ocr_credential_release_capability()'::text),
          ('ocr_private.get_receipt_ocr_credential_release_capability()'::text),
          ('ocr_private.receipt_credential_release_acl_admitted_v2()'::text)
        ) AS required(signature)
        JOIN pg_catalog.pg_proc AS procedure
          ON procedure.oid = pg_catalog.to_regprocedure(required.signature)
        JOIN pg_catalog.pg_language AS language
          ON language.oid = procedure.prolang
      ),
      table_contract = (
        SELECT pg_catalog.jsonb_object_agg(
                 required.relation_name,
                 pg_catalog.jsonb_build_object(
                   'owner', pg_catalog.pg_get_userbyid(relation.relowner),
                   'acl', (
                     SELECT coalesce(
                              pg_catalog.jsonb_agg(
                                pg_catalog.jsonb_build_object(
                                  'grantor', pg_catalog.pg_get_userbyid(acl.grantor),
                                  'grantee', CASE
                                    WHEN acl.grantee = 0 THEN 'PUBLIC'
                                    ELSE pg_catalog.pg_get_userbyid(acl.grantee)::text
                                  END,
                                  'privilege', acl.privilege_type,
                                  'grantable', acl.is_grantable
                                )
                                ORDER BY acl.grantor, acl.grantee, acl.privilege_type, acl.is_grantable
                              ),
                              '[]'::jsonb
                            )
                     FROM pg_catalog.aclexplode(
                       coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
                     ) AS acl
                   )
                 )
                 ORDER BY required.relation_name
               )
        FROM (VALUES
          ('ocr_private.receipt_credential_rejection_releases'::text),
          ('ocr_private.receipt_credential_release_catalog_contract'::text)
        ) AS required(relation_name)
        JOIN pg_catalog.pg_class AS relation
          ON relation.oid = pg_catalog.to_regclass(required.relation_name)
      )
  WHERE contract_row.capability_version = 'receipt-ocr-definitive-credential-release-v2';
$fixture$;

SAVEPOINT forbidden_acl_matches_seal;
GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
SET LOCAL ROLE privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION public.release_receipt_ocr_definitive_credential_rejection(uuid, uuid)
  TO supabase_admin;
GRANT EXECUTE ON FUNCTION public.get_receipt_ocr_credential_release_capability()
  TO supabase_admin;
RESET ROLE;
REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
GRANT EXECUTE ON FUNCTION ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid, uuid)
  TO supabase_admin;
GRANT EXECUTE ON FUNCTION ocr_private.get_receipt_ocr_credential_release_capability()
  TO supabase_admin;
GRANT SELECT ON TABLE ocr_private.receipt_credential_rejection_releases
  TO supabase_admin;
GRANT SELECT ON TABLE ocr_private.receipt_credential_release_catalog_contract
  TO supabase_admin;

DO $forbidden_acl_readback$
BEGIN
  IF (
    SELECT pg_catalog.count(*)
    FROM (VALUES
      ('public.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'::text),
      ('public.get_receipt_ocr_credential_release_capability()'::text),
      ('ocr_private.release_receipt_ocr_definitive_credential_rejection(uuid,uuid)'::text),
      ('ocr_private.get_receipt_ocr_credential_release_capability()'::text)
    ) AS required(signature)
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(required.signature)
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
    ) AS acl
    WHERE acl.grantee = 'supabase_admin'::pg_catalog.regrole
      AND acl.privilege_type = 'EXECUTE'
  ) <> 4
    OR (
      SELECT pg_catalog.count(*)
      FROM (VALUES
        ('ocr_private.receipt_credential_rejection_releases'::text),
        ('ocr_private.receipt_credential_release_catalog_contract'::text)
      ) AS required(relation_name)
      JOIN pg_catalog.pg_class AS relation
        ON relation.oid = pg_catalog.to_regclass(required.relation_name)
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
      ) AS acl
      WHERE acl.grantee = 'supabase_admin'::pg_catalog.regrole
        AND acl.privilege_type = 'SELECT'
    ) <> 2
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_FORBIDDEN_ACL_NOT_INSTALLED';
  END IF;
END;
$forbidden_acl_readback$;

SELECT pg_temp.refresh_receipt_ocr_acl_v2_seal();
DO $forbidden_acl_matches_seal_readback$
BEGIN
  IF ocr_private.receipt_credential_release_acl_admitted_v2() IS DISTINCT FROM false
    OR public.get_receipt_ocr_credential_release_capability() IS DISTINCT FROM
      '{"schema_version":1,"status":"held","capability_version":"receipt-ocr-definitive-credential-release-v2"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_FORBIDDEN_SEALED_ACL_READY';
  END IF;
END;
$forbidden_acl_matches_seal_readback$;
ROLLBACK TO SAVEPOINT forbidden_acl_matches_seal;

SAVEPOINT grant_option_drift;
GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres;
SET LOCAL ROLE privacy_workflow_owner;
GRANT EXECUTE ON FUNCTION public.get_receipt_ocr_credential_release_capability()
  TO service_role WITH GRANT OPTION;
RESET ROLE;
REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
SELECT pg_temp.refresh_receipt_ocr_acl_v2_seal();
DO $grant_option_readback$
BEGIN
  IF ocr_private.receipt_credential_release_acl_admitted_v2() IS DISTINCT FROM false
    OR public.get_receipt_ocr_credential_release_capability() IS DISTINCT FROM
      '{"schema_version":1,"status":"held","capability_version":"receipt-ocr-definitive-credential-release-v2"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_GRANT_OPTION_DRIFT_READY';
  END IF;
END;
$grant_option_readback$;
ROLLBACK TO SAVEPOINT grant_option_drift;

SAVEPOINT owner_drift_matches_seal;
ALTER TABLE ocr_private.receipt_credential_rejection_releases OWNER TO supabase_admin;
SELECT pg_temp.refresh_receipt_ocr_acl_v2_seal();
DO $owner_readback$
BEGIN
  IF ocr_private.receipt_credential_release_acl_admitted_v2() IS DISTINCT FROM false
    OR public.get_receipt_ocr_credential_release_capability() IS DISTINCT FROM
      '{"schema_version":1,"status":"held","capability_version":"receipt-ocr-definitive-credential-release-v2"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_OWNER_DRIFT_READY';
  END IF;
END;
$owner_readback$;
ROLLBACK TO SAVEPOINT owner_drift_matches_seal;

DO $ready_restored$
BEGIN
  IF public.get_receipt_ocr_credential_release_capability() IS DISTINCT FROM
    '{"schema_version":1,"status":"ready","capability_version":"receipt-ocr-definitive-credential-release-v2"}'::jsonb
  THEN
    RAISE EXCEPTION 'RECEIPT_OCR_ACL_V2_READY_NOT_RESTORED';
  END IF;
END;
$ready_restored$;

ROLLBACK;
