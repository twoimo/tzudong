import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getYouTubeKpiSnapshotData } from "@/lib/admin/youtube-kpi-snapshots";
import {
  getInsightTreemapData,
  parseTreemapPeriod,
  type InsightTreemapPeriod,
  type InsightTreemapResponse,
  type InsightTreemapVideoRow,
} from "@/lib/public-insights/treemap";

export const runtime = "nodejs";

const YOUTUBE_CHANNELS_ENDPOINT =
  "https://www.googleapis.com/youtube/v3/channels";
const YOUTUBE_PLAYLIST_ITEMS_ENDPOINT =
  "https://www.googleapis.com/youtube/v3/playlistItems";
const YOUTUBE_VIDEOS_ENDPOINT = "https://www.googleapis.com/youtube/v3/videos";
const DEFAULT_TZUYANG_CHANNEL_HANDLE = "@tzuyang6145";
const MAX_YOUTUBE_KPI_PLAYLIST_PAGES = 30;
const YOUTUBE_BATCH_SIZE = 50;
const YOUTUBE_FETCH_TIMEOUT_MS = 10_000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const periodToMilliseconds: Record<
  Exclude<InsightTreemapPeriod, "ALL">,
  number
> = {
  "30MIN": 30 * MINUTE_MS,
  "1H": HOUR_MS,
  "6H": 6 * HOUR_MS,
  "12H": 12 * HOUR_MS,
  "1D": DAY_MS,
  "1W": 7 * DAY_MS,
  "2W": 14 * DAY_MS,
  "1M": 30 * DAY_MS,
  "3M": 91 * DAY_MS,
  "6M": 182 * DAY_MS,
  "1Y": 365 * DAY_MS,
};

type YouTubeChannelListResponse = {
  items?: Array<{
    contentDetails?: {
      relatedPlaylists?: {
        uploads?: string;
      };
    };
  }>;
};

type YouTubePlaylistItemsResponse = {
  nextPageToken?: string;
  items?: Array<{
    snippet?: {
      publishedAt?: string;
      title?: string;
      resourceId?: {
        videoId?: string;
      };
    };
    contentDetails?: {
      videoId?: string;
      videoPublishedAt?: string;
    };
  }>;
};

type YouTubeVideosResponse = {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      publishedAt?: string;
      categoryId?: string;
    };
    statistics?: {
      viewCount?: string;
      likeCount?: string;
      commentCount?: string;
    };
    contentDetails?: {
      duration?: string;
    };
  }>;
};

type YouTubePlaylistVideo = {
  id: string;
  title: string;
  publishedAt: string | null;
};

function getYouTubeApiKey() {
  return process.env.YOUTUBE_API_KEY || null;
}

function getYouTubeChannelFilter() {
  const channelId =
    process.env.YOUTUBE_CHANNEL_ID ||
    process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID;

  if (channelId) return { name: "id", value: channelId };

  return {
    name: "forHandle",
    value:
      process.env.YOUTUBE_CHANNEL_HANDLE ||
      process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_HANDLE ||
      DEFAULT_TZUYANG_CHANNEL_HANDLE,
  };
}

function parseYouTubeCount(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function parseYouTubeDurationSeconds(duration: string | undefined) {
  if (!duration) return 0;
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return 0;

  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  return hours * 3600 + minutes * 60 + seconds;
}

function getPeriodCutoff(period: InsightTreemapPeriod) {
  if (period === "ALL") return null;
  const durationMs = periodToMilliseconds[period];
  return durationMs ? Date.now() - durationMs : null;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

async function fetchYouTubeJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(YOUTUBE_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`youtube-api-failed:${response.status}`);
  }

  return response.json() as Promise<T>;
}

