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
