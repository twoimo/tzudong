import { expect, test } from '@playwright/test';
import { gotoAndHidePopup, hasAdminSession } from './helpers';

type InsightTreemapMockResponse = {
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

type RequestRecord = {
    status: number;
    viewMode: string | null;
    metricMode: string | null;
};

const TREEMAP_MOCK: InsightTreemapMockResponse = {
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

test.describe('인사이트 트리맵 재시도 e2e', () => {
    test.skip(!hasAdminSession(), 'INSIGHTS_CHAT_ADMIN_COOKIE 또는 tests/.auth/admin.json의 관리자 쿠키가 필요합니다.');

    test('트리맵 조회 실패 후 다시 시도 버튼이 실제 네트워크 재요청을 수행한다', async ({ page }) => {
        const requestRecords: RequestRecord[] = [];

        await page.route('**/api/insights/treemap*', async (route) => {
            requestRecords.push({
                status: requestRecords.length === 0 ? 500 : 200,
                viewMode: new URL(route.request().url()).searchParams.get('viewMode'),
                metricMode: new URL(route.request().url()).searchParams.get('metricMode'),
            });

            if (requestRecords.length === 1) {
                await route.fulfill({
                    status: 500,
                    contentType: 'application/json',
                    body: JSON.stringify({ error: 'forced-e2e-failure' }),
                });
                return;
            }

            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify(TREEMAP_MOCK),
            });
        });

        await gotoAndHidePopup(page, '/insights');

        const retryButton = page.getByRole('button', { name: '다시 시도' });
        await expect(retryButton, '첫 조회 실패 시 에러 액션이 노출되어야 함').toBeVisible({ timeout: 15000 });

        await retryButton.click();
        await expect(page.getByText('전체 2개')).toBeVisible({ timeout: 15000 });

        expect(requestRecords[0]?.status).toBe(500);
        expect(requestRecords[1]?.status).toBe(200);
        expect(requestRecords).toHaveLength(2);
        expect(requestRecords[0]?.viewMode).toBe('all');
        expect(requestRecords[1]?.viewMode).toBe('all');
        expect(requestRecords[1]?.metricMode).toBe('views');
    });
});
