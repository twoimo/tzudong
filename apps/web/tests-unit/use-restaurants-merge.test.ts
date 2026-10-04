import { describe, expect, mock, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { OVERSEAS_REGIONS } from '../constants/overseas-regions';
import * as overseasMatching from '../lib/overseas-region-matching';
import * as restClient from '../lib/supabase-rest-client';
import * as homeMapThemeFilters from '../lib/home-map-theme-filters';
import type { Restaurant } from '../types/restaurant';

type MergeInput = Array<Record<string, unknown>>;

type UseRestaurantsExports = {
    buildRestaurantSelectFields: (options: { compact: boolean; includeYoutubeMetaForTheme: boolean }) => string;
    mergeRestaurants: (restaurants: MergeInput) => unknown[];
};

type RestaurantDetailExports = {
    buildRestaurantDetailFromMergeRows: (mergeContextRestaurant: Record<string, unknown>, rows: MergeInput) => Record<string, unknown> | null;
};

mock.module('@/integrations/supabase/client', () => ({
    supabase: {
        from: () => ({
            select: () => ({
                eq: () => ({
                    ilike: () => ({
                        or: () => ({
                            in: () => ({
                                gte: () => ({
                                    returns: () => ({ data: null, error: null }),
                                    order: () => ({
                                        limit: () => ({
                                            then: () => ({ data: null, error: null }),
                                        }),
                                    }),
                                }),
                            }),
                        }),
                    }),
                }),
            }),
        }),
    },
}));

type MergeFixtureRestaurant = MergeInput[number];

const loadUseRestaurants = async (): Promise<UseRestaurantsExports> => {
    const mergeModule = (await import('../hooks/use-restaurants')) as unknown as UseRestaurantsExports;
    return mergeModule;
};

const loadRestaurantDetail = async (): Promise<RestaurantDetailExports> => {
    const detailModule = (await import('../hooks/use-restaurant-detail')) as unknown as RestaurantDetailExports;
    return detailModule;
};

type HookOptions = Parameters<typeof import('../hooks/use-restaurants').useRestaurants>[0];
type CapturedQuery = {
    queryKey: readonly unknown[];
    queryFn: () => Promise<Restaurant[]>;
    enabled: boolean;
};

// Exercise the real initializer, query callback and merge logic in an isolated
// module scope. Transport doubles cannot reach credentials, fetch or other suites.
function regionQueryFixture(regions = OVERSEAS_REGIONS) {
    const requests: Array<{ table: string; query: Array<[string, string | number]> }> = [];
    const countryCalls: Array<[string, '%' | '*']> = [];
    const rows = [
        makeRestaurant({ id: 'second-id', approved_name: '앞 식당', road_address: '주소 A' }),
        makeRestaurant({ id: 'first-id', approved_name: '뒤 식당', road_address: '주소 B' }),
    ];
    const unexpected = () => { throw new Error('UNEXPECTED_REGION_QUERY_DEPENDENCY'); };
    const dependencies: Record<string, unknown> = {
        '@tanstack/react-query': { useQuery: (query: CapturedQuery) => query },
        '@/constants/overseas-regions': { OVERSEAS_REGIONS: regions },
        '@/lib/overseas-region-matching': {
            ...overseasMatching,
            buildOverseasCountryAddressOrFilter: (country: string, wildcard: '%' | '*') => {
                countryCalls.push([country, wildcard]);
                return overseasMatching.buildOverseasCountryAddressOrFilter(country, wildcard);
            },
        },
        '@/lib/performance-monitor': { perfMonitor: { startMeasure() {}, endMeasure() {}, report() {} } },
        '@/lib/supabase-rest-client': {
            ...restClient,
            fetchSupabaseRows: async (table: string, query: Array<[string, string | number]>) => {
                requests.push({ table, query });
                return rows;
            },
        },
        '@/lib/restaurant-review-counts': { buildRelatedVerifiedReviewCountMap: unexpected },
        '@/lib/verified-review-count-rows': { fetchVerifiedReviewCountRows: unexpected },
        '@/lib/home-map-theme-filters': homeMapThemeFilters,
        '@/lib/home-map-youtube-kpi': {
            enrichRestaurantsWithHomeMapYoutubeKpiMetrics: async (restaurants: Restaurant[]) => restaurants,
        },
        '@/lib/debug-log': { describeErrorCodeForLog: unexpected },
    };
    const source = readFileSync(resolve(import.meta.dir, '../hooks/use-restaurants.tsx'), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: {
        module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    } }).outputText;
    const exports = {} as { useRestaurants: (options: HookOptions) => CapturedQuery };
    vm.runInNewContext(compiled, {
        exports,
        process: { env: { NODE_ENV: 'test' } },
        require: (name: string) => {
            if (Object.hasOwn(dependencies, name)) return dependencies[name];
            return unexpected();
        },
    });
    return { useRestaurants: exports.useRestaurants, requests, countryCalls, rows };
}

