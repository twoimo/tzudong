-- Approved restaurant refresh history and candidate snapshots.
-- The tables are append-first audit stores: external/latest data candidates are
-- recorded separately from operator decisions and guarded restaurant updates.

CREATE TABLE IF NOT EXISTS public.restaurant_refresh_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  run_type text NOT NULL DEFAULT 'manual_check',
  status text NOT NULL DEFAULT 'pending',
  requested_by_admin_id uuid,
  query jsonb NOT NULL DEFAULT '{}'::jsonb,
  source_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_refresh_runs_run_type_check CHECK (
    run_type IN ('manual_check', 'scheduled_check', 'external_search', 'readback_recrawl')
  ),
  CONSTRAINT restaurant_refresh_runs_status_check CHECK (
    status IN ('pending', 'running', 'completed', 'failed', 'cancelled')
  )
);

CREATE TABLE IF NOT EXISTS public.restaurant_refresh_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id uuid NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.restaurant_refresh_runs(id) ON DELETE SET NULL,
  candidate_status text NOT NULL DEFAULT 'needs_review',
  detected_change_types text[] NOT NULL DEFAULT ARRAY[]::text[],
  previous_snapshot jsonb NOT NULL,
  candidate_snapshot jsonb NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  operator_decision text,
  operator_notes text,
  decided_by_admin_id uuid,
  decided_at timestamptz,
  applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restaurant_refresh_candidates_status_check CHECK (
    candidate_status IN ('needs_review', 'approved', 'rejected', 'applied', 'superseded')
  ),
  CONSTRAINT restaurant_refresh_candidates_decision_check CHECK (
    operator_decision IS NULL OR operator_decision IN ('approved', 'rejected', 'superseded')
  ),
  CONSTRAINT restaurant_refresh_candidates_applied_requires_decision_check CHECK (
    candidate_status <> 'applied' OR (operator_decision = 'approved' AND decided_at IS NOT NULL AND applied_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS restaurant_refresh_runs_restaurant_created_idx
  ON public.restaurant_refresh_runs (restaurant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS restaurant_refresh_runs_status_created_idx
  ON public.restaurant_refresh_runs (status, created_at DESC);

CREATE INDEX IF NOT EXISTS restaurant_refresh_candidates_status_created_idx
  ON public.restaurant_refresh_candidates (candidate_status, created_at DESC);

CREATE INDEX IF NOT EXISTS restaurant_refresh_candidates_restaurant_created_idx
  ON public.restaurant_refresh_candidates (restaurant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS restaurant_refresh_candidates_change_types_gin_idx
  ON public.restaurant_refresh_candidates USING gin (detected_change_types);

ALTER TABLE public.restaurant_refresh_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_refresh_candidates ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.restaurant_refresh_runs FROM anon, authenticated;
REVOKE ALL ON public.restaurant_refresh_candidates FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.restaurant_refresh_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.restaurant_refresh_candidates TO authenticated;

DROP POLICY IF EXISTS restaurant_refresh_runs_admin_select ON public.restaurant_refresh_runs;
CREATE POLICY restaurant_refresh_runs_admin_select
  ON public.restaurant_refresh_runs
  FOR SELECT
  TO authenticated
  USING (public.is_user_admin(auth.uid()));

DROP POLICY IF EXISTS restaurant_refresh_runs_admin_insert ON public.restaurant_refresh_runs;
CREATE POLICY restaurant_refresh_runs_admin_insert
  ON public.restaurant_refresh_runs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_user_admin(auth.uid()));

DROP POLICY IF EXISTS restaurant_refresh_runs_admin_update ON public.restaurant_refresh_runs;
CREATE POLICY restaurant_refresh_runs_admin_update
  ON public.restaurant_refresh_runs
  FOR UPDATE
  TO authenticated
  USING (public.is_user_admin(auth.uid()))
  WITH CHECK (public.is_user_admin(auth.uid()));

DROP POLICY IF EXISTS restaurant_refresh_candidates_admin_select ON public.restaurant_refresh_candidates;
CREATE POLICY restaurant_refresh_candidates_admin_select
  ON public.restaurant_refresh_candidates
  FOR SELECT
  TO authenticated
  USING (public.is_user_admin(auth.uid()));

DROP POLICY IF EXISTS restaurant_refresh_candidates_admin_insert ON public.restaurant_refresh_candidates;
CREATE POLICY restaurant_refresh_candidates_admin_insert
  ON public.restaurant_refresh_candidates
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_user_admin(auth.uid()));

DROP POLICY IF EXISTS restaurant_refresh_candidates_admin_update ON public.restaurant_refresh_candidates;
CREATE POLICY restaurant_refresh_candidates_admin_update
  ON public.restaurant_refresh_candidates
  FOR UPDATE
  TO authenticated
  USING (public.is_user_admin(auth.uid()))
  WITH CHECK (public.is_user_admin(auth.uid()));

COMMENT ON TABLE public.restaurant_refresh_runs IS 'Admin-visible refresh attempts for approved restaurants; records source snapshots and query context.';
COMMENT ON TABLE public.restaurant_refresh_candidates IS 'Immutable-ish candidate snapshots for restaurant freshness changes; operator decisions and guarded apply timestamps are tracked separately.';
