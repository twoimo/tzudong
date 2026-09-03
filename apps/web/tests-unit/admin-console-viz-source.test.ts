import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  CONSOLE_VIZ_BINDINGS,
  CONSOLE_VIZ_FORMS,
  CONSOLE_VIZ_UNBOUND_MENU_IDS,
  getConsoleVizBindings,
} from "../lib/admin/console-visualization-map";
import { CONSOLE_FIXED_MESSAGES } from "../lib/admin/console-messages";
import { REVIEW_THROUGHPUT_TARGET } from "../lib/admin/console-viz-state";

const appRoot = join(import.meta.dir, "..");
const vizDir = join(appRoot, "components/admin/viz");

const VIZ_FORM_FILES = [
  "KpiSparklineCard.tsx",
  "SemicircleGaugeArc.tsx",
  "StageFunnel.tsx",
  "BulletBar.tsx",
  "ActivityHeatmap.tsx",
  "CompactSparklineRow.tsx",
  "TreemapTile.tsx",
  "RangeBandArea.tsx",
  "ToneStackedBar.tsx",
  "WaterfallDeltaStep.tsx",
] as const;

const HEX_RE = /#[0-9a-fA-F]{3,8}\b/;
const RGB_RE = /\brgba?\(/;
const SATURATED_HSL_RE = /hsla?\(\s*\d/;
const HUE_UTILITY_RE =
  /(?:bg|text|border|ring|from|to|via|fill|stroke)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-/;

function read(relativePath: string) {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

function collectVizSources() {
  return readdirSync(vizDir)
    .filter((name) => name.endsWith(".ts") || name.endsWith(".tsx"))
    .map((name) => ({ name, source: read(`components/admin/viz/${name}`) }));
}

describe("admin console visualization source contracts", () => {
  test("keeps the 11 bindings and 10 form components without hue literals", () => {
    expect(CONSOLE_VIZ_BINDINGS).toHaveLength(11);
    expect(CONSOLE_VIZ_FORMS).toHaveLength(10);
    expect(CONSOLE_VIZ_UNBOUND_MENU_IDS).toHaveLength(6);
    for (const menuId of CONSOLE_VIZ_UNBOUND_MENU_IDS) {
      expect(getConsoleVizBindings(menuId)).toEqual([]);
    }

    const formsSource = read("components/admin/viz/console-viz-forms.tsx");
    for (const form of CONSOLE_VIZ_FORMS) {
      expect(formsSource).toContain(`"${form}"`);
    }
    for (const file of VIZ_FORM_FILES) {
      expect(read(`components/admin/viz/${file}`).length).toBeGreaterThan(0);
    }

    expect(REVIEW_THROUGHPUT_TARGET.approved).toBe(false);
    const stateSource = read("lib/admin/console-viz-state.ts");
    expect(stateSource).toContain("approved: false");
    expect(stateSource).not.toMatch(
      /REVIEW_THROUGHPUT_TARGET[\s\S]{0,80}value:\s*\d/,
    );

    const cardSource = read("components/admin/viz/ConsoleVizCard.tsx");
    expect(cardSource).toContain('aria-hidden="true"');
    expect(cardSource).toContain('data-admin-viz-shape="true"');
    expect(cardSource).toContain("borderRadius: \"var(--admin-card-radius)\"");
    expect(cardSource).toContain("ConsoleCardMetaRow");
    expect(cardSource).toContain("CONSOLE_FIXED_MESSAGES.vizEmpty");
    expect(cardSource).toContain("CONSOLE_FIXED_MESSAGES.vizFailed");
    expect(cardSource).toContain("CONSOLE_FIXED_MESSAGES.vizInsufficient");
    expect(CONSOLE_FIXED_MESSAGES.reviewTargetUnapproved.length).toBeGreaterThan(0);

    const bulletSource = read("components/admin/viz/BulletBar.tsx");
    expect(bulletSource).toContain("target.approved === true");
    expect(bulletSource).toContain("ReferenceLine");
    expect(bulletSource).toContain("CONSOLE_FIXED_MESSAGES.reviewTargetUnapproved");
    expect(bulletSource).toContain("getBarEndRadius");

    const hookSource = read("hooks/use-console-tone-scale.ts");
    expect(hookSource).toContain("getComputedStyle");
    expect(hookSource).toContain("MutationObserver");
    expect(hookSource).toContain('data-admin-console-tone-scale="v1"');

    const cssSource = read("app/globals.css");
    expect(cssSource).toContain('[data-admin-console-tone-scale="v1"]');
    expect(cssSource).toContain("--admin-tone-1: hsl(var(--foreground));");
    expect(cssSource).toContain("--admin-status-error: hsl(var(--destructive));");

    for (const { name, source } of collectVizSources()) {
      expect({ name, hex: HEX_RE.test(source) }).toEqual({ name, hex: false });
      expect({ name, rgb: RGB_RE.test(source) }).toEqual({ name, rgb: false });
      expect({ name, hsl: SATURATED_HSL_RE.test(source) }).toEqual({
        name,
        hsl: false,
      });
      expect({ name, hue: HUE_UTILITY_RE.test(source) }).toEqual({
        name,
        hue: false,
      });
    }
  });

  test("replaces overview chart series colors with the tone-scale hook", () => {
    const overviewSource = read("components/admin/AdminConsoleOverview.tsx");
    expect(overviewSource).toContain("useConsoleToneScale");
    expect(overviewSource).toContain("useAdminDashboardFocusPalette");
    expect(overviewSource).toContain("CONSOLE_CHART_GRID_COLOR");
    expect(overviewSource).toContain("CONSOLE_CHART_AXIS_COLOR");
    expect(overviewSource).toContain('data-admin-console-tone-scale="v1"');
    expect(overviewSource).toContain("strokeLinecap=\"round\"");
    expect(overviewSource).toContain("strokeLinejoin=\"round\"");
    expect(overviewSource).toContain("rounded-[var(--admin-card-radius)]");
    expect(overviewSource).toContain("<AdminConsoleOverviewVisualizations");
    expect(overviewSource).not.toContain("#14b8a6");
    expect(overviewSource).not.toContain("#5eead4");
    expect(overviewSource).not.toContain("#99f6e4");
    expect(overviewSource).not.toContain("#38a5db");
    expect(overviewSource).not.toContain("#94a3b8");
    expect(overviewSource).not.toContain("#64748b");
    expect(overviewSource).not.toContain("#f59e0b");
    expect(overviewSource).not.toContain("#f43f5e");
    expect(overviewSource).not.toContain("#cbd5e1");
    expect(overviewSource).not.toContain("#e2e8f0");
  });

  test("keeps insights video-level charts off the KPI dashboard and out of pending-count reads", () => {
    const insightsVizSource = read(
      "components/admin/console/AdminInsightsVisualizations.tsx",
    );
    const overviewVizSource = read(
      "components/admin/console/AdminConsoleOverviewVisualizations.tsx",
    );
    const registrySource = read(
      "components/admin/console/module-panel-registry.tsx",
    );
    const routesDashboardSource = read(
      "components/admin/AdminOverviewDashboard.tsx",
    );

    expect(insightsVizSource).toContain('getConsoleVizBindings("insights")');
    expect(insightsVizSource).toContain('item.form === "treemap-tile"');
    expect(insightsVizSource).toContain('item.form === "range-band-area"');
    expect(insightsVizSource).toContain("/api/admin/youtube-kpis");
    expect(insightsVizSource).toContain("video.title");
    expect(insightsVizSource).toContain("previousViewCount");
    expect(insightsVizSource).toContain("viewCount");
    expect(insightsVizSource).not.toContain("/api/admin/pending-counts");
    expect(insightsVizSource).not.toContain("pendingRestaurantSubmissions");
    expect(insightsVizSource).not.toContain("맛집 제보");
    expect(insightsVizSource).not.toContain("추천 요청");

    expect(overviewVizSource).toContain('label: "조회수"');
    expect(overviewVizSource).toContain('label: "좋아요"');
    expect(overviewVizSource).toContain('label: "댓글"');
    expect(overviewVizSource).toContain('label: "맛집 제보"');
    expect(overviewVizSource).toContain('label: "추천 요청"');
    expect(overviewVizSource).toContain('label: "리뷰"');
    expect(overviewVizSource).not.toContain("video.title");
    expect(overviewVizSource).not.toContain("previousViewCount");
    expect(overviewVizSource).not.toContain("treemap-tile");
    expect(overviewVizSource).not.toContain("range-band-area");

    expect(registrySource).toContain("<AdminInsightsVisualizations");
    expect(routesDashboardSource).not.toContain("/api/admin/pending-counts");
    expect(routesDashboardSource).not.toContain("getConsoleVizBindings");
  });
});
