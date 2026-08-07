import { describe, expect, test } from 'bun:test';

import { MARKER_IMAGE_FALLBACK } from '../lib/html-escape';
import {
    applyOverseasMarkerSelectedState,
    buildOverseasMarkerHtml,
    getOverseasMarkerActiveId,
} from '../lib/overseas-map-marker-helpers';

describe('overseas map marker helpers', () => {
    test('builds class-only marker HTML with valid local and HTTPS images', () => {
        for (const imagePath of [
            '/images/maker-images/asian.png',
            'https://cdn.example.com/markers/asian.png',
        ]) {
            const html = buildOverseasMarkerHtml({
                imagePath,
                name: '테스트 식당',
            });

            expect(html).toContain(`src="${imagePath}"`);
            expect(html).toContain('alt="테스트 식당"');
            expect(html).toContain('class="marker-container relative h-full w-full cursor-pointer drop-shadow-md transition-transform duration-200 hover:scale-110"');
            expect(html).toContain('class="h-full w-full object-contain"');
            expect(html).toContain('draggable="false"');
            expect(html).not.toContain('style=');
        }
    });

    test('fails closed for unsafe marker image values and escapes alt text', () => {
        const unsafeImagePaths = [
            'javascript:alert(1)',
            'data:image/svg+xml,<svg onload=alert(1)>',
            '//attacker.example/marker.png',
            'https://user:password@cdn.example.com/marker.png',
            '/images/%2e%2e/private.png',
            '/images/maker-images/asian.png" onerror="alert(1)',
        ];

        for (const imagePath of unsafeImagePaths) {
            const html = buildOverseasMarkerHtml({
                imagePath,
                name: '해외 "식당" <img>',
            });

            expect(html).toContain(`src="${MARKER_IMAGE_FALLBACK}"`);
            expect(html).toContain('alt="해외 &quot;식당&quot; &lt;img&gt;"');
            expect(html).not.toContain('onerror="alert(1)');
            expect(html).not.toContain('<img>');
        }
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

    test('toggles only fixed size and selected classes without style mutation', () => {
        const markerClassNames = new Set<string>();
        const containerClassNames = new Set<string>();
        const markerElement = {
            classList: {
                add: (...names: string[]) => names.forEach((name) => markerClassNames.add(name)),
                remove: (...names: string[]) => names.forEach((name) => markerClassNames.delete(name)),
            },
        } as unknown as HTMLElement;
        const container = {
            classList: {
                add: (...names: string[]) => names.forEach((name) => containerClassNames.add(name)),
                remove: (...names: string[]) => names.forEach((name) => containerClassNames.delete(name)),
            },
        } as unknown as HTMLElement;

        applyOverseasMarkerSelectedState({
            container,
            isSelected: true,
            markerElement,
        });
        expect([...markerClassNames].sort()).toEqual(['!h-[42px]', '!w-[42px]', 'selected']);
        expect([...containerClassNames].sort()).toEqual(['scale-110']);
        expect('style' in markerElement).toBe(false);
        expect('style' in container).toBe(false);

        applyOverseasMarkerSelectedState({
            container,
            isSelected: false,
            markerElement,
        });
        expect([...markerClassNames].sort()).toEqual(['!h-8', '!w-8']);
        expect([...containerClassNames].sort()).toEqual(['scale-100']);
        expect('style' in markerElement).toBe(false);
        expect('style' in container).toBe(false);
    });
});
