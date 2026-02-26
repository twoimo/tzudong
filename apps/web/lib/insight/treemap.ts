import { createSupabaseServiceRoleClient } from '@/lib/insight/supabase';

const CACHE_TTL_MS = 5 * 60 * 1000;
const HISTORY_CACHE_TTL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 1000;

type CacheEntry<T> = {
    expiresAt: number;
    value: T;
} | null;

type HistoryCacheEntry = {
    raw: string;
    expiresAt: number;
    value: MetricHistoryPoint[];
};

export type InsightTreemapPeriod = '1D' | '1W' | '2W' | '1M' | '3M' | '6M' | '1Y' | 'ALL';

export type InsightTreemapVideoRow = {
    id: string;
    title: string;
    publishedAt: string | null;
    category: string;
    viewCount: number;
    likeCount: number;
    commentCount: number;
    duration: number;
    previousViewCount: number | null;
    previousLikeCount: number | null;
    previousCommentCount: number | null;
    previousDuration: number | null;
};

export type InsightTreemapResponse = {
    asOf: string;
    period: InsightTreemapPeriod;
    totalVideos: number;
    videos: InsightTreemapVideoRow[];
    availablePeriods?: InsightTreemapPeriod[];
};

type VideoDbRow = {
    id: string;
    title: string | null;
    published_at: string | null;
    duration: number | string | null;
    view_count: number | string | null;
    like_count: number | string | null;
    comment_count: number | string | null;
    category: string | null;
    meta_history: unknown;
};

type MetricHistoryPoint = {
    collectedAt: number;
    views: number | null;
    likes: number | null;
    comments: number | null;
    duration: number | null;
};

type TreemapRequestOptions = {
    filterByPeriod?: boolean;
    metricMode?: TreemapMetric;
};

type TreemapMetric = 'views' | 'likes' | 'comments' | 'duration';

const CHANGE_PERIOD_OPTIONS: Exclude<InsightTreemapPeriod, 'ALL'>[] = ['1D', '1W', '2W', '1M', '3M', '6M', '1Y'];

const VIDEO_CATEGORY_BY_CODE: Record<string, string> = {
    '1': '영화/애니메이션',
    '2': '자동차',
    '10': '음악',
    '15': '동물/펫',
    '17': '스포츠',
    '19': '여행/이벤트',
    '20': '게임',
    '22': '사람/블로그',
    '23': '코미디',
    '24': '엔터테인먼트',
    '25': '뉴스/정치',
    '26': '노하우/스타일',
    '27': '교육',
    '28': '과학기술',
    '29': '비영리/사회',
    '30': '영화',
    '31': '유튜브쇼츠',
    '32': '액션/예능',
    '33': '반려동물',
    '34': '애니메이션',
    '35': '영화 리뷰',
    '36': '소셜 및 문화',
    '37': '홈/리빙',
    '38': '게임',
    '39': '애니메이션',
    '40': '스포츠',
    '41': '여행',
    '42': '패션/미용',
    '43': '엔터테인먼트',
};

const VIDEO_CATEGORY_BY_NAME: Record<string, string> = {
    'film & animation': '영화/애니메이션',
    'movies': '영화',
    'autos & vehicles': '자동차',
    'music': '음악',
    'pets & animals': '동물/펫',
    'pets': '동물/펫',
    'sports': '스포츠',
    'travel & events': '여행/이벤트',
    'gaming': '게임',
    'people & blogs': '사람/블로그',
    'comedy': '코미디',
    'entertainment': '엔터테인먼트',
    'news & politics': '뉴스/정치',
    'howto & style': '노하우/스타일',
    'education': '교육',
    'science & technology': '과학기술',
    'nonprofits & activism': '비영리/사회',
};

const periodToDays: Record<InsightTreemapPeriod, number | null> = {
    ALL: null,
    '1D': 1,
    '1W': 7,
    '2W': 14,
    '1M': 30,
    '3M': 91,
    '6M': 182,
    '1Y': 365,
};

type PeriodCoverage = {
    period: Exclude<InsightTreemapPeriod, 'ALL'>;
    count: number;
    ratio: number;
};

const videoPeriodCache = new Map<string, CacheEntry<VideoDbRow[]>>();
const historyCache = new Map<string, HistoryCacheEntry>();
const treemapResponseCache = new Map<string, CacheEntry<InsightTreemapResponse>>();
const TREEMAP_RESPONSE_CACHE_TTL_MS = 60 * 1000;


function toNonNegativeNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, value);
    }

    if (typeof value === 'string' && value.trim()) {
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    }

    return 0;
}

