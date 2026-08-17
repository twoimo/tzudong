import { describe, expect, test } from "bun:test";

import {
  DEFAULT_ADMIN_SIDEBAR_ORDER,
  normalizeAdminSidebarOrder,
} from "../lib/admin/sidebar-order";
import { ADMIN_CONSOLE_MODULE_IDS } from "../lib/admin/admin-module-routing";

describe("admin sidebar order normalization", () => {
  test("keeps server and client defaults stable for review and operations sections", () => {
    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.items["검수"]).toEqual([
      "restaurants",
      "restaurant-refresh-history",
      "submissions",
      "reviews",
    ]);

    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.items["운영"]).toEqual([
      "map-overlays",
      "users",
      "banners",
      "insights",
      "pipeline",
    ]);

    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.items["실험실"]).toEqual([
      "youtube-thumbnail-generator",
      "storyboard",
      "routes",
      "llm",
      "audit",
    ]);
  });

  test("covers every routed admin module without tying route id order to sidebar IA order", () => {
    const sidebarModuleIds = new Set(
      Object.values(DEFAULT_ADMIN_SIDEBAR_ORDER.items).flat(),
    );

    expect([...sidebarModuleIds].sort()).toEqual(
      [...ADMIN_CONSOLE_MODULE_IDS].sort(),
    );
    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.items["실험실"]).toEqual([
      "youtube-thumbnail-generator",
      "storyboard",
      "routes",
      "llm",
      "audit",
    ]);
    expect(ADMIN_CONSOLE_MODULE_IDS.slice(0, 3)).toEqual([
      "overview",
      "routes",
      "map-overlays",
    ]);
  });

  test("resets old saved section slots when modules move between operations and lab", () => {
    const normalized = normalizeAdminSidebarOrder({
      sections: ["홈", "검수", "운영", "실험실"],
      items: {
        홈: ["overview"],
        검수: ["restaurants", "submissions", "reviews"],
        운영: ["storyboard", "banners", "users", "insights"],
        실험실: ["audit", "llm"],
      },
    });

    expect(normalized.items["검수"]).toEqual([
      "restaurants",
      "restaurant-refresh-history",
      "submissions",
      "reviews",
    ]);

    expect(normalized.items["운영"]).toEqual([
      "map-overlays",
      "users",
      "banners",
      "insights",
      "pipeline",
    ]);

    expect(normalized.items["실험실"]).toEqual([
      "youtube-thumbnail-generator",
      "storyboard",
      "routes",
      "llm",
      "audit",
    ]);
  });

  test("preserves a valid custom order while filling only missing defaults", () => {
    const normalized = normalizeAdminSidebarOrder({
      sections: ["운영", "홈"],
      items: {
        운영: ["banners", "users"],
        홈: ["overview"],
      },
    });

    expect(normalized.sections).toEqual(["운영", "홈", "검수", "실험실"]);
    expect(normalized.items["검수"]).toEqual([
      "restaurants",
      "restaurant-refresh-history",
      "submissions",
      "reviews",
    ]);

    expect(normalized.items["운영"]).toEqual([
      "map-overlays",
      "banners",
      "users",
      "insights",
      "pipeline",
    ]);
  });
});
