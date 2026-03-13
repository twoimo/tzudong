import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';

type QueryCallMethod = 'contains' | 'ilike' | 'in' | 'or' | 'limit';
type QueryCall = {
    table: string;
    method: QueryCallMethod;
    args: unknown[];
};

const queryCalls: QueryCall[] = [];

const CAPTION_ROW = {
    id: 1,
    video_id: 'video-1',
    recollect_id: 1,
    rank: 1,
    start_sec: 12,
    raw_caption: '50%_deal,or(video_id.not.is.null)',
    chronological_analysis: 'keyword mention',
    highlight_keywords: ['50%_deal,or(video_id.not.is.null)'],
};

const VIDEO_ROW = {
    id: 'video-1',
    title: 'query safety test video',
    published_at: '2026-03-10T00:00:00.000Z',
    view_count: 101,
    youtube_link: 'https://example.com/watch?v=video-1',
    thumbnail_url: 'https://example.com/video-1.jpg',
};

const ADVERSARIAL_KEYWORDS = [
    '50%_deal,or(video_id.not.is.null)',
    '한글🔥_테스트%키워드,or(1.eq.1)',
    `${'very-long-keyword-'.repeat(20)}%_tail`,
];

function buildExpectedIlikePattern(keyword: string): string {
    const escaped = keyword
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_');

    return `%${escaped}%`;
}

function createQueryBuilder(table: string) {
    const query = {
        select: (_fields: string) => query,
        contains: (column: string, value: unknown) => {
            queryCalls.push({ table, method: 'contains', args: [column, value] });
            return query;
        },
        ilike: (column: string, pattern: string) => {
            queryCalls.push({ table, method: 'ilike', args: [column, pattern] });
            return query;
        },
        or: (rawFilter: string) => {
            queryCalls.push({ table, method: 'or', args: [rawFilter] });
            return query;
        },
        order: (_column: string, _options?: unknown) => query,
        limit: (limit: number) => {
            queryCalls.push({ table, method: 'limit', args: [limit] });
            return query;
        },
        in: (column: string, values: string[]) => {
            queryCalls.push({ table, method: 'in', args: [column, values] });
            return query;
        },
        returns: async <T>() => {
            if (table === 'video_frame_captions') {
                return { data: [CAPTION_ROW] as T, error: null };
            }
            if (table === 'videos') {
                return { data: [VIDEO_ROW] as T, error: null };
            }
            return { data: [] as T, error: null };
        },
    };
    return query;
}

mock.restore();
mock.module('@/lib/insight/supabase', () => ({
    createSupabaseServiceRoleClient: () => ({
        from: (table: string) => createQueryBuilder(table),
    }),
}));

let getAdminInsightWordcloudVideos: typeof import('@/lib/insight/wordcloud').getAdminInsightWordcloudVideos;

beforeAll(async () => {
    ({ getAdminInsightWordcloudVideos } = await import('@/lib/insight/wordcloud?wordcloud-query-safety-test'));
});

afterAll(() => {
    mock.restore();
});

describe('wordcloud keyword query safety', () => {
    test('escapes adversarial keyword corpus without raw filters and enforces caption query row limits', async () => {
        for (const keyword of ADVERSARIAL_KEYWORDS) {
            queryCalls.length = 0;

            const response = await getAdminInsightWordcloudVideos(keyword, true);
            expect(response.keyword).toBe(keyword);
            expect(response.videos).toHaveLength(1);

            expect(queryCalls.filter((call) => call.method === 'or')).toHaveLength(0);

            const containsCalls = queryCalls.filter((call) => call.method === 'contains');
            expect(containsCalls).toHaveLength(1);
            expect(containsCalls[0]?.args).toEqual(['highlight_keywords', [keyword]]);

            const ilikeCalls = queryCalls.filter((call) => call.method === 'ilike');
            expect(ilikeCalls).toHaveLength(2);
            expect(ilikeCalls.map((call) => call.args[0])).toEqual(['raw_caption', 'chronological_analysis']);

            const expectedPattern = buildExpectedIlikePattern(keyword);
            for (const call of ilikeCalls) {
                expect(call.args[1]).toBe(expectedPattern);
            }

            const captionLimitCalls = queryCalls.filter(
                (call) => call.table === 'video_frame_captions' && call.method === 'limit',
            );
            expect(captionLimitCalls).toHaveLength(3);
            for (const call of captionLimitCalls) {
                expect(call.args[0]).toBe(80);
            }
        }
    });
});
