import { describe, expect, test } from 'bun:test';

import {
    buildNaverMapOptions,
    getDeviceAdjustedZoom,
    isNaverMapInstanceReusable,
    parseNaverMapUrlState,
    resolveNaverInitialMapView,
    resolveNaverInitialView,
    resolveNaverPostInitPlan,
    resolveNaverRegionConfig,
    resolveNaverStaleMapCleanupPlan,
    scheduleNaverInitialIdleTrigger,
} from '../lib/naver-map-init-helpers';

describe('naver map init helpers', () => {
    test('adjusts zoom for mobile but not for national view', () => {
        expect(getDeviceAdjustedZoom(12, true, false)).toBe(10);
        expect(getDeviceAdjustedZoom(7, true, false)).toBe(6);
        expect(getDeviceAdjustedZoom(8, true, true)).toBe(8);
    });

    test('parses z and legacy c url zoom state', () => {
        expect(parseNaverMapUrlState('?z=12&lat=37.5&lng=127.0')).toMatchObject({
            hasValidUrlState: true,
            urlZoom: 12,
            urlLat: 37.5,
            urlLng: 127,
        });
        expect(parseNaverMapUrlState('?c=9,rest&lat=37.6&lng=126.9').urlZoom).toBe(9);
        expect(parseNaverMapUrlState('?z=bad').hasValidUrlState).toBe(false);
    });

    test('resolves region config and national flag', () => {
        expect(resolveNaverRegionConfig(null).isNational).toBe(true);
        expect(resolveNaverRegionConfig('서울특별시' as any).isNational).toBe(false);
    });

    test('resolves initial view from url state or region defaults', () => {
        expect(resolveNaverInitialView({
            defaultZoom: 9,
            hasValidUrlState: true,
            regionCenter: [37.5, 127],
            urlLat: 35.1,
            urlLng: 128.2,
            urlZoom: 12,
        })).toEqual({
            initialCenter: [35.1, 128.2],
            initialZoom: 12,
        });

        expect(resolveNaverInitialView({
            defaultZoom: 9,
            hasValidUrlState: false,
            regionCenter: [37.5, 127],
            urlLat: 35.1,
            urlLng: 128.2,
            urlZoom: 12,
        })).toEqual({
            initialCenter: [37.5, 127],
            initialZoom: 9,
        });
    });

    test('resolves initial map view from search and region', () => {
        const result = resolveNaverInitialMapView({
            getDeviceAdjustedZoom: (zoom) => zoom - 1,
            search: '?z=12&lat=37.1&lng=127.2',
            selectedRegion: '서울특별시' as any,
        });

        expect(result.hasValidUrlState).toBe(true);
        expect(result.initialCenter).toEqual([37.1, 127.2]);
        expect(result.initialZoom).toBe(12);
        expect(result.defaultZoom).toBeTypeOf('number');
    });

    test('builds stable naver map options', () => {
        expect(buildNaverMapOptions({
            center: { lat: 37.5, lng: 127 },
            positionTopLeft: 'TL',
            positionTopRight: 'TR',
            zoom: 11,
        })).toEqual({
            center: { lat: 37.5, lng: 127 },
            zoom: 11,
            minZoom: 6,
            maxZoom: 18,
            zoomControl: false,
            zoomControlOptions: { position: 'TR' },
            mapTypeControl: false,
            mapTypeControlOptions: { position: 'TL' },
            scaleControl: false,
            background: '#f5f5f5',
            tileSpare: 3,
            tileTransition: true,
            scrollWheel: false,
            pinchZoom: true,
            draggable: true,
            keyboardShortcuts: true,
        });
    });

    test('reuses existing map instance only when center, content, and size are valid', () => {
        const healthyElement = {
            children: { length: 0 },
            getBoundingClientRect: () => ({ width: 320, height: 240 }),
            querySelector: () => ({ className: 'naver-map-pane' }),
        };

        expect(isNaverMapInstanceReusable({
            mapElement: healthyElement,
            mapInstance: { getCenter: () => ({ lat: 37.5, lng: 127 }) },
        })).toBe(true);

        expect(isNaverMapInstanceReusable({
            mapElement: healthyElement,
            mapInstance: { getCenter: () => null },
        })).toBe(false);

        expect(isNaverMapInstanceReusable({
            mapElement: {
                children: { length: 0 },
                getBoundingClientRect: () => ({ width: 320, height: 240 }),
                querySelector: () => null,
            },
            mapInstance: { getCenter: () => ({ lat: 37.5, lng: 127 }) },
        })).toBe(false);

        expect(isNaverMapInstanceReusable({
            mapElement: {
                children: { length: 1 },
                getBoundingClientRect: () => ({ width: 0, height: 240 }),
                querySelector: () => null,
            },
            mapInstance: { getCenter: () => ({ lat: 37.5, lng: 127 }) },
        })).toBe(false);
    });

    test('resolves stale map cleanup state only when an instance exists', () => {
        expect(resolveNaverStaleMapCleanupPlan({
            mapInstance: { id: 'stale-map' },
        })).toEqual({
            nextIsMapInitialized: false,
            nextMapInstance: null,
            nextMarkerRenderSignature: null,
            shouldCleanup: true,
        });

        expect(resolveNaverStaleMapCleanupPlan({
            mapInstance: null,
        })).toEqual({
            nextIsMapInitialized: false,
            nextMapInstance: null,
            nextMarkerRenderSignature: null,
            shouldCleanup: false,
        });
    });

    test('resolves post-init debug exposure and URL initial-load flags', () => {
        expect(resolveNaverPostInitPlan({
            hasValidUrlState: true,
            nodeEnv: 'development',
        })).toEqual({
            shouldExposeDebugMap: true,
            shouldMarkInitialLoadFromUrl: true,
        });

        expect(resolveNaverPostInitPlan({
            hasValidUrlState: false,
            nodeEnv: 'production',
        })).toEqual({
            shouldExposeDebugMap: false,
            shouldMarkInitialLoadFromUrl: false,
        });
    });

    test('schedules initial idle trigger only when map exists', () => {
        const calls: string[] = [];
        const timers: Array<() => void> = [];

        scheduleNaverInitialIdleTrigger({
            map: { id: 'map' } as any,
            setTimeoutFn: ((fn: () => void) => {
                timers.push(fn);
                return timers.length as unknown as ReturnType<typeof setTimeout>;
            }) as typeof setTimeout,
            triggerIdle: (map) => calls.push((map as { id: string }).id),
        });

        timers[0]();
        expect(calls).toEqual(['map']);

        scheduleNaverInitialIdleTrigger({
            map: null,
            setTimeoutFn: ((fn: () => void) => {
                timers.push(fn);
                return timers.length as unknown as ReturnType<typeof setTimeout>;
            }) as typeof setTimeout,
            triggerIdle: () => calls.push('noop'),
        });

        timers[1]();
        expect(calls).toEqual(['map']);
    });
});
