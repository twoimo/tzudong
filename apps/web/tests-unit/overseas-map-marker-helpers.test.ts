import { describe, expect, test } from 'bun:test';

import {
    applyOverseasMarkerSelectedState,
    buildOverseasMarkerHtml,
    getOverseasMarkerActiveId,
} from '../lib/overseas-map-marker-helpers';

describe('overseas map marker helpers', () => {
    test('builds marker html with image and alt text', () => {
        const html = buildOverseasMarkerHtml({
            imagePath: '/images/maker-images/asian.png',
            name: '테스트 식당',
        });

        expect(html).toContain('/images/maker-images/asian.png');
        expect(html).toContain('테스트 식당');
        expect(html).toContain('marker-container');
    });

    test('prefers selected restaurant id over searched id', () => {
        expect(getOverseasMarkerActiveId({
            searchedRestaurantId: 'searched',
            selectedRestaurantId: 'selected',
        })).toBe('selected');
        expect(getOverseasMarkerActiveId({
            searchedRestaurantId: 'searched',
            selectedRestaurantId: null,
        })).toBe('searched');
    });

    test('applies selected visual state to marker element', () => {
        const classNames = new Set<string>();
        const markerElement = {
            style: {} as Record<string, string>,
            classList: {
                add: (name: string) => classNames.add(name),
                remove: (name: string) => classNames.delete(name),
            },
        } as any;
        const container = {
            style: {} as Record<string, string>,
        } as any;

        applyOverseasMarkerSelectedState({
            container,
            isSelected: true,
            markerElement,
        });
        expect(markerElement.style.width).toBe('42px');
        expect(container.style.transform).toBe('scale(1.1)');
        expect(classNames.has('selected')).toBe(true);

        applyOverseasMarkerSelectedState({
            container,
            isSelected: false,
            markerElement,
        });
        expect(markerElement.style.width).toBe('32px');
        expect(container.style.transform).toBe('scale(1)');
        expect(classNames.has('selected')).toBe(false);
    });
});
