import type { AdminInsightSeasonResponse, InsightMonthlySeasonData, InsightSeasonalKeyword } from '@/types/insight';
import { createSupabaseServiceRoleClient } from '@/lib/insight/supabase';

const CACHE_TTL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 1000;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
} | null;

let seasonCache: CacheEntry<AdminInsightSeasonResponse> = null;

type CaptionRow = {
  id: number;
  video_id: string;
  recollect_id: number;
  highlight_keywords?: string[] | null;
};

type VideoRow = {
  id: string;
  title?: string | null;
  published_at?: string | null;
};

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function toMonthName(month: number): string {
  return `${month}월`;
}

function getWeekOfMonth(day: number): number {
  return clamp(Math.floor((day - 1) / 7) + 1, 1, 5);
}

function pickIcon(keyword: string): string {
  const map: Record<string, string> = {
    '딸기': '🍓',
    '초콜릿': '🍫',
    '치킨': '🍗',
    '케이크': '🎂',
    '굴': '🦪',
    '빙수': '🍧',
    '수박': '🍉',
    '라면': '🍜',
    '국밥': '🍲',
    '삼겹살': '🥩',
    '초밥': '🍣',
    '회': '🐟',
    '전복': '🦪',
    '대게': '🦀',
    '크리스마스': '🎄',
  };
  return map[keyword] || '🍽️';
}

async function fetchVideoPage(from: number, to: number): Promise<VideoRow[]> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('videos' as never)
    .select('id,title,published_at,channel_name,is_shorts')
    .eq('channel_name', 'tzuyang')
    .eq('is_shorts', false)
    .order('published_at', { ascending: false })
    .range(from, to)
    .returns<VideoRow[]>();

  if (error) {
    throw new Error(`Failed to fetch videos: ${error.message}`);
  }

  return data || [];
}

async function fetchAllVideos(): Promise<VideoRow[]> {
  const rows: VideoRow[] = [];
  let page = 0;

  while (true) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const chunk = await fetchVideoPage(from, to);
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
    page += 1;
  }

  return rows;
}

async function fetchCaptionPage(from: number, to: number): Promise<CaptionRow[]> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('video_frame_captions' as never)
    .select('id,video_id,recollect_id,highlight_keywords')
    .order('id', { ascending: true })
    .range(from, to)
    .returns<CaptionRow[]>();

  if (error) {
    throw new Error(`Failed to fetch captions: ${error.message}`);
  }

  return data || [];
}

async function fetchAllCaptions(): Promise<CaptionRow[]> {
  const rows: CaptionRow[] = [];
  let page = 0;

  while (true) {
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const chunk = await fetchCaptionPage(from, to);
    rows.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
    page += 1;
  }

  return rows;
}

function pickLatestByVideo(rows: CaptionRow[]): CaptionRow[] {
  const maxRecollectByVideo = new Map<string, number>();
  for (const row of rows) {
    if (!row.video_id) continue;
    const current = maxRecollectByVideo.get(row.video_id) ?? -1;
    if (row.recollect_id > current) maxRecollectByVideo.set(row.video_id, row.recollect_id);
  }

  return rows.filter((row) => maxRecollectByVideo.get(row.video_id) === row.recollect_id);
}

function toNextOccurrenceDate(month: number, day: number, now: Date): Date {
  const year = now.getUTCFullYear();
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getTime() >= Date.UTC(year, now.getUTCMonth(), now.getUTCDate())) {
    return candidate;
  }
  return new Date(Date.UTC(year + 1, month - 1, day));
}

function formatKoreanMonthDay(date: Date): string {
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return `${month}월 ${day}일`;
}

