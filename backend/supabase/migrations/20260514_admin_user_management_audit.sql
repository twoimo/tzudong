-- Admin user-management audit trail.
-- Created manually because Supabase CLI is not installed in this environment.

CREATE TABLE IF NOT EXISTS public.admin_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  target_user_id uuid,
  action text NOT NULL CHECK (action IN (
    'admin_user_created',
    'admin_user_profile_updated',
    'admin_user_role_granted',
    'admin_user_role_revoked',
    'admin_user_disabled',
    'admin_user_reactivated'
  )),
  reason text,
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'intent' CHECK (status IN ('intent', 'applied', 'failed')),
  correlation_id uuid,
  applied_at timestamptz,
  error_code text,
  request_id text,
  ip_hash text,
  user_agent_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_audit_events ENABLE ROW LEVEL SECURITY;

-- Supabase Data API projects created after the 2026 grant-default change need explicit grants.
GRANT SELECT ON public.admin_audit_events TO authenticated;

DROP POLICY IF EXISTS admin_audit_events_select_admins ON public.admin_audit_events;
CREATE POLICY admin_audit_events_select_admins
  ON public.admin_audit_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  );

CREATE INDEX IF NOT EXISTS admin_audit_events_target_created_idx
  ON public.admin_audit_events (target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_audit_events_actor_created_idx
  ON public.admin_audit_events (actor_user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.apply_admin_user_db_mutation(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_reason text,
  p_before_state jsonb,
  p_after_state jsonb,
  p_correlation_id uuid,
  p_profile jsonb DEFAULT NULL,
  p_next_role text DEFAULT NULL,
  p_next_account_status text DEFAULT NULL,
  p_request_id text DEFAULT NULL,
  p_ip_hash text DEFAULT NULL,
  p_user_agent_hash text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  applied_audit_id uuid;
BEGIN
  IF p_action NOT IN (
    'admin_user_profile_updated',
    'admin_user_role_granted',
    'admin_user_role_revoked',
    'admin_user_disabled',
    'admin_user_reactivated'
  ) THEN
    RAISE EXCEPTION 'unsupported admin user mutation action: %', p_action;
  END IF;

  IF p_profile IS NOT NULL THEN
    INSERT INTO public.profiles (
      user_id,
      username,
      nickname,
      avatar_url,
      role,
      updated_at
    )
    VALUES (
      p_target_user_id,
      NULLIF(BTRIM(p_profile->>'username'), ''),
      NULLIF(BTRIM(p_profile->>'nickname'), ''),
      NULLIF(BTRIM(p_profile->>'avatar_url'), ''),
      COALESCE(
        (SELECT role FROM public.profiles WHERE user_id = p_target_user_id),
        CASE
          WHEN EXISTS (
            SELECT 1 FROM public.user_roles WHERE user_id = p_target_user_id AND role = 'admin'
          )
          THEN 'admin'
          ELSE 'user'
        END
      ),
      now()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET username = EXCLUDED.username,
        nickname = EXCLUDED.nickname,
        avatar_url = EXCLUDED.avatar_url,
        updated_at = now();
  END IF;

  IF p_next_role IS NOT NULL THEN
    IF p_next_role NOT IN ('admin', 'user') THEN
      RAISE EXCEPTION 'unsupported admin user role: %', p_next_role;
    END IF;

    IF p_next_role = 'admin' THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (p_target_user_id, 'admin')
      ON CONFLICT (user_id, role) DO NOTHING;
    ELSE
      DELETE FROM public.user_roles
      WHERE user_id = p_target_user_id
        AND role = 'admin';
    END IF;

    INSERT INTO public.profiles (
      user_id,
      username,
      nickname,
      avatar_url,
      role,
      updated_at
    )
    VALUES (
      p_target_user_id,
      COALESCE((SELECT username FROM public.profiles WHERE user_id = p_target_user_id), 'unknown'),
      COALESCE((SELECT nickname FROM public.profiles WHERE user_id = p_target_user_id), '닉네임 없음'),
      (SELECT avatar_url FROM public.profiles WHERE user_id = p_target_user_id),
      p_next_role,
      now()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET role = EXCLUDED.role,
        updated_at = now();
  END IF;

  IF p_next_account_status IS NOT NULL THEN
    IF p_next_account_status NOT IN ('active', 'disabled') THEN
      RAISE EXCEPTION 'unsupported admin user account status: %', p_next_account_status;
    END IF;

    INSERT INTO public.user_account_status (
      user_id,
      account_status,
      disabled_at,
      updated_at
    )
    VALUES (
      p_target_user_id,
      p_next_account_status,
      CASE WHEN p_next_account_status = 'disabled' THEN now() ELSE NULL END,
      now()
    )
    ON CONFLICT (user_id) DO UPDATE
    SET account_status = EXCLUDED.account_status,
        disabled_at = EXCLUDED.disabled_at,
        updated_at = now();
  END IF;

  INSERT INTO public.admin_audit_events (
    actor_user_id,
    target_user_id,
    action,
    reason,
    before_state,
    after_state,
    status,
    correlation_id,
    applied_at,
    request_id,
    ip_hash,
    user_agent_hash
  )
  VALUES (
    p_actor_user_id,
    p_target_user_id,
    p_action,
    p_reason,
    COALESCE(p_before_state, '{}'::jsonb),
    COALESCE(p_after_state, '{}'::jsonb),
    'applied',
    p_correlation_id,
    now(),
    p_request_id,
    p_ip_hash,
    p_user_agent_hash
  )
  RETURNING id INTO applied_audit_id;

  RETURN applied_audit_id;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_admin_user_db_mutation(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  jsonb,
  text,
  text,
  text,
  text,
  text
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.apply_admin_user_db_mutation(
  uuid,
  uuid,
  text,
  text,
  jsonb,
  jsonb,
  uuid,
  jsonb,
  text,
  text,
  text,
  text,
  text
) TO service_role;

NOTIFY pgrst, 'reload schema';
