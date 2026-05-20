import { describe, expect, test } from 'bun:test';

import type { Restaurant } from '../types/restaurant';
import { buildRestaurantDetailMediaCopy } from '../lib/restaurant-detail-media-copy';
import {
    collectRestaurantMergedMedia,
    hydrateRestaurantDetailWithMergeContext,
} from '../lib/restaurant-merged-media';

const makeRestaurant = (overrides: Partial<Restaurant> = {}): Restaurant => ({
    id: overrides.id ?? 'restaurant-1',
    name: overrides.name ?? '병합맛집',
    approved_name: overrides.approved_name ?? overrides.name ?? '병합맛집',
    status: overrides.status ?? 'approved',
    road_address: overrides.road_address ?? '서울특별시 중구 테스트로 1',
    jibun_address: overrides.jibun_address ?? '서울 중구 테스트동 1-1',
    lat: overrides.lat ?? 37.5,
    lng: overrides.lng ?? 127,
    categories: overrides.categories ?? ['한식'],
    category: overrides.category ?? ['한식'],
    weekly_search_count: overrides.weekly_search_count ?? null,
    youtube_link: overrides.youtube_link ?? null,
    tzuyang_review: overrides.tzuyang_review ?? null,
    youtube_meta: overrides.youtube_meta ?? null,
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
    ...overrides,
} as Restaurant);

describe('restaurant merged media helpers', () => {
    test('collects every youtube video and tzuyang review from merged restaurant records', () => {
        const restaurant = makeRestaurant({
            id: 'primary',
            youtube_link: 'https://www.youtube.com/watch?v=primary0001',
            tzuyang_review: '대표 리뷰',
            youtube_meta: { title: '대표 영상', publishedAt: '2026-01-03T00:00:00Z' },
            mergedRestaurants: [
                makeRestaurant({
                    id: 'older',
                    youtube_link: 'https://www.youtube.com/watch?v=older00001',
                    tzuyang_review: '이전 리뷰',
                    youtube_meta: { title: '이전 영상', publishedAt: '2026-01-01T00:00:00Z' },
                }),
                makeRestaurant({
                    id: 'newer',
                    youtube_link: 'https://www.youtube.com/watch?v=newer00001',
                    tzuyang_review: '최신 리뷰',
                    youtube_meta: { title: '최신 영상', publishedAt: '2026-01-05T00:00:00Z' },
                }),
            ],
        });

        const media = collectRestaurantMergedMedia(restaurant);

        expect(media.youtubeLinks).toEqual([
            'https://www.youtube.com/watch?v=newer00001',
            'https://www.youtube.com/watch?v=primary0001',
            'https://www.youtube.com/watch?v=older00001',
        ]);
        expect(media.tzuyangReviews).toEqual(['최신 리뷰', '대표 리뷰', '이전 리뷰']);
        expect(media.youtubeMetas.map((meta) => meta.title)).toEqual(['최신 영상', '대표 영상', '이전 영상']);
    });

    test('feeds merged media counts into natural detail copy', () => {
        const restaurant = makeRestaurant({
            id: 'primary',
            youtube_link: 'https://www.youtube.com/watch?v=primary0001',
            tzuyang_review: '대표 리뷰',
            mergedRestaurants: [
                makeRestaurant({
                    id: 'second',
                    youtube_link: 'https://www.youtube.com/watch?v=second0001',
                    tzuyang_review: '두 번째 리뷰',
                }),
                makeRestaurant({
                    id: 'third',
                    youtube_link: 'https://www.youtube.com/watch?v=third00001',
                    tzuyang_review: '세 번째 리뷰',
                }),
            ],
        });

        const media = collectRestaurantMergedMedia(restaurant);
        const youtubeCopy = buildRestaurantDetailMediaCopy('youtube', media.youtubeLinks.length, false);
        const reviewCopy = buildRestaurantDetailMediaCopy('review', media.tzuyangReviews.length, false);

        expect(youtubeCopy.collapsedToggleLabel).toBe('영상 2개 더 보기');
        expect(reviewCopy.collapsedToggleLabel).toBe('리뷰 2개 더 보기');
    });

    test('keeps distinct youtube metadata when different videos share the same title', () => {
        const restaurant = makeRestaurant({
            id: 'primary',
            youtube_meta: { title: '같은 제목', publishedAt: '2026-01-03T00:00:00Z' },
            mergedRestaurants: [
                makeRestaurant({
                    id: 'same-title-other-date',
                    youtube_meta: { title: '같은 제목', publishedAt: '2026-01-01T00:00:00Z' },
                }),
            ],
        });

        const media = collectRestaurantMergedMedia(restaurant);

        expect(media.youtubeMetas).toHaveLength(2);
        expect(media.youtubeMetas.map((meta) => meta.publishedAt)).toEqual([
            '2026-01-03T00:00:00Z',
            '2026-01-01T00:00:00Z',
        ]);
    });

    test('hydrates a fetched single detail row with the selected merge context', () => {
        const selectedRestaurant = makeRestaurant({
            id: 'primary',
            mergedYoutubeLinks: [
                'https://www.youtube.com/watch?v=primary0001',
                'https://www.youtube.com/watch?v=merged00001',
            ],
            mergedTzuyangReviews: ['대표 리뷰', '병합 리뷰'],
            mergedRestaurants: [
                makeRestaurant({
                    id: 'primary',
                    youtube_link: 'https://www.youtube.com/watch?v=primary0001',
                    tzuyang_review: '대표 리뷰',
                    youtube_meta: { title: '대표 영상', publishedAt: '2026-01-02T00:00:00Z' },
                }),
                makeRestaurant({
                    id: 'merged',
                    youtube_link: 'https://www.youtube.com/watch?v=merged00001',
                    tzuyang_review: '병합 리뷰',
                    youtube_meta: { title: '병합 영상', publishedAt: '2026-01-01T00:00:00Z' },
                }),
            ],
        });
        const fetchedDetail = makeRestaurant({
            id: 'primary',
            name: 'DB에서 다시 읽은 맛집',
            youtube_link: 'https://www.youtube.com/watch?v=primary0001',
            tzuyang_review: '대표 리뷰',
        });

        const hydrated = hydrateRestaurantDetailWithMergeContext(fetchedDetail, selectedRestaurant);

        expect(hydrated?.name).toBe('DB에서 다시 읽은 맛집');
        expect(hydrated?.mergedYoutubeLinks).toEqual([
            'https://www.youtube.com/watch?v=primary0001',
            'https://www.youtube.com/watch?v=merged00001',
        ]);
        expect(hydrated?.mergedTzuyangReviews).toEqual(['대표 리뷰', '병합 리뷰']);
        expect(hydrated?.mergedRestaurants?.map((restaurant) => restaurant.id)).toEqual(['primary', 'merged']);
    });
});
