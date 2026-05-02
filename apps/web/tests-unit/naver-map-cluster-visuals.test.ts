import { describe, expect, test } from 'bun:test';

import {
    buildNaverClusterAnimationIconPlan,
    buildClusterMarkerContent,
    buildClusterMarkerFeature,
    buildNaverClusterMarkerAcquirePlan,
    buildNaverClusterMarkerRenderPlan,
    getClusterVisualKey,
    getNaverClusterMarkerVisual,
} from '../lib/naver-map-cluster-visuals';

describe('naver map cluster visuals', () => {
    test('hashes string keys deterministically', () => {
        expect(getClusterVisualKey('gangnam')).toBe(getClusterVisualKey('gangnam'));
        expect(getClusterVisualKey(42)).toBe(42);
    });

    test('builds cluster feature with lng/lat coordinates', () => {
        const feature = buildClusterMarkerFeature({ count: 3, lat: 37.5, lng: 127.0 });
        expect(feature.properties.point_count).toBe(3);
        expect(feature.geometry.coordinates).toEqual([127.0, 37.5]);
    });

    test('builds cluster marker html content', () => {
        const html = buildClusterMarkerContent({
            categories: ['한식', '분식'],
            count: 4,
            currentIndex: 0,
            lat: 37.5,
            lng: 127.0,
        });
        expect(html).toContain('4');
        expect(html).toContain('/images/maker-images/korean.png');
    });

    test('returns naver cluster marker visual payload', () => {
        const visual = getNaverClusterMarkerVisual({
            categories: ['한식'],
            count: 3,
            currentIndex: 0,
            lat: 37.5,
            lng: 127.0,
        });
        expect(visual.anchor).toEqual({ x: 24, y: 24 });
        expect(visual.content).toContain('/images/maker-images/korean.png');
    });

    test('builds cluster marker render plan from position and current animation index', () => {
        const plan = buildNaverClusterMarkerRenderPlan({
            categories: ['분식'],
            count: 5,
            currentIndex: 0,
            position: { lat: 37.6, lng: 127.1 },
        });

        expect(plan.position).toEqual({ lat: 37.6, lng: 127.1 });
        expect(plan.anchor).toEqual({ x: 24, y: 24 });
        expect(plan.content).toContain('5');
        expect(plan.content).toContain('/images/maker-images/snack_bar.png');
    });

    test('builds animation icon plan from key and injected index resolver', () => {
        const plan = buildNaverClusterAnimationIconPlan({
            categories: ['한식'],
            count: 6,
            getCurrentIndex: (hash, categoryCount) => {
                expect(hash).toBe(getClusterVisualKey('seoul'));
                expect(categoryCount).toBe(1);
                return 0;
            },
            position: { lat: 37.55, lng: 126.98 },
            uniqueKey: 'seoul',
        });

        expect(plan.hash).toBe(getClusterVisualKey('seoul'));
        expect(plan.currentIndex).toBe(0);
        expect(plan.position).toEqual({ lat: 37.55, lng: 126.98 });
        expect(plan.anchor).toEqual({ x: 24, y: 24 });
        expect(plan.content).toContain('6');
        expect(plan.content).toContain('/images/maker-images/korean.png');
    });

    test('builds acquire plan with register-friendly hash and animation index', () => {
        const seen: Array<{ categoryCount: number; hash: number }> = [];
        const plan = buildNaverClusterMarkerAcquirePlan({
            categories: ['분식', '한식'],
            count: 8,
            getCurrentIndex: (hash, categoryCount) => {
                seen.push({ hash, categoryCount });
                return 1;
            },
            position: { lat: 37.7, lng: 127.2 },
            uniqueKey: 'regional-key',
        });

        expect(seen).toEqual([{ hash: getClusterVisualKey('regional-key'), categoryCount: 2 }]);
        expect(plan.currentIndex).toBe(1);
        expect(plan.hash).toBe(getClusterVisualKey('regional-key'));
        expect(plan.position).toEqual({ lat: 37.7, lng: 127.2 });
        expect(plan.anchor).toEqual({ x: 24, y: 24 });
        expect(plan.content).toContain('8');
    });
});