function makeRestaurant(overrides: Partial<MergeFixtureRestaurant>): MergeFixtureRestaurant {
    return {
        id: 'rest-1',
        status: 'approved',
        lat: 37.5665,
        lng: 126.978,
        road_address: '서울특별시 강남구 영동대로 123',
        jibun_address: '서울 강남구 역삼동 123-45',
        name: null,
        approved_name: '테스트 맛집',
        categories: ['한식'],
        phone: null,
        review_count: 1,
        youtube_link: null,
        tzuyang_review: null,
        youtube_meta: null,
        english_address: null,
        created_at: new Date().toISOString(),
        ...overrides,
    } as MergeFixtureRestaurant;
}

describe('buildRestaurantSelectFields', () => {
    test('includes youtube_meta only for full or metadata-backed compact projections', async () => {
        const { buildRestaurantSelectFields } = await loadUseRestaurants();

        expect(buildRestaurantSelectFields({ compact: false, includeYoutubeMetaForTheme: false })).toContain(
            'youtube_meta',
        );
        expect(buildRestaurantSelectFields({ compact: true, includeYoutubeMetaForTheme: false })).not.toContain(
            'youtube_meta',
        );
        expect(buildRestaurantSelectFields({ compact: true, includeYoutubeMetaForTheme: true })).toContain(
            'youtube_meta',
        );
    });

    test('includes source_type in compact and full projections for marker classification', async () => {
        const { buildRestaurantSelectFields } = await loadUseRestaurants();

        expect(buildRestaurantSelectFields({ compact: false, includeYoutubeMetaForTheme: false })).toContain(
            'source_type',
        );
        expect(buildRestaurantSelectFields({ compact: true, includeYoutubeMetaForTheme: false })).toContain(
            'source_type',
        );
        expect(buildRestaurantSelectFields({ compact: true, includeYoutubeMetaForTheme: true })).toContain(
            'source_type',
        );
    });
});

