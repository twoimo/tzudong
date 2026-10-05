-- Bounded service-role RPCs for admin user-management reads and append-only
-- audit writes. Direct table grants revoked by G014 remain revoked.

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('tzudong:local-admin-data-boundary:v1', 0)
);

DO $$
BEGIN
  IF pg_catalog.to_regclass('public.profiles') IS NULL
     OR pg_catalog.to_regclass('public.user_roles') IS NULL
     OR pg_catalog.to_regclass('public.user_account_status') IS NULL
     OR pg_catalog.to_regclass('public.admin_audit_events') IS NULL
     OR pg_catalog.to_regclass(
       'privacy_retention.g014_public_rpc_allowlist'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'privacy_retention.assert_g014_public_rpc_allowlist()'
     ) IS NULL THEN
    RAISE EXCEPTION 'local_admin_data_boundary_prerequisite_missing';
  END IF;
END
$$;

-- The original helper called auth.role() from a private SECURITY DEFINER
-- owner that intentionally cannot execute auth helpers.  Read claims directly
-- so the service-role-only public incident RPC reaches the helper's own P0001
-- guard instead of failing earlier with a 42501 privilege error.
CREATE OR REPLACE FUNCTION public.privacy_incident_require_admin(
  p_actor_user_id uuid
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  claims jsonb;
  caller_role text;
BEGIN
  BEGIN
    claims := COALESCE(
      NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb,
      '{}'::jsonb
    );
    caller_role := COALESCE(
      NULLIF(claims ->> 'role', ''),
      NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
      ''
    );
  EXCEPTION
    WHEN invalid_text_representation OR invalid_parameter_value THEN
      RAISE EXCEPTION 'privacy_incident_service_role_required'
        USING ERRCODE = 'P0001';
  END;

  IF caller_role <> 'service_role' THEN
    RAISE EXCEPTION 'privacy_incident_service_role_required'
      USING ERRCODE = 'P0001';
  END IF;

  IF p_actor_user_id IS NULL OR NOT EXISTS (
    SELECT 1
      FROM public.user_roles AS role_row
      JOIN public.user_account_status AS status_row
        ON status_row.user_id = role_row.user_id
     WHERE role_row.user_id = p_actor_user_id
       AND role_row.role::text = 'admin'
       AND status_row.account_status = 'active'
       AND status_row.disabled_at IS NULL
  ) THEN
    RAISE EXCEPTION 'privacy_incident_privacy_admin_required'
      USING ERRCODE = 'P0001';
  END IF;
END
$$;

ALTER FUNCTION public.privacy_incident_require_admin(uuid)
  OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION public.privacy_incident_require_admin(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.privacy_incident_require_admin(uuid)
  TO privacy_workflow_owner;

CREATE OR REPLACE FUNCTION public.read_admin_user_management_metadata(
  p_user_ids uuid[]
)
RETURNS TABLE (
  user_id uuid,
  username text,
  nickname text,
  avatar_url text,
  profile_role text,
  profile_created_at timestamptz,
  profile_updated_at timestamptz,
  is_admin boolean,
  account_status text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  requested_count integer := pg_catalog.cardinality(p_user_ids);
BEGIN
  IF p_user_ids IS NULL
     OR requested_count NOT BETWEEN 1 AND 200
     OR pg_catalog.array_position(p_user_ids, NULL::uuid) IS NOT NULL
     OR (
       SELECT count(DISTINCT requested.user_id)
         FROM pg_catalog.unnest(p_user_ids) AS requested(user_id)
     ) <> requested_count THEN
    RAISE EXCEPTION 'admin_user_metadata_request_invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    requested.user_id,
    profile_row.username,
    profile_row.nickname,
    profile_row.avatar_url,
    profile_row.role AS profile_role,
    profile_row.created_at AS profile_created_at,
    profile_row.updated_at AS profile_updated_at,
    EXISTS (
      SELECT 1
        FROM public.user_roles AS role_row
       WHERE role_row.user_id = requested.user_id
         AND role_row.role::text = 'admin'
    ) AS is_admin,
    status_row.account_status
    FROM pg_catalog.unnest(p_user_ids) WITH ORDINALITY
      AS requested(user_id, request_ordinal)
    LEFT JOIN public.profiles AS profile_row
      ON profile_row.user_id = requested.user_id
    LEFT JOIN public.user_account_status AS status_row
      ON status_row.user_id = requested.user_id
   ORDER BY requested.request_ordinal;
END
$$;

CREATE OR REPLACE FUNCTION public.read_admin_user_ids_for_management()
RETURNS TABLE (user_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  admin_count integer;
BEGIN
  SELECT count(*) INTO admin_count
    FROM public.user_roles AS role_row
   WHERE role_row.role::text = 'admin';

  IF admin_count > 200 THEN
    RAISE EXCEPTION 'admin_user_id_count_exceeded'
      USING ERRCODE = '54000';
  END IF;

  RETURN QUERY
  SELECT role_row.user_id
    FROM public.user_roles AS role_row
   WHERE role_row.role::text = 'admin'
   ORDER BY role_row.user_id;
END
$$;

CREATE OR REPLACE FUNCTION public.read_admin_user_audit_events(
  p_limit integer
)
RETURNS TABLE (
  id uuid,
  actor_user_id uuid,
  target_user_id uuid,
  action text,
  reason text,
  status text,
  correlation_id uuid,
  applied_at timestamptz,
  error_code text,
  created_at timestamptz,
  audit_counts jsonb,
  audit_flags jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 50 THEN
    RAISE EXCEPTION 'admin_user_audit_limit_invalid'
      USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT
    audit_row.id,
    audit_row.actor_user_id,
    audit_row.target_user_id,
    audit_row.action,
    audit_row.reason,
    audit_row.status,
    audit_row.correlation_id,
    audit_row.applied_at,
    audit_row.error_code,
    audit_row.created_at,
    audit_row.audit_counts,
    audit_row.audit_flags
    FROM public.admin_audit_events AS audit_row
   ORDER BY audit_row.created_at DESC, audit_row.id DESC
   LIMIT p_limit;
END
$$;

CREATE OR REPLACE FUNCTION public.append_admin_user_audit_event(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_reason text,
  p_status text,
  p_correlation_id uuid,
  p_audit_counts jsonb,
  p_audit_flags jsonb,
  p_applied_at timestamptz,
  p_error_code text,
  p_request_id uuid,
  p_ip_hash text,
  p_user_agent_hash text
)
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  audit_id uuid;
BEGIN
  IF p_actor_user_id IS NULL
     OR p_request_id IS NULL
     OR p_audit_counts IS NULL
     OR p_audit_flags IS NULL
     OR NOT EXISTS (
       SELECT 1
         FROM public.user_roles AS role_row
         JOIN public.user_account_status AS status_row
           ON status_row.user_id = role_row.user_id
        WHERE role_row.user_id = p_actor_user_id
          AND role_row.role::text = 'admin'
          AND status_row.account_status = 'active'
          AND status_row.disabled_at IS NULL
     )
     OR (p_status = 'applied') IS DISTINCT FROM (p_applied_at IS NOT NULL)
     OR NOT public.admin_user_audit_event_is_safe(
       p_action,
       p_status,
       p_reason,
       p_error_code,
       '{}'::jsonb,
       '{}'::jsonb,
       p_audit_counts,
       p_audit_flags,
       p_request_id::text,
       p_ip_hash,
       p_user_agent_hash
     ) THEN
    RAISE EXCEPTION 'admin_user_audit_event_invalid'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.admin_audit_events (
    actor_user_id,
    target_user_id,
    action,
    reason,
    before_state,
    after_state,
    audit_counts,
    audit_flags,
    status,
    correlation_id,
    applied_at,
    error_code,
    request_id,
    ip_hash,
    user_agent_hash
  ) VALUES (
    p_actor_user_id,
    p_target_user_id,
    p_action,
    p_reason,
    '{}'::jsonb,
    '{}'::jsonb,
    p_audit_counts,
    p_audit_flags,
    p_status,
    p_correlation_id,
    p_applied_at,
    p_error_code,
    p_request_id::text,
    p_ip_hash,
    p_user_agent_hash
  )
  RETURNING admin_audit_events.id INTO audit_id;

  RETURN audit_id;
END
$$;

ALTER FUNCTION public.read_admin_user_management_metadata(uuid[])
  OWNER TO privacy_workflow_owner;
ALTER FUNCTION public.read_admin_user_ids_for_management()
  OWNER TO privacy_workflow_owner;
ALTER FUNCTION public.read_admin_user_audit_events(integer)
  OWNER TO privacy_workflow_owner;
ALTER FUNCTION public.append_admin_user_audit_event(
  uuid, uuid, text, text, text, uuid, jsonb, jsonb, timestamptz, text,
  uuid, text, text
) OWNER TO privacy_workflow_owner;

REVOKE ALL ON FUNCTION public.read_admin_user_management_metadata(uuid[])
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_admin_user_ids_for_management()
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.read_admin_user_audit_events(integer)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.append_admin_user_audit_event(
  uuid, uuid, text, text, text, uuid, jsonb, jsonb, timestamptz, text,
  uuid, text, text
) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.read_admin_user_management_metadata(uuid[])
  TO service_role;
GRANT EXECUTE ON FUNCTION public.read_admin_user_ids_for_management()
  TO service_role;
GRANT EXECUTE ON FUNCTION public.read_admin_user_audit_events(integer)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.append_admin_user_audit_event(
  uuid, uuid, text, text, text, uuid, jsonb, jsonb, timestamptz, text,
  uuid, text, text
) TO service_role;

-- Extend the frozen G014 Data API matrix with only the caller-bound predicate
-- and four bounded service-role RPCs introduced after the G014 migration.
WITH expected(source_signature, grantee) AS (
  VALUES
    ('public.is_current_user_active_admin()', 'authenticated'::name),
    ('public.read_admin_user_management_metadata(uuid[])', 'service_role'::name),
    ('public.read_admin_user_ids_for_management()', 'service_role'::name),
    ('public.read_admin_user_audit_events(integer)', 'service_role'::name),
    ('public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)', 'service_role'::name)
)
INSERT INTO privacy_retention.g014_public_rpc_allowlist (
  function_schema,
  function_name,
  identity_arguments,
  grantee,
  source_signature
)
SELECT
  function_schema.nspname,
  function_row.proname,
  function_row.proargtypes::text,
  expected.grantee,
  expected.source_signature
  FROM expected
  JOIN LATERAL pg_catalog.to_regprocedure(expected.source_signature)
    AS resolved(function_oid) ON true
  JOIN pg_catalog.pg_proc AS function_row
    ON function_row.oid = resolved.function_oid
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_row.pronamespace
ON CONFLICT (source_signature, grantee) DO UPDATE
SET function_schema = EXCLUDED.function_schema,
    function_name = EXCLUDED.function_name,
    identity_arguments = EXCLUDED.identity_arguments;

DO $$
DECLARE
  function_signature text;
  function_oid regprocedure;
  function_record record;
BEGIN
  FOREACH function_signature IN ARRAY ARRAY[
    'public.read_admin_user_management_metadata(uuid[])',
    'public.read_admin_user_ids_for_management()',
    'public.read_admin_user_audit_events(integer)',
    'public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)'
  ]::text[] LOOP
    function_oid := pg_catalog.to_regprocedure(function_signature);
    SELECT
      function_row.prosecdef,
      function_row.provolatile,
      function_row.proconfig,
      pg_catalog.pg_get_userbyid(function_row.proowner) AS owner_name
      INTO function_record
      FROM pg_catalog.pg_proc AS function_row
     WHERE function_row.oid = function_oid;

    IF function_oid IS NULL
       OR function_record.prosecdef IS NOT TRUE
       OR function_record.owner_name <> 'privacy_workflow_owner'
       OR function_record.proconfig IS DISTINCT FROM ARRAY['search_path=""']::text[]
       OR NOT pg_catalog.has_function_privilege(
         'service_role', function_oid, 'EXECUTE'
       )
       OR pg_catalog.has_function_privilege('anon', function_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege(
         'authenticated', function_oid, 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'local_admin_data_rpc_contract_failed';
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM privacy_retention.g014_public_rpc_allowlist AS allowed
      CROSS JOIN LATERAL pg_catalog.to_regprocedure(allowed.source_signature)
        AS resolved(function_oid)
     WHERE allowed.source_signature IN (
       'public.is_current_user_active_admin()',
       'public.read_admin_user_management_metadata(uuid[])',
       'public.read_admin_user_ids_for_management()',
       'public.read_admin_user_audit_events(integer)',
       'public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)'
     )
       AND (
         resolved.function_oid IS NULL
         OR pg_catalog.has_function_privilege(
           allowed.grantee, resolved.function_oid, 'EXECUTE'
         ) IS NOT TRUE
       )
  )
     OR (
       SELECT count(*)
         FROM privacy_retention.g014_public_rpc_allowlist AS allowed
        WHERE allowed.source_signature IN (
          'public.is_current_user_active_admin()',
          'public.read_admin_user_management_metadata(uuid[])',
          'public.read_admin_user_ids_for_management()',
          'public.read_admin_user_audit_events(integer)',
          'public.append_admin_user_audit_event(uuid,uuid,text,text,text,uuid,jsonb,jsonb,timestamp with time zone,text,uuid,text,text)'
        )
     ) <> 5
     OR pg_catalog.has_table_privilege('service_role', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('service_role', 'public.user_roles', 'SELECT')
     OR pg_catalog.has_table_privilege(
       'service_role', 'public.user_account_status', 'SELECT'
     )
     OR pg_catalog.has_table_privilege(
       'service_role', 'public.admin_audit_events', 'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION 'local_admin_data_direct_grant_reintroduced';
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
