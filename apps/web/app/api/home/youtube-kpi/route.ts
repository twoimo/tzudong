import { NextRequest, NextResponse } from 'next/server';

import { getLatestYouTubeKpiMetricsForVideoIds } from '@/lib/admin/youtube-kpi-snapshots';

export const runtime = 'nodejs';

const MAX_VIDEO_IDS = 120;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

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
    const body = await request.json().catch(() => null);
    const videoIds = normalizeVideoIds((body as { videoIds?: unknown } | null)?.videoIds);

    if (videoIds.length === 0) {
      return NextResponse.json({ metrics: [] }, { headers: { 'Cache-Control': 'public, max-age=60' } });
    }

    const metrics = await getLatestYouTubeKpiMetricsForVideoIds(videoIds);

    return NextResponse.json(
      { metrics },
      { headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } },
    );
  } catch (error) {
    console.error('[home/youtube-kpi] failed:', error instanceof Error ? error.message : error);
    return NextResponse.json({ metrics: [] }, { status: 200, headers: { 'Cache-Control': 'no-store' } });
  }
}
