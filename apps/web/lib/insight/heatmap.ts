import type { AdminInsightHeatmapResponse, InsightHeatmapDataPoint, InsightHeatmapSegment, InsightHeatmapVideo } from '@/types/insight';
import { createSupabaseServiceRoleClient } from '@/lib/insight/supabase';

const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
} | null;

let heatmapCache: CacheEntry<AdminInsightHeatmapResponse> = null;

type VideoRow = {
  id: string;
  title?: string | null;
  published_at?: string | null;
  duration?: number | null;
  view_count?: number | null;
  youtube_link?: string | null;
  thumbnail_url?: string | null;
  meta_history?: unknown;
  channel_name?: string | null;
  is_shorts?: boolean | null;
  is_ads?: boolean | null;
};

type CaptionRow = {
  video_id: string;
  recollect_id: number;
  start_sec: number;
  end_sec: number;
  rank?: number | null;
  raw_caption?: string | null;
  chronological_analysis?: string | null;
  highlight_keywords?: string[] | null;
  duration?: number | null;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function formatDuration(durationSec: number | null | undefined): string {
  if (!durationSec || !Number.isFinite(durationSec) || durationSec <= 0) return '-';

  const total = Math.floor(durationSec);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString().slice(0, 10);
}

function computeWeeklyChange(metaHistory: unknown, fallbackViewCount: number | null): number | null {
  if (!Array.isArray(metaHistory) || metaHistory.length < 2) {
    return null;
  }

  const entries = metaHistory
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
      const record = item as Record<string, unknown>;
      const collectedAt = typeof record.collected_at === 'string' ? record.collected_at : null;
      const viewCount = typeof record.view_count === 'number' && Number.isFinite(record.view_count) ? record.view_count : null;
      if (!collectedAt || viewCount == null) return null;
      const ts = Date.parse(collectedAt);
      if (!Number.isFinite(ts)) return null;
      return { ts, viewCount };
    })
    .filter((value): value is { ts: number; viewCount: number } => Boolean(value))
    .sort((a, b) => a.ts - b.ts);

  if (entries.length < 2) return null;

  const latest = entries[entries.length - 1];
  const latestTs = latest.ts;
  const targetTs = latestTs - 7 * 24 * 60 * 60 * 1000;

  const prev = [...entries].reverse().find((entry) => entry.ts <= targetTs) ?? entries[0];
  const prevView = prev.viewCount;

  const latestView = typeof fallbackViewCount === 'number' && Number.isFinite(fallbackViewCount)
    ? fallbackViewCount
    : latest.viewCount;

  if (!prevView || prevView <= 0) return null;

  const delta = latestView - prevView;
  const percent = (delta / prevView) * 100;

  if (!Number.isFinite(percent)) return null;
  return Math.round(percent * 10) / 10;
}

function windowAverage(values: number[], start: number, size: number): number {
  let sum = 0;
  let count = 0;
  for (let i = start; i < start + size; i += 1) {
    const value = values[i];
    if (typeof value === 'number') {
      sum += value;
      count += 1;
    }
  }
  return count ? sum / count : 0;
}

function findBestWindow(values: number[], size: number, mode: 'min' | 'max'): { start: number; end: number; avg: number } {
  if (values.length === 0) return { start: 0, end: 0, avg: 0 };
  const windowSize = clamp(size, 1, values.length);
  let bestStart = 0;
  let bestAvg = windowAverage(values, 0, windowSize);

  for (let i = 1; i <= values.length - windowSize; i += 1) {
    const avg = windowAverage(values, i, windowSize);
    const isBetter = mode === 'max' ? avg > bestAvg : avg < bestAvg;
    if (isBetter) {
      bestAvg = avg;
      bestStart = i;
    }
  }

  return { start: bestStart, end: bestStart + windowSize, avg: bestAvg };
}

