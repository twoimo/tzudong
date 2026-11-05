-- Supabase CLI 2.117.0 generated this migration as
-- 20261013113348_review_verification_immutable_key_fence.sql. Before its first
-- application it was renamed so it sorts after the durable OCR result contract
-- (20261013190000) and its G014 RPC catalog integration (20261013190100).
--
-- Supabase Storage uploads first test the caller's RLS permission, write a
-- versioned object to the provider, and then complete the metadata transaction
-- as a privileged database actor. The restrictive policy rejects ordinary
-- authenticated UPDATE permission before an upsert can reach the provider. The
-- UPDATE trigger rejects privileged metadata replacement paths that bypass RLS.
-- DELETE stays available only for unreferenced canonical verification objects:
-- the delete trigger shares the review mutation lock and writes the durable
-- retirement tombstone before metadata disappears. This preserves owner,
-- guarded-admin and account-deletion cleanup after their review reference is
-- gone while preventing a later review from reattaching the deleted key. This
-- does not claim to lock provider bytes against credentials that write directly
-- to S3; those credentials remain an operating authority boundary.
BEGIN;
SET LOCAL lock_timeout = '2s';
SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('tzudong:review-verification-immutable-key:v1', 0)
);

CREATE TEMP TABLE review_verification_lease (
  pg_major integer NOT NULL,
  schema_lease boolean NOT NULL,
  pg15_membership_lease boolean NOT NULL,
  self_membership jsonb,
  before_members jsonb NOT NULL,
  before_schema jsonb NOT NULL
) ON COMMIT DROP;

DO $prepare$
DECLARE
  workflow_owner oid := 'privacy_workflow_owner'::regrole;
  runner oid := 'postgres'::regrole;
  pg_major integer := current_setting('server_version_num')::integer / 10000;
  schema_lease boolean;
  pg15_membership_lease boolean := false;
  self_membership jsonb;
  before_members jsonb;
  before_schema jsonb;
BEGIN
  IF current_user <> 'postgres'
    OR session_user <> 'postgres'
    OR pg_major NOT IN (15, 17)
    OR current_setting('transaction_read_only') <> 'off'
    OR to_regclass('storage.objects') IS NULL
    OR to_regnamespace('review_media_private') IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles
      WHERE oid = workflow_owner
        AND NOT rolsuper
        AND NOT rolbypassrls
        AND NOT rolcanlogin
        AND NOT rolinherit
    )
  THEN
    RAISE EXCEPTION 'REVIEW_VERIFICATION_IMMUTABLE_EXECUTOR_DENIED';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_class c
    WHERE c.oid = 'storage.objects'::regclass
      AND c.relowner = 'supabase_storage_admin'::regrole
      AND c.relrowsecurity
      AND NOT c.relforcerowsecurity
  ) THEN
    RAISE EXCEPTION 'REVIEW_VERIFICATION_STORAGE_CATALOG_DRIFT';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy p
    WHERE p.polrelid = 'storage.objects'::regclass
      AND p.polname = 'review_media_safe_update'
      AND p.polcmd = 'w'
      AND NOT p.polpermissive
      AND p.polroles = ARRAY['authenticated'::regrole::oid]
  ) THEN
    RAISE EXCEPTION 'REVIEW_VERIFICATION_UPDATE_POLICY_BASELINE_DRIFT';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy p
    WHERE p.polrelid = 'storage.objects'::regclass
      AND p.polname = 'review_verifications_owner_delete'
      AND p.polcmd = 'd'
      AND p.polpermissive
      AND p.polroles = ARRAY['authenticated'::regrole::oid]
      AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) =
        '((bucket_id = ''review-verifications''::text) AND ((storage.foldername(name))[1] = ( SELECT (auth.uid())::text AS uid)))'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy p
    WHERE p.polrelid = 'storage.objects'::regclass
      AND p.polname = 'review_verifications_safe_delete'
      AND p.polcmd = 'd'
      AND NOT p.polpermissive
      AND p.polroles = ARRAY['authenticated'::regrole::oid]
      AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) =
        '((bucket_id <> ''review-verifications''::text) OR review_media_delete_allowed(name))'
  ) THEN
    RAISE EXCEPTION 'REVIEW_VERIFICATION_DELETE_POLICY_BASELINE_DRIFT';
  END IF;

  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) ORDER BY roleid, member, grantor), '[]'::jsonb)
  INTO before_members
  FROM pg_catalog.pg_auth_members m;

  SELECT pg_catalog.to_jsonb(n)
  INTO before_schema
  FROM pg_catalog.pg_namespace n
  WHERE n.oid = 'review_media_private'::regnamespace;

  schema_lease := NOT pg_catalog.has_schema_privilege(
    workflow_owner,
    'review_media_private',
    'CREATE'
  );
  IF schema_lease THEN
    GRANT CREATE ON SCHEMA review_media_private TO privacy_workflow_owner;
  END IF;

  SELECT pg_catalog.to_jsonb(m)
  INTO self_membership
  FROM pg_catalog.pg_auth_members m
  WHERE m.roleid = workflow_owner
    AND m.member = runner
    AND m.grantor = runner;

  IF self_membership IS NOT NULL
    AND (self_membership->>'admin_option')::boolean
  THEN
    RAISE EXCEPTION 'REVIEW_VERIFICATION_SELF_MEMBERSHIP_DENIED';
  END IF;

  IF pg_major = 17 THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_auth_members m
      WHERE m.roleid = workflow_owner
        AND m.member = runner
        AND m.admin_option
        AND m.grantor <> runner
    ) THEN
      RAISE EXCEPTION 'REVIEW_VERIFICATION_OWNER_AUTHORITY_MISSING';
    END IF;
    EXECUTE 'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT FALSE, SET TRUE GRANTED BY postgres';
  ELSE
    pg15_membership_lease := NOT pg_catalog.pg_has_role(runner, workflow_owner, 'MEMBER');
    IF pg15_membership_lease THEN
      GRANT privacy_workflow_owner TO postgres;
    END IF;
  END IF;

  INSERT INTO pg_temp.review_verification_lease(
    pg_major,
    schema_lease,
    pg15_membership_lease,
    self_membership,
    before_members,
    before_schema
  ) VALUES (
    pg_major,
    schema_lease,
    pg15_membership_lease,
    self_membership,
    before_members,
    before_schema
  );
