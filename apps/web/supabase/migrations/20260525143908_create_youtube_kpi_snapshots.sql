-- Store lightweight YouTube KPI snapshots for sub-day admin dashboard deltas.
-- Writes are service-role only; admin reads go through server routes.

create table if not exists public.youtube_channel_kpi_snapshots (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null,
  channel_title text,
  channel_handle text,
  subscriber_count bigint,
  view_count bigint,
  video_count integer,
  hidden_subscriber_count boolean not null default false,
  bucket_started_at timestamptz not null,
  fetched_at timestamptz not null default timezone('utc', now()),
  source text not null default 'youtube-data-api',
  constraint youtube_channel_kpi_snapshots_bucket_unique unique (channel_id, bucket_started_at),
  constraint youtube_channel_kpi_snapshots_non_negative_counts check (
    (subscriber_count is null or subscriber_count >= 0)
    and (view_count is null or view_count >= 0)
    and (video_count is null or video_count >= 0)
  )
);

create index if not exists youtube_channel_kpi_snapshots_latest_idx
  on public.youtube_channel_kpi_snapshots (channel_id, bucket_started_at desc);

alter table public.youtube_channel_kpi_snapshots enable row level security;

revoke all on table public.youtube_channel_kpi_snapshots from public;
revoke all on table public.youtube_channel_kpi_snapshots from anon;
revoke all on table public.youtube_channel_kpi_snapshots from authenticated;
grant select, insert, update, delete on table public.youtube_channel_kpi_snapshots to service_role;

create table if not exists public.youtube_video_kpi_snapshots (
  id uuid primary key default gen_random_uuid(),
  video_id text not null,
  channel_id text not null,
  title text not null default '제목 없음',
  published_at timestamptz,
  category_id text,
  duration_seconds integer not null default 0 check (duration_seconds >= 0),
  view_count bigint not null default 0 check (view_count >= 0),
  like_count bigint not null default 0 check (like_count >= 0),
  comment_count bigint not null default 0 check (comment_count >= 0),
  bucket_started_at timestamptz not null,
  fetched_at timestamptz not null default timezone('utc', now()),
  source text not null default 'youtube-data-api',
  constraint youtube_video_kpi_snapshots_bucket_unique unique (video_id, bucket_started_at)
);

create index if not exists youtube_video_kpi_snapshots_latest_idx
  on public.youtube_video_kpi_snapshots (bucket_started_at desc, published_at desc);

create index if not exists youtube_video_kpi_snapshots_bucket_views_idx
  on public.youtube_video_kpi_snapshots (bucket_started_at desc, view_count desc, video_id);

create index if not exists youtube_video_kpi_snapshots_video_idx
  on public.youtube_video_kpi_snapshots (video_id, bucket_started_at desc);

create index if not exists youtube_video_kpi_snapshots_channel_idx
  on public.youtube_video_kpi_snapshots (channel_id, bucket_started_at desc);

alter table public.youtube_video_kpi_snapshots enable row level security;

revoke all on table public.youtube_video_kpi_snapshots from public;
revoke all on table public.youtube_video_kpi_snapshots from anon;
revoke all on table public.youtube_video_kpi_snapshots from authenticated;
grant select, insert, update, delete on table public.youtube_video_kpi_snapshots to service_role;
