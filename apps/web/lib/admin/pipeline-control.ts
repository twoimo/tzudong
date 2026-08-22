import { GUARDED_MUTATION_CONFIRMATION } from "@/lib/admin/guarded-mutation-contract";
import { sha256Hex } from "@/lib/admin/sha256-hex";

export const PIPELINE_CONTROL_CONFIRMATION_TEXT = GUARDED_MUTATION_CONFIRMATION;
export const PIPELINE_LIVE_ENQUEUE_CONFIRMATION = "LIVE_ENQUEUE";
export const PIPELINE_API_BASE =
  process.env.PIPELINE_CONTROL_API_URL?.trim() || "http://127.0.0.1:8091";

export const PUBLIC_LIST_KEYS = [
  "id",
  "target",
  "profile",
  "status",
  "error_code",
  "dry_run",
  "adapter_index",
] as const;

export type PipelineListKey = (typeof PUBLIC_LIST_KEYS)[number];
export type PipelineRunAction = "enqueue" | "pause" | "resume" | "cancel";
export type PipelineListJob = {
  id: string;
  target: string;
  profile: string;
  status: string;
  error_code?: string | null;
  dry_run?: boolean;
  adapter_index?: number;
};

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function isIdempotencyKey(value: string): boolean {
  return value.length >= 8 && value.length <= 128;
}

export function pickPipelineListJob(value: Record<string, unknown>): PipelineListJob {
  return {
    id: String(value.id ?? ""),
    target: String(value.target ?? ""),
    profile: String(value.profile ?? ""),
    status: String(value.status ?? ""),
    error_code: value.error_code == null ? null : String(value.error_code),
    dry_run: Boolean(value.dry_run),
    adapter_index:
      typeof value.adapter_index === "number"
        ? value.adapter_index
        : Number(value.adapter_index ?? 0),
  };
}

export function allowlistedPipelineJob(
  value: Record<string, unknown>,
): Record<PipelineListKey, unknown> {
  const job = {} as Record<PipelineListKey, unknown>;
  for (const key of PUBLIC_LIST_KEYS) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      job[key] = value[key];
    }
  }
  return job;
}

export function buildPipelinePreviewHash(input: {
  action: PipelineRunAction;
  target: string;
  profile: "heavy_local" | "lite_gha";
  runId?: string;
  dryRun?: boolean;
}): string {
  const payload: Record<string, unknown> = {
    action: input.action,
    target: input.target,
    profile: input.profile,
  };
  if (input.action === "enqueue") {
    payload.dryRun = input.dryRun ?? true;
  } else {
    payload.runId = input.runId;
  }
  return sha256Hex(JSON.stringify(payload));
}

export function assertPipelineGuardedBody(body: Record<string, unknown>): {
  action: PipelineRunAction;
  target: string;
  profile: "heavy_local" | "lite_gha";
  confirmationText: string;
  previewHash: string;
  correlationId: string;
  idempotencyKey: string;
  runId?: string;
  dryRun: boolean;
} {
  const action = String(body.action ?? "");
  const target = String(body.target ?? "");
  const profile = String(body.profile ?? "heavy_local");
  const confirmationText = String(body.confirmationText ?? "");
  const previewHash = String(body.previewHash ?? "");
  const correlationId = String(body.correlationId ?? "");
  const idempotencyKey = String(body.idempotencyKey ?? "");
  const runIdRaw = body.runId;
  const runId =
    runIdRaw === undefined || runIdRaw === null || runIdRaw === ""
      ? undefined
      : String(runIdRaw);
  if (!["enqueue", "pause", "resume", "cancel"].includes(action)) {
    throw new Error("invalid_pipeline_action");
  }
  if (!target) throw new Error("invalid_pipeline_target");
  if (profile !== "heavy_local" && profile !== "lite_gha") {
    throw new Error("invalid_pipeline_profile");
  }
  if (confirmationText !== PIPELINE_CONTROL_CONFIRMATION_TEXT) {
    throw new Error("invalid_pipeline_confirmation");
  }
  if (!/^[a-f0-9]{64}$/.test(previewHash)) {
    throw new Error("invalid_pipeline_preview_hash");
  }
  if (!isUuid(correlationId)) throw new Error("invalid_pipeline_correlation");
  if (!isIdempotencyKey(idempotencyKey)) {
    throw new Error("invalid_pipeline_idempotency");
  }

  let dryRun = true;
  if (action === "enqueue") {
    if (runId !== undefined) throw new Error("invalid_pipeline_run_id");
    const liveConfirmationText = String(body.liveConfirmationText ?? "");
    const requestedLive = body.dryRun === false;
    if (requestedLive) {
      if (liveConfirmationText !== PIPELINE_LIVE_ENQUEUE_CONFIRMATION) {
        throw new Error("invalid_pipeline_live_confirmation");
      }
      dryRun = false;
    }
  } else {
    if (!runId || !isUuid(runId)) throw new Error("invalid_pipeline_run_id");
  }

  const expected = buildPipelinePreviewHash({
    action: action as PipelineRunAction,
    target,
    profile,
    runId,
    dryRun,
  });
  if (expected !== previewHash) throw new Error("preview_hash_mismatch");
  return {
    action: action as PipelineRunAction,
    target,
    profile,
    confirmationText,
    previewHash,
    correlationId,
    idempotencyKey,
    runId,
    dryRun,
  };
}


