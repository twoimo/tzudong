import { expect, test } from '@playwright/test';
import { hidePopupOverlay } from './helpers';
import { installDeviceLocationMocks, openDeviceLocationPage, readDeviceLocationCounts, type DeviceLocationTestWindow } from './device-location-helpers';

test.describe('G010 privacy safeguards', () => {
  test('publishes truthful policy and deletion guidance without completion claims', async ({ page }) => {
    await page.goto('/privacy');
    await expect(page.getByRole('heading', { name: '개인정보 처리방침', level: 1 })).toBeVisible();
    await expect(page.getByText(/만 14세 미만 가입은 운영자 승인 보호자 확인 경로가 배포되고 읽기검증될 때까지/)).toBeVisible();
    await expect(page.getByText(/생년월일\(DOB\)이나 주민등록번호\(RRN\)를 수집 항목으로 두지 않습니다/)).toBeVisible();

    await page.goto('/data-deletion');
    await expect(page.getByRole('heading', { name: '데이터 삭제 요청 안내', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: '앱\/웹에서 계정 완전 삭제를 요청하는 방법' })).toBeVisible();
    await expect(page.getByText(/applied 영수증이 없는 보류·partial·failed 결과는 삭제 완료가 아닙니다/)).toBeVisible();
  });

  test('shows age and separate consent choices before signup', async ({ page }) => {
    await page.goto('/');
    await hidePopupOverlay(page);
    await page.getByRole('button', { name: /로그인/i }).first().click();
    await page.getByRole('tab', { name: '회원가입' }).click();

    await expect(page.getByText('생년월일이나 주민등록번호를 받지 않습니다')).toBeVisible();
    await expect(page.getByRole('radio', { name: '만 14세 이상입니다' })).toBeVisible();
    await expect(page.getByRole('radio', { name: '만 14세 미만입니다' })).toBeVisible();
    await expect(page.getByText('마케팅 수신 동의 (선택)')).toBeVisible();
    await expect(page.getByText(/일반 수신과 야간 수신은 각각 선택/)).toBeVisible();

    await page.getByRole('radio', { name: '만 14세 미만입니다' }).check();
    await expect(page.getByText(/만 14세 미만 가입은 운영자 승인 보호자 확인 경로가 배포되고 읽기검증될 때까지/)).toBeVisible();
  });

  test.describe('device location controls', () => {
    test('shows inline disclosure and locates with one click and no app dialog', async ({ page }) => {
      const fixture = await installDeviceLocationMocks(page);
      await openDeviceLocationPage(page);
      const button = page.getByRole('button', { name: '현재 위치 보기', exact: true });
      const disclosure = page.locator('#' + await button.getAttribute('aria-describedby'));
      await expect(disclosure).toBeVisible();
      await expect(disclosure).toContainText('지도 제공자');
      await expect(disclosure).toContainText('저장하지 않아요');
      expect(await readDeviceLocationCounts(page)).toEqual({ getCalls: 0, watchCalls: 0, clearCalls: 0 });
      let dialogs = 0;
      page.on('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
      await button.click();
      await expect(page.getByRole('button', { name: '현재 위치 기준 방향 확인', exact: true })).toBeEnabled();
      await expect(page.getByText('12m', { exact: true })).toBeVisible();
      expect(dialogs).toBe(0);
      expect(fixture.readinessCalls()).toBe(1);
      expect((await readDeviceLocationCounts(page)).getCalls).toBe(1);
    });

    test('denies readiness without calling permission APIs', async ({ page }) => {
      await installDeviceLocationMocks(page);
      let readinessCalls = 0;
      await page.route('**/api/privacy/location-readiness', route => {
        readinessCalls++;
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'unavailable', reasonCode: 'DEVICE_LOCATION_OPERATOR_EVIDENCE_REQUIRED' }) });
      });
      await openDeviceLocationPage(page);
      await page.getByRole('button', { name: '현재 위치 보기', exact: true }).click();
      await expect(page.getByText('현재 위치를 지금 표시하지 못했어요. 잠시 후 다시 시도해 주세요.', { exact: true })).toBeVisible();
      expect(readinessCalls).toBe(1);
      expect((await readDeviceLocationCounts(page)).getCalls).toBe(0);
      await expect(page.getByRole('button', { name: '현재 위치 보기', exact: true })).toBeEnabled();
    });

    test('locks duplicate clicks during readiness and ignores a cancelled readiness response', async ({ page }) => {
      await installDeviceLocationMocks(page);
      let release!: () => void;
      const held = new Promise<void>(resolve => { release = resolve; });
      let readinessCalls = 0;
      await page.route('**/api/privacy/location-readiness', async route => {
        readinessCalls++;
        if (readinessCalls === 1) await held;
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ status: 'available', reasonCode: 'DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED' }) });
      });
      await openDeviceLocationPage(page);
      await page.getByRole('button', { name: '현재 위치 보기', exact: true }).evaluate(button => {
        (button as HTMLButtonElement).click();
        (button as HTMLButtonElement).click();
        (button as HTMLButtonElement).click();
      });
      await expect(page.getByRole('button', { name: '현재 위치 확인 중', exact: true })).toBeDisabled();
      await expect.poll(() => readinessCalls).toBe(1);
      await page.getByRole('button', { name: '해외 맛집 지도 보기', exact: true }).click();
      release();
      await page.getByRole('button', { name: '국내 맛집 지도 보기', exact: true }).click();
      await expect(page.getByRole('button', { name: '현재 위치 보기', exact: true })).toBeEnabled();
      expect((await readDeviceLocationCounts(page)).getCalls).toBe(0);
      await page.getByRole('button', { name: '현재 위치 보기', exact: true }).click();
      await expect(page.getByRole('button', { name: '현재 위치 기준 방향 확인', exact: true })).toBeEnabled();
      expect(readinessCalls).toBe(2);
      expect((await readDeviceLocationCounts(page)).getCalls).toBe(1);
    });

    test('late error after visibility cancellation cannot cancel a newer request', async ({ page }) => {
      await installDeviceLocationMocks(page, 'hold');
      await openDeviceLocationPage(page);
      await page.getByRole('button', { name: '현재 위치 보기', exact: true }).click();
      await expect.poll(async () => (await readDeviceLocationCounts(page)).getCalls).toBe(1);
      await page.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
      });
      await page.getByRole('button', { name: '현재 위치 보기', exact: true }).click();
      await expect.poll(async () => (await readDeviceLocationCounts(page)).getCalls).toBe(2);
      await page.evaluate(() => (window as unknown as DeviceLocationTestWindow).__deviceLocationProbe.reject(0, 1));
      await expect(page.getByRole('button', { name: '현재 위치 확인 중', exact: true })).toBeDisabled();
      await page.evaluate(() => (window as unknown as DeviceLocationTestWindow).__deviceLocationProbe.resolve(1));
      await expect(page.getByRole('button', { name: '현재 위치 기준 방향 확인', exact: true })).toBeEnabled();
      await expect(page.getByText('12m', { exact: true })).toBeVisible();
    });

    for (const outcome of ['denied', 'timeout'] as const) test(`${outcome} permits an explicit retry without another app dialog`, async ({ page }) => {
      await installDeviceLocationMocks(page, outcome);
      await openDeviceLocationPage(page);
      let dialogs = 0;
      page.on('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
      await page.getByRole('button', { name: '현재 위치 보기', exact: true }).click();
      await expect(page.getByText(outcome === 'denied' ? '위치 권한이 거부됐어요. 브라우저 설정에서 허용하면 현재 위치를 표시할 수 있어요.' : '현재 위치를 찾는 시간이 초과됐어요. 잠시 후 다시 시도해 주세요.', { exact: true })).toBeVisible();
      await page.getByRole('button', { name: '현재 위치 보기', exact: true }).click();
      await expect(page.getByRole('button', { name: '현재 위치 기준 방향 확인', exact: true })).toBeEnabled();
      expect((await readDeviceLocationCounts(page)).getCalls).toBe(2);
      expect(dialogs).toBe(0);
    });

    test('heading toggles off and clears its watcher without another app confirmation', async ({ page }) => {
      await installDeviceLocationMocks(page);
      await openDeviceLocationPage(page);
      let dialogs = 0;
      page.on('dialog', async dialog => { dialogs++; await dialog.dismiss(); });
      await page.getByRole('button', { name: '현재 위치 보기', exact: true }).click();
      await page.getByRole('button', { name: '현재 위치 기준 방향 확인', exact: true }).click();
      await expect(page.getByRole('button', { name: '현재 위치와 방향 다시 확인', exact: true })).toBeEnabled();
      expect((await readDeviceLocationCounts(page)).watchCalls).toBe(1);
      await page.getByRole('button', { name: '현재 위치와 방향 다시 확인', exact: true }).click();
      await expect(page.getByRole('button', { name: '현재 위치 보기', exact: true })).toBeEnabled();
      expect((await readDeviceLocationCounts(page)).clearCalls).toBe(1);
      expect(dialogs).toBe(0);
      await expect(page.getByText('12m', { exact: true })).toHaveCount(0);
    });
  });
});
