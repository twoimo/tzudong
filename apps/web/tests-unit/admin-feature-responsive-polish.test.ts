import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const appRoot = resolve(import.meta.dir, "..");
const source = (file: string) => readFileSync(join(appRoot, file), "utf8");

const featureRoots = [
  "app/admin/evaluations/page.tsx",
  "app/admin/banners/page.tsx",
  "app/admin/privacy-incidents/page.tsx",
  "components/admin/AdminUsersPanel.tsx",
  "components/admin/AdminRestaurantRefreshHistoryPanel.tsx",
  "components/admin/RestaurantManagementWorkspace.tsx",
  "components/admin/AdminSentryPanel.tsx",
  "components/admin/AdminKnowledgeGraphPanel.tsx",
  "components/admin/AdminOperationsPanel.tsx",
  "components/admin/pipeline/AdminPipelineDashboard.tsx",
];

describe("admin feature responsive polish", () => {
  test("requested feature surfaces opt into the isolated polish layer", () => {
    for (const file of featureRoots) {
      const content = source(file);
      expect(content, file).toContain("AdminFeaturePolish.module.css");
      expect(content, file).toContain("featurePolish.polishedRoot");
    }
  });

  test("mobile controls, local table overflow, and compact pipeline canvas stay bounded", () => {
    const styles = source("components/admin/AdminFeaturePolish.module.css");
    const pipeline = source("components/admin/pipeline/PipelineFlowDiagram.module.css");
    expect(styles).toContain("max-width: 767px");
    expect(styles).toContain("min-height: 44px");
    expect(styles).toContain("font-size: 16px");
    expect(styles).toContain("overscroll-behavior: contain");
    expect(styles).toContain("overflow: auto");
    expect(styles).toContain("min-width: 40rem");
    expect(styles).toContain(".admin-cms-record-list.hidden");
    expect(styles).toContain("overflow-x: auto");
    expect(pipeline).toContain(".canvas { min-height: 280px; }");
    expect(pipeline).toContain("border-radius: 0;");
  });
});
