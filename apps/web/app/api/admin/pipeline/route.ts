import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

import {
  PIPELINE_API_BASE,
  PIPELINE_PREVIEW_TTL_MS,
  PIPELINE_UPSTREAM_TIMEOUT_MS,
  allowlistedFailureFrames,
  allowlistedGauges,
  allowlistedPipelineJob,
  assertPipelineGuardedBody,
  buildPipelinePreviewHash,
  parsePipelinePreviewBody,
  pipelineGuardStatus,
  snapshotRevision,
} from "@/lib/admin/pipeline-control";
import { getAdminSafeErrorName } from "@/lib/admin/guarded-mutation-contract";
import { requireAdmin } from "@/lib/auth/require-admin";
import { readBoundedJsonRequest } from "@/lib/security/bounded-json-request";
import { isTrustedSameOriginMutation } from "@/lib/security/same-origin-mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PreviewTicket = {
  previewHash: string;
  revision: string;
  expiresAt: number;
  action: string;
  target: string;
  profile: string;
  runId?: string;
  dryRun: boolean;
};

function noStore(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function previewTicketKey(): Buffer {
  const explicit =
    process.env.PIPELINE_PREVIEW_TICKET_SECRET?.trim() ||
    process.env.PRIVACY_ONBOARDING_COOKIE_SECRET?.trim() ||
    process.env.PRIVACY_AUDIT_HASH_KEY?.trim() ||
    "";
  if (Buffer.byteLength(explicit, "utf8") >= 32) {
    return Buffer.from(explicit, "utf8");
  }
  return createHash("sha256")
    .update("tzudong:pipeline-preview-ticket:v1\n", "utf8")
    .update(PIPELINE_API_BASE, "utf8")
    .digest();
}

function sealPreviewTicket(ticket: PreviewTicket): string {
  const encoded = Buffer.from(JSON.stringify(ticket), "utf8").toString("base64url");
  const signature = createHmac("sha256", previewTicketKey())
    .update(`tzudong:pipeline-preview:v1:${encoded}`, "utf8")
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function openPreviewTicket(token: string): PreviewTicket | null {
  const separator = token.indexOf(".");
  if (separator <= 0 || token.indexOf(".", separator + 1) !== -1) {
    return null;
  }
  const encoded = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  const expected = createHmac("sha256", previewTicketKey())
    .update(`tzudong:pipeline-preview:v1:${encoded}`, "utf8")
    .digest("base64url");
  const left = Buffer.from(signature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (
      typeof parsed.previewHash !== "string" ||
      typeof parsed.revision !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      !Number.isFinite(parsed.expiresAt) ||
      typeof parsed.action !== "string" ||
      typeof parsed.target !== "string" ||
      typeof parsed.profile !== "string" ||
      typeof parsed.dryRun !== "boolean"
    ) {
      return null;
    }
    const runIdRaw = parsed.runId;
    const runId =
      runIdRaw === undefined || runIdRaw === null || runIdRaw === ""
        ? undefined
        : String(runIdRaw);
    return {
      previewHash: parsed.previewHash,
      revision: parsed.revision,
      expiresAt: parsed.expiresAt,
      action: parsed.action,
      target: parsed.target,
      profile: parsed.profile,
      runId,
      dryRun: parsed.dryRun,
    };
  } catch {
    return null;
  }
}

async function pipelineFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PIPELINE_UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(`${PIPELINE_API_BASE}${path}`, {
      ...init,
      signal: controller.signal,
      cache: "no-store",
    });
    const body = await response.text();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    auth.response.headers.set("Cache-Control", "no-store");
    return auth.response;
  }
  try {
    const response = await pipelineFetch("/v1/targets", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      return noStore({ error: "pipeline_status_unavailable" }, { status: 502 });
    }
    const payload = (await response.json()) as {
      targets?: unknown;
      jobs?: unknown;
      failures?: unknown;
      gauges?: unknown;
    };
    return noStore({
      targets: payload.targets ?? [],
      jobs: payload.jobs ?? [],
      failures: payload.failures ?? [],
      gauges: allowlistedGauges(payload.gauges),
      failureFrames: allowlistedFailureFrames(payload.failures),
      hardware: process.env.TZUDONG_HARDWARE_CHIP ?? "macbook_m5_max",
      dataEnv: process.env.TZUDONG_DATA_ENV ?? "local_db",
    });
  } catch (error) {
    if (isAbortError(error)) {
      return noStore({ error: "pipeline_upstream_timeout" }, { status: 504 });
    }
    return noStore(
      { error: getAdminSafeErrorName(error) },
      { status: 502 },
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireAdmin();
  if (!auth.ok) {
    auth.response.headers.set("Cache-Control", "no-store");
    return auth.response;
  }
  if (!isTrustedSameOriginMutation(request)) {
    return noStore({ error: "Forbidden" }, { status: 403 });
  }
  const bounded = await readBoundedJsonRequest(request, 16 * 1024);
  if (!bounded.ok) {
    return noStore({ error: "invalid_pipeline_request" }, { status: 400 });
  }
  const body = (bounded.value ?? {}) as Record<string, unknown>;
  const phase = body.phase === "preview" ? "preview" : "apply";

  if (phase === "preview") {
    let preview;
    try {
      preview = parsePipelinePreviewBody(body);
    } catch (error) {
      return noStore({ error: getAdminSafeErrorName(error) }, { status: 400 });
    }
    try {
      const snapshotResponse = await pipelineFetch("/v1/targets", {
        headers: { Accept: "application/json" },
      });
      if (!snapshotResponse.ok) {
        return noStore({ error: "pipeline_status_unavailable" }, { status: 502 });
      }
      const snapshot = (await snapshotResponse.json()) as {
        targets?: unknown;
        jobs?: unknown;
      };
      const previewHash = buildPipelinePreviewHash({
        action: preview.action,
        target: preview.target,
        profile: preview.profile,
        runId: preview.runId,
        dryRun: preview.dryRun,
      });
      const revision = snapshotRevision(snapshot);
      const expiresAt = Date.now() + PIPELINE_PREVIEW_TTL_MS;
      const operationId = sealPreviewTicket({
        previewHash,
        revision,
        expiresAt,
        action: preview.action,
        target: preview.target,
        profile: preview.profile,
        runId: preview.runId,
        dryRun: preview.dryRun,
      });
      return noStore({
        phase: "preview",
        operationId,
        previewHash,
        revision,
        expiresAt: new Date(expiresAt).toISOString(),
        requiredConfirmation: true,
      });
    } catch (error) {
      if (isAbortError(error)) {
        return noStore({ error: "pipeline_upstream_timeout" }, { status: 504 });
      }
      return noStore({ error: getAdminSafeErrorName(error) }, { status: 502 });
    }
  }

  let normalized;
  try {
    normalized = assertPipelineGuardedBody(body);
  } catch (error) {
    return noStore(
      { error: getAdminSafeErrorName(error) },
      { status: pipelineGuardStatus(error) },
    );
  }

  const operationId = String(body.operationId ?? "");
  const ticket = openPreviewTicket(operationId);
  if (
    !ticket ||
    ticket.previewHash !== normalized.previewHash ||
    ticket.action !== normalized.action ||
    ticket.target !== normalized.target ||
    ticket.profile !== normalized.profile ||
    ticket.dryRun !== normalized.dryRun ||
    (ticket.runId ?? "") !== (normalized.runId ?? "")
  ) {
    return noStore({ error: "pipeline_preview_stale" }, { status: 409 });
  }
  if (ticket.expiresAt <= Date.now()) {
    return noStore({ error: "pipeline_preview_expired" }, { status: 409 });
  }

  const isEnqueue = normalized.action === "enqueue";
  const path = isEnqueue
    ? "/v1/runs"
    : `/v1/runs/${normalized.runId}/${normalized.action}`;
  try {
    const snapshotResponse = await pipelineFetch("/v1/targets", {
      headers: { Accept: "application/json" },
    });
    if (!snapshotResponse.ok) {
      return noStore({ error: "pipeline_status_unavailable" }, { status: 502 });
    }
    const snapshot = (await snapshotResponse.json()) as {
      targets?: unknown;
      jobs?: unknown;
    };
    if (snapshotRevision(snapshot) !== ticket.revision) {
      return noStore({ error: "pipeline_preview_stale" }, { status: 409 });
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
      "Idempotency-Key": normalized.idempotencyKey,
      "X-Request-Id": normalized.correlationId,
      "X-Actor": auth.userId ?? "admin",
    };
    const init: RequestInit = {
      method: "POST",
      headers,
    };
    if (isEnqueue) {
      headers["Content-Type"] = "application/json";
      init.body = JSON.stringify({
        target: normalized.target,
        profile: normalized.profile,
        dryRun: normalized.dryRun,
      });
    }
    const response = await pipelineFetch(path, init);
    const payload = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (response.status < 200 || response.status >= 300) {
      return noStore(
        { error: payload.error ?? (response.status === 409 ? "conflict" : "pipeline_write_failed") },
        { status: response.status === 409 ? 409 : response.status },
      );
    }
    const job = allowlistedPipelineJob(payload);
    const runId = String(job.id ?? normalized.runId ?? "");
    let readback: Record<string, unknown> = job;
    if (runId) {
      try {
        const readbackResponse = await pipelineFetch(`/v1/runs/${runId}`, {
          headers: { Accept: "application/json" },
        });
        if (readbackResponse.ok) {
          const readbackPayload = (await readbackResponse.json().catch(() => ({}))) as Record<
            string,
            unknown
          >;
          readback = allowlistedPipelineJob(readbackPayload);
        }
      } catch {
        // Apply already succeeded; degraded readback must not fail the mutation.
      }
    }
    return noStore(
      {
        accepted: true,
        job,
        readback,
        audit: "pipeline_control.audit",
      },
      { status: response.status === 202 ? 202 : response.status },
    );
  } catch (error) {
    if (isAbortError(error)) {
      return noStore({ error: "pipeline_upstream_timeout" }, { status: 504 });
    }
    return noStore({ error: getAdminSafeErrorName(error) }, { status: 502 });
  }
}
