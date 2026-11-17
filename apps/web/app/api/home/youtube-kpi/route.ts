import { NextRequest, NextResponse } from 'next/server';

import { getLatestYouTubeKpiMetricsForVideoIds } from '@/lib/admin/youtube-kpi-snapshots';
import { createHomeKpiServerTiming, resolveHomeKpiQueryMode } from '@/lib/performance/home-kpi-server-timing';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';

export const runtime = 'nodejs';

const MAX_VIDEO_IDS = 120;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
const MAX_YOUTUBE_KPI_REQUEST_BYTES = 8 * 1024;
const HOME_KPI_CDN_CACHE = 'public, max-age=0, s-maxage=60, stale-while-revalidate=300, must-revalidate';

function normalizeVideoIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const uniqueIds = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const videoId = item.trim();
    if (!YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) continue;
    uniqueIds.add(videoId);
    if (uniqueIds.size >= MAX_VIDEO_IDS) break;
  }

  return [...uniqueIds];
}

export async function GET(request: NextRequest) {
  const timing = createHomeKpiServerTiming();
  const mode = resolveHomeKpiQueryMode(process.env.TZUDONG_HOME_KPI_QUERY_MODE);
  const respond = (metrics: Awaited<ReturnType<typeof getLatestYouTubeKpiMetricsForVideoIds>>, cacheControl: string) =>
    NextResponse.json({ metrics }, {
      status: 200,
      headers: { 'Cache-Control': cacheControl, 'Server-Timing': timing.header(mode) },
    });

  if (mode === null) return respond([], 'no-store');

  const query = new URL(request.url).search;
  if (Buffer.byteLength(query) > MAX_YOUTUBE_KPI_REQUEST_BYTES) {
    return respond([], 'no-store');
  }

  const videoIds = normalizeVideoIds(new URL(request.url).searchParams.getAll('videoIds'));
  if (videoIds.length === 0) return respond([], 'public, max-age=60');

  try {
    const metrics = await getLatestYouTubeKpiMetricsForVideoIds(videoIds, { mode, observe: timing.observe });
    return respond(metrics, HOME_KPI_CDN_CACHE);
  } catch {
    console.error('[home/youtube-kpi] failed:');
    return respond([], 'no-store');
  }
}

export async function POST(request: NextRequest) {
  const timing = createHomeKpiServerTiming();
  // Deployment-owned only: no request/header/body selector and no implicit
  // fallback after an RPC error. The missing value selects the RPC release.
  const mode = resolveHomeKpiQueryMode(process.env.TZUDONG_HOME_KPI_QUERY_MODE);
  const respond = (metrics: Awaited<ReturnType<typeof getLatestYouTubeKpiMetricsForVideoIds>>, cacheControl: string) =>
    NextResponse.json({ metrics }, {
      status: 200,
      headers: { 'Cache-Control': cacheControl, 'Server-Timing': timing.header(mode) },
    });

  if (mode === null) return respond([], 'no-store');

  try {
    const finishBody = timing.beginBody();
    let requestBody;
    try {
      requestBody = await readBoundedJsonRequest(request, MAX_YOUTUBE_KPI_REQUEST_BYTES);
    } finally {
      finishBody();
    }
    if (!requestBody.ok) {
      return respond([], 'no-store');
    }

    const body = requestBody.value;
    const videoIds = normalizeVideoIds((body as { videoIds?: unknown } | null)?.videoIds);

    if (videoIds.length === 0) {
      return respond([], 'public, max-age=60');
    }

    const metrics = await getLatestYouTubeKpiMetricsForVideoIds(videoIds, { mode, observe: timing.observe });

    return respond(metrics, 'public, max-age=60, stale-while-revalidate=300');
  } catch {
    console.error('[home/youtube-kpi] failed:');
    return respond([], 'no-store');
  }
}
