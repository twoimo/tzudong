import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
    DEFAULT_BROWSER_TITLE_LABEL,
    DEFAULT_TITLE,
    buildBrowserTitle,
    buildNoIndexMetadata,
    buildScopedBrowserTitle,
    sanitizeBrowserTitleLabel,
    truncateBrowserTitleLabel,
} from '../lib/seo';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

const SITE_SUFFIX = '쯔동여지도';
const FALLBACK_TITLE = '쯔양이 다녀간 맛집 지도 - 쯔동여지도';

describe('browser title helpers', () => {
    test('keeps the page-first fallback title and site suffix contract', () => {
        expect(DEFAULT_BROWSER_TITLE_LABEL).toBe('쯔양이 다녀간 맛집 지도');
        expect(DEFAULT_TITLE).toBe(FALLBACK_TITLE);
        expect(buildBrowserTitle(null)).toBe(FALLBACK_TITLE);
        expect(buildBrowserTitle(undefined)).toBe(FALLBACK_TITLE);
        expect(buildBrowserTitle('   ')).toBe(FALLBACK_TITLE);
        expect(buildBrowserTitle('맛집 상세')).toBe(`맛집 상세 - ${SITE_SUFFIX}`);
    });

    test('sanitizes labels without manual HTML escaping', () => {
        expect(sanitizeBrowserTitleLabel('  <맛집>\n\t상세\u0000\u0085\u202e보기  ')).toBe('<맛집> 상세보기');
        expect(sanitizeBrowserTitleLabel('\u2066\u200f')).toBe('쯔양이 다녀간 맛집 지도');
        expect(buildBrowserTitle('  A   B\nC\u202d  ')).toBe(`A B C - ${SITE_SUFFIX}`);
    });

    test('truncates by code points and appends an ellipsis when over limit', () => {
        expect(truncateBrowserTitleLabel('가나다라마', 3)).toBe('가나다…');
        expect(truncateBrowserTitleLabel('🍜🍣🍱', 2)).toBe('🍜🍣…');
        expect(truncateBrowserTitleLabel('🍜🍣', 2)).toBe('🍜🍣');
    });

    test('builds scoped titles from sanitized nonblank labels before the suffix', () => {
        expect(buildScopedBrowserTitle(['대시보드 (KPI)', '관리자 콘솔'])).toBe(
            `대시보드 (KPI) - 관리자 콘솔 - ${SITE_SUFFIX}`,
        );
        expect(buildScopedBrowserTitle(['  대시보드\n(KPI) ', null, ' \u202e ', '관리자\t콘솔'])).toBe(
            `대시보드 (KPI) - 관리자 콘솔 - ${SITE_SUFFIX}`,
        );
        expect(buildScopedBrowserTitle([null, undefined, ''])).toBe(FALLBACK_TITLE);
    });

    test('adds explicit noindex metadata title and optional description without changing robots', () => {
        const metadata = buildNoIndexMetadata({
            title: '관리자 콘솔 - 쯔동여지도',
            description: '관리자 전용 페이지입니다.',
        });

        expect(metadata.title).toBe('관리자 콘솔 - 쯔동여지도');
        expect(metadata.description).toBe('관리자 전용 페이지입니다.');
        expect(metadata.robots).toEqual({
            index: false,
            follow: false,
            googleBot: {
                index: false,
                follow: false,
            },
        });
        expect(metadata.openGraph).toBeUndefined();
        expect(metadata.alternates).toBeUndefined();
    });
});

describe('useDocumentTitle source contract', () => {
    test('centralizes real document.title writes with race-safe cleanup', () => {
        const hookSource = source('hooks/use-document-title.ts');

        expect(hookSource).toContain("'use client'");
        expect(hookSource).toContain("import { DEFAULT_TITLE, truncateBrowserTitleLabel } from '@/lib/seo'");
        expect(hookSource).toContain('typeof document === \'undefined\'');
        expect(hookSource).toContain('const previousTitle = document.title');
        expect(hookSource).toContain('lastAppliedTitleRef');
        expect(hookSource).toContain('document.title = nextTitle');
        expect(hookSource).toContain('document.title === lastAppliedTitleRef.current');
        expect(hookSource).toContain('document.title = previousTitle');
    });
});
