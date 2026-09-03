import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  E2E_ADMIN_ROUTE_BYPASS_HEADER,
  E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER,
} from "../lib/e2e-admin-route-bypass";
import { ADMIN_AUDIT_COVERAGE } from "../lib/admin/audit-contract";
import { CONSOLE_VIZ_BINDINGS } from "../lib/admin/console-visualization-map";
import { buildAdminPendingCountsResponse } from "../lib/admin/pending-counts";
import { gotoAndHidePopup, hidePopupOverlay } from "./helpers";

const E2E_ADMIN_SHELL_BYPASS_STORAGE_KEY = "tzudong:e2e-admin-shell-bypass";
const ADMIN_THEME_STORAGE_KEY = "tzudong-admin-theme";

const VIZ_BOUND_TARGETS = [
  { path: "/admin", moduleId: "overview", minCards: 2 },
  { path: "/admin?module=insights", moduleId: "insights", minCards: 0 },
  { path: "/admin?module=restaurants", moduleId: "restaurants", minCards: 0 },
  {
    path: "/admin?module=restaurant-refresh-history",
    moduleId: "restaurant-refresh-history",
    minCards: 1,
  },
  { path: "/admin?module=submissions", moduleId: "submissions", minCards: 0 },
  { path: "/admin?module=reviews", moduleId: "reviews", minCards: 0 },
  { path: "/admin?module=pipeline", moduleId: "pipeline", minCards: 0 },
  { path: "/admin?module=audit", moduleId: "audit", minCards: 1 },
  { path: "/admin?module=llm", moduleId: "llm", minCards: 1 },
] as const;

const KPI_FIXTURE = {
  asOf: "2026-07-01T00:00:00.000Z",
  period: "1M",
  totalVideos: 3,
  videos: [
    {
      id: "tone-parity-high",
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
      id: "tone-parity-mid",
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

type VizSurfaceSnapshot = {
  menu: string;
  form: string;
  state: string;
  seriesCount: number;
  labels: string[];
  pointsByLabel: Record<string, number>;
};

function getE2EAdminRouteBypassToken(testInfo: TestInfo) {
  const token = testInfo.config.metadata.e2eAdminRouteBypassToken;
  if (typeof token !== "string" || !token.trim()) {
    throw new Error(
      "playwright.config.ts must provide metadata.e2eAdminRouteBypassToken for this test.",
    );
  }
  return token;
}

async function installAdminBypass(page: Page, testInfo: TestInfo) {
  await page.addInitScript((storageKey) => {
    window.localStorage.setItem(storageKey, "1");
  }, E2E_ADMIN_SHELL_BYPASS_STORAGE_KEY);
  await page.setExtraHTTPHeaders({
    [E2E_ADMIN_ROUTE_BYPASS_HEADER]: "1",
    [E2E_ADMIN_ROUTE_BYPASS_TOKEN_HEADER]: getE2EAdminRouteBypassToken(testInfo),
  });
}

async function installStableVizFixtures(page: Page) {
  const pending = buildAdminPendingCountsResponse({
    restaurantSubmissions: 4,
    restaurantRecommendationRequests: 2,
    reviews: 3,
    recommendationRequestsLifecycleReady: true,
    asOf: "2026-07-01T00:00:00.000Z",
  });
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
            id: "tone-parity-audit-1",
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
          {
            id: "tone-parity-audit-2",
            actorUserId: null,
            targetUserId: null,
            action: "role_change",
            status: "failed",
            reasonCode: "conflict",
            correlationId: null,
            appliedAt: null,
            errorCode: "ADMIN_CONFLICT",
            createdAt: new Date(now - 172_800_000).toISOString(),
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
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ order: null }),
    });
  });
  await page.route("**/api/admin/restaurant-refresh-history**", async (route) => {
    if (route.request().method() !== "GET") {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        summary: {
          approved_restaurants_total: 12,
          needs_review: 3,
          approved: 5,
          rejected: 1,
          applied: 4,
          last_checked_at: "2026-07-01T00:00:00.000Z",
        },
        candidates: [],
      }),
    });
  });
}

async function waitForSettledVizCards(page: Page, minCards = 0) {
  await page.waitForFunction(
    (expectedMin) => {
      const cards = [
        ...document.querySelectorAll('[data-admin-viz-card="true"]'),
      ];
      if (cards.length < expectedMin) return false;
      return cards.every(
        (card) => card.getAttribute("data-admin-viz-state") !== "loading",
      );
    },
    minCards,
    { timeout: 20_000 },
  );
}

async function collectVizSurfaces(page: Page): Promise<VizSurfaceSnapshot[]> {
  return page.evaluate(() => {
    return [...document.querySelectorAll('[data-admin-viz-card="true"]')].map(
      (card) => {
        const series = [
          ...card.querySelectorAll("[data-admin-viz-series-summary]"),
        ].map((node) => ({
          label: node.getAttribute("data-admin-viz-series-summary") ?? "",
          points: Number(node.getAttribute("data-admin-viz-series-points") ?? "0"),
        }));
        const labels = series.map((item) => item.label).sort();
        return {
          menu: card.getAttribute("data-admin-viz-menu") ?? "",
          form: card.getAttribute("data-admin-viz-form") ?? "",
          state: card.getAttribute("data-admin-viz-state") ?? "",
          seriesCount: Number(
            card.getAttribute("data-admin-viz-series-count") ?? series.length,
          ),
          labels,
          pointsByLabel: Object.fromEntries(
            series.map((item) => [item.label, item.points]),
          ),
        };
      },
    );
  });
}

