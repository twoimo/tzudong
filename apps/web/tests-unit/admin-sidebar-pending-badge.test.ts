import { describe, expect, test } from "bun:test";

import {
  ADMIN_PENDING_BADGE_STALE_AFTER_MS,
  resolveAdminPendingBadgeState,
  resolveAdminPendingBadgeStates,
} from "../lib/admin/console-pending-badges";
import { ADMIN_CONSOLE_MENU_IDS } from "../lib/admin/console-menu-registry";
import { buildAdminPendingCountsResponse } from "../lib/admin/pending-counts";
import { mulberry32 } from "./helpers/deterministic-generator";

// Property 12: 대기_배지 합산 불변식
// Validates: Requirements 8.1, 8.2, 8.4, 8.6, 8.7, 8.9

const NOW_MS = Date.parse("2026-09-02T11:00:00.000Z");
const BADGE_MENU_IDS = ["submissions", "reviews"] as const;

type GeneratedPendingCountsCase = {
  payload: ReturnType<typeof buildAdminPendingCountsResponse> | null;
  collapsed: boolean;
  restaurantSubmissions: number;
  restaurantRecommendationRequests: number;
  reviews: number;
};

function requiredPendingCountCases(): GeneratedPendingCountsCase[] {
  const freshAsOf = new Date(NOW_MS).toISOString();
  const staleAsOf = new Date(NOW_MS - ADMIN_PENDING_BADGE_STALE_AFTER_MS).toISOString();

  return [
    {
      payload: null,
      collapsed: false,
      restaurantSubmissions: 0,
      restaurantRecommendationRequests: 0,
      reviews: 0,
    },
    {
      payload: buildAdminPendingCountsResponse({
        restaurantSubmissions: 0,
        restaurantRecommendationRequests: 0,
        reviews: 0,
        recommendationRequestsLifecycleReady: true,
        asOf: freshAsOf,
      }),
      collapsed: false,
      restaurantSubmissions: 0,
      restaurantRecommendationRequests: 0,
      reviews: 0,
    },
    {
      payload: buildAdminPendingCountsResponse({
        restaurantSubmissions: 3,
        restaurantRecommendationRequests: 4,
        reviews: 12,
        recommendationRequestsLifecycleReady: true,
        asOf: freshAsOf,
      }),
      collapsed: true,
      restaurantSubmissions: 3,
      restaurantRecommendationRequests: 4,
      reviews: 12,
    },
    {
      payload: buildAdminPendingCountsResponse({
        restaurantSubmissions: 40,
        restaurantRecommendationRequests: 60,
        reviews: 100,
        recommendationRequestsLifecycleReady: false,
        asOf: staleAsOf,
      }),
      collapsed: false,
      restaurantSubmissions: 40,
      restaurantRecommendationRequests: 60,
      reviews: 100,
    },
  ];
}

function generatePendingCountCases(count: number): GeneratedPendingCountsCase[] {
  const random = mulberry32(0x51de);
  const cases = requiredPendingCountCases();

  while (cases.length < count) {
    const restaurantSubmissions = Math.floor(random() * 160);
    const restaurantRecommendationRequests = Math.floor(random() * 160);
    const reviews = Math.floor(random() * 160);
    const failed = random() < 0.12;
    const stale = random() < 0.25;
    const collapsed = random() < 0.5;
    const asOf = new Date(
      NOW_MS - (stale ? ADMIN_PENDING_BADGE_STALE_AFTER_MS + Math.floor(random() * 10_000) : Math.floor(random() * 10_000)),
    ).toISOString();

    cases.push({
      payload: failed
        ? null
        : buildAdminPendingCountsResponse({
            restaurantSubmissions,
            restaurantRecommendationRequests,
            reviews,
            recommendationRequestsLifecycleReady: random() >= 0.3,
            asOf,
          }),
      collapsed,
      restaurantSubmissions,
      restaurantRecommendationRequests,
      reviews,
    });
  }

  return cases;
}

