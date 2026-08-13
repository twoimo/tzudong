-- Separate anonymous active-row reads from authenticated administrator access.
-- The legacy is_user_admin(uuid) helper accepts arbitrary identities and must
-- never be part of an anonymous policy or executable by Data API roles.

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('tzudong:local-public-read-policy-convergence:v1', 0)
);

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.announcements') IS NULL
     OR pg_catalog.to_regclass('public.ad_banners') IS NULL
     OR pg_catalog.to_regclass('public.user_roles') IS NULL
     OR pg_catalog.to_regclass('public.user_account_status') IS NULL
     OR pg_catalog.to_regprocedure('public.is_user_admin(uuid)') IS NULL THEN
    RAISE EXCEPTION 'local_public_read_policy_prerequisite_missing';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.is_current_user_active_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT (SELECT auth.uid()) IS NOT NULL
     AND EXISTS (
       SELECT 1
         FROM public.user_roles AS role_row
         JOIN public.user_account_status AS status_row
           ON status_row.user_id = role_row.user_id
        WHERE role_row.user_id = (SELECT auth.uid())
          AND role_row.role::text = 'admin'
          AND status_row.account_status = 'active'
          AND status_row.disabled_at IS NULL
     )
$$;

ALTER FUNCTION public.is_current_user_active_admin()
  OWNER TO privacy_workflow_owner;

COMMENT ON FUNCTION public.is_current_user_active_admin() IS
  'Caller-bound active administrator predicate; accepts no arbitrary user identity.';

REVOKE ALL ON FUNCTION public.is_current_user_active_admin()
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_current_user_active_admin()
  TO authenticated;

-- Preserve the legacy helper only for owner-controlled legacy routines. Data
-- API roles must not gain an arbitrary-UUID administrator oracle.
REVOKE ALL ON FUNCTION public.is_user_admin(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_user_admin(uuid)
  TO privacy_workflow_owner;

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_banners ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.announcements FROM anon, authenticated;
GRANT SELECT ON TABLE public.announcements TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.announcements TO authenticated;

REVOKE ALL ON TABLE public.ad_banners FROM anon, authenticated;
GRANT SELECT ON TABLE public.ad_banners TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.ad_banners TO authenticated;

DROP POLICY IF EXISTS "Announcements select policy" ON public.announcements;
DROP POLICY IF EXISTS "Admins can insert announcements" ON public.announcements;
DROP POLICY IF EXISTS "Admins can update announcements" ON public.announcements;
DROP POLICY IF EXISTS "Admins can delete announcements" ON public.announcements;
DROP POLICY IF EXISTS announcements_select_policy ON public.announcements;
DROP POLICY IF EXISTS announcements_select_active ON public.announcements;
DROP POLICY IF EXISTS announcements_select_admin ON public.announcements;
DROP POLICY IF EXISTS announcements_insert_admin ON public.announcements;
DROP POLICY IF EXISTS announcements_update_admin ON public.announcements;
DROP POLICY IF EXISTS announcements_delete_admin ON public.announcements;
DROP POLICY IF EXISTS tzudong_announcements_select_active ON public.announcements;
DROP POLICY IF EXISTS tzudong_announcements_select_admin ON public.announcements;
DROP POLICY IF EXISTS tzudong_announcements_insert_admin ON public.announcements;
DROP POLICY IF EXISTS tzudong_announcements_update_admin ON public.announcements;
DROP POLICY IF EXISTS tzudong_announcements_delete_admin ON public.announcements;

CREATE POLICY tzudong_announcements_select_active
  ON public.announcements FOR SELECT TO anon, authenticated
  USING (is_active = true);

CREATE POLICY tzudong_announcements_select_admin
  ON public.announcements FOR SELECT TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));

CREATE POLICY tzudong_announcements_insert_admin
  ON public.announcements FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_current_user_active_admin()));

CREATE POLICY tzudong_announcements_update_admin
  ON public.announcements FOR UPDATE TO authenticated
  USING ((SELECT public.is_current_user_active_admin()))
  WITH CHECK ((SELECT public.is_current_user_active_admin()));

CREATE POLICY tzudong_announcements_delete_admin
  ON public.announcements FOR DELETE TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));