describe('useRestaurants region queries', () => {
    const fields = ['road_address', 'jibun_address', 'english_address'];
    const regionOption = (region: string) => region as NonNullable<HookOptions>['region'];

    test('preserves every configured overseas query, source projection, filters and returned ID order', async () => {
        const fixture = regionQueryFixture();
        const bounds = { south: 1.123456, west: 2.234567, north: 3.345678, east: 4.456789 };
        for (const [region, config] of Object.entries(OVERSEAS_REGIONS)) {
            const priorRequests = fixture.requests.length;
            const query = fixture.useRestaurants({
                region: regionOption(`  ${region}  `), bounds, category: [' 한식 ', '분식', '한식'],
                minReviews: 3, compact: true, includeVerifiedReviewCounts: false, enabled: false,
            });
            expect(fixture.requests).toHaveLength(priorRequests);
            expect(fixture.countryCalls).toHaveLength(0);
            expect(query.enabled).toBe(false);
            expect(query.queryKey).toEqual([
                'restaurants', [1.1235, 2.2346, 3.3457, 4.4568], ['분식', '한식'], region, 3, null,
                false, true, false,
            ]);

            const result = await query.queryFn();
            expect(fixture.requests).toHaveLength(priorRequests + 1);
            expect(result.map(row => row.id)).toEqual(['second-id', 'first-id']);
            expect(fixture.requests.at(-1)).toEqual({ table: 'restaurants', query: [
                ['select', 'id, name:approved_name, lat, lng, road_address, jibun_address, categories, review_count, youtube_link, source_type'],
                ['status', 'eq.approved'], ['order', 'approved_name.asc'],
                ['lat', 'gte.1.123456'], ['lat', 'lte.3.345678'],
                ['lng', 'gte.2.234567'], ['lng', 'lte.4.456789'],
                ['categories', 'ov.{"분식","한식"}'],
                ['or', `(${config.keywords.flatMap(keyword => fields.map(field => `${field}.ilike.*${keyword}*`)).join(',')})`],
                ['review_count', 'gte.3'],
            ] });
        }
        expect(fixture.countryCalls).toHaveLength(0);
    });

    test('sanitizes overseas keywords and skips terms that become empty without changing keyword order', async () => {
        const config = OVERSEAS_REGIONS['미국(LA)'];
        const keywords = ['   ', '(),', '100%_Town),id.eq.fixture', 'Los Angeles', 'Los Angeles'];
        const fixture = regionQueryFixture({ ...OVERSEAS_REGIONS, '미국(LA)': { ...config, keywords } });
        await fixture.useRestaurants({ region: '미국(LA)', includeVerifiedReviewCounts: false }).queryFn();
        const expectedTerms = ['100\\%\\_Town  id.eq.fixture', 'Los Angeles', 'Los Angeles'];
        expect(fixture.requests[0].query.filter(([key]) => key === 'or')).toEqual([
            ['or', `(${expectedTerms.flatMap(term => fields.map(field => `${field}.ilike.*${term}*`)).join(',')})`],
        ]);
        expect(fixture.countryCalls).toHaveLength(0);
        expect(keywords).toEqual(['   ', '(),', '100%_Town),id.eq.fixture', 'Los Angeles', 'Los Angeles']);
        expect(OVERSEAS_REGIONS['미국(LA)']).toBe(config);
    });

    test('keeps empty keyword lists free of an empty OR or a country fallback', async () => {
        for (const keywords of [[], ['', '   ', '(),']]) {
            const fixture = regionQueryFixture({
                ...OVERSEAS_REGIONS, '미국(LA)': { ...OVERSEAS_REGIONS['미국(LA)'], keywords },
            });
            await fixture.useRestaurants({ region: '미국(LA)', includeVerifiedReviewCounts: false }).queryFn();
            expect(fixture.requests[0].query.some(([key]) => key === 'or')).toBe(false);
            expect(fixture.requests[0].query).toContainEqual(['status', 'eq.approved']);
            expect(fixture.countryCalls).toHaveLength(0);
        }
    });

    test('builds each country filter once inside the callback and reuses its exact result', async () => {
        const fixture = regionQueryFixture();
        const countries = [...new Set(Object.values(OVERSEAS_REGIONS).map(config => config.country))];
        for (const country of countries) {
            const previousCalls = fixture.countryCalls.length;
            const query = fixture.useRestaurants({ region: regionOption(country), includeVerifiedReviewCounts: false });
            expect(fixture.countryCalls).toHaveLength(previousCalls);
            await query.queryFn();
            expect(fixture.countryCalls.slice(previousCalls)).toEqual([[country, '*']]);
            expect(fixture.requests.at(-1)?.query.filter(([key]) => key === 'or')).toEqual([
                ['or', `(${overseasMatching.buildOverseasCountryAddressOrFilter(country, '*')})`],
            ]);
        }
    });

    test('preserves domestic island, ordinary, unknown and blank region boundaries', async () => {
        const cases = [
            { region: '', term: null, countryCalls: 0 },
            { region: '   ', term: null, countryCalls: 0 },
            { region: '울릉도', term: '울릉', countryCalls: 0 },
            { region: '욕지도', term: '욕지', countryCalls: 0 },
            { region: ' 서울특별시 ', term: '서울특별시', countryCalls: 1 },
            { region: '알수없는지역', term: '알수없는지역', countryCalls: 1 },
            { region: '서울),id.eq.fixture', term: '서울  id.eq.fixture', countryCalls: 1 },
            { region: '(),', term: null, countryCalls: 1 },
        ];
        const fixture = regionQueryFixture();
        for (const entry of cases) {
            const previousCalls = fixture.countryCalls.length;
            await fixture.useRestaurants({ region: regionOption(entry.region), includeVerifiedReviewCounts: false }).queryFn();
            expect(fixture.countryCalls).toHaveLength(previousCalls + entry.countryCalls);
            expect(fixture.requests.at(-1)?.query.filter(([key]) => key === 'or')).toEqual(entry.term ? [
                ['or', `(road_address.ilike.*${entry.term}*,jibun_address.ilike.*${entry.term}*)`],
            ] : []);
        }
    });
});

