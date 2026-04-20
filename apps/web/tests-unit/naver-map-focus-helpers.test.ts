import { describe, expect, test } from 'bun:test';

import { focusNaverMapOnRestaurant } from '../lib/naver-map-focus-helpers';

describe('naver map focus helpers', () => {
    test('focuses map on restaurant coordinates with zoom', () => {
        const calls: string[] = [];
        const result = focusNaverMapOnRestaurant({
            createLatLng: (lat, lng) => ({ lat, lng }),
            lat: 37.5,
            lng: 127.1,
            map: {
                setCenter: ({ lat, lng }) => calls.push(`center:${lat},${lng}`),
                setZoom: (zoom) => calls.push(`zoom:${zoom}`),
            },
            zoom: 15,
        });

        expect(result).toBe(true);
        expect(calls).toEqual(['zoom:15', 'center:37.5,127.1']);
    });

    test('skips when map or coordinates are missing', () => {
        expect(focusNaverMapOnRestaurant({
            createLatLng: (lat, lng) => ({ lat, lng }),
            lat: null,
            lng: 127.1,
            map: {
                setCenter: () => {},
                setZoom: () => {},
            },
            zoom: 15,
        })).toBe(false);

        expect(focusNaverMapOnRestaurant({
            createLatLng: (lat, lng) => ({ lat, lng }),
            lat: 37.5,
            lng: 127.1,
            map: null,
            zoom: 15,
        })).toBe(false);
    });
});
