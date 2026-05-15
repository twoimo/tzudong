-- Tighten admin user-management table privileges after RLS objects are created.
-- RLS remains the row-level guard, but table-level grants should expose only the
-- operations each role actually needs through the Data API.

REVOKE ALL ON public.user_roles FROM anon, authenticated;
GRANT SELECT ON public.user_roles TO authenticated;

REVOKE ALL ON public.user_account_status FROM anon, authenticated;
GRANT SELECT ON public.user_account_status TO authenticated;

REVOKE ALL ON public.admin_user_preferences FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.admin_user_preferences TO authenticated;

REVOKE ALL ON public.admin_audit_events FROM anon, authenticated;
GRANT SELECT ON public.admin_audit_events TO authenticated;

NOTIFY pgrst, 'reload schema';
