import { describe, expect, test } from 'bun:test';

import {
    buildDeviceLocationMarkerHtml,
    normalizeCompassHeading,
    resolveDeviceLocationAccuracyRadius,
    resolveDeviceLocationButtonLabel,
    resolveDeviceLocationFocusZoom,
    resolveDeviceLocationMapRenderPlan,
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
        expect(resolveDeviceLocationAccuracyRadius(4)).toBe(12);
        expect(resolveDeviceLocationAccuracyRadius(42)).toBe(42);
        expect(resolveDeviceLocationAccuracyRadius(800)).toBe(500);
        expect(resolveDeviceLocationAccuracyRadius(8, 5, 20)).toBe(8);
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

    test('renders a direction marker only after heading mode has a heading', () => {
        const positionHtml = buildDeviceLocationMarkerHtml({ accuracy: 17.2, heading: null, mode: 'position' });
        expect(positionHtml).toContain('17m');
        expect(positionHtml).not.toContain('rotate(');

        const headingHtml = buildDeviceLocationMarkerHtml({ accuracy: 17.2, heading: 92.4, mode: 'heading' });
        expect(headingHtml).toContain('92°');
        expect(headingHtml).toContain('rotate(92.4deg)');
    });
});
