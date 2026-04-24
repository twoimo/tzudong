import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { getMobileScrollNavVisibilityAction } from '../lib/mobile-scroll-nav-visibility';

describe('mobile scroll nav visibility', () => {
    test('hides the bottom nav while scrolling down through the review feed', () => {
        expect(getMobileScrollNavVisibilityAction({
            previousScrollTop: 40,
            currentScrollTop: 72,
            isHidden: false,
        })).toBe('hide');
    });

    test('shows the bottom nav when scrolling back up', () => {
        expect(getMobileScrollNavVisibilityAction({
            previousScrollTop: 120,
            currentScrollTop: 84,
            isHidden: true,
        })).toBe('show');
    });

    test('shows the bottom nav near the top even after it was hidden', () => {
        expect(getMobileScrollNavVisibilityAction({
            previousScrollTop: 40,
            currentScrollTop: 0,
            isHidden: true,
        })).toBe('show');
    });

    test('ignores tiny scroll jitter', () => {
        expect(getMobileScrollNavVisibilityAction({
            previousScrollTop: 100,
            currentScrollTop: 106,
            isHidden: false,
        })).toBe('unchanged');
    });
});

describe('mobile mypage scroll frame guards', () => {
    const readProjectFile = (relativePath: string) =>
        readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

    test('mypage scroll frame uses the parent viewport instead of a nested 100vh calc', () => {
        const layoutSource = readProjectFile('app/mypage/layout.tsx');

        expect(layoutSource).not.toContain('h-[calc(100vh-64px)]');
        expect(layoutSource).toContain('h-full min-h-0 bg-background overflow-hidden');
        expect(layoutSource).toContain('flex-1 h-full min-h-0 overflow-y-auto');
        expect(layoutSource).toContain('flex h-full min-h-full flex-col');
        expect(layoutSource).toContain('GlobalLoader');
    });

    test('mypage scroll frame avoids snap locking so the top area remains freely scrollable', () => {
        const layoutSource = readProjectFile('app/mypage/layout.tsx');
        const bookmarksSource = readProjectFile('app/mypage/bookmarks/page.tsx');
        const reviewsSource = readProjectFile('app/mypage/reviews/page.tsx');

        expect(layoutSource).not.toContain('snap-y');
        expect(bookmarksSource).not.toContain('snap-start');
        expect(reviewsSource).not.toContain('snap-start');
    });
});
