import { createSupabaseServiceRoleClient } from '@/lib/supabase/service-role';
import type {
  InsightTreemapComparisonCoverage,
  InsightTreemapPeriod,
  InsightTreemapResponse,
  InsightTreemapVideoRow,
} from '@/lib/public-insights/treemap';

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const SNAPSHOT_PAGE_SIZE = 1000;

const snapshotPeriodToMilliseconds: Record<Exclude<InsightTreemapPeriod, 'ALL'>, number> = {
  '30MIN': 30 * MINUTE_MS,
  '1H': HOUR_MS,
  '6H': 6 * HOUR_MS,
  '12H': 12 * HOUR_MS,
  '1D': DAY_MS,
  '1W': 7 * DAY_MS,
  '2W': 14 * DAY_MS,
  '1M': 30 * DAY_MS,
  '3M': 91 * DAY_MS,
  '6M': 182 * DAY_MS,
  '1Y': 365 * DAY_MS,
};

type VideoSnapshotRow = {
  video_id: string;
  title: string | null;
  published_at: string | null;
  category_id: string | null;
  duration_seconds: number | string | null;
  view_count: number | string | null;
  like_count: number | string | null;
  comment_count: number | string | null;
  bucket_started_at: string;
  fetched_at: string | null;
};

type BucketRow = {
  bucket_started_at: string;
};

function toNonNegativeNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return 0;
}

function getPeriodDurationMs(period: InsightTreemapPeriod): number | null {
  if (period === 'ALL') return null;
  return snapshotPeriodToMilliseconds[period] ?? null;
}

function getPeriodCutoffIso(period: InsightTreemapPeriod): string | null {
  const durationMs = getPeriodDurationMs(period);
  if (!durationMs) return null;
  return new Date(Date.now() - durationMs).toISOString();
}

async function fetchLatestBucket(): Promise<string | null> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('youtube_video_kpi_snapshots')
    .select('bucket_started_at')
    .order('bucket_started_at', { ascending: false })
    .limit(1)
    .maybeSingle<BucketRow>();

  if (error) {
    console.warn('[youtube-kpi-snapshots] latest bucket unavailable:', error.message);
    return null;
  }

  return data?.bucket_started_at ?? null;
}

async function fetchComparisonBucket(
  latestBucket: string,
  period: InsightTreemapPeriod,
): Promise<string | null> {
  const durationMs = getPeriodDurationMs(period);
  if (!durationMs) return null;

  const latestMs = new Date(latestBucket).getTime();
  if (!Number.isFinite(latestMs)) return null;

  const targetIso = new Date(latestMs - durationMs).toISOString();
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('youtube_video_kpi_snapshots')
    .select('bucket_started_at')
    .lte('bucket_started_at', targetIso)
    .order('bucket_started_at', { ascending: false })
    .limit(1)
    .maybeSingle<BucketRow>();

  if (error) {
    console.warn('[youtube-kpi-snapshots] comparison bucket unavailable:', error.message);
    return null;
  }

  return data?.bucket_started_at ?? null;
}

async function fetchVideoSnapshotRows(
  bucketStartedAt: string,
  period: InsightTreemapPeriod,
  { filterByPublishedPeriod = true }: { filterByPublishedPeriod?: boolean } = {},
): Promise<VideoSnapshotRow[]> {
  const supabase = createSupabaseServiceRoleClient();
  const rows: VideoSnapshotRow[] = [];
  const cutoffIso = filterByPublishedPeriod ? getPeriodCutoffIso(period) : null;
  let page = 0;

  while (true) {
    const from = page * SNAPSHOT_PAGE_SIZE;
    const to = from + SNAPSHOT_PAGE_SIZE - 1;
    let query = supabase
      .from('youtube_video_kpi_snapshots')
      .select('video_id,title,published_at,category_id,duration_seconds,view_count,like_count,comment_count,bucket_started_at,fetched_at')
      .eq('bucket_started_at', bucketStartedAt)
      .order('view_count', { ascending: false });

    if (cutoffIso) {
      query = query.gte('published_at', cutoffIso);
    }

    const { data, error } = await query.range(from, to);
    if (error) throw new Error(`youtube-kpi-snapshot-videos:${error.message}`);

    if (data && data.length > 0) rows.push(...(data as VideoSnapshotRow[]));
    if (!data || data.length < SNAPSHOT_PAGE_SIZE) break;
    page += 1;
  }

  return rows;
}