describe("admin sidebar pending badges", () => {
  test("sums declared domains for two badge menus and hides the rest", () => {
    const payload = buildAdminPendingCountsResponse({
      restaurantSubmissions: 2,
      restaurantRecommendationRequests: 5,
      reviews: 9,
      recommendationRequestsLifecycleReady: true,
      asOf: new Date(NOW_MS).toISOString(),
    });

    const badges = resolveAdminPendingBadgeStates({
      payload,
      collapsed: false,
      nowMs: NOW_MS,
    });

    expect(badges.submissions).toEqual({
      kind: "shown",
      count: 7,
      displayText: "7",
      accessibleText: "대기 7건",
      partialAggregate: false,
      staleAggregate: false,
      dotOnly: false,
    });
    expect(badges.reviews).toEqual({
      kind: "shown",
      count: 9,
      displayText: "9",
      accessibleText: "대기 9건",
      partialAggregate: false,
      staleAggregate: false,
      dotOnly: false,
    });

    for (const menuId of ADMIN_CONSOLE_MENU_IDS) {
      if (menuId === "submissions" || menuId === "reviews") continue;
      expect(badges[menuId]).toEqual({ kind: "hidden" });
    }
  });

  test("caps display text at 99+ and keeps the unabbreviated count in the accessible label", () => {
    const payload = buildAdminPendingCountsResponse({
      restaurantSubmissions: 80,
      restaurantRecommendationRequests: 40,
      reviews: 101,
      recommendationRequestsLifecycleReady: false,
      asOf: new Date(NOW_MS - ADMIN_PENDING_BADGE_STALE_AFTER_MS).toISOString(),
    });

    const submissions = resolveAdminPendingBadgeState({
      menuId: "submissions",
      payload,
      collapsed: true,
      nowMs: NOW_MS,
    });
    const reviews = resolveAdminPendingBadgeState({
      menuId: "reviews",
      payload,
      collapsed: true,
      nowMs: NOW_MS,
    });

    expect(submissions).toMatchObject({
      kind: "shown",
      count: 120,
      displayText: "99+",
      accessibleText: "대기 120건",
      partialAggregate: true,
      staleAggregate: true,
      dotOnly: true,
    });
    expect(reviews).toMatchObject({
      kind: "shown",
      count: 101,
      displayText: "99+",
      accessibleText: "대기 101건",
      dotOnly: true,
    });
  });

  test("hides every menu badge when the pending-counts query failed", () => {
    const badges = resolveAdminPendingBadgeStates({
      payload: null,
      collapsed: false,
      nowMs: NOW_MS,
    });
    expect(ADMIN_CONSOLE_MENU_IDS).toHaveLength(15);
    for (const menuId of ADMIN_CONSOLE_MENU_IDS) {
      expect(badges[menuId]).toEqual({ kind: "hidden" });
    }
  });

  test("Property 12: pending badge summation invariant", () => {
    const cases = generatePendingCountCases(100);
    expect(cases.length).toBeGreaterThanOrEqual(100);

    for (const generated of cases) {
      const badges = resolveAdminPendingBadgeStates({
        payload: generated.payload,
        collapsed: generated.collapsed,
        nowMs: NOW_MS,
      });
      const shown = ADMIN_CONSOLE_MENU_IDS.filter(
        (menuId) => badges[menuId].kind === "shown",
      );

      if (generated.payload == null) {
        expect(shown).toEqual([]);
        expect(ADMIN_CONSOLE_MENU_IDS).toHaveLength(15);
        continue;
      }

      expect(shown).toEqual(["submissions", "reviews"]);
      expect(shown).toHaveLength(BADGE_MENU_IDS.length);

      const submissions = badges.submissions;
      const reviews = badges.reviews;
      if (submissions.kind !== "shown" || reviews.kind !== "shown") {
        throw new Error("expected submissions and reviews badges to be shown");
      }

      const expectedSubmissions =
        generated.restaurantSubmissions + generated.restaurantRecommendationRequests;
      expect(submissions.count).toBe(expectedSubmissions);
      expect(reviews.count).toBe(generated.reviews);
      expect(submissions.count).toBeGreaterThanOrEqual(0);
      expect(reviews.count).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(submissions.count)).toBe(true);
      expect(Number.isInteger(reviews.count)).toBe(true);
      expect(submissions.accessibleText).toContain(String(expectedSubmissions));
      expect(reviews.accessibleText).toContain(String(generated.reviews));
      expect(submissions.accessibleText).not.toContain("99+");
      expect(reviews.accessibleText).not.toContain("99+");
    }
  });
});