async function fetchUploadsPlaylistId(apiKey: string) {
  const channelFilter = getYouTubeChannelFilter();
  const url = new URL(YOUTUBE_CHANNELS_ENDPOINT);
  url.searchParams.set("part", "contentDetails");
  url.searchParams.set(channelFilter.name, channelFilter.value);
  url.searchParams.set("key", apiKey);
  url.searchParams.set(
    "fields",
    "items(contentDetails/relatedPlaylists/uploads)",
  );

  const payload = await fetchYouTubeJson<YouTubeChannelListResponse>(url);
  const uploadsPlaylistId =
    payload.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;

  if (!uploadsPlaylistId) {
    throw new Error("youtube-uploads-playlist-not-found");
  }

  return uploadsPlaylistId;
}

async function fetchPlaylistVideos(
  apiKey: string,
  playlistId: string,
  period: InsightTreemapPeriod,
) {
  const cutoff = getPeriodCutoff(period);
  const videos: YouTubePlaylistVideo[] = [];
  let pageToken: string | undefined;
  let page = 0;
  let reachedCutoff = false;

  while (page < MAX_YOUTUBE_KPI_PLAYLIST_PAGES && !reachedCutoff) {
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

    const payload = await fetchYouTubeJson<YouTubePlaylistItemsResponse>(url);

    for (const item of payload.items ?? []) {
      const videoId =
        item.contentDetails?.videoId ?? item.snippet?.resourceId?.videoId;
      if (!videoId) continue;

      const publishedAt =
        item.contentDetails?.videoPublishedAt ??
        item.snippet?.publishedAt ??
        null;
      const publishedAtMs = publishedAt ? new Date(publishedAt).getTime() : NaN;

      if (cutoff && Number.isFinite(publishedAtMs) && publishedAtMs < cutoff) {
        reachedCutoff = true;
        break;
      }

      videos.push({
        id: videoId,
        title: item.snippet?.title ?? "제목 없음",
        publishedAt,
      });
    }

    pageToken = payload.nextPageToken;
    if (!pageToken) break;
    page += 1;
  }

  return videos;
}

async function fetchVideoRows(
  apiKey: string,
  playlistVideos: YouTubePlaylistVideo[],
) {
  const rows: InsightTreemapVideoRow[] = [];
  const playlistVideoMap = new Map(
    playlistVideos.map((video) => [video.id, video]),
  );

  for (const videoChunk of chunk(playlistVideos, YOUTUBE_BATCH_SIZE)) {
    const url = new URL(YOUTUBE_VIDEOS_ENDPOINT);
    url.searchParams.set("part", "snippet,statistics,contentDetails");
    url.searchParams.set("id", videoChunk.map((video) => video.id).join(","));
    url.searchParams.set("key", apiKey);
    url.searchParams.set(
      "fields",
      "items(id,snippet/title,snippet/publishedAt,snippet/categoryId,statistics/viewCount,statistics/likeCount,statistics/commentCount,contentDetails/duration)",
    );

    const payload = await fetchYouTubeJson<YouTubeVideosResponse>(url);

    for (const item of payload.items ?? []) {
      if (!item.id) continue;
      const fallback = playlistVideoMap.get(item.id);

      rows.push({
        id: item.id,
        title: item.snippet?.title ?? fallback?.title ?? "제목 없음",
        publishedAt: item.snippet?.publishedAt ?? fallback?.publishedAt ?? null,
        category: item.snippet?.categoryId ?? "YouTube",
        viewCount: parseYouTubeCount(item.statistics?.viewCount),
        likeCount: parseYouTubeCount(item.statistics?.likeCount),
        commentCount: parseYouTubeCount(item.statistics?.commentCount),
        duration: parseYouTubeDurationSeconds(item.contentDetails?.duration),
        previousViewCount: null,
        previousLikeCount: null,
        previousCommentCount: null,
        previousDuration: null,
      });
    }
  }

  return rows.sort((a, b) => {
    const aMs = a.publishedAt ? new Date(a.publishedAt).getTime() : 0;
    const bMs = b.publishedAt ? new Date(b.publishedAt).getTime() : 0;
    return bMs - aMs;
  });
}

