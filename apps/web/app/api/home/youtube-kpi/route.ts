import { NextRequest, NextResponse } from 'next/server';

import { getLatestYouTubeKpiMetricsForVideoIds } from '@/lib/admin/youtube-kpi-snapshots';
import { readBoundedJsonRequest } from '@/lib/security/bounded-json-request';

export const runtime = 'nodejs';

const MAX_VIDEO_IDS = 120;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;
const MAX_YOUTUBE_KPI_REQUEST_BYTES = 8 * 1024;

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

export async function POST(request: NextRequest) {
  try {
    const requestBody = await readBoundedJsonRequest(request, MAX_YOUTUBE_KPI_REQUEST_BYTES);
    if (!requestBody.ok) {
      return NextResponse.json(
        { metrics: [] },
        { status: 200, headers: { 'Cache-Control': 'no-store' } },
      );
    }

    const body = requestBody.value;
    const videoIds = normalizeVideoIds((body as { videoIds?: unknown } | null)?.videoIds);

    if (videoIds.length === 0) {
      return NextResponse.json({ metrics: [] }, { headers: { 'Cache-Control': 'public, max-age=60' } });
    }

    const metrics = await getLatestYouTubeKpiMetricsForVideoIds(videoIds);

    return NextResponse.json(
      { metrics },
      { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } },
    );
  } catch {
    console.error('[home/youtube-kpi] failed:');
    return NextResponse.json({ metrics: [] }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  }
}
