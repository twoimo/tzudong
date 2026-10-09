# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: public-cms-readonly.spec.ts >> stamp list and search failures stay distinct from empty success at mobile
- Location: tests/public-cms-readonly.spec.ts:108:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('alert').filter({ hasText: '도장 맛집을 불러오지 못했습니다' })
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" getByRole('alert').filter({ hasText: '도장 맛집을 불러오지 못했습니다' }) with timeout 15000ms
  - waiting for getByRole('alert').filter({ hasText: '도장 맛집을 불러오지 못했습니다' })

```

```yaml
- link "본문 바로가기":
  - /url: "#main-content"
- main:
  - heading "쯔동여지도 도장" [level=1]
  - text: (0개)
  - paragraph: 맛집을 찾아 도장을 찍어보세요!
  - button "안 가본 곳만 보기"
  - button "도장 필터 접기": "1"
  - textbox "도장 맛집 검색":
    - /placeholder: 맛집명 검색…
    - text: 합성읽기검증
  - button "지역"
  - button "카테고리"
  - button "리뷰 전체"
  - button "필터 초기화"
  - img "명동 얼큰수제비 썸네일"
  - text: 가이드
  - paragraph: 맛집 카드에 리뷰를 남기면 이렇게 도장이 찍혀요.
  - button "가이드 닫기"
  - img "방문 완료"
  - paragraph: 명동 얼큰수제비
  - text: 분식 리뷰 17
- navigation "주요 탐색":
  - button "홈 페이지로 이동": 홈
  - button "리뷰 페이지로 이동": 리뷰
  - button "도장 페이지로 이동": 도장
  - button "랭킹 페이지로 이동": 랭킹
  - button "MY 페이지로 이동": MY
- region "Notifications (F8)":
  - list
