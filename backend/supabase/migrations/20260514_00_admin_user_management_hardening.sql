-- Admin user-management DB hardening and baseline objects.
-- Created manually because Supabase CLI is not installed in this environment.

CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  username text,
  nickname text,
  avatar_url text,
  role text NOT NULL DEFAULT 'user',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.user_account_status (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  account_status text NOT NULL DEFAULT 'active' CHECK (account_status IN ('active', 'disabled')),
  disabled_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.user_account_status (user_id, account_status)
SELECT id, 'active'
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'user';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_allowed_check;

UPDATE public.profiles
SET role = 'user'
WHERE role IS NULL OR role NOT IN ('user', 'admin');

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_allowed_check CHECK (role IN ('user', 'admin'));

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_id_role_idx
  ON public.user_roles (user_id, role);

CREATE INDEX IF NOT EXISTS user_roles_admin_user_idx
  ON public.user_roles (user_id)
  WHERE role = 'admin';

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Authenticated clients may read only their own role rows; all writes stay server-only/service-role.
GRANT SELECT ON public.user_roles TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_roles FROM anon, authenticated;

DROP POLICY IF EXISTS user_roles_select_own ON public.user_roles;
CREATE POLICY user_roles_select_own
  ON public.user_roles
  FOR SELECT
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.prevent_profile_role_client_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.role <> 'user' AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'profiles.role can only be elevated by trusted server code';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.role IS DISTINCT FROM NEW.role AND auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'profiles.role can only be changed by trusted server code';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_prevent_role_client_change ON public.profiles;
CREATE TRIGGER profiles_prevent_role_client_change
  BEFORE INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_profile_role_client_change();

CREATE OR REPLACE FUNCTION public.prevent_last_admin_role_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  remaining_admin_count integer;
BEGIN
  IF OLD.role <> 'admin' THEN
    RETURN OLD;
  END IF;

  -- This lock is acquired inside the same transaction as the DELETE trigger,
  -- so the remaining-admin count and the role deletion are serialized together.
  PERFORM pg_advisory_xact_lock(hashtext('tzudong-admin-role-delete'));

  SELECT count(*)
  INTO remaining_admin_count
  FROM public.user_roles role_row
  LEFT JOIN public.user_account_status status_row
    ON status_row.user_id = role_row.user_id
  WHERE role_row.role = 'admin'
    AND role_row.user_id <> OLD.user_id
    AND coalesce(status_row.account_status, 'active') = 'active';

  IF remaining_admin_count < 1 THEN
    RAISE EXCEPTION 'last admin role cannot be removed';
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS user_roles_prevent_last_admin_delete ON public.user_roles;
CREATE TRIGGER user_roles_prevent_last_admin_delete
  BEFORE DELETE ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_admin_role_delete();

CREATE OR REPLACE FUNCTION public.prevent_last_admin_role_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  remaining_admin_count integer;
BEGIN
  IF OLD.role <> 'admin' OR NEW.role = 'admin' THEN
    RETURN NEW;
  END IF;

  -- Same-transaction serialization for service-role updates that move a row away from admin.
  PERFORM pg_advisory_xact_lock(hashtext('tzudong-admin-role-delete'));

  SELECT count(*)
  INTO remaining_admin_count
  FROM public.user_roles role_row
  LEFT JOIN public.user_account_status status_row
    ON status_row.user_id = role_row.user_id
  WHERE role_row.role = 'admin'
    AND role_row.user_id <> OLD.user_id
    AND coalesce(status_row.account_status, 'active') = 'active';

  IF remaining_admin_count < 1 THEN
    RAISE EXCEPTION 'last admin role cannot be removed';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_roles_prevent_last_admin_update ON public.user_roles;
CREATE TRIGGER user_roles_prevent_last_admin_update
  BEFORE UPDATE OF role ON public.user_roles
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_admin_role_update();

ALTER TABLE public.user_account_status ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.user_account_status TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.user_account_status FROM anon, authenticated;

DROP POLICY IF EXISTS user_account_status_select_own ON public.user_account_status;
CREATE POLICY user_account_status_select_own
  ON public.user_account_status
  FOR SELECT
  USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.prevent_last_active_admin_status_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  remaining_active_admin_count integer;
  target_is_admin boolean;
BEGIN
  IF NEW.account_status <> 'disabled' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.account_status = 'disabled' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = NEW.user_id
      AND role = 'admin'
  )
  INTO target_is_admin;

  IF NOT target_is_admin THEN
    RETURN NEW;
  END IF;

  -- Same-transaction serialization shared with admin-role removal triggers.
  PERFORM pg_advisory_xact_lock(hashtext('tzudong-admin-role-delete'));

  SELECT count(*)
  INTO remaining_active_admin_count
  FROM public.user_roles role_row
  LEFT JOIN public.user_account_status status_row
    ON status_row.user_id = role_row.user_id
  WHERE role_row.role = 'admin'
    AND role_row.user_id <> NEW.user_id
    AND coalesce(status_row.account_status, 'active') = 'active';

  IF remaining_active_admin_count < 1 THEN
    RAISE EXCEPTION 'last active admin account cannot be disabled';
  END IF;

  NEW.disabled_at = coalesce(NEW.disabled_at, now());
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS user_account_status_prevent_last_active_admin_disable ON public.user_account_status;
CREATE TRIGGER user_account_status_prevent_last_active_admin_disable
  BEFORE INSERT OR UPDATE OF account_status ON public.user_account_status
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_last_active_admin_status_change();

NOTIFY pgrst, 'reload schema';
