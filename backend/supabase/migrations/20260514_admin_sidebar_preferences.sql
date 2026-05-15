-- Per-admin sidebar ordering preferences for the unified admin console.
-- Created manually because Supabase CLI is not installed in this environment.

CREATE TABLE IF NOT EXISTS public.admin_user_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preference_key text NOT NULL CHECK (char_length(preference_key) BETWEEN 1 AND 120),
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, preference_key)
);

ALTER TABLE public.admin_user_preferences ENABLE ROW LEVEL SECURITY;

-- Supabase Data API projects created after the 2026 grant-default change need explicit grants.
GRANT SELECT, INSERT, UPDATE ON public.admin_user_preferences TO authenticated;

DROP POLICY IF EXISTS admin_user_preferences_select_own_admin ON public.admin_user_preferences;
CREATE POLICY admin_user_preferences_select_own_admin
  ON public.admin_user_preferences
  FOR SELECT
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS admin_user_preferences_insert_own_admin ON public.admin_user_preferences;
CREATE POLICY admin_user_preferences_insert_own_admin
  ON public.admin_user_preferences
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  );

DROP POLICY IF EXISTS admin_user_preferences_update_own_admin ON public.admin_user_preferences;
CREATE POLICY admin_user_preferences_update_own_admin
  ON public.admin_user_preferences
  FOR UPDATE
  USING (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  );

CREATE INDEX IF NOT EXISTS admin_user_preferences_user_key_idx
  ON public.admin_user_preferences (user_id, preference_key);

CREATE OR REPLACE FUNCTION public.set_admin_user_preferences_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS admin_user_preferences_set_updated_at ON public.admin_user_preferences;
CREATE TRIGGER admin_user_preferences_set_updated_at
  BEFORE UPDATE ON public.admin_user_preferences
  FOR EACH ROW
  EXECUTE FUNCTION public.set_admin_user_preferences_updated_at();

NOTIFY pgrst, 'reload schema';
