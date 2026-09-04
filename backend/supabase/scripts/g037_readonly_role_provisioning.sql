-- G037 dedicated read-only role provisioning preview.
--
-- This is an owner-executed, one-time operator script, not a Supabase migration.
-- It intentionally does not insert into supabase_migrations.schema_migrations.
-- The login is created with no password; credential material must be set later
-- through the separately approved external custody procedure.

BEGIN;

SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

DO $g037_precondition$
BEGIN
  IF pg_catalog.current_database() IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'g037 readonly role precondition failed';
  END IF;

  IF pg_catalog.to_regrole('tzudong_g037_readonly') IS NOT NULL
     OR pg_catalog.to_regclass(
       'supabase_migrations.schema_migrations'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'g037 readonly role precondition failed';
  END IF;
END;
$g037_precondition$;

CREATE ROLE tzudong_g037_readonly
  WITH LOGIN
       PASSWORD NULL
       NOSUPERUSER
       NOCREATEDB
       NOCREATEROLE
       NOINHERIT
       NOREPLICATION
       NOBYPASSRLS
       CONNECTION LIMIT 1;

ALTER ROLE tzudong_g037_readonly
  SET default_transaction_read_only = 'on';
ALTER ROLE tzudong_g037_readonly
  SET statement_timeout = '30s';
ALTER ROLE tzudong_g037_readonly
  SET lock_timeout = '10s';
ALTER ROLE tzudong_g037_readonly
  SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE tzudong_g037_readonly
  SET search_path = 'pg_catalog';

GRANT CONNECT ON DATABASE postgres TO tzudong_g037_readonly;
GRANT USAGE ON SCHEMA supabase_migrations TO tzudong_g037_readonly;
GRANT SELECT (version, name, statements)
  ON TABLE supabase_migrations.schema_migrations
  TO tzudong_g037_readonly;

DO $g037_postcondition$
DECLARE
  role_oid oid;
  target_function regprocedure;
  role_settings text[];
  direct_database_privileges text[];
  direct_schema_privileges text[];
  direct_column_grants integer;
  unexpected_direct_acl_grants integer;
  owned_object_count bigint;
  membership_count bigint;
BEGIN
  SELECT role_row.oid
    INTO role_oid
    FROM pg_catalog.pg_roles AS role_row
   WHERE role_row.rolname = 'tzudong_g037_readonly'
     AND role_row.rolcanlogin
     AND NOT role_row.rolsuper
     AND NOT role_row.rolinherit
     AND NOT role_row.rolcreaterole
     AND NOT role_row.rolcreatedb
     AND NOT role_row.rolreplication
     AND NOT role_row.rolbypassrls
     AND role_row.rolconnlimit = 1;

  IF role_oid IS NULL THEN
    RAISE EXCEPTION 'g037 readonly role postcondition failed';
  END IF;

  SELECT procedure_row.oid::regprocedure
    INTO target_function
    FROM pg_catalog.pg_proc AS procedure_row
   WHERE procedure_row.oid = pg_catalog.to_regprocedure(
     'public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)'
   );

  SELECT pg_catalog.array_agg(setting ORDER BY setting)
    INTO role_settings
    FROM pg_catalog.pg_db_role_setting AS setting_row
    CROSS JOIN LATERAL pg_catalog.unnest(setting_row.setconfig) AS setting
   WHERE setting_row.setrole = role_oid
     AND setting_row.setdatabase = 0;

  SELECT pg_catalog.array_agg(acl_row.privilege_type ORDER BY acl_row.privilege_type)
    INTO direct_database_privileges
    FROM pg_catalog.pg_database AS database_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        database_row.datacl,
        pg_catalog.acldefault('d', database_row.datdba)
      )
    ) AS acl_row
   WHERE database_row.datname = pg_catalog.current_database()
     AND acl_row.grantee = role_oid;

  SELECT pg_catalog.array_agg(acl_row.privilege_type ORDER BY acl_row.privilege_type)
    INTO direct_schema_privileges
    FROM pg_catalog.pg_namespace AS namespace_row
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(
        namespace_row.nspacl,
        pg_catalog.acldefault('n', namespace_row.nspowner)
      )
    ) AS acl_row
   WHERE namespace_row.nspname = 'supabase_migrations'
     AND acl_row.grantee = role_oid;

  SELECT pg_catalog.count(*)
    INTO direct_column_grants
    FROM pg_catalog.pg_attribute AS attribute_row
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
     AND acl_row.grantee = role_oid
     AND acl_row.privilege_type = 'SELECT'
     AND NOT acl_row.is_grantable;

  SELECT pg_catalog.count(*)
    INTO unexpected_direct_acl_grants
    FROM (
      SELECT 1
        FROM pg_catalog.pg_class AS relation_row
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(
            relation_row.relacl,
            pg_catalog.acldefault('r', relation_row.relowner)
          )
        ) AS acl_row
       WHERE acl_row.grantee = role_oid
      UNION ALL
      SELECT 1
        FROM pg_catalog.pg_attribute AS attribute_row
        JOIN pg_catalog.pg_class AS relation_row
          ON relation_row.oid = attribute_row.attrelid
        JOIN pg_catalog.pg_namespace AS namespace_row
          ON namespace_row.oid = relation_row.relnamespace
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(attribute_row.attacl, '{}'::pg_catalog.aclitem[])
        ) AS acl_row
       WHERE acl_row.grantee = role_oid
         AND NOT (
           namespace_row.nspname = 'supabase_migrations'
           AND relation_row.relname = 'schema_migrations'
           AND attribute_row.attname = ANY (
             ARRAY['version', 'name', 'statements']
           )
           AND acl_row.privilege_type = 'SELECT'
           AND NOT acl_row.is_grantable
         )
      UNION ALL
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure_row
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          COALESCE(
            procedure_row.proacl,
            pg_catalog.acldefault('f', procedure_row.proowner)
          )
        ) AS acl_row
       WHERE acl_row.grantee = role_oid
      UNION ALL
      SELECT 1
        FROM pg_catalog.pg_default_acl AS default_acl_row
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          default_acl_row.defaclacl
        ) AS acl_row
       WHERE acl_row.grantee = role_oid
    ) AS unexpected_grant;

  SELECT
    (SELECT pg_catalog.count(*)
       FROM pg_catalog.pg_database
      WHERE datdba = role_oid)
    + (SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_namespace
        WHERE nspowner = role_oid)
    + (SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_class
        WHERE relowner = role_oid)
    + (SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_proc
        WHERE proowner = role_oid)
    + (SELECT pg_catalog.count(*)
         FROM pg_catalog.pg_type
        WHERE typowner = role_oid)
    INTO owned_object_count;

  SELECT pg_catalog.count(*)
    INTO membership_count
    FROM pg_catalog.pg_auth_members AS membership
   WHERE membership.member = role_oid
      OR membership.roleid = role_oid;

  IF target_function IS NULL
     OR role_settings IS DISTINCT FROM ARRAY[
       'default_transaction_read_only=on',
       'idle_in_transaction_session_timeout=30s',
       'lock_timeout=10s',
       'search_path=pg_catalog',
       'statement_timeout=30s'
     ]
     OR direct_database_privileges IS DISTINCT FROM ARRAY['CONNECT']
     OR direct_schema_privileges IS DISTINCT FROM ARRAY['USAGE']
     OR direct_column_grants <> 3
     OR unexpected_direct_acl_grants <> 0
     OR owned_object_count <> 0
     OR membership_count <> 0
     OR NOT pg_catalog.has_database_privilege(
       'tzudong_g037_readonly',
       pg_catalog.current_database(),
       'CONNECT'
     )
     OR pg_catalog.has_database_privilege(
       'tzudong_g037_readonly',
       pg_catalog.current_database(),
       'CREATE'
     )
     OR pg_catalog.has_schema_privilege(
       'tzudong_g037_readonly',
       'public',
       'CREATE'
     )
     OR NOT pg_catalog.has_column_privilege(
       'tzudong_g037_readonly',
       'supabase_migrations.schema_migrations',
       'version',
       'SELECT'
     )
     OR NOT pg_catalog.has_column_privilege(
       'tzudong_g037_readonly',
       'supabase_migrations.schema_migrations',
       'name',
       'SELECT'
     )
     OR NOT pg_catalog.has_column_privilege(
       'tzudong_g037_readonly',
       'supabase_migrations.schema_migrations',
       'statements',
       'SELECT'
     )
     OR pg_catalog.has_function_privilege(
       'tzudong_g037_readonly',
       target_function,
       'EXECUTE'
     ) THEN
    RAISE EXCEPTION 'g037 readonly role postcondition failed';
  END IF;
END;
$g037_postcondition$;

COMMIT;
