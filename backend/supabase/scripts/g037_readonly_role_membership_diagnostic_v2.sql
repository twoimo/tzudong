-- G037 rollback-only fixed-code role membership diagnostic v2.
--
-- This is an owner-executed, one-time operator script, not a Supabase migration.
-- It intentionally does not insert into supabase_migrations.schema_migrations.
-- The login is created with no password; credential material must be set later
-- through the separately approved external custody procedure.
-- This version classifies only bounded membership direction, cardinality,
-- privilege category, and PostgreSQL 17 membership options; it emits no role names.

BEGIN;

SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

DO $g037_precondition$
BEGIN
  IF pg_catalog.current_database() IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'g037_membership_diag_precondition_failed';
  END IF;

  IF pg_catalog.to_regrole('tzudong_g037_readonly') IS NOT NULL
     OR pg_catalog.to_regclass(
       'supabase_migrations.schema_migrations'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'g037_membership_diag_precondition_failed';
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

DO $g037_membership_postcondition$
DECLARE
  role_oid oid;
  target_function regprocedure;
  member_of_count bigint;
  member_of_elevated_count bigint;
  member_of_admin_option_count bigint;
  member_of_set_option_count bigint;
  member_of_inherit_option_count bigint;
  has_member_count bigint;
  has_elevated_member_count bigint;
  has_login_member_count bigint;
  has_admin_option_member_count bigint;
  has_set_option_member_count bigint;
  has_inherit_option_member_count bigint;
BEGIN
  SELECT role_row.oid
    INTO role_oid
    FROM pg_catalog.pg_roles AS role_row
   WHERE role_row.rolname = 'tzudong_g037_readonly';

  IF role_oid IS NULL THEN
    RAISE EXCEPTION 'g037_membership_diag_role_missing';
  END IF;

  target_function := pg_catalog.to_regprocedure(
    'public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)'
  );

  SELECT
    pg_catalog.count(*),
    pg_catalog.count(*) FILTER (
      WHERE parent_role.rolsuper
         OR parent_role.rolcreaterole
         OR parent_role.rolcreatedb
         OR parent_role.rolreplication
         OR parent_role.rolbypassrls
         OR EXISTS (
           SELECT 1
             FROM pg_catalog.pg_database AS database_row
            WHERE database_row.datdba = parent_role.oid
         )
         OR pg_catalog.has_database_privilege(
           parent_role.oid,
           pg_catalog.current_database(),
           'CREATE'
         )
         OR pg_catalog.has_schema_privilege(
           parent_role.oid,
           'public',
           'CREATE'
         )
         OR pg_catalog.has_function_privilege(
           parent_role.oid,
           target_function,
           'EXECUTE'
         )
    ),
    pg_catalog.count(*) FILTER (WHERE membership.admin_option),
    pg_catalog.count(*) FILTER (WHERE membership.set_option),
    pg_catalog.count(*) FILTER (WHERE membership.inherit_option)
    INTO
      member_of_count,
      member_of_elevated_count,
      member_of_admin_option_count,
      member_of_set_option_count,
      member_of_inherit_option_count
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS parent_role
      ON parent_role.oid = membership.roleid
   WHERE membership.member = role_oid;

  SELECT
    pg_catalog.count(*),
    pg_catalog.count(*) FILTER (
      WHERE member_role.rolsuper
         OR member_role.rolcreaterole
         OR member_role.rolcreatedb
         OR member_role.rolreplication
         OR member_role.rolbypassrls
    ),
    pg_catalog.count(*) FILTER (WHERE member_role.rolcanlogin),
    pg_catalog.count(*) FILTER (WHERE membership.admin_option),
    pg_catalog.count(*) FILTER (WHERE membership.set_option),
    pg_catalog.count(*) FILTER (WHERE membership.inherit_option)
    INTO
      has_member_count,
      has_elevated_member_count,
      has_login_member_count,
      has_admin_option_member_count,
      has_set_option_member_count,
      has_inherit_option_member_count
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS member_role
      ON member_role.oid = membership.member
   WHERE membership.roleid = role_oid;

  IF member_of_count + has_member_count > 4 THEN
    RAISE EXCEPTION 'g037_membership_diag_cardinality_overflow';
  END IF;
  IF member_of_count > 0 AND has_member_count > 0 THEN
    RAISE EXCEPTION 'g037_membership_diag_bidirectional';
  END IF;
  IF member_of_count > 1 THEN
    RAISE EXCEPTION 'g037_membership_diag_member_of_multiple';
  END IF;
  IF member_of_elevated_count > 0 THEN
    RAISE EXCEPTION 'g037_membership_diag_member_of_elevated';
  END IF;
  IF member_of_admin_option_count > 0 THEN
    RAISE EXCEPTION 'g037_membership_diag_member_of_admin_option';
  END IF;
  IF member_of_set_option_count > 0 THEN
    RAISE EXCEPTION 'g037_membership_diag_member_of_set_option';
  END IF;
  IF member_of_inherit_option_count > 0 THEN
    RAISE EXCEPTION 'g037_membership_diag_member_of_inherit_option';
  END IF;
  IF member_of_count = 1 THEN
    RAISE EXCEPTION 'g037_membership_diag_member_of_restricted';
  END IF;
  IF has_member_count > 1 THEN
    RAISE EXCEPTION 'g037_membership_diag_has_multiple_members';
  END IF;
  IF has_elevated_member_count > 0 THEN
    RAISE EXCEPTION 'g037_membership_diag_has_elevated_member';
  END IF;
  IF has_login_member_count > 0 THEN
    RAISE EXCEPTION 'g037_membership_diag_has_login_member';
  END IF;
  IF has_admin_option_member_count > 0 THEN
    RAISE EXCEPTION 'g037_membership_diag_has_admin_option_member';
  END IF;
  IF has_set_option_member_count > 0 THEN
    RAISE EXCEPTION 'g037_membership_diag_has_set_option_member';
  END IF;
  IF has_inherit_option_member_count > 0 THEN
    RAISE EXCEPTION 'g037_membership_diag_has_inherit_option_member';
  END IF;
  IF has_member_count = 1 THEN
    RAISE EXCEPTION 'g037_membership_diag_has_restricted_member';
  END IF;
  RAISE EXCEPTION 'g037_membership_diag_none';
END;
$g037_membership_postcondition$;

ROLLBACK;

