import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) => readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

const publicSegments = ['feed', 'stamp', 'leaderboard', 'global-map', 'insights'] as const;
const privateSegments = ['admin', 'auth', 'home-frame', 'mypage', 'submissions', 'user', 's'] as const;

describe('SEO source contracts', () => {
    test('canonical production origin is www.tzudong.app and shared across metadata routes', () => {
        const seoSource = source('lib/seo.ts');
        const rootLayoutSource = source('app/layout.tsx');
        const homePageSource = source('app/page.tsx');

        expect(seoSource).toContain("'https://www.tzudong.app'");
        expect(seoSource).toContain('export const canonicalUrl');
        expect(rootLayoutSource).toContain('metadataBase: new URL(siteUrl)');
        expect(rootLayoutSource).toContain("canonical: '/'");
        expect(homePageSource).toContain("canonical: '/'");
        expect(rootLayoutSource).not.toContain('https://tzudong.vercel.app');
    });

    test('robots and sitemap expose only canonical public routes', () => {
        const robotsSource = source('app/robots.ts');
        const sitemapSource = source('app/sitemap.ts');
        const seoSource = source('lib/seo.ts');

        expect(robotsSource).toContain("allow: '/'");
        expect(existsSync(join(import.meta.dir, '..', 'public/robots.txt'))).toBe(false);
        for (const path of ['/admin', '/api/', '/auth/', '/home-frame', '/mypage/', '/submissions/', '/user/', '/s/']) {
            expect(robotsSource).toContain(path);
        }
        expect(robotsSource).toContain('sitemap: `${SITE_URL}/sitemap.xml`');
        expect(sitemapSource).toContain('PUBLIC_ROUTES.map');
        expect(sitemapSource).toContain('canonicalUrl(path)');
        for (const path of ['/', '/global-map', '/feed', '/stamp', '/leaderboard', '/insights']) {
            expect(seoSource).toContain(`path: '${path}'`);
        }
    });

    test('home page has crawlable metadata and lightweight structured data', () => {
        const homePageSource = source('app/page.tsx');
        const seoSource = source('lib/seo.ts');

        expect(homePageSource).toContain('type="application/ld+json"');
        expect(homePageSource).toContain('JSON.stringify(homeJsonLd)');
        expect(seoSource).toContain("'@type': 'WebSite'");
        expect(seoSource).toContain("'@type': 'WebApplication'");
        expect(seoSource).not.toContain('SearchAction');
    });

    test('public app routes have unique segment metadata at the layout boundary', () => {
        for (const segment of publicSegments) {
            const layoutSource = source(`app/${segment}/layout.tsx`);

            expect(layoutSource).toContain('buildPublicMetadata');
            expect(layoutSource).toContain(`path: '/${segment}'`);
            expect(layoutSource).toContain('keywords:');
            expect(layoutSource).toContain('AppRuntimeLayout');
        }
    });

    test('private and utility routes are noindexed at the segment layout boundary', () => {
        for (const segment of privateSegments) {
            const layoutSource = source(`app/${segment}/layout.tsx`);

            expect(layoutSource).toContain('noIndexMetadata');
            expect(layoutSource).toContain('export const metadata');
        }
    });
});
