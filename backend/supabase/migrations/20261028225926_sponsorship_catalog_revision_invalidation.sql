-- Run in the same installation transaction as the sponsorship descriptor rebuild.
-- The restaurant revision trigger does not run for direct derived-index writes.
-- Advancing this singleton invalidates cached pages and revision-bound cursors.
DO $sponsorship_catalog_revision$
DECLARE changed_rows bigint;
BEGIN
  UPDATE pipeline_control.admin_evaluation_catalog_revision
  SET revision = revision + 1
  WHERE singleton;
  GET DIAGNOSTICS changed_rows = ROW_COUNT;
  IF changed_rows <> 1 THEN
    RAISE EXCEPTION 'SPONSORSHIP_CATALOG_REVISION_UNAVAILABLE';
  END IF;
END
$sponsorship_catalog_revision$;
