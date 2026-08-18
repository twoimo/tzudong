import { NextRequest, NextResponse } from "next/server";

import {
  PIPELINE_API_BASE,
  assertPipelineGuardedBody,
} from "@/lib/admin/pipeline-control";
import { getAdminSafeErrorName } from "@/lib/admin/guarded-mutation-contract";
import { requireAdmin } from "@/lib/auth/require-admin";
import { readBoundedJsonRequest } from "@/lib/security/bounded-json-request";
import { isTrustedSameOriginMutation } from "@/lib/security/same-origin-mutation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(body: unknown, init: ResponseInit = {}) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) {
    auth.response.headers.set("Cache-Control", "no-store");
    return auth.response;
  }
  try {
    const response = await fetch(`${PIPELINE_API_BASE}/v1/targets`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) {
      return noStore({ error: "pipeline_status_unavailable" }, { status: 502 });
    }
    const payload = (await response.json()) as {
      targets?: unknown;
      jobs?: unknown;
      failures?: unknown;
    };
    return noStore({
      targets: payload.targets ?? [],
      jobs: payload.jobs ?? [],
      failures: payload.failures ?? [],
      hardware: process.env.TZUDONG_HARDWARE_CHIP ?? "macbook_m5_max",
      dataEnv: process.env.TZUDONG_DATA_ENV ?? "local_db",
    });
  } catch (error) {
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
  let normalized;
  try {
    normalized = assertPipelineGuardedBody(
      (bounded.value ?? {}) as Record<string, unknown>,
    );
  } catch (error) {
    return noStore(
      { error: getAdminSafeErrorName(error) },
      { status: 400 },
    );
  }

  const path =
    normalized.action === "enqueue"
      ? "/v1/runs"
      : `/v1/runs/${String((bounded.value as { runId?: string }).runId ?? "")}/${normalized.action}`;
  try {
    const response = await fetch(`${PIPELINE_API_BASE}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "Idempotency-Key": normalized.idempotencyKey,
        "X-Request-Id": normalized.correlationId,
        "X-Actor": auth.userId ?? "admin",
      },
      body: JSON.stringify({
        target: normalized.target,
        profile: normalized.profile,
        dryRun: true,
      }),
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (response.status === 409) {
      return noStore({ error: payload.error ?? "conflict" }, { status: 409 });
    }
    return noStore(
      {
        accepted: true,
        job: payload,
        audit: "pipeline_control.audit",
      },
      { status: response.status === 202 ? 202 : response.status },
    );
  } catch (error) {
    return noStore({ error: getAdminSafeErrorName(error) }, { status: 502 });
  }
}
