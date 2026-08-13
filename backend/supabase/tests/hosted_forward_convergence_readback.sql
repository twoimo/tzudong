-- Read-only terminal receipt after all four hosted convergence migrations.
BEGIN;

SET TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '5s';
SET LOCAL idle_in_transaction_session_timeout = '10s';

DO $hosted_forward_convergence_readback$
DECLARE
  v_expected record;
  v_predecessor_root text;
BEGIN
  IF (SELECT pg_catalog.count(*) FROM supabase_migrations.schema_migrations) <> 54
     OR (
       SELECT pg_catalog.count(*)
       FROM supabase_migrations.schema_migrations AS migration
       WHERE (migration.version::text, migration.name::text) IN (
         ('20260814010000', 'hosted_g016_g041_catalog_reconciliation'),
         ('20260814010100', 'hosted_runtime_boundary_convergence'),
         ('20260814010200', 'hosted_public_profile_read_convergence'),
         ('20260814010300', 'hosted_current_profile_mutation')
       )
     ) <> 4
     OR EXISTS (
       SELECT 1
       FROM supabase_migrations.schema_migrations AS migration
       WHERE migration.version::text >= '20260814010000'
         AND (migration.version::text, migration.name::text) NOT IN (
           ('20260814010000', 'hosted_g016_g041_catalog_reconciliation'),
           ('20260814010100', 'hosted_runtime_boundary_convergence'),
           ('20260814010200', 'hosted_public_profile_read_convergence'),
           ('20260814010300', 'hosted_current_profile_mutation')
         )
     ) THEN
    RAISE EXCEPTION 'hosted_forward_convergence_terminal_ledger_drift';
  END IF;

  SELECT pg_catalog.encode(
           pg_catalog.sha256(
             pg_catalog.convert_to(
               pg_catalog.json_agg(
                 pg_catalog.json_build_array(
                   migration.version::text,
                   migration.name::text,
                   migration.statements
                 ) ORDER BY migration.version::text
               )::text,
               'UTF8'
             )
           ),
           'hex'
         )
    INTO v_predecessor_root
  FROM supabase_migrations.schema_migrations AS migration
  WHERE migration.version::text < '20260814010000';

  IF v_predecessor_root IS DISTINCT FROM
       'ea72c80f7bd7020438373010ab5f33d261515b7272192aefefd66ef6cc74fec4'
     OR (
       SELECT pg_catalog.count(*)
       FROM supabase_migrations.schema_migrations AS migration
       WHERE migration.version::text < '20260814010000'
         AND migration.statements IS NULL
     ) <> 0
     OR (
       SELECT pg_catalog.count(*)
       FROM supabase_migrations.schema_migrations AS migration
       WHERE migration.version::text < '20260814010000'
         AND pg_catalog.cardinality(migration.statements) = 0
     ) <> 7 THEN
    RAISE EXCEPTION 'hosted_forward_convergence_predecessor_statement_root_drift';
  END IF;

  FOR v_expected IN
    SELECT expected.version,
           expected.name,
           expected.statement_count,
           expected.statements_sha256
    FROM (
      VALUES
        (
          '20260814010000'::text,
          'hosted_g016_g041_catalog_reconciliation'::text,
          41,
          'e6e5f5152719f4c7cad308be0f95eebe1944ed8a7986b144a01b7878542ac2c8'::text
        ),
        (
          '20260814010100'::text,
          'hosted_runtime_boundary_convergence'::text,
          140,
          'f1531c8479a872791a96ff5595459ef0adfa2f9b3104890d820c1fe4bea7dd07'::text
        ),
        (
          '20260814010200'::text,
          'hosted_public_profile_read_convergence'::text,
          57,
          'b29359016f9f53753af372bfb359251ebc71b94f94387f06f43e11b65cd6cea8'::text
        ),
        (
          '20260814010300'::text,
          'hosted_current_profile_mutation'::text,
          53,
          '45ebe6eb8dca03cdf4915adcab394ab8b7389252f1f37913760830f82fb6d727'::text
        )
    ) AS expected(version, name, statement_count, statements_sha256)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM supabase_migrations.schema_migrations AS migration
      WHERE migration.version::text = v_expected.version
        AND migration.name::text = v_expected.name
        AND pg_catalog.cardinality(migration.statements) =
          v_expected.statement_count
        AND pg_catalog.encode(
          pg_catalog.sha256(
            pg_catalog.convert_to(
              pg_catalog.to_json(migration.statements)::text,
              'UTF8'
            )
          ),
          'hex'
        ) = v_expected.statements_sha256
    ) THEN
      RAISE EXCEPTION 'hosted_forward_convergence_terminal_statement_vector_drift';
    END IF;
  END LOOP;

  IF pg_catalog.to_regclass('public.admin_storyboard_jobs') IS NULL
     OR pg_catalog.to_regclass('public.youtube_thumbnail_releases') IS NULL
     OR pg_catalog.to_regprocedure('public.is_current_user_active_admin()') IS NULL
     OR pg_catalog.to_regprocedure(
       'public.publish_youtube_thumbnail_release(uuid,text,text,text,text,text,text,text,text,numeric,jsonb,jsonb,jsonb,jsonb,uuid,timestamptz)'
     ) IS NULL
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.profiles', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'privacy_workflow_owner', 'public.reviews', 'SELECT'
     )
     OR pg_catalog.has_table_privilege('anon', 'public.profiles', 'SELECT')
     OR pg_catalog.has_table_privilege('authenticated', 'public.profiles', 'SELECT')
     OR pg_catalog.has_schema_privilege('privacy_workflow_owner', 'auth', 'USAGE') THEN
    RAISE EXCEPTION 'hosted_forward_convergence_terminal_catalog_drift';
  END IF;

  PERFORM privacy_retention.assert_g014_public_rpc_allowlist();
END
$hosted_forward_convergence_readback$;

ROLLBACK;