function parseDurationToSeconds(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return Math.max(0, Math.floor(value));
    }

    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return 0;

        const parsed = Number.parseFloat(trimmed);
        if (Number.isFinite(parsed)) {
            return Math.max(0, Math.floor(parsed));
        }

        const isoMatch = /(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i.exec(trimmed);
        if (isoMatch && trimmed.startsWith('P')) {
            const [, h, m, s] = isoMatch;
            return Number.parseInt(h ?? '0', 10) * 3600 + Number.parseInt(m ?? '0', 10) * 60 + Number.parseInt(s ?? '0', 10);
        }

        const clockMatch = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(trimmed);
        if (clockMatch) {
            const [, h, m, s] = clockMatch;
            return Number.parseInt(h, 10) * 3600 + Number.parseInt(m, 10) * 60 + Number.parseInt(s, 10);
        }

        const minuteMatch = /^(\d+):(\d{2})$/.exec(trimmed);
        if (minuteMatch) {
            const [, m, s] = minuteMatch;
            return Number.parseInt(m, 10) * 60 + Number.parseInt(s, 10);
        }
    }

    return 0;
}

function parseHistoryTimestamp(raw: unknown): number | null {
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        if (raw > 0 && raw < 10_000_000_000) {
            return Math.trunc(raw * 1000);
        }

        return Math.trunc(raw);
    }

    if (typeof raw === 'string') {
        const trimmed = raw.trim();
        if (!trimmed) return null;

        const parsed = Date.parse(trimmed);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

function parseMetaHistory(raw: unknown): MetricHistoryPoint[] {
    const resolved = (() => {
        if (typeof raw === 'string') {
            try {
                const parsed = JSON.parse(raw);
                return parsed;
            } catch {
                return raw;
            }
        }

        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
            const record = raw as Record<string, unknown>;
            if (Array.isArray(record.history)) {
                return record.history;
            }
            if (Array.isArray(record.points)) {
                return record.points;
            }
            if (Array.isArray(record.data)) {
                return record.data;
            }
        }

        return raw;
    })();

    if (!Array.isArray(resolved) || resolved.length === 0) {
        return [];
    }

    const points: MetricHistoryPoint[] = [];

    for (const row of resolved) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) {
            continue;
        }

        const record = row as Record<string, unknown>;
        const collectedAtRaw =
            (record.collected_at as unknown) ??
            (record.collectedAt as unknown) ??
            (record.timestamp as unknown) ??
            (record.date as unknown) ??
            (record.collected_at_ts as unknown) ??
            (record.collectedAtTs as unknown);

        const collectedAt = parseHistoryTimestamp(collectedAtRaw);
        if (collectedAt === null || Number.isNaN(collectedAt) || !Number.isFinite(collectedAt)) {
            continue;
        }

        points.push({
            collectedAt,
            views: toNonNegativeNumber(record.view_count ?? record.views ?? record.viewCount),
            likes: toNonNegativeNumber(record.like_count ?? record.likes ?? record.likeCount),
            comments: toNonNegativeNumber(record.comment_count ?? record.comments ?? record.commentCount),
            duration: parseDurationToSeconds(
                (record.duration as unknown) ?? (record.video_duration as unknown) ?? (record.length as unknown),
            ),
        });
    }

    return points
        .filter((point) => Number.isFinite(point.collectedAt))
        .sort((a, b) => a.collectedAt - b.collectedAt);
}

function getCachedMetaHistory(raw: unknown, videoId: string): MetricHistoryPoint[] {
    if (!videoId) {
        return parseMetaHistory(raw);
    }

    if (typeof raw !== 'string') {
        return parseMetaHistory(raw);
    }

    const now = Date.now();
    const cached = historyCache.get(videoId);
    if (cached && cached.expiresAt > now && cached.raw === raw) {
        return cached.value;
    }

    const parsed = parseMetaHistory(raw);
    historyCache.set(videoId, {
        raw,
        expiresAt: now + HISTORY_CACHE_TTL_MS,
        value: parsed,
    });

    return parsed;
}

function getHistoryMetricValue(point: MetricHistoryPoint, metric: TreemapMetric): number | null {
    if (metric === 'views') return point.views;
    if (metric === 'likes') return point.likes;
    if (metric === 'comments') return point.comments;
    return point.duration;
}

export function parseTreemapMetricMode(value: string | null): TreemapMetric {
    const normalized = value?.trim().toLowerCase() ?? '';
    if (normalized === 'likes') return 'likes';
    if (normalized === 'comments') return 'comments';
    if (normalized === 'duration') return 'duration';
    return 'views';
}

function getPreviousMetricFromHistory(
    history: MetricHistoryPoint[],
    metric: TreemapMetric,
    period: InsightTreemapPeriod,
): number | null {
    const days = periodToDays[period];
    if (!days) return null;
    if (history.length === 0) return null;

    const targetTs = Date.now() - days * 24 * 60 * 60 * 1000;
    for (let index = history.length - 1; index >= 0; index -= 1) {
        const point = history[index];
        if (point.collectedAt > targetTs) {
            continue;
        }

        const value = getHistoryMetricValue(point, metric);
        return value == null ? null : value;
    }

    return null;
}

