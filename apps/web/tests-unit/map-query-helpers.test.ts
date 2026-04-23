import { describe, expect, test } from 'bun:test';

import {
    buildMapViewRestaurantsQueryOptions,
    buildNaverRestaurantsQueryOptions,
    buildOverseasRestaurantsQueryOptions,
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
            region: '일본(나고야)',
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
            category: ['카페'],
            region: '서울',
            minReviews: 11,
            enabled: true,
        });
    });
});
