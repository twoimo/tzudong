import { describe, expect, test } from 'bun:test';

import {
    COUNTRY_CENTERS,
    DEFAULT_OVERSEAS_CENTER,
    DEFAULT_OVERSEAS_ICON,
    getNextOverseasWheelSlider,
    getOverseasInitialConfig,
    getRestaurantCategoryIcon,
    mapZoomToSlider,
    sliderToMapZoom,
} from '../lib/overseas-map-helpers';

describe('overseas map helpers', () => {
    test('returns configured country center', () => {
        expect(COUNTRY_CENTERS['일본']).toEqual({ lat: 35.1815, lng: 136.9066, zoom: 10 });
    });

    test('returns initial config or default center', () => {
        expect(getOverseasInitialConfig('일본(나고야)')).toEqual({ lat: 35.1815, lng: 136.9066, zoom: 11 });
        expect(getOverseasInitialConfig(null)).toEqual(DEFAULT_OVERSEAS_CENTER);
        expect(getOverseasInitialConfig('튀르키예')).toEqual(DEFAULT_OVERSEAS_CENTER);
    });

    test('maps zoom to slider and back consistently', () => {
        const slider = mapZoomToSlider(12);
        expect(slider).toBeGreaterThan(0);
        expect(sliderToMapZoom(slider)).toBeCloseTo(12, 0);
    });

    test('returns category icon and falls back to default', () => {
        expect(getRestaurantCategoryIcon({ categories: ['치킨'] as any })).toContain('chicken');
        expect(getRestaurantCategoryIcon({ categories: ['없는카테고리'] as any })).toBe(DEFAULT_OVERSEAS_ICON);
    });

    test('computes next wheel slider target with continuity', () => {
        const currentSlider = mapZoomToSlider(10);
        const next = getNextOverseasWheelSlider({
            currentMapZoom: 10,
            deltaY: -1,
            previousTargetSlider: currentSlider,
            timeDiffMs: 100,
        });
        expect(next).toBe(currentSlider + 1);
    });
});
