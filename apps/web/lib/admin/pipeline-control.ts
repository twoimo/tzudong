import { createHash } from "node:crypto";

import { GUARDED_MUTATION_CONFIRMATION } from "@/lib/admin/guarded-mutation-contract";

export const PIPELINE_CONTROL_CONFIRMATION_TEXT = GUARDED_MUTATION_CONFIRMATION;
export const PIPELINE_API_BASE =
  process.env.PIPELINE_CONTROL_API_URL?.trim() || "http://127.0.0.1:8091";

export type PipelineRunAction = "enqueue" | "pause" | "resume" | "cancel";

export function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

export function isIdempotencyKey(value: string): boolean {
  return value.length >= 8 && value.length <= 128;
}

export function buildPipelinePreviewHash(input: {
  action: PipelineRunAction;
  target: string;
  profile: "heavy_local" | "lite_gha";
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        action: input.action,
        target: input.target,
        profile: input.profile,
      }),
    )
    .digest("hex");
}

export function assertPipelineGuardedBody(body: Record<string, unknown>): {
  action: PipelineRunAction;
  target: string;
  profile: "heavy_local" | "lite_gha";
  confirmationText: string;
  previewHash: string;
  correlationId: string;
  idempotencyKey: string;
} {
  const action = String(body.action ?? "");
  const target = String(body.target ?? "");
  const profile = String(body.profile ?? "heavy_local");
  const confirmationText = String(body.confirmationText ?? "");
  const previewHash = String(body.previewHash ?? "");
  const correlationId = String(body.correlationId ?? "");
  const idempotencyKey = String(body.idempotencyKey ?? "");
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
  const expected = buildPipelinePreviewHash({
    action: action as PipelineRunAction,
    target,
    profile,
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
  };
}
