import { isRecord } from './normalize-evaluation-record';
import { buildPipelinePreviewHash, PIPELINE_CONTROL_CONFIRMATION_TEXT, PIPELINE_LIVE_ENQUEUE_CONFIRMATION, type PipelineRunAction } from './pipeline-control';

export type PipelineActionInput = { action: PipelineRunAction; target: string; profile: 'heavy_local' | 'lite_gha'; runId?: string; live?: boolean };
export type PipelineActionPreview = PipelineActionInput & { dryRun: boolean; correlationId: string; idempotencyKey: string; previewHash: string; operationId: string; revision: string; expiresAt: number };

/** Bind the server ticket to the exact displayed action, before asking for confirmation. */
export function parsePipelineActionPreview(value: unknown, input: PipelineActionInput, identity: { correlationId: string; idempotencyKey: string }, now = Date.now()): PipelineActionPreview {
  const dryRun = input.action === 'enqueue' ? !input.live : true;
  const expected = buildPipelinePreviewHash({ ...input, dryRun });
  if (!isRecord(value) || value.phase !== 'preview' || value.requiredConfirmation !== true || value.previewHash !== expected || typeof value.operationId !== 'string' || value.operationId.length < 1 || value.operationId.length > 4096 || typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/.test(value.revision) || typeof value.expiresAt !== 'string') throw new Error('pipeline_preview_invalid');
  const expiresAt = Date.parse(value.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error('pipeline_preview_expired');
  return { ...input, ...identity, dryRun, previewHash: expected, operationId: value.operationId, revision: value.revision, expiresAt };
}

export function pipelineApplyBody(preview: PipelineActionPreview, confirmationText: string, liveConfirmationText: string, now = Date.now()): Record<string, unknown> {
  if (preview.expiresAt <= now) throw new Error('pipeline_preview_expired');
  if (confirmationText !== PIPELINE_CONTROL_CONFIRMATION_TEXT || (preview.action === 'enqueue' && !preview.dryRun && liveConfirmationText !== PIPELINE_LIVE_ENQUEUE_CONFIRMATION)) throw new Error('pipeline_confirmation_required');
  return { phase: 'apply', action: preview.action, target: preview.target, profile: preview.profile,
    confirmationText, previewHash: preview.previewHash, operationId: preview.operationId, revision: preview.revision,
    correlationId: preview.correlationId, idempotencyKey: preview.idempotencyKey,
    ...(preview.runId ? { runId: preview.runId } : {}),
    ...(preview.action === 'enqueue' ? { dryRun: preview.dryRun, ...(!preview.dryRun ? { liveConfirmationText } : {}) } : {}),
  };
}
