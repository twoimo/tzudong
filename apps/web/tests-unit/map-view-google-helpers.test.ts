import { describe, expect, test } from 'bun:test';

import { buildGoogleMapOptions, getRestaurantLatLng } from '../lib/map-view-google-helpers';

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
});