export async function GET(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const apiKey = getYouTubeApiKey();
  const period = parseTreemapPeriod(request.nextUrl.searchParams.get("period"));
  const isChannelGrowthScope =
    request.nextUrl.searchParams.get("scope") === "channel-growth";

  try {
    const snapshotPayload = await getYouTubeKpiSnapshotData(period, {
      filterByPublishedPeriod: !isChannelGrowthScope,
    });
    if (snapshotPayload) {
      const snapshotComparisonAvailable =
        snapshotPayload.meta?.comparisonCoverage?.comparisonAvailable === true;
      const shouldUseHistoryComparisonFallback =
        isChannelGrowthScope && period !== "ALL" && !snapshotComparisonAvailable;

      if (shouldUseHistoryComparisonFallback) {
        const historyComparisonPayload = await getInsightTreemapData(period, {
          filterByPeriod: false,
          metricMode: "views",
        });

        if (
          historyComparisonPayload.meta?.comparisonCoverage
            ?.comparisonAvailable === true
        ) {
          return NextResponse.json(
            {
              ...historyComparisonPayload,
              meta: {
                ...historyComparisonPayload.meta,
                dataSource: "supabase-treemap",
                fallbackSource: "supabase-treemap",
                fallbackReasonCode: "snapshot-comparison-unavailable",
              },
            } satisfies InsightTreemapResponse,
            {
              headers: {
                "Cache-Control":
                  "private, max-age=60, stale-while-revalidate=180",
              },
            },
          );
        }
      }

      return NextResponse.json(snapshotPayload, {
        headers: {
          "Cache-Control": "private, max-age=60, stale-while-revalidate=180",
        },
      });
    }
  } catch (error) {
    console.warn("YouTube KPI snapshot fallback failed:", error);
  }

  if (!apiKey) {
    try {
      const fallbackPayload = await getInsightTreemapData(period, {
        filterByPeriod: !isChannelGrowthScope && period !== "ALL",
        metricMode: "views",
      });

      return NextResponse.json({
        ...fallbackPayload,
        meta: {
          ...fallbackPayload.meta,
          dataSource: "supabase-treemap",
          fallbackSource: "supabase-treemap",
          fallbackReasonCode: "youtube-api-key-missing",
        },
      } satisfies InsightTreemapResponse, {
        headers: {
          "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
        },
      });
    } catch (fallbackError) {
      console.error("YouTube KPI Supabase fallback error:", fallbackError);
      return NextResponse.json(
        { error: "YouTube KPI fallback data is unavailable" },
        { status: 500 },
      );
    }
  }

  try {
    const uploadsPlaylistId = await fetchUploadsPlaylistId(apiKey);
    const playlistVideos = await fetchPlaylistVideos(
      apiKey,
      uploadsPlaylistId,
      isChannelGrowthScope ? "ALL" : period,
    );
    const videos = await fetchVideoRows(apiKey, playlistVideos);
    const payload: InsightTreemapResponse = {
      asOf: new Date().toISOString(),
      period,
      totalVideos: videos.length,
      videos,
      availablePeriods: [],
      meta: {
        dataSource: "youtube-live",
        comparisonCoverage: {
          totalVideos: videos.length,
          comparedVideos: 0,
          newVideos: videos.length,
          missingPreviousVideos: 0,
          comparisonAvailable: false,
        },
      },
    };

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (error) {
    console.error("YouTube KPI fetch error:", error);

    try {
      const fallbackPayload = await getInsightTreemapData(period, {
        filterByPeriod: !isChannelGrowthScope && period !== "ALL",
        metricMode: "views",
      });

      return NextResponse.json({
        ...fallbackPayload,
        meta: {
          ...fallbackPayload.meta,
          dataSource: "supabase-treemap",
          fallbackSource: "supabase-treemap",
          fallbackReasonCode: "youtube-live-fetch-failed",
        },
      } satisfies InsightTreemapResponse, {
        headers: {
          "Cache-Control": "private, max-age=60, stale-while-revalidate=300",
        },
      });
    } catch (fallbackError) {
      console.error("YouTube KPI Supabase fallback error:", fallbackError);
      return NextResponse.json(
        { error: "Failed to fetch live YouTube KPI data" },
        { status: 502 },
      );
    }
  }
}