END;
$prepare$;

SET LOCAL ROLE privacy_workflow_owner;
CREATE FUNCTION review_media_private.reject_verification_object_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP <> 'UPDATE'
    OR TG_TABLE_SCHEMA <> 'storage'
    OR TG_TABLE_NAME <> 'objects'
  THEN
    RAISE EXCEPTION 'REVIEW_VERIFICATION_TRIGGER_CONTEXT_INVALID';
  END IF;

  IF OLD.bucket_id = 'review-verifications'
    OR NEW.bucket_id = 'review-verifications'
  THEN
    RAISE EXCEPTION USING
      MESSAGE = 'REVIEW_VERIFICATION_OBJECT_IMMUTABLE',
      ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION review_media_private.reject_verification_object_update()
  FROM PUBLIC, anon, authenticated, service_role, supabase_storage_admin;
GRANT EXECUTE ON FUNCTION review_media_private.reject_verification_object_update()
  TO postgres;

CREATE FUNCTION review_media_private.guard_verification_object_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  object_owner uuid;
  object_review uuid;
  conflicting_tombstone boolean;
BEGIN
  IF TG_OP <> 'DELETE'
    OR TG_TABLE_SCHEMA <> 'storage'
    OR TG_TABLE_NAME <> 'objects'
  THEN
    RAISE EXCEPTION 'REVIEW_VERIFICATION_DELETE_TRIGGER_CONTEXT_INVALID';
  END IF;

  IF OLD.bucket_id <> 'review-verifications' THEN
    RETURN OLD;
  END IF;

  -- The review INSERT/UPDATE/DELETE statement trigger and the authenticated
  -- delete policy use this same transaction lock. Both race orders therefore
  -- finish with either a live reference plus object, or a retired object key
  -- that review_media_private.guard_references() refuses to reattach.
  PERFORM pg_catalog.pg_advisory_xact_lock(741093, 1);

  IF review_media_private.referenced(OLD.name) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'REVIEW_VERIFICATION_OBJECT_REFERENCED',
      ERRCODE = '23503';
  END IF;

  BEGIN
    object_owner := pg_catalog.split_part(OLD.name, '/', 1)::uuid;
    object_review := pg_catalog.split_part(OLD.name, '/', 3)::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RAISE EXCEPTION USING
      MESSAGE = 'REVIEW_VERIFICATION_OBJECT_DELETE_UNBOUND',
      ERRCODE = '23514';
  END;

  IF NOT review_media_private.canonical(
    OLD.name,
    object_owner,
    object_review,
    'verification'
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'REVIEW_VERIFICATION_OBJECT_DELETE_UNBOUND',
      ERRCODE = '23514';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM review_media_private.cleanup c
    WHERE c.path = OLD.name
      AND (
        c.owner_id IS DISTINCT FROM object_owner
        OR c.review_id IS DISTINCT FROM object_review
        OR c.purpose IS DISTINCT FROM 'verification'
      )
  ) INTO conflicting_tombstone;

  IF conflicting_tombstone THEN
    RAISE EXCEPTION USING
      MESSAGE = 'REVIEW_VERIFICATION_OBJECT_TOMBSTONE_CONFLICT',
      ERRCODE = '23514';
  END IF;

  INSERT INTO review_media_private.cleanup(
    path,
    owner_id,
    review_id,
    purpose,
    retired,
    complete
  ) VALUES (
    OLD.name,
    object_owner,
    object_review,
    'verification',
    true,
    false
  )
  ON CONFLICT (path) DO UPDATE
  SET retired = true,
      complete = false;

  RETURN OLD;
END;
$function$;
REVOKE ALL ON FUNCTION review_media_private.guard_verification_object_delete()
  FROM PUBLIC, anon, authenticated, service_role, supabase_storage_admin;
GRANT EXECUTE ON FUNCTION review_media_private.guard_verification_object_delete()
  TO postgres;