function getLatestMetricValueFromHistory(history: MetricHistoryPoint[], metric: TreemapMetric): number | null {
    const lastPoint = history.at(-1);
    if (!lastPoint) return null;

    if (metric === 'views') return lastPoint.views;
    if (metric === 'likes') return lastPoint.likes;
    if (metric === 'comments') return lastPoint.comments;
    return lastPoint.duration;
}

function getAvailablePeriods(
    rowsWithHistory: Array<{ history: MetricHistoryPoint[]; row: VideoDbRow }>,
    metricMode: TreemapMetric,
): InsightTreemapPeriod[] {
    if (rowsWithHistory.length === 0) {
        return [];
    }

    const totals = rowsWithHistory.length;
    const now = Date.now();
    const targets = CHANGE_PERIOD_OPTIONS.map(
        (period) => now - periodToDays[period]! * 24 * 60 * 60 * 1000,
    );
    const counts = new Array<number>(CHANGE_PERIOD_OPTIONS.length).fill(0);

    for (const row of rowsWithHistory) {
        const { history } = row;
        if (history.length === 0) {
            continue;
        }

        let cursor = history.length - 1;

        for (let idx = 0; idx < CHANGE_PERIOD_OPTIONS.length; idx += 1) {
            const targetTs = targets[idx];
            while (cursor >= 0 && history[cursor].collectedAt > targetTs) {
                cursor -= 1;
            }

            if (cursor < 0) {
                break;
            }

            const value = getHistoryMetricValue(history[cursor], metricMode);
            if (value != null) {
                counts[idx] += 1;
            }
        }
    }

    const coverages: PeriodCoverage[] = CHANGE_PERIOD_OPTIONS.map((period, index) => ({
        period,
        count: counts[index],
        ratio: totals > 0 ? counts[index] / totals : 0,
    }));

    const thresholds: number[] = [1, 0.92, 0.85, 0.75, 0.65, 0.5, 0.3];
    const ordered = [...coverages].sort((a, b) => {
        const aIndex = CHANGE_PERIOD_OPTIONS.indexOf(a.period);
        const bIndex = CHANGE_PERIOD_OPTIONS.indexOf(b.period);
        return aIndex - bIndex;
    });

    const ranked = thresholds
        .map((threshold) => ordered.filter((item) => item.count > 0 && item.ratio >= threshold))
        .find((items) => items.length >= 2);

    const chosen = ranked ?? ordered.filter((item) => item.count > 0);
    const maxPeriods = 7;

    return chosen
        .slice(0, maxPeriods)
        .map((item) => item.period);
}

function normalizeTitle(title: string | null): string {
    return title?.trim() || 'Untitled';
}

function extractCategoryToken(value: string): string {
    const trimmed = value.trim();
    if (!trimmed) return '';

    let token = trimmed;

    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed) && parsed.length > 0) {
            const first = parsed[0];
            token = typeof first === 'string' ? first.trim() : String(first ?? '').trim();
        }
    } catch {
        if (trimmed.includes(',')) {
            const first = trimmed.split(',')[0]?.trim();
            if (first) {
                token = first;
            }
        }
    }

    return token;
}

function normalizeCategory(value: string | null): string {
    if (!value) return '기타';

    const token = extractCategoryToken(value);
    if (!token) return '기타';

    const fromCode = VIDEO_CATEGORY_BY_CODE[token];
    if (fromCode) return fromCode;

    const lower = token.toLowerCase();
    const fromName = VIDEO_CATEGORY_BY_NAME[lower];
    if (fromName) return fromName;

    return token;
}

export function parseTreemapPeriod(value: string | null): InsightTreemapPeriod {
    const normalized = value?.trim().toUpperCase() ?? '';
    if (normalized === '1D') return '1D';
    if (normalized === '1W') return '1W';
    if (normalized === '2W') return '2W';
    if (/^(?:[4-9]|[1-9]\d+)W$/.test(normalized)) return '1M';
    if (normalized === '1M') return '1M';
    if (normalized === '3M') return '3M';
    if (normalized === '6M') return '6M';
    if (normalized === '1Y') return '1Y';
    return 'ALL';
}

function getPeriodCutoff(period: InsightTreemapPeriod): Date | null {
    const days = periodToDays[period];
    if (!days) return null;

    const date = new Date();
    date.setDate(date.getDate() - days);
    date.setHours(0, 0, 0, 0);
    return date;
}

