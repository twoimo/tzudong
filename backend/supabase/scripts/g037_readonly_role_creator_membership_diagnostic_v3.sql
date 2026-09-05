-- G037 rollback-only fixed-code creator-membership diagnostic v3.
--
-- This is an owner-executed, one-time operator script, not a Supabase migration.
-- It intentionally does not insert into supabase_migrations.schema_migrations.
-- The login is created with no password; credential material must be set later
-- through the separately approved external custody procedure.
-- This version tests whether the one observed member is exactly PostgreSQL 17's
-- documented automatic non-superuser CREATEROLE grant. It emits no role names.

BEGIN;

SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '10s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

DO $g037_precondition$
BEGIN
  IF pg_catalog.current_database() IS DISTINCT FROM 'postgres' THEN
    RAISE EXCEPTION 'g037_creator_diag_precondition_failed';
  END IF;

  IF pg_catalog.to_regrole('tzudong_g037_readonly') IS NOT NULL
     OR pg_catalog.to_regclass(
       'supabase_migrations.schema_migrations'
     ) IS NULL
     OR pg_catalog.to_regprocedure(
       'public.begin_account_deletion_apply(uuid,uuid,uuid,text,text,text,timestamptz,text)'
     ) IS NULL THEN
    RAISE EXCEPTION 'g037_creator_diag_precondition_failed';
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

DO $g037_creator_membership_postcondition$
DECLARE
  role_oid oid;
  parent_membership_count bigint;
  member_count bigint;
  current_user_member_count bigint;
  current_user_nonsuperuser_createrole_count bigint;
  superuser_grantor_count bigint;
  admin_option_count bigint;
  set_option_count bigint;
  inherit_option_count bigint;
BEGIN
  SELECT role_row.oid
    INTO role_oid
    FROM pg_catalog.pg_roles AS role_row
   WHERE role_row.rolname = 'tzudong_g037_readonly';

  IF role_oid IS NULL THEN
    RAISE EXCEPTION 'g037_creator_diag_role_missing';
  END IF;

  SELECT pg_catalog.count(*)
    INTO parent_membership_count
    FROM pg_catalog.pg_auth_members AS membership
   WHERE membership.member = role_oid;

  SELECT
    pg_catalog.count(*),
    pg_catalog.count(*) FILTER (
      WHERE membership.member = pg_catalog.to_regrole(current_user)
    ),
    pg_catalog.count(*) FILTER (
      WHERE member_role.rolcreaterole
        AND NOT member_role.rolsuper
    ),
    pg_catalog.count(*) FILTER (WHERE grantor_role.rolsuper),
    pg_catalog.count(*) FILTER (WHERE membership.admin_option),
    pg_catalog.count(*) FILTER (WHERE membership.set_option),
    pg_catalog.count(*) FILTER (WHERE membership.inherit_option)
    INTO
      member_count,
      current_user_member_count,
      current_user_nonsuperuser_createrole_count,
      superuser_grantor_count,
      admin_option_count,
      set_option_count,
      inherit_option_count
    FROM pg_catalog.pg_auth_members AS membership
    JOIN pg_catalog.pg_roles AS member_role
      ON member_role.oid = membership.member
    JOIN pg_catalog.pg_roles AS grantor_role
      ON grantor_role.oid = membership.grantor
   WHERE membership.roleid = role_oid;

  IF parent_membership_count <> 0 THEN
    RAISE EXCEPTION 'g037_creator_diag_parent_membership_present';
  END IF;
  IF member_count <> 1 THEN
    RAISE EXCEPTION 'g037_creator_diag_member_cardinality_not_one';
  END IF;
  IF current_user_member_count <> 1 THEN
    RAISE EXCEPTION 'g037_creator_diag_member_not_current_user';
  END IF;
  IF current_user_nonsuperuser_createrole_count <> 1 THEN
    RAISE EXCEPTION 'g037_creator_diag_current_user_attribute_mismatch';
  END IF;
  IF superuser_grantor_count <> 1 THEN
    RAISE EXCEPTION 'g037_creator_diag_grantor_not_superuser';
  END IF;
  IF admin_option_count <> 1 THEN
    RAISE EXCEPTION 'g037_creator_diag_admin_option_missing';
  END IF;
  IF set_option_count <> 0 THEN
    RAISE EXCEPTION 'g037_creator_diag_set_option_present';
  END IF;
  IF inherit_option_count <> 0 THEN
    RAISE EXCEPTION 'g037_creator_diag_inherit_option_present';
  END IF;
  RAISE EXCEPTION 'g037_creator_diag_creator_admin_only';
END;
$g037_creator_membership_postcondition$;

ROLLBACK;
