import { expect, test } from '@playwright/test';
import { gotoAndHidePopup, hasAdminSession } from './helpers';

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
            id: 'v1',
            title: '샘플 음식점 A',
            category: '한식',
            viewCount: 120,
            likeCount: 30,
            commentCount: 10,
            duration: 720,
            previousViewCount: 100,
            previousLikeCount: 20,
            previousCommentCount: 8,
            previousDuration: 700,
            publishedAt: '2026-01-01T00:00:00.000Z',
        },
        {
            id: 'v2',
            title: '샘플 음식점 B',
            category: '중식',
            viewCount: 86,
            likeCount: 24,
            commentCount: 5,
            duration: 540,
            previousViewCount: 60,
            previousLikeCount: 12,
            previousCommentCount: 4,
            previousDuration: 510,
            publishedAt: '2026-01-02T00:00:00.000Z',
        },
    ],
};

type RequestRecord = {
    viewMode: string;
    metricMode: string;
};

test.describe('인사이트 트리맵 카테고리/증감률 e2e', () => {
    test.skip(!hasAdminSession(), 'INSIGHTS_CHAT_ADMIN_COOKIE 또는 tests/.auth/admin.json의 관리자 쿠키가 필요합니다.');

    test('비율/증감률 토글 변경 시 treemap 조회쿼리가 갱신된다', async ({ page }) => {
        const requestHistory: RequestRecord[] = [];

        await page.route('**/api/insights/treemap*', async (route) => {
            const requestUrl = new URL(route.request().url());
            requestHistory.push({
                viewMode: requestUrl.searchParams.get('viewMode') || 'all',
                metricMode: requestUrl.searchParams.get('metricMode') || 'views',
            });

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(TREEMAP_MOCK),
            });
        });

        await gotoAndHidePopup(page, '/insights');
        await expect(page.getByText('전체 2개')).toBeVisible({ timeout: 15000 });
        expect(requestHistory.length, '초기 조회 요청이 최소 1회 실행되어야 함').toBeGreaterThanOrEqual(1);
        expect(requestHistory[0]?.viewMode).toBe('all');

        await page.getByRole('button', { name: '증감률' }).click();
        await expect(page.getByText('전체 2개')).toBeVisible({ timeout: 15000 });
        expect(requestHistory.some((record) => record.viewMode === 'change'), '증감률 토글 뒤 조회 요청에서 viewMode=change').toBeTruthy();

        await page.getByRole('button', { name: '비율' }).click();
        await expect(page.getByText('전체 2개')).toBeVisible({ timeout: 15000 });
        expect(
            requestHistory.filter((record) => record.viewMode === 'all').length,
            '비율 토글로 다시 돌아올 때 viewMode=all 요청이 재실행되어야 함',
        ).toBeGreaterThanOrEqual(2);
    });
});
