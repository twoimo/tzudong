import { expect, test } from '@playwright/test';
import { PUBLIC_PROFILE_LEADERBOARD_PAGE_RPC } from '../lib/public-profile-read';

const sizes = [
  { name: 'desktop', width: 1440, height: 1000 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'short-mobile', width: 390, height: 600 },
] as const;

test.beforeEach(async ({ context }, testInfo) => {
  const origin = new URL(testInfo.project.use.baseURL as string).origin;
  await context.routeWebSocket('**/*', route => {
    if (new URL(route.url()).host === new URL(origin).host) route.connectToServer();
    else route.close();
  });
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === origin && !url.pathname.startsWith('/api/') && ['GET', 'HEAD'].includes(request.method())) return route.continue();
    return route.fulfill({ status: 503, json: { code: 'local_read_only_check' } });
  });
});

for (const size of sizes) {
  test(`auth branding, signup scroll and Escape at ${size.name}`, async ({ page }) => {
    await page.setViewportSize(size);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/?auth=login&reason=mypage&next=%2Fmypage%2Fbookmarks');
    const panel = size.name === 'desktop' ? page.getByRole('dialog') : page.locator('[data-bottom-sheet-layout-source="auth-modal"]');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('쯔동여지도', { exact: true })).toBeVisible();
    const logo = panel.locator('img').first();
    await expect(logo).toBeVisible();
    await expect.poll(() => logo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await panel.getByRole('tab', { name: '회원가입', exact: true }).click();
    await expect(panel.getByRole('tab', { name: '회원가입', exact: true })).toHaveAttribute('aria-selected', 'true');
    const submit = panel.locator('button[type="submit"]').filter({ hasText: '회원가입' });
    await submit.scrollIntoViewIfNeeded();
    const bounds = await submit.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height + 1);
    // Policy reads are unavailable in this isolated run: registration stays blocked.
    await expect(submit).toBeDisabled();
    expect(await panel.evaluate(element => Array.from(element.querySelectorAll('*')).some(child => {
      const style = getComputedStyle(child);
      return style.animationName !== 'none' && style.animationDuration !== '0s';
    }))).toBe(false);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
  });
}

test('public legal documents scroll and retain their read-only navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { name: '개인정보 처리방침', exact: true })).toBeVisible();
  const initial = await page.locator('main').evaluate(element => ({ height: element.scrollHeight, viewport: innerHeight }));
  expect(initial.height).toBeGreaterThan(initial.viewport);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('link', { name: '데이터 삭제 요청 안내', exact: true }).click();
  await expect(page).toHaveURL(/\/data-deletion$/);
  await expect(page.getByRole('heading', { name: '데이터 삭제 요청 안내', exact: true })).toBeVisible();
});

for (const size of sizes.slice(0, 3)) {
  test(`synthetic public leaderboard period reads and outage recovery at ${size.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(size);
    const readPeriods: string[] = [];
    let outage = false;
    await page.route(`**/rest/v1/rpc/${PUBLIC_PROFILE_LEADERBOARD_PAGE_RPC}`, route => {
      const request = route.request();
      const args = request.postDataJSON() as { p_period: string };
      readPeriods.push(args.p_period);
      if (outage) return route.fulfill({ status: 503, json: { code: 'fixture_unavailable' } });
      return route.fulfill({ json: [{
        user_id: '00000000-0000-4000-8000-000000000009',
        nickname: args.p_period === 'monthly' ? '합성월간랭킹' : '합성전체랭킹',
        review_count: 2, verified_review_count: 1, total_likes: 2,
        avg_likes_per_review: 1, quality_score: 2.2,
      }] });
    });
    await page.goto('/leaderboard');
    await expect(page.getByText('합성전체랭킹', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: '월간', exact: true }).click();
    await expect(page.getByText('합성월간랭킹', { exact: true })).toBeVisible();
    expect(readPeriods).toContain('all');
    expect(readPeriods).toContain('monthly');
    await page.getByRole('tab', { name: '전체', exact: true }).click();
    await expect(page.getByText('합성전체랭킹', { exact: true })).toBeVisible();
    outage = true;
    await page.context().setOffline(true);
    await page.context().setOffline(false);
    const retry = page.getByRole('button', { name: '다시 시도', exact: true });
    await expect(retry).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('alert').filter({ hasText: '랭킹 목록을 갱신하지 못했습니다' })).toContainText('이전에 조회한 결과');
    await page.screenshot({ path: testInfo.outputPath('leaderboard-refetch-error.png') });
    outage = false;
    await retry.click();
    await expect(retry).toBeHidden();
    await expect(page.getByText('합성전체랭킹', { exact: true })).toBeVisible();
  });
}

for (const size of sizes.slice(1, 3)) {
  test(`stamp list and search failures stay distinct from empty success at ${size.name}`, async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize(size);
    let outage = true;
    let reads = 0;
    const readStates: Array<{ search: boolean; outage: boolean }> = [];
    await page.route('**/rest/v1/restaurants?**', route => {
      reads++;
      readStates.push({ search: new URL(route.request().url()).searchParams.has('approved_name'), outage });
      return outage ? route.fulfill({ status: 503, json: { code: 'fixture_unavailable' } }) : route.fulfill({ json: [] });
    });
    await page.goto('/stamp');
    const error = page.getByRole('alert').filter({ hasText: '도장 맛집을 불러오지 못했습니다' });
    await expect(error).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('전체 수 확인 불가', { exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('stamp-list-read-error.png') });
    const beforeRetry = reads;
    outage = false;
    await error.getByRole('button', { name: '다시 시도', exact: true }).click();
    await expect(error).toBeHidden();
    await expect.poll(() => reads).toBeGreaterThan(beforeRetry);
    await expect(page.getByText('전체 수 확인 불가', { exact: true })).toBeHidden();
    const search = page.getByPlaceholder('맛집명 검색…');
    if (!(await search.isVisible())) await page.getByRole('button', { name: '도장 필터 펼치기', exact: true }).click();
    outage = true;
    await search.fill('합성읽기검증');
    await expect.poll(() => readStates.some(read => read.search && read.outage), { timeout: 15_000 }).toBe(true);
    // The installed SDK retries 503 reads before Query's own retries finish.
    await expect(error).toBeVisible({ timeout: 45_000 });
    await testInfo.attach('sanitized-read-states', { body: JSON.stringify(readStates), contentType: 'application/json' });
    await page.screenshot({ path: testInfo.outputPath('stamp-search-read-error.png') });
    outage = false;
    await error.getByRole('button', { name: '다시 시도', exact: true }).click();
    await expect(error).toBeHidden();
  });
}
