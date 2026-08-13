import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";
import { getLatestYouTubeChannelSnapshot } from "@/lib/admin/youtube-kpi-snapshots";
import { parseTreemapPeriod } from "@/lib/public-insights/treemap";

export const runtime = "nodejs";

const YOUTUBE_CHANNELS_ENDPOINT =
  "https://www.googleapis.com/youtube/v3/channels";
const YOUTUBE_CHANNEL_CACHE_SECONDS = 10 * 60;
const DEFAULT_TZUYANG_CHANNEL_HANDLE = "@tzuyang6145";
const YOUTUBE_CHANNEL_FETCH_TIMEOUT_MS = 10_000;
const youtubeChannelCacheHeaders = {
  "Cache-Control": `private, max-age=${YOUTUBE_CHANNEL_CACHE_SECONDS}, stale-while-revalidate=${YOUTUBE_CHANNEL_CACHE_SECONDS * 3}`,
};
const youtubeChannelUnavailableHeaders = {
  "Cache-Control": "private, no-store",
};
const LOCAL_CHANNEL_SNAPSHOT_UNAVAILABLE =
  "LOCAL_CHANNEL_SNAPSHOT_UNAVAILABLE" as const;

type YouTubeChannelListResponse = {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      customUrl?: string;
    };
    statistics?: {
      subscriberCount?: string;
      viewCount?: string;
      videoCount?: string;
      hiddenSubscriberCount?: boolean;
    };
  }>;
};

type ChannelDeltaSource =
  | "snapshot-delta"
  | "derived-live-comparison"
  | "derived-snapshot-comparison"
  | "unavailable";