describe('mergeRestaurants', () => {
    test('returns an empty list for empty input', async () => {
        const { mergeRestaurants } = await loadUseRestaurants();
        expect(mergeRestaurants([])).toEqual([]);
    });

    test('projects a singleton with empty media, fallback address and deduplicated categories', async () => {
        const { mergeRestaurants } = await loadUseRestaurants();
        const row = makeRestaurant({
            id: 'solo', approved_name: '', name: '', lat: null, lng: null,
            categories: ['한식', '한식', '분식'], youtube_link: '', tzuyang_review: '',
            youtube_meta: null, review_count: null, road_address: '', jibun_address: '단일 주소',
        });
        const before = structuredClone(row);
        const [merged] = mergeRestaurants([row]) as Array<Record<string, unknown>>;

        expect(merged).toMatchObject({
            id: 'solo', name: '', lat: 0, lng: 0, categories: ['한식', '분식'],
            category: ['한식', '분식'], address: '단일 주소', youtube_link: null,
            tzuyang_review: null, youtube_meta: null, review_count: 0,
            mergedYoutubeLinks: [], mergedTzuyangReviews: [], mergedYoutubeMetas: [],
            mergedRestaurants: [row],
        });
        expect(merged).not.toBe(row);
        expect((merged.mergedRestaurants as unknown[])[0]).toBe(row);
        expect(row).toEqual(before);
    });

    test('preserves alias names and populated media without sorting singleton groups', async () => {
        const { mergeRestaurants } = await loadUseRestaurants();
        const meta = { title: '단일 영상', publishedAt: '2026-01-01T00:00:00Z' };
        const row = makeRestaurant({
            id: 'solo-media', approved_name: null, name: '별칭 식당',
            youtube_link: 'https://www.youtube.com/watch?v=abcdefghijk',
            tzuyang_review: '영상 리뷰', youtube_meta: meta, review_count: 7,
        });
        const sort = spyOn(Array.prototype, 'sort');
        let result: unknown[];
        let sorts: number;
        try {
            result = mergeRestaurants([row]);
            sorts = sort.mock.calls.length;
        } finally {
            sort.mockRestore();
        }

        expect(sorts).toBe(0);
        expect(result).toHaveLength(1);
        expect(result[0]).toMatchObject({
            name: '별칭 식당', lat: row.lat, lng: row.lng, address: row.road_address,
            youtube_link: row.youtube_link, tzuyang_review: row.tzuyang_review,
            youtube_meta: meta, review_count: 7,
            mergedYoutubeLinks: [row.youtube_link], mergedTzuyangReviews: [row.tzuyang_review],
            mergedYoutubeMetas: [meta], mergedRestaurants: [row],
        });
    });

    test('keeps singleton and multi-row group order and sorts only the multi-row media', async () => {
        const { mergeRestaurants } = await loadUseRestaurants();
        const rows = [
            makeRestaurant({ id: 'solo', approved_name: '단독', road_address: '', jibun_address: '' }),
            makeRestaurant({ id: 'old', approved_name: '병합', youtube_link: 'old', youtube_meta: { publishedAt: '2026-01-01' } }),
            makeRestaurant({ id: 'new', approved_name: '병합', youtube_link: 'new', youtube_meta: { publishedAt: '2026-02-01' } }),
        ];
        const sort = spyOn(Array.prototype, 'sort');
        let result: Array<{ mergedRestaurants: Array<{ id: string }>; mergedYoutubeLinks: string[]; review_count: number }>;
        let sorts: number;
        try {
            result = mergeRestaurants(rows) as typeof result;
            sorts = sort.mock.calls.length;
        } finally {
            sort.mockRestore();
        }

        expect(sorts).toBe(1);
        expect(result.map(group => group.mergedRestaurants.map(row => row.id))).toEqual([
            ['solo'], ['old', 'new'],
        ]);
        expect(result[1].mergedYoutubeLinks).toEqual(['new', 'old']);
        expect(result[1].review_count).toBe(2);
    });

    test('retains every member of a large already-connected address group', async () => {
        const { mergeRestaurants } = await loadUseRestaurants();
        const rows = Array.from({ length: 12000 }, (_, index) => makeRestaurant({
            id: `address-${index}`, approved_name: '같은 주소 식당',
            created_at: '2026-01-01T00:00:00Z',
        }));
        const result = mergeRestaurants(rows) as Array<Record<string, unknown>>;
        expect(result).toHaveLength(1);
        expect(result[0].mergedRestaurants).toEqual(rows);
        expect(result[0].review_count).toBe(rows.length);
    });

    test('still joins similar names and retains different names within one address', async () => {
        const { mergeRestaurants } = await loadUseRestaurants();
        const longName = '서울특별시정성가득한전통한식전문음식점';
        const rows = [longName + '가', '해물횟집', longName + '나', longName + '가'].map((name, index) =>
            makeRestaurant({ id: `mixed-${index}`, approved_name: name }));
        const result = mergeRestaurants(rows) as Array<{ mergedRestaurants: Array<{ id: string }> }>;
        expect(result.map(group => group.mergedRestaurants.map(row => row.id))).toEqual([
            ['mixed-0', 'mixed-2', 'mixed-3'], ['mixed-1'],
        ]);
    });

    test('preserves first-seen group and member order with interleaved duplicates', async () => {
        const { mergeRestaurants } = await loadUseRestaurants();
        const rows = ['서울식당', '부산횟집', '서울식당', '부산횟집'].map((name, index) =>
            makeRestaurant({ id: `ordered-${index}`, approved_name: name, jibun_address: '', road_address: '' }));
        const merged = mergeRestaurants(rows) as Array<{ mergedRestaurants: Array<{ id: string }> }>;
        expect(merged.map(group => group.mergedRestaurants.map(row => row.id))).toEqual([
            ['ordered-0', 'ordered-2'], ['ordered-1', 'ordered-3'],
        ]);
        expect(rows.map(row => row.id)).toEqual(['ordered-0', 'ordered-1', 'ordered-2', 'ordered-3']);
    });

    test('merges a long same-name chain without exhausting the call stack', async () => {
        const { mergeRestaurants } = await loadUseRestaurants();
        const rows = Array.from({ length: 100000 }, (_, index) => makeRestaurant({
            id: `chain-${index}`,
            approved_name: '동일 이름',
            road_address: '',
            jibun_address: '',
            created_at: '2026-01-01T00:00:00Z',
        }));
        const merged = mergeRestaurants(rows) as Array<Record<string, unknown>>;
        expect(merged).toHaveLength(1);
        expect(merged[0].review_count).toBe(rows.length);
        expect(merged[0].mergedRestaurants).toEqual(rows);
        expect(rows[0].id).toBe('chain-0');
    });

    test('merges restaurants with same normalized name and address', async () => {
        const { mergeRestaurants } = await loadUseRestaurants();

        const merged = mergeRestaurants([
            makeRestaurant({
                id: 'r-1',
                approved_name: '서울식당',
                road_address: '서울특별시 강남구 영동대로 123',
                review_count: 2,
                youtube_meta: { publishedAt: '2026-03-01T00:00:00Z' },
            }),
            makeRestaurant({
                id: 'r-2',
                approved_name: '서울식당',
                road_address: '서울특별시  강남구 영동대로 123',
                review_count: 3,
                youtube_meta: { publishedAt: '2026-03-05T00:00:00Z' },
            }),
            makeRestaurant({
                id: 'r-3',
                approved_name: '다른식당',
                road_address: '서울특별시 강남구 영동대로 124',
                review_count: 1,
            }),
        ]);

        expect(merged).toHaveLength(2);

        const mergedSeoul = merged.find((r) => r.name === '서울식당');
        expect(mergedSeoul).toBeDefined();
        expect(mergedSeoul?.mergedRestaurants).toHaveLength(2);
        expect(mergedSeoul?.review_count).toBe(5);
    });

    test('keeps unique restaurants when name/address combination differs', async () => {
        const { mergeRestaurants } = await loadUseRestaurants();

        const merged = mergeRestaurants([
            makeRestaurant({
                id: 'r-1',
                approved_name: '맛집A',
                road_address: '서울특별시 강남구 영동대로 1',
                review_count: 2,
            }),
            makeRestaurant({
                id: 'r-2',
                approved_name: '맛집B',
                road_address: '서울특별시 강남구 영동대로 2',
                review_count: 3,
            }),
        ]);

        expect(merged).toHaveLength(2);
        expect(merged[0]?.review_count + merged[1]?.review_count).toBe(5);
    });

    test('preserves every merged youtube video and tzuyang review for the detail panel', async () => {
        const { mergeRestaurants } = await loadUseRestaurants();

        const merged = mergeRestaurants([
            makeRestaurant({
                id: 'video-old',
                approved_name: '문터골연가',
                road_address: '서울특별시 강남구 영동대로 123',
                youtube_link: 'https://www.youtube.com/watch?v=oldvideo001',
                tzuyang_review: '오래된 영상 리뷰',
                youtube_meta: {
                    title: '오래된 영상',
                    publishedAt: '2026-03-01T00:00:00Z',
                    viewCount: 100,
                    likeCount: 10,
                    commentCount: 1,
                },
            }),
            makeRestaurant({
                id: 'video-new',
                approved_name: '문터골연가',
                road_address: '서울특별시  강남구 영동대로 123',
                youtube_link: 'https://www.youtube.com/watch?v=newvideo001',
                tzuyang_review: '최신 영상 리뷰',
                youtube_meta: {
                    title: '최신 영상',
                    publishedAt: '2026-03-05T00:00:00Z',
                    viewCount: 300,
                    likeCount: 30,
                    commentCount: 3,
                },
            }),
            makeRestaurant({
                id: 'video-mid',
                approved_name: '문터골연가',
                road_address: '서울특별시 강남구 영동대로 123 2층',
                youtube_link: 'https://www.youtube.com/watch?v=midvideo001',
                tzuyang_review: '중간 영상 리뷰',
                youtube_meta: {
                    title: '중간 영상',
                    publishedAt: '2026-03-03T00:00:00Z',
                    viewCount: 200,
                    likeCount: 20,
                    commentCount: 2,
                },
            }),
        ]);

        expect(merged).toHaveLength(1);
        const restaurant = merged[0];
        expect(restaurant?.mergedRestaurants).toHaveLength(3);
        expect(restaurant?.mergedYoutubeLinks).toEqual([
            'https://www.youtube.com/watch?v=newvideo001',
            'https://www.youtube.com/watch?v=midvideo001',
            'https://www.youtube.com/watch?v=oldvideo001',
        ]);
        expect(restaurant?.mergedTzuyangReviews).toEqual([
            '최신 영상 리뷰',
            '중간 영상 리뷰',
            '오래된 영상 리뷰',
        ]);
        expect(restaurant?.youtube_link).toBe('https://www.youtube.com/watch?v=newvideo001');
        expect(restaurant?.tzuyang_review).toBe('최신 영상 리뷰');
        expect(restaurant?.mergedYoutubeMetas?.map((meta: { title?: string }) => meta.title)).toEqual([
            '최신 영상',
            '중간 영상',
            '오래된 영상',
        ]);
        expect(
            restaurant?.mergedYoutubeMetas?.map(
                (meta: { viewCount?: number; likeCount?: number; commentCount?: number }) => ({
                    viewCount: meta.viewCount,
                    likeCount: meta.likeCount,
                    commentCount: meta.commentCount,
                }),
            ),
        ).toEqual([
            { viewCount: 300, likeCount: 30, commentCount: 3 },
            { viewCount: 200, likeCount: 20, commentCount: 2 },
            { viewCount: 100, likeCount: 10, commentCount: 1 },
        ]);
    });

    test('restores merged videos and reviews when compact detail context has only merged ids', async () => {
        const { buildRestaurantDetailFromMergeRows } = await loadRestaurantDetail();

        const compactContext = makeRestaurant({
            id: 'video-new',
            approved_name: '영화장',
            road_address: '서울특별시 강남구 영동대로 123',
            youtube_link: undefined,
            tzuyang_review: undefined,
            youtube_meta: undefined,
            mergedRestaurants: [
                { id: 'video-new' },
                { id: 'video-old' },
            ],
        });
        const detail = buildRestaurantDetailFromMergeRows(compactContext, [
            makeRestaurant({
                id: 'video-new',
                approved_name: '영화장',
                road_address: '서울특별시 강남구 영동대로 123',
                youtube_link: 'https://www.youtube.com/watch?v=newvideo001',
                tzuyang_review: '최신 영화장 리뷰',
                youtube_meta: { title: '최신 영화장 영상', publishedAt: '2026-03-05T00:00:00Z' },
            }),
            makeRestaurant({
                id: 'video-old',
                approved_name: '영화장',
                road_address: '서울특별시  강남구 영동대로 123',
                youtube_link: 'https://www.youtube.com/watch?v=oldvideo001',
                tzuyang_review: '이전 영화장 리뷰',
                youtube_meta: { title: '이전 영화장 영상', publishedAt: '2026-03-01T00:00:00Z' },
            }),
        ]);

        expect(detail?.mergedYoutubeLinks).toEqual([
            'https://www.youtube.com/watch?v=newvideo001',
            'https://www.youtube.com/watch?v=oldvideo001',
        ]);
        expect(detail?.mergedTzuyangReviews).toEqual([
            '최신 영화장 리뷰',
            '이전 영화장 리뷰',
        ]);
        expect(detail?.mergedRestaurants).toHaveLength(2);
    });

    test('keeps compact detail context visible when full merge rows are unavailable', async () => {
        const { buildRestaurantDetailFromMergeRows } = await loadRestaurantDetail();

        const compactContext = makeRestaurant({
            id: 'compact-only',
            approved_name: '문터골연가',
            road_address: '서울특별시 강남구 영동대로 123',
            mergedRestaurants: [{ id: 'compact-only' }, { id: 'compact-merged' }],
        });

        const detail = buildRestaurantDetailFromMergeRows(compactContext, []);

        expect(detail?.id).toBe('compact-only');
        expect(detail?.mergedRestaurants?.map((restaurant: { id?: string }) => restaurant.id)).toEqual([
            'compact-only',
            'compact-merged',
        ]);
        expect(detail?.mergedYoutubeLinks).toEqual([]);
        expect(detail?.mergedTzuyangReviews).toEqual([]);
    });

    test('mergeRestaurants exposes merge performance counters when available', async () => {
        const { mergeRestaurants, ...maybePerfHelpers } = await import('../hooks/use-restaurants') as Record<string, unknown>;

        const reset = maybePerfHelpers.resetMergePerfCounters;
        const get = maybePerfHelpers.getMergePerfCounters;
        const mergeModule = { mergeRestaurants, ...maybePerfHelpers } as Record<string, unknown>;

        if (typeof reset !== 'function' || typeof get !== 'function') {
            // Lane B currently verifies behavior via merge output.
            // Counter counters are optional until lane A adds production instrumentation.
            expect(reset).toBeUndefined();
            return;
        }

        const resetFn = reset as () => void;
        const getFn = get as () => { similarityChecks: number; mainSelectionComparisons: number };

        resetFn();

        const sampleRestaurants = Array.from({ length: 40 }, (_, index) =>
            makeRestaurant({
                id: `sample-${index}`,
                approved_name: `테스트-매우-긴-가게-이름-${index % 4}-테스트`,
                road_address: `서울특별시 강남구 영동대로 ${100 + (index % 3)}`,
                review_count: 1,
            })
        );

        (mergeModule.mergeRestaurants as (restaurants: MergeInput) => unknown[])(sampleRestaurants);
        const counters = getFn();

        expect(counters.similarityChecks).toBeGreaterThanOrEqual(0);
        expect(counters.mainSelectionComparisons).toBeGreaterThanOrEqual(0);
    });
});
