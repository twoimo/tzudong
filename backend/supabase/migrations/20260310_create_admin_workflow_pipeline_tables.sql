-- Admin workflow pipeline ledger (runs/steps/signals)

create extension if not exists pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_workflow_trigger_source') THEN
    CREATE TYPE public.admin_workflow_trigger_source AS ENUM ('schedule', 'manual_admin');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_workflow_correlation_state') THEN
    CREATE TYPE public.admin_workflow_correlation_state AS ENUM (
      'pending_dispatch',
      'dispatched_unmatched',
      'matched',
      'reconciled_timeout',
      'reconciled_error',
      'completed'
    );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'admin_workflow_step_status') THEN
    CREATE TYPE public.admin_workflow_step_status AS ENUM (
      'queued',
      'running',
      'success',
      'failed',
      'timeout',
      'partial',
      'skipped'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.admin_workflow_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_request_id text UNIQUE NOT NULL,
  correlation_key text,
  trigger_source public.admin_workflow_trigger_source NOT NULL,
  requested_by_user_id uuid NULL,
  channel_url_raw text,
  channel_url_normalized text,
  channel_slug text,
  channel_id text,
  workflow_file text NOT NULL DEFAULT 'daily-crawler.yml',
  workflow_ref text NOT NULL DEFAULT 'data',
  github_workflow_id bigint,
  github_run_id bigint,
  github_run_number integer,
  github_run_attempt integer,
  github_status text,
  github_conclusion text,
  correlation_state public.admin_workflow_correlation_state NOT NULL DEFAULT 'pending_dispatch',
  requested_at timestamptz NOT NULL DEFAULT now(),
  dispatched_at timestamptz,
  matched_at timestamptz,
  completed_at timestamptz,
  dedupe_of_run_id uuid REFERENCES public.admin_workflow_runs(run_id),
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_workflow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.admin_workflow_runs(run_id) ON DELETE CASCADE,
  canonical_step_no integer NOT NULL CHECK (canonical_step_no BETWEEN 1 AND 12),
  canonical_step_key text NOT NULL,
  script_step_label text,
  status public.admin_workflow_step_status NOT NULL DEFAULT 'queued',
  started_at timestamptz,
  ended_at timestamptz,
  duration_ms bigint,
  message text,
  row_delta jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempt integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(run_id, canonical_step_no)
);

CREATE TABLE IF NOT EXISTS public.admin_workflow_signals (
  id bigint generated always as identity PRIMARY KEY,
  run_id uuid REFERENCES public.admin_workflow_runs(run_id) ON DELETE CASCADE,
  signal_type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_workflow_runs_requested_at ON public.admin_workflow_runs(requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_workflow_runs_state ON public.admin_workflow_runs(correlation_state, github_status);
CREATE INDEX IF NOT EXISTS idx_admin_workflow_runs_channel ON public.admin_workflow_runs(channel_slug, requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_workflow_steps_run ON public.admin_workflow_steps(run_id, canonical_step_no);
CREATE INDEX IF NOT EXISTS idx_admin_workflow_steps_status ON public.admin_workflow_steps(status, run_id);
CREATE INDEX IF NOT EXISTS idx_admin_workflow_signals_run ON public.admin_workflow_signals(run_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.touch_admin_workflow_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS admin_workflow_runs_updated_at_trigger ON public.admin_workflow_runs;
CREATE TRIGGER admin_workflow_runs_updated_at_trigger
  BEFORE UPDATE ON public.admin_workflow_runs
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_admin_workflow_updated_at();

DROP TRIGGER IF EXISTS admin_workflow_steps_updated_at_trigger ON public.admin_workflow_steps;
CREATE TRIGGER admin_workflow_steps_updated_at_trigger
  BEFORE UPDATE ON public.admin_workflow_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_admin_workflow_updated_at();

ALTER TABLE public.admin_workflow_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_workflow_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_workflow_signals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_workflow_runs_select_admin ON public.admin_workflow_runs;
CREATE POLICY admin_workflow_runs_select_admin
  ON public.admin_workflow_runs
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = (SELECT auth.uid()) AND ur.role = 'admin'
    )
  );

DROP POLICY IF EXISTS admin_workflow_steps_select_admin ON public.admin_workflow_steps;
CREATE POLICY admin_workflow_steps_select_admin
  ON public.admin_workflow_steps
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = (SELECT auth.uid()) AND ur.role = 'admin'
    )
  );

DROP POLICY IF EXISTS admin_workflow_signals_select_admin ON public.admin_workflow_signals;
CREATE POLICY admin_workflow_signals_select_admin
  ON public.admin_workflow_signals
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = (SELECT auth.uid()) AND ur.role = 'admin'
    )
  );

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_workflow_runs;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.admin_workflow_steps;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;
