import { describe, expect, test } from "bun:test";

import {
  ADMIN_CONSOLE_MENU_IDS,
  ADMIN_CONSOLE_MENUS,
  ADMIN_CONSOLE_SECTION_LABELS,
  getAdminConsoleMenuIdsBySection,
} from "../lib/admin/console-menu-registry";
import {
  ADMIN_SIDEBAR_ITEM_IDS,
  ADMIN_SIDEBAR_SECTIONS,
  DEFAULT_ADMIN_SIDEBAR_ORDER,
  normalizeAdminSidebarOrder,
  normalizeAdminSidebarOrderWithReason,
} from "../lib/admin/sidebar-order";
import { ADMIN_CONSOLE_MODULE_IDS } from "../lib/admin/admin-module-routing";
import { generateSidebarOrderCases } from "./helpers/deterministic-generator";

function orderedDefaultItems() {
  return Object.fromEntries(
    ADMIN_CONSOLE_SECTION_LABELS.map((section) => [
      section,
      [...getAdminConsoleMenuIdsBySection(section)],
    ]),
  );
}

describe("admin sidebar order normalization", () => {
  test("derives review, operations, and content-production slots from the registry", () => {
    expect(ADMIN_SIDEBAR_SECTIONS).toEqual(["판단", "검수", "운영", "콘텐츠 제작"]);
    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.sections).toEqual([...ADMIN_CONSOLE_SECTION_LABELS]);
    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.items["판단"]).toEqual([
      "overview",
      "insights",
      "llm",
    ]);
    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.items["검수"]).toEqual([
      "restaurants",
      "restaurant-refresh-history",
      "submissions",
      "reviews",
    ]);
    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.items["운영"]).toEqual([
      "map-overlays",
      "banners",
      "routes",
      "users",
      "pipeline",
      "audit",
    ]);
    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.items["콘텐츠 제작"]).toEqual([
      "storyboard",
      "youtube-thumbnail-generator",
    ]);
    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.items["운영"]).toHaveLength(6);
    expect(DEFAULT_ADMIN_SIDEBAR_ORDER.items["콘텐츠 제작"]).toHaveLength(2);
  });

  test("covers every routed admin module in registry order", () => {
    const sidebarModuleIds = new Set(
      Object.values(DEFAULT_ADMIN_SIDEBAR_ORDER.items).flat(),
    );

    expect([...sidebarModuleIds]).toEqual([...ADMIN_CONSOLE_MENU_IDS]);
    expect([...ADMIN_SIDEBAR_ITEM_IDS]).toEqual([...ADMIN_CONSOLE_MENU_IDS]);
    expect([...ADMIN_CONSOLE_MODULE_IDS]).toEqual([...ADMIN_CONSOLE_MENU_IDS]);
    expect(ADMIN_CONSOLE_MODULE_IDS.slice(0, 3)).toEqual([
      "overview",
      "insights",
      "llm",
    ]);
    expect(ADMIN_SIDEBAR_SECTIONS).toEqual(ADMIN_CONSOLE_SECTION_LABELS);
  });

  test("resets saved orders that still use retired section names", () => {
    const normalized = normalizeAdminSidebarOrderWithReason({
      sections: ["홈", "검수", "운영", "실험실"],
      items: {
        홈: ["overview"],
        검수: ["restaurants", "submissions", "reviews"],
        운영: ["storyboard", "banners", "users", "insights"],
        실험실: ["audit", "llm"],
      },
    });

    expect(normalized.revertedReason).toBe("retired-section");
    expect(normalized.order).toEqual(DEFAULT_ADMIN_SIDEBAR_ORDER);
    expect(normalized.order.items).toEqual(orderedDefaultItems());
  });

  test("resets saved orders that place moved menus under another current section", () => {
    const normalized = normalizeAdminSidebarOrderWithReason({
      sections: ["판단", "검수", "운영", "콘텐츠 제작"],
      items: {
        판단: ["overview", "llm"],
        검수: [
          "restaurants",
          "restaurant-refresh-history",
          "submissions",
          "reviews",
        ],
        운영: [
          "insights",
          "map-overlays",
          "banners",
          "routes",
          "users",
          "pipeline",
          "audit",
        ],
        "콘텐츠 제작": ["storyboard", "youtube-thumbnail-generator"],
      },
    });

    expect(normalized.revertedReason).toBe("cross-section-item");
    expect(normalized.order).toEqual(DEFAULT_ADMIN_SIDEBAR_ORDER);
  });

  test("preserves a valid custom order while filling only missing defaults", () => {
    const normalized = normalizeAdminSidebarOrder({
      sections: ["운영", "판단"],
      items: {
        운영: ["users", "banners"],
        판단: ["llm", "overview"],
      },
    });

    expect(normalized.sections).toEqual([
      "운영",
      "판단",
      "검수",
      "콘텐츠 제작",
    ]);
    expect(normalized.items["판단"]).toEqual(["llm", "overview", "insights"]);
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
      "routes",
      "pipeline",
      "audit",
    ]);
    expect(normalized.items["콘텐츠 제작"]).toEqual([
      "storyboard",
      "youtube-thumbnail-generator",
    ]);
  });
});

