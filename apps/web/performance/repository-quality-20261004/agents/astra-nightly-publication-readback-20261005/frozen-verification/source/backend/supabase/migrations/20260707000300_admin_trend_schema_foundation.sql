-- Admin-only trend signal schema foundation for proposal-only automation.
-- Public clients must not receive direct table grants; guarded admin APIs use service_role only.

create table if not exists public.admin_trend_signal_runs (
  id uuid primary key default gen_random_uuid(),
  run_kind text not null check (run_kind in ('scheduled', 'manual_request', 'backfill', 'dry_run')),
  status text not null check (status in ('running', 'succeeded', 'failed', 'partial', 'cancelled')),
  source_profile text not null,
  started_at timestamptz not null default timezone('utc'::text, now()),
  completed_at timestamptz null,
  created_by_admin_id uuid null references auth.users(id) on delete set null,
  input_window jsonb not null default '{}'::jsonb,
  rate_limit_summary jsonb not null default '{}'::jsonb,
  provider_status jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  error_code text null,
  constraint admin_trend_signal_runs_completed_after_started_check
    check (completed_at is null or completed_at >= started_at)
);

create table if not exists public.admin_trend_signal_observations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.admin_trend_signal_runs(id) on delete cascade,
  source_type text not null check (source_type in ('youtube_kpi', 'web_search', 'seasonal_rule', 'internal_search_rank', 'review_activity')),
  restaurant_id uuid null references public.restaurants(id) on delete set null,
  video_id text null,
  observed_at timestamptz not null,
  signal_key text not null check (char_length(trim(signal_key)) between 1 and 120),
  signal_value numeric null,
  raw_excerpt text null check (raw_excerpt is null or char_length(raw_excerpt) <= 500),
  source_url text null check (source_url is null or char_length(source_url) <= 2048),
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create table if not exists public.admin_restaurant_map_overlay_proposals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.admin_trend_signal_runs(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  overlay_type text not null check (overlay_type in ('trend', 'seasonal')),
  proposal_status text not null default 'pending' check (proposal_status in ('pending', 'approved', 'rejected', 'superseded', 'expired')),
  label text not null check (char_length(trim(label)) between 1 and 80),
  description text null check (description is null or char_length(description) <= 500),
  active_from timestamptz null,
  active_until timestamptz null,
  score numeric not null check (score >= 0 and score <= 100),
  score_breakdown jsonb not null,
  evidence jsonb not null,
  proposal_hash text not null check (proposal_hash ~ '^[0-9a-f]{64}$'),
  supersedes_proposal_id uuid null references public.admin_restaurant_map_overlay_proposals(id) on delete set null,
  reviewed_by_admin_id uuid null references auth.users(id) on delete set null,
  reviewed_at timestamptz null,
  review_reason text null,
  overlay_audit_id uuid null,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint admin_restaurant_map_overlay_proposals_active_window_check
    check (active_from is null or active_until is null or active_from <= active_until),
  unique (restaurant_id, overlay_type, proposal_hash)
);

create table if not exists public.admin_trend_job_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by_admin_id uuid not null references auth.users(id) on delete restrict,
  request_kind text not null check (request_kind in ('trend_proposal_run', 'dry_run')),
  status text not null default 'queued' check (status in ('queued', 'claimed', 'succeeded', 'failed', 'cancelled')),
  parameters jsonb not null default '{}'::jsonb,
  parameters_hash text not null check (parameters_hash ~ '^[0-9a-f]{64}$'),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  correlation_id uuid not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  claimed_by text null check (claimed_by is null or char_length(trim(claimed_by)) between 1 and 120),
  claimed_at timestamptz null,
  completed_at timestamptz null,
  run_id uuid null references public.admin_trend_signal_runs(id) on delete set null,
  error_code text null,
  result_summary jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now()),
  constraint admin_trend_job_requests_completed_after_claimed_check
    check (completed_at is null or claimed_at is null or completed_at >= claimed_at),
  unique (requested_by_admin_id, idempotency_key)
);

