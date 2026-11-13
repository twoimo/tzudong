import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildAdminDashboardOpsChartData } from "../lib/admin/dashboard-ops-chart-data";

const read = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf8");

describe("admin console dashboard overhaul source contract", () => {
  test("uses actual ztd charts for time series, scatter, KPI sparks and rank bars", () => {
    const source = read("components/admin/AdminConsoleOverview.tsx");
    const adapters = read("components/admin/dashboard/AdminDashboardCharts.tsx");
    expect(source).not.toMatch(/from ["']recharts["']|<ResponsiveContainer\b|<(?:AreaChart|LineChart|ScatterChart|BarChart)\s/);
    expect(adapters).toContain('from "ztd-charts"');
    expect(adapters).toContain("<LineChart");
    expect(adapters).toContain("<BubbleChart");
    expect(adapters).toContain("<AreaChart");
    expect(adapters).toContain("<BarChart");
    expect(adapters).toContain("buildAdminDashboardOpsChartData(section.rows)");
    expect(source).toContain("data-admin-dashboard-ops-summary-visual=\"ztd-bars\"");
  });

  test("keeps the overview compact and removes redundant chromatic KPI bars", () => {
    const source = read("components/admin/AdminConsoleOverview.tsx");
    const kpiCard = source.slice(
      source.indexOf("function AdminDashboardKpiCard("),
      source.indexOf("function AdminDashboardOpsSummaryCard("),
    );

    expect(source).toContain("lg:grid-rows-[auto_auto_auto] lg:content-start");
    expect(source).not.toMatch(/(?:-?(?:m(?:t|b|l|r|x|y)?|p(?:t|b|l|r|x|y)?|gap(?:-x|-y)?|space-x|space-y))-(?:0\.5|1\.5|2\.5)\b/);
    expect(kpiCard).toContain("grid-rows-[auto_minmax(0,1fr)]");
    expect(kpiCard).toContain("truncate whitespace-nowrap text-xs");
    expect(kpiCard).not.toContain("toneClass.bar");
    expect(kpiCard).not.toContain("safeProgress");
    expect(kpiCard).not.toContain("data-admin-dashboard-progress");
    expect(source).not.toContain("progress={getDashboardChangeProgress");
    expect(source).toContain("text-muted-foreground outline-none focus-visible:ring-2");
  });

  test("keeps unavailable operations values out of numeric chart data while preserving known zero", () => {
    const result = buildAdminDashboardOpsChartData([
      { label: "대기 큐", value: "확인 불가", rawValue: null },
      { label: "완료 큐", value: "0건", rawValue: 0 },
      { label: "오류 수", value: "확인 불가" },
    ]);

    expect(result.data).toEqual([
      { label: "완료 큐", value: 0, rawValue: 0, displayValue: "0건" },
    ]);
    expect(result.unavailableLabels).toEqual(["대기 큐", "오류 수"]);
  });

  test("shows operations counts only from existing pending, collection and Sentry reads", () => {
    const source = read("components/admin/AdminConsoleOverview.tsx");
    expect(source).toContain('fetch("/api/admin/sentry?status=unresolved"');
    expect(source).toContain("fetchAdminYouTubeKpiCollectionLogs");
    expect(source).toContain("stats.pendingTotal");
    expect(source).toContain('data-admin-operations-overview="true"');
    expect(source).toContain('"조회 실패"');
    expect(source).toContain('"확인 불가"');
  });
});
