import type { AdminInsightWordcloudResponse, AdminInsightWordcloudVideosResponse, InsightKeywordData, InsightVideoWithKeyword } from '@/types/insight';
import { createSupabaseServiceRoleClient } from '@/lib/insight/supabase';

const CACHE_TTL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 1000;

type CacheEntry<T> = {
  expiresAt: number;
  value: T;
} | null;

let keywordCache: CacheEntry<AdminInsightWordcloudResponse> = null;
const keywordVideosCache = new Map<string, CacheEntry<AdminInsightWordcloudVideosResponse>>();

type CaptionRow = {
  id: number;
  video_id: string;
  recollect_id: number;
  rank?: number | null;
  start_sec?: number | null;
  raw_caption?: string | null;
  chronological_analysis?: string | null;
  highlight_keywords?: string[] | null;
};

const STOP_WORDS = new Set([
  'a',
  'an',
  'about',
  'after',
  'all',
  'and',
  'any',
  'are',
  'as',
  'at',
  'because',
  'before',
  'both',
  'can',
  'but',
  'by',
  'could',
  'did',
  'do',
  'does',
  'doing',
  'during',
  'each',
  'either',
  'else',
  'even',
  'each',
  'few',
  'first',
  'from',
  'for',
  'from',
  'had',
  'has',
  'have',
  'her',
  'here',
  'his',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'its',
  'got',
  'get',
  'just',
  'me',
  'most',
  'my',
  'myself',
  'no',
  'not',
  'of',
  'off',
  'on',
  'or',
  'other',
  'other',
  'our',
  'out',
  'over',
  'own',
  'same',
  'same',
  'so',
  'some',
  'some',
  'such',
  'such',
  'that',
  'that',
  'the',
  'their',
  'them',
  'there',
  'these',
  'they',
  'this',
  'those',
  'through',
  'to',
  'too',
  'under',
  'until',
  'under',
  'up',
  'very',
  'very',
  'was',
  'we',
  'were',
  'what',
  'what',
  'when',
  'where',
  'which',
  'while',
  'who',
  'whom',
  'why',
  'will',
  'with',
  'without',
  'would',
  'you',
  'your',
  'yourself',
  'again',
  'also',
  'then',
  'may',
  'might',
  'must',
  'nor',
  'only',
  'than',
  'into',
  'like',
  'more',
  'near',
  'down',
  'around',
  'therefore',
  'though',
  'through',
  'exists',
  '있다',
  '있고',
  '있는',
  '그',
  '그리고',
  '그러나',
  '그럼',
  '그리고요',
  '그니까',
  '저',
  '너',
  '이',
  '그녀',
  '그의',
  '그리고서',
  '저희',
  '요',
  '안',
  '저는',
  '나는',
  '오늘',
  '너무',
  '정말',
  '그런데',
  '그러고',
  '그러니',
  '그러면서',
  '진짜',
  '아니',
  '어',
  '응',
  '이렇게',
  '저렇게',
]);

const NON_TEXT_FOOTERS = new Set([
  'raw_caption',
  'chronological_analysis',
  'highlight_keywords',
  'title',
  'is_peak',
  'duration',
  'end_time',
  'video_id',
  'char_count',
  'peak_score',
  'start_time',
  'chunk_index',
  'restaurants',
  'channel_name',
  'next_overlap',
  'prev_overlap',
  'recollect_id',
  'next',
  'prev',
  'type',
  'channel',
  'title_kor',
]);

type CaptionLikeValue = unknown;

function isStopWord(value: string): boolean {
  if (!value) return true;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length <= 1) return true;
  if (/^\d{1,4}$/.test(trimmed)) return true;
  return STOP_WORDS.has(trimmed);
}

function normalizeKeywordToken(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return normalized;
}

function flattenStringValues(value: CaptionLikeValue, out: string[]): void {
  if (!value) return;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed) out.push(trimmed);
    return;
  }

  if (Array.isArray(value)) {
    for (const nested of value) {
      flattenStringValues(nested, out);
    }
    return;
  }

  if (typeof value === 'object') {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (NON_TEXT_FOOTERS.has(key.toLowerCase())) {
        continue;
      }
      flattenStringValues(nested, out);
    }
  }
}

