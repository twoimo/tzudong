-- Forward-only registration for the durable OCR service RPCs plus retirement of
-- direct Data API execution on the storyboard archive trigger helper.
--
-- The file was created by Supabase CLI as
-- 20261013113313_g014_feature_rpc_catalog_contract.sql, then renamed before any
-- application so it sorts after the frozen 20261013190000 OCR dependency.
BEGIN;

SET LOCAL lock_timeout = '2s';
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('tzudong:g014-feature-rpc-catalog:v1', 0)
);

CREATE TEMPORARY TABLE pg_temp.g014_feature_rpc_registry (
  source_signature text PRIMARY KEY,
  expected_return_type regtype NOT NULL,
  expected_set boolean NOT NULL,
  expected_volatility "char" NOT NULL
) ON COMMIT DROP;

INSERT INTO pg_temp.g014_feature_rpc_registry (
  source_signature,
  expected_return_type,
  expected_set,
  expected_volatility
)
VALUES
  ('public.claim_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text,uuid,boolean)', 'jsonb'::regtype, false, 'v'),
  ('public.mark_receipt_ocr_dispatched(uuid,uuid)', 'jsonb'::regtype, false, 'v'),
  ('public.complete_receipt_ocr_result(uuid,uuid,jsonb)', 'jsonb'::regtype, false, 'v'),
  ('public.mark_receipt_ocr_result_indeterminate(uuid,uuid)', 'jsonb'::regtype, false, 'v'),
  ('public.release_receipt_ocr_claim(uuid,uuid)', 'jsonb'::regtype, false, 'v'),
  ('public.read_receipt_ocr_result(uuid,text,text,text,jsonb,uuid,text,text,text)', 'jsonb'::regtype, false, 's'),
  ('public.get_review_receipt_ocr_generation(uuid,uuid)', 'jsonb'::regtype, false, 's'),
  ('public.publish_review_receipt_ocr_result(uuid,uuid,uuid,uuid,uuid,text,jsonb,boolean)', 'jsonb'::regtype, false, 'v'),
  ('public.get_feature_runtime_capability(uuid)', 'jsonb'::regtype, false, 's'),
  ('public.get_owned_review_storage_objects(uuid,uuid,text,text[])', 'record'::regtype, true, 'v'),
  ('public.create_review_with_receipt_ocr(uuid,uuid,uuid,text,text,timestamptz,text,text[],text[],uuid,uuid,uuid,text,timestamptz,text,jsonb)', 'uuid'::regtype, false, 'v');

GRANT SELECT ON TABLE pg_temp.g014_feature_rpc_registry
  TO privacy_workflow_owner;

CREATE TEMPORARY TABLE pg_temp.g014_feature_membership_before ON COMMIT DROP AS
SELECT pg_catalog.to_jsonb(membership) AS row_value
FROM pg_catalog.pg_auth_members AS membership;

DO $prerequisites$
DECLARE
  required record;
  procedure_oid oid;
  procedure_row pg_catalog.pg_proc%ROWTYPE;
  archive_guard_oid oid;
  generation_trigger_oid oid;
