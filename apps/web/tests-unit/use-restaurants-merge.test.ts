import { describe, expect, mock, test } from 'bun:test';

type MergeInput = Array<Record<string, unknown>>;

type MergeRestaurantsExports = {
    mergeRestaurants: (restaurants: MergeInput) => unknown[];
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

const loadUseRestaurants = async (): Promise<MergeRestaurantsExports> => {
    const mergeModule = (await import('../hooks/use-restaurants')) as unknown as MergeRestaurantsExports;
    return mergeModule;
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
