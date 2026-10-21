-- Local apply connects as supabase_admin, so these new functions would be
-- owned by supabase_admin. The service RPC registry admits only postgres or
-- privacy_workflow_owner. Hosted replay creates the same functions as postgres.
BEGIN;
ALTER FUNCTION public.record_app_web_vitals(text, text, text, text, smallint) OWNER TO postgres;
ALTER FUNCTION public.record_app_web_vitals_bounded(text, text, text, text, smallint) OWNER TO postgres;
COMMIT;
