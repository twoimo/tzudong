-- G037 dedicated-credential connection readback v1.
--
-- Run this statement only while connected as the dedicated G037 login through
-- an externally held credential. It is read-only and emits fixed booleans only;
-- it never returns a role name, connection string, password, SQL text, or row.

WITH ledger AS (
  SELECT
    pg_catalog.count(*) AS migration_count,
    pg_catalog.max(version) AS terminal_version
  FROM supabase_migrations.schema_migrations
),
target AS (
  SELECT pg_catalog.to_regprocedure(
    'public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)'
  ) AS function_oid
)
SELECT pg_catalog.jsonb_build_object(
  'schema', 'g037-readonly-role-connection-readback-v1',
  'database_exact', pg_catalog.current_database() = 'postgres',
  'postgres_major_17',
    pg_catalog.current_setting('server_version_num')::integer
      BETWEEN 170000 AND 179999,
  'dedicated_role_exact', current_user = 'tzudong_g037_readonly',
  'transaction_read_only',
    pg_catalog.current_setting('transaction_read_only') = 'on',
  'default_transaction_read_only',
    pg_catalog.current_setting('default_transaction_read_only') = 'on',
  'statement_timeout_exact',
    pg_catalog.current_setting('statement_timeout') = '30s',
  'lock_timeout_exact',
    pg_catalog.current_setting('lock_timeout') = '10s',
  'idle_transaction_timeout_exact',
    pg_catalog.current_setting('idle_in_transaction_session_timeout') = '30s',
  'search_path_exact',
    pg_catalog.current_setting('search_path') = 'pg_catalog',
  'database_connect',
    pg_catalog.has_database_privilege(
      current_user,
      pg_catalog.current_database(),
      'CONNECT'
    ),
  'database_create_denied',
    NOT pg_catalog.has_database_privilege(
      current_user,
      pg_catalog.current_database(),
      'CREATE'
    ),
  'public_schema_create_denied',
    NOT pg_catalog.has_schema_privilege(
      current_user,
      'public',
      'CREATE'
    ),
  'ledger_schema_usage',
    pg_catalog.has_schema_privilege(
      current_user,
      'supabase_migrations',
      'USAGE'
    ),
  'ledger_version_select',
    pg_catalog.has_column_privilege(
      current_user,
      'supabase_migrations.schema_migrations',
      'version',
      'SELECT'
    ),
  'ledger_name_select',
    pg_catalog.has_column_privilege(
      current_user,
      'supabase_migrations.schema_migrations',
      'name',
      'SELECT'
    ),
  'ledger_statements_select',
    pg_catalog.has_column_privilege(
      current_user,
      'supabase_migrations.schema_migrations',
      'statements',
      'SELECT'
    ),
  'ledger_exact',
    ledger.migration_count = 50
      AND ledger.terminal_version = '20260804000500',
  'target_function_present', target.function_oid IS NOT NULL,
  'target_execute_denied',
    target.function_oid IS NOT NULL
      AND NOT pg_catalog.has_function_privilege(
        current_user,
        target.function_oid,
        'EXECUTE'
      )
)
FROM ledger
CROSS JOIN target;