function extractTextFromCaptionBlob(rawText: string | null | undefined): string[] {
  if (!rawText) return [];
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) {
    return [trimmed];
  }

  try {
    const parsed = JSON.parse(trimmed);
    const out: string[] = [];
    flattenStringValues(parsed, out);
    return out.length > 0 ? out : [trimmed];
  } catch {
    return [trimmed];
  }
}

function extractKeywordsFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  const raw = text.normalize('NFKC');
  const tokens = raw.match(/[가-힣]{2,}|[a-z0-9]+(?:-[a-z0-9]+)?/gi) ?? [];
  const set = new Set<string>();

  for (const token of tokens) {
    const normalized = normalizeKeywordToken(token);
    if (!normalized) continue;
    if (isStopWord(normalized)) continue;
    set.add(normalized);
  }

  return [...set];
}

function extractKeywordsFromCaptionRow(row: CaptionRow): string[] {
  const set = new Set<string>();
  const sourceTexts: string[] = [
    ...extractTextFromCaptionBlob(row.raw_caption),
  ];

  if (Array.isArray(row.highlight_keywords)) {
    for (const keyword of row.highlight_keywords) {
      if (typeof keyword !== 'string') continue;
      sourceTexts.push(...extractTextFromCaptionBlob(keyword));
    }
  }

  if (row.chronological_analysis) {
    sourceTexts.push(row.chronological_analysis);
  }

  for (const text of sourceTexts) {
    for (const token of extractKeywordsFromText(text)) {
      set.add(token);
    }
  }

  return [...set];
}

function buildLikeSearchPattern(keyword: string): string {
  const escaped = keyword
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
  return `%${escaped}%`;
}

type VideoRow = {
  id: string;
  title?: string | null;
  published_at?: string | null;
  view_count?: number | null;
  youtube_link?: string | null;
  thumbnail_url?: string | null;
};

function toIsoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const ts = Date.parse(value);
  if (!Number.isFinite(ts)) return null;
  return new Date(ts).toISOString().slice(0, 10);
}

function safeTrim(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

async function fetchCaptionPage(from: number, to: number): Promise<CaptionRow[]> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('video_frame_captions' as never)
    .select('id,video_id,recollect_id,rank,raw_caption,chronological_analysis,highlight_keywords')
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

function buildKeywords(rows: CaptionRow[]): InsightKeywordData[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    for (const keyword of extractKeywordsFromCaptionRow(row)) {
      const normalized = normalizeKeywordToken(keyword);
      if (!normalized) continue;
      counts.set(normalized, (counts.get(normalized) || 0) + 1);
    }
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 120)
    .map(([keyword, count]) => ({
      keyword,
      count,
      trend: 'stable',
      category: '기타',
    }));
}

export async function getAdminInsightWordcloud(forceRefresh = false): Promise<AdminInsightWordcloudResponse> {
  if (!forceRefresh && keywordCache && keywordCache.expiresAt > Date.now()) {
    return keywordCache.value;
  }

  const asOf = new Date().toISOString();
  const captions = await fetchAllCaptions();
  const latest = pickLatestByVideo(captions);
  const keywords = buildKeywords(latest);

  const value: AdminInsightWordcloudResponse = { asOf, keywords };
  keywordCache = { expiresAt: Date.now() + CACHE_TTL_MS, value };
  return value;
}

async function fetchKeywordCaptions(keyword: string): Promise<CaptionRow[]> {
  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('video_frame_captions' as never)
    .select('id,video_id,recollect_id,rank,start_sec,raw_caption,chronological_analysis,highlight_keywords')
    .contains('highlight_keywords', [keyword])
    .order('rank', { ascending: true })
    .limit(80)
    .returns<CaptionRow[]>();

  if (error) {
    throw new Error(`Failed to fetch keyword captions: ${error.message}`);
  }

  return data || [];
}

