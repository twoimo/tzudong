-- Paired with sponsorship_revision_before.sql and the exact new revision SQL.
SET LOCAL ROLE service_role;
DO $revision_invalidation_assertions$
DECLARE prior_revision text:=pg_catalog.current_setting('tzudong.test_revision_before');
  next_revision text:=public.admin_evaluation_revision(); page jsonb;
BEGIN
  IF current_user<>'service_role' OR (SELECT rolsuper FROM pg_roles WHERE rolname=current_user)
  THEN RAISE EXCEPTION 'SPONSORSHIP_REVISION_TRUE_SERVICE_ROLE'; END IF;
  IF next_revision::bigint IS DISTINCT FROM prior_revision::bigint+1
  THEN RAISE EXCEPTION 'SPONSORSHIP_REVISION_NOT_ADVANCED_ONCE'; END IF;
  BEGIN
    PERFORM public.admin_evaluation_page('{"searchQuery":"","evalFilters":{},"deepLinkFilter":null}',1,NULL,prior_revision);
    RAISE EXCEPTION 'SPONSORSHIP_REVISION_OLD_CURSOR_ACCEPTED';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM<>'EVALUATION_CURSOR_STALE' THEN RAISE; END IF;
  END;
  page:=public.admin_evaluation_page('{"searchQuery":"","evalFilters":{},"deepLinkFilter":null}',1,NULL,next_revision);
  IF page->>'revision' IS DISTINCT FROM next_revision
  THEN RAISE EXCEPTION 'SPONSORSHIP_REVISION_NEW_CURSOR_REJECTED'; END IF;
END
$revision_invalidation_assertions$;
SELECT jsonb_build_object('marker','revision_plus_one_old_cursor_denied_new_cursor_accepted','role',current_user);
ROLLBACK TO SAVEPOINT sponsorship_revision_fixture;