describe("admin sidebar order properties", () => {
  const cases = generateSidebarOrderCases(120);

  // Property 4: 순서_정규화기 멱등성
  // Validates: Requirements 7.10, 21.2
  test("normalizes any saved order to a fixed point", () => {
    expect(cases.length).toBeGreaterThanOrEqual(100);
    for (const value of cases) {
      const first = normalizeAdminSidebarOrder(value);
      const second = normalizeAdminSidebarOrder(first);
      expect(second).toEqual(first);
    }
  });

  // Property 5: 순서_정규화기 결과 불변식
  // Validates: Requirements 5.5, 5.6, 7.8, 7.9, 21.2
  test("keeps four sections and fifteen home-section menu ids", () => {
    for (const value of cases) {
      const order = normalizeAdminSidebarOrder(value);
      expect(order.sections).toHaveLength(4);
      expect(new Set(order.sections)).toEqual(new Set(ADMIN_CONSOLE_SECTION_LABELS));
      const flattened = Object.values(order.items).flat();
      expect(flattened).toHaveLength(15);
      expect(new Set(flattened)).toEqual(new Set(ADMIN_CONSOLE_MENU_IDS));
      for (const section of ADMIN_CONSOLE_SECTION_LABELS) {
        for (const itemId of order.items[section] ?? []) {
          expect(ADMIN_CONSOLE_MENUS[itemId].section).toBe(section);
        }
      }
    }
  });

  // Property 6: 폐지 섹션 및 교차 배치 전체 되돌림
  // Validates: Requirements 5.5, 5.6, 5.8, 5.11, 21.2
  test("fully reverts retired sections and cross-section placements", () => {
    const retired = normalizeAdminSidebarOrderWithReason({
      sections: ["홈", "검수", "운영", "실험실"],
      items: {
        홈: ["overview"],
        검수: ["restaurants", "submissions", "reviews"],
        운영: ["insights", "map-overlays", "users"],
        실험실: ["llm", "routes", "audit", "storyboard"],
      },
    });
    expect(retired.revertedReason).toBe("retired-section");
    expect(retired.order).toEqual(DEFAULT_ADMIN_SIDEBAR_ORDER);

    const movedMenus = normalizeAdminSidebarOrderWithReason({
      sections: ["판단", "검수", "운영", "콘텐츠 제작"],
      items: {
        판단: ["overview"],
        검수: [
          "restaurants",
          "restaurant-refresh-history",
          "submissions",
          "reviews",
        ],
        운영: ["llm", "map-overlays", "banners", "users", "pipeline", "audit"],
        "콘텐츠 제작": ["storyboard", "youtube-thumbnail-generator", "routes"],
      },
    });
    expect(movedMenus.revertedReason).toBe("cross-section-item");
    expect(movedMenus.order).toEqual(DEFAULT_ADMIN_SIDEBAR_ORDER);

    for (const value of cases) {
      const result = normalizeAdminSidebarOrderWithReason(value);
      if (result.revertedReason !== null) {
        expect(result.order).toEqual(DEFAULT_ADMIN_SIDEBAR_ORDER);
      }
    }
  });
});
