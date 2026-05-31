import { describe, expect, test } from "bun:test";

import {
  DEFAULT_ADMIN_SIDEBAR_ORDER,
  normalizeAdminSidebarOrder,
} from "../lib/admin/sidebar-order";

describe("admin sidebar order normalization", () => {
  test("keeps server and client defaults stable for review and operations sections", () => {
    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.items["검수"]).toEqual([
      "restaurants",
      "restaurant-refresh-history",
      "submissions",
      "reviews",
    ]);

    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.items["운영"]).toEqual([
      "routes",
      "storyboard",
      "banners",
      "users",
      "insights",
    ]);

    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.items["실험실"]).toEqual([
      "audit",
      "youtube-thumbnail-generator",
      "llm",
    ]);
  });

  test("inserts newly known default items at their default slot on old saved orders", () => {
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
      "routes",
      "storyboard",
      "banners",
      "users",
      "insights",
    ]);

    expect(normalized.items["실험실"]).toEqual([
      "audit",
      "youtube-thumbnail-generator",
      "llm",
    ]);
  });

  test("preserves a valid custom order while filling only missing defaults", () => {
    const normalized = normalizeAdminSidebarOrder({
      sections: ["운영", "홈"],
      items: {
        운영: ["banners", "storyboard"],
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
      "routes",
      "banners",
      "storyboard",
      "users",
      "insights",
    ]);
  });
});