async function fetchKeywordCaptionsByCaptionText(keyword: string): Promise<CaptionRow[]> {
  const supabase = createSupabaseServiceRoleClient();
  const pattern = buildLikeSearchPattern(keyword);
  const { data, error } = await supabase
    .from('video_frame_captions' as never)
    .select('id,video_id,recollect_id,rank,start_sec,raw_caption,chronological_analysis,highlight_keywords')
    .or(`raw_caption.ilike.${pattern},chronological_analysis.ilike.${pattern}`)
    .order('rank', { ascending: true })
    .limit(80)
    .returns<CaptionRow[]>();

  if (error) {
    throw new Error(`Failed to fetch keyword captions by caption text: ${error.message}`);
  }

  return data || [];
}

async function fetchVideosByIds(videoIds: string[]): Promise<Map<string, VideoRow>> {
  const map = new Map<string, VideoRow>();
  if (videoIds.length === 0) return map;

  const supabase = createSupabaseServiceRoleClient();
  const { data, error } = await supabase
    .from('videos' as never)
    .select('id,title,published_at,view_count,youtube_link,thumbnail_url')
    .in('id', videoIds)
    .returns<VideoRow[]>();

  if (error) {
    throw new Error(`Failed to fetch videos: ${error.message}`);
  }

  for (const row of data || []) {
    map.set(row.id, row);
  }

  return map;
}

function toMentionContext(row: CaptionRow): string {
  const analysis = safeTrim(row.chronological_analysis);
  if (analysis) return analysis;
  const raw = safeTrim(row.raw_caption);
  if (raw) return raw;
  return '언급 맥락을 찾지 못했습니다.';
}

export async function getAdminInsightWordcloudVideos(keyword: string, forceRefresh = false): Promise<AdminInsightWordcloudVideosResponse> {
  const normalizedKeyword = keyword.trim();
  if (!normalizedKeyword) {
    return { asOf: new Date().toISOString(), keyword: '', videos: [] };
  }

  const existing = keywordVideosCache.get(normalizedKeyword);
  if (!forceRefresh && existing && existing.expiresAt > Date.now()) {
    return existing.value;
  }

  const asOf = new Date().toISOString();
  const exactMatches = await fetchKeywordCaptions(normalizedKeyword);
  const captionTextMatches = await fetchKeywordCaptionsByCaptionText(normalizedKeyword);

  const byId = new Map<number, CaptionRow>();
  for (const row of [...exactMatches, ...captionTextMatches]) {
    byId.set(row.id, row);
  }
  const rows = [...byId.values()];
  const latest = pickLatestByVideo(rows);

  // De-dup by video_id (pick best rank per video)
  const bestByVideo = new Map<string, CaptionRow>();
  for (const row of latest) {
    if (!row.video_id) continue;
    const existingRow = bestByVideo.get(row.video_id);
    if (!existingRow || (row.rank ?? 999) < (existingRow.rank ?? 999)) {
      bestByVideo.set(row.video_id, row);
    }
  }

  const videoIds = [...bestByVideo.keys()];
  const videosById = await fetchVideosByIds(videoIds);

  const videos: InsightVideoWithKeyword[] = videoIds
    .map((videoId) => {
      const caption = bestByVideo.get(videoId);
      const meta = videosById.get(videoId);

      return {
        videoId,
        title: meta?.title || videoId,
        publishedAt: toIsoDate(meta?.published_at),
        views: typeof meta?.view_count === 'number' ? meta.view_count : null,
        thumbnail: meta?.thumbnail_url ?? null,
        youtubeLink: meta?.youtube_link ?? null,
        mentionContext: caption ? toMentionContext(caption) : '언급 맥락을 찾지 못했습니다.',
        timestampSec: typeof caption?.start_sec === 'number' ? caption.start_sec : null,
      };
    })
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
    .slice(0, 15);

  const value: AdminInsightWordcloudVideosResponse = { asOf, keyword: normalizedKeyword, videos };
  keywordVideosCache.set(normalizedKeyword, { expiresAt: Date.now() + CACHE_TTL_MS, value });

  return value;
}
