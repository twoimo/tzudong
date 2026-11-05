import { expect, test, type Page } from '@playwright/test';
import { createServerClient } from '@supabase/ssr';
import { assertLocalWebOrigin, loadLocalSupabaseEnvironment } from '../scripts/local-supabase-runtime.mjs';

function admittedLocalRuntime() {
    const local = loadLocalSupabaseEnvironment();
    const appUrl = new URL(process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000');
    if (appUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(appUrl.hostname)
        || appUrl.pathname !== '/' || appUrl.search || appUrl.hash || appUrl.username || appUrl.password
        || !local.values.ADDITIONAL_REDIRECT_URLS.split(',').includes(appUrl.origin)) {
        throw new Error('g002_local_app_origin_invalid');
    }
    assertLocalWebOrigin(local, Number(appUrl.port));
    if ((process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_URL !== local.supabaseOrigin)
        || (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY !== local.values.ANON_KEY)
        || process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === '1'
        || (process.env.PLAYWRIGHT_WEB_SERVER_COMMAND && process.env.PLAYWRIGHT_WEB_SERVER_COMMAND !== 'bun run dev:playwright')) {
        throw new Error('g002_local_runtime_mismatch');
    }
    return { local, appUrl };
}

type InsightTreemapResponse = {
    asOf: string;
    period: string;
    totalVideos: number;
    videos: Array<{
        id: string;
        title: string;
        category: string;
        viewCount: number;
        likeCount: number;
        commentCount: number;
        duration: number;
        previousViewCount: number;
        previousLikeCount: number;
        previousCommentCount: number;
        previousDuration: number;
        publishedAt: string;
    }>;
};

const TREEMAP_MOCK: InsightTreemapResponse = {
    asOf: '2026-02-27T00:00:00.000Z',
    period: 'ALL',
    totalVideos: 2,
    videos: [
        {
            id: 'g002-v1',
            title: 'G002 샘플 한식',
            category: '한식',
            viewCount: 120_000,
            likeCount: 3_000,
            commentCount: 250,
            duration: 720,
            previousViewCount: 100_000,
            previousLikeCount: 2_400,
            previousCommentCount: 200,
            previousDuration: 700,
            publishedAt: '2026-01-01T00:00:00.000Z',
        },
        {
            id: 'g002-v2',
            title: 'G002 샘플 중식',
            category: '중식',
            viewCount: 86_000,
            likeCount: 2_400,
            commentCount: 120,
            duration: 540,
            previousViewCount: 60_000,
            previousLikeCount: 1_200,
            previousCommentCount: 80,
            previousDuration: 510,
            publishedAt: '2026-01-02T00:00:00.000Z',
        },
    ],
};

async function installLocalInsightsSession(page: Page) {
    const { local, appUrl } = admittedLocalRuntime();
    const cookieJar = new Map<string, string>();
    const supabase = createServerClient(local.supabaseOrigin, local.values.ANON_KEY, {
        cookies: {
            getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
            setAll: (cookies) => {
                for (const { name, value } of cookies) {
                    if (value) cookieJar.set(name, value);
                    else cookieJar.delete(name);
                }
            },
        },
    });
    let signedIn = false;
    try {
        const { data, error } = await supabase.auth.signInWithPassword({
            email: local.values.NIGHTLY_ADMIN_EMAIL,
            password: local.values.NIGHTLY_ADMIN_PASSWORD,
        });
        signedIn = !error && Boolean(data.session?.user?.id);
    } catch {
        // Provider details and generated local credentials must not reach test output.
    }
    if (!signedIn) throw new Error('g002_local_auth_failed');

    const key = `sb-${new URL(local.supabaseOrigin).hostname.split('.')[0]}-auth-token`;
    const cookies = [...cookieJar]
        .filter(([name, value]) => value && (name === key || (name.startsWith(`${key}.`) && /^\d+$/.test(name.slice(key.length + 1)))))
        .map(([name, value]) => ({
            name, value, domain: appUrl.hostname, path: '/',
            httpOnly: false, secure: false, sameSite: 'Lax' as const,
        }));
    if (cookies.length === 0) throw new Error('g002_local_auth_cookie_missing');
    await page.context().addCookies(cookies);
}

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
    const { local, appUrl } = admittedLocalRuntime();
    const allowedOrigins = new Set([appUrl.origin, local.supabaseOrigin]);
    const allowedBrowserUrl = (rawUrl: string) => {
        try {
            const url = new URL(rawUrl);
            if (url.protocol === 'ws:') url.protocol = 'http:';
            if (url.protocol === 'wss:') url.protocol = 'https:';
            return allowedOrigins.has(url.origin);
        } catch {
            return false;
        }
    };
    await page.context().route('**/*', (route) => {
        const request = route.request();
        if (!allowedBrowserUrl(request.url())
            || (new URL(request.url()).origin === appUrl.origin && !['GET', 'HEAD'].includes(request.method()))) {
            return route.abort('blockedbyclient');
        }
        return route.continue();
    });
    await page.context().routeWebSocket('**/*', (route) => {
        if (!allowedBrowserUrl(route.url())) return route.close();
        route.connectToServer();
    });
});

