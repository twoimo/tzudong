import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

const workflow = readFileSync(
  resolve(import.meta.dir, "../../../.github/workflows/nightly-regression.yml"),
  "utf8",
);
const localRunner = readFileSync(
  resolve(import.meta.dir, "../scripts/run-nightly-regression.mjs"),
  "utf8",
);
const cleanNextSource = readFileSync(
  resolve(import.meta.dir, "../scripts/clean-next.mjs"),
  "utf8",
);
const packageManifest = JSON.parse(
  readFileSync(resolve(import.meta.dir, "../package.json"), "utf8"),
);
const runbook = readFileSync(
  resolve(import.meta.dir, "../../../docs/operations/nightly-regression.md"),
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

  test("exposes a local runner with the same fail-closed preflight", () => {
    expect(packageManifest.scripts["test:nightly"]).toBe(
      "node scripts/run-nightly-regression.mjs",
    );
    for (const name of [
      "NIGHTLY_SUPABASE_PROJECT_REF",
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      "NIGHTLY_ADMIN_EMAIL",
      "NIGHTLY_ADMIN_PASSWORD",
    ]) {
      expect(localRunner).toContain(`'${name}'`);
    }
    expect(localRunner).toContain(".env.nightly.local");
    expect(localRunner).toContain("Missing required nightly environment variable");
    expect(localRunner).toContain(
      "Nightly Supabase URL does not identify the configured isolated project.",
    );
    expect(localRunner).toContain(
      "Nightly admin identity must be a dedicated non-production account.",
    );
    expect(localRunner).toContain("--validate-only");
    expect(localRunner).toContain("NIGHTLY_LOCAL_ENV_ONLY");
    expect(localRunner).toContain("NODE_ENV: 'test'");
    expect(cleanNextSource).toContain("!nightlyLocalEnvOnly && fs.existsSync(repoEnvLocalPath)");
    expect(cleanNextSource).toContain("childEnv.NODE_ENV = nightlyLocalEnvOnly ? 'test' : 'development';");
  });

  test("keeps local execution scoped to the GitHub unit and browser commands", () => {
    expect(localRunner).toContain("runCommand('bun', ['run', 'test:unit']");
    expect(localRunner).toContain("spawn('bun', ['run', 'dev:playwright']");
    for (const spec of [
      "tests/smoke.spec.ts",
      "tests/navigation.spec.ts",
      "tests/browser-title.spec.ts",
      "tests/mobile-home-map.spec.ts",
    ]) {
      expect(localRunner).toContain(`'${spec}'`);
    }
    expect(localRunner).toContain("'--project=chromium'");
    expect(localRunner).toContain("'bunx',\n      [");
    expect(localRunner).toContain("'--reporter=line,html'");
    expect(runbook).toContain("bun run test:nightly -- --env-file .env.nightly.local");
    expect(runbook).toContain("`*.env.local`");
    expect(runbook).toContain("NODE_ENV=test");
  });
});
