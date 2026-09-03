import { expect, type Page, type TestInfo } from "@playwright/test";
import { resolve } from "node:path";

import { ADMIN_AUDIT_COVERAGE } from "../../lib/admin/audit-contract";
import {
  ADMIN_CONSOLE_MENU_IDS,
  ADMIN_CONSOLE_MENUS,
  type AdminConsoleMenuId,
} from "../../lib/admin/console-menu-registry";
import {
  E2E_ADMIN_ROUTE_BYPASS_HEADER,
  E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER,
} from "../../lib/e2e-admin-route-bypass";
import { buildAdminPendingCountsResponse } from "../../lib/admin/pending-counts";
import {
  DEFAULT_ADMIN_SIDEBAR_ORDER,
  normalizeAdminSidebarOrder,
  type AdminSidebarOrderPreference,
} from "../../lib/admin/sidebar-order";
import { gotoAndHidePopup } from "../helpers";
import { writeEvidenceIfSafe } from "./evidence-guard";

export const E2E_ADMIN_SHELL_BYPASS_STORAGE_KEY =
  "tzudong:e2e-admin-shell-bypass";

export const ADMIN_CONSOLE_EVIDENCE_DIR = resolve(
  process.cwd(),
  "..",
  "..",
  "artifacts",
  "admin-console-browser",
);

export const ADMIN_CONSOLE_READY_SELECTORS = {
  overview: '[data-admin-dashboard-management="true"]',
  insights: '[data-admin-embedded-module-id="insights"]',
  llm: '[aria-label="운영 보조 제안"]',
  restaurants: "#scroll-container",
  "restaurant-refresh-history":
    '[data-admin-restaurant-refresh-history="true"]',
  submissions: "#scroll-container",
  reviews: "#scroll-container",
  "map-overlays": '[data-admin-map-overlays-module="true"]',
  banners: '[aria-labelledby="banner-list-title"]',
  routes: '[aria-label="관리자 지도 운영 개요 2분할"]',
  users: "[data-admin-users-summary]",
  pipeline: '[data-admin-pipeline-dashboard="true"]',
  audit: '[data-admin-audit-coverage="partial-domain-specific"]',
  storyboard: '[data-admin-storyboard-generator="true"]',
  "youtube-thumbnail-generator":
    '[data-admin-youtube-thumbnail-generator="true"]',
} as const satisfies Record<AdminConsoleMenuId, string>;

const KPI_FIXTURE = {
  asOf: "2026-07-01T00:00:00.000Z",
  period: "1M",
  totalVideos: 3,
  videos: [
    {
      id: "console-e2e-high",
      title: "지표 최대값 영상",
      category: "한식",
      viewCount: 1000,
      likeCount: 100,
      commentCount: 20,
      duration: 600,
      previousViewCount: 900,
      previousLikeCount: 90,
      previousCommentCount: 18,
      previousDuration: 580,
      publishedAt: "2026-06-01T00:00:00.000Z",
    },
    {
      id: "console-e2e-mid",
      title: "지표 중간값 영상",
      category: "한식",
      viewCount: 500,
      likeCount: 50,
      commentCount: 10,
      duration: 300,
      previousViewCount: 400,
      previousLikeCount: 40,
      previousCommentCount: 8,
      previousDuration: 290,
      publishedAt: "2026-06-15T00:00:00.000Z",
    },
  ],
} as const;

export function getE2EAdminRouteBypassToken(testInfo: TestInfo) {
  const token = testInfo.config.metadata.e2eAdminRouteBypassToken;
  if (typeof token !== "string" || !token.trim()) {
    throw new Error(
      "playwright.config.ts must provide metadata.e2eAdminRouteBypassToken for this test.",
    );
  }
  return token;
}

