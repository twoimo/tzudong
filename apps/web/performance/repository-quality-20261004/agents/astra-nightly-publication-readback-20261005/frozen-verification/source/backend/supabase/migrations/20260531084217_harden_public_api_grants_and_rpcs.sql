-- Harden Supabase Data API exposure for public-schema grants and RPCs.
-- RLS still decides row visibility, but anon/authenticated should not inherit
-- broad object privileges or execute SECURITY DEFINER write/admin functions by default.

-- Stop future public-schema objects from automatically becoming Data API accessible.
-- Product code that intentionally exposes a table/RPC must add an explicit GRANT
-- next to the matching RLS policy or caller validation.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;

-- supabase_admin is platform-owned on hosted projects. Apply these revokes when
-- the migration runner is a member of that role; otherwise keep the migration
-- deployable and surface a NOTICE for the privileged follow-up.
DO $$
DECLARE
  revoke_statement text;
BEGIN
  FOREACH revoke_statement IN ARRAY ARRAY[
    'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated',
    'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL PRIVILEGES ON FUNCTIONS FROM anon, authenticated',
    'ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated'
  ] LOOP
    BEGIN
      EXECUTE revoke_statement;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'Skipped privileged default privilege revoke: %', revoke_statement;
    END;
  END LOOP;
END $$;

-- Harden high-risk RPC grants with catalog-safe idempotence. Missing functions
-- are not fatal during migration application because older/staging databases can
-- legitimately lack legacy RPCs; the audit preflight still reports missing
-- expected RPCs as violations when the production surface requires them.
DO $$
DECLARE
  target record;
  function_oid oid;
BEGIN
  FOR target IN
    SELECT *
    FROM (VALUES
      -- Bulk import / role escalation / maintenance RPCs must never be browser-callable.
      ('public.make_user_admin(text)', 'PUBLIC, anon, authenticated', 'service_role'),
      ('public.batch_insert_restaurants_from_jsonl(jsonb[])', 'PUBLIC, anon, authenticated', 'service_role'),
      ('public.insert_restaurant_from_jsonl(jsonb)', 'PUBLIC, anon, authenticated', 'service_role'),
      ('public.refresh_materialized_views()', 'PUBLIC, anon, authenticated', 'service_role'),
      ('public.cleanup_old_notifications(integer)', 'PUBLIC, anon, authenticated', 'service_role'),

      -- Legacy admin review RPCs rely only on caller-provided admin ids. Keep
      -- them service-role-only until rewritten with auth.uid()/auth.role() binding.
      ('public.approve_restaurant(uuid, uuid)', 'PUBLIC, anon, authenticated', 'service_role'),
      ('public.reject_restaurant(uuid, uuid, text)', 'PUBLIC, anon, authenticated', 'service_role'),
      ('public.approve_restaurant_submission(uuid, uuid)', 'PUBLIC, anon, authenticated', 'service_role'),
      ('public.reject_restaurant_submission(uuid, uuid, text)', 'PUBLIC, anon, authenticated', 'service_role'),
      ('public.approve_new_restaurant_submission(uuid, uuid, jsonb)', 'PUBLIC, anon, authenticated', 'service_role'),
      ('public.approve_edit_restaurant_submission(uuid, uuid, uuid[])', 'PUBLIC, anon, authenticated', 'service_role'),
      ('public.reject_submission(uuid, uuid, text)', 'PUBLIC, anon, authenticated', 'service_role'),
      ('public.reject_submission_item(uuid, uuid, text)', 'PUBLIC, anon, authenticated', 'service_role'),

      -- Current admin console approval RPCs bind the caller with auth.uid()
      -- unless auth.role() is service_role. Preserve authenticated admin-console
      -- execution while removing anon/PUBLIC.
      ('public.approve_submission_item(uuid, uuid, jsonb)', 'PUBLIC, anon', 'authenticated, service_role'),
      ('public.approve_edit_submission_item(uuid, uuid, jsonb)', 'PUBLIC, anon', 'authenticated, service_role')
    ) AS rpc_grants(signature, revoke_roles, grant_roles)
  LOOP
    function_oid := to_regprocedure(target.signature);

    IF function_oid IS NULL THEN
      RAISE NOTICE 'Skipped missing RPC grant hardening target: %', target.signature;
      CONTINUE;
    END IF;

    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %s', function_oid::regprocedure, target.revoke_roles);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %s', function_oid::regprocedure, target.grant_roles);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
