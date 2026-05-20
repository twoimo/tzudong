import { describe, expect, test } from 'bun:test';

import { buildRestaurantDetailMediaCopy } from '../lib/restaurant-detail-media-copy';

describe('restaurant detail media copy', () => {
    test('uses natural Korean copy for merged youtube videos without technical source wording', () => {
        const copy = buildRestaurantDetailMediaCopy('youtube', 3, false);

        expect(copy.title).toBe('쯔양 유튜브 영상');
        expect(copy.countLabel).toBe('3개 영상');
        expect(copy.collapsedToggleLabel).toBe('영상 2개 더 보기');
        expect(copy.collapsedHint).toBe('영상 3개가 연결되어 있어요. 펼쳐서 모두 확인할 수 있습니다.');
        expect(copy.itemBadge(1)).toBe('영상 1/3');
        expect(copy.toggleAriaLabel).toBe('쯔양 유튜브 영상 2개 더 보기');
        const visibleCopy = [
            copy.countLabel,
            copy.collapsedToggleLabel,
            copy.collapsedHint,
            copy.itemBadge(1),
            copy.toggleAriaLabel,
        ].join(' ');
        expect(visibleCopy).not.toContain('원천');
        expect(visibleCopy).not.toContain('병합');
        expect(visibleCopy.toLowerCase()).not.toContain('source');
        expect(visibleCopy.toLowerCase()).not.toContain('origin');
    });

    test('uses matching natural Korean copy for merged reviews', () => {
        const copy = buildRestaurantDetailMediaCopy('review', 4, false);

        expect(copy.title).toBe('쯔양의 리뷰');
        expect(copy.countLabel).toBe('4개 리뷰');
        expect(copy.collapsedToggleLabel).toBe('리뷰 3개 더 보기');
        expect(copy.collapsedHint).toBe('리뷰 4개가 연결되어 있어요. 펼쳐서 모두 확인할 수 있습니다.');
        expect(copy.itemBadge(2)).toBe('리뷰 2/4');
        expect(copy.openAriaLabel(2)).toBe('쯔양의 리뷰 2/4 열기');
        const visibleCopy = [
            copy.countLabel,
            copy.collapsedToggleLabel,
            copy.collapsedHint,
            copy.itemBadge(2),
            copy.openAriaLabel(2),
        ].join(' ');
        expect(visibleCopy).not.toContain('원천');
        expect(visibleCopy).not.toContain('병합');
        expect(visibleCopy.toLowerCase()).not.toContain('source');
        expect(visibleCopy.toLowerCase()).not.toContain('origin');
    });

    test('uses concise expanded toggle text', () => {
        const copy = buildRestaurantDetailMediaCopy('youtube', 2, true);

        expect(copy.expandedToggleLabel).toBe('접기');
        expect(copy.toggleAriaLabel).toBe('쯔양 유튜브 영상 접기');
    });
});