async function fetchPreviousSnapshotMap(
  bucketStartedAt: string | null,
  videoIds: string[],
): Promise<Map<string, VideoSnapshotRow>> {
  if (!bucketStartedAt || videoIds.length === 0) return new Map();

  const supabase = createSupabaseServiceRoleClient();
  const result = new Map<string, VideoSnapshotRow>();
  const chunkSize = 200;

  for (let index = 0; index < videoIds.length; index += chunkSize) {
    const chunk = videoIds.slice(index, index + chunkSize);
    const { data, error } = await supabase
      .from('youtube_video_kpi_snapshots')
      .select('video_id,title,published_at,category_id,duration_seconds,view_count,like_count,comment_count,bucket_started_at,fetched_at')
      .eq('bucket_started_at', bucketStartedAt)
      .in('video_id', chunk);

    if (error) throw new Error(`youtube-kpi-snapshot-previous:${error.message}`);
    for (const row of (data ?? []) as VideoSnapshotRow[]) {
      result.set(row.video_id, row);
    }
  }

  return result;
}

function getSnapshotComparisonStatus(
  row: VideoSnapshotRow,
  previous: VideoSnapshotRow | undefined,
  comparisonBucketStartedAt: string | null,
): InsightTreemapVideoRow['comparisonStatus'] {
  if (!comparisonBucketStartedAt) return 'not_applicable';
  if (previous) return 'compared';

  const publishedAtMs = row.published_at ? new Date(row.published_at).getTime() : Number.NaN;
  const comparisonBucketMs = new Date(comparisonBucketStartedAt).getTime();

  if (Number.isFinite(publishedAtMs) && Number.isFinite(comparisonBucketMs) && publishedAtMs > comparisonBucketMs) {
    return 'new';
  }

  return 'missing_previous';
}

function mapSnapshotRowToVideo(
  row: VideoSnapshotRow,
  previous: VideoSnapshotRow | undefined,
  comparisonBucketStartedAt: string | null,
): InsightTreemapVideoRow {
  return {
    id: row.video_id,
    title: row.title?.trim() || '제목 없음',
    publishedAt: row.published_at,
    category: row.category_id ?? 'YouTube',
    viewCount: toNonNegativeNumber(row.view_count),
    likeCount: toNonNegativeNumber(row.like_count),
    commentCount: toNonNegativeNumber(row.comment_count),
    duration: Math.floor(toNonNegativeNumber(row.duration_seconds)),
    previousViewCount: previous ? toNonNegativeNumber(previous.view_count) : null,
    previousLikeCount: previous ? toNonNegativeNumber(previous.like_count) : null,
    previousCommentCount: previous ? toNonNegativeNumber(previous.comment_count) : null,
    previousDuration: previous ? Math.floor(toNonNegativeNumber(previous.duration_seconds)) : null,
    comparisonStatus: getSnapshotComparisonStatus(row, previous, comparisonBucketStartedAt),
  };
}

function buildSnapshotComparisonCoverage(
  rows: VideoSnapshotRow[],
  previousMap: Map<string, VideoSnapshotRow>,
  latestBucketStartedAt: string,
  comparisonBucketStartedAt: string | null,
): InsightTreemapComparisonCoverage {
  let newVideos = 0;
  let missingPreviousVideos = 0;

  for (const row of rows) {
    if (previousMap.has(row.video_id)) continue;

    const comparisonStatus = getSnapshotComparisonStatus(
      row,
      undefined,
      comparisonBucketStartedAt,
    );

    if (comparisonStatus === 'new') {
      newVideos += 1;
    } else if (comparisonStatus === 'missing_previous') {
      missingPreviousVideos += 1;
    }
  }

  return {
    latestBucketStartedAt,
    comparisonBucketStartedAt,
    totalVideos: rows.length,
    comparedVideos: previousMap.size,
    newVideos,
    missingPreviousVideos,
    comparisonAvailable: Boolean(comparisonBucketStartedAt && previousMap.size > 0),
  };
}

