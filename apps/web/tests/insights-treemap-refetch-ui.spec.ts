import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The real InsightsClient is rebuilt for this fixture. Only auth and navigation
// are replaced; the query, treemap layout, Radix popover, and UI remain real.
const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HARNESS_ROOT = join(WEB_ROOT, 'tests/fixtures/insights-treemap');
const VIEWS = [490_000, 230_000, 125_000, 87_000, 44_000, 21_000, 12_000, 6_800, 3_300, 1_900, 940, 310];
const NAMES = ['한식 골목', '작은 국수집', '시장 분식', '오래된 빵집', '바닷가 식당', '산동네 카페', '골목 카레', '가족 찻집', '도심 덮밥', '작은 피자집', '계절 밥상', '밤거리 포장마차'];
const VIDEOS = NAMES.map((name, index) => ({
    id: `synthetic-video-${index + 1}`,
    title: `합성 영상 ${String(index + 1).padStart(2, '0')} · ${name}`,
    category: ['한식', '분식', '카페', '중식'][index % 4],
    viewCount: VIEWS[index],
    likeCount: Math.max(1, Math.round(VIEWS[index] / 24)),
    commentCount: Math.max(1, Math.round(VIEWS[index] / 230)),
    duration: 1_250 - index * 90,
    previousViewCount: Math.round(VIEWS[index] * 0.9),
    previousLikeCount: Math.max(1, Math.round(VIEWS[index] / 27)),
    previousCommentCount: Math.max(1, Math.round(VIEWS[index] / 260)),
    previousDuration: 1_200 - index * 85,
    publishedAt: '2026-01-01T00:00:00.000Z',
}));
const BASELINE = { asOf: '2026-01-31T00:00:00.000Z', period: 'ALL', totalVideos: VIDEOS.length, videos: VIDEOS };

let server: Server;
let origin: string;
let temporary: string;

test.beforeAll(async () => {
    temporary = mkdtempSync(join(tmpdir(), 'tzudong-insights-treemap-ui-'));
    const js = join(temporary, 'bundle.js');
    const css = join(temporary, 'bundle.css');
    execFileSync('bun', [join(HARNESS_ROOT, 'build.mjs'), js], { cwd: WEB_ROOT, stdio: 'pipe' });
    execFileSync('bun', [
        join(WEB_ROOT, 'node_modules/@tailwindcss/cli/dist/index.mjs'),
        '-i', join(HARNESS_ROOT, 'input.css'), '-o', css,
    ], { cwd: WEB_ROOT, stdio: 'pipe' });
    const javascript = readFileSync(js);
    const stylesheet = readFileSync(css);
    server = createServer((request, response) => {
        if (request.url === '/bundle.js') {
            response.writeHead(200, { 'Content-Type': 'text/javascript' });
            response.end(javascript);
        } else if (request.url === '/bundle.css') {
            response.writeHead(200, { 'Content-Type': 'text/css' });
            response.end(stylesheet);
        } else if (request.url === '/') {
            response.writeHead(200, { 'Content-Type': 'text/html', 'Referrer-Policy': 'no-referrer' });
            response.end('<!doctype html><html lang="ko"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/bundle.css"></head><body><div id="root"></div><script type="module" src="/bundle.js"></script></body></html>');
        } else {
            response.writeHead(404);
            response.end();
        }
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Insights fixture did not bind a loopback port');
    origin = `http://127.0.0.1:${address.port}`;
});

test.afterAll(async () => {
    if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    if (temporary) rmSync(temporary, { recursive: true, force: true });
});

test('same-filter refetch keeps the selected tile aligned and closes a removed tile permanently', async ({ page }) => {
    let response = BASELINE;
    let requests = 0;
    await page.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== origin || route.request().method() !== 'GET') return route.abort();
        if (url.pathname === '/api/insights/treemap') {
            if (url.searchParams.get('viewMode') !== 'all' || url.searchParams.get('period') !== 'ALL'
                || url.searchParams.get('metricMode') !== 'views' || [...url.searchParams].length !== 3) {
                return route.abort();
            }
            requests += 1;
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(response) });
        }
        return route.continue();
    });

    await page.goto(origin);
    await expect(page.getByText('전체 12개')).toBeVisible();
    const tiles = page.locator('[data-insights-treemap-tile-index]');
    await expect(tiles).toHaveCount(12);
    await tiles.nth(1).click();
    const selected = page.getByRole('dialog', { name: '영상 상세: 합성 영상 02 · 작은 국수집' });
    await expect(selected).toContainText('2 / 12');

    const refetch = async () => {
        const previousRequests = requests;
        await page.evaluate(() => window.insightsFixtureRefetch());
        expect(requests).toBeGreaterThan(previousRequests);
    };
    const outlineDifference = async (index: number) => {
        const [outline, tile] = await Promise.all([
            page.locator('[data-insights-treemap-active-outline="true"]').boundingBox(),
            tiles.nth(index).boundingBox(),
        ]);
        if (!outline || !tile) return Number.POSITIVE_INFINITY;
        return Math.max(
            Math.abs(outline.x - tile.x), Math.abs(outline.y - tile.y),
            Math.abs(outline.width - tile.width), Math.abs(outline.height - tile.height),
        );
    };

    response = { ...BASELINE, videos: VIDEOS.map((video) => video.id === 'synthetic-video-2'
        ? { ...video, viewCount: 900_000 }
        : video) };
    await refetch();
    await expect(selected).toContainText('1 / 12');
    await expect(selected).toContainText('조회수: 900,000개');
    await expect(selected.getByRole('button', { name: '이전' })).toBeDisabled();
    await expect(selected.getByRole('button', { name: '다음' })).toBeEnabled();
    await expect.poll(() => outlineDifference(0)).toBeLessThanOrEqual(2);
    await selected.getByRole('button', { name: '다음' }).click();
    const next = page.getByRole('dialog', { name: '영상 상세: 합성 영상 01 · 한식 골목' });
    await expect(next).toContainText('2 / 12');
    await next.getByRole('button', { name: '이전' }).click();
    await expect(selected).toContainText('1 / 12');

    response = { ...BASELINE, videos: VIDEOS.filter((video) => video.id !== 'synthetic-video-2'), totalVideos: 11 };
    await refetch();
    await expect(selected).toHaveCount(0);
    const navigator = page.getByRole('button', { name: '영상 탐색' });
    await expect(navigator).toHaveAttribute('aria-expanded', 'false');

    response = BASELINE;
    await refetch();
    await expect(tiles).toHaveCount(12);
    await expect(page.getByRole('dialog', { name: /영상 상세:/ })).toHaveCount(0);
    await navigator.focus();
    await navigator.press('Enter');
    await expect(page.getByRole('dialog', { name: '영상 상세: 합성 영상 01 · 한식 골목' })).toBeVisible();

    response = { ...BASELINE, videos: [], totalVideos: 0 };
    await refetch();
    await expect(page.getByText('전체 0개')).toBeVisible();
    await expect(page.getByRole('dialog', { name: /영상 상세:/ })).toHaveCount(0);
    await expect(navigator).toBeDisabled();
    await expect(page.getByRole('button', { name: '트리맵 읽는 법' })).toBeFocused();
    expect((await page.pageErrors()).map((error) => error.message)).toEqual([]);
});
