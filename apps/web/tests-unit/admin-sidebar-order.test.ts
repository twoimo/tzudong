import { describe, expect, test } from "bun:test";

import {
  ADMIN_SIDEBAR_SECTIONS,
  DEFAULT_ADMIN_SIDEBAR_ORDER,
  normalizeAdminSidebarOrder,
} from "../lib/admin/sidebar-order";
import { ADMIN_CONSOLE_MODULE_IDS } from "../lib/admin/admin-module-routing";

describe("admin sidebar order normalization", () => {
  test("groups the 15 visible capabilities by operational purpose", () => {
    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.sections).toEqual([
      "대시보드", "검수·데이터", "콘텐츠", "사이트 운영", "플랫폼 도구",
    ]);
    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.items["대시보드"]).toEqual(["overview"]);
    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.items["검수·데이터"]).toEqual([
      "restaurants", "submissions", "reviews",
    ]);
    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.items["콘텐츠"]).toEqual([
      "insights", "storyboard", "youtube-thumbnail-generator",
    ]);
    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.items["사이트 운영"]).toEqual(["users", "banners"]);
    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.items["플랫폼 도구"]).toEqual([
      "pipeline", "knowledge-graph", "sentry", "routes", "llm", "audit",
    ]);
    expect(ADMIN_SIDEBAR_SECTIONS).toHaveLength(5);
  });

  test("covers every visible route without changing route ids", () => {
    const sidebarModuleIds = new Set(Object.values(DEFAULT_ADMIN_SIDEBAR_ORDER.items).flat());
    expect(sidebarModuleIds.size).toBe(15);
    expect([...sidebarModuleIds].sort()).toEqual(
      ADMIN_CONSOLE_MODULE_IDS.filter((id) => id !== "restaurant-refresh-history").sort(),
    );
    expect(ADMIN_CONSOLE_MODULE_IDS.slice(0, 3)).toEqual(["overview", "routes", "restaurants"]);
  });

  test("migrates old section names and retains each capability's saved order", () => {
    const normalized = normalizeAdminSidebarOrder({
      sections: ["홈", "검수", "운영", "실험실"],
      items: {
        홈: ["overview"],
        검수: ["restaurants", "submissions", "reviews"],
        운영: ["banners", "users", "storyboard", "insights", "pipeline", "knowledge-graph", "sentry"],
        실험실: ["youtube-thumbnail-generator", "audit", "llm", "routes"],
      },
    });
    expect(normalized.sections).toEqual([
      "대시보드", "검수·데이터", "사이트 운영", "플랫폼 도구", "콘텐츠",
    ]);
    expect(normalized.items["사이트 운영"].slice(0, 2)).toEqual(["banners", "users"]);
    expect(normalized.items["콘텐츠"].slice(0, 3)).toEqual([
      "storyboard", "insights", "youtube-thumbnail-generator",
    ]);
    expect(normalized.items["플랫폼 도구"].slice(0, 4)).toEqual([
      "pipeline", "knowledge-graph", "sentry", "audit",
    ]);
  });

  test("preserves valid custom order and fills missing defaults", () => {
    const normalized = normalizeAdminSidebarOrder({
      sections: ["사이트 운영", "대시보드"],
      items: { "사이트 운영": ["banners", "users"], 대시보드: ["overview"] },
    });
    expect(normalized.sections).toEqual([
      "사이트 운영", "대시보드", "검수·데이터", "콘텐츠", "플랫폼 도구",
    ]);
    expect(normalized.items["사이트 운영"]).toEqual(["banners", "users"]);
  });

  test("does not introduce legacy routes from unknown preferences", () => {
    const normalized = normalizeAdminSidebarOrder({
      sections: ["unknown"],
      items: { unknown: ["privacy-incidents", "restaurant-refresh-history"] },
    });
    expect(Object.values(normalized.items).flat()).not.toContain("privacy-incidents");
    expect(Object.values(normalized.items).flat()).not.toContain("restaurant-refresh-history");
  });
});
