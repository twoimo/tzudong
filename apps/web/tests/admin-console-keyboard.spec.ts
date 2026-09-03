import { expect, test } from "@playwright/test";

import {
  ADMIN_CONSOLE_MENU_IDS,
  ADMIN_CONSOLE_MENUS,
} from "../lib/admin/console-menu-registry";
import {
  desktopMenuItem,
  expandDesktopSidebar,
  installAdminConsoleBypass,
  installAdminConsoleFixtures,
  mobileMenuItem,
  openAdminConsole,
  saveAdminConsoleEvidence,
  waitForModuleReady,
} from "./helpers/admin-console-e2e";

test.describe("admin console keyboard operation", () => {
  test("moves skip link to sidebar to canvas, activates 15 menus, and edits order", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await installAdminConsoleBypass(page, testInfo);
    await installAdminConsoleFixtures(page);
    await openAdminConsole(page, "/admin");
    await waitForModuleReady(page, "overview");
    await expandDesktopSidebar(page);

    await expect(page.locator("#admin-console-canvas")).toHaveAttribute(
      "data-admin-console-focus-order",
      "skip-link sidebar canvas module-actions",
    );

    await page.locator("body").click({ position: { x: 8, y: 8 } });
    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "작업 화면으로 건너뛰기" });
    await expect(skipLink).toBeFocused();
    await skipLink.press("Enter");
    await expect(page.locator("#admin-console-canvas")).toBeFocused();

    const desktopItems = page.locator(
      '[data-admin-console-menu-item-mode="desktop-sidebar"]',
    );
    await expect(desktopItems).toHaveCount(15);

    const focusedTitles: string[] = [];
    for (const menuId of ADMIN_CONSOLE_MENU_IDS) {
      const item = desktopMenuItem(page, menuId);
      await item.focus();
      await expect(item).toBeFocused();
      focusedTitles.push(ADMIN_CONSOLE_MENUS[menuId].title);
    }

    const llmItem = desktopMenuItem(page, "llm");
    await llmItem.focus();
    await llmItem.press("Enter");
    await expect(page.locator("#admin-console-canvas")).toHaveAttribute(
      "data-admin-console-active-module",
      "llm",
    );
    await expect(llmItem).toHaveAttribute("aria-current", "page");

    await page
      .locator('[data-admin-sidebar-account-trigger="expanded"]')
      .click();
    const editor = page.locator('[data-admin-sidebar-order-editor="sidebar"]');
    await expect(editor).toBeVisible();
    await editor.locator('[data-admin-sidebar-order-edit-toggle="true"]').click();
    await expect(editor).toHaveAttribute(
      "data-admin-sidebar-order-edit-mode",
      "enabled",
    );

    const insightsDown = editor.locator(
      '[data-admin-sidebar-order-move="item:insights:1"]',
    );
    await insightsDown.focus();
    await expect(insightsDown).toBeFocused();
    await insightsDown.press("ArrowDown");
    await expect
      .poll(async () =>
        desktopItems.locator("span.block.truncate.font-semibold").allTextContents(),
      )
      .toEqual([
        ADMIN_CONSOLE_MENUS.overview.title,
        ADMIN_CONSOLE_MENUS.llm.title,
        ADMIN_CONSOLE_MENUS.insights.title,
        ...ADMIN_CONSOLE_MENU_IDS.slice(3).map(
          (id) => ADMIN_CONSOLE_MENUS[id].title,
        ),
      ]);
    await expect(insightsDown).toBeFocused();

    saveAdminConsoleEvidence("keyboard-desktop.json", {
      schemaVersion: 1,
      kind: "playwright-browser-automation-report",
      focusOrder: "skip-link sidebar canvas module-actions",
      focusedTitles,
      activatedModule: "llm",
      orderAfterArrowDown: [
        "overview",
        "llm",
        "insights",
        ...ADMIN_CONSOLE_MENU_IDS.slice(3),
      ],
    });
  });

  test("cycles mobile dropdown focus and restores the hamburger trigger", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    await installAdminConsoleBypass(page, testInfo);
    await installAdminConsoleFixtures(page);
    await openAdminConsole(page, "/admin");
    await waitForModuleReady(page, "overview");

    const hamburger = page.locator(
      '[data-admin-console-menu-trigger="hamburger"]',
    );
    await expect(hamburger).toBeVisible();
    await hamburger.click();

    const dropdown = page.locator('[data-admin-console-menu-dropdown="true"]');
    await expect(dropdown).toBeVisible();
    const mobileItems = page.locator(
      '[data-admin-console-menu-item-mode="mobile-dropdown"]',
    );
    await expect(mobileItems).toHaveCount(15);

    await mobileMenuItem(page, "overview").focus();
    await expect(mobileMenuItem(page, "overview")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(mobileMenuItem(page, "insights")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(mobileMenuItem(page, "llm")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(dropdown).toHaveCount(0);
    await expect(hamburger).toBeFocused();

    saveAdminConsoleEvidence("keyboard-dropdown.json", {
      schemaVersion: 1,
      kind: "playwright-browser-automation-report",
      mobileItemCount: 15,
      restoredTrigger: "hamburger",
    });
  });
});