function extractTopKeywords(captions: CaptionRow[], limit: number): string[] {
  const counts = new Map<string, number>();
  for (const row of captions) {
    if (!Array.isArray(row.highlight_keywords)) continue;
    for (const keyword of row.highlight_keywords) {
      if (!keyword || typeof keyword !== 'string') continue;
      const normalized = keyword.trim();
      if (!normalized) continue;
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([keyword]) => keyword);
}

function buildSyntheticHeatmap(captions: CaptionRow[], durationSec: number): {
  heatmapData: InsightHeatmapDataPoint[];
  peakSegment: InsightHeatmapSegment;
  lowestSegment: InsightHeatmapSegment;
  keywords: string[];
  peakContext: string | null;
} {
  const bins = Array.from({ length: 100 }, (_, i) => ({ position: i, value: 0 }));
  const safeDuration = durationSec > 0 ? durationSec : 1;

  for (const row of captions) {
    const startSec = typeof row.start_sec === 'number' ? row.start_sec : null;
    const endSec = typeof row.end_sec === 'number' ? row.end_sec : null;
    if (startSec == null || endSec == null) continue;

    const rank = typeof row.rank === 'number' && row.rank >= 0 ? row.rank : 10;
    const weight = 1 / (rank + 1);

    const startPos = clamp(Math.floor((startSec / safeDuration) * 100), 0, 99);
    const endPos = clamp(Math.ceil((endSec / safeDuration) * 100), 0, 99);

    for (let i = startPos; i <= endPos; i += 1) {
      bins[i].value += weight;
    }
  }

  const values = bins.map((b) => b.value);
  const max = Math.max(...values, 0);
  const normalized = max > 0
    ? bins.map((b) => ({ position: b.position, engagement: b.value / max }))
    : bins.map((b) => ({ position: b.position, engagement: 0 }));

  const peakWindow = findBestWindow(values, 12, 'max');
  const lowWindow = findBestWindow(values, 12, 'min');

  const peakEngagement = max > 0 ? peakWindow.avg / max : 0;
  const lowEngagement = max > 0 ? lowWindow.avg / max : 0;

  const peakSegment: InsightHeatmapSegment = {
    start: clamp(peakWindow.start, 0, 100),
    end: clamp(peakWindow.end, 0, 100),
    engagement: clamp(peakEngagement, 0, 1),
  };

  const lowestSegment: InsightHeatmapSegment = {
    start: clamp(lowWindow.start, 0, 100),
    end: clamp(lowWindow.end, 0, 100),
    engagement: clamp(lowEngagement, 0, 1),
  };

  const keywords = extractTopKeywords(captions, 6);
  const bestCaption = [...captions]
    .sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999))[0];

  const peakContext = bestCaption?.chronological_analysis?.trim()
    || bestCaption?.raw_caption?.trim()
    || null;

  return {
    heatmapData: normalized,
    peakSegment,
    lowestSegment,
    keywords,
    peakContext,
  };
}

async function fetchTopVideos(limit: number): Promise<VideoRow[]> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('videos' as never)
    .select('id,title,published_at,duration,view_count,youtube_link,thumbnail_url,meta_history,channel_name,is_shorts,is_ads')
    .eq('channel_name', 'tzuyang')
    .eq('is_shorts', false)
    .order('view_count', { ascending: false })
    .limit(limit)
    .returns<VideoRow[]>();

  if (error) {
    throw new Error(`Failed to fetch videos: ${error.message}`);
  }

  return data || [];
}

async function fetchCaptionsForVideos(videoIds: string[]): Promise<CaptionRow[]> {
  if (videoIds.length === 0) return [];

  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('video_frame_captions' as never)
    .select('video_id,recollect_id,start_sec,end_sec,rank,raw_caption,chronological_analysis,highlight_keywords,duration')
    .in('video_id', videoIds)
    .returns<CaptionRow[]>();

  if (error) {
    throw new Error(`Failed to fetch captions: ${error.message}`);
  }

  return data || [];
}

function pickLatestCaptions(captions: CaptionRow[]): Map<string, CaptionRow[]> {
  const maxRecollectByVideo = new Map<string, number>();

  for (const row of captions) {
    if (!row?.video_id) continue;
    const current = maxRecollectByVideo.get(row.video_id) ?? -1;
    if (row.recollect_id > current) {
      maxRecollectByVideo.set(row.video_id, row.recollect_id);
    }
  }

  const grouped = new Map<string, CaptionRow[]>();

  for (const row of captions) {
    const target = maxRecollectByVideo.get(row.video_id);
    if (target == null) continue;
    if (row.recollect_id !== target) continue;
    const list = grouped.get(row.video_id) ?? [];
    list.push(row);
    grouped.set(row.video_id, list);
  }

  for (const [videoId, list] of grouped) {
    list.sort((a, b) => (a.rank ?? 999) - (b.rank ?? 999));
    grouped.set(videoId, list);
  }

  return grouped;
}

