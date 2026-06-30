import { createClient } from '@supabase/supabase-js';

const CACHE_TTL_MS = 5 * 60 * 1000;
const HISTORY_CACHE_TTL_MS = 5 * 60 * 1000;
const PAGE_SIZE = 1000;
const MAX_PUBLIC_TREEMAP_ROWS = 500;

type CacheEntry<T> = {
    expiresAt: number;
    value: T;
} | null;

type HistoryCacheEntry = {
    raw: string;
    expiresAt: number;
    value: MetricHistoryPoint[];
};

export type InsightTreemapPeriod = '30MIN' | '1H' | '6H' | '12H' | '1D' | '1W' | '2W' | '1M' | '3M' | '6M' | '1Y' | 'ALL';

export type InsightTreemapDataQualityReason =
    | 'clamped_metric'
    | 'missing_metric'
    | 'negative_delta'
    | 'extreme_spike'
    | 'iqr_outlier'
    | 'dominates_total'
    | 'duplicate_video'
    | 'missing_previous'
    | 'low_comparison_coverage'
    | 'stale_snapshot'
    | 'fallback_source'
    | 'live_no_comparison'
    | 'row_cap'
    | 'delta_conflict';

export type InsightTreemapDataQualitySeverity = 'info' | 'warning' | 'risk';

export type InsightTreemapMetricKey =
    | 'views'
    | 'likes'
    | 'comments'
    | 'duration'
    | 'subscribers'
    | 'videos'
    | 'channel_views';

export type InsightTreemapMetricNormalizationReason = {
    reason: Extract<InsightTreemapDataQualityReason, 'clamped_metric' | 'missing_metric'>;
    metric: InsightTreemapMetricKey;
    rawValue: string | number | null;
    normalizedValue: number | null;
};

export type InsightTreemapQualityFlag = {
    reason: InsightTreemapDataQualityReason;
    severity: InsightTreemapDataQualitySeverity;
    metric?: InsightTreemapMetricKey;
    source?: InsightTreemapDataSource;
    videoId?: string;
    value?: number | null;
    threshold?: number | null;
    count?: number | null;
};

export type InsightTreemapQualityReasonCount = {
    reason: InsightTreemapDataQualityReason;
    severity: InsightTreemapDataQualitySeverity;
    count: number;
};

export type InsightTreemapDataQualityStatus = 'ok' | 'watch' | 'risk';

export type InsightTreemapDataQualitySummary = {
    status: InsightTreemapDataQualityStatus;
    flags: InsightTreemapQualityFlag[];
    reasonCounts: InsightTreemapQualityReasonCount[];
    thresholds: typeof YOUTUBE_KPI_DATA_QUALITY_THRESHOLDS;
};

export type InsightTreemapAnomalySummary = {
    totalFlags: number;
    flags: InsightTreemapQualityFlag[];
    reasonCounts: InsightTreemapQualityReasonCount[];
};

export const YOUTUBE_KPI_DATA_QUALITY_THRESHOLDS = {
    highComparisonCoverageRatio: 0.9,
    lowComparisonCoverageRatio: 0.5,
    dominantContributionRatio: 0.7,
    extremeMedianMultiple: 20,
    iqrOutlierMultiplier: 1.5,
    minimumIqrSampleSize: 4,
    staleSnapshotHours: 2,
    rowCap: MAX_PUBLIC_TREEMAP_ROWS,
} as const;

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
    comparisonStatus?: 'compared' | 'new' | 'missing_previous' | 'not_applicable';
    qualityFlags?: InsightTreemapQualityFlag[];
    anomalyFlags?: InsightTreemapQualityFlag[];
    normalizedMetricReasons?: InsightTreemapMetricNormalizationReason[];
};

export type InsightTreemapDataSource =
    | 'youtube-snapshot'
    | 'youtube-live'
    | 'supabase-treemap'
    | 'public-treemap-fallback';

export type InsightTreemapComparisonCoverage = {
    latestBucketStartedAt?: string | null;
    comparisonBucketStartedAt?: string | null;
    totalVideos: number;
    comparedVideos: number;
    newVideos: number;
    missingPreviousVideos: number;
    comparisonAvailable: boolean;
};
export function buildInsightTreemapComparisonCoverageFromVideos(
    videos: InsightTreemapVideoRow[],
    latestBucketStartedAt: string,
    comparisonBucketStartedAt: string | null,
): InsightTreemapComparisonCoverage {
    let comparedVideos = 0;
    let newVideos = 0;
    let missingPreviousVideos = 0;

    if (comparisonBucketStartedAt) {
        for (const video of videos) {
            if (video.comparisonStatus === 'compared') {
                comparedVideos += 1;
            } else if (video.comparisonStatus === 'new') {
                newVideos += 1;
            } else {
                missingPreviousVideos += 1;
            }
        }
    }

    return {
        latestBucketStartedAt,
        comparisonBucketStartedAt,
        totalVideos: videos.length,
        comparedVideos,
        newVideos,
        missingPreviousVideos,
        comparisonAvailable: Boolean(comparisonBucketStartedAt && comparedVideos > 0),
    };
}


