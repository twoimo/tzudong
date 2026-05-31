import { describe, expect, test } from "bun:test";

import {
  DEFAULT_ADMIN_SIDEBAR_ORDER,
  normalizeAdminSidebarOrder,
} from "../lib/admin/sidebar-order";

describe("admin sidebar order normalization", () => {
  test("keeps server and client defaults stable for the operations section", () => {
    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.items["운영"]).toEqual([
      "users",
      "banners",
      "insights",
    ]);

    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.items["실험실"]).toEqual([
      "youtube-thumbnail-generator",
      "storyboard",
      "routes",
      "llm",
      "audit",
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

    expect(normalized.items["운영"]).toEqual([
      "users",
      "banners",
      "insights",
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
    expect(normalized.items["운영"]).toEqual([
      "banners",
      "users",
      "insights",
    ]);
  });
});
