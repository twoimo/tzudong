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
import { parseGithubWorkflowState, parseOperationsSnapshot } from "../lib/admin/operations-view-model";
import { canControlPipelineJob, parsePipelineStatus } from "../lib/admin/pipeline-flow-view-model";

const root = process.cwd();
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_RUN_ID = "33333333-3333-4333-8333-333333333333";

function source(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

// Execute the actual GET and read helpers with closed-over transports/auth/env;
// no module mocks, operator credentials, job API or GitHub requests are involved.
const pipelineRoute = source("app/api/admin/pipeline/route.ts");
const getSource = pipelineRoute.slice(pipelineRoute.indexOf("function noStore("), pipelineRoute.indexOf("function previewTicketSecret("))
  + pipelineRoute.slice(pipelineRoute.indexOf("async function pipelineFetch("), pipelineRoute.indexOf("export async function POST("))
    .replace("export async function GET", "async function GET");
const createPipelineGet = new Function("fetch", "requireAdmin", "process", "NextResponse", "PIPELINE_API_BASE", "PIPELINE_UPSTREAM_TIMEOUT_MS",
  "allowlistedGauges", "allowlistedFailureFrames", "parseGithubWorkflowState",
  new Bun.Transpiler({ loader: "ts" }).transformSync(`${getSource}\nreturn GET;`)) as (...args: unknown[]) => () => Promise<Response>;

function githubGetFixture(run: unknown, denial?: number, githubStatus = 200, payloadOverride?: unknown) {
  const requests: Array<{ url: string; method: string }> = [];
  const get = createPipelineGet(async (input: string, init: RequestInit = {}) => {
    const url = String(input);
    requests.push({ url, method: init.method ?? "GET" });
    if (url === "https://pipeline.fixture/v1/targets") return new Response("unavailable", { status: 503 });
    expect(url).toBe("https://api.github.com/repos/synthetic/repo/actions/workflows/daily-crawler.yml/runs?per_page=1&branch=main");
    expect(init.headers).not.toHaveProperty("Authorization");
    expect(init.headers).toHaveProperty("X-GitHub-Api-Version", "2026-03-10");
    return Response.json(payloadOverride === undefined ? { workflow_runs: run === undefined ? [] : [run] } : payloadOverride, { status: githubStatus });
  }, async () => denial ? { ok: false, response: Response.json({ error: "Forbidden" }, { status: denial }) } : { ok: true },
  { env: { GITHUB_REPOSITORY: "synthetic/repo" } }, { json: Response.json }, "https://pipeline.fixture", 1000,
  () => ({}), () => [], parseGithubWorkflowState);
  return { get, requests };
}

describe("GitHub pipeline fallback GET semantics", () => {
  test("preserves each completed conclusion and only emits confirmed failure frames", async () => {
    for (const conclusion of ["success", "failure", "cancelled", "skipped", "neutral", "timed_out", "action_required", "stale", "startup_failure"]) {
      const failed = ["failure", "timed_out", "startup_failure"].includes(conclusion);
      const fixture = githubGetFixture({ id: 123, status: "completed", conclusion, display_title: "private-title", html_url: "https://private.example", diagnostics: "private-diagnostics" });
      const response = await fixture.get();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const data = await response.json();
      expect(data.source).toBe("github_actions");
      expect(data.githubRun).toEqual({ id: "123", status: "completed", conclusion });
      expect(data.jobs[0].status).toBe(failed ? "Failed" : conclusion === "success" ? "Succeeded" : conclusion === "cancelled" ? "Cancelled" : "Unknown");
      expect(data.jobs[0].error_code).toBe(failed ? "github_crawler" : null);
      expect(data.jobs[0]).not.toHaveProperty("dry_run");
      expect(data.jobs[0]).not.toHaveProperty("adapter_index");
      expect(data.failures).toHaveLength(failed ? 1 : 0);
      expect(data.failureFrames).toEqual(data.failures);
      expect(JSON.stringify(data)).not.toContain("private-");
      const operations = parseOperationsSnapshot("pipeline", data);
      expect(operations.state).toBe("limited");
      expect(operations.rows[0].metrics.map(metric => metric.value)).toEqual([Number(failed), null, null, null]);
      const pipeline = parsePipelineStatus(data);
      for (const action of ["pause", "resume", "cancel"] as const) expect(canControlPipelineJob(pipeline.source, pipeline.jobs[0], action)).toBe(false);
      expect(fixture.requests.map(request => request.method)).toEqual(["GET", "GET"]);
    }
  });

  test("running and waiting states survive GET without becoming failures or asserted live-mode jobs", async () => {
    for (const status of ["in_progress", "queued", "requested", "waiting", "pending", "expected"]) {
      const fixture = githubGetFixture({ id: 123, status, conclusion: null });
      const data = await (await fixture.get()).json();
      expect(data.githubRun).toEqual({ id: "123", status, conclusion: null });
      expect(data.jobs[0].status).toBe(status === "in_progress" ? "Fetching" : status === "expected" ? "Unknown" : "Queued");
      expect(data.failures).toEqual([]);
      expect(data.failureFrames).toEqual([]);
      expect(parseOperationsSnapshot("pipeline", data).rows[0].metrics.map(metric => metric.value)).toEqual([0, null, null, null]);
    }
  });

  test("malformed and contradictory states remain unknown after the complete DTO round trip", async () => {
    for (const state of [{}, { status: "completed", conclusion: null }, { status: "in_progress" },
      { status: "future-private-status", conclusion: "failure" }, { status: "completed", conclusion: "private-diagnostics" },
      { status: "completed", conclusion: {} }, { status: "queued", conclusion: "failure" },
      { status: "in_progress", conclusion: "success" }]) {
      const fixture = githubGetFixture({ id: 123, ...state });
      const data = await (await fixture.get()).json();
      expect(data.jobs[0].status).toBe("Unknown");
      expect(data.failures).toEqual([]);
      expect(data.failureFrames).toEqual([]);
      const result = parseOperationsSnapshot("pipeline", data);
      expect(result.state).toBe("partial");
      expect(result.rows[0].metrics.map(metric => metric.value)).toEqual([null, null, null, null]);
      expect(JSON.stringify(data)).not.toContain("private-");
    }
  });

  test("admin denial makes no request; missing or invalid run IDs and upstream errors stay unavailable", async () => {
    for (const status of [401, 403]) {
      const fixture = githubGetFixture({ id: 123, status: "completed", conclusion: "success" }, status);
      const response = await fixture.get();
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(fixture.requests).toEqual([]);
    }
    for (const run of [undefined, null, {}, ...[0, -1, 1.2, "123", 9007199254740992].map(id => ({ id, status: "completed", conclusion: "success" }))]) {
      const response = await githubGetFixture(run).get();
      expect(response.status).toBe(502);
      expect(await response.json()).toEqual({ error: "pipeline_status_unavailable" });
    }
    expect((await githubGetFixture({ id: 123, status: "completed", conclusion: "success" }, undefined, 503).get()).status).toBe(502);
    for (const payload of [null, {}, { workflow_runs: null }, { workflow_runs: { 0: { id: 123, status: "completed", conclusion: "failure" } } }]) {
      expect((await githubGetFixture(undefined, undefined, 200, payload).get()).status).toBe(502);
    }
  });

  test("uses split repository configuration and recovers a public read from a rejected token", async () => {
    for (const denial of [401, 403, 404]) {
      const requests: Array<{ url: string; authorization: string | null }> = [];
      const get = createPipelineGet(async (input: string, init: RequestInit = {}) => {
        const url = String(input);
        const headers = init.headers as Record<string, string> | undefined;
        requests.push({ url, authorization: headers?.Authorization ?? null });
        if (url === "https://pipeline.fixture/v1/targets") {
          return new Response("unavailable", { status: 503 });
        }
        expect(url).toBe("https://api.github.com/repos/twoimo/tzudong/actions/workflows/daily-crawler.yml/runs?per_page=1&branch=main");
        expect(headers).toHaveProperty("X-GitHub-Api-Version", "2026-03-10");
        if (headers?.Authorization) {
          return Response.json({ message: "fixed-denial" }, { status: denial });
        }
        return Response.json({ workflow_runs: [{ id: 523, status: "completed", conclusion: "success" }] });
      }, async () => ({ ok: true }), {
        env: {
          GITHUB_OWNER: "twoimo",
          GITHUB_REPO: "tzudong",
          GITHUB_TOKEN: "fixture-token",
        },
      }, { json: Response.json }, "https://pipeline.fixture", 1000,
      () => ({}), () => [], parseGithubWorkflowState);

      const response = await get();
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        source: "github_actions",
        githubRun: { id: "523", status: "completed", conclusion: "success" },
      });
      expect(requests).toEqual([
        { url: "https://pipeline.fixture/v1/targets", authorization: null },
        {
          url: "https://api.github.com/repos/twoimo/tzudong/actions/workflows/daily-crawler.yml/runs?per_page=1&branch=main",
          authorization: "Bearer fixture-token",
        },
        {
          url: "https://api.github.com/repos/twoimo/tzudong/actions/workflows/daily-crawler.yml/runs?per_page=1&branch=main",
          authorization: null,
        },
      ]);
    }
  });
});

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
    expect(route).toContain("sealPreviewTicket");
    expect(route).toContain("openPreviewTicket");
    expect(route).toContain("createHmac");
    expect(route).toContain("timingSafeEqual");
    expect(route).toContain("previewTicketSecret");
    expect(route).toContain("pipeline_preview_secret_missing");
    expect(route).not.toContain("previewTicketKey");
    expect(route).not.toContain(".update(PIPELINE_API_BASE");
    expect(route).toContain("const body = await response.text()");
    expect(route).not.toContain("previewTickets");
    expect(route).not.toContain("new Map<string, PreviewTicket>");
    const applySuccess = route.slice(route.indexOf("const job = allowlistedPipelineJob"));
    expect(applySuccess).toContain("accepted: true");
    expect(applySuccess).toContain("} catch {");
    expect(applySuccess).not.toContain("throw readbackError");
    expect(applySuccess.slice(0, applySuccess.indexOf("accepted: true"))).not.toContain(
      "pipeline_upstream_timeout",
    );
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

  test("dashboard keeps controls behind action eligibility and explicit ticket confirmation", () => {
    const dashboard = source("components/admin/pipeline/AdminPipelineDashboard.tsx");
    expect(dashboard).toContain("canControlPipelineJob(snapshot?.source, job, action)");
    for (const selector of ["data-admin-pipeline-jobs", "data-admin-pipeline-job", "data-admin-pipeline-enqueue", "data-pipeline-preview", "data-pipeline-apply"]) expect(dashboard).toContain(selector);
    expect(source("lib/admin/pipeline-action-preview.ts")).toContain("idempotencyKey: preview.idempotencyKey");
    expect(dashboard).not.toContain("payload.error");
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

  test("502 bodies are error-only and unavailable snapshots cannot feed current metrics", () => {
    const route = source("app/api/admin/pipeline/route.ts");
    const dashboard = source("components/admin/pipeline/AdminPipelineDashboard.tsx");
    expect(route).toContain('noStore({ error: "pipeline_status_unavailable" }');
    expect(route).toContain("readGithubCrawlerSnapshot");
    expect(route).toContain('source: "github_actions"');
    expect(route).toContain('source: "job_api"');
    expect(dashboard).toContain("query.isError ? undefined : query.data");
    expect(dashboard).toContain("manifestQuery.isError ? undefined : manifestQuery.data");
    expect(dashboard).toContain("pipelineJobsForDisplay(snapshot, manifest)");
  });
});
