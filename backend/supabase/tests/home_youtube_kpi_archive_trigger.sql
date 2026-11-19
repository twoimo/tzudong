-- Exercise the six actual archive triggers as service_role against synthetic
-- fixture rows. The same transaction is run before and after the ACL repair.
-- Only fixed case names leave this file; all DML and test helpers roll back.
BEGIN;
SET LOCAL statement_timeout = '15s';
CREATE TEMP TABLE home_kpi_archive_cases (name text PRIMARY KEY);

CREATE FUNCTION pg_temp.home_kpi_archive_expect_denied(statement text, case_name text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $archive_denied$
DECLARE denied boolean := false;
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    IF current_user <> 'service_role' THEN
      RAISE EXCEPTION 'HOME_KPI_ARCHIVE_ROLE';
    END IF;
    EXECUTE statement;
  EXCEPTION
    WHEN SQLSTATE '55000' THEN denied := true;
    WHEN OTHERS THEN
      EXECUTE 'RESET ROLE';
      RAISE EXCEPTION 'HOME_KPI_ARCHIVE_UNEXPECTED_SQLSTATE';
  END;
  EXECUTE 'RESET ROLE';
  IF NOT denied THEN
    RAISE EXCEPTION 'HOME_KPI_ARCHIVE_EXPECTED_55000';
  END IF;
  INSERT INTO pg_temp.home_kpi_archive_cases VALUES (case_name);
END
$archive_denied$;

CREATE FUNCTION pg_temp.home_kpi_archive_expect_allowed(statement text, case_name text)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER AS $archive_allowed$
DECLARE affected bigint;
BEGIN
  BEGIN
    EXECUTE 'SET LOCAL ROLE service_role';
    IF current_user <> 'service_role' THEN
      RAISE EXCEPTION 'HOME_KPI_ARCHIVE_ROLE';
    END IF;
    EXECUTE statement;
    GET DIAGNOSTICS affected = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RAISE EXCEPTION 'HOME_KPI_ARCHIVE_ACTIVE_DML_REJECTED';
  END;
  EXECUTE 'RESET ROLE';
  IF affected IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'HOME_KPI_ARCHIVE_ACTIVE_DML_COUNT';
  END IF;
  INSERT INTO pg_temp.home_kpi_archive_cases VALUES (case_name);
END
$archive_allowed$;

DO $archive_cases$
DECLARE
  archived_id uuid := '00000000-0000-0000-0000-000000000001';
  active_id uuid := '00000000-0000-0000-0000-000000000002';
  inserted_id uuid := '00000000-0000-0000-0000-000000000003';
  moved_id uuid := '00000000-0000-0000-0000-000000000004';
  suffix text;
  table_name text;
  seed_ok boolean;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.admin_storyboard_production_projects
    WHERE id = archived_id AND request->>'workflow' = 'storyboard-mlx-v1'
  ) OR NOT EXISTS (
    SELECT 1 FROM public.admin_storyboard_production_projects
    WHERE id = active_id AND request->>'workflow' = 'storyboard-gemini-v1'
  ) OR EXISTS (
    SELECT 1 FROM public.admin_storyboard_production_projects WHERE id = inserted_id
  ) THEN RAISE EXCEPTION 'HOME_KPI_ARCHIVE_PROJECT_SEED'; END IF;

  PERFORM pg_temp.home_kpi_archive_expect_denied(pg_catalog.format(
    'INSERT INTO public.admin_storyboard_production_projects(id,request) VALUES (%L,%L::jsonb)',
    inserted_id, '{"workflow":"storyboard-mlx-v1"}'), 'projects_archived_insert_denied');
  PERFORM pg_temp.home_kpi_archive_expect_denied(pg_catalog.format(
    'UPDATE public.admin_storyboard_production_projects SET request=request WHERE id=%L',
    archived_id), 'projects_archived_update_denied');
  PERFORM pg_temp.home_kpi_archive_expect_denied(pg_catalog.format(
    'UPDATE public.admin_storyboard_production_projects SET request=%L::jsonb WHERE id=%L',
    '{"workflow":"storyboard-gemini-v1"}', archived_id), 'projects_archived_to_active_denied');
  PERFORM pg_temp.home_kpi_archive_expect_denied(pg_catalog.format(
    'UPDATE public.admin_storyboard_production_projects SET request=%L::jsonb WHERE id=%L',
    '{"workflow":"storyboard-mlx-v1"}', active_id), 'projects_active_to_archived_denied');
  PERFORM pg_temp.home_kpi_archive_expect_allowed(pg_catalog.format(
    'INSERT INTO public.admin_storyboard_production_projects(id,request) VALUES (%L,%L::jsonb)',
    inserted_id, '{"workflow":"storyboard-gemini-v1"}'), 'projects_active_insert_allowed');
  -- Keep active_id and its active workflow available to the child-trigger
  -- cases. A missing parent must not accidentally substitute for this case.
  PERFORM pg_temp.home_kpi_archive_expect_allowed(pg_catalog.format(
    'UPDATE public.admin_storyboard_production_projects SET request=%L::jsonb WHERE id=%L',
    '{"workflow":"storyboard-gemini-v1","fixtureUpdated":true}', active_id),
    'projects_active_update_allowed');

  FOREACH suffix IN ARRAY ARRAY['jobs','assets','events','revisions','restores'] LOOP
    table_name := 'admin_storyboard_production_' || suffix;
    EXECUTE pg_catalog.format(
      'SELECT EXISTS (SELECT 1 FROM public.%1$I WHERE id=%2$L AND project_id=%2$L)'
      ' AND EXISTS (SELECT 1 FROM public.%1$I WHERE id=%3$L AND project_id=%3$L)'
      ' AND NOT EXISTS (SELECT 1 FROM public.%1$I WHERE id IN (%4$L,%5$L))',
      table_name, archived_id, active_id, inserted_id, moved_id) INTO seed_ok;
    IF seed_ok IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'HOME_KPI_ARCHIVE_CHILD_SEED';
    END IF;

    PERFORM pg_temp.home_kpi_archive_expect_denied(pg_catalog.format(
      'INSERT INTO public.%I(id,project_id) VALUES (%L,%L)',
      table_name, inserted_id, archived_id), suffix || '_archived_insert_denied');
    PERFORM pg_temp.home_kpi_archive_expect_denied(pg_catalog.format(
      'UPDATE public.%I SET project_id=project_id WHERE id=%L',
      table_name, archived_id), suffix || '_archived_update_denied');
    PERFORM pg_temp.home_kpi_archive_expect_denied(pg_catalog.format(
      'UPDATE public.%I SET project_id=%L WHERE id=%L',
      table_name, active_id, archived_id), suffix || '_archived_to_active_denied');
    PERFORM pg_temp.home_kpi_archive_expect_denied(pg_catalog.format(
      'UPDATE public.%I SET project_id=%L WHERE id=%L',
      table_name, archived_id, active_id), suffix || '_active_to_archived_denied');
    PERFORM pg_temp.home_kpi_archive_expect_allowed(pg_catalog.format(
      'INSERT INTO public.%I(id,project_id) VALUES (%L,%L)',
      table_name, inserted_id, active_id), suffix || '_active_insert_allowed');
    PERFORM pg_temp.home_kpi_archive_expect_allowed(pg_catalog.format(
      'UPDATE public.%I SET id=%L WHERE id=%L AND project_id=%L',
      table_name, moved_id, active_id, active_id), suffix || '_active_update_allowed');
  END LOOP;

  IF current_user <> session_user THEN
    RAISE EXCEPTION 'HOME_KPI_ARCHIVE_ROLE_NOT_RESET';
  END IF;
  IF (SELECT count(*) FROM pg_temp.home_kpi_archive_cases) <> 36 THEN
    RAISE EXCEPTION 'HOME_KPI_ARCHIVE_CASES_INCOMPLETE';
  END IF;
END
$archive_cases$;

SELECT jsonb_build_object(
  'count', (SELECT count(*) FROM pg_temp.home_kpi_archive_cases),
  'cases', (SELECT jsonb_agg(name ORDER BY name) FROM pg_temp.home_kpi_archive_cases)
);
ROLLBACK;
