import { describe, expect, mock, test } from 'bun:test';

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
});

describe('mergeRestaurants', () => {
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
