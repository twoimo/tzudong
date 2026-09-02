import { expect, test, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';

import {
  E2E_ADMIN_ROUTE_BYPASS_HEADER,
  E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER,
} from '../lib/e2e-admin-route-bypass';
import {
  E2E_CLAIM_USER_ID_HEADER,
  RESTAURANT_CLAIM_CONFIRMATION_TEXT,
  RESTAURANT_CLAIM_GUARD_STEPS,
} from '../lib/claim/contract';
import { gotoAndHidePopup } from './helpers';

const CLAIM_USER_ID = '00000000-0000-4000-8000-00000000c1a0';
const LICENSE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64',
);

function getE2EAdminRouteBypassToken(testInfo: TestInfo) {
  const token = testInfo.config.metadata.e2eAdminRouteBypassToken;
  if (typeof token !== 'string' || !token.trim()) {
    throw new Error('playwright.config.ts must provide metadata.e2eAdminRouteBypassToken for this test.');
  }
  return token;
}

test.describe.configure({ mode: 'serial' });

test('canonical 5-step public restaurant claim flow', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  const restaurantId = randomUUID();

  await page.setExtraHTTPHeaders({
    [E2E_ADMIN_ROUTE_BYPASS_HEADER]: '1',
    [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: getE2EAdminRouteBypassToken(testInfo),
    [E2E_CLAIM_USER_ID_HEADER]: CLAIM_USER_ID,
  });

  await gotoAndHidePopup(page, `/r/${restaurantId}`);
  const publicClaim = page.locator('[data-claim-page="public"]');
  await expect(publicClaim).toHaveAttribute('data-claim-owner-state', 'none');
  await page.locator('[data-claim-start="true"]').click();
  await expect(publicClaim).toHaveAttribute('data-claim-owner-state', 'pending');

  await expect(page.locator('[data-claim-evidence-form="true"]')).toBeVisible();
  await page.locator('[data-claim-license-input="true"]').setInputFiles({
    name: 'business-license.png',
    mimeType: 'image/png',
    buffer: LICENSE_PNG,
  });
  await page.locator('[data-claim-submit-evidence="true"]').click();
  await expect(page.locator('[data-claim-evidence-submitted="true"]')).toBeVisible();

  await gotoAndHidePopup(page, '/admin/claims');
  for (const step of RESTAURANT_CLAIM_GUARD_STEPS) {
    await expect(page.locator(`[data-claim-guard-step="${step}"]`)).toBeVisible();
  }

  const claimRow = page.locator(`[data-claim-restaurant-id="${restaurantId}"]`);
  await expect(claimRow).toBeVisible();
  await claimRow.locator('[data-claim-admin-preview="true"]').click();
  await expect(page.locator('[data-claim-admin-preview-card="true"]')).toBeVisible();
  await page.locator('[data-claim-admin-confirmation="true"]').fill(RESTAURANT_CLAIM_CONFIRMATION_TEXT);
  await expect(page.locator('[data-claim-admin-apply="true"]')).toBeEnabled();
  await page.locator('[data-claim-admin-apply="true"]').click();
  await expect(page.locator('[data-claim-readback="passed"]')).toBeVisible();
  await expect(page.locator('[data-claim-audit="recorded"]')).toBeVisible();

  await gotoAndHidePopup(page, `/r/${restaurantId}`);
  await expect(page.locator('[data-claim-page="public"]')).toHaveAttribute('data-claim-owner-state', 'verified');
  await expect(page.locator('[data-claim-start="true"]')).toHaveCount(0);
  await expect(page.locator('[data-claim-duplicate-blocked="true"]')).toBeVisible();

  const duplicateStatus = await page.evaluate(async (id) => {
    const response = await fetch('/api/claim/start', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        restaurantId: id,
        idempotencyKey: `claim-start-other-${id}`,
      }),
    });
    return response.status;
  }, restaurantId);
  expect(duplicateStatus).toBe(409);
});
