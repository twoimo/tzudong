create table if not exists public.admin_ai_leaderboard_snapshots (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('arena_ai')),
  leaderboard_config text not null,
  fetched_at timestamptz not null default timezone('utc', now()),
  candidate_models jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  created_by_admin_id uuid null references auth.users(id) on delete set null
);

create index if not exists admin_ai_leaderboard_snapshots_source_config_fetched_idx
  on public.admin_ai_leaderboard_snapshots (source, leaderboard_config, fetched_at desc);

alter table public.admin_ai_leaderboard_snapshots enable row level security;