export type InsightTreemapResponseMeta = {
    dataSource: InsightTreemapDataSource;
    latestBucketStartedAt?: string | null;
    comparisonBucketStartedAt?: string | null;
    comparisonCoverage?: InsightTreemapComparisonCoverage;
    fallbackReasonCode?: string | null;
    fallbackSource?: string | null;
    dataQuality?: InsightTreemapDataQualitySummary;
    anomalySummary?: InsightTreemapAnomalySummary;
};

export type InsightTreemapResponse = {
    asOf: string;
    period: InsightTreemapPeriod;
    totalVideos: number;
    videos: InsightTreemapVideoRow[];
    availablePeriods?: InsightTreemapPeriod[];
    meta?: InsightTreemapResponseMeta;
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

const CHANGE_PERIOD_OPTIONS: Exclude<InsightTreemapPeriod, 'ALL'>[] = ['30MIN', '1H', '6H', '12H', '1D', '1W', '2W', '1M', '3M', '6M', '1Y'];

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

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const periodToMilliseconds: Record<Exclude<InsightTreemapPeriod, 'ALL'>, number> = {
    '30MIN': 30 * MINUTE_MS,
    '1H': HOUR_MS,
    '6H': 6 * HOUR_MS,
    '12H': 12 * HOUR_MS,
    '1D': DAY_MS,
    '1W': 7 * DAY_MS,
    '2W': 14 * DAY_MS,
    '1M': 30 * DAY_MS,
    '3M': 91 * DAY_MS,
    '6M': 182 * DAY_MS,
    '1Y': 365 * DAY_MS,
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


function toMetricRawValue(value: unknown): string | number | null {
    if (typeof value === 'number' || typeof value === 'string') return value;
    return null;
}
const PLAIN_NUMERIC_METRIC_PATTERN = /^[+-]?\d+(?:\.\d+)?$/;
const GROUPED_NUMERIC_METRIC_PATTERN = /^[+-]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/;

function parseInsightTreemapMetricNumber(value: unknown) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : Number.NaN;
    if (typeof value !== 'string') return Number.NaN;

    const trimmed = value.trim();
    if (!trimmed) return Number.NaN;

    const isValidNumeric =
        PLAIN_NUMERIC_METRIC_PATTERN.test(trimmed) ||
        GROUPED_NUMERIC_METRIC_PATTERN.test(trimmed);
    if (!isValidNumeric) return Number.NaN;

    return Number(trimmed.replace(/,/g, ''));
}

function isInsightTreemapMissingMetric(value: unknown) {
    return value == null || (typeof value === 'string' && value.trim() === '');
}


export function normalizeInsightTreemapMetric(
    value: unknown,
    metric: InsightTreemapMetricKey,
): { value: number; reasons: InsightTreemapMetricNormalizationReason[] } {
    const parsed = parseInsightTreemapMetricNumber(value);
    const normalizedValue = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    const reason: InsightTreemapMetricNormalizationReason['reason'] | null =
        isInsightTreemapMissingMetric(value)
            ? 'missing_metric'
            : !Number.isFinite(parsed) || parsed < 0
              ? 'clamped_metric'
              : null;
    const reasons: InsightTreemapMetricNormalizationReason[] = reason
        ? [
              {
                  reason,
                  metric,
                  rawValue: toMetricRawValue(value),
                  normalizedValue,
              },
          ]
        : [];

    return { value: normalizedValue, reasons };
}

function toNonNegativeNumber(value: unknown, metric: InsightTreemapMetricKey = 'views'): number {
    return normalizeInsightTreemapMetric(value, metric).value;
}

function buildNormalizedMetricReasons(
    metrics: Array<{ value: unknown; metric: InsightTreemapMetricKey }>,
): InsightTreemapMetricNormalizationReason[] {
    return metrics.flatMap(({ value, metric }) =>
        normalizeInsightTreemapMetric(value, metric).reasons,
    );
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
    const durationMs = getPeriodDurationMs(period);
    if (!durationMs) return null;
    if (history.length === 0) return null;

    const targetTs = Date.now() - durationMs;
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

function getComparisonStatusFromHistory(
    row: VideoDbRow,
    previousValue: number | null,
    period: InsightTreemapPeriod,
): InsightTreemapVideoRow['comparisonStatus'] {
    if (previousValue != null) return 'compared';

    const durationMs = getPeriodDurationMs(period);
    if (!durationMs) return 'not_applicable';

    const publishedAtMs = row.published_at ? Date.parse(row.published_at) : Number.NaN;
    const comparisonTargetMs = Date.now() - durationMs;
    if (Number.isFinite(publishedAtMs) && publishedAtMs > comparisonTargetMs) {
        return 'new';
    }

    return 'missing_previous';
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
        (period) => now - periodToMilliseconds[period],
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
    if (normalized === '30MIN' || normalized === '30M' || normalized === '30분') return '30MIN';
    if (normalized === '1H' || normalized === '1시간') return '1H';
    if (normalized === '6H' || normalized === '6시간') return '6H';
    if (normalized === '12H' || normalized === '12시간') return '12H';
    if (normalized === '1D' || normalized === '1일') return '1D';
    if (normalized === '1W') return '1W';
    if (normalized === '2W') return '2W';
    if (/^(?:[4-9]|[1-9]\d+)W$/.test(normalized)) return '1M';
    if (normalized === '1M') return '1M';
    if (normalized === '3M') return '3M';
    if (normalized === '6M') return '6M';
    if (normalized === '1Y') return '1Y';
    return 'ALL';
}

function getPeriodDurationMs(period: InsightTreemapPeriod): number | null {
    if (period === 'ALL') return null;
    return periodToMilliseconds[period] ?? null;
}

function getPeriodCutoff(period: InsightTreemapPeriod): Date | null {
    const durationMs = getPeriodDurationMs(period);
    if (!durationMs) return null;

    return new Date(Date.now() - durationMs);
}

function createPublicTreemapSupabaseClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseAnonKey) {
        throw new Error('Supabase environment variables are missing (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY).');
    }

    return createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false,
        },
    });
}

