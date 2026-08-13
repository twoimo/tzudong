import { expect, test, type Page } from '@playwright/test';

const SUPABASE_PROJECT_REF = 'aqlcofblfxdrjhhdmarw';
const SUPABASE_AUTH_COOKIE_NAME = `sb-${SUPABASE_PROJECT_REF}-auth-token`;

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

async function installFakeInsightsSession(page: Page) {
    const fakeUser = {
        id: '00000000-0000-4000-8000-000000000002',
        aud: 'authenticated',
        role: 'authenticated',
        email: 'g002@example.test',
        app_metadata: { provider: 'email', providers: ['email'] },
        user_metadata: { nickname: 'G002' },
    };
    const fakeSession = {
        access_token: 'g002-fake-access-token',
        refresh_token: 'g002-fake-refresh-token',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 60 * 60,
        user: fakeUser,
    };
    const encodedSession = Buffer.from(JSON.stringify(fakeSession), 'utf8')
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');

    await page.context().addCookies([{
        name: SUPABASE_AUTH_COOKIE_NAME,
        value: `base64-${encodedSession}`,
        domain: 'localhost',
        path: '/',
        expires: Math.floor(Date.now() / 1000) + 60 * 60,
        httpOnly: false,
        secure: false,
        sameSite: 'Lax',
    }]);

    await page.route('**/auth/v1/user', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify(fakeUser),
        });
    });
    await page.route('**/rest/v1/**', async (route) => {
        const url = new URL(route.request().url());
        if (url.pathname.endsWith('/rest/v1/user_roles')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({ role: 'user' }),
            });
            return;
        }
        if (url.pathname.endsWith('/rest/v1/profiles')) {
            await route.abort('blockedbyclient');
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify([]),
        });
    });
}

test.describe('G002 popup and insights hardening', () => {
    test('direct /mypage load does not mount popup overlays', async ({ page }) => {
        await page.goto('/mypage/profile', { waitUntil: 'domcontentloaded' });

        await expect(page.getByText(/마이페이지는 로그인한 뒤 사용할 수 있습니다|쯔동여지도 마이페이지/).first()).toBeVisible({ timeout: 15000 });
        await expect(page.locator('[data-popup-overlay="true"]')).toHaveCount(0);
        await page.waitForTimeout(1200);
        await expect(page.locator('[data-popup-overlay="true"]')).toHaveCount(0);
        await page.screenshot({ path: 'test-results/g002-mypage-no-popup.png', fullPage: true });
    });

    test('direct /insights load shows treemap context without popup helpers', async ({ page }) => {
        await installFakeInsightsSession(page);
        await page.route('**/api/insights/treemap*', async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(TREEMAP_MOCK),
            });
        });

        await page.goto('/insights', { waitUntil: 'domcontentloaded' });

        await expect(page.getByText('전체 2개')).toBeVisible({ timeout: 15000 });
        await expect(page.getByText(/트리맵 기준: 조회수 · 전체 기간 · 2개 영상 · 비율 · 개별 영상/)).toBeVisible();
        await expect(page.getByText(/색상 범례: 전체 조회수 비중이 높을수록 밝은 초록색입니다\./)).toBeVisible();
        await expect(page.getByText(/작은 칸 안내: 공간이 좁으면 지표나 …만 표시되고/)).toBeVisible();
        await expect(page.locator('[data-popup-overlay="true"]')).toHaveCount(0);
        await page.waitForTimeout(1200);
        await expect(page.locator('[data-popup-overlay="true"]')).toHaveCount(0);
        await page.screenshot({ path: 'test-results/g002-insights-context.png', fullPage: true });
    });
});
