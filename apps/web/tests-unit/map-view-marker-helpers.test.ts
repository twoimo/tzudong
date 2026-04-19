import { describe, expect, test } from 'bun:test';

import {
    applyMapViewMarkerSelectedState,
    buildMapViewMarkerHtml,
    getMapViewMarkerSize,
    isMapViewMarkerSelected,
} from '../lib/map-view-marker-helpers';

describe('map view marker helpers', () => {
    test('detects selected marker from selected or searched id', () => {
        expect(isMapViewMarkerSelected({
            restaurantId: 'a',
            selectedRestaurantId: 'a',
            searchedRestaurantId: null,
        })).toBe(true);
        expect(isMapViewMarkerSelected({
            restaurantId: 'a',
            selectedRestaurantId: null,
            searchedRestaurantId: 'a',
        })).toBe(true);
        expect(isMapViewMarkerSelected({
            restaurantId: 'a',
            selectedRestaurantId: 'b',
            searchedRestaurantId: 'c',
        })).toBe(false);
    });

    test('returns marker size by selection state', () => {
        expect(getMapViewMarkerSize(true)).toBe(42);
        expect(getMapViewMarkerSize(false)).toBe(32);
    });

    test('builds marker html with expected content', () => {
        const html = buildMapViewMarkerHtml({
            imagePath: '/images/maker-images/chicken.png',
            isSelected: true,
            markerSize: 42,
            name: '테스트 식당',
        });
        expect(html).toContain('42px');
        expect(html).toContain('animate-bounce');
        expect(html).toContain('테스트 식당');
        expect(html).toContain('/images/maker-images/chicken.png');
    });

    test('applies selected visual state to marker element', () => {
        const classNames = new Set<string>();
        const innerDiv = {
            style: {} as Record<string, string>,
            classList: {
                add: (name: string) => classNames.add(name),
                remove: (name: string) => classNames.delete(name),
            },
        } as any;
        const markerElement = {
            querySelector: () => innerDiv,
        } as any;

        expect(applyMapViewMarkerSelectedState({ isSelected: true, markerElement })).toBe(true);
        expect(innerDiv.style.width).toBe('42px');
        expect(classNames.has('animate-bounce')).toBe(true);

        expect(applyMapViewMarkerSelectedState({ isSelected: false, markerElement })).toBe(true);
        expect(innerDiv.style.width).toBe('32px');
        expect(classNames.has('animate-bounce')).toBe(false);
    });
});
