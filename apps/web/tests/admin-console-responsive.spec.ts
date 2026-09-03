import { expect, test, type Page } from "@playwright/test";

import { ADMIN_CONSOLE_MENU_IDS } from "../lib/admin/console-menu-registry";
import {
  expandDesktopSidebar,
  installAdminConsoleBypass,
  installAdminConsoleFixtures,
  openAdminConsole,
  saveAdminConsoleEvidence,
  waitForModuleReady,
} from "./helpers/admin-console-e2e";

async function measureOverflow(page: Page) {
  return page.evaluate(() => ({
    documentDelta: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyDelta: document.body.scrollWidth - document.body.clientWidth,
  }));
}

async function gridColumnCount(page: Page) {
  return page.locator('[data-admin-module-grid-cards="true"]').evaluate((element) => {
    const template = getComputedStyle(element).gridTemplateColumns;
    return template.split(/\s+/).filter(Boolean).length;
  });
}

async function expectCardsReachable(page: Page) {
  const grid = page.locator('[data-admin-module-grid="true"]');
  await expect(grid.locator("[data-admin-module-grid-card]")).toHaveCount(15);
  for (const menuId of ADMIN_CONSOLE_MENU_IDS) {
    const card = grid.locator(`[data-admin-module-grid-card="${menuId}"]`);
    await card.scrollIntoViewIfNeeded();
    await expect(card).toBeVisible();
  }
}

test.describe("admin console responsive breakpoints", () => {
  test("keeps sidebar chrome, 15 reachable cards, and zero overflow at 360/768/1280", async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await installAdminConsoleBypass(page, testInfo);
    await installAdminConsoleFixtures(page);

    await page.setViewportSize({ width: 360, height: 800 });
    await openAdminConsole(page, "/admin");
    await waitForModuleReady(page, "overview");

    const hamburger = page.locator(
      '[data-admin-console-menu-trigger="hamburger"]',
    );
    const aside = page.locator('aside[aria-label="관리자 콘솔 사이드바"]');
    await expect(hamburger).toBeVisible();
    await expect(page.locator('[data-admin-console-mobile-header="true"]')).toBeVisible();
    await expect(aside).toBeHidden();
    await expect(await gridColumnCount(page)).toBe(1);
    await expectCardsReachable(page);
    const overflow360 = await measureOverflow(page);
    expect(overflow360.documentDelta).toBeLessThanOrEqual(0);
    expect(overflow360.bodyDelta).toBeLessThanOrEqual(0);

    await page.setViewportSize({ width: 767, height: 800 });
    await expect(hamburger).toBeVisible();
    await expect(aside).toBeHidden();
    await expect(await gridColumnCount(page)).toBe(1);
    const overflow767 = await measureOverflow(page);
    expect(overflow767.documentDelta).toBeLessThanOrEqual(0);

    await page.setViewportSize({ width: 768, height: 800 });
    await expect(aside).toBeVisible();
    await expect(hamburger).toBeHidden();
    await expandDesktopSidebar(page);
    await expect(await gridColumnCount(page)).toBe(2);
    await expectCardsReachable(page);
    const overflow768 = await measureOverflow(page);
    expect(overflow768.documentDelta).toBeLessThanOrEqual(0);
    expect(overflow768.bodyDelta).toBeLessThanOrEqual(0);

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(aside).toBeVisible();
    await expect(hamburger).toBeHidden();
    await expect(await gridColumnCount(page)).toBe(3);
    await expectCardsReachable(page);
    const overflow1280 = await measureOverflow(page);
    expect(overflow1280.documentDelta).toBeLessThanOrEqual(0);
    expect(overflow1280.bodyDelta).toBeLessThanOrEqual(0);

    saveAdminConsoleEvidence("responsive.json", {
      schemaVersion: 1,
      kind: "playwright-browser-automation-report",
      breakpoints: {
        360: { sidebar: "hamburger", columns: 1, overflow: overflow360.documentDelta },
        767: { sidebar: "hamburger", columns: 1, overflow: overflow767.documentDelta },
        768: { sidebar: "desktop", columns: 2, overflow: overflow768.documentDelta },
        1280: { sidebar: "desktop", columns: 3, overflow: overflow1280.documentDelta },
      },
      reachableCardCount: 15,
    });
  });
});
