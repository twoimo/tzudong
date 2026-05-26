import { describe, expect, test } from "bun:test";

import {
  DEFAULT_ADMIN_DASHBOARD_WIDGET_ORDER,
  normalizeAdminDashboardWidgetOrder,
} from "../lib/admin/dashboard-widget-order";

describe("admin dashboard widget order normalization", () => {
  test("keeps the KPI card default order stable", () => {
    expect(DEFAULT_ADMIN_DASHBOARD_WIDGET_ORDER).toEqual([
      "subscribers",
      "views",
      "likes",
      "comments",
      "videos",
      "impact",
      "trend",
      "ops",
      "topContent",
      "engagementRate",
    ]);
  });

  test("accepts both raw array and API-shaped stored values", () => {
    expect(
      normalizeAdminDashboardWidgetOrder({
        order: ["trend", "impact"],
      }).slice(0, 4),
    ).toEqual(["trend", "impact", "subscribers", "views"]);

    expect(normalizeAdminDashboardWidgetOrder(["ops", "videos"]).slice(0, 4)).toEqual([
      "ops",
      "videos",
      "subscribers",
      "views",
    ]);
  });

  test("drops unknown and duplicate IDs before filling missing defaults", () => {
    expect(
      normalizeAdminDashboardWidgetOrder([
        "trend",
        "missing",
        "trend",
        "views",
      ]),
    ).toEqual([
      "trend",
      "views",
      "subscribers",
      "likes",
      "comments",
      "videos",
      "impact",
      "ops",
      "topContent",
      "engagementRate",
    ]);
  });
});
