CREATE TABLE IF NOT EXISTS public.restaurant_admin_destructive_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('soft_delete_restaurant')),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  target_restaurant_ids uuid[] NOT NULL CHECK (array_length(target_restaurant_ids, 1) > 0),
  before_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  after_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  correlation_id uuid NOT NULL UNIQUE,
  request_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'failed')),
  error_code text,
  applied_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS restaurant_admin_destructive_audit_events_actor_idx
  ON public.restaurant_admin_destructive_audit_events (actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS restaurant_admin_destructive_audit_events_target_ids_idx
  ON public.restaurant_admin_destructive_audit_events USING gin (target_restaurant_ids);

ALTER TABLE public.restaurant_admin_destructive_audit_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.restaurant_admin_destructive_audit_events FROM public, anon, authenticated;
GRANT SELECT, INSERT ON public.restaurant_admin_destructive_audit_events TO service_role;

CREATE OR REPLACE FUNCTION public.apply_restaurant_admin_destructive_action(
  p_actor_user_id uuid,
  p_action text,
  p_reason text,
  p_target_restaurant_ids uuid[],
  p_correlation_id uuid,
  p_request_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_target_ids uuid[];
  v_before_snapshot jsonb;
  v_after_snapshot jsonb;
  v_audit_id uuid;
  v_locked_count integer;
BEGIN
  IF auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = '42501';
  END IF;

  IF p_actor_user_id IS NULL THEN
    RAISE EXCEPTION 'actor user id is required' USING ERRCODE = '22023';
  END IF;

  IF p_action NOT IN ('soft_delete_restaurant') THEN
    RAISE EXCEPTION 'unsupported restaurant destructive action' USING ERRCODE = '22023';
  END IF;

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT target_id ORDER BY target_id)
  INTO v_target_ids
  FROM unnest(p_target_restaurant_ids) AS target_id
  WHERE target_id IS NOT NULL;

  IF v_target_ids IS NULL OR array_length(v_target_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'target restaurant ids are required' USING ERRCODE = '22023';
  END IF;

  WITH locked_targets AS (
    SELECT r.*
    FROM public.restaurants r
    WHERE r.id = ANY(v_target_ids)
    ORDER BY r.id
    FOR UPDATE
  )
  SELECT count(*), COALESCE(jsonb_agg(to_jsonb(locked_targets) ORDER BY locked_targets.id), '[]'::jsonb)
  INTO v_locked_count, v_before_snapshot
  FROM locked_targets;

  IF v_locked_count <> array_length(v_target_ids, 1) THEN
    RAISE EXCEPTION 'one or more target restaurants were not found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.restaurants
  SET status = 'deleted',
      updated_at = now(),
      updated_by_admin_id = p_actor_user_id
  WHERE id = ANY(v_target_ids);

  SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.id), '[]'::jsonb)
  INTO v_after_snapshot
  FROM public.restaurants r
  WHERE r.id = ANY(v_target_ids);

  INSERT INTO public.restaurant_admin_destructive_audit_events (
    actor_user_id,
    action,
    reason,
    target_restaurant_ids,
    before_snapshot,
    after_snapshot,
    correlation_id,
    request_metadata,
    status,
    applied_at
  )
  VALUES (
    p_actor_user_id,
    p_action,
    btrim(p_reason),
    v_target_ids,
    v_before_snapshot,
    v_after_snapshot,
    p_correlation_id,
    COALESCE(p_request_metadata, '{}'::jsonb),
    'applied',
    now()
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'audit_id', v_audit_id,
    'correlation_id', p_correlation_id,
    'target_restaurant_ids', v_target_ids,
    'deleted_target_ids', v_target_ids,
    'status', 'applied'
  );
EXCEPTION
  WHEN OTHERS THEN
    RAISE;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_restaurant_admin_destructive_action(uuid, text, text, uuid[], uuid, jsonb) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_restaurant_admin_destructive_action(uuid, text, text, uuid[], uuid, jsonb) TO service_role;

NOTIFY pgrst, 'reload schema';