BEGIN
  IF pg_catalog.current_setting('server_version_num')::integer / 10000 <> 17
     OR current_user <> 'postgres'
     OR session_user <> 'postgres'
     OR pg_catalog.current_setting('transaction_read_only') <> 'off' THEN
    RAISE EXCEPTION 'G014_FEATURE_RPC_EXECUTOR_DENIED';
  END IF;

  IF pg_catalog.to_regclass('privacy_retention.g014_public_rpc_allowlist') IS NULL
     OR pg_catalog.to_regclass('privacy_retention.g014_nested_helper_allowlist') IS NULL
     OR pg_catalog.to_regprocedure('privacy_retention.assert_g014_public_rpc_allowlist()') IS NULL
     OR pg_catalog.to_regprocedure('privacy_retention.assert_g014_definer_contract()') IS NULL THEN
    RAISE EXCEPTION 'G014_FEATURE_RPC_CATALOG_PREREQUISITE_MISSING';
  END IF;

  FOR required IN
    SELECT * FROM pg_temp.g014_feature_rpc_registry ORDER BY source_signature
  LOOP
    procedure_oid := pg_catalog.to_regprocedure(required.source_signature);
    SELECT procedure.* INTO procedure_row
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid = procedure_oid;

    IF procedure_oid IS NULL
       OR procedure_row.proowner <> 'postgres'::regrole
       OR NOT procedure_row.prosecdef
       OR procedure_row.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
       OR procedure_row.prokind <> 'f'
       OR procedure_row.provolatile <> required.expected_volatility
       OR procedure_row.prolang <> (
         SELECT language.oid FROM pg_catalog.pg_language AS language
         WHERE language.lanname = 'plpgsql'
       )
       OR procedure_row.prorettype <> required.expected_return_type
       OR procedure_row.proretset IS DISTINCT FROM required.expected_set
       OR NOT pg_catalog.has_function_privilege('service_role', procedure_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', procedure_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', procedure_oid, 'EXECUTE')
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(
           coalesce(
             procedure_row.proacl,
             pg_catalog.acldefault('f', procedure_row.proowner)
           )
         ) AS acl
         WHERE acl.privilege_type = 'EXECUTE'
           AND (
             acl.grantee = 0
             OR pg_catalog.pg_get_userbyid(acl.grantee) NOT IN ('postgres', 'service_role')
             OR (pg_catalog.pg_get_userbyid(acl.grantee) = 'service_role' AND acl.is_grantable)
           )
       ) THEN
      RAISE EXCEPTION 'G014_FEATURE_RPC_PREREQUISITE_DRIFT: %', required.source_signature;
    END IF;
  END LOOP;

  generation_trigger_oid := pg_catalog.to_regprocedure(
    'ocr_private.register_review_ocr_generation()'
  );
  SELECT procedure.* INTO procedure_row
  FROM pg_catalog.pg_proc AS procedure
  WHERE procedure.oid = generation_trigger_oid;

  IF generation_trigger_oid IS NULL
     OR procedure_row.proowner <> 'postgres'::regrole
     OR NOT procedure_row.prosecdef
     OR procedure_row.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR procedure_row.prokind <> 'f'
     OR procedure_row.prorettype <> 'trigger'::regtype
     OR procedure_row.proretset
     OR procedure_row.prolang <> (
       SELECT language.oid FROM pg_catalog.pg_language AS language
       WHERE language.lanname = 'plpgsql'
     )
     OR pg_catalog.has_function_privilege('anon', generation_trigger_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', generation_trigger_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', generation_trigger_oid, 'EXECUTE')
     OR (
       SELECT pg_catalog.count(*)
       FROM pg_catalog.pg_trigger AS trigger_row
       WHERE trigger_row.tgfoid = generation_trigger_oid
         AND trigger_row.tgrelid = 'public.reviews'::regclass
         AND trigger_row.tgname IN (
           'review_ocr_generation_on_insert',
           'review_ocr_generation_on_reset'
         )
         AND trigger_row.tgenabled = 'O'
         AND NOT trigger_row.tgisinternal
     ) <> 2 THEN
    RAISE EXCEPTION 'G014_FEATURE_GENERATION_TRIGGER_PREREQUISITE_DRIFT';
  END IF;

  archive_guard_oid := pg_catalog.to_regprocedure(
    'public.storyboard_production_reject_archived_write()'
  );
  SELECT procedure.* INTO procedure_row
  FROM pg_catalog.pg_proc AS procedure
  WHERE procedure.oid = archive_guard_oid;

  IF archive_guard_oid IS NULL
     OR procedure_row.proowner <> 'postgres'::regrole
     OR procedure_row.prosecdef
     OR procedure_row.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR procedure_row.prokind <> 'f'
     OR procedure_row.prorettype <> 'trigger'::regtype
     OR procedure_row.proretset
     OR procedure_row.prolang <> (
       SELECT language.oid FROM pg_catalog.pg_language AS language
       WHERE language.lanname = 'plpgsql'
     )
     OR (
       SELECT pg_catalog.count(*)
       FROM pg_catalog.pg_trigger AS trigger_row
       WHERE trigger_row.tgfoid = archive_guard_oid
         AND NOT trigger_row.tgisinternal
     ) <> 6 THEN
    RAISE EXCEPTION 'G014_FEATURE_TRIGGER_PREREQUISITE_DRIFT';
  END IF;
END;
$prerequisites$;

-- Trigger creation already succeeded in the predecessor transaction. PostgreSQL
-- checks EXECUTE when CREATE TRIGGER runs; firing an installed trigger does not
-- require exposing its implementation as a PostgREST RPC. The PG17.6 rehearsal
-- exercises the trigger after this revoke.
REVOKE ALL ON FUNCTION public.storyboard_production_reject_archived_write()
  FROM PUBLIC, anon, authenticated, service_role, privacy_workflow_owner;