test.describe('G002 popup and insights hardening', () => {
    test('direct /mypage load does not mount popup overlays', async ({ page }) => {
        await page.goto('/mypage/profile', { waitUntil: 'domcontentloaded' });

        await expect(page.getByText(/마이페이지는 로그인한 뒤 사용할 수 있습니다|쯔동여지도 마이페이지/).first()).toBeVisible({ timeout: 15000 });
        await expect(page.locator('[data-popup-overlay="true"]')).toHaveCount(0);
        await page.waitForTimeout(1200);
        await expect(page.locator('[data-popup-overlay="true"]')).toHaveCount(0);
        await page.screenshot({ path: 'test-results/g002-mypage-no-popup.png', fullPage: true });
    });

    test('direct /insights load keeps treemap guidance keyboard accessible without popup helpers', async ({ page }) => {
        await installLocalInsightsSession(page);
        let releaseTreemap!: () => void;
        const responseGate = new Promise<void>((resolve) => { releaseTreemap = resolve; });
        let treemapRequests = 0;
        await page.route('**/api/insights/treemap*', async (route) => {
            treemapRequests += 1;
            await responseGate;
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(TREEMAP_MOCK),
            });
        });

        await page.goto('/insights', { waitUntil: 'domcontentloaded' });

        const chart = page.getByRole('img', { name: /트리맵 기준: 조회수 · 전체 기간 · 2개 영상 · 비율 · 개별 영상/ });
        try {
            await expect.poll(() => treemapRequests).toBeGreaterThan(0);
            await expect(chart).toHaveCount(0);
        } finally {
            releaseTreemap();
        }
        await expect(page.getByText('전체 2개')).toBeVisible({ timeout: 15000 });
        await expect(chart).toHaveAttribute('aria-describedby', 'insights-treemap-legend insights-treemap-small-cell-guidance');
        for (const width of [360, 1280]) {
            await page.setViewportSize({ width, height: 800 });
            await expect.poll(() => chart.evaluate((element) => {
                const area = element.closest('[data-slot="card-content"]');
                const card = element.closest('[data-slot="card"]');
                if (!area || !card) return Number.POSITIVE_INFINITY;
                const chartRect = element.getBoundingClientRect();
                return Math.max(
                    Math.abs(chartRect.height - area.getBoundingClientRect().height),
                    Math.abs(card.getBoundingClientRect().bottom - chartRect.bottom),
                );
            }), { timeout: 10000 }).toBeLessThanOrEqual(2);
        }
        await expect(page.locator('[data-insights-treemap-context="true"]')).toHaveCount(0);
        const helpButton = page.getByRole('button', { name: '트리맵 읽는 법' });
        await helpButton.focus();
        await helpButton.press('Enter');
        const helpDialog = page.getByRole('dialog', { name: '트리맵 읽는 법' });
        await expect(helpDialog).toBeVisible();
        await expect(helpButton).toHaveAttribute('aria-expanded', 'true');
        const helpDialogId = await helpDialog.getAttribute('id');
        expect(helpDialogId).toBeTruthy();
        await expect(helpButton).toHaveAttribute('aria-controls', helpDialogId!);
        await expect(helpButton).toBeFocused();
        await expect(helpDialog).toContainText('전체 조회수 비중');
        await helpButton.press('Escape');
        await page.getByRole('button', { name: '증감률' }).click();
        await page.getByRole('button', { name: '좋아요' }).click();
        await helpButton.click();
        await expect(page.getByRole('dialog', { name: '트리맵 읽는 법' })).toContainText('좋아요 증감률');
        await expect(page.locator('[data-popup-overlay="true"]')).toHaveCount(0);
        await page.waitForTimeout(1200);
        await expect(page.locator('[data-popup-overlay="true"]')).toHaveCount(0);
        await page.screenshot({ path: 'test-results/g002-insights-context.png', fullPage: true });
    });
});

test.describe('insights treemap tile detail access', () => {
    test.use({ hasTouch: true });

    test('mouse, keyboard and touch reach the same tile details without a tab stop per tile', async ({ page }) => {
        await installLocalInsightsSession(page);
        await page.route('**/api/insights/treemap*', async (route) => {
            await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(TREEMAP_MOCK) });
        });
        await page.goto('/insights', { waitUntil: 'domcontentloaded' });
        await expect(page.getByText('전체 2개')).toBeVisible({ timeout: 15000 });

        const tiles = page.locator('[data-insights-treemap-tile-index]');
        await expect(tiles).toHaveCount(2);
        await expect(page.locator('[data-insights-treemap-tile-index][tabindex="0"]')).toHaveCount(0);

        await tiles.nth(1).hover();
        await expect(page.getByText('G002 샘플 중식')).toBeVisible();
        await page.mouse.move(0, 0);

        const navigator = page.getByRole('button', { name: '영상 탐색' });
        await navigator.focus();
        await navigator.press('ArrowRight');
        await expect(page.getByRole('status').filter({ hasText: '2 / 2: G002 샘플 중식' })).toContainText('2 / 2: G002 샘플 중식');
        await navigator.press('Enter');
        const keyboardDetail = page.getByRole('dialog', { name: '영상 상세: G002 샘플 중식' });
        await expect(keyboardDetail).toContainText('카테고리: 중식');
        await expect(keyboardDetail).toContainText('조회수: 86,000개');
        await expect(keyboardDetail).toBeFocused();
        await page.keyboard.press('Escape');
        await expect(navigator).toBeFocused();

        await tiles.nth(0).tap();
        const touchDetail = page.getByRole('dialog', { name: '영상 상세: G002 샘플 한식' });
        await expect(touchDetail).toContainText('카테고리: 한식');
        await expect(touchDetail).toContainText('조회수: 120,000개');
        await expect(touchDetail).toBeFocused();
        await touchDetail.getByRole('button', { name: '다음' }).tap();
        const nextDetail = page.getByRole('dialog', { name: '영상 상세: G002 샘플 중식' });
        await expect(nextDetail).toContainText('조회수: 86,000개');
        await nextDetail.getByRole('button', { name: '닫기' }).tap();
        await expect(navigator).toBeFocused();
    });

});