export async function installAdminConsoleBypass(
  page: Page,
  testInfo: TestInfo,
) {
  await page.addInitScript((storageKey) => {
    window.localStorage.setItem(storageKey, "1");
  }, E2E_ADMIN_SHELL_BYPASS_STORAGE_KEY);
  await page.setExtraHTTPHeaders({
    [E2E_ADMIN_ROUTE_BYPASS_HEADER]: "1",
    [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: getE2EAdminRouteBypassToken(testInfo),
  });
}

export async function installAdminConsoleFixtures(page: Page) {
  const pending = buildAdminPendingCountsResponse({
    restaurantSubmissions: 4,
    restaurantRecommendationRequests: 2,
    reviews: 3,
    recommendationRequestsLifecycleReady: true,
    asOf: new Date().toISOString(),
  });
  let sidebarOrder: AdminSidebarOrderPreference = structuredClone(
    DEFAULT_ADMIN_SIDEBAR_ORDER,
  );
  const now = Date.parse("2026-07-01T00:00:00.000Z");

  await page.route("**/api/admin/pending-counts**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(pending),
    });
  });
  await page.route("**/api/admin/youtube-kpis**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(KPI_FIXTURE),
    });
  });
  await page.route("**/api/admin/youtube-channel**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        channelId: "console-e2e-channel",
        title: "콘솔 검증 채널",
        handle: "@console-e2e",
        subscriberCount: 100,
        previousSubscriberCount: 100,
        subscriberDelta: 0,
        videoCount: 3,
        previousVideoCount: 3,
        videoDelta: 0,
        deltaSource: "snapshot-delta",
      }),
    });
  });
  await page.route("**/api/admin/audit-events**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: "2026-07-01T00:00:00.000Z",
        source: "admin_audit_events",
        coverage: ADMIN_AUDIT_COVERAGE,
        unavailable: null,
        events: [
          {
            id: "console-e2e-audit-1",
            actorUserId: null,
            targetUserId: null,
            action: "role_change",
            status: "applied",
            reasonCode: "operator",
            correlationId: null,
            appliedAt: new Date(now - 86_400_000).toISOString(),
            errorCode: null,
            createdAt: new Date(now - 86_400_000).toISOString(),
            counts: { targets: 1 },
            flags: {},
          },
        ],
      }),
    });
  });
  await page.route("**/api/admin/system-status**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        asOf: "2026-07-01T00:00:00.000Z",
        providerReadiness: {},
        storyboardAgent: { reachable: true },
        bgeEmbedding: { reachable: true },
        frameCaption: { reachable: true },
        pipelineControl: { reachable: true },
      }),
    });
  });
  await page.route("**/api/admin/preferences/sidebar-order**", async (route) => {
    const method = route.request().method();
    if (method === "GET") {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ order: sidebarOrder }),
      });
      return;
    }
    if (method === "PATCH") {
      const posted = route.request().postDataJSON() as {
        order?: unknown;
      };
      sidebarOrder = normalizeAdminSidebarOrder(posted.order);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ order: sidebarOrder }),
      });
      return;
    }
    await route.fallback();
  });
}

export async function openAdminConsole(page: Page, path = "/admin") {
  await gotoAndHidePopup(page, path);
  await expect(page.locator("#admin-console-canvas")).toBeVisible({
    timeout: 30_000,
  });
}

export async function expandDesktopSidebar(page: Page) {
  const layout = page.locator("[data-admin-console-sidebar-collapsed]");
  const toggle = page.locator('[data-admin-sidebar-collapse-toggle="true"]');
  if ((await layout.getAttribute("data-admin-console-sidebar-collapsed")) === "true") {
    await toggle.click();
  }
  await expect(layout).toHaveAttribute(
    "data-admin-console-sidebar-collapsed",
    "false",
  );
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await page.waitForTimeout(150);
}

export function desktopMenuItem(page: Page, menuId: AdminConsoleMenuId) {
  const title = ADMIN_CONSOLE_MENUS[menuId].title;
  return page
    .locator('[data-admin-console-menu-item-mode="desktop-sidebar"]')
    .filter({ hasText: title })
    .first();
}

export function mobileMenuItem(page: Page, menuId: AdminConsoleMenuId) {
  const title = ADMIN_CONSOLE_MENUS[menuId].title;
  return page
    .locator('[data-admin-console-menu-item-mode="mobile-dropdown"]')
    .filter({ hasText: title })
    .first();
}

export async function waitForModuleSurface(
  page: Page,
  menuId: AdminConsoleMenuId,
) {
  const canvas = page.locator("#admin-console-canvas");
  await expect(canvas).toHaveAttribute(
    "data-admin-console-active-module",
    menuId,
    { timeout: 30_000 },
  );
  const loadingOrReady = canvas.locator(
    `[data-admin-sidebar-module-loading-module="${menuId}"], [data-admin-module-state-menu="${menuId}"], [data-admin-module-header-module="${menuId}"]`,
  );
  await expect(loadingOrReady.first()).toBeVisible({ timeout: 30_000 });
  const childCount = await canvas.evaluate((element) => element.childElementCount);
  expect(childCount).toBeGreaterThan(0);
}

export async function waitForModuleReady(
  page: Page,
  menuId: AdminConsoleMenuId,
) {
  await waitForModuleSurface(page, menuId);
  const canvas = page.locator("#admin-console-canvas");
  await expect(
    canvas.locator(
      `[data-admin-module-state-menu="${menuId}"], ${ADMIN_CONSOLE_READY_SELECTORS[menuId]}`,
    ).first(),
  ).toBeVisible({ timeout: 30_000 });
}

export function saveAdminConsoleEvidence(
  fileName: string,
  evidence: unknown,
) {
  writeEvidenceIfSafe(resolve(ADMIN_CONSOLE_EVIDENCE_DIR, fileName), evidence);
}

export const ADMIN_CONSOLE_MENU_TITLES = ADMIN_CONSOLE_MENU_IDS.map(
  (id) => ADMIN_CONSOLE_MENUS[id].title,
);
