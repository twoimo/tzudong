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
  });
});