function buildAnalysisText(input: {
  title: string;
  weeklyChange: number | null;
  peak: InsightHeatmapSegment;
  low: InsightHeatmapSegment;
  keywords: string[];
  peakContext: string | null;
}): { peakReason: string; lowestReason: string; overallSummary: string } {
  const keywordText = input.keywords.length ? input.keywords.slice(0, 4).join(', ') : '키워드 데이터 없음';
  const peakRange = `${input.peak.start}%~${input.peak.end}%`;
  const lowRange = `${input.low.start}%~${input.low.end}%`;

  const peakReason = input.peakContext
    ? `하이라이트 구간(${peakRange})에서 시청자 반응이 집중되었습니다. (예: ${input.peakContext.slice(0, 80)}${input.peakContext.length > 80 ? '...' : ''})`
    : `하이라이트 구간(${peakRange})에서 시청자 반응이 집중되었습니다.`;

  const lowestReason = `저참여 구간(${lowRange})은 하이라이트 밀도가 낮아 이탈이 발생했을 가능성이 있습니다.`;

  const weekly = input.weeklyChange == null ? '주간 변화율 계산 불가' : `주간 조회수 변화: ${input.weeklyChange >= 0 ? '+' : ''}${input.weeklyChange}%`;

  const overallSummary = [
    `**${input.title}** 히트맵 요약`,
    ``,
    `- ${weekly}`,
    `- 피크 구간: ${peakRange} (참여도 ${(input.peak.engagement * 100).toFixed(1)}%)`,
    `- 저참여 구간: ${lowRange} (참여도 ${(input.low.engagement * 100).toFixed(1)}%)`,
    `- 주요 키워드: ${keywordText}`,
  ].join('\n');

  return { peakReason, lowestReason, overallSummary };
}

async function buildHeatmap(): Promise<AdminInsightHeatmapResponse> {
  const asOf = new Date().toISOString();

  const videos = await fetchTopVideos(20);
  const videoIds = videos.map((video) => video.id).filter(Boolean);
  const captions = await fetchCaptionsForVideos(videoIds);
  const captionsByVideo = pickLatestCaptions(captions);

  const result: InsightHeatmapVideo[] = [];

  for (const video of videos) {
    const videoCaptions = captionsByVideo.get(video.id) ?? [];
    const durationSec = typeof video.duration === 'number' && video.duration > 0
      ? video.duration
      : (videoCaptions[0]?.duration ?? 0);

    const { heatmapData, peakSegment, lowestSegment, keywords, peakContext } = buildSyntheticHeatmap(videoCaptions, durationSec);
    const weeklyChange = computeWeeklyChange(video.meta_history, typeof video.view_count === 'number' ? video.view_count : null);

    const analysis = buildAnalysisText({
      title: video.title || video.id,
      weeklyChange,
      peak: peakSegment,
      low: lowestSegment,
      keywords,
      peakContext,
    });

    result.push({
      videoId: video.id,
      title: video.title || video.id,
      thumbnail: video.thumbnail_url ?? null,
      publishedAt: toIsoDate(video.published_at),
      totalViews: typeof video.view_count === 'number' ? video.view_count : null,
      duration: formatDuration(durationSec),
      heatmapData,
      peakSegment,
      lowestSegment,
      weeklyChange,
      analysis: {
        peakReason: analysis.peakReason,
        lowestReason: analysis.lowestReason,
        overallSummary: analysis.overallSummary,
        keywords,
      },
    });
  }

  return { asOf, videos: result };
}

export async function getAdminInsightHeatmap(forceRefresh = false): Promise<AdminInsightHeatmapResponse> {
  if (!forceRefresh && heatmapCache && heatmapCache.expiresAt > Date.now()) {
    return heatmapCache.value;
  }

  const value = await buildHeatmap();
  heatmapCache = {
    expiresAt: Date.now() + CACHE_TTL_MS,
    value,
  };

  return value;
}