DROP POLICY IF EXISTS ad_banners_select_combined ON public.ad_banners;
DROP POLICY IF EXISTS ad_banners_select_active ON public.ad_banners;
DROP POLICY IF EXISTS ad_banners_select_admin ON public.ad_banners;
DROP POLICY IF EXISTS ad_banners_insert_admin ON public.ad_banners;
DROP POLICY IF EXISTS ad_banners_update_admin ON public.ad_banners;
DROP POLICY IF EXISTS ad_banners_delete_admin ON public.ad_banners;
DROP POLICY IF EXISTS tzudong_ad_banners_select_active ON public.ad_banners;
DROP POLICY IF EXISTS tzudong_ad_banners_select_admin ON public.ad_banners;
DROP POLICY IF EXISTS tzudong_ad_banners_insert_admin ON public.ad_banners;
DROP POLICY IF EXISTS tzudong_ad_banners_update_admin ON public.ad_banners;
DROP POLICY IF EXISTS tzudong_ad_banners_delete_admin ON public.ad_banners;

CREATE POLICY tzudong_ad_banners_select_active
  ON public.ad_banners FOR SELECT TO anon, authenticated
  USING (is_active = true);

CREATE POLICY tzudong_ad_banners_select_admin
  ON public.ad_banners FOR SELECT TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));

CREATE POLICY tzudong_ad_banners_insert_admin
  ON public.ad_banners FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_current_user_active_admin()));

CREATE POLICY tzudong_ad_banners_update_admin
  ON public.ad_banners FOR UPDATE TO authenticated
  USING ((SELECT public.is_current_user_active_admin()))
  WITH CHECK ((SELECT public.is_current_user_active_admin()));

CREATE POLICY tzudong_ad_banners_delete_admin
  ON public.ad_banners FOR DELETE TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));

-- Converge every remaining caller-bound RLS policy before revoking the legacy
-- arbitrary-UUID helper. Policies that were implicitly TO PUBLIC are narrowed
-- to authenticated because their own-row and administrator branches both
-- depend on auth.uid().
ALTER POLICY restaurant_refresh_candidates_admin_insert
  ON public.restaurant_refresh_candidates TO authenticated
  WITH CHECK ((SELECT public.is_current_user_active_admin()));

ALTER POLICY restaurant_refresh_candidates_admin_select
  ON public.restaurant_refresh_candidates TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));

ALTER POLICY restaurant_refresh_candidates_admin_update
  ON public.restaurant_refresh_candidates TO authenticated
  USING ((SELECT public.is_current_user_active_admin()))
  WITH CHECK ((SELECT public.is_current_user_active_admin()));

ALTER POLICY restaurant_refresh_runs_admin_insert
  ON public.restaurant_refresh_runs TO authenticated
  WITH CHECK ((SELECT public.is_current_user_active_admin()));

ALTER POLICY restaurant_refresh_runs_admin_select
  ON public.restaurant_refresh_runs TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));

ALTER POLICY restaurant_refresh_runs_admin_update
  ON public.restaurant_refresh_runs TO authenticated
  USING ((SELECT public.is_current_user_active_admin()))
  WITH CHECK ((SELECT public.is_current_user_active_admin()));

ALTER POLICY "Admins can view request review audit"
  ON public.restaurant_request_review_audit TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));

ALTER POLICY "Admins can update requests"
  ON public.restaurant_requests TO authenticated
  USING ((SELECT public.is_current_user_active_admin()))
  WITH CHECK ((SELECT public.is_current_user_active_admin()));

ALTER POLICY "Admins can view all requests"
  ON public.restaurant_requests TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));

ALTER POLICY "Restaurant requests select policy"
  ON public.restaurant_requests TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR (SELECT public.is_current_user_active_admin())
  );

ALTER POLICY "Admins can delete submission items"
  ON public.restaurant_submission_items TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));

ALTER POLICY "Admins can update submission items"
  ON public.restaurant_submission_items TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));

ALTER POLICY "Submission items insert policy"
  ON public.restaurant_submission_items TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
        FROM public.restaurant_submissions AS submission_row
       WHERE submission_row.id = submission_id
         AND submission_row.user_id = (SELECT auth.uid())
    )
    OR (SELECT public.is_current_user_active_admin())
  );

ALTER POLICY "Submission items select policy"
  ON public.restaurant_submission_items TO authenticated
  USING (
    EXISTS (
      SELECT 1
        FROM public.restaurant_submissions AS submission_row
       WHERE submission_row.id = submission_id
         AND submission_row.user_id = (SELECT auth.uid())
    )
    OR (SELECT public.is_current_user_active_admin())
  );

