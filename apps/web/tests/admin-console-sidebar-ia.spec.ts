import { expect, test } from "@playwright/test";

import {
  ADMIN_CONSOLE_MENU_IDS,
  ADMIN_CONSOLE_MENUS,
  ADMIN_CONSOLE_SECTION_LABELS,
} from "../lib/admin/console-menu-registry";
import {
  desktopMenuItem,
  expandDesktopSidebar,
  installAdminConsoleBypass,
  installAdminConsoleFixtures,
  openAdminConsole,
  saveAdminConsoleEvidence,
} from "./helpers/admin-console-e2e";

test.describe("admin console sidebar information architecture", () => {
  test("shows four sections, fifteen titles, aria-current, badges, and collapsed dots", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 1280, height: 800 });
    await installAdminConsoleBypass(page, testInfo);
    await installAdminConsoleFixtures(page);
    await openAdminConsole(page, "/admin");
    await expandDesktopSidebar(page);

    const nav = page.locator('[data-admin-sidebar-section-list="spacious"]');
    await expect(nav).toBeVisible();

    const sectionLabels = await nav.locator(":scope > div > p").allTextContents();
    expect(sectionLabels.map((label) => label.trim())).toEqual([
      ...ADMIN_CONSOLE_SECTION_LABELS,
    ]);

    const desktopItems = page.locator(
      '[data-admin-console-menu-item-mode="desktop-sidebar"]',
    );
    await expect(desktopItems).toHaveCount(15);

    const titles = await desktopItems
      .locator("span.block.truncate.font-semibold")
      .allTextContents();
    expect(titles.map((title) => title.trim())).toEqual(
      ADMIN_CONSOLE_MENU_IDS.map((id) => ADMIN_CONSOLE_MENUS[id].title),
    );

    const overviewItem = desktopMenuItem(page, "overview");
    await expect(overviewItem).toHaveAttribute("aria-current", "page");
    await expect(overviewItem).toHaveAttribute(
      "data-admin-console-menu-item-state",
      "active",
    );

    const insightsItem = desktopMenuItem(page, "insights");
    await insightsItem.click();
    await expect(insightsItem).toHaveAttribute("aria-current", "page");
    await expect(overviewItem).not.toHaveAttribute("aria-current", "page");
    await expect(page.locator("#admin-console-canvas")).toHaveAttribute(
      "data-admin-console-active-module",
      "insights",
    );

    const submissionsItem = desktopMenuItem(page, "submissions");
    const reviewsItem = desktopMenuItem(page, "reviews");
    const submissionsBadge = submissionsItem.locator(
      "[data-admin-sidebar-badge-tone]",
    );
    const reviewsBadge = reviewsItem.locator("[data-admin-sidebar-badge-tone]");
    await expect(submissionsBadge).toHaveAttribute(
      "data-admin-sidebar-badge-tone",
      "검수",
    );
    await expect(reviewsBadge).toHaveAttribute(
      "data-admin-sidebar-badge-tone",
      "검수",
    );
    await expect(submissionsBadge).toHaveText("6");
    await expect(reviewsBadge).toHaveText("3");
    await expect(submissionsItem).toHaveAttribute(
      "aria-label",
      /제보 관리 대기 6건/,
    );
    await expect(reviewsItem).toHaveAttribute("aria-label", /리뷰 관리 대기 3건/);

    const restaurantsBadgeCount = await desktopMenuItem(page, "restaurants")
      .locator("[data-admin-sidebar-badge-tone]")
      .count();
    expect(restaurantsBadgeCount).toBe(0);

    const expandedBadgeBox = await submissionsBadge.boundingBox();
    expect(expandedBadgeBox?.width ?? 0).toBeGreaterThan(12);

    await page.locator('[data-admin-sidebar-collapse-toggle="true"]').click();
    await expect(
      page.locator("[data-admin-console-sidebar-collapsed]"),
    ).toHaveAttribute("data-admin-console-sidebar-collapsed", "true");

    await expect(submissionsBadge).toHaveClass(/md:h-2/);
    await expect(submissionsBadge).toHaveClass(/md:w-2/);
    const collapsedBadgeBox = await submissionsBadge.boundingBox();
    expect(collapsedBadgeBox?.width ?? 99).toBeLessThanOrEqual(12);
    expect(collapsedBadgeBox?.height ?? 99).toBeLessThanOrEqual(12);

    saveAdminConsoleEvidence("sidebar-ia.json", {
      schemaVersion: 1,
      kind: "playwright-browser-automation-report",
      sectionLabels,
      menuCount: titles.length,
      titles,
      ariaCurrentAfterInsights: "insights",
      badgeCounts: { submissions: 6, reviews: 3, restaurants: 0 },
      collapsedDotWidth: Math.round(collapsedBadgeBox?.width ?? 0),
      focusOrder:
        (await page
          .locator("#admin-console-canvas")
          .getAttribute("data-admin-console-focus-order")) ?? "",
    });
  });
});