-- Keep the pre-existing privileged implementations private. The public API is
-- recreated below as workflow-owner wrappers, so the Data API never receives
-- EXECUTE on a postgres-owned implementation.
DO $move_helpers$
DECLARE
  required record;
  procedure_oid oid;
BEGIN
  FOR required IN
    SELECT * FROM pg_temp.g014_feature_rpc_registry ORDER BY source_signature
  LOOP
    procedure_oid := pg_catalog.to_regprocedure(required.source_signature);
    EXECUTE pg_catalog.format(
      'ALTER FUNCTION %s SET SCHEMA ocr_private',
      procedure_oid::regprocedure
    );
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role, privacy_workflow_owner',
      procedure_oid::regprocedure
    );
    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION %s TO privacy_workflow_owner',
      procedure_oid::regprocedure
    );
  END LOOP;
END;
$move_helpers$;

GRANT USAGE ON SCHEMA ocr_private TO privacy_workflow_owner;

CREATE TEMPORARY TABLE pg_temp.g014_feature_self_membership_before (
  inherit_option boolean NOT NULL,
  set_option boolean NOT NULL
) ON COMMIT DROP;

INSERT INTO pg_temp.g014_feature_self_membership_before (
  inherit_option,
  set_option
)
SELECT membership.inherit_option, membership.set_option
FROM pg_catalog.pg_auth_members AS membership
WHERE membership.roleid = 'privacy_workflow_owner'::regrole
  AND membership.member = 'postgres'::regrole
  AND membership.grantor = 'postgres'::regrole;

DO $lease_workflow_owner$
DECLARE
  workflow_owner oid := 'privacy_workflow_owner'::regrole;
  runner oid := 'postgres'::regrole;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    WHERE membership.roleid = workflow_owner
      AND membership.member = runner
      AND membership.grantor = runner
      AND membership.admin_option
  ) THEN
    RAISE EXCEPTION 'G014_FEATURE_RPC_SELF_MEMBERSHIP_DENIED';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_auth_members AS membership
    WHERE membership.roleid = workflow_owner
      AND membership.member = runner
      AND membership.admin_option
      AND membership.grantor <> runner
  ) THEN
    RAISE EXCEPTION 'G014_FEATURE_RPC_OWNER_AUTHORITY_MISSING';
  END IF;

  GRANT privacy_workflow_owner TO postgres
    WITH ADMIN FALSE, INHERIT FALSE, SET TRUE
    GRANTED BY postgres;
END;
$lease_workflow_owner$;

SET LOCAL ROLE privacy_workflow_owner;

CREATE TEMPORARY TABLE pg_temp.g014_feature_manifest_before ON COMMIT DROP AS
SELECT coalesce(
         pg_catalog.jsonb_agg(
           pg_catalog.to_jsonb(manifest)
           ORDER BY manifest.manifest_kind, manifest.manifest_key
         ),
         '[]'::jsonb
       ) AS row_value
FROM privacy_retention.g014_catalog_contract_manifest AS manifest;

