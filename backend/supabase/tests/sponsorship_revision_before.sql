-- Owned PG15 fixture only, inside an outer BEGIN/ROLLBACK. Execute the exact
-- revision invalidation migration between this file and its assertions file.
SAVEPOINT sponsorship_revision_fixture;
DO $revision_fixture_identity$
BEGIN
  IF current_database()<>'postgres' OR current_setting('server_version_num')<>'150008'
  THEN RAISE EXCEPTION 'SPONSORSHIP_REVISION_FIXTURE_DATABASE'; END IF;
END
$revision_fixture_identity$;
SELECT pg_catalog.set_config('tzudong.test_revision_target', :'revision_target'::uuid::text, true) AS target_setting,
       pg_catalog.set_config('tzudong.test_revision_before', public.admin_evaluation_revision(), true) AS revision_setting
\gset
DO $revision_direct_index_write$
DECLARE changed_rows bigint;
BEGIN
  UPDATE pipeline_control.admin_evaluation_read_index
  SET latest=coalesce(latest,0)+1
  WHERE id=pg_catalog.current_setting('tzudong.test_revision_target')::uuid;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows<>1 THEN RAISE EXCEPTION 'SPONSORSHIP_REVISION_FIXTURE_TARGET'; END IF;
  IF public.admin_evaluation_revision() IS DISTINCT FROM pg_catalog.current_setting('tzudong.test_revision_before')
  THEN RAISE EXCEPTION 'SPONSORSHIP_REVISION_BASELINE_CHANGED'; END IF;
END
$revision_direct_index_write$;
SET LOCAL ROLE service_role;
DO $revision_old_cursor_baseline$
DECLARE page jsonb;
BEGIN
  IF current_user<>'service_role' OR (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
  THEN RAISE EXCEPTION 'SPONSORSHIP_REVISION_TRUE_SERVICE_ROLE'; END IF;
  page:=public.admin_evaluation_page('{"searchQuery":"","evalFilters":{},"deepLinkFilter":null}',1,NULL,
    pg_catalog.current_setting('tzudong.test_revision_before'));
  IF page->>'revision' IS DISTINCT FROM pg_catalog.current_setting('tzudong.test_revision_before')
  THEN RAISE EXCEPTION 'SPONSORSHIP_REVISION_OLD_CURSOR_BASELINE'; END IF;
END
$revision_old_cursor_baseline$;
SELECT jsonb_build_object('marker','old_revision_accepted_after_direct_index_write','role',current_user);
SET LOCAL ROLE postgres;