async function fetchVideosFromSupabase(period: InsightTreemapPeriod = 'ALL'): Promise<VideoDbRow[]> {
    const supabase = createPublicTreemapSupabaseClient();
    const rows: VideoDbRow[] = [];
    let page = 0;
    const cutoff = getPeriodCutoff(period);
    const cutoffValue = cutoff?.toISOString() ?? null;

    while (rows.length < MAX_PUBLIC_TREEMAP_ROWS) {
        const from = page * PAGE_SIZE;
        const remaining = MAX_PUBLIC_TREEMAP_ROWS - rows.length;
        const to = from + Math.min(PAGE_SIZE, remaining) - 1;

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

function getInsightTreemapDefaultSeverity(
    reason: InsightTreemapDataQualityReason,
): InsightTreemapDataQualitySeverity {
    if (
        reason === 'extreme_spike' ||
        reason === 'iqr_outlier' ||
        reason === 'dominates_total' ||
        reason === 'delta_conflict'
    ) {
        return 'risk';
    }

    if (
        reason === 'clamped_metric' ||
        reason === 'missing_metric' ||
        reason === 'duplicate_video' ||
        reason === 'negative_delta' ||
        reason === 'low_comparison_coverage' ||
        reason === 'stale_snapshot' ||
        reason === 'fallback_source' ||
        reason === 'live_no_comparison' ||
        reason === 'row_cap'
    ) {
        return 'warning';
    }

    return 'info';
}

export function createInsightTreemapQualityFlag(
    reason: InsightTreemapDataQualityReason,
    options: Omit<Partial<InsightTreemapQualityFlag>, 'reason'> = {},
): InsightTreemapQualityFlag {
    return {
        reason,
        severity: options.severity ?? getInsightTreemapDefaultSeverity(reason),
        metric: options.metric,
        source: options.source,
        videoId: options.videoId,
        value: options.value,
        threshold: options.threshold,
        count: options.count,
    };
}

function getInsightTreemapSeverityRank(severity: InsightTreemapDataQualitySeverity) {
    if (severity === 'risk') return 3;
    if (severity === 'warning') return 2;
    return 1;
}

function getInsightTreemapFlagKey(flag: InsightTreemapQualityFlag) {
    return [
        flag.reason,
        flag.severity,
        flag.metric ?? '',
        flag.source ?? '',
        flag.videoId ?? '',
        flag.value ?? '',
        flag.threshold ?? '',
        flag.count ?? '',
    ].join(':');
}

function uniqueInsightTreemapFlags(flags: InsightTreemapQualityFlag[]) {
    const seen = new Set<string>();
    return flags.filter((flag) => {
        const key = getInsightTreemapFlagKey(flag);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function summarizeInsightTreemapReasonCounts(
    flags: InsightTreemapQualityFlag[],
): InsightTreemapQualityReasonCount[] {
    const countByReason = new Map<
        InsightTreemapDataQualityReason,
        InsightTreemapQualityReasonCount
    >();

    for (const flag of flags) {
        const existing = countByReason.get(flag.reason);
        if (!existing) {
            countByReason.set(flag.reason, {
                reason: flag.reason,
                severity: flag.severity,
                count: 1,
            });
            continue;
        }

        existing.count += 1;
        if (
            getInsightTreemapSeverityRank(flag.severity) >
            getInsightTreemapSeverityRank(existing.severity)
        ) {
            existing.severity = flag.severity;
        }
    }

    return [...countByReason.values()].sort(
        (a, b) =>
            getInsightTreemapSeverityRank(b.severity) -
                getInsightTreemapSeverityRank(a.severity) ||
            b.count - a.count ||
            a.reason.localeCompare(b.reason),
    );
}

function getInsightTreemapDataQualityStatus(
    flags: InsightTreemapQualityFlag[],
): InsightTreemapDataQualityStatus {
    if (flags.some((flag) => flag.severity === 'risk')) return 'risk';
    if (flags.some((flag) => flag.severity === 'warning')) return 'watch';
    return 'ok';
}

export function buildInsightTreemapDataQualitySummary(
    flags: InsightTreemapQualityFlag[],
): InsightTreemapDataQualitySummary {
    const uniqueFlags = uniqueInsightTreemapFlags(flags);
    return {
        status: getInsightTreemapDataQualityStatus(uniqueFlags),
        flags: uniqueFlags,
        reasonCounts: summarizeInsightTreemapReasonCounts(uniqueFlags),
        thresholds: YOUTUBE_KPI_DATA_QUALITY_THRESHOLDS,
    };
}

function isInsightTreemapAnomalyReason(reason: InsightTreemapDataQualityReason) {
    return (
        reason === 'extreme_spike' ||
        reason === 'iqr_outlier' ||
        reason === 'dominates_total'
    );
}

export function buildInsightTreemapAnomalySummary(
    flags: InsightTreemapQualityFlag[],
): InsightTreemapAnomalySummary {
    const anomalyFlags = uniqueInsightTreemapFlags(
        flags.filter((flag) => isInsightTreemapAnomalyReason(flag.reason)),
    );
    return {
        totalFlags: anomalyFlags.length,
        flags: anomalyFlags,
        reasonCounts: summarizeInsightTreemapReasonCounts(anomalyFlags),
    };
}

function getMedianMetricValue(values: number[]) {
    const finiteValues = values
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);
    if (finiteValues.length === 0) return 0;

    const midpoint = Math.floor(finiteValues.length / 2);
    if (finiteValues.length % 2 === 1) return finiteValues[midpoint] ?? 0;
    return ((finiteValues[midpoint - 1] ?? 0) + (finiteValues[midpoint] ?? 0)) / 2;
}
function getQuantileMetricValue(values: number[], quantile: number) {
    const finiteValues = values
        .filter((value) => Number.isFinite(value))
        .sort((a, b) => a - b);
    if (finiteValues.length === 0) return 0;

    const position = (finiteValues.length - 1) * quantile;
    const lowerIndex = Math.floor(position);
    const upperIndex = Math.ceil(position);
    const lowerValue = finiteValues[lowerIndex] ?? 0;
    const upperValue = finiteValues[upperIndex] ?? lowerValue;
    return lowerValue + (upperValue - lowerValue) * (position - lowerIndex);
}

function getIqrOutlierUpperFence(values: number[]) {
    const finiteValues = values.filter((value) => Number.isFinite(value));
    if (finiteValues.length < YOUTUBE_KPI_DATA_QUALITY_THRESHOLDS.minimumIqrSampleSize) {
        return null;
    }

    const firstQuartile = getQuantileMetricValue(finiteValues, 0.25);
    const thirdQuartile = getQuantileMetricValue(finiteValues, 0.75);
    const iqr = thirdQuartile - firstQuartile;
    if (iqr <= 0) return null;

    return (
        thirdQuartile +
        iqr * YOUTUBE_KPI_DATA_QUALITY_THRESHOLDS.iqrOutlierMultiplier
    );
}

type InsightTreemapVideoCandidate = {
    video: InsightTreemapVideoRow;
    originalIndex: number;
};

function isFiniteMetricValue(value: number | null | undefined): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function hasUsableText(value: string | null | undefined) {
    return Boolean(value?.trim());
}

function getInsightTreemapPublishedAtMs(video: InsightTreemapVideoRow) {
    const publishedAtMs = video.publishedAt ? Date.parse(video.publishedAt) : 0;
    return Number.isFinite(publishedAtMs) ? publishedAtMs : 0;
}

function hasCleanCurrentMetric(
    video: InsightTreemapVideoRow,
    metric: InsightTreemapMetricKey,
    value: number,
) {
    return (
        Number.isFinite(value) &&
        !(video.normalizedMetricReasons ?? []).some(
            (reason) => reason.metric === metric,
        )
    );
}

function getInsightTreemapVideoCompletenessScore(video: InsightTreemapVideoRow) {
    let score = 0;

    if (hasUsableText(video.title) && video.title.trim() !== '제목 없음') score += 1;
    if (getInsightTreemapPublishedAtMs(video) > 0) score += 1;
    if (hasUsableText(video.category)) score += 1;
    if (hasCleanCurrentMetric(video, 'views', video.viewCount)) score += 1;
    if (hasCleanCurrentMetric(video, 'likes', video.likeCount)) score += 1;
    if (hasCleanCurrentMetric(video, 'comments', video.commentCount)) score += 1;
    if (hasCleanCurrentMetric(video, 'duration', video.duration)) score += 1;
    if (isFiniteMetricValue(video.previousViewCount)) score += 1;
    if (isFiniteMetricValue(video.previousLikeCount)) score += 1;
    if (isFiniteMetricValue(video.previousCommentCount)) score += 1;
    if (video.comparisonStatus && video.comparisonStatus !== 'not_applicable') score += 1;

    return score;
}

function compareInsightTreemapVideoCandidates(
    left: InsightTreemapVideoCandidate,
    right: InsightTreemapVideoCandidate,
) {
    const completenessDelta =
        getInsightTreemapVideoCompletenessScore(left.video) -
        getInsightTreemapVideoCompletenessScore(right.video);
    if (completenessDelta !== 0) return completenessDelta;

    const viewDelta = left.video.viewCount - right.video.viewCount;
    if (viewDelta !== 0) return viewDelta;

    const likeDelta = left.video.likeCount - right.video.likeCount;
    if (likeDelta !== 0) return likeDelta;

    const commentDelta = left.video.commentCount - right.video.commentCount;
    if (commentDelta !== 0) return commentDelta;

    const publishedAtDelta =
        getInsightTreemapPublishedAtMs(left.video) -
        getInsightTreemapPublishedAtMs(right.video);
    if (publishedAtDelta !== 0) return publishedAtDelta;

    return right.originalIndex - left.originalIndex;
}

function mergeInsightTreemapVideoAnnotations(
    primary: InsightTreemapVideoRow,
    secondary: InsightTreemapVideoRow,
): InsightTreemapVideoRow {
    const qualityFlags = uniqueInsightTreemapFlags([
        ...(primary.qualityFlags ?? []),
        ...(secondary.qualityFlags ?? []),
    ]);
    const anomalyFlags = uniqueInsightTreemapFlags([
        ...(primary.anomalyFlags ?? []),
        ...(secondary.anomalyFlags ?? []),
    ]);
    const normalizedMetricReasons = [
        ...(primary.normalizedMetricReasons ?? []),
        ...(secondary.normalizedMetricReasons ?? []),
    ];

    return {
        ...primary,
        ...(qualityFlags.length > 0 ? { qualityFlags } : {}),
        ...(anomalyFlags.length > 0 ? { anomalyFlags } : {}),
        ...(normalizedMetricReasons.length > 0 ? { normalizedMetricReasons } : {}),
    };
}

export function preprocessInsightTreemapVideos(
    videos: InsightTreemapVideoRow[],
    source?: InsightTreemapDataSource,
): InsightTreemapVideoRow[] {
    const orderedIds: string[] = [];
    const grouped = new Map<
        string,
        {
            candidate: InsightTreemapVideoCandidate;
            output: InsightTreemapVideoRow;
            count: number;
        }
    >();

    for (const [originalIndex, video] of videos.entries()) {
        const existing = grouped.get(video.id);
        if (!existing) {
            grouped.set(video.id, {
                candidate: { video, originalIndex },
                output: video,
                count: 1,
            });
            orderedIds.push(video.id);
            continue;
        }

        const incomingCandidate = { video, originalIndex };
        if (
            compareInsightTreemapVideoCandidates(
                incomingCandidate,
                existing.candidate,
            ) > 0
        ) {
            existing.candidate = incomingCandidate;
            existing.output = mergeInsightTreemapVideoAnnotations(
                incomingCandidate.video,
                existing.output,
            );
        } else {
            existing.output = mergeInsightTreemapVideoAnnotations(
                existing.output,
                incomingCandidate.video,
            );
        }
        existing.count += 1;
    }

    return orderedIds.map((id) => {
        const group = grouped.get(id);
        if (!group) {
            throw new Error(`missing-preprocessed-video:${id}`);
        }

        const video = group.output;
        if (group.count <= 1) return video;

        return {
            ...video,
            qualityFlags: uniqueInsightTreemapFlags([
                ...(video.qualityFlags ?? []),
                createInsightTreemapQualityFlag('duplicate_video', {
                    source,
                    videoId: video.id,
                    count: group.count,
                }),
            ]),
        };
    });
}


function buildVideoMetricQualityFlags(
    video: InsightTreemapVideoRow,
    source?: InsightTreemapDataSource,
): InsightTreemapQualityFlag[] {
    const flags = [
        ...(video.normalizedMetricReasons ?? []).map((reason) =>
            createInsightTreemapQualityFlag(reason.reason, {
                metric: reason.metric,
                source,
                videoId: video.id,
                value: reason.normalizedValue,
            }),
        ),
    ];

    if (video.comparisonStatus === 'missing_previous') {
        flags.push(
            createInsightTreemapQualityFlag('missing_previous', {
                severity: 'info',
                source,
                videoId: video.id,
            }),
        );
    }

    const metricPairs: Array<{
        metric: InsightTreemapMetricKey;
        current: number;
        previous: number | null;
    }> = [
        { metric: 'views', current: video.viewCount, previous: video.previousViewCount },
        { metric: 'likes', current: video.likeCount, previous: video.previousLikeCount },
        { metric: 'comments', current: video.commentCount, previous: video.previousCommentCount },
    ];

    for (const { metric, current, previous } of metricPairs) {
        if (
            typeof previous === 'number' &&
            Number.isFinite(previous) &&
            Number.isFinite(current) &&
            current < previous
        ) {
            flags.push(
                createInsightTreemapQualityFlag('negative_delta', {
                    metric,
                    source,
                    videoId: video.id,
                    value: current - previous,
                }),
            );
        }
    }

    return flags;
}

export function enrichInsightTreemapVideosWithQuality(
    videos: InsightTreemapVideoRow[],
    source?: InsightTreemapDataSource,
): InsightTreemapVideoRow[] {
    const preprocessedVideos = preprocessInsightTreemapVideos(videos, source);
    const totalViews = preprocessedVideos.reduce((sum, video) => sum + video.viewCount, 0);
    const medianViews = getMedianMetricValue(
        preprocessedVideos.map((video) => video.viewCount),
    );
    const iqrOutlierUpperFence = getIqrOutlierUpperFence(
        preprocessedVideos.map((video) => video.viewCount),
    );

    return preprocessedVideos.map((video) => {
        const qualityFlags = [
            ...(video.qualityFlags ?? []),
            ...buildVideoMetricQualityFlags(video, source),
        ];
        const anomalyFlags = [...(video.anomalyFlags ?? [])];

        if (
            totalViews > 0 &&
            video.viewCount / totalViews >=
                YOUTUBE_KPI_DATA_QUALITY_THRESHOLDS.dominantContributionRatio
        ) {
            anomalyFlags.push(
                createInsightTreemapQualityFlag('dominates_total', {
                    severity: 'risk',
                    metric: 'views',
                    source,
                    videoId: video.id,
                    value: video.viewCount / totalViews,
                    threshold:
                        YOUTUBE_KPI_DATA_QUALITY_THRESHOLDS.dominantContributionRatio,
                }),
            );
        }

        if (
            medianViews > 0 &&
            video.viewCount / medianViews >=
                YOUTUBE_KPI_DATA_QUALITY_THRESHOLDS.extremeMedianMultiple
        ) {
            anomalyFlags.push(
                createInsightTreemapQualityFlag('extreme_spike', {
                    severity: 'risk',
                    metric: 'views',
                    source,
                    videoId: video.id,
                    value: video.viewCount / medianViews,
                    threshold: YOUTUBE_KPI_DATA_QUALITY_THRESHOLDS.extremeMedianMultiple,
                }),
            );
        }

        if (
            iqrOutlierUpperFence != null &&
            Number.isFinite(video.viewCount) &&
            video.viewCount > iqrOutlierUpperFence
        ) {
            anomalyFlags.push(
                createInsightTreemapQualityFlag('iqr_outlier', {
                    severity: 'risk',
                    metric: 'views',
                    source,
                    videoId: video.id,
                    value: video.viewCount,
                    threshold: iqrOutlierUpperFence,
                }),
            );
        }

        const uniqueQualityFlags = uniqueInsightTreemapFlags(qualityFlags);
        const uniqueAnomalyFlags = uniqueInsightTreemapFlags(anomalyFlags);

        return {
            ...video,
            ...(uniqueQualityFlags.length > 0 ? { qualityFlags: uniqueQualityFlags } : {}),
            ...(uniqueAnomalyFlags.length > 0 ? { anomalyFlags: uniqueAnomalyFlags } : {}),
        };
    });
}

export function buildInsightTreemapResponseQualityMeta({
    videos,
    source,
    asOf,
    comparisonCoverage,
    fallbackReasonCode,
    fallbackSource,
    rowCapReached = false,
    liveNoComparison = false,
    includeComparisonQuality = true,
}: {
    videos: InsightTreemapVideoRow[];
    source: InsightTreemapDataSource;
    asOf: string;
    comparisonCoverage?: InsightTreemapComparisonCoverage;
    fallbackReasonCode?: string | null;
    fallbackSource?: string | null;
    rowCapReached?: boolean;
    liveNoComparison?: boolean;
    includeComparisonQuality?: boolean;
}): Pick<InsightTreemapResponseMeta, 'dataQuality' | 'anomalySummary'> {
    const flags: InsightTreemapQualityFlag[] = videos.flatMap((video) => [
        ...(video.qualityFlags ?? []),
        ...(video.anomalyFlags ?? []),
    ]);

    if (includeComparisonQuality && comparisonCoverage?.totalVideos) {
        const coverageRatio =
            comparisonCoverage.totalVideos > 0
                ? comparisonCoverage.comparedVideos / comparisonCoverage.totalVideos
                : 1;

        if (
            comparisonCoverage.comparisonAvailable &&
            coverageRatio < YOUTUBE_KPI_DATA_QUALITY_THRESHOLDS.highComparisonCoverageRatio
        ) {
            flags.push(
                createInsightTreemapQualityFlag('low_comparison_coverage', {
                    severity:
                        coverageRatio <
                        YOUTUBE_KPI_DATA_QUALITY_THRESHOLDS.lowComparisonCoverageRatio
                            ? 'risk'
                            : 'warning',
                    source,
                    value: coverageRatio,
                    threshold:
                        YOUTUBE_KPI_DATA_QUALITY_THRESHOLDS.highComparisonCoverageRatio,
                    count: comparisonCoverage.comparedVideos,
                }),
            );
        }

        if (
            !comparisonCoverage.comparisonAvailable &&
            comparisonCoverage.totalVideos > 0 &&
            comparisonCoverage.comparedVideos === 0
        ) {
            flags.push(
                createInsightTreemapQualityFlag('low_comparison_coverage', {
                    severity: 'warning',
                    source,
                    value: 0,
                    threshold:
                        YOUTUBE_KPI_DATA_QUALITY_THRESHOLDS.highComparisonCoverageRatio,
                    count: 0,
                }),
            );
        }

        if (comparisonCoverage.missingPreviousVideos > 0) {
            flags.push(
                createInsightTreemapQualityFlag('missing_previous', {
                    severity: 'info',
                    source,
                    count: comparisonCoverage.missingPreviousVideos,
                }),
            );
        }
    }

    if (rowCapReached) {
        flags.push(
            createInsightTreemapQualityFlag('row_cap', {
                source,
                count: videos.length,
                threshold: YOUTUBE_KPI_DATA_QUALITY_THRESHOLDS.rowCap,
            }),
        );
    }

    if (fallbackReasonCode || fallbackSource) {
        flags.push(
            createInsightTreemapQualityFlag('fallback_source', {
                source,
            }),
        );
    }

    if (liveNoComparison) {
        flags.push(createInsightTreemapQualityFlag('live_no_comparison', { source }));
    }

    const asOfMs = Date.parse(asOf);
    if (
        Number.isFinite(asOfMs) &&
        Date.now() - asOfMs >
            YOUTUBE_KPI_DATA_QUALITY_THRESHOLDS.staleSnapshotHours * HOUR_MS
    ) {
        flags.push(
            createInsightTreemapQualityFlag('stale_snapshot', {
                source,
                value: Date.now() - asOfMs,
                threshold:
                    YOUTUBE_KPI_DATA_QUALITY_THRESHOLDS.staleSnapshotHours * HOUR_MS,
            }),
        );
    }

    const uniqueFlags = uniqueInsightTreemapFlags(flags);
    return {
        dataQuality: buildInsightTreemapDataQualitySummary(uniqueFlags),
        anomalySummary: buildInsightTreemapAnomalySummary(uniqueFlags),
    };
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
            const videos: InsightTreemapVideoRow[] = enrichInsightTreemapVideosWithQuality(
                rows.map((row) => {
                    const normalizedMetricReasons = buildNormalizedMetricReasons([
                        { value: row.view_count, metric: 'views' },
                        { value: row.like_count, metric: 'likes' },
                        { value: row.comment_count, metric: 'comments' },
                    ]);

                    return {
                        id: row.id,
                        title: normalizeTitle(row.title),
                        publishedAt: row.published_at,
                        category: normalizeCategory(row.category),
                        viewCount: toNonNegativeNumber(row.view_count, 'views'),
                        likeCount: toNonNegativeNumber(row.like_count, 'likes'),
                        commentCount: toNonNegativeNumber(row.comment_count, 'comments'),
                        duration: parseDurationToSeconds(row.duration),
                        previousViewCount: null,
                        previousLikeCount: null,
                        previousCommentCount: null,
                        previousDuration: null,
                        comparisonStatus: 'not_applicable',
                        ...(normalizedMetricReasons.length > 0
                            ? { normalizedMetricReasons }
                            : {}),
                    };
                }),
                'supabase-treemap',
            );
            const asOf = new Date().toISOString();
            const comparisonCoverage: InsightTreemapComparisonCoverage = {
                totalVideos: videos.length,
                comparedVideos: 0,
                newVideos: videos.length,
                missingPreviousVideos: 0,
                comparisonAvailable: false,
            };

            return {
                asOf,
                period,
                totalVideos: videos.length,
                videos,
                availablePeriods: [],
                meta: {
                    dataSource: 'supabase-treemap',
                    comparisonCoverage,
                    ...buildInsightTreemapResponseQualityMeta({
                        videos,
                        source: 'supabase-treemap',
                        asOf,
                        comparisonCoverage,
                        rowCapReached: rows.length >= MAX_PUBLIC_TREEMAP_ROWS,
                        includeComparisonQuality: false,
                    }),
                },
            };
        }

        const rowsWithHistory = rows.map((row) => ({
            row,
            history: getCachedMetaHistory(row.meta_history, row.id),
        }));
        const availablePeriods = getAvailablePeriods(rowsWithHistory, metricMode);

        const videos: InsightTreemapVideoRow[] = enrichInsightTreemapVideosWithQuality(
            rowsWithHistory.map(({ row, history }) => {
                const previousViewCount = getPreviousMetricFromHistory(history, 'views', period);
                const previousLikeCount = getPreviousMetricFromHistory(history, 'likes', period);
                const previousCommentCount = getPreviousMetricFromHistory(history, 'comments', period);
                const previousDuration = getPreviousMetricFromHistory(history, 'duration', period);
                const previousMetricValue =
                    metricMode === 'views'
                        ? previousViewCount
                        : metricMode === 'likes'
                          ? previousLikeCount
                          : metricMode === 'comments'
                            ? previousCommentCount
                            : previousDuration;
                const normalizedMetricReasons = buildNormalizedMetricReasons([
                    { value: row.view_count, metric: 'views' },
                    { value: row.like_count, metric: 'likes' },
                    { value: row.comment_count, metric: 'comments' },
                ]);

                return {
                    id: row.id,
                    title: normalizeTitle(row.title),
                    publishedAt: row.published_at,
                    category: normalizeCategory(row.category),
                    viewCount: getLatestMetricValueFromHistory(history, 'views') ?? toNonNegativeNumber(row.view_count, 'views'),
                    likeCount: getLatestMetricValueFromHistory(history, 'likes') ?? toNonNegativeNumber(row.like_count, 'likes'),
                    commentCount: getLatestMetricValueFromHistory(history, 'comments') ?? toNonNegativeNumber(row.comment_count, 'comments'),
                    duration: parseDurationToSeconds(row.duration),
                    previousViewCount,
                    previousLikeCount,
                    previousCommentCount,
                    previousDuration,
                    comparisonStatus: getComparisonStatusFromHistory(row, previousMetricValue, period),
                    ...(normalizedMetricReasons.length > 0
                        ? { normalizedMetricReasons }
                        : {}),
                };
            }),
            'supabase-treemap',
        );
        const comparedVideos = videos.filter((video) => video.comparisonStatus === 'compared').length;
        const newVideos = videos.filter((video) => video.comparisonStatus === 'new').length;
        const missingPreviousVideos = videos.filter((video) => video.comparisonStatus === 'missing_previous').length;
        const comparisonCoverage: InsightTreemapComparisonCoverage = {
            totalVideos: videos.length,
            comparedVideos,
            newVideos,
            missingPreviousVideos,
            comparisonAvailable: comparedVideos > 0,
        };
        const asOf = new Date().toISOString();

        return {
            asOf,
            period,
            totalVideos: videos.length,
            videos,
            availablePeriods,
            meta: {
                dataSource: 'supabase-treemap',
                comparisonCoverage,
                ...buildInsightTreemapResponseQualityMeta({
                    videos,
                    source: 'supabase-treemap',
                    asOf,
                    comparisonCoverage,
                    rowCapReached: rows.length >= MAX_PUBLIC_TREEMAP_ROWS,
                }),
            },
        };
    })();

    treemapResponseCache.set(responseCacheKey, {
        expiresAt: now + TREEMAP_RESPONSE_CACHE_TTL_MS,
        value: result,
    });

    return result;
}
