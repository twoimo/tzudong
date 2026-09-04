-- Sanitized owner-side readback for the G037 dedicated read-only role.
-- The result contains only fixed keys, booleans, and bounded counts.

WITH expected_role AS (
  SELECT role_row.*
    FROM pg_catalog.pg_roles AS role_row
   WHERE role_row.rolname = 'tzudong_g037_readonly'
),
target AS (
  SELECT pg_catalog.to_regprocedure(
    'public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)'
  ) AS procedure_oid
),
settings AS (
  SELECT pg_catalog.array_agg(setting ORDER BY setting) AS values
    FROM expected_role AS role_row
    JOIN pg_catalog.pg_db_role_setting AS setting_row
      ON setting_row.setrole = role_row.oid
     AND setting_row.setdatabase = 0
    CROSS JOIN LATERAL pg_catalog.unnest(setting_row.setconfig) AS setting
),
memberships AS (
  SELECT pg_catalog.count(*) AS value
    FROM expected_role AS role_row
    JOIN pg_catalog.pg_auth_members AS membership
      ON membership.member = role_row.oid
      OR membership.roleid = role_row.oid
),
owned_objects AS (
  SELECT
    (SELECT pg_catalog.count(*)
       FROM pg_catalog.pg_database AS object_row, expected_role AS role_row
      WHERE object_row.datdba = role_row.oid)
    + (SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_namespace AS object_row, expected_role AS role_row
        WHERE object_row.nspowner = role_row.oid)
    + (SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_class AS object_row, expected_role AS role_row
        WHERE object_row.relowner = role_row.oid)
    + (SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_proc AS object_row, expected_role AS role_row
        WHERE object_row.proowner = role_row.oid)
    + (SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_type AS object_row, expected_role AS role_row
        WHERE object_row.typowner = role_row.oid)
      AS value
),
direct_column_grants AS (
  SELECT pg_catalog.count(*) AS value
    FROM expected_role AS role_row
    JOIN pg_catalog.pg_attribute AS attribute_row ON true
    JOIN pg_catalog.pg_class AS relation_row
      ON relation_row.oid = attribute_row.attrelid
    JOIN pg_catalog.pg_namespace AS namespace_row
      ON namespace_row.oid = relation_row.relnamespace
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(attribute_row.attacl, '{}'::pg_catalog.aclitem[])
    ) AS acl_row
   WHERE namespace_row.nspname = 'supabase_migrations'
     AND relation_row.relname = 'schema_migrations'
     AND attribute_row.attname = ANY (ARRAY['version', 'name', 'statements'])
     AND acl_row.grantee = role_row.oid
     AND acl_row.privilege_type = 'SELECT'
     AND NOT acl_row.is_grantable
)
SELECT pg_catalog.jsonb_build_object(
  'schema', 'g037-readonly-role-readback-v1',
  'role_present', (SELECT pg_catalog.count(*) = 1 FROM expected_role),
  'login', COALESCE((SELECT rolcanlogin FROM expected_role), false),
  'no_superuser', COALESCE((SELECT NOT rolsuper FROM expected_role), false),
  'no_inherit', COALESCE((SELECT NOT rolinherit FROM expected_role), false),
  'no_create_role', COALESCE((SELECT NOT rolcreaterole FROM expected_role), false),
  'no_create_db', COALESCE((SELECT NOT rolcreatedb FROM expected_role), false),
  'no_replication', COALESCE((SELECT NOT rolreplication FROM expected_role), false),
  'no_bypass_rls', COALESCE((SELECT NOT rolbypassrls FROM expected_role), false),
  'connection_limit_one', COALESCE((SELECT rolconnlimit = 1 FROM expected_role), false),
  'settings_exact', COALESCE(
    (SELECT values FROM settings) = ARRAY[
      'default_transaction_read_only=on',
      'idle_in_transaction_session_timeout=30s',
      'lock_timeout=10s',
      'search_path=pg_catalog',
      'statement_timeout=30s'
    ],
    false
  ),
  'database_connect', COALESCE(
    pg_catalog.has_database_privilege(
      'tzudong_g037_readonly',
      pg_catalog.current_database(),
      'CONNECT'
    ),
    false
  ),
  'no_database_create', NOT COALESCE(
    pg_catalog.has_database_privilege(
      'tzudong_g037_readonly',
      pg_catalog.current_database(),
      'CREATE'
    ),
    true
  ),
  'no_public_schema_create', NOT COALESCE(
    pg_catalog.has_schema_privilege(
      'tzudong_g037_readonly',
      'public',
      'CREATE'
    ),
    true
  ),
  'ledger_columns_select', COALESCE(
    (SELECT value = 3 FROM direct_column_grants),
    false
  ),
  'target_function_present', COALESCE(
    (SELECT procedure_oid IS NOT NULL FROM target),
    false
  ),
  'target_execute_denied', NOT COALESCE(
    (SELECT pg_catalog.has_function_privilege(
      'tzudong_g037_readonly',
      procedure_oid,
      'EXECUTE'
    ) FROM target),
    true
  ),
  'membership_count', COALESCE((SELECT value FROM memberships), 0),
  'owned_object_count', COALESCE((SELECT value FROM owned_objects), 0)
);