async function fetchVideosFromSupabase(period: InsightTreemapPeriod = 'ALL'): Promise<VideoDbRow[]> {
    const supabase = createSupabaseServiceRoleClient();
    const rows: VideoDbRow[] = [];
    let page = 0;
    const cutoff = getPeriodCutoff(period);
    const cutoffValue = cutoff?.toISOString() ?? null;

    while (true) {
        const from = page * PAGE_SIZE;
        const to = from + PAGE_SIZE - 1;

        let query = supabase
            .from('videos')
            .select('id,title,published_at,duration,view_count,like_count,comment_count,category,meta_history')
            .order('published_at', { ascending: false, nullsFirst: false });

        if (cutoffValue) {
            query = query.gte('published_at', cutoffValue);
        }

        const { data, error } = await query.range(from, to);

        if (error) {
            throw new Error(`Failed to fetch videos: ${error.message}`);
        }

        if (data && data.length > 0) {
            rows.push(...(data as VideoDbRow[]));
        }

        if (!data || data.length < PAGE_SIZE) {
            break;
        }

        page += 1;
    }

    return rows;
}

function cacheOrFetchVideos(period: InsightTreemapPeriod = 'ALL'): Promise<VideoDbRow[]> {
    const cacheKey = period;
    const cached = videoPeriodCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now() && cached.value) {
        return Promise.resolve(cached.value);
    }

    return fetchVideosFromSupabase(period).then((rows) => {
        videoPeriodCache.set(cacheKey, {
            expiresAt: Date.now() + CACHE_TTL_MS,
            value: rows,
        });

        return rows;
    });
}

export function getTreemapMetricValue(
    row: VideoDbRow,
    metric: 'views' | 'likes' | 'comments' | 'duration',
): number {
    if (metric === 'views') return toNonNegativeNumber(row.view_count);
    if (metric === 'likes') return toNonNegativeNumber(row.like_count);
    if (metric === 'comments') return toNonNegativeNumber(row.comment_count);
    return Math.floor(toNonNegativeNumber(row.duration));
}

export async function getInsightTreemapData(
    period: InsightTreemapPeriod,
    options: TreemapRequestOptions = {},
): Promise<InsightTreemapResponse> {
    const { filterByPeriod = true, metricMode = 'views' } = options;
    const now = Date.now();
    const responseCacheKey = `${filterByPeriod ? 'filtered' : 'change'}:${period}:${metricMode}`;
    const cachedResponse = treemapResponseCache.get(responseCacheKey);
    if (cachedResponse && cachedResponse.expiresAt > now) {
        return cachedResponse.value;
    }

    const rows = await cacheOrFetchVideos(filterByPeriod ? period : 'ALL');

    const result: InsightTreemapResponse = (() => {
        if (filterByPeriod) {
            const videos: InsightTreemapVideoRow[] = rows.map((row) => ({
                id: row.id,
                title: normalizeTitle(row.title),
                publishedAt: row.published_at,
                category: normalizeCategory(row.category),
                viewCount: toNonNegativeNumber(row.view_count),
                likeCount: toNonNegativeNumber(row.like_count),
                commentCount: toNonNegativeNumber(row.comment_count),
                duration: parseDurationToSeconds(row.duration),
                previousViewCount: null,
                previousLikeCount: null,
                previousCommentCount: null,
                previousDuration: null,
            }));

            return {
                asOf: new Date().toISOString(),
                period,
                totalVideos: videos.length,
                videos,
                availablePeriods: [],
            };
        }

        const rowsWithHistory = rows.map((row) => ({
            row,
            history: getCachedMetaHistory(row.meta_history, row.id),
        }));
        const availablePeriods = getAvailablePeriods(rowsWithHistory, metricMode);

        const videos: InsightTreemapVideoRow[] = rowsWithHistory.map(({ row, history }) => ({
            id: row.id,
            title: normalizeTitle(row.title),
            publishedAt: row.published_at,
            category: normalizeCategory(row.category),
            viewCount: getLatestMetricValueFromHistory(history, 'views') ?? toNonNegativeNumber(row.view_count),
            likeCount: getLatestMetricValueFromHistory(history, 'likes') ?? toNonNegativeNumber(row.like_count),
            commentCount: getLatestMetricValueFromHistory(history, 'comments') ?? toNonNegativeNumber(row.comment_count),
            duration: parseDurationToSeconds(row.duration),
            previousViewCount: getPreviousMetricFromHistory(history, 'views', period),
            previousLikeCount: getPreviousMetricFromHistory(history, 'likes', period),
            previousCommentCount: getPreviousMetricFromHistory(history, 'comments', period),
            previousDuration: getPreviousMetricFromHistory(history, 'duration', period),
        }));

        return {
            asOf: new Date().toISOString(),
            period,
            totalVideos: videos.length,
            videos,
            availablePeriods,
        };
    })();

    treemapResponseCache.set(responseCacheKey, {
        expiresAt: now + TREEMAP_RESPONSE_CACHE_TTL_MS,
        value: result,
    });

    return result;
}

