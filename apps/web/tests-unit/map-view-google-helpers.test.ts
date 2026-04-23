import { describe, expect, test } from 'bun:test';

import {
    buildGoogleMapOptions,
    getRestaurantLatLng,
    panGoogleMapToPosition,
} from '../lib/map-view-google-helpers';

describe('map view google helpers', () => {
    test('returns numeric restaurant coordinates', () => {
        expect(getRestaurantLatLng({ lat: '37.5' as any, lng: '127.0' as any })).toEqual({
            lat: 37.5,
            lng: 127,
        });
        expect(getRestaurantLatLng({ lat: 'bad' as any, lng: 127 as any })).toBeNull();
        expect(getRestaurantLatLng(null)).toBeNull();
    });

    test('builds stable google map options', () => {
        expect(buildGoogleMapOptions({
            center: { lat: 37.5, lng: 127.0 },
            zoom: 10,
        })).toEqual({
            center: { lat: 37.5, lng: 127.0 },
            zoom: 10,
            mapId: 'tzudong-map',
            disableDefaultUI: false,
            zoomControl: true,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
        });
    });

    test('pans google map to position after triggering resize', () => {
        const calls: string[] = [];

        panGoogleMapToPosition({
            map: {
                panTo: ({ lat, lng }) => calls.push(`pan:${lat},${lng}`),
                setZoom: (zoom) => calls.push(`zoom:${zoom}`),
            },
            position: { lat: 37.5, lng: 127.0 },
            triggerResize: () => calls.push('resize'),
            zoom: 14,
        });

        expect(calls).toEqual(['resize', 'pan:37.5,127', 'zoom:14']);
    });
});