async function setDocumentTheme(page: Page, mode: "light" | "dark") {
  await page.evaluate((nextMode) => {
    document.documentElement.classList.toggle("dark", nextMode === "dark");
  }, mode);
  await page.waitForTimeout(50);
}

test.describe("admin console brightness-mode tone parity", () => {
  test.describe.configure({ mode: "serial" });
  test("applies the stored theme before paint and records system for invalid values", async ({
    page,
  }, testInfo) => {
    test.setTimeout(90_000);
    await installAdminBypass(page, testInfo);

    await page.addInitScript(
      ({ key, value }) => {
        window.localStorage.setItem(key, value);
      },
      { key: ADMIN_THEME_STORAGE_KEY, value: "dark" },
    );
    const firstResponse = await page.goto("/admin", {
      waitUntil: "domcontentloaded",
    });
    await hidePopupOverlay(page);
    await expect
      .poll(() =>
        page.locator("html").evaluate((el) => el.classList.contains("dark")),
      )
      .toBe(true);
    const firstHtml = (await firstResponse?.text()) ?? "";
    expect(firstHtml).toContain("tzudong-admin-theme");
    expect(firstHtml).toMatch(
      /<script(?![^>]*(?:\basync\b|\bdefer\b))[^>]*>[\s\S]*tzudong-admin-theme/,
    );

    await page.addInitScript(
      ({ key, value }) => {
        window.localStorage.setItem(key, value);
      },
      { key: ADMIN_THEME_STORAGE_KEY, value: "sepia" },
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    const recorded = await page.evaluate((key) => {
      return window.localStorage.getItem(key);
    }, ADMIN_THEME_STORAGE_KEY);
    expect(recorded).toBe("system");
    const prefersDark = await page.evaluate(
      () => window.matchMedia("(prefers-color-scheme: dark)").matches,
    );
    await expect
      .poll(() =>
        page.locator("html").evaluate((el) => el.classList.contains("dark")),
      )
      .toBe(prefersDark);
  });

  test("keeps the same series count, labels, and point counts in light and dark", async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await installAdminBypass(page, testInfo);
    await installStableVizFixtures(page);
    await page.addInitScript(
      ({ key }) => {
        window.localStorage.setItem(key, "light");
      },
      { key: ADMIN_THEME_STORAGE_KEY },
    );

    const mismatches: string[] = [];
    const snapshots: Array<{
      menuId: string;
      light: VizSurfaceSnapshot[];
      dark: VizSurfaceSnapshot[];
    }> = [];

    for (const target of VIZ_BOUND_TARGETS) {
      await gotoAndHidePopup(page, target.path);
      await expect(page.locator("#admin-console-canvas")).toHaveAttribute(
        "data-admin-console-active-module",
        target.moduleId,
        { timeout: 30_000 },
      );
      await waitForSettledVizCards(page, target.minCards);
      await setDocumentTheme(page, "light");
      const light = await collectVizSurfaces(page);
      await setDocumentTheme(page, "dark");
      const dark = await collectVizSurfaces(page);
      snapshots.push({ menuId: target.moduleId, light, dark });

      if (light.length !== dark.length) {
        mismatches.push(
          `${target.moduleId}: surface count ${light.length} !== ${dark.length}`,
        );
        continue;
      }
      for (const [index, lightSurface] of light.entries()) {
        const darkSurface = dark[index];
        if (!darkSurface) {
          mismatches.push(`${target.moduleId}: missing dark surface ${index}`);
          continue;
        }
        if (lightSurface.seriesCount !== darkSurface.seriesCount) {
          mismatches.push(
            `${lightSurface.menu}/${lightSurface.form}: seriesCount ${lightSurface.seriesCount} !== ${darkSurface.seriesCount}`,
          );
        }
        if (lightSurface.labels.join("|") !== darkSurface.labels.join("|")) {
          mismatches.push(
            `${lightSurface.menu}/${lightSurface.form}: labels differ`,
          );
        }
        for (const label of lightSurface.labels) {
          if (
            lightSurface.pointsByLabel[label] !==
            darkSurface.pointsByLabel[label]
          ) {
            mismatches.push(
              `${lightSurface.menu}/${lightSurface.form}: ${label} points differ`,
            );
          }
        }
      }
    }

    const expectedMenus = new Set(CONSOLE_VIZ_BINDINGS.map((item) => item.menuId));
    const visitedMenus = new Set(VIZ_BOUND_TARGETS.map((item) => item.moduleId));
    expect([...expectedMenus].every((menuId) => visitedMenus.has(menuId))).toBe(
      true,
    );
    expect(mismatches).toEqual([]);

    const lightTone = await page.evaluate(() => {
      const host =
        document.querySelector('[data-admin-console-tone-scale="v1"]') ??
        document.documentElement;
      return getComputedStyle(host).getPropertyValue("--admin-tone-1").trim();
    });
    expect(lightTone.length).toBeGreaterThan(0);
  });
});
