import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  PIPELINE_CONTROL_CONFIRMATION_TEXT,
  PIPELINE_LIVE_ENQUEUE_CONFIRMATION,
  PUBLIC_LIST_KEYS,
  assertPipelineGuardedBody,
  buildPipelinePreviewHash,
} from "../lib/admin/pipeline-control";
import { GUARDED_MUTATION_CONFIRMATION } from "../lib/admin/guarded-mutation-contract";
import { sha256Hex } from "../lib/admin/sha256-hex";

const root = process.cwd();
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_RUN_ID = "33333333-3333-4333-8333-333333333333";

function source(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function enqueueBody(overrides: Record<string, unknown> = {}) {
  const dryRun =
    overrides.dryRun === undefined ? true : Boolean(overrides.dryRun);
  const previewHash =
    typeof overrides.previewHash === "string"
      ? overrides.previewHash
      : buildPipelinePreviewHash({
          action: "enqueue",
          target: "tzuyang",
          profile: "heavy_local",
          dryRun,
        });
  return {
    action: "enqueue",
    target: "tzuyang",
    profile: "heavy_local",
    confirmationText: PIPELINE_CONTROL_CONFIRMATION_TEXT,
    previewHash,
    correlationId: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "idemkey01",
    ...overrides,
  };
}

function controlBody(
  action: "pause" | "resume" | "cancel",
  overrides: Record<string, unknown> = {},
) {
  const runId = String(overrides.runId ?? RUN_ID);
  const previewHash =
    typeof overrides.previewHash === "string"
      ? overrides.previewHash
      : buildPipelinePreviewHash({
          action,
          target: "tzuyang",
          profile: "heavy_local",
          runId,
        });
  return {
    action,
    target: "tzuyang",
    profile: "heavy_local",
    confirmationText: PIPELINE_CONTROL_CONFIRMATION_TEXT,
    previewHash,
    correlationId: "11111111-1111-4111-8111-111111111111",
    idempotencyKey: "idemkey01",
    runId,
    ...overrides,
  };
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
    expect(body.dryRun).toBe(true);
    expect(PIPELINE_CONTROL_CONFIRMATION_TEXT).toBe(GUARDED_MUTATION_CONFIRMATION);
    expect(() =>
      assertPipelineGuardedBody({
        ...body,
        previewHash: "0".repeat(64),
      }),
    ).toThrow("preview_hash_mismatch");
  });

  test("pause/resume/cancel require UUID runId and enqueue rejects runId", () => {
    for (const action of ["pause", "resume", "cancel"] as const) {
      expect(() => assertPipelineGuardedBody(controlBody(action, { runId: "" }))).toThrow(
        "invalid_pipeline_run_id",
      );
      expect(() =>
        assertPipelineGuardedBody(controlBody(action, { runId: "not-a-uuid" })),
      ).toThrow("invalid_pipeline_run_id");
      const ok = assertPipelineGuardedBody(controlBody(action));
      expect(ok.runId).toBe(RUN_ID);
      expect(ok.action).toBe(action);
    }
    expect(() =>
      assertPipelineGuardedBody(enqueueBody({ runId: RUN_ID })),
    ).toThrow("invalid_pipeline_run_id");
  });

  test("previewHash changes with runId and dryRun and keeps enqueue hash shape", () => {
    const pauseA = buildPipelinePreviewHash({
      action: "pause",
      target: "tzuyang",
      profile: "heavy_local",
      runId: RUN_ID,
    });
    const pauseB = buildPipelinePreviewHash({
      action: "pause",
      target: "tzuyang",
      profile: "heavy_local",
      runId: OTHER_RUN_ID,
    });
    expect(pauseA).not.toBe(pauseB);
    const enqueueDry = buildPipelinePreviewHash({
      action: "enqueue",
      target: "tzuyang",
      profile: "heavy_local",
      dryRun: true,
    });
    const enqueueLive = buildPipelinePreviewHash({
      action: "enqueue",
      target: "tzuyang",
      profile: "heavy_local",
      dryRun: false,
    });
    expect(enqueueDry).not.toBe(enqueueLive);
    const enqueueDefault = buildPipelinePreviewHash({
      action: "enqueue",
      target: "tzuyang",
      profile: "heavy_local",
    });
    expect(enqueueDefault).toBe(enqueueDry);
    const controlWithProfile = buildPipelinePreviewHash({
      action: "pause",
      target: "tzuyang",
      profile: "lite_gha",
      runId: RUN_ID,
    });
    expect(controlWithProfile).not.toBe(pauseA);
  });

  test("preview hash uses browser-safe SHA-256 that matches node:crypto", () => {
    const abc = sha256Hex("abc");
    expect(abc).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(abc).toBe(createHash("sha256").update("abc", "utf8").digest("hex"));
    const payload = JSON.stringify({
      action: "enqueue",
      target: "tzuyang",
      profile: "heavy_local",
      dryRun: true,
    });
    expect(sha256Hex(payload)).toBe(createHash("sha256").update(payload, "utf8").digest("hex"));
    expect(buildPipelinePreviewHash({
      action: "enqueue",
      target: "tzuyang",
      profile: "heavy_local",
    })).toBe(sha256Hex(payload));
  });

  test("pipeline client helpers do not import node:crypto", () => {
    expect(source("lib/admin/pipeline-control.ts")).not.toContain("node:crypto");
    expect(source("lib/admin/sha256-hex.ts")).not.toContain("node:crypto");
    expect(source("components/admin/pipeline/AdminPipelineDashboard.tsx")).not.toContain("node:crypto");
  });

  test("dryRun defaults true and live requires LIVE_ENQUEUE", () => {
    const omitted = assertPipelineGuardedBody(enqueueBody());
    expect(omitted.dryRun).toBe(true);
    expect(() =>
      assertPipelineGuardedBody(enqueueBody({ dryRun: false })),
    ).toThrow("invalid_pipeline_live_confirmation");
    expect(() =>
      assertPipelineGuardedBody(
        enqueueBody({
          dryRun: false,
          liveConfirmationText: GUARDED_MUTATION_CONFIRMATION,
        }),
      ),
    ).toThrow("invalid_pipeline_live_confirmation");
    const live = assertPipelineGuardedBody(
      enqueueBody({
        dryRun: false,
        liveConfirmationText: PIPELINE_LIVE_ENQUEUE_CONFIRMATION,
      }),
    );
    expect(live.dryRun).toBe(false);
  });

  test("BFF forwards Idempotency-Key and dashboard gates loopback Grafana iframe", () => {
    const route = source("app/api/admin/pipeline/route.ts");
    const dashboard = source("components/admin/pipeline/AdminPipelineDashboard.tsx");
    const consoleSource = source("components/admin/AdminConsoleOverview.tsx");
    const proxySource = source("proxy.ts");
    const nextConfig = source("next.config.mjs");
    expect(route).toContain('"Idempotency-Key": normalized.idempotencyKey');
    expect(route).toContain("isTrustedSameOriginMutation");
    expect(route).toContain("requireAdmin");
    expect(route).toContain("Cache-Control");
    expect(route).toContain("X-Actor");
    expect(route).toContain("dryRun: normalized.dryRun");
    expect(route).not.toContain("TZUDONG_PIPELINE_LIVE");
    expect(route).not.toContain("dryRun: false");
    expect(route).not.toContain("dryRun false");
    expect(route).toContain("normalized.runId");
    expect(route).not.toContain("bounded.value.runId");
    expect(route).toContain('phase === "preview"');
    expect(route).toContain("pipeline_preview_stale");
    expect(route).toContain("pipeline_upstream_timeout");
    expect(route).toContain("readback");
    expect(route).toContain("audit");
    expect(route).not.toContain("3001");
    expect(route).not.toContain("grafana");
    expect(route).not.toContain("iframe");
    expect(route).not.toContain("prometheus");
    expect(route).not.toContain("elasticsearch");
    expect(route).not.toContain("kafka-ui");
    expect(dashboard).toContain("<iframe");
    expect(dashboard).toContain('data-admin-pipeline-grafana="true"');
    expect(dashboard).toContain("http://127.0.0.1:3001/d/tzudong-pipeline-frozen-counters");
    expect(dashboard).toContain('hostname === "127.0.0.1"');
    expect(dashboard).toContain('process.env.NODE_ENV !== "production"');
    expect(dashboard).not.toContain("process.env.VERCEL");
    expect(dashboard).not.toContain("http://localhost");
    expect(dashboard).not.toContain("kafka-ui");
    expect(dashboard).not.toContain(":8088");
    expect(dashboard).toContain("2_000");
    expect(proxySource).toContain("http://127.0.0.1:3001");
    expect(proxySource).toContain("process.env.NODE_ENV !== 'production'");
    expect(proxySource).toContain("process.env.VERCEL !== '1'");
    expect(proxySource).toContain("frame-ancestors 'none'");
    expect(nextConfig).toContain("{ key: 'X-Frame-Options', value: 'DENY' }");
    expect(nextConfig).not.toContain("3001");
    expect(nextConfig).not.toContain("grafana");
    expect(consoleSource).not.toContain(
      'import("@/components/admin/system-status/AdminSystemStatusCenter")',
    );
    expect(consoleSource).toContain('id: "pipeline"');
    expect(consoleSource).toContain("AdminPipelineDashboard");
  });

  test("POST echo path allowlists PUBLIC_LIST_KEYS and forbids public_run secrets", () => {
    const route = source("app/api/admin/pipeline/route.ts");
    const control = source("lib/admin/pipeline-control.ts");
    const post = route.slice(route.indexOf("export async function POST"));
    expect(control).toContain("PUBLIC_LIST_KEYS");
    expect(post).toContain("allowlistedPipelineJob");
    for (const key of [
      "actor",
      "payload_hash",
      "idempotency_key",
      "request_id",
      "lease_until",
      "heartbeat_at",
    ]) {
      expect(post).not.toContain(key);
    }
    expect(PUBLIC_LIST_KEYS).toEqual([
      "id",
      "target",
      "profile",
      "status",
      "error_code",
      "dry_run",
      "adapter_index",
    ]);
  });

  test("source test requires gated Grafana iframe after CSP gate", () => {
    const dashboard = source("components/admin/pipeline/AdminPipelineDashboard.tsx");
    expect(dashboard).toContain("<iframe");
    expect(dashboard).toContain("http://127.0.0.1:3001/d/tzudong-pipeline-frozen-counters");
    expect(dashboard).not.toContain("kafka-ui");
    expect(dashboard).not.toContain("Grafana embed");
  });

  test("BFF forwards SoT jobs/failures and does not hardcode empty failures", () => {
    const route = source("app/api/admin/pipeline/route.ts");
    expect(route).not.toContain("failures: []");
    expect(route).toContain("payload.failures");
    expect(route).toContain("payload.jobs");
  });

  test("dashboard renders jobs controls error_code and keeps empty-state copy", () => {
    const dashboard = source("components/admin/pipeline/AdminPipelineDashboard.tsx");
    expect(dashboard).toContain("error_code");
    expect(dashboard).toContain("최근 실패 없음");
    expect(dashboard).toContain("data-admin-pipeline-jobs");
    expect(dashboard).toContain("data-admin-pipeline-job");
    expect(dashboard).toContain("data-admin-pipeline-pause");
    expect(dashboard).toContain("data-admin-pipeline-resume");
    expect(dashboard).toContain("data-admin-pipeline-cancel");
    expect(dashboard).toContain("data-admin-pipeline-enqueue");
    expect(dashboard).toContain("state already changed, refreshed");
  });

  test("proxy production frame-src omits loopback Grafana and keeps frame-ancestors none", () => {
    const proxySource = source("proxy.ts");
    const frameSrcAssign = proxySource.slice(
      proxySource.indexOf("const loopbackGrafanaFrameSrc"),
      proxySource.indexOf("`frame-src 'self' https://www.youtube.com"),
    );
    expect(frameSrcAssign).toContain("process.env.NODE_ENV !== 'production'");
    expect(frameSrcAssign).toContain("process.env.VERCEL !== '1'");
    expect(frameSrcAssign).toContain("' http://127.0.0.1:3001'");
    expect(frameSrcAssign).toContain(": ''");
    expect(proxySource).toContain("frame-ancestors 'none'");
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