export async function getYouTubeKpiSnapshotData(
  period: InsightTreemapPeriod,
  options: { filterByPublishedPeriod?: boolean } = {},
): Promise<InsightTreemapResponse | null> {
  const latestBucket = await fetchLatestBucket();
  if (!latestBucket) return null;

  const rows = await fetchVideoSnapshotRows(latestBucket, period, options);
  if (rows.length === 0) return null;

  const comparisonBucket = await fetchComparisonBucket(latestBucket, period);
  const previousMap = await fetchPreviousSnapshotMap(
    comparisonBucket,
    rows.map((row) => row.video_id),
  );
  const videos = rows.map((row) =>
    mapSnapshotRowToVideo(row, previousMap.get(row.video_id), comparisonBucket),
  );
  const comparisonCoverage = buildSnapshotComparisonCoverage(
    rows,
    previousMap,
    latestBucket,
    comparisonBucket,
  );

  return {
    asOf: latestBucket,
    period,
    totalVideos: videos.length,
    videos,
    availablePeriods: [],
    meta: {
      dataSource: 'youtube-snapshot',
      latestBucketStartedAt: latestBucket,
      comparisonBucketStartedAt: comparisonBucket,
      comparisonCoverage,
    },
  };
}

export type YouTubeChannelKpiSnapshot = {
  channelId: string | null;
  title: string | null;
  handle: string | null;
  subscriberCount: number | null;
  viewCount: number | null;
  videoCount: number | null;
  hiddenSubscriberCount: boolean;
  fetchedAt: string;
  previousSubscriberCount?: number | null;
  previousViewCount?: number | null;
  previousVideoCount?: number | null;
  previousBucketStartedAt?: string | null;
  subscriberDelta?: number | null;
  viewDelta?: number | null;
  videoDelta?: number | null;
  comparisonFetchedAt?: string | null;
  deltaSource?: 'snapshot-delta' | 'derived-snapshot-comparison' | 'unavailable';
};

type ChannelSnapshotRow = {
  channel_id: string | null;
  channel_title: string | null;
  channel_handle: string | null;
  subscriber_count: number | string | null;
  view_count: number | string | null;
  video_count: number | string | null;
  hidden_subscriber_count: boolean | null;
  previous_bucket_started_at?: string | null;
  subscriber_delta?: number | string | null;
  view_delta?: number | string | null;
  video_delta?: number | string | null;
  bucket_started_at: string;
  fetched_at: string | null;
};

async function fetchLatestChannelSnapshotRow(): Promise<ChannelSnapshotRow | null> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('youtube_channel_kpi_snapshots')
    .select('channel_id,channel_title,channel_handle,subscriber_count,view_count,video_count,hidden_subscriber_count,previous_bucket_started_at,subscriber_delta,view_delta,video_delta,bucket_started_at,fetched_at')
    .order('bucket_started_at', { ascending: false })
    .limit(1)
    .maybeSingle<ChannelSnapshotRow>();

  if (error) {
    console.warn('[youtube-kpi-snapshots] latest channel snapshot unavailable:', error.message);
    return null;
  }

  return data ?? null;
}

async function fetchComparisonChannelSnapshotRow(
  latestBucket: string,
  period: InsightTreemapPeriod,
): Promise<ChannelSnapshotRow | null> {
  const durationMs = getPeriodDurationMs(period);
  if (!durationMs) return null;

  const latestMs = new Date(latestBucket).getTime();
  if (!Number.isFinite(latestMs)) return null;

  const targetIso = new Date(latestMs - durationMs).toISOString();
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('youtube_channel_kpi_snapshots')
    .select('channel_id,channel_title,channel_handle,subscriber_count,view_count,video_count,hidden_subscriber_count,previous_bucket_started_at,subscriber_delta,view_delta,video_delta,bucket_started_at,fetched_at')
    .lte('bucket_started_at', targetIso)
    .order('bucket_started_at', { ascending: false })
    .limit(1)
    .maybeSingle<ChannelSnapshotRow>();

  if (error) {
    console.warn('[youtube-kpi-snapshots] comparison channel snapshot unavailable:', error.message);
    return null;
  }

  return data ?? null;
}

function parseNullableFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getStoredOrDerivedDelta(
  storedDelta: unknown,
  currentValue: number | null,
  previousValue: number | null,
  { preferStoredDelta = false }: { preferStoredDelta?: boolean } = {},
) {
  const parsedStoredDelta = parseNullableFiniteNumber(storedDelta);
  if (preferStoredDelta && parsedStoredDelta != null) {
    return { value: parsedStoredDelta, source: 'snapshot-delta' as const };
  }

  if (typeof currentValue === 'number' && typeof previousValue === 'number') {
    return {
      value: currentValue - previousValue,
      source: 'derived-snapshot-comparison' as const,
    };
  }

  return { value: null, source: 'unavailable' as const };
}

function mapChannelSnapshotRow(
  data: ChannelSnapshotRow,
  previous?: ChannelSnapshotRow | null,
  { preferStoredDelta = false }: { preferStoredDelta?: boolean } = {},
): YouTubeChannelKpiSnapshot {
  const hiddenSubscriberCount = data.hidden_subscriber_count === true;
  const previousHiddenSubscriberCount = previous?.hidden_subscriber_count === true;
  const subscriberCount = hiddenSubscriberCount ? null : toNonNegativeNumber(data.subscriber_count);
  const previousSubscriberCount = previous
    ? previousHiddenSubscriberCount
      ? null
      : toNonNegativeNumber(previous.subscriber_count)
    : null;
  const viewCount = toNonNegativeNumber(data.view_count);
  const previousViewCount = previous ? toNonNegativeNumber(previous.view_count) : null;
  const videoCount = toNonNegativeNumber(data.video_count);
  const previousVideoCount = previous ? toNonNegativeNumber(previous.video_count) : null;
  const subscriberDelta = getStoredOrDerivedDelta(
    data.subscriber_delta,
    subscriberCount,
    previousSubscriberCount,
    { preferStoredDelta },
  );
  const viewDelta = getStoredOrDerivedDelta(
    data.view_delta,
    viewCount,
    previousViewCount,
    { preferStoredDelta },
  );
  const videoDelta = getStoredOrDerivedDelta(
    data.video_delta,
    videoCount,
    previousVideoCount,
    { preferStoredDelta },
  );

  return {
    channelId: data.channel_id,
    title: data.channel_title,
    handle: data.channel_handle,
    subscriberCount,
    viewCount,
    videoCount,
    hiddenSubscriberCount,
    fetchedAt: data.fetched_at ?? data.bucket_started_at,
    previousSubscriberCount,
    previousViewCount,
    previousVideoCount,
    previousBucketStartedAt: previous
      ? previous.bucket_started_at
      : preferStoredDelta
        ? data.previous_bucket_started_at ?? null
        : null,
    subscriberDelta: subscriberDelta.value,
    viewDelta: viewDelta.value,
    videoDelta: videoDelta.value,
    comparisonFetchedAt: previous ? previous.fetched_at ?? previous.bucket_started_at : null,
    deltaSource:
      subscriberDelta.source !== 'unavailable'
        ? subscriberDelta.source
        : viewDelta.source !== 'unavailable'
          ? viewDelta.source
          : videoDelta.source,
  };
}

export async function getLatestYouTubeChannelSnapshot(
  period: InsightTreemapPeriod = 'ALL',
): Promise<YouTubeChannelKpiSnapshot | null> {
  const latest = await fetchLatestChannelSnapshotRow();
  if (!latest) return null;

  const previous = await fetchComparisonChannelSnapshotRow(latest.bucket_started_at, period);
  return mapChannelSnapshotRow(latest, previous, {
    preferStoredDelta: period === 'ALL',
  });
}