function parseYouTubeCount(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getDerivedLiveDelta(
  currentValue: number | null,
  previousValue: number | null | undefined,
  snapshotDelta: number | null | undefined,
): { value: number | null; source: ChannelDeltaSource } {
  if (typeof currentValue === "number" && typeof previousValue === "number") {
    return {
      value: currentValue - previousValue,
      source: "derived-live-comparison",
    };
  }

  if (typeof snapshotDelta === "number") {
    return { value: snapshotDelta, source: "snapshot-delta" };
  }

  return { value: null, source: "unavailable" };
}

function getYouTubeApiKey() {
  return process.env.YOUTUBE_API_KEY || null;
}

function getYouTubeChannelFilter() {
  const channelId =
    process.env.YOUTUBE_CHANNEL_ID ||
    process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID;

  if (channelId) {
    return { name: "id", value: channelId };
  }

  return {
    name: "forHandle",
    value:
      process.env.YOUTUBE_CHANNEL_HANDLE ||
      process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_HANDLE ||
      DEFAULT_TZUYANG_CHANNEL_HANDLE,
  };
}

async function getYouTubeChannelSnapshotFallback(
  period: ReturnType<typeof parseTreemapPeriod>,
) {
  try {
    return await getLatestYouTubeChannelSnapshot(period);
  } catch (error) {
    console.warn("YouTube channel snapshot fallback unavailable:");
    return null;
  }
}

async function respondWithYouTubeChannelSnapshotFallback(
  period: ReturnType<typeof parseTreemapPeriod>,
  error: string,
  status: number,
) {
  const snapshot = await getYouTubeChannelSnapshotFallback(period);
  if (snapshot) {
    return NextResponse.json(
      {
        ...snapshot,
        fallbackSource: "supabase-channel-snapshot",
        fallbackReason: error,
      },
      { headers: youtubeChannelCacheHeaders },
    );
  }

  if (process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME === "1") {
    return NextResponse.json(
      {
        channelId: null,
        title: null,
        handle: null,
        subscriberCount: null,
        viewCount: null,
        videoCount: null,
        hiddenSubscriberCount: false,
        fetchedAt: null,
        previousSubscriberCount: null,
        previousViewCount: null,
        previousVideoCount: null,
        previousBucketStartedAt: null,
        subscriberDelta: null,
        viewDelta: null,
        videoDelta: null,
        comparisonFetchedAt: null,
        deltaSource: "unavailable",
        unavailable: {
          code: LOCAL_CHANNEL_SNAPSHOT_UNAVAILABLE,
        },
      },
      { headers: youtubeChannelUnavailableHeaders },
    );
  }

  return NextResponse.json({ error }, { status });
}

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const period = parseTreemapPeriod(
    new URL(request.url).searchParams.get("period"),
  );
  const apiKey = getYouTubeApiKey();
  if (!apiKey) {
    return respondWithYouTubeChannelSnapshotFallback(
      period,
      "YouTube API key is not configured",
      500,
    );
  }

  const channelFilter = getYouTubeChannelFilter();
  const url = new URL(YOUTUBE_CHANNELS_ENDPOINT);
  url.searchParams.set("part", "snippet,statistics");
  url.searchParams.set(channelFilter.name, channelFilter.value);
  url.searchParams.set("key", apiKey);
  url.searchParams.set(
    "fields",
    "items(id,snippet/title,snippet/customUrl,statistics/subscriberCount,statistics/viewCount,statistics/videoCount,statistics/hiddenSubscriberCount)",
  );

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: YOUTUBE_CHANNEL_CACHE_SECONDS },
      signal: AbortSignal.timeout(YOUTUBE_CHANNEL_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return respondWithYouTubeChannelSnapshotFallback(
        period,
        "YouTube channel statistics request failed",
        response.status,
      );
    }

    const payload = (await response.json()) as YouTubeChannelListResponse;
    const channel = payload.items?.[0];

    if (!channel) {
      return respondWithYouTubeChannelSnapshotFallback(
        period,
        "YouTube channel was not found",
        404,
      );
    }

    const statistics = channel.statistics ?? {};
    const liveSubscriberCount = parseYouTubeCount(statistics.subscriberCount);
    const liveViewCount = parseYouTubeCount(statistics.viewCount);
    const liveVideoCount = parseYouTubeCount(statistics.videoCount);
    const comparisonSnapshot = await getYouTubeChannelSnapshotFallback(period);
    const subscriberDelta = getDerivedLiveDelta(
      liveSubscriberCount,
      comparisonSnapshot?.previousSubscriberCount,
      comparisonSnapshot?.subscriberDelta,
    );
    const viewDelta = getDerivedLiveDelta(
      liveViewCount,
      comparisonSnapshot?.previousViewCount,
      comparisonSnapshot?.viewDelta,
    );
    const videoDelta = getDerivedLiveDelta(
      liveVideoCount,
      comparisonSnapshot?.previousVideoCount,
      comparisonSnapshot?.videoDelta,
    );

    if (statistics.hiddenSubscriberCount !== true && liveSubscriberCount == null) {
      return respondWithYouTubeChannelSnapshotFallback(
        period,
        "YouTube channel subscriber count was unavailable",
        502,
      );
    }

    return NextResponse.json(
      {
        channelId: channel.id ?? null,
        title: channel.snippet?.title ?? null,
        handle: channel.snippet?.customUrl ?? null,
        subscriberCount: liveSubscriberCount,
        viewCount: liveViewCount,
        videoCount: liveVideoCount,
        hiddenSubscriberCount: statistics.hiddenSubscriberCount === true,
        fetchedAt: new Date().toISOString(),
        previousSubscriberCount: comparisonSnapshot?.previousSubscriberCount ?? null,
        previousViewCount: comparisonSnapshot?.previousViewCount ?? null,
        previousVideoCount: comparisonSnapshot?.previousVideoCount ?? null,
        previousBucketStartedAt:
          comparisonSnapshot?.previousBucketStartedAt ?? null,
        subscriberDelta: subscriberDelta.value,
        viewDelta: viewDelta.value,
        videoDelta: videoDelta.value,
        comparisonFetchedAt: comparisonSnapshot?.comparisonFetchedAt ?? null,
        deltaSource:
          subscriberDelta.source !== "unavailable"
            ? subscriberDelta.source
            : viewDelta.source !== "unavailable"
              ? viewDelta.source
              : videoDelta.source,
      },
      {
        headers: youtubeChannelCacheHeaders,
      },
    );
  } catch (error) {
    console.error("YouTube channel statistics fetch error:");
    return respondWithYouTubeChannelSnapshotFallback(
      period,
      "Failed to fetch YouTube channel statistics",
      502,
    );
  }
}
