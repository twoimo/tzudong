import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  PIPELINE_CONTROL_CONFIRMATION_TEXT,
  assertPipelineGuardedBody,
  buildPipelinePreviewHash,
} from "../lib/admin/pipeline-control";
import { GUARDED_MUTATION_CONFIRMATION } from "../lib/admin/guarded-mutation-contract";

const root = process.cwd();

function source(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

describe("admin pipeline control contract", () => {
  test("preview hash binds action/target/profile and confirmation matches guarded steps", () => {
    const previewHash = buildPipelinePreviewHash({
      action: "enqueue",
      target: "tzuyang",
      profile: "heavy_local",
    });
    const body = assertPipelineGuardedBody({
      action: "enqueue",
      target: "tzuyang",
      profile: "heavy_local",
      confirmationText: PIPELINE_CONTROL_CONFIRMATION_TEXT,
      previewHash,
      correlationId: "11111111-1111-4111-8111-111111111111",
      idempotencyKey: "idemkey01",
    });
    expect(body.previewHash).toHaveLength(64);
    expect(PIPELINE_CONTROL_CONFIRMATION_TEXT).toBe(GUARDED_MUTATION_CONFIRMATION);
    expect(() =>
      assertPipelineGuardedBody({
        ...body,
        previewHash: "0".repeat(64),
      }),
    ).toThrow("preview_hash_mismatch");
  });

  test("BFF forwards Idempotency-Key and never embeds Grafana iframe", () => {
    const route = source("app/api/admin/pipeline/route.ts");
    const dashboard = source("components/admin/pipeline/AdminPipelineDashboard.tsx");
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");
    expect(route).toContain('"Idempotency-Key": normalized.idempotencyKey');
    expect(route).toContain("isTrustedSameOriginMutation");
    expect(route).toContain("requireAdmin");
    expect(route).toContain("Cache-Control");
    expect(route).toContain("dryRun: true");
    expect(dashboard).not.toContain("<iframe");
    expect(dashboard).toContain("Grafana iframe은 CSP/auth gate 전까지 금지");
    expect(consoleSource).not.toContain(
      'import("@/components/admin/system-status/AdminSystemStatusCenter")',
    );
    expect(consoleSource).toContain('id: "pipeline"');
    expect(consoleSource).toContain("AdminPipelineDashboard");
  });

  test("source test forbids Grafana iframe until CSP gate", () => {
    const dashboard = source("components/admin/pipeline/AdminPipelineDashboard.tsx");
    expect(dashboard).not.toContain("<iframe");
    expect(dashboard).not.toContain("kafka-ui");
    expect(dashboard).not.toContain("Grafana embed");
  });

  test("BFF forwards SoT jobs/failures and does not hardcode empty failures", () => {
    const route = source("app/api/admin/pipeline/route.ts");
    expect(route).not.toContain("failures: []");
    expect(route).toContain("payload.failures");
    expect(route).toContain("payload.jobs");
  });

  test("dashboard renders error_code and keeps empty-state copy", () => {
    const dashboard = source("components/admin/pipeline/AdminPipelineDashboard.tsx");
    expect(dashboard).toContain("error_code");
    expect(dashboard).toContain("최근 실패 없음");
  });

  test("502 bodies are error-only and query.isError gates empty failures", () => {
    const route = source("app/api/admin/pipeline/route.ts");
    const dashboard = source("components/admin/pipeline/AdminPipelineDashboard.tsx");
    const unavailable = route.slice(
      route.indexOf('if (!response.ok)'),
      route.indexOf("const payload"),
    );
    expect(unavailable).toContain('noStore({ error: "pipeline_status_unavailable" }');
    expect(unavailable).not.toContain("failures");
    expect(unavailable).not.toContain("jobs");
    expect(unavailable).not.toContain("targets");
    const getCatch = route.slice(
      route.indexOf("} catch (error) {"),
      route.indexOf("export async function POST"),
    );
    expect(getCatch).toContain("getAdminSafeErrorName(error)");
    expect(getCatch).not.toContain("failures");
    expect(getCatch).not.toContain("jobs");
    expect(getCatch).not.toContain("targets");
    expect(dashboard).toContain("query.isError");
    const errorBranch = dashboard.indexOf("query.isError");
    const emptyState = dashboard.indexOf("최근 실패 없음");
    expect(errorBranch).toBeGreaterThan(-1);
    expect(emptyState).toBeGreaterThan(errorBranch);
  });
});
