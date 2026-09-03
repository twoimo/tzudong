import { describe, expect, test } from "bun:test";

import {
  ADMIN_CONSOLE_MENU_IDS,
  getAdminConsoleMenu,
} from "../lib/admin/console-menu-registry";
import { CONSOLE_FIXED_MESSAGES } from "../lib/admin/console-messages";
import {
  ADMIN_CONSOLE_MODULE_EMPTY_COPY,
  ADMIN_CONSOLE_MODULE_ERROR_MESSAGE,
  ADMIN_CONSOLE_MODULE_STATES,
  ADMIN_CONSOLE_MODULE_UNAUTHORIZED_MESSAGE,
  buildAdminConsoleReloginHref,
  createSameQueryRetry,
  getAdminConsoleModuleEmptyCopy,
  getAdminConsoleModuleOutputKind,
  isAdminConsoleCanvasStatsEmpty,
  pickHighestPendingAdminConsoleMenu,
  resolveAdminConsoleModuleState,
  resolveAdminConsolePanelRequest,
  usesAdminConsoleCanvasStats,
  type AdminConsoleModuleState,
  type AdminConsolePrimaryRequest,
} from "../lib/admin/console-module-state";
import { buildCanonicalAdminModuleHref } from "../lib/admin/admin-module-routing";
import { buildHomeAuthLoginPath } from "../lib/auth/auth-redirect";

const FORBIDDEN_WORDS = [
  "식당",
  "음식점",
  "업소",
  "가게",
  "신청",
  "문의",
  "심사",
  "경로",
  "루트",
] as const;

const HANGUL = /[가-힣]/;

function exclusiveStates(
  input: Parameters<typeof resolveAdminConsoleModuleState>[0],
): AdminConsoleModuleState[] {
  return ADMIN_CONSOLE_MODULE_STATES.filter(
    (state) => resolveAdminConsoleModuleState(input) === state,
  );
}

