-- Persist per-bucket channel growth deltas so subscriber increases are snapshotted.
-- Writes remain service-role only via the existing table grants/RLS policy surface.

alter table public.youtube_channel_kpi_snapshots
  add column if not exists previous_bucket_started_at timestamptz,
  add column if not exists subscriber_delta bigint,
  add column if not exists view_delta bigint,
  add column if not exists video_delta integer;

create index if not exists youtube_channel_kpi_snapshots_previous_bucket_idx
  on public.youtube_channel_kpi_snapshots (channel_id, previous_bucket_started_at desc)
  where previous_bucket_started_at is not null;

with ordered_snapshots as (
  select
    id,
    lag(bucket_started_at) over (
      partition by channel_id
      order by bucket_started_at
    ) as computed_previous_bucket_started_at,
    case
      when hidden_subscriber_count is true then null
      else subscriber_count - lag(subscriber_count) over (
        partition by channel_id
        order by bucket_started_at
      )
    end as computed_subscriber_delta,
    view_count - lag(view_count) over (
      partition by channel_id
      order by bucket_started_at
    ) as computed_view_delta,
    video_count - lag(video_count) over (
      partition by channel_id
      order by bucket_started_at
    ) as computed_video_delta
  from public.youtube_channel_kpi_snapshots
)
update public.youtube_channel_kpi_snapshots as snapshots
set
  previous_bucket_started_at = coalesce(
    snapshots.previous_bucket_started_at,
    ordered.computed_previous_bucket_started_at
  ),
  subscriber_delta = coalesce(
    snapshots.subscriber_delta,
    ordered.computed_subscriber_delta
  ),
  view_delta = coalesce(snapshots.view_delta, ordered.computed_view_delta),
  video_delta = coalesce(snapshots.video_delta, ordered.computed_video_delta)
from ordered_snapshots as ordered
where snapshots.id = ordered.id
  and ordered.computed_previous_bucket_started_at is not null;
