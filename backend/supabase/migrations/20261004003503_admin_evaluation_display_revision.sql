-- Displayed counts/version timestamps must invalidate cached summaries.
-- Keep the applied revision trigger immutable and add the missing dependency.
BEGIN;
CREATE TRIGGER admin_evaluation_display_revision_after_write
AFTER UPDATE OF review_count,updated_at ON public.restaurants
FOR EACH STATEMENT EXECUTE FUNCTION pipeline_control.bump_admin_evaluation_revision();
COMMIT;
