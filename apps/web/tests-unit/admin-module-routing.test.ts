import { describe, expect, test } from "bun:test";

import { CONSOLE_FIXED_MESSAGES } from "../lib/admin/console-messages";
import {
  ADMIN_CONSOLE_MENU_IDS,
  isAdminConsoleMenuId,
} from "../lib/admin/console-menu-registry";
import {
  ADMIN_CANONICAL_QUERY_KEYS,
  ADMIN_CONSOLE_MODULE_IDS,
  buildCanonicalAdminEvaluationsHref,
  buildCanonicalAdminHrefFromSearchParams,
  buildCanonicalAdminModuleHref,
  getAdminModuleIdFromSearchParams,
  getAdminModuleStateWarning,
  isAdminConsoleRouteModuleId,
} from "../lib/admin/admin-module-routing";
import { generateCanonicalHrefCases } from "./helpers/deterministic-generator";

function searchParamsFromHref(href: string): URLSearchParams {
  return new URL(href, "https://tzudong.example").searchParams;
}

function searchParamsFromCase(
  moduleId: string,
  query: Record<string, string>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === "module") continue;
    params.set(key, value);
  }
  if (moduleId.length > 0) {
    params.set("module", moduleId);
  }
  return params;
}

describe("admin module routing", () => {
  test("re-exports registry menu ids and keeps public href helpers", () => {
    expect([...ADMIN_CONSOLE_MODULE_IDS]).toEqual([...ADMIN_CONSOLE_MENU_IDS]);
    expect(buildCanonicalAdminModuleHref("overview")).toBe("/admin");
    expect(buildCanonicalAdminModuleHref("reviews")).toBe("/admin?module=reviews");
    expect(
      buildCanonicalAdminEvaluationsHref(new URLSearchParams("view=submissions")),
    ).toBe("/admin?module=submissions");
  });

  test("does not leak uninterpreted module values into warnings or canonical hrefs", () => {
    const leaked = "UNKNOWN_MODULE_XYZ<script>";
    const params = new URLSearchParams(
      `module=${encodeURIComponent(leaked)}&video_id=keep-me`,
    );
    const warning = getAdminModuleStateWarning(params);
    const href = buildCanonicalAdminHrefFromSearchParams(params);

    expect(warning).toBe(CONSOLE_FIXED_MESSAGES.unknownModule);
    expect(warning).not.toContain(leaked);
    expect(href).toBe("/admin?video_id=keep-me");
    expect(href).not.toContain("UNKNOWN_MODULE_XYZ");
    expect(href).not.toContain("<script>");
    expect(getAdminModuleIdFromSearchParams(params)).toBe("overview");
  });

  test("rewrites legacy evaluation links with the fixed Korean notice", () => {
    const params = new URLSearchParams("view=submissions&tab=reviews&reason=중복");
    expect(getAdminModuleIdFromSearchParams(params)).toBe("reviews");
    expect(getAdminModuleStateWarning(params)).toBe(
      CONSOLE_FIXED_MESSAGES.legacyLinkNormalized,
    );
    expect(buildCanonicalAdminHrefFromSearchParams(params)).toBe(
      "/admin?module=reviews&reason=%EC%A4%91%EB%B3%B5",
    );
  });
});

describe("admin canonical href properties", () => {
  const cases = generateCanonicalHrefCases(120);

  // Property 7: 정규_링크 왕복
  // Validates: Requirements 6.2, 6.5, 6.9, 21.5
  test("round-trips valid menu ids and reports invalid module formats", () => {
    expect(cases.length).toBeGreaterThanOrEqual(100);
    const invalidFormats = cases.filter(
      (entry) => !isAdminConsoleMenuId(entry.moduleId),
    );
    expect(invalidFormats.length).toBeGreaterThanOrEqual(5);

    for (const entry of cases) {
      if (!isAdminConsoleRouteModuleId(entry.moduleId)) {
        expect(isAdminConsoleMenuId(entry.moduleId)).toBe(false);
        continue;
      }

      const params = searchParamsFromCase(entry.moduleId, entry.query);
      const href = buildCanonicalAdminHrefFromSearchParams(params);
      const parsed = searchParamsFromHref(href);
      expect(getAdminModuleIdFromSearchParams(parsed)).toBe(entry.moduleId);
      expect(
        [...parsed.keys()].every((key) =>
          (ADMIN_CANONICAL_QUERY_KEYS as readonly string[]).includes(key),
        ),
      ).toBe(true);
      expect([...parsed.keys()].length).toBeLessThanOrEqual(4);
      if (entry.moduleId === "overview") {
        expect(parsed.has("module")).toBe(false);
        expect(href.includes("module=")).toBe(false);
      } else {
        expect(parsed.get("module")).toBe(entry.moduleId);
      }
      for (const key of ["video_id", "issue", "reason"] as const) {
        const original = entry.query[key];
        if (original) {
          expect(parsed.get(key)).toBe(original);
        }
      }
    }
  });

  // Property 8: 정규_링크 멱등성
  // Validates: Requirements 6.11
  test("applying canonical href generation twice is a no-op", () => {
    for (const entry of cases) {
      const first = buildCanonicalAdminHrefFromSearchParams(
        searchParamsFromCase(entry.moduleId, {
          ...entry.query,
          view: "submissions",
          extra: "drop-me",
        }),
      );
      const second = buildCanonicalAdminHrefFromSearchParams(
        searchParamsFromHref(first),
      );
      expect(second).toBe(first);
    }
  });
});