export const PIPELINE_UPSTREAM_TIMEOUT_MS = 8_000;
export const PIPELINE_PREVIEW_TTL_MS = 60_000;
export const PIPELINE_FAILURE_FRAME_CAP = 20;

export const PIPELINE_GAUGE_KEYS = [
  "tzudong_pipeline_queue_depth",
  "tzudong_pipeline_queue_age_seconds",
  "tzudong_pipeline_active_jobs",
  "tzudong_pipeline_kafka_lag",
  "tzudong_pipeline_es_rows_per_sec",
  "tzudong_pipeline_process_cpu_ratio",
  "tzudong_pipeline_process_rss_bytes",
] as const;

export type PipelineGaugeKey = (typeof PIPELINE_GAUGE_KEYS)[number];

export type PipelineFailureFrame = {
  errorCode: string;
  module: string | null;
  function: string | null;
  line: string | null;
};

const SAFE_FRAME_TOKEN = /^[A-Za-z_][A-Za-z0-9_.]{0,63}$/;
const SAFE_FRAME_LINE = /^[0-9]{1,6}$/;

function allowlistedFrameToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return SAFE_FRAME_TOKEN.test(value) ? value : null;
}

export function snapshotRevision(input: {
  targets?: unknown;
  jobs?: unknown;
}): string {
  const targets = Array.isArray(input.targets) ? input.targets : [];
  const jobs = Array.isArray(input.jobs) ? input.jobs : [];
  return sha256Hex(
    JSON.stringify({
      targets: targets.map((row) => {
        const item = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
        return { id: String(item.id ?? ""), status: String(item.status ?? "") };
      }),
      jobs: jobs.map((row) => {
        const item = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
        return { id: String(item.id ?? ""), status: String(item.status ?? "") };
      }),
    }),
  );
}

export function allowlistedGauges(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const source = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  for (const key of PIPELINE_GAUGE_KEYS) {
    const numeric = source[key];
    if (typeof numeric === "number" && Number.isFinite(numeric)) {
      out[key] = numeric;
    }
  }
  return out;
}

export function allowlistedFailureFrames(value: unknown): PipelineFailureFrame[] {
  const rows = Array.isArray(value) ? value : [];
  const frames: PipelineFailureFrame[] = [];
  for (const row of rows.slice(0, PIPELINE_FAILURE_FRAME_CAP)) {
    const item = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const errorCodeRaw = item.errorCode ?? item.error_code ?? "failed";
    const errorCode =
      typeof errorCodeRaw === "string" && SAFE_FRAME_TOKEN.test(errorCodeRaw)
        ? errorCodeRaw
        : "failed";
    const lineRaw = item.line;
    frames.push({
      errorCode,
      module: allowlistedFrameToken(item.module),
      function: allowlistedFrameToken(item.function),
      line:
        typeof lineRaw === "number" && Number.isInteger(lineRaw) && lineRaw >= 1 && lineRaw <= 999999
          ? String(lineRaw)
          : typeof lineRaw === "string" && SAFE_FRAME_LINE.test(lineRaw)
            ? lineRaw
            : null,
    });
  }
  return frames;
}

export function parsePipelinePreviewBody(body: Record<string, unknown>): {
  action: PipelineRunAction;
  target: string;
  profile: "heavy_local" | "lite_gha";
  correlationId: string;
  idempotencyKey: string;
  runId?: string;
  dryRun: boolean;
} {
  const action = String(body.action ?? "");
  const target = String(body.target ?? "");
  const profile = String(body.profile ?? "");
  const correlationId = String(body.correlationId ?? "");
  const idempotencyKey = String(body.idempotencyKey ?? "");
  const runIdRaw = body.runId;
  const runId =
    runIdRaw === undefined || runIdRaw === null || runIdRaw === ""
      ? undefined
      : String(runIdRaw);
  if (!["enqueue", "pause", "resume", "cancel"].includes(action)) {
    throw new Error("invalid_pipeline_action");
  }
  if (!target) throw new Error("invalid_pipeline_target");
  if (profile !== "heavy_local" && profile !== "lite_gha") {
    throw new Error("invalid_pipeline_profile");
  }
  if (!isUuid(correlationId)) throw new Error("invalid_pipeline_correlation");
  if (!isIdempotencyKey(idempotencyKey)) {
    throw new Error("invalid_pipeline_idempotency");
  }
  let dryRun = true;
  if (action === "enqueue") {
    if (runId !== undefined) throw new Error("invalid_pipeline_run_id");
    dryRun = body.dryRun !== false;
  } else if (!runId || !isUuid(runId)) {
    throw new Error("invalid_pipeline_run_id");
  }
  return {
    action: action as PipelineRunAction,
    target,
    profile,
    correlationId,
    idempotencyKey,
    runId,
    dryRun,
  };
}

export function pipelineGuardStatus(error: unknown): number {
  const message = error instanceof Error ? error.message : "";
  if (
    message === "preview_hash_mismatch" ||
    message === "pipeline_preview_stale" ||
    message === "pipeline_preview_expired"
  ) {
    return 409;
  }
  return 400;
}
