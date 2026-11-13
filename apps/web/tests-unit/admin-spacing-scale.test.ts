import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postcss from "postcss";

const sheet = postcss.parse(readFileSync(resolve(import.meta.dir, "../styles/admin-ui.css"), "utf8"));
const spacingProperty = /^(?:padding|margin)(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?$|^(?:gap|row-gap|column-gap)$/;

describe("administrator spacing scale", () => {
  test("active console feature layouts do not reintroduce half-step spacing utilities", () => {
    const surfaces = [
      "app/admin/banners/page.tsx", "app/admin/evaluations/page.tsx", "app/admin/privacy-incidents/page.tsx",
      "app/insights/insights-client.tsx", "components/admin/AdminConsoleOverview.tsx",
      "components/admin/AdminKnowledgeGraphPanel.tsx", "components/admin/AdminOperationsPanel.tsx",
      "components/admin/AdminRestaurantRefreshHistoryPanel.tsx", "components/admin/AdminSentryPanel.tsx",
      "components/admin/AdminUsersPanel.tsx", "components/admin/RestaurantManagementWorkspace.tsx",
      "components/admin/pipeline/AdminPipelineDashboard.tsx", "components/admin/AdminOverviewDashboard.tsx",
      "components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator.tsx",
      "components/admin/storyboard/LocalStoryboardWorkspace.tsx",
    ];
    const offGrid = /(?<![A-Za-z0-9_-])(?:p[xytrbl]?|m[xytrbl]?|gap(?:-[xy])?|space-[xy])-(?:0\.5|1\.5|2\.5|3\.5)(?![A-Za-z0-9_.-])/g;
    for (const file of surfaces) {
      const content = readFileSync(resolve(import.meta.dir, "..", file), "utf8");
      expect([...content.matchAll(offGrid)].map(match => match[0]), file).toEqual([]);
    }
  });

  test("all explicit shared margins, padding and gaps follow a four-pixel grid", () => {
    const offGrid: string[] = [];
    let checked = 0;
    sheet.walkDecls(declaration => {
      if (!spacingProperty.test(declaration.prop)) return;
      for (const match of declaration.value.matchAll(/(-?\d*\.?\d+)(rem|px)\b/g)) {
        const pixels = Number(match[1]) * (match[2] === "rem" ? 16 : 1);
        checked++;
        if (Math.abs(pixels % 4) > 0.001) offGrid.push(`${declaration.source?.start?.line}: ${declaration.prop}: ${declaration.value}`);
      }
    });
    expect(checked).toBeGreaterThan(50);
    expect(offGrid).toEqual([]);
  });

  test("admin space tokens themselves are coherent, not an unrelated token list", () => {
    const tokens = new Map<string, string>();
    sheet.walkDecls(/^--admin-space-/, declaration => { tokens.set(declaration.prop, declaration.value); });
    expect(tokens.size).toBe(7);
    for (const [name, value] of tokens) {
      const step = Number(name.split("-").at(-1));
      expect(value).toBe(`${step * 4}px`);
    }
    const uses = new Set<string>();
    sheet.walkDecls(declaration => {
      for (const match of declaration.value.matchAll(/var\((--admin-space-\d+)\)/g)) uses.add(match[1]);
    });
    expect(uses.has("--admin-space-2")).toBe(true);
    expect(uses.has("--admin-space-3")).toBe(true);
    expect(uses.has("--admin-space-5")).toBe(true);
  });
});
