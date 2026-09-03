import { expect, test } from "@playwright/test";

import {
  ADMIN_CONSOLE_MENU_IDS,
  ADMIN_CONSOLE_MENUS,
} from "../lib/admin/console-menu-registry";
import { CONSOLE_FIXED_MESSAGES } from "../lib/admin/console-messages";
import { filterAdminConsoleMenus } from "../lib/admin/console-menu-search";
import {
  installAdminConsoleBypass,
  installAdminConsoleFixtures,
  openAdminConsole,
  saveAdminConsoleEvidence,
  waitForModuleReady,
} from "./helpers/admin-console-e2e";

test.describe("admin console module grid", () => {
  test("filters fifteen cards with search AND section, live count, empty clear, and IME", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await installAdminConsoleBypass(page, testInfo);
    await installAdminConsoleFixtures(page);
    await openAdminConsole(page, "/admin");
    await waitForModuleReady(page, "overview");

    const grid = page.locator('[data-admin-module-grid="true"]');
    await expect(grid).toBeVisible();
    const cards = grid.locator("[data-admin-module-grid-card]");
    await expect(cards).toHaveCount(15);
    for (const menuId of ADMIN_CONSOLE_MENU_IDS) {
      await expect(
        grid.locator(`[data-admin-module-grid-card="${menuId}"]`),
      ).toBeVisible();
    }

    const count = grid.locator('[data-admin-module-grid-count="true"]');
    await expect(count).toHaveText("15개 메뉴를 표시합니다. 전체 15개.");
    await expect(count).toHaveAttribute("aria-live", "polite");

    const search = grid.locator('[data-admin-module-grid-search="true"]');
    const section = grid.locator('[data-admin-module-grid-section="true"]');
    await search.fill("대시보드");
    await expect(cards).toHaveCount(1);
    await expect(
      grid.locator('[data-admin-module-grid-card="overview"]'),
    ).toBeVisible();
    await expect(count).toHaveText("1개 메뉴를 표시합니다. 전체 15개.");

    await search.fill("");
    await section.selectOption("검수");
    const reviewCards = filterAdminConsoleMenus({
      committedQuery: "",
      section: "검수",
    });
    await expect(cards).toHaveCount(reviewCards.length);
    await expect(count).toHaveText(
      `${reviewCards.length}개 메뉴를 표시합니다. 전체 15개.`,
    );

    await search.fill("관리");
    const andCards = filterAdminConsoleMenus({
      committedQuery: "관리",
      section: "검수",
    });
    await expect(cards).toHaveCount(andCards.length);
    for (const menu of andCards) {
      await expect(
        grid.locator(`[data-admin-module-grid-card="${menu.id}"]`),
      ).toBeVisible();
    }
    await expect(count).toHaveText(
      `${andCards.length}개 메뉴를 표시합니다. 전체 15개.`,
    );

    await search.fill("zzzz없음");
    await expect(grid.locator('[data-admin-module-grid-empty="true"]')).toBeVisible();
    await expect(grid.getByText(CONSOLE_FIXED_MESSAGES.gridEmpty)).toBeVisible();
    await expect(count).toHaveText("0개 메뉴를 표시합니다. 전체 15개.");
    await grid.locator('[data-admin-module-grid-clear="true"]').click();
    await expect(cards).toHaveCount(15);
    await expect(search).toHaveValue("");
    await expect(section).toHaveValue("");

    await search.evaluate((element: HTMLInputElement) => {
      const setNativeValue = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      element.focus();
      element.dispatchEvent(new CompositionEvent("compositionstart", { data: "" }));
      setNativeValue?.call(element, "대시보드");
      element.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          data: "대시보드",
          isComposing: true,
        }),
      );
    });
    await expect(search).toHaveValue("대시보드");
    await expect(cards).toHaveCount(15);
    await search.evaluate((element: HTMLInputElement) => {
      element.dispatchEvent(
        new CompositionEvent("compositionend", { data: "대시보드" }),
      );
    });
    await expect(cards).toHaveCount(1);
    await expect(
      grid.locator('[data-admin-module-grid-card="overview"]'),
    ).toBeVisible();

    saveAdminConsoleEvidence("module-grid.json", {
      schemaVersion: 1,
      kind: "playwright-browser-automation-report",
      totalCards: 15,
      andFilterCount: andCards.length,
      andFilterIds: andCards.map((menu) => menu.id),
      emptyCopyPresent: true,
      imeDeferredUntilCompositionEnd: true,
      titles: ADMIN_CONSOLE_MENU_IDS.map((id) => ADMIN_CONSOLE_MENUS[id].title),
    });
  });
});