- alert
```

# Test source

```ts
  31  |     await expect(panel.getByText('쯔동여지도', { exact: true })).toBeVisible();
  32  |     const logo = panel.locator('img').first();
  33  |     await expect(logo).toBeVisible();
  34  |     await expect.poll(() => logo.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  35  |     await panel.getByRole('tab', { name: '회원가입', exact: true }).click();
  36  |     await expect(panel.getByRole('tab', { name: '회원가입', exact: true })).toHaveAttribute('aria-selected', 'true');
  37  |     const submit = panel.locator('button[type="submit"]').filter({ hasText: '회원가입' });
  38  |     await submit.scrollIntoViewIfNeeded();
  39  |     const bounds = await submit.boundingBox();
  40  |     expect(bounds).not.toBeNull();
  41  |     expect(bounds!.y).toBeGreaterThanOrEqual(0);
  42  |     expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(size.height + 1);
  43  |     // Policy reads are unavailable in this isolated run: registration stays blocked.
  44  |     await expect(submit).toBeDisabled();
  45  |     expect(await panel.evaluate(element => Array.from(element.querySelectorAll('*')).some(child => {
  46  |       const style = getComputedStyle(child);
  47  |       return style.animationName !== 'none' && style.animationDuration !== '0s';
  48  |     }))).toBe(false);
  49  |     await page.keyboard.press('Escape');
  50  |     await expect(panel).toBeHidden();
  51  |   });
  52  | }
  53  | 
  54  | test('public legal documents scroll and retain their read-only navigation', async ({ page }) => {
  55  |   await page.setViewportSize({ width: 390, height: 844 });
  56  |   await page.goto('/privacy');
  57  |   await expect(page.getByRole('heading', { name: '개인정보 처리방침', exact: true })).toBeVisible();
  58  |   const initial = await page.locator('main').evaluate(element => ({ height: element.scrollHeight, viewport: innerHeight }));
  59  |   expect(initial.height).toBeGreaterThan(initial.viewport);
  60  |   await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  61  |   await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  62  |   await page.evaluate(() => window.scrollTo(0, 0));
  63  |   await page.getByRole('link', { name: '데이터 삭제 요청 안내', exact: true }).click();
  64  |   await expect(page).toHaveURL(/\/data-deletion$/);
  65  |   await expect(page.getByRole('heading', { name: '데이터 삭제 요청 안내', exact: true })).toBeVisible();
  66  | });
  67  | 
  68  | for (const size of sizes.slice(0, 3)) {
  69  |   test(`synthetic public leaderboard period reads and outage recovery at ${size.name}`, async ({ page }, testInfo) => {
  70  |     await page.setViewportSize(size);
  71  |     const readPeriods: string[] = [];
  72  |     let outage = false;
  73  |     await page.route(`**/rest/v1/rpc/${PUBLIC_PROFILE_LEADERBOARD_PAGE_RPC}`, route => {
  74  |       const request = route.request();
  75  |       const args = request.postDataJSON() as { p_period: string };
  76  |       readPeriods.push(args.p_period);
  77  |       if (outage) return route.fulfill({ status: 503, json: { code: 'fixture_unavailable' } });
  78  |       return route.fulfill({ json: [{
  79  |         user_id: '00000000-0000-4000-8000-000000000009',
  80  |         nickname: args.p_period === 'monthly' ? '합성월간랭킹' : '합성전체랭킹',
  81  |         review_count: 2, verified_review_count: 1, total_likes: 2,
  82  |         avg_likes_per_review: 1, quality_score: 2.2,
  83  |       }] });
  84  |     });
  85  |     await page.goto('/leaderboard');
  86  |     await expect(page.getByText('합성전체랭킹', { exact: true })).toBeVisible();
  87  |     await page.getByRole('tab', { name: '월간', exact: true }).click();
  88  |     await expect(page.getByText('합성월간랭킹', { exact: true })).toBeVisible();
  89  |     expect(readPeriods).toContain('all');
  90  |     expect(readPeriods).toContain('monthly');
  91  |     await page.getByRole('tab', { name: '전체', exact: true }).click();
  92  |     await expect(page.getByText('합성전체랭킹', { exact: true })).toBeVisible();
  93  |     outage = true;
  94  |     await page.context().setOffline(true);
  95  |     await page.context().setOffline(false);
  96  |     const retry = page.getByRole('button', { name: '다시 시도', exact: true });
  97  |     await expect(retry).toBeVisible({ timeout: 15_000 });
  98  |     await expect(page.getByRole('alert').filter({ hasText: '랭킹 목록을 갱신하지 못했습니다' })).toContainText('이전에 조회한 결과');
  99  |     await page.screenshot({ path: testInfo.outputPath('leaderboard-refetch-error.png') });
  100 |     outage = false;
  101 |     await retry.click();
  102 |     await expect(retry).toBeHidden();
  103 |     await expect(page.getByText('합성전체랭킹', { exact: true })).toBeVisible();
  104 |   });
  105 | }
  106 | 
  107 | for (const size of sizes.slice(1, 3)) {
  108 |   test(`stamp list and search failures stay distinct from empty success at ${size.name}`, async ({ page }, testInfo) => {
  109 |     await page.setViewportSize(size);
  110 |     let outage = true;
  111 |     let reads = 0;
  112 |     await page.route('**/rest/v1/restaurants?**', route => {
  113 |       reads++;
  114 |       return outage ? route.fulfill({ status: 503, json: { code: 'fixture_unavailable' } }) : route.fulfill({ json: [] });
  115 |     });
  116 |     await page.goto('/stamp');
  117 |     const error = page.getByRole('alert').filter({ hasText: '도장 맛집을 불러오지 못했습니다' });
  118 |     await expect(error).toBeVisible({ timeout: 15_000 });
  119 |     await expect(page.getByText('전체 수 확인 불가', { exact: true })).toBeVisible();
  120 |     await page.screenshot({ path: testInfo.outputPath('stamp-list-read-error.png') });
  121 |     const beforeRetry = reads;
  122 |     outage = false;
  123 |     await error.getByRole('button', { name: '다시 시도', exact: true }).click();
  124 |     await expect(error).toBeHidden();
  125 |     await expect.poll(() => reads).toBeGreaterThan(beforeRetry);
  126 |     await expect(page.getByText('전체 수 확인 불가', { exact: true })).toBeHidden();
  127 |     const search = page.getByPlaceholder('맛집명 검색…');
  128 |     if (!(await search.isVisible())) await page.getByRole('button', { name: '도장 필터 펼치기', exact: true }).click();
  129 |     outage = true;
  130 |     await search.fill('합성읽기검증');
> 131 |     await expect(error).toBeVisible({ timeout: 15_000 });
      |                         ^ Error: expect(locator).toBeVisible() failed
  132 |     await page.screenshot({ path: testInfo.outputPath('stamp-search-read-error.png') });
  133 |     outage = false;
  134 |     await error.getByRole('button', { name: '다시 시도', exact: true }).click();
  135 |     await expect(error).toBeHidden();
  136 |   });
  137 | }
  138 | 
```