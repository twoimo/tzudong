import { describe, expect, test } from "bun:test";

import {
  DEFAULT_ADMIN_DASHBOARD_WIDGET_ORDER,
  ADMIN_DASHBOARD_DIAGNOSIS_WIDGET_ID,
  normalizeAdminDashboardWidgetId,
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
      "videos",
      "subscribers",
      "views",
      "likes",
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
      "topContent",
      "engagementRate",
    ]);
  });

  test("keeps diagnosis as a semantic alias for the legacy engagementRate widget id", () => {
    expect(ADMIN_DASHBOARD_DIAGNOSIS_WIDGET_ID).toBe("engagementRate");
    expect(normalizeAdminDashboardWidgetId("diagnosis")).toBe("engagementRate");
    expect(
      normalizeAdminDashboardWidgetOrder(["diagnosis", "engagementRate"]).slice(
        0,
        3,
      ),
    ).toEqual(["engagementRate", "subscribers", "views"]);
  });
});
