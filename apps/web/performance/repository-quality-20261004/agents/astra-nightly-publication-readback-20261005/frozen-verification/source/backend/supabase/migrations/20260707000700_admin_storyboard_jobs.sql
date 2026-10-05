-- Admin storyboard async job control-plane records.
-- Heavy storyboard generation is claimed/finalized by backend/local workers, not inline Next route handlers.

create table if not exists public.admin_storyboard_jobs (
  id uuid primary key default gen_random_uuid(),
  requested_by_admin_id uuid not null,
  status text not null default 'queued' check (status in ('queued', 'claimed', 'succeeded', 'failed', 'cancelled')),
  stage text not null default 'queued',
  request_payload jsonb not null default '{}'::jsonb,
  result_payload jsonb,
  error_code text,
  readiness jsonb not null default '{"status":"queued","providerCache":"bypass","fallbackReasonCode":"storyboard_async_worker_pending"}'::jsonb,
  claimed_by text,
  claimed_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default timezone('utc'::text, now()),
  updated_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists admin_storyboard_jobs_requested_created_idx
  on public.admin_storyboard_jobs (requested_by_admin_id, created_at desc, id desc);

create index if not exists admin_storyboard_jobs_status_created_idx
  on public.admin_storyboard_jobs (status, created_at asc, id asc);

alter table public.admin_storyboard_jobs enable row level security;

revoke all on table public.admin_storyboard_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.admin_storyboard_jobs to service_role;

drop policy if exists admin_storyboard_jobs_service_role_all on public.admin_storyboard_jobs;
create policy admin_storyboard_jobs_service_role_all
  on public.admin_storyboard_jobs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
