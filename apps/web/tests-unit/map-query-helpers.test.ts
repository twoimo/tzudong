import { describe, expect, test } from 'bun:test';

import {
    buildMapViewRestaurantsQueryOptions,
    buildNaverRestaurantsQueryOptions,
    buildOverseasRestaurantsQueryOptions,
    resolveNaverRestaurantQueryBounds,
} from '../lib/map-query-helpers';

describe('map query helpers', () => {
    test('builds map view query options', () => {
        const options = buildMapViewRestaurantsQueryOptions({
            bounds: { south: 1, west: 2, north: 3, east: 4 },
            filters: {
                categories: ['한식'],
                minRating: 1,
                minReviews: 5,
                minUserVisits: 0,
                minJjyangVisits: 0,
            },
            isLoaded: true,
            selectedCountry: '미국',
        });

        expect(options).toEqual({
            bounds: { south: 1, west: 2, north: 3, east: 4 },
            category: ['한식'],
            region: '미국',
            minReviews: 5,
            featuredTheme: null,
            includeVerifiedReviewCounts: false,
            enabled: true,
        });
    });

    test('builds overseas query options', () => {
        const options = buildOverseasRestaurantsQueryOptions({
            filters: {
                categories: [],
                minRating: 1,
                minReviews: 3,
                minUserVisits: 0,
                minJjyangVisits: 0,
            },
            refreshTrigger: 7,
            selectedCountry: '일본(나고야)',
        });

        expect(options).toEqual({
            category: undefined,
            minReviews: 3,
            featuredTheme: null,
            region: '일본(나고야)',
            includeVerifiedReviewCounts: false,
            enabled: true,
            refreshTrigger: 7,
        });
    });

    test('builds naver query options', () => {
        const options = buildNaverRestaurantsQueryOptions({
            filters: {
                categories: ['카페'],
                minRating: 1,
                minReviews: 11,
                minUserVisits: 0,
                minJjyangVisits: 0,
            },
            isLoaded: true,
            selectedRegion: '서울',
        });

        expect(options).toEqual({
            bounds: undefined,
            category: ['카페'],
            compact: false,
            region: '서울',
            minReviews: 11,
            featuredTheme: null,
            includeVerifiedReviewCounts: false,
            enabled: true,
        });
    });

    test('builds compact naver query options with region bounds', () => {
        const options = buildNaverRestaurantsQueryOptions({
            bounds: {
                south: 33,
                west: 124,
                north: 39,
                east: 132,
            },
            compact: true,
            filters: {
                categories: [],
                minRating: 1,
                minReviews: 0,
                minUserVisits: 0,
                minJjyangVisits: 0,
            },
            isLoaded: true,
            selectedRegion: '서울',
        });

        expect(options).toEqual({
            bounds: {
                south: 33,
                west: 124,
                north: 39,
                east: 132,
            },
            category: undefined,
            compact: true,
            region: '서울',
            minReviews: 0,
            featuredTheme: null,
            includeVerifiedReviewCounts: false,
            enabled: true,
        });
    });

    test('uses bounded naver data only before deferred full-map effects run', () => {
        const initialBounds = {
            south: 33,
            west: 124,
            north: 39,
            east: 132,
        };

        expect(resolveNaverRestaurantQueryBounds({
            firstLoadViewportBounds: initialBounds,
            shouldUseFullMapData: false,
        })).toBe(initialBounds);

        expect(resolveNaverRestaurantQueryBounds({
            firstLoadViewportBounds: initialBounds,
            shouldUseFullMapData: true,
        })).toBeUndefined();
    });
});
