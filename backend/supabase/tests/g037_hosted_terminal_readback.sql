-- G037 terminal readback. This is read-only and returns exact persisted vectors.
SELECT count(*) = 40 AS exact_terminal_ledger_count
FROM supabase_migrations.schema_migrations;
SELECT version, name, statements
FROM supabase_migrations.schema_migrations
ORDER BY version, name;

SELECT
  pg_catalog.to_regclass('public.restaurants_backup') IS NULL AS backup_table_retired,
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND pg_catalog.pg_get_functiondef(p.oid) ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)') AS no_function_dependency,
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_views v WHERE v.schemaname NOT IN ('pg_catalog','information_schema') AND v.definition ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)') AS no_view_dependency,
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_matviews v WHERE v.schemaname NOT IN ('pg_catalog','information_schema') AND v.definition ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)') AS no_matview_dependency,
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t WHERE NOT t.tgisinternal AND pg_catalog.pg_get_triggerdef(t.oid) ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)') AS no_trigger_dependency,
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_rewrite r WHERE r.rulename <> '_RETURN' AND pg_catalog.pg_get_ruledef(r.oid) ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)') AS no_rule_dependency,
  NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c WHERE pg_catalog.pg_get_constraintdef(c.oid) ~* '(^|[^[:alnum:]_])restaurants_backup([^[:alnum:]_]|$)') AS no_constraint_dependency;