function buildSeasonData(input: {
  videos: VideoRow[];
  captions: CaptionRow[];
  now: Date;
}): InsightMonthlySeasonData[] {
  const videoMeta = new Map<string, { title: string; publishedAt: Date | null }>();
  for (const row of input.videos) {
    const title = row.title || row.id;
    const publishedAt = row.published_at ? new Date(row.published_at) : null;
    videoMeta.set(row.id, { title, publishedAt: publishedAt && Number.isFinite(publishedAt.getTime()) ? publishedAt : null });
  }

  type KeywordStats = {
    count: number;
    days: Map<number, number>;
    weeks: Map<number, number>;
    videoTitles: Set<string>;
    yearMonthCounts: Map<string, number>; // YYYY-MM -> count
  };

  const monthKeywordMap = new Map<number, Map<string, KeywordStats>>();

  for (const row of input.captions) {
    const meta = videoMeta.get(row.video_id);
    const publishedAt = meta?.publishedAt ?? null;
    if (!publishedAt) continue;
    if (!Array.isArray(row.highlight_keywords)) continue;

    const month = publishedAt.getUTCMonth() + 1;
    const day = publishedAt.getUTCDate();
    const week = getWeekOfMonth(day);
    const yearMonthKey = `${publishedAt.getUTCFullYear()}-${String(month).padStart(2, '0')}`;

    const keywordMap = monthKeywordMap.get(month) ?? new Map<string, KeywordStats>();

    for (const keywordRaw of row.highlight_keywords) {
      if (typeof keywordRaw !== 'string') continue;
      const keyword = keywordRaw.trim();
      if (!keyword) continue;

      const stats = keywordMap.get(keyword) ?? {
        count: 0,
        days: new Map<number, number>(),
        weeks: new Map<number, number>(),
        videoTitles: new Set<string>(),
        yearMonthCounts: new Map<string, number>(),
      };

      stats.count += 1;
      stats.days.set(day, (stats.days.get(day) || 0) + 1);
      stats.weeks.set(week, (stats.weeks.get(week) || 0) + 1);
      if (meta?.title) stats.videoTitles.add(meta.title);
      stats.yearMonthCounts.set(yearMonthKey, (stats.yearMonthCounts.get(yearMonthKey) || 0) + 1);

      keywordMap.set(keyword, stats);
    }

    monthKeywordMap.set(month, keywordMap);
  }

  const months: InsightMonthlySeasonData[] = [];
  const currentYear = input.now.getUTCFullYear();

  for (let month = 1; month <= 12; month += 1) {
    const keywordMap = monthKeywordMap.get(month) ?? new Map<string, KeywordStats>();
    const top = [...keywordMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 6);

    const keywords: InsightSeasonalKeyword[] = top.map(([keyword, stats]) => {
      const peakDays = [...stats.days.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([day]) => day)
        .sort((a, b) => a - b);

      const peakWeekEntry = [...stats.weeks.entries()].sort((a, b) => b[1] - a[1])[0];
      const peakWeek = peakWeekEntry ? `${month}월 ${peakWeekEntry[0]}주차` : `${month}월`;

      const yearMonthThis = `${currentYear}-${String(month).padStart(2, '0')}`;
      const yearMonthPrev = `${currentYear - 1}-${String(month).padStart(2, '0')}`;

      const thisCount = stats.yearMonthCounts.get(yearMonthThis) || 0;
      const prevCount = stats.yearMonthCounts.get(yearMonthPrev) || 0;
      const lastYearGrowth = prevCount > 0 ? Math.round(((thisCount - prevCount) / prevCount) * 100) : null;

      const bestDay = peakDays[0] ?? 15;
      const uploadDate = toNextOccurrenceDate(month, bestDay, input.now);
      const shootDate = new Date(uploadDate.getTime() - 6 * 24 * 60 * 60 * 1000);

      return {
        keyword,
        category: '기타',
        peakWeek,
        lastYearGrowth,
        predictedGrowth: lastYearGrowth,
        recommendedUploadDate: formatKoreanMonthDay(uploadDate),
        recommendedShootDate: formatKoreanMonthDay(shootDate),
        relatedVideos: [...stats.videoTitles].slice(0, 3),
        icon: pickIcon(keyword),
        peakDays,
      };
    });

    months.push({
      month,
      monthName: toMonthName(month),
      keywords,
    });
  }

  return months;
}

async function buildSeason(): Promise<AdminInsightSeasonResponse> {
  const asOf = new Date().toISOString();
  const now = new Date();

  const [videos, captions] = await Promise.all([
    fetchAllVideos(),
    fetchAllCaptions(),
  ]);

  const latestCaptions = pickLatestByVideo(captions);
  const months = buildSeasonData({ videos, captions: latestCaptions, now });

  return { asOf, months };
}

export async function getAdminInsightSeason(forceRefresh = false): Promise<AdminInsightSeasonResponse> {
  if (!forceRefresh && seasonCache && seasonCache.expiresAt > Date.now()) {
    return seasonCache.value;
  }

  const value = await buildSeason();
  seasonCache = { expiresAt: Date.now() + CACHE_TTL_MS, value };
  return value;
}