RESET ROLE;

CREATE POLICY review_verifications_immutable_update
  ON storage.objects
  AS RESTRICTIVE
  FOR UPDATE
  TO authenticated
  USING (bucket_id <> 'review-verifications')
  WITH CHECK (bucket_id <> 'review-verifications');

CREATE TRIGGER a01_review_verification_immutable_update
  BEFORE UPDATE ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION review_media_private.reject_verification_object_update();

CREATE TRIGGER a01_review_verification_guard_delete
  BEFORE DELETE ON storage.objects
  FOR EACH ROW
  EXECUTE FUNCTION review_media_private.guard_verification_object_delete();

SET LOCAL ROLE privacy_workflow_owner;
REVOKE EXECUTE ON FUNCTION review_media_private.reject_verification_object_update()
  FROM postgres;
REVOKE EXECUTE ON FUNCTION review_media_private.guard_verification_object_delete()
  FROM postgres;
RESET ROLE;

DO $restore$
DECLARE
  lease pg_temp.review_verification_lease%ROWTYPE;
BEGIN
  SELECT * INTO STRICT lease FROM pg_temp.review_verification_lease;

  IF lease.schema_lease THEN
    REVOKE CREATE ON SCHEMA review_media_private FROM privacy_workflow_owner;
  END IF;

  IF lease.pg_major = 15 THEN
    IF lease.pg15_membership_lease THEN
      REVOKE privacy_workflow_owner FROM postgres;
    END IF;
  ELSIF lease.self_membership IS NULL THEN
    REVOKE privacy_workflow_owner FROM postgres GRANTED BY postgres;
  ELSE
    EXECUTE pg_catalog.format(
      'GRANT privacy_workflow_owner TO postgres WITH ADMIN FALSE, INHERIT %s, SET %s GRANTED BY postgres',
      pg_catalog.upper(lease.self_membership->>'inherit_option'),
      pg_catalog.upper(lease.self_membership->>'set_option')
    );
  END IF;

  IF (
    SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) ORDER BY roleid, member, grantor), '[]'::jsonb)
    FROM pg_catalog.pg_auth_members m
  ) IS DISTINCT FROM lease.before_members
    OR (
      SELECT pg_catalog.to_jsonb(n)
      FROM pg_catalog.pg_namespace n
      WHERE n.oid = 'review_media_private'::regnamespace
    ) IS DISTINCT FROM lease.before_schema
  THEN
    RAISE EXCEPTION 'REVIEW_VERIFICATION_LEASE_PRESERVATION_DRIFT';
  END IF;
END;
$restore$;

DO $readback$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy p
    WHERE p.polrelid = 'storage.objects'::regclass
      AND p.polname = 'review_verifications_immutable_update'
      AND p.polcmd = 'w'
      AND NOT p.polpermissive
      AND p.polroles = ARRAY['authenticated'::regrole::oid]
      AND pg_catalog.pg_get_expr(p.polqual, p.polrelid) = '(bucket_id <> ''review-verifications''::text)'
      AND pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid) = '(bucket_id <> ''review-verifications''::text)'
  )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgrelid = 'storage.objects'::regclass
        AND t.tgname = 'a01_review_verification_immutable_update'
        AND t.tgenabled = 'O'
        AND NOT t.tgisinternal
        AND t.tgtype = 19
        AND p.oid = 'review_media_private.reject_verification_object_update()'::regprocedure
        AND NOT p.prosecdef
        AND p.proowner = 'privacy_workflow_owner'::regrole
        AND p.proconfig = ARRAY['search_path=""']::text[]
    )
    OR NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgrelid = 'storage.objects'::regclass
        AND t.tgname = 'a01_review_verification_guard_delete'
        AND t.tgenabled = 'O'
        AND NOT t.tgisinternal
        AND t.tgtype = 11
        AND p.oid = 'review_media_private.guard_verification_object_delete()'::regprocedure
        AND p.prosecdef
        AND p.proowner = 'privacy_workflow_owner'::regrole
        AND p.proconfig = ARRAY['search_path=""']::text[]
    )
    OR EXISTS (
      SELECT 1
      FROM pg_catalog.unnest(ARRAY[
        'anon',
        'authenticated',
        'service_role',
        'supabase_storage_admin',
        'postgres'
      ]) role_name
      WHERE pg_catalog.has_function_privilege(
          role_name,
          'review_media_private.reject_verification_object_update()',
          'EXECUTE'
        )
        OR pg_catalog.has_function_privilege(
          role_name,
          'review_media_private.guard_verification_object_delete()',
          'EXECUTE'
        )
    )
  THEN
    RAISE EXCEPTION 'REVIEW_VERIFICATION_IMMUTABLE_READBACK_DRIFT';
  END IF;
END;
$readback$;

-- The owner-scoped runtime probe remains held through stages 97-100. Activate
-- it only after this final immutable-key fence and its readback both succeed.
INSERT INTO ocr_private.feature_runtime_capability (
  capability_version,
  schema_version
) VALUES (
  'review-media-feature-v1',
  1
);

COMMIT;