describe("admin console module completeness state", () => {
  test("resolves exactly one state and keeps unauthorized and error ahead of loading", () => {
    const cases = [
      {},
      { isLoading: true },
      { isEmpty: true },
      { hasError: true },
      { isUnauthorized: true },
      { isLoading: true, isEmpty: true },
      { isLoading: true, hasError: true },
      { isLoading: true, isUnauthorized: true },
      { hasError: true, isEmpty: true },
      { isUnauthorized: true, hasError: true, isLoading: true, isEmpty: true },
    ] as const;

    for (const input of cases) {
      expect(exclusiveStates(input)).toHaveLength(1);
    }

    expect(resolveAdminConsoleModuleState({})).toBe("ready");
    expect(resolveAdminConsoleModuleState({ isEmpty: true })).toBe("empty");
    expect(resolveAdminConsoleModuleState({ isLoading: true })).toBe("loading");
    expect(resolveAdminConsoleModuleState({ hasError: true })).toBe("error");
    expect(resolveAdminConsoleModuleState({ isUnauthorized: true })).toBe(
      "unauthorized",
    );
    expect(
      resolveAdminConsoleModuleState({
        isUnauthorized: true,
        hasError: true,
        isLoading: true,
        isEmpty: true,
      }),
    ).toBe("unauthorized");
    expect(
      resolveAdminConsoleModuleState({
        hasError: true,
        isLoading: true,
        isEmpty: true,
      }),
    ).toBe("error");
    expect(
      resolveAdminConsoleModuleState({ isLoading: true, isEmpty: true }),
    ).toBe("loading");
  });

  test("retries the same target and query snapshot", () => {
    const issued: AdminConsolePrimaryRequest[] = [];
    const lastRequest = {
      target: "/api/admin/pending-counts",
      query: "module=overview",
    };
    const retry = createSameQueryRetry(lastRequest, (request) => {
      issued.push(request);
    });

    expect(retry).not.toBeNull();
    lastRequest.target = "/api/admin/other";
    lastRequest.query = "mutated";
    retry?.();

    expect(issued).toEqual([
      { target: "/api/admin/pending-counts", query: "module=overview" },
    ]);
    expect(createSameQueryRetry(null, () => undefined)).toBeNull();
  });

  test("builds re-login hrefs back to each menu canonical path", () => {
    for (const menuId of ADMIN_CONSOLE_MENU_IDS) {
      const href = buildAdminConsoleReloginHref(menuId);
      const canonical = buildCanonicalAdminModuleHref(menuId);
      expect(href).toBe(
        buildHomeAuthLoginPath({ reason: "admin", next: canonical }),
      );
      expect(href.startsWith("/?auth=login&reason=admin&next=")).toBe(true);
      expect(href).toContain(encodeURIComponent(canonical));
    }
  });

  test("keeps empty copy, error, and unauthorized messages inside Korean copy rules", () => {
    expect(ADMIN_CONSOLE_MODULE_ERROR_MESSAGE).toBe(
      CONSOLE_FIXED_MESSAGES.dataFetchFailed,
    );
    expect(ADMIN_CONSOLE_MODULE_UNAUTHORIZED_MESSAGE).toBe(
      CONSOLE_FIXED_MESSAGES.sessionExpired,
    );
    expect(Object.keys(ADMIN_CONSOLE_MODULE_EMPTY_COPY)).toHaveLength(15);

    for (const menuId of ADMIN_CONSOLE_MENU_IDS) {
      const copy = getAdminConsoleModuleEmptyCopy(menuId);
      expect(HANGUL.test(copy.message)).toBe(true);
      expect(HANGUL.test(copy.nextAction)).toBe(true);
      expect(copy.message.length).toBeGreaterThan(0);
      expect(copy.nextAction.length).toBeGreaterThan(0);
      for (const word of FORBIDDEN_WORDS) {
        expect(copy.message.includes(word), `${menuId}:${word}`).toBe(false);
        expect(copy.nextAction.includes(word), `${menuId}:${word}`).toBe(false);
      }
      expect(copy.message.includes("확정")).toBe(false);
      expect(copy.message.includes("사실")).toBe(false);
      expect(copy.message.includes("완성")).toBe(false);
      expect(copy.message.includes("최종")).toBe(false);
      expect(getAdminConsoleModuleOutputKind(menuId)).toBe(
        getAdminConsoleMenu(menuId).outputKind,
      );
    }
  });

  test("applies canvas stats loading and empty only to overview and routes", () => {
    const loadedEmpty = {
      totalVideos: 0,
      totalRestaurants: 0,
      pendingTotal: 0,
    };
    expect(isAdminConsoleCanvasStatsEmpty(loadedEmpty)).toBe(true);
    expect(
      isAdminConsoleCanvasStatsEmpty({
        totalVideos: null,
        totalRestaurants: 0,
        pendingTotal: 0,
      }),
    ).toBe(false);

    expect(usesAdminConsoleCanvasStats("overview")).toBe(true);
    expect(usesAdminConsoleCanvasStats("routes")).toBe(true);
    expect(usesAdminConsoleCanvasStats("restaurants")).toBe(false);

    expect(
      resolveAdminConsolePanelRequest("overview", {
        isLoading: true,
        hasError: false,
      }),
    ).toEqual({
      isUnauthorized: false,
      hasError: false,
      isLoading: true,
      isEmpty: false,
    });
    expect(
      resolveAdminConsolePanelRequest("restaurants", {
        isLoading: true,
        hasError: true,
      }),
    ).toEqual({
      isUnauthorized: false,
      hasError: false,
      isLoading: false,
      isEmpty: false,
    });
    expect(
      resolveAdminConsolePanelRequest("restaurants", {
        isUnauthorized: true,
        isLoading: true,
      }),
    ).toEqual({
      isUnauthorized: true,
      hasError: false,
      isLoading: false,
      isEmpty: false,
    });
    expect(
      pickHighestPendingAdminConsoleMenu({
        pendingReviews: 4,
        pendingRestaurantSubmissions: 1,
        pendingRecommendationRequests: 1,
      }),
    ).toBe("reviews");
    expect(
      pickHighestPendingAdminConsoleMenu({
        pendingReviews: 1,
        pendingRestaurantSubmissions: 3,
        pendingRecommendationRequests: 2,
      }),
    ).toBe("submissions");
    expect(
      pickHighestPendingAdminConsoleMenu({
        pendingReviews: 0,
        pendingRestaurantSubmissions: 0,
        pendingRecommendationRequests: 0,
      }),
    ).toBe("overview");
  });
});
