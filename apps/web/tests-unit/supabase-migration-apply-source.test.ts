import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const repoRoot = join(root, "../..");

function source(path: string) {
  return readFileSync(join(repoRoot, path), "utf8");
}

describe("supabase migration apply workflow source contract", () => {
  test("uses direct Postgres first and keeps the management migrations fallback explicit", () => {
    const script = source("apps/web/scripts/apply-supabase-migration.mjs");
    expect(script).toContain("/database/migrations");
    expect(script).toContain("SUPABASE_DB_URL");
    expect(script).toContain("psql");
    expect(script).toContain("SUPABASE_ACCESS_TOKEN");
    expect(script).toContain("SUPABASE_PROJECT_REF");
    expect(script).toContain("restVerifyTable");
    expect(script).not.toContain("console.log(accessToken");
  });

  test("workflow applies only the selected migration and verifies the refresh table", () => {
    const workflow = source(".github/workflows/supabase-migration-apply.yml");
    expect(workflow).toContain("workflow_dispatch");
    expect(workflow).toContain("20260531105250_restaurant_refresh_history.sql");
    expect(workflow).toContain("--verify-table restaurant_refresh_candidates");
    expect(workflow).toContain("secrets.SUPABASE_DB_URL");
    expect(workflow).toContain("postgresql-client");
    expect(workflow).toContain("secrets.SUPABASE_ACCESS_TOKEN");
  });
});
