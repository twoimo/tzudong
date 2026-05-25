import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth/require-admin";

export const runtime = "nodejs";

const YOUTUBE_CHANNELS_ENDPOINT = "https://www.googleapis.com/youtube/v3/channels";
const YOUTUBE_CHANNEL_CACHE_SECONDS = 10 * 60;
const DEFAULT_TZUYANG_CHANNEL_HANDLE = "@tzuyang6145";

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

function parseYouTubeCount(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getYouTubeApiKey() {
  return (
    process.env.YOUTUBE_API_KEY ||
    process.env.NEXT_PUBLIC_YOUTUBE_API_KEY ||
    process.env.NEXT_PUBLIC_YOUTUBE_API_KEY_BYEON ||
    null
  );
}

function getYouTubeChannelFilter() {
  const channelId =
    process.env.YOUTUBE_CHANNEL_ID || process.env.NEXT_PUBLIC_YOUTUBE_CHANNEL_ID;

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

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const apiKey = getYouTubeApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { error: "YouTube API key is not configured" },
      { status: 500 },
    );
  }

  const channelFilter = getYouTubeChannelFilter();
  const url = new URL(YOUTUBE_CHANNELS_ENDPOINT);
  url.searchParams.set("part", "snippet,statistics");
  url.searchParams.set(channelFilter.name, channelFilter.value);
  url.searchParams.set("key", apiKey);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      next: { revalidate: YOUTUBE_CHANNEL_CACHE_SECONDS },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "YouTube channel statistics request failed" },
        { status: response.status },
      );
    }

    const payload = (await response.json()) as YouTubeChannelListResponse;
    const channel = payload.items?.[0];

    if (!channel) {
      return NextResponse.json(
        { error: "YouTube channel was not found" },
        { status: 404 },
      );
    }

    const statistics = channel.statistics ?? {};

    return NextResponse.json(
      {
        channelId: channel.id ?? null,
        title: channel.snippet?.title ?? null,
        handle: channel.snippet?.customUrl ?? null,
        subscriberCount: parseYouTubeCount(statistics.subscriberCount),
        viewCount: parseYouTubeCount(statistics.viewCount),
        videoCount: parseYouTubeCount(statistics.videoCount),
        hiddenSubscriberCount: statistics.hiddenSubscriberCount === true,
        fetchedAt: new Date().toISOString(),
      },
      {
        headers: {
          "Cache-Control": `private, max-age=${YOUTUBE_CHANNEL_CACHE_SECONDS}, stale-while-revalidate=${YOUTUBE_CHANNEL_CACHE_SECONDS * 3}`,
        },
      },
    );
  } catch (error) {
    console.error("YouTube channel statistics fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch YouTube channel statistics" },
      { status: 502 },
    );
  }
}
