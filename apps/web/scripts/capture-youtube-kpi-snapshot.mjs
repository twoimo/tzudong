#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";

const YOUTUBE_CHANNELS_ENDPOINT =
  "https://www.googleapis.com/youtube/v3/channels";
const YOUTUBE_PLAYLIST_ITEMS_ENDPOINT =
  "https://www.googleapis.com/youtube/v3/playlistItems";
const YOUTUBE_VIDEOS_ENDPOINT = "https://www.googleapis.com/youtube/v3/videos";
const DEFAULT_TZUYANG_CHANNEL_HANDLE = "@tzuyang6145";
const DEFAULT_INTERVAL_MINUTES = 15;
const DEFAULT_MAX_PLAYLIST_PAGES = 30;
const YOUTUBE_BATCH_SIZE = 50;
const SUPABASE_BATCH_SIZE = 500;
const YOUTUBE_FETCH_TIMEOUT_MS = 15_000;
const YOUTUBE_FETCH_RETRY_COUNT = 2;
const YOUTUBE_RETRY_BASE_DELAY_MS = 500;

function pickEnv(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function requireEnv(...names) {
  const value = pickEnv(...names);
  if (!value) {
    throw new Error(`Missing required env: ${names.join(" or ")}`);
  }
  return value;
}

function parsePositiveInteger(
  value,
  fallback,
  { min = 1, max = Number.MAX_SAFE_INTEGER } = {},
) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseYouTubeCount(value) {
  if (typeof value !== "string" && typeof value !== "number") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function parseNullableYouTubeCount(value) {
  if (typeof value !== "string" && typeof value !== "number") return null;
  return parseYouTubeCount(value);
}

function parseYouTubeDurationSeconds(duration) {
  if (!duration) return 0;
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function getBucketStartedAt(intervalMinutes) {
  const intervalMs = intervalMinutes * 60 * 1000;
  return new Date(
    Math.floor(Date.now() / intervalMs) * intervalMs,
  ).toISOString();
}

function getYouTubeChannelFilter() {
  const channelId = pickEnv(
    "YOUTUBE_CHANNEL_ID",
    "NEXT_PUBLIC_YOUTUBE_CHANNEL_ID",
  );
  if (channelId) return { name: "id", value: channelId };
  return {
    name: "forHandle",
    value:
      pickEnv("YOUTUBE_CHANNEL_HANDLE", "NEXT_PUBLIC_YOUTUBE_CHANNEL_HANDLE") ??
      DEFAULT_TZUYANG_CHANNEL_HANDLE,
  };
}

async function fetchYouTubeJson(url) {
  let lastError;

  for (let attempt = 0; attempt <= YOUTUBE_FETCH_RETRY_COUNT; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(YOUTUBE_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        const error = new Error(
          `youtube-api-failed:${response.status}:${body.slice(0, 240)}`,
        );
        error.status = response.status;
        throw error;
      }
      return response.json();
    } catch (error) {
      lastError = error;
      const status = typeof error?.status === "number" ? error.status : null;
      const shouldRetry =
        attempt < YOUTUBE_FETCH_RETRY_COUNT &&
        (status === null || status === 429 || status >= 500);
      if (!shouldRetry) break;
      await new Promise((resolve) =>
        setTimeout(resolve, YOUTUBE_RETRY_BASE_DELAY_MS * (attempt + 1)),
      );
    }
  }

  throw lastError;
}

async function fetchChannel(apiKey) {
  const channelFilter = getYouTubeChannelFilter();
  const url = new URL(YOUTUBE_CHANNELS_ENDPOINT);
  url.searchParams.set("part", "snippet,statistics,contentDetails");
  url.searchParams.set(channelFilter.name, channelFilter.value);
  url.searchParams.set("key", apiKey);
  url.searchParams.set(
    "fields",
    "items(id,snippet/title,snippet/customUrl,statistics/subscriberCount,statistics/viewCount,statistics/videoCount,statistics/hiddenSubscriberCount,contentDetails/relatedPlaylists/uploads)",
  );

  const payload = await fetchYouTubeJson(url);
  const channel = payload.items?.[0];
  const uploadsPlaylistId = channel?.contentDetails?.relatedPlaylists?.uploads;
  if (!channel?.id || !uploadsPlaylistId) {
    throw new Error("youtube-channel-or-uploads-playlist-not-found");
  }
  return { channel, uploadsPlaylistId };
}

async function fetchPlaylistVideos(apiKey, playlistId, maxPages) {
  const videos = [];
  let pageToken;
  let page = 0;

  while (page < maxPages) {
    const url = new URL(YOUTUBE_PLAYLIST_ITEMS_ENDPOINT);
    url.searchParams.set("part", "snippet,contentDetails");
    url.searchParams.set("playlistId", playlistId);
    url.searchParams.set("maxResults", String(YOUTUBE_BATCH_SIZE));
    url.searchParams.set("key", apiKey);
    url.searchParams.set(
      "fields",
      "nextPageToken,items(contentDetails/videoId,contentDetails/videoPublishedAt,snippet/publishedAt,snippet/resourceId/videoId,snippet/title)",
    );
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const payload = await fetchYouTubeJson(url);
    for (const item of payload.items ?? []) {
      const id =
        item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
      if (!id) continue;
      videos.push({
        id,
        title: item.snippet?.title ?? "제목 없음",
        publishedAt:
          item.contentDetails?.videoPublishedAt ??
          item.snippet?.publishedAt ??
          null,
      });
    }

    pageToken = payload.nextPageToken;
    if (!pageToken) break;
    page += 1;
  }

  return videos;
}

function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchVideoStats(apiKey, playlistVideos) {
  const videoMap = new Map(playlistVideos.map((video) => [video.id, video]));
  const rows = [];

  for (const videoChunk of chunk(playlistVideos, YOUTUBE_BATCH_SIZE)) {
    const url = new URL(YOUTUBE_VIDEOS_ENDPOINT);
    url.searchParams.set("part", "snippet,statistics,contentDetails");
    url.searchParams.set("id", videoChunk.map((video) => video.id).join(","));
    url.searchParams.set("key", apiKey);
    url.searchParams.set(
      "fields",
      "items(id,snippet/title,snippet/publishedAt,snippet/categoryId,statistics/viewCount,statistics/likeCount,statistics/commentCount,contentDetails/duration)",
    );

    const payload = await fetchYouTubeJson(url);
    for (const item of payload.items ?? []) {
      if (!item.id) continue;
      const fallback = videoMap.get(item.id);
      rows.push({
        videoId: item.id,
        title: item.snippet?.title ?? fallback?.title ?? "제목 없음",
        publishedAt: item.snippet?.publishedAt ?? fallback?.publishedAt ?? null,
        categoryId: item.snippet?.categoryId ?? null,
        durationSeconds: parseYouTubeDurationSeconds(
          item.contentDetails?.duration,
        ),
        viewCount: parseYouTubeCount(item.statistics?.viewCount),
        likeCount: parseYouTubeCount(item.statistics?.likeCount),
        commentCount: parseYouTubeCount(item.statistics?.commentCount),
      });
    }
  }

  return rows;
}


async function fetchPreviousChannelSnapshot({
  supabase,
  channelId,
  bucketStartedAt,
}) {
  const { data, error } = await supabase
    .from("youtube_channel_kpi_snapshots")
    .select(
      "channel_id,subscriber_count,view_count,video_count,hidden_subscriber_count,bucket_started_at",
    )
    .eq("channel_id", channelId)
    .lt("bucket_started_at", bucketStartedAt)
    .order("bucket_started_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`previous-channel-snapshot:${error.message}`);
  }

  return data ?? null;
}

function getCountDelta(currentValue, previousValue) {
  if (typeof currentValue !== "number" || !Number.isFinite(currentValue)) {
    return null;
  }

  if (typeof previousValue !== "number" || !Number.isFinite(previousValue)) {
    return null;
  }

  return currentValue - previousValue;
}

async function upsertSnapshots({
  supabase,
  channel,
  videoStats,
  bucketStartedAt,
}) {
  const statistics = channel.statistics ?? {};
  const isSubscriberHidden = statistics.hiddenSubscriberCount === true;
  const subscriberCount = isSubscriberHidden
    ? null
    : parseYouTubeCount(statistics.subscriberCount);
  const viewCount = parseYouTubeCount(statistics.viewCount);
  const videoCount = parseYouTubeCount(statistics.videoCount);
  const previousChannelSnapshot = await fetchPreviousChannelSnapshot({
    supabase,
    channelId: channel.id,
    bucketStartedAt,
  });
  const previousSubscriberCount = previousChannelSnapshot?.hidden_subscriber_count
    ? null
    : parseNullableYouTubeCount(previousChannelSnapshot?.subscriber_count);
  const previousViewCount = parseNullableYouTubeCount(
    previousChannelSnapshot?.view_count,
  );
  const previousVideoCount = parseNullableYouTubeCount(
    previousChannelSnapshot?.video_count,
  );
  const channelRow = {
    channel_id: channel.id,
    channel_title: channel.snippet?.title ?? null,
    channel_handle: channel.snippet?.customUrl ?? null,
    subscriber_count: subscriberCount,
    view_count: viewCount,
    video_count: videoCount,
    hidden_subscriber_count: isSubscriberHidden,
    previous_bucket_started_at:
      previousChannelSnapshot?.bucket_started_at ?? null,
    subscriber_delta: isSubscriberHidden
      ? null
      : getCountDelta(subscriberCount, previousSubscriberCount),
    view_delta: getCountDelta(viewCount, previousViewCount),
    video_delta: getCountDelta(videoCount, previousVideoCount),
    bucket_started_at: bucketStartedAt,
    fetched_at: new Date().toISOString(),
    source: "youtube-data-api",
  };

  const { error: channelError } = await supabase
    .from("youtube_channel_kpi_snapshots")
    .upsert(channelRow, { onConflict: "channel_id,bucket_started_at" });
  if (channelError)
    throw new Error(`channel-snapshot-upsert:${channelError.message}`);

  const fetchedAt = new Date().toISOString();
  const videoRows = videoStats.map((video) => ({
    video_id: video.videoId,
    channel_id: channel.id,
    title: video.title,
    published_at: video.publishedAt,
    category_id: video.categoryId,
    duration_seconds: video.durationSeconds,
    view_count: video.viewCount,
    like_count: video.likeCount,
    comment_count: video.commentCount,
    bucket_started_at: bucketStartedAt,
    fetched_at: fetchedAt,
    source: "youtube-data-api",
  }));

  for (const videoChunk of chunk(videoRows, SUPABASE_BATCH_SIZE)) {
    const { error } = await supabase
      .from("youtube_video_kpi_snapshots")
      .upsert(videoChunk, { onConflict: "video_id,bucket_started_at" });
    if (error) throw new Error(`video-snapshot-upsert:${error.message}`);
  }

  return {
    channelRows: 1,
    videoRows: videoRows.length,
    previousChannelBucketStartedAt:
      previousChannelSnapshot?.bucket_started_at ?? null,
    subscriberDelta: channelRow.subscriber_delta,
    viewDelta: channelRow.view_delta,
    videoDelta: channelRow.video_delta,
  };
}

async function main() {
  const apiKey = requireEnv("YOUTUBE_API_KEY");
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL");
  const supabaseServiceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const maxPlaylistPages = parsePositiveInteger(
    process.env.YOUTUBE_KPI_SNAPSHOT_MAX_PLAYLIST_PAGES,
    DEFAULT_MAX_PLAYLIST_PAGES,
    { min: 1, max: 50 },
  );
  const intervalMinutes = parsePositiveInteger(
    process.env.YOUTUBE_KPI_SNAPSHOT_INTERVAL_MINUTES,
    DEFAULT_INTERVAL_MINUTES,
    { min: 5, max: 60 },
  );
  const bucketStartedAt = getBucketStartedAt(intervalMinutes);
  const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { channel, uploadsPlaylistId } = await fetchChannel(apiKey);
  const playlistVideos = await fetchPlaylistVideos(
    apiKey,
    uploadsPlaylistId,
    maxPlaylistPages,
  );
  const videoStats = await fetchVideoStats(apiKey, playlistVideos);
  const result = await upsertSnapshots({
    supabase,
    channel,
    videoStats,
    bucketStartedAt,
  });

  console.log(
    JSON.stringify({
      ok: true,
      bucketStartedAt,
      channelId: channel.id,
      uploadsPlaylistId,
      maxPlaylistPages,
      ...result,
    }),
  );
}

main().catch((error) => {
  console.error("[capture-youtube-kpi-snapshot] failed:", error);
  process.exit(1);
});