ALTER POLICY "Admins can update all submissions"
  ON public.restaurant_submissions TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));

ALTER POLICY "Restaurant submissions select policy"
  ON public.restaurant_submissions TO authenticated
  USING (
    (SELECT auth.uid()) = user_id
    OR (SELECT public.is_current_user_active_admin())
  );

ALTER POLICY restaurants_authenticated_admin_update
  ON public.restaurants TO authenticated
  USING ((SELECT public.is_current_user_active_admin()))
  WITH CHECK ((SELECT public.is_current_user_active_admin()));

ALTER POLICY "Admins can delete short URLs"
  ON public.short_urls TO authenticated
  USING ((SELECT public.is_current_user_active_admin()));

DO $$
DECLARE
  helper_function regprocedure := pg_catalog.to_regprocedure(
    'public.is_current_user_active_admin()'
  );
  legacy_function regprocedure := pg_catalog.to_regprocedure(
    'public.is_user_admin(uuid)'
  );
  policy_record record;
  policy_using text;
  policy_check text;
  admin_expression constant text :=
    '( SELECT is_current_user_active_admin() AS is_current_user_active_admin)';
  helper_policy_count bigint;
BEGIN
  IF helper_function IS NULL
     OR legacy_function IS NULL
     OR NOT pg_catalog.has_function_privilege(
       'authenticated', helper_function, 'EXECUTE'
     )
     OR pg_catalog.has_function_privilege('anon', helper_function, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', helper_function, 'EXECUTE')
     OR pg_catalog.has_function_privilege('anon', legacy_function, 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated', legacy_function, 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role', legacy_function, 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege(
       'privacy_workflow_owner', legacy_function, 'EXECUTE'
     )
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.pg_proc AS function_row
        WHERE function_row.oid = helper_function
          AND (
            function_row.pronargs <> 0
            OR function_row.prorettype <> 'boolean'::regtype
            OR function_row.prosecdef IS TRUE
            OR function_row.provolatile <> 's'
            OR function_row.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
          )
     ) THEN
    RAISE EXCEPTION 'local_public_read_helper_contract_failed';
  END IF;

  IF NOT pg_catalog.has_table_privilege('anon', 'public.announcements', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.announcements', 'INSERT,UPDATE,DELETE')
     OR NOT pg_catalog.has_table_privilege(
       'authenticated', 'public.announcements', 'SELECT,INSERT,UPDATE,DELETE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.announcements', 'SELECT,INSERT,UPDATE,DELETE'
     )
     OR NOT pg_catalog.has_table_privilege('anon', 'public.ad_banners', 'SELECT')
     OR pg_catalog.has_table_privilege('anon', 'public.ad_banners', 'INSERT,UPDATE,DELETE')
     OR NOT pg_catalog.has_table_privilege(
       'authenticated', 'public.ad_banners', 'SELECT,INSERT,UPDATE,DELETE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'service_role', 'public.ad_banners', 'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION 'local_public_read_table_grant_contract_failed';
  END IF;

  IF (
    SELECT count(*)
      FROM pg_catalog.pg_policy AS policy_row
      JOIN pg_catalog.pg_class AS relation_row ON relation_row.oid = policy_row.polrelid
      JOIN pg_catalog.pg_namespace AS schema_row ON schema_row.oid = relation_row.relnamespace
     WHERE schema_row.nspname = 'public'
       AND relation_row.relname IN ('announcements', 'ad_banners')
  ) <> 10 THEN
    RAISE EXCEPTION 'local_public_read_policy_count_failed';
  END IF;

  FOR policy_record IN
    SELECT
      policy_row.*,
      relation_row.relname AS relation_name,
      COALESCE((
        SELECT array_agg(role_row.rolname ORDER BY role_row.rolname)::text[]
          FROM pg_catalog.unnest(policy_row.polroles) AS role_id(oid)
          JOIN pg_catalog.pg_roles AS role_row ON role_row.oid = role_id.oid
      ), ARRAY[]::text[]) AS role_names,
      (
        SELECT count(*)
          FROM pg_catalog.pg_depend AS dependency
         WHERE dependency.classid = 'pg_policy'::regclass
           AND dependency.objid = policy_row.oid
           AND dependency.refclassid = 'pg_proc'::regclass
           AND dependency.refobjid = helper_function
      ) AS helper_dependency_count,
      (
        SELECT count(*)
          FROM pg_catalog.pg_depend AS dependency
         WHERE dependency.classid = 'pg_policy'::regclass
           AND dependency.objid = policy_row.oid
           AND dependency.refclassid = 'pg_proc'::regclass
           AND dependency.refobjid = legacy_function
      ) AS legacy_dependency_count
      FROM pg_catalog.pg_policy AS policy_row
      JOIN pg_catalog.pg_class AS relation_row ON relation_row.oid = policy_row.polrelid
      JOIN pg_catalog.pg_namespace AS schema_row ON schema_row.oid = relation_row.relnamespace
     WHERE schema_row.nspname = 'public'
       AND relation_row.relname IN ('announcements', 'ad_banners')
     ORDER BY relation_row.relname, policy_row.polname
  LOOP
    policy_using := COALESCE(
      pg_catalog.pg_get_expr(policy_record.polqual, policy_record.polrelid),
      ''
    );
    policy_check := COALESCE(
      pg_catalog.pg_get_expr(policy_record.polwithcheck, policy_record.polrelid),
      ''
    );

    IF policy_record.polpermissive IS NOT TRUE
       OR policy_record.legacy_dependency_count <> 0 THEN
      RAISE EXCEPTION 'local_public_read_policy_contract_failed';
    END IF;

    IF policy_record.polname = 'tzudong_' || policy_record.relation_name || '_select_active' THEN
      IF policy_record.polcmd <> 'r'
         OR policy_record.role_names IS DISTINCT FROM ARRAY['anon', 'authenticated']::text[]
         OR policy_using <> '(is_active = true)'
         OR policy_check <> ''
         OR policy_record.helper_dependency_count <> 0 THEN
        RAISE EXCEPTION 'local_public_read_policy_contract_failed';
      END IF;
    ELSIF policy_record.polname = 'tzudong_' || policy_record.relation_name || '_select_admin' THEN
      IF policy_record.polcmd <> 'r'
         OR policy_record.role_names IS DISTINCT FROM ARRAY['authenticated']::text[]
         OR policy_using <> admin_expression
         OR policy_check <> ''
         OR policy_record.helper_dependency_count <> 1 THEN
        RAISE EXCEPTION 'local_public_read_policy_contract_failed';
      END IF;
    ELSIF policy_record.polname = 'tzudong_' || policy_record.relation_name || '_insert_admin' THEN
      IF policy_record.polcmd <> 'a'
         OR policy_record.role_names IS DISTINCT FROM ARRAY['authenticated']::text[]
         OR policy_using <> ''
         OR policy_check <> admin_expression
         OR policy_record.helper_dependency_count <> 1 THEN
        RAISE EXCEPTION 'local_public_read_policy_contract_failed';
      END IF;
    ELSIF policy_record.polname = 'tzudong_' || policy_record.relation_name || '_update_admin' THEN
      IF policy_record.polcmd <> 'w'
         OR policy_record.role_names IS DISTINCT FROM ARRAY['authenticated']::text[]
         OR policy_using <> admin_expression
         OR policy_check <> admin_expression
         OR policy_record.helper_dependency_count <> 2 THEN
        RAISE EXCEPTION 'local_public_read_policy_contract_failed';
      END IF;
    ELSIF policy_record.polname = 'tzudong_' || policy_record.relation_name || '_delete_admin' THEN
      IF policy_record.polcmd <> 'd'
         OR policy_record.role_names IS DISTINCT FROM ARRAY['authenticated']::text[]
         OR policy_using <> admin_expression
         OR policy_check <> ''
         OR policy_record.helper_dependency_count <> 1 THEN
        RAISE EXCEPTION 'local_public_read_policy_contract_failed';
      END IF;
    ELSE
      RAISE EXCEPTION 'local_public_read_policy_contract_failed';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_depend AS dependency
     WHERE dependency.classid = 'pg_policy'::regclass
       AND dependency.refclassid = 'pg_proc'::regclass
       AND dependency.refobjid = legacy_function
  ) THEN
    RAISE EXCEPTION 'local_legacy_admin_policy_dependency_remains';
  END IF;

  SELECT count(DISTINCT dependency.objid) INTO helper_policy_count
    FROM pg_catalog.pg_depend AS dependency
   WHERE dependency.classid = 'pg_policy'::regclass
     AND dependency.refclassid = 'pg_proc'::regclass
     AND dependency.refobjid = helper_function;
  IF helper_policy_count <> 26 THEN
    RAISE EXCEPTION 'local_caller_bound_admin_policy_count_failed';
  END IF;

  IF EXISTS (
    WITH expected(
      relation_name, policy_name, command, helper_dependency_count,
      uid_dependency_count
    ) AS (
      VALUES
        ('restaurant_refresh_candidates', 'restaurant_refresh_candidates_admin_insert', 'a'::"char", 1, 0),
        ('restaurant_refresh_candidates', 'restaurant_refresh_candidates_admin_select', 'r'::"char", 1, 0),
        ('restaurant_refresh_candidates', 'restaurant_refresh_candidates_admin_update', 'w'::"char", 2, 0),
        ('restaurant_refresh_runs', 'restaurant_refresh_runs_admin_insert', 'a'::"char", 1, 0),
        ('restaurant_refresh_runs', 'restaurant_refresh_runs_admin_select', 'r'::"char", 1, 0),
        ('restaurant_refresh_runs', 'restaurant_refresh_runs_admin_update', 'w'::"char", 2, 0),
        ('restaurant_request_review_audit', 'Admins can view request review audit', 'r'::"char", 1, 0),
        ('restaurant_requests', 'Admins can update requests', 'w'::"char", 2, 0),
        ('restaurant_requests', 'Admins can view all requests', 'r'::"char", 1, 0),
        ('restaurant_requests', 'Restaurant requests select policy', 'r'::"char", 1, 1),
        ('restaurant_submission_items', 'Admins can delete submission items', 'd'::"char", 1, 0),
        ('restaurant_submission_items', 'Admins can update submission items', 'w'::"char", 1, 0),
        ('restaurant_submission_items', 'Submission items insert policy', 'a'::"char", 1, 1),
        ('restaurant_submission_items', 'Submission items select policy', 'r'::"char", 1, 1),
        ('restaurant_submissions', 'Admins can update all submissions', 'w'::"char", 1, 0),
        ('restaurant_submissions', 'Restaurant submissions select policy', 'r'::"char", 1, 1),
        ('restaurants', 'restaurants_authenticated_admin_update', 'w'::"char", 2, 0),
        ('short_urls', 'Admins can delete short URLs', 'd'::"char", 1, 0)
    ), actual AS (
      SELECT
        relation_row.relname AS relation_name,
        policy_row.polname AS policy_name,
        policy_row.polcmd AS command,
        COALESCE((
          SELECT array_agg(role_row.rolname ORDER BY role_row.rolname)::text[]
            FROM pg_catalog.unnest(policy_row.polroles) AS role_id(oid)
            JOIN pg_catalog.pg_roles AS role_row ON role_row.oid = role_id.oid
        ), ARRAY[]::text[]) AS role_names,
        (
          SELECT count(*)
            FROM pg_catalog.pg_depend AS dependency
           WHERE dependency.classid = 'pg_policy'::regclass
             AND dependency.objid = policy_row.oid
             AND dependency.refclassid = 'pg_proc'::regclass
             AND dependency.refobjid = helper_function
        ) AS helper_dependency_count,
        (
          SELECT count(*)
            FROM pg_catalog.pg_depend AS dependency
           WHERE dependency.classid = 'pg_policy'::regclass
             AND dependency.objid = policy_row.oid
             AND dependency.refclassid = 'pg_proc'::regclass
             AND dependency.refobjid = 'auth.uid()'::regprocedure
        ) AS uid_dependency_count
        FROM pg_catalog.pg_policy AS policy_row
        JOIN pg_catalog.pg_class AS relation_row
          ON relation_row.oid = policy_row.polrelid
        JOIN pg_catalog.pg_namespace AS schema_row
          ON schema_row.oid = relation_row.relnamespace
       WHERE schema_row.nspname = 'public'
    )
    SELECT 1
      FROM expected
      LEFT JOIN actual USING (relation_name, policy_name)
     WHERE actual.policy_name IS NULL
        OR actual.command <> expected.command
        OR actual.role_names IS DISTINCT FROM ARRAY['authenticated']::text[]
        OR actual.helper_dependency_count <> expected.helper_dependency_count
        OR actual.uid_dependency_count <> expected.uid_dependency_count
  ) THEN
    RAISE EXCEPTION 'local_caller_bound_admin_policy_contract_failed';
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
