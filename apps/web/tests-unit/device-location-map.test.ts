import { describe, expect, test } from 'bun:test';

import {
    buildDeviceLocationMarkerHtml,
    normalizeCompassHeading,
    resolveDeviceLocationAccuracyRadius,
    resolveDeviceLocationButtonLabel,
    resolveDeviceLocationFocusZoom,
    resolveDeviceLocationMapRenderPlan,
    resolveDeviceLocationStateUpdatePlan,
    resolveDeviceOrientationHeading,
    resolveGeolocationHeading,
    shouldFocusDeviceLocation,
} from '../lib/device-location-map';

describe('device location map helpers', () => {
    test('normalizes compass headings into clockwise degrees', () => {
        expect(normalizeCompassHeading(0)).toBe(0);
        expect(normalizeCompassHeading(360)).toBe(0);
        expect(normalizeCompassHeading(-15)).toBe(345);
        expect(normalizeCompassHeading(725)).toBe(5);
        expect(normalizeCompassHeading(Number.NaN)).toBeNull();
    });

    test('prefers iOS compass heading and converts absolute alpha fallback', () => {
        expect(resolveDeviceOrientationHeading({ alpha: 20, absolute: true, webkitCompassHeading: 123 })).toBe(123);
        expect(resolveDeviceOrientationHeading({ alpha: 20, absolute: true })).toBe(340);
        expect(resolveDeviceOrientationHeading({ alpha: 20, absolute: false })).toBeNull();
    });

    test('normalizes moving geolocation heading only when available', () => {
        expect(resolveGeolocationHeading(181)).toBe(181);
        expect(resolveGeolocationHeading(null)).toBeNull();
        expect(resolveGeolocationHeading(undefined)).toBeNull();
    });

    test('labels the floating button by tap progression', () => {
        expect(resolveDeviceLocationButtonLabel({ hasLocation: false, isHeadingMode: false, isPending: false })).toBe('현재 위치 보기');
        expect(resolveDeviceLocationButtonLabel({ hasLocation: true, isHeadingMode: false, isPending: false })).toBe('현재 위치 기준 방향 확인');
        expect(resolveDeviceLocationButtonLabel({ hasLocation: true, isHeadingMode: true, isPending: false })).toBe('현재 위치와 방향 다시 확인');
        expect(resolveDeviceLocationButtonLabel({ hasLocation: true, isHeadingMode: true, isPending: true })).toBe('현재 위치 확인 중');
    });

    test('focuses only when a locate request changes', () => {
        expect(shouldFocusDeviceLocation(null, null)).toBe(false);
        expect(shouldFocusDeviceLocation(null, { focusRequestId: 1 })).toBe(true);
        expect(shouldFocusDeviceLocation(1, { focusRequestId: 1 })).toBe(false);
        expect(shouldFocusDeviceLocation(1, { focusRequestId: 2 })).toBe(true);
    });

    test('clamps accuracy radius for map overlays', () => {
        expect(resolveDeviceLocationAccuracyRadius(null)).toBeNull();
        expect(resolveDeviceLocationAccuracyRadius(Number.NaN)).toBeNull();
        expect(resolveDeviceLocationAccuracyRadius(Number.POSITIVE_INFINITY)).toBeNull();
        expect(resolveDeviceLocationAccuracyRadius(-50)).toBe(12);
        expect(resolveDeviceLocationAccuracyRadius(0)).toBe(12);
        expect(resolveDeviceLocationAccuracyRadius(42)).toBe(42);
        expect(resolveDeviceLocationAccuracyRadius(Number.MAX_VALUE)).toBe(500);
        expect(resolveDeviceLocationAccuracyRadius(-50, 25, 75)).toBe(25);
        expect(resolveDeviceLocationAccuracyRadius(Number.MAX_VALUE, 25, 75)).toBe(75);
    });

    test('keeps device-location focus zoom at least the map minimum', () => {
        expect(resolveDeviceLocationFocusZoom(11)).toBe(15);
        expect(resolveDeviceLocationFocusZoom(16)).toBe(16);
        expect(resolveDeviceLocationFocusZoom(Number.NaN)).toBe(15);
        expect(resolveDeviceLocationFocusZoom(8, 10)).toBe(10);
    });

    test('builds a pure device-location render plan for marker effects', () => {
        expect(resolveDeviceLocationMapRenderPlan({
            currentZoom: 13,
            location: null,
            previousFocusRequestId: 7,
        })).toEqual({
            accuracyRadius: null,
            focusZoom: 15,
            hasLocation: false,
            nextFocusedRequestId: null,
            shouldFocus: false,
        });

        expect(resolveDeviceLocationMapRenderPlan({
            currentZoom: 16,
            location: { accuracy: 2, focusRequestId: 8 },
            previousFocusRequestId: 7,
        })).toEqual({
            accuracyRadius: 12,
            focusZoom: 16,
            hasLocation: true,
            nextFocusedRequestId: 8,
            shouldFocus: true,
        });

        expect(resolveDeviceLocationMapRenderPlan({
            currentZoom: 12,
            location: { accuracy: 720, focusRequestId: 8 },
            previousFocusRequestId: 8,
        })).toEqual({
            accuracyRadius: 500,
            focusZoom: 15,
            hasLocation: true,
            nextFocusedRequestId: 8,
            shouldFocus: false,
        });
    });

    test('skips insignificant device-location jitter before it reaches React state', () => {
        const previous = {
            lat: 37.5665,
            lng: 126.9780,
            accuracy: 24,
            heading: 90,
            mode: 'heading' as const,
            focusRequestId: 4,
            updatedAt: 1000,
        };

        expect(resolveDeviceLocationStateUpdatePlan({
            previous: null,
            next: previous,
        })).toEqual({
            nextLocation: previous,
            shouldUpdate: true,
        });

        const tinyJitter = {
            ...previous,
            heading: 91.5,
            updatedAt: 1100,
        };
        expect(resolveDeviceLocationStateUpdatePlan({
            previous,
            next: tinyJitter,
        })).toEqual({
            nextLocation: previous,
            shouldUpdate: false,
        });

        const focusRequest = {
            ...tinyJitter,
            focusRequestId: 5,
        };
        expect(resolveDeviceLocationStateUpdatePlan({
            previous,
            next: focusRequest,
        })).toEqual({
            nextLocation: focusRequest,
            shouldUpdate: true,
        });

        const meaningfulHeading = {
            ...previous,
            heading: 96,
            updatedAt: 1200,
        };
        expect(resolveDeviceLocationStateUpdatePlan({
            previous,
            next: meaningfulHeading,
        })).toEqual({
            nextLocation: meaningfulHeading,
            shouldUpdate: true,
        });

        const meaningfulMove = {
            ...previous,
            lat: 37.56655,
            updatedAt: 1300,
        };
        expect(resolveDeviceLocationStateUpdatePlan({
            previous,
            next: meaningfulMove,
        })).toEqual({
            nextLocation: meaningfulMove,
            shouldUpdate: true,
        });
    });

    test('renders a direction marker only after heading mode has a heading', () => {
        const positionHtml = buildDeviceLocationMarkerHtml({ accuracy: 17.2, heading: null, mode: 'position' });
        expect(positionHtml).toContain('17m');
        expect(positionHtml).not.toContain('rotate(');

        const headingHtml = buildDeviceLocationMarkerHtml({ accuracy: 17.2, heading: 92.4, mode: 'heading' });
        expect(headingHtml).toContain('92°');
        expect(headingHtml).toContain('rotate(92.4deg)');
    });

    test('uses the bounded map radius for position-marker accuracy labels', () => {
        const cases = [
            { accuracy: -50, expectedRadius: 12, expectedLabel: '12m' },
            { accuracy: 0, expectedRadius: 12, expectedLabel: '12m' },
            { accuracy: 42, expectedRadius: 42, expectedLabel: '42m' },
            { accuracy: Number.MAX_VALUE, expectedRadius: 500, expectedLabel: '500m' },
            { accuracy: Number.POSITIVE_INFINITY, expectedRadius: null, expectedLabel: '현재 위치' },
            { accuracy: Number.NaN, expectedRadius: null, expectedLabel: '현재 위치' },
            { accuracy: null, expectedRadius: null, expectedLabel: '현재 위치' },
        ];

        for (const { accuracy, expectedRadius, expectedLabel } of cases) {
            const markerHtml = buildDeviceLocationMarkerHtml({ accuracy, heading: null, mode: 'position' });

            expect(resolveDeviceLocationAccuracyRadius(accuracy)).toBe(expectedRadius);
            expect(markerHtml).toContain(`>${expectedLabel}</span>`);
            expect(markerHtml).not.toMatch(/-50m|Infinity|NaN|e[+-]\d+m/);
        }
    });
});