CREATE FUNCTION public.claim_receipt_ocr_result(
  p_user_id uuid,
  p_image_hash text,
  p_input_context_hash text,
  p_provider text,
  p_model_policy jsonb,
  p_generation uuid,
  p_prompt_version text,
  p_preprocess_version text,
  p_normalization_version text,
  p_operation_id uuid,
  p_force_refresh boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $wrapper$
  SELECT ocr_private.claim_receipt_ocr_result(
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11
  );
$wrapper$;

CREATE FUNCTION public.mark_receipt_ocr_dispatched(
  p_result_id uuid,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $wrapper$
  SELECT ocr_private.mark_receipt_ocr_dispatched($1, $2);
$wrapper$;

CREATE FUNCTION public.complete_receipt_ocr_result(
  p_result_id uuid,
  p_claim_token uuid,
  p_result_payload jsonb
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $wrapper$
  SELECT ocr_private.complete_receipt_ocr_result($1, $2, $3);
$wrapper$;

CREATE FUNCTION public.mark_receipt_ocr_result_indeterminate(
  p_result_id uuid,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $wrapper$
  SELECT ocr_private.mark_receipt_ocr_result_indeterminate($1, $2);
$wrapper$;

CREATE FUNCTION public.release_receipt_ocr_claim(
  p_result_id uuid,
  p_claim_token uuid
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $wrapper$
  SELECT ocr_private.release_receipt_ocr_claim($1, $2);
$wrapper$;

CREATE FUNCTION public.read_receipt_ocr_result(
  p_user_id uuid,
  p_image_hash text,
  p_input_context_hash text,
  p_provider text,
  p_model_policy jsonb,
  p_generation uuid,
  p_prompt_version text,
  p_preprocess_version text,
  p_normalization_version text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $wrapper$
  SELECT ocr_private.read_receipt_ocr_result($1, $2, $3, $4, $5, $6, $7, $8, $9);
$wrapper$;

CREATE FUNCTION public.get_review_receipt_ocr_generation(
  p_user_id uuid,
  p_review_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $wrapper$
  SELECT ocr_private.get_review_receipt_ocr_generation($1, $2);
$wrapper$;

CREATE FUNCTION public.publish_review_receipt_ocr_result(
  p_user_id uuid,
  p_review_id uuid,
  p_generation uuid,
  p_result_id uuid,
  p_result_revision uuid,
  p_receipt_hash text,
  p_receipt_data jsonb,
  p_is_duplicate boolean
)
RETURNS jsonb
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $wrapper$
  SELECT ocr_private.publish_review_receipt_ocr_result($1, $2, $3, $4, $5, $6, $7, $8);
$wrapper$;

CREATE FUNCTION public.get_feature_runtime_capability(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $wrapper$
  SELECT ocr_private.get_feature_runtime_capability($1);
$wrapper$;

CREATE FUNCTION public.get_owned_review_storage_objects(
  p_user_id uuid,
  p_review_id uuid,
  p_purpose text,
  p_names text[]
)
RETURNS TABLE (
  id uuid,
  bucket_id text,
  name text,
  owner_id text,
  version text,
  updated_at timestamptz,
  metadata jsonb,
  archived_at timestamptz,
  is_delete_marker boolean
)
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $wrapper$
  SELECT *
  FROM ocr_private.get_owned_review_storage_objects($1, $2, $3, $4);
$wrapper$;

CREATE FUNCTION public.create_review_with_receipt_ocr(
  p_review_id uuid,
  p_user_id uuid,
  p_restaurant_id uuid,
  p_title text,
  p_content text,
  p_visited_at timestamptz,
  p_verification_photo text,
  p_food_photos text[],
  p_categories text[],
  p_ocr_result_id uuid,
  p_ocr_result_revision uuid,
  p_verification_object_id uuid,
  p_verification_object_version text,
  p_verification_object_updated_at timestamptz,
  p_verification_photo_sha256 text,
  p_user_corrections jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $wrapper$
  SELECT ocr_private.create_review_with_receipt_ocr(
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
  );
$wrapper$;

DO $wrapper_grants$
DECLARE
  required record;
  procedure_oid oid;
BEGIN
  FOR required IN
    SELECT * FROM pg_temp.g014_feature_rpc_registry ORDER BY source_signature
  LOOP
    procedure_oid := pg_catalog.to_regprocedure(required.source_signature);
    EXECUTE pg_catalog.format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',
      procedure_oid::regprocedure
    );
    EXECUTE pg_catalog.format(
      'GRANT EXECUTE ON FUNCTION %s TO service_role',
      procedure_oid::regprocedure
    );
  END LOOP;
END;
$wrapper_grants$;

INSERT INTO privacy_retention.g014_public_rpc_allowlist (
  function_schema,
  function_name,
  identity_arguments,
  grantee,
  source_signature
)
SELECT
  namespace.nspname,
  procedure.proname,
  procedure.proargtypes::text,
  'service_role'::name,
  required.source_signature
FROM pg_temp.g014_feature_rpc_registry AS required
JOIN pg_catalog.pg_proc AS procedure
  ON procedure.oid = pg_catalog.to_regprocedure(required.source_signature)
JOIN pg_catalog.pg_namespace AS namespace
  ON namespace.oid = procedure.pronamespace
ON CONFLICT (source_signature, grantee) DO UPDATE SET
  function_schema = EXCLUDED.function_schema,
  function_name = EXCLUDED.function_name,
  identity_arguments = EXCLUDED.identity_arguments;

INSERT INTO privacy_retention.g014_nested_helper_allowlist (source_signature)
SELECT 'ocr_private.' || pg_catalog.substr(
         required.source_signature,
         pg_catalog.length('public.') + 1
       )
FROM pg_temp.g014_feature_rpc_registry AS required
ON CONFLICT (source_signature) DO NOTHING;

INSERT INTO privacy_retention.g014_nested_helper_allowlist (source_signature)
VALUES ('ocr_private.register_review_ocr_generation()')
ON CONFLICT (source_signature) DO NOTHING;

DELETE FROM privacy_retention.g014_public_rpc_allowlist AS allowed
WHERE allowed.source_signature = 'public.storyboard_production_reject_archived_write()'
   OR (
     allowed.function_schema = 'public'
     AND allowed.function_name = 'storyboard_production_reject_archived_write'
   );

CREATE FUNCTION pg_temp.g014_feature_rpc_assert() RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $bridge$
BEGIN
  PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
  PERFORM privacy_retention.assert_g014_definer_contract();
  DROP FUNCTION pg_temp.g014_feature_rpc_assert();
END;
$bridge$;
REVOKE ALL ON FUNCTION pg_temp.g014_feature_rpc_assert()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION pg_temp.g014_feature_rpc_assert() TO postgres;

DO $manifest_readback$
BEGIN
  IF (
    SELECT coalesce(
             pg_catalog.jsonb_agg(
               pg_catalog.to_jsonb(manifest)
               ORDER BY manifest.manifest_kind, manifest.manifest_key
             ),
             '[]'::jsonb
           )
    FROM privacy_retention.g014_catalog_contract_manifest AS manifest
  ) IS DISTINCT FROM (
    SELECT snapshot.row_value
    FROM pg_temp.g014_feature_manifest_before AS snapshot
  ) THEN
    RAISE EXCEPTION 'G014_FEATURE_RPC_CATALOG_MANIFEST_DRIFT';
  END IF;
END;
$manifest_readback$;

RESET ROLE;

DO $restore_workflow_owner_membership$
DECLARE
  self_membership record;
BEGIN
  SELECT * INTO self_membership
  FROM pg_temp.g014_feature_self_membership_before;

  IF NOT FOUND THEN
    REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
  ELSE
    EXECUTE pg_catalog.format(
      'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT %s, SET %s GRANTED BY postgres',
      pg_catalog.upper(self_membership.inherit_option::text),
      pg_catalog.upper(self_membership.set_option::text)
    );
  END IF;
END;
$restore_workflow_owner_membership$;

SELECT pg_temp.g014_feature_rpc_assert();

DO $readback$
DECLARE
  required record;
  wrapper_oid oid;
  helper_oid oid;
  wrapper_row pg_catalog.pg_proc%ROWTYPE;
  helper_row pg_catalog.pg_proc%ROWTYPE;
  helper_signature text;
  generation_trigger_oid oid := pg_catalog.to_regprocedure(
    'ocr_private.register_review_ocr_generation()'
  );
  archive_guard_oid oid := pg_catalog.to_regprocedure(
    'public.storyboard_production_reject_archived_write()'
  );
BEGIN
  IF pg_catalog.to_regprocedure('pg_temp.g014_feature_rpc_assert()') IS NOT NULL THEN
    RAISE EXCEPTION 'G014_FEATURE_RPC_ASSERT_BRIDGE_REMAINING';
  END IF;

  IF EXISTS (
    (
      SELECT row_value FROM pg_temp.g014_feature_membership_before
      EXCEPT
      SELECT pg_catalog.to_jsonb(membership)
      FROM pg_catalog.pg_auth_members AS membership
    )
    UNION ALL
    (
      SELECT pg_catalog.to_jsonb(membership)
      FROM pg_catalog.pg_auth_members AS membership
      EXCEPT
      SELECT row_value FROM pg_temp.g014_feature_membership_before
    )
  ) THEN
    RAISE EXCEPTION 'G014_FEATURE_RPC_MEMBERSHIP_DRIFT';
  END IF;

  FOR required IN
    SELECT * FROM pg_temp.g014_feature_rpc_registry ORDER BY source_signature
  LOOP
    wrapper_oid := pg_catalog.to_regprocedure(required.source_signature);
    helper_signature := 'ocr_private.' || pg_catalog.substr(
      required.source_signature,
      pg_catalog.length('public.') + 1
    );
    helper_oid := pg_catalog.to_regprocedure(helper_signature);

    SELECT procedure.* INTO wrapper_row
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid = wrapper_oid;
    SELECT procedure.* INTO helper_row
    FROM pg_catalog.pg_proc AS procedure
    WHERE procedure.oid = helper_oid;

    IF wrapper_oid IS NULL
       OR wrapper_row.proowner <> 'privacy_workflow_owner'::regrole
       OR NOT wrapper_row.prosecdef
       OR wrapper_row.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
       OR wrapper_row.prokind <> 'f'
       OR wrapper_row.provolatile <> required.expected_volatility
       OR wrapper_row.prolang <> (
         SELECT language.oid FROM pg_catalog.pg_language AS language
         WHERE language.lanname = 'sql'
       )
       OR wrapper_row.prorettype <> required.expected_return_type
       OR wrapper_row.proretset IS DISTINCT FROM required.expected_set
       OR NOT pg_catalog.has_function_privilege('service_role', wrapper_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', wrapper_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', wrapper_oid, 'EXECUTE')
       OR (
         SELECT pg_catalog.count(*)
         FROM privacy_retention.g014_public_rpc_allowlist AS allowed
         WHERE allowed.source_signature = required.source_signature
           AND allowed.grantee = 'service_role'
           AND allowed.function_schema = 'public'
           AND allowed.function_name = (
             SELECT procedure.proname
             FROM pg_catalog.pg_proc AS procedure
             WHERE procedure.oid = wrapper_oid
           )
           AND allowed.identity_arguments = (
             SELECT procedure.proargtypes::text
             FROM pg_catalog.pg_proc AS procedure
             WHERE procedure.oid = wrapper_oid
           )
       ) <> 1
       OR helper_oid IS NULL
       OR helper_row.proowner <> 'postgres'::regrole
       OR NOT helper_row.prosecdef
       OR helper_row.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
       OR helper_row.prokind <> 'f'
       OR helper_row.provolatile <> required.expected_volatility
       OR helper_row.prolang <> (
         SELECT language.oid FROM pg_catalog.pg_language AS language
         WHERE language.lanname = 'plpgsql'
       )
       OR helper_row.prorettype <> required.expected_return_type
       OR helper_row.proretset IS DISTINCT FROM required.expected_set
       OR NOT pg_catalog.has_function_privilege('privacy_workflow_owner', helper_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', helper_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', helper_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', helper_oid, 'EXECUTE')
       OR (
         SELECT pg_catalog.count(*)
         FROM privacy_retention.g014_nested_helper_allowlist AS allowed
         WHERE allowed.source_signature = helper_signature
       ) <> 1 THEN
      RAISE EXCEPTION 'G014_FEATURE_RPC_READBACK_DRIFT: %', required.source_signature;
    END IF;
  END LOOP;

  SELECT procedure.* INTO helper_row
  FROM pg_catalog.pg_proc AS procedure
  WHERE procedure.oid = generation_trigger_oid;
  IF generation_trigger_oid IS NULL
     OR helper_row.proowner <> 'postgres'::regrole
     OR NOT helper_row.prosecdef
     OR helper_row.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
     OR helper_row.prokind <> 'f'
     OR helper_row.prorettype <> 'trigger'::regtype
     OR helper_row.proretset
     OR helper_row.prolang <> (
       SELECT language.oid FROM pg_catalog.pg_language AS language
       WHERE language.lanname = 'plpgsql'
     )
     OR pg_catalog.has_function_privilege('anon', generation_trigger_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', generation_trigger_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', generation_trigger_oid, 'EXECUTE')
     OR (
       SELECT pg_catalog.count(*)
       FROM privacy_retention.g014_nested_helper_allowlist AS allowed
       WHERE allowed.source_signature = 'ocr_private.register_review_ocr_generation()'
     ) <> 1
     OR (
       SELECT pg_catalog.count(*)
       FROM pg_catalog.pg_trigger AS trigger_row
       WHERE trigger_row.tgfoid = generation_trigger_oid
         AND trigger_row.tgrelid = 'public.reviews'::regclass
         AND trigger_row.tgname IN (
           'review_ocr_generation_on_insert',
           'review_ocr_generation_on_reset'
         )
         AND trigger_row.tgenabled = 'O'
         AND NOT trigger_row.tgisinternal
     ) <> 2 THEN
    RAISE EXCEPTION 'G014_FEATURE_GENERATION_TRIGGER_READBACK_DRIFT';
  END IF;

  IF pg_catalog.has_function_privilege('service_role', archive_guard_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', archive_guard_oid, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', archive_guard_oid, 'EXECUTE')
     OR EXISTS (
       SELECT 1
       FROM privacy_retention.g014_public_rpc_allowlist AS allowed
       WHERE allowed.source_signature = 'public.storyboard_production_reject_archived_write()'
          OR (
            allowed.function_schema = 'public'
            AND allowed.function_name = 'storyboard_production_reject_archived_write'
          )
     ) THEN
    RAISE EXCEPTION 'G014_FEATURE_TRIGGER_READBACK_DRIFT';
  END IF;
END;
$readback$;

COMMIT;
