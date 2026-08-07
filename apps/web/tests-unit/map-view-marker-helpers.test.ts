import { describe, expect, test } from 'bun:test';

import { MARKER_IMAGE_FALLBACK } from '../lib/html-escape';
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

    test('builds class-only marker HTML with valid local and HTTPS images', () => {
        for (const imagePath of [
            '/images/maker-images/chicken.png',
            'https://cdn.example.com/markers/chicken.png',
        ]) {
            const html = buildMapViewMarkerHtml({
                imagePath,
                isSelected: true,
                markerSize: 42,
                name: '테스트 식당',
            });

            expect(html).toContain(`src="${imagePath}"`);
            expect(html).toContain('alt="테스트 식당"');
            expect(html).toContain('class="relative h-[42px] w-[42px] cursor-pointer transition-all duration-300 drop-shadow-md animate-bounce hover:scale-125"');
            expect(html).toContain('class="h-full w-full object-contain"');
            expect(html).toContain('draggable="false"');
            expect(html).not.toContain('style=');
        }
    });

    test('fails closed for unsafe marker image values and escapes alt text', () => {
        const unsafeImagePaths = [
            'javascript:alert(1)',
            '%6aavascript%3aalert(1)',
            'data:image/svg+xml,<svg onload=alert(1)>',
            'http://cdn.example.com/marker.png',
            'blob:https://cdn.example.com/marker',
            'file:///tmp/marker.png',
            '//attacker.example/marker.png',
            'https://user:password@cdn.example.com/marker.png',
            'https://cdn.example.com/marker%0A.png',
            '/images/%252e%252e/private.png',
            '/images/maker-images/%.png',
            `/images/${'a'.repeat(2049)}.png`,
            '/images/maker-images/chicken.png" onerror="alert(1)',
        ];

        for (const imagePath of unsafeImagePaths) {
            const html = buildMapViewMarkerHtml({
                imagePath,
                isSelected: false,
                markerSize: 32,
                name: '나쁜 "식당" <script>alert(1)</script>',
            });

            expect(html).toContain(`src="${MARKER_IMAGE_FALLBACK}"`);
            expect(html).toContain('alt="나쁜 &quot;식당&quot; &lt;script&gt;alert(1)&lt;/script&gt;"');
            expect(html).not.toContain('onerror="alert(1)');
            expect(html).not.toContain('<script>');
        }
    });

    test('normalizes non-canonical marker sizes to the selection state size classes', () => {
        for (const markerSize of [NaN, Infinity, -Infinity, -1, 0, 31, 32, 43, Number.MAX_SAFE_INTEGER]) {
            const html = buildMapViewMarkerHtml({
                imagePath: '/images/maker-images/chicken.png',
                isSelected: true,
                markerSize,
                name: '테스트 식당',
            });

            expect(html).toContain('h-[42px] w-[42px]');
            expect(html).not.toContain(`${markerSize}px`);
            expect(html).not.toContain('style=');
        }

        const unselectedHtml = buildMapViewMarkerHtml({
            imagePath: '/images/maker-images/chicken.png',
            isSelected: false,
            markerSize: 42,
            name: '테스트 식당',
        });

        expect(unselectedHtml).toContain('h-8 w-8');
        expect(unselectedHtml).not.toContain('h-[42px]');
    });

    test('toggles only the fixed selected and size classes without style mutation', () => {
        const classNames = new Set<string>();
        const innerDiv = {
            classList: {
                add: (...names: string[]) => names.forEach((name) => classNames.add(name)),
                remove: (...names: string[]) => names.forEach((name) => classNames.delete(name)),
            },
        };
        const markerElement = {
            querySelector: () => innerDiv,
        } as unknown as HTMLElement;

        expect(applyMapViewMarkerSelectedState({ isSelected: true, markerElement })).toBe(true);
        expect([...classNames].sort()).toEqual(['animate-bounce', 'h-[42px]', 'w-[42px]']);
        expect('style' in innerDiv).toBe(false);

        expect(applyMapViewMarkerSelectedState({ isSelected: false, markerElement })).toBe(true);
        expect([...classNames].sort()).toEqual(['h-8', 'w-8']);
        expect('style' in innerDiv).toBe(false);
    });
});
