import { expect, type Page } from '@playwright/test';
import type { AdminConsoleRouteModuleId } from '../lib/admin/admin-module-routing';

/** Wait for the selected module's real layout, not merely its navigation state.
 * This is a layout-readiness guard, not evidence that provider data is complete.
 */
export async function waitForAdminModuleReady(
  page: Page,
  moduleId: AdminConsoleRouteModuleId,
  timeout = 30_000,
) {
  const canvas = page.locator('[data-admin-console-content="true"]');
  await expect(canvas).toHaveAttribute('data-admin-console-active-module', moduleId, { timeout });

  const shell = canvas.locator(`[data-admin-embedded-module-id="${moduleId}"]`);
  await expect(shell).toBeVisible({ timeout });
  await expect(shell.locator('[data-admin-module-content="bounded"]')).toBeVisible({ timeout });
  if (moduleId !== 'overview') {
    await expect(shell.locator(`[data-admin-module-header-module="${moduleId}"]`)).toBeVisible({ timeout });
  }

  await expect(canvas.locator([
    '[data-admin-console-content-loading="true"]',
    '[data-admin-evaluation-dynamic-loading-shell="true"]',
    '[data-admin-dashboard-management-skeleton="true"]',
    '[data-thumbnail-module-loading="true"]',
    '[data-insights-client-loading="true"]',
  ].join(', '))).toHaveCount(0, { timeout });

  // Recheck after mount/loading waits so a concurrent navigation cannot pass.
  await expect(canvas).toHaveAttribute('data-admin-console-active-module', moduleId, { timeout });
  await expect(shell).toBeVisible({ timeout });
  return { canvas, shell };
}
