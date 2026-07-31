import { expect, test } from '@playwright/test';
import { hidePopupOverlay } from './helpers';
import { readFileSync } from 'node:fs';

const hasLocationReadinessGate = readFileSync(
  new URL('../app/home-client.tsx', import.meta.url),
  'utf8',
).includes('/api/privacy/location-readiness');

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

  test('discloses memory-only device location before requesting permission', async ({ page }) => {
    await page.goto('/');
    await hidePopupOverlay(page);

    let readinessCallCount = 0;
    await page.route('/api/privacy/location-readiness', async (route) => {
      readinessCallCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'available',
          reasonCode: 'DEVICE_LOCATION_OPERATOR_EVIDENCE_VERIFIED',
        }),
      });
    });
    await page.addInitScript(() => {
      const geo = navigator.geolocation;
      if (!geo) return;

      (window as any).__tzudongGeoCalls = {
        getCurrentPosition: 0,
        watchPosition: 0,
      };
      Object.defineProperty(geo, 'getCurrentPosition', {
        configurable: true,
        writable: true,
        value: (success: (position: GeolocationPosition) => void) => {
          (window as any).__tzudongGeoCalls.getCurrentPosition += 1;
          success({
            coords: {
              latitude: 37.5665,
              longitude: 126.978,
              accuracy: 10,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
            },
            timestamp: Date.now(),
          } as GeolocationPosition);
        },
      });
      Object.defineProperty(geo, 'watchPosition', {
        configurable: true,
        writable: true,
        value: () => {
          (window as any).__tzudongGeoCalls.watchPosition += 1;
          return 1;
        },
      });
    });
    await page.reload();
    await hidePopupOverlay(page);

    let disclosureMessage = '';
    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('confirm');
      disclosureMessage = dialog.message();
      await dialog.accept();
    });
    await page.getByRole('button', { name: '현재 위치 보기' }).first().click();
    expect(disclosureMessage).toContain('현재 React 메모리에만 보관');
    expect(disclosureMessage).toContain('Tzudong에 저장되지 않습니다');
    expect(disclosureMessage).toContain('승인된 지도 제공자 경계');
    if (hasLocationReadinessGate) {
      expect(readinessCallCount).toBe(1);
      expect(await page.evaluate(() => (window as any).__tzudongGeoCalls?.getCurrentPosition ?? 0)).toBeGreaterThan(0);
    } else {
      expect(readinessCallCount).toBe(0);
    }
  });

  test('denies readiness without calling permission APIs', async ({ page }) => {
    if (!hasLocationReadinessGate) {
      test.skip(true, 'Location readiness gate is not yet present in home-client source.');
    }

    await page.goto('/');
    await hidePopupOverlay(page);

    let readinessCallCount = 0;
    await page.route('/api/privacy/location-readiness', async (route) => {
      readinessCallCount += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'unavailable',
          reasonCode: 'DEVICE_LOCATION_OPERATOR_EVIDENCE_REQUIRED',
        }),
      });
    });
    await page.addInitScript(() => {
      const geo = navigator.geolocation;
      if (!geo) return;

      (window as any).__tzudongGeoCalls = {
        getCurrentPosition: 0,
        watchPosition: 0,
      };
      Object.defineProperty(geo, 'getCurrentPosition', {
        configurable: true,
        writable: true,
        value: () => {
          (window as any).__tzudongGeoCalls.getCurrentPosition += 1;
          return undefined;
        },
      });
      Object.defineProperty(geo, 'watchPosition', {
        configurable: true,
        writable: true,
        value: () => {
          (window as any).__tzudongGeoCalls.watchPosition += 1;
          return 1;
        },
      });
    });

    await page.getByRole('button', { name: '현재 위치 보기' }).first().click();
    expect(readinessCallCount).toBe(1);
    expect(await page.evaluate(() => (window as any).__tzudongGeoCalls?.getCurrentPosition ?? 0)).toBe(0);
    expect(await page.evaluate(() => (window as any).__tzudongGeoCalls?.watchPosition ?? 0)).toBe(0);
  });
});