create table if not exists public.admin_restaurant_map_overlay_proposal_review_events (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.admin_restaurant_map_overlay_proposals(id) on delete restrict,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  transition text not null check (transition in ('rejected', 'superseded', 'expired')),
  from_status text not null,
  to_status text not null check (to_status in ('rejected', 'superseded', 'expired')),
  reason text not null check (btrim(reason) <> ''),
  correlation_id uuid not null,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 128),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  proposal_hash text not null check (proposal_hash ~ '^[0-9a-f]{64}$'),
  request_metadata jsonb not null default '{}'::jsonb,
  reviewed_by_admin_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default timezone('utc'::text, now()),
  unique (actor_user_id, idempotency_key)
);

create index if not exists admin_trend_signal_runs_status_started_idx
  on public.admin_trend_signal_runs (status, started_at desc);

create index if not exists admin_trend_signal_runs_source_profile_idx
  on public.admin_trend_signal_runs (source_profile, started_at desc);

create index if not exists admin_trend_signal_observations_run_id_idx
  on public.admin_trend_signal_observations (run_id);

create index if not exists admin_trend_signal_observations_restaurant_observed_idx
  on public.admin_trend_signal_observations (restaurant_id, observed_at desc)
  where restaurant_id is not null;

create index if not exists admin_trend_signal_observations_source_signal_idx
  on public.admin_trend_signal_observations (source_type, signal_key);

create index if not exists admin_restaurant_map_overlay_proposals_status_created_idx
  on public.admin_restaurant_map_overlay_proposals (proposal_status, created_at desc, id desc);

create index if not exists admin_restaurant_map_overlay_proposals_restaurant_status_idx
  on public.admin_restaurant_map_overlay_proposals (restaurant_id, overlay_type, proposal_status, created_at desc);

create index if not exists admin_trend_job_requests_status_created_idx
  on public.admin_trend_job_requests (status, created_at desc);

create index if not exists admin_trend_job_requests_correlation_idx
  on public.admin_trend_job_requests (correlation_id);

create index if not exists admin_restaurant_map_overlay_proposal_review_events_proposal_id_idx
  on public.admin_restaurant_map_overlay_proposal_review_events (proposal_id, created_at desc);

create index if not exists admin_restaurant_map_overlay_proposal_review_events_actor_created_idx
  on public.admin_restaurant_map_overlay_proposal_review_events (actor_user_id, created_at desc);

alter table public.admin_trend_signal_runs enable row level security;
alter table public.admin_trend_signal_observations enable row level security;
alter table public.admin_restaurant_map_overlay_proposals enable row level security;
alter table public.admin_trend_job_requests enable row level security;
alter table public.admin_restaurant_map_overlay_proposal_review_events enable row level security;

revoke all on table public.admin_trend_signal_runs from public, anon, authenticated;
revoke all on table public.admin_trend_signal_observations from public, anon, authenticated;
revoke all on table public.admin_restaurant_map_overlay_proposals from public, anon, authenticated;
revoke all on table public.admin_trend_job_requests from public, anon, authenticated;
revoke all on table public.admin_restaurant_map_overlay_proposal_review_events from public, anon, authenticated;

grant select, insert, update on table public.admin_trend_signal_runs to service_role;
grant select, insert, update on table public.admin_trend_signal_observations to service_role;
grant select, insert, update on table public.admin_restaurant_map_overlay_proposals to service_role;
grant select, insert, update on table public.admin_trend_job_requests to service_role;
grant select, insert on table public.admin_restaurant_map_overlay_proposal_review_events to service_role;

create or replace function public.set_admin_trend_schema_foundation_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = timezone('utc'::text, now());
  return new;
end;
$$;

drop trigger if exists set_admin_restaurant_map_overlay_proposals_updated_at on public.admin_restaurant_map_overlay_proposals;
create trigger set_admin_restaurant_map_overlay_proposals_updated_at
before update on public.admin_restaurant_map_overlay_proposals
for each row
execute function public.set_admin_trend_schema_foundation_updated_at();

drop trigger if exists set_admin_trend_job_requests_updated_at on public.admin_trend_job_requests;
create trigger set_admin_trend_job_requests_updated_at
before update on public.admin_trend_job_requests
for each row
execute function public.set_admin_trend_schema_foundation_updated_at();
