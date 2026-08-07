import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const workflow = readFileSync(
  resolve(import.meta.dir, "../../../.github/workflows/nightly-regression.yml"),
  "utf8",
);

describe("nightly regression workflow contract", () => {
  test("schedules UTC runs and supports explicit manual lanes", () => {
    expect(workflow).toContain("cron: '30 18 * * *'");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("- all");
    expect(workflow).toContain("- unit");
    expect(workflow).toContain("- e2e");
  });

  test("fails closed on isolated environment and readiness", () => {
    expect(workflow).toContain("NIGHTLY_SUPABASE_PROJECT_REF");
    expect(workflow).toContain("Nightly Supabase URL does not identify the configured isolated project.");
    expect(workflow).toContain("/api/health");
    expect(workflow).toContain("Application did not become ready.");
  });

  test("keeps the browser scope curated and diagnostics available", () => {
    expect(workflow).toContain("tests/smoke.spec.ts");
    expect(workflow).toContain("tests/mobile-home-map.spec.ts");
    expect(workflow).toContain("if: always()");
    expect(workflow).toContain("nightly-playwright-diagnostics");
    expect(workflow).toContain("retention-days: 14");
  });

  test("uses least privilege and non-masking notification", () => {
    expect(workflow).toContain("contents: read");
    expect(workflow).toContain("actions: read");
    expect(workflow).toContain("Notification failed; see GitHub summary.");
  });
});
