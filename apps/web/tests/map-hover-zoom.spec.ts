import { test, expect, type Page } from '@playwright/test';
import { hidePopupOverlay } from './helpers';

type PointSnapshot = {
    lat: number;
    lng: number;
    zoom: number;
};

type NaverPointLike = {
    x: number;
    y: number;
};

type NaverCoordLike = {
    lat: () => number;
    lng: () => number;
};

type NaverProjectionLike = {
    fromOffsetToCoord: (point: NaverPointLike) => NaverCoordLike | null;
    fromCoordToOffset: (coord: NaverCoordLike | { lat: number; lng: number }) => NaverPointLike;
};

type DebugMapLike = {
    getProjection: () => NaverProjectionLike | null;
    getZoom: () => number;
    getCenter: () => NaverCoordLike;
};

type DebugWindow = Window & {
    naver?: {
        maps: {
            Point: new (x: number, y: number) => NaverPointLike;
        };
    };
    __TZUDONG_DEBUG_MAP__?: DebugMapLike;
};

const readPointSnapshot = async (
    x: number,
    y: number,
    viewportWidth: number,
    viewportHeight: number,
    page: Page
): Promise<PointSnapshot> => {
    const snapshot = await page.evaluate(({ x, y, viewportWidth, viewportHeight }) => {
        const debugWindow = window as unknown as DebugWindow;
        const map = debugWindow.__TZUDONG_DEBUG_MAP__;
        const naver = debugWindow.naver;
        if (!map || !naver) return null;

        const projection = map.getProjection();
        if (!projection) return null;

        const center = map.getCenter();
        const centerOffset = projection.fromCoordToOffset(center);
        const mouseOffset = new naver.maps.Point(
            centerOffset.x + (x - viewportWidth / 2),
            centerOffset.y + (y - viewportHeight / 2)
        );
        const coord = projection.fromOffsetToCoord(mouseOffset);
        if (!coord) return null;

        return {
            lat: coord.lat(),
            lng: coord.lng(),
            zoom: map.getZoom(),
        };
    }, { x, y, viewportWidth, viewportHeight });

    if (!snapshot) {
        throw new Error('Failed to read map snapshot from debug map instance');
    }

    return snapshot;
};

const distanceMeters = (a: PointSnapshot, b: PointSnapshot): number => {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const r = 6371000;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);

    const h = Math.sin(dLat / 2) ** 2
        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * r * Math.asin(Math.sqrt(h));
};

test.describe('Map hover anchored zoom', () => {
    test('MAP-HOVER-01: wheel zoom keeps hovered coordinate stable', async ({ page }) => {
        await page.goto('/');
        await hidePopupOverlay(page);
        const mapContainer = page.getByTestId('map-container');
        await expect(mapContainer).toBeVisible({ timeout: 15000 });

        await page.waitForFunction(() => {
            const debugWindow = window as unknown as DebugWindow;
            const map = debugWindow.__TZUDONG_DEBUG_MAP__;
            return !!(map && map.getProjection && map.getProjection());
        }, undefined, { timeout: 15000 });

        const box = await mapContainer.boundingBox();
        expect(box).not.toBeNull();

        const hoverX = Math.round((box?.width ?? 0) * 0.72);
        const hoverY = Math.round((box?.height ?? 0) * 0.36);
        const clientX = Math.round((box?.x ?? 0) + hoverX);
        const clientY = Math.round((box?.y ?? 0) + hoverY);

        const viewportWidth = Math.round(box?.width ?? 0);
        const viewportHeight = Math.round(box?.height ?? 0);

        const beforeZoomIn = await readPointSnapshot(hoverX, hoverY, viewportWidth, viewportHeight, page);
        await page.mouse.move(clientX, clientY);
        await page.mouse.wheel(0, -200);

        await page.waitForFunction((prevZoom) => {
            const debugWindow = window as unknown as DebugWindow;
            const map = debugWindow.__TZUDONG_DEBUG_MAP__;
            return !!map && map.getZoom() !== prevZoom;
        }, beforeZoomIn.zoom, { timeout: 10000 });

        const afterZoomIn = await readPointSnapshot(hoverX, hoverY, viewportWidth, viewportHeight, page);
        expect(afterZoomIn.zoom).toBeGreaterThan(beforeZoomIn.zoom);
        expect(distanceMeters(beforeZoomIn, afterZoomIn)).toBeLessThan(100);

        const beforeZoomOut = afterZoomIn;
        await page.mouse.move(clientX, clientY);
        await page.mouse.wheel(0, 200);

        await page.waitForFunction((prevZoom) => {
            const debugWindow = window as unknown as DebugWindow;
            const map = debugWindow.__TZUDONG_DEBUG_MAP__;
            return !!map && map.getZoom() !== prevZoom;
        }, beforeZoomOut.zoom, { timeout: 10000 });

        const afterZoomOut = await readPointSnapshot(hoverX, hoverY, viewportWidth, viewportHeight, page);
        expect(afterZoomOut.zoom).toBeLessThan(beforeZoomOut.zoom);
        expect(distanceMeters(beforeZoomOut, afterZoomOut)).toBeLessThan(100);
    });
});
