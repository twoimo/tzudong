"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  countHumanVideoReviewQueue,
  formatHostedApplyPreviewHash,
  formatPipelineJobPosition,
  HOSTED_APPLY_BFF_AVAILABLE,
  OPS_READBACK_MISSING,
} from "@/lib/admin/ops-readback";
import {
  PIPELINE_CONTROL_CONFIRMATION_TEXT,
  PIPELINE_LIVE_ENQUEUE_CONFIRMATION,
  buildPipelinePreviewHash,
  type PipelineListJob,
} from "@/lib/admin/pipeline-control";

type PipelineStatusResponse = {
  jobs?: PipelineListJob[];
};

type EvaluationListResponse = {
  records?: Array<{
    status?: string | null;
    is_missing?: boolean | null;
    is_not_selected?: boolean | null;
    geocoding_success?: boolean | null;
    evaluation_results?: {
      visit_authenticity?: { eval_value?: number | null } | null;
      rb_inference_score?: { eval_value?: number | null } | null;
      rb_grounding_TF?: { eval_value?: boolean | null } | null;
      review_faithfulness_score?: { eval_value?: number | null } | null;
      category_validity_TF?: { eval_value?: boolean | null } | null;
      category_TF?: { eval_value?: boolean | null } | null;
    } | null;
  }>;
};

async function postPipeline(body: Record<string, unknown>) {
  const response = await fetch("/api/admin/pipeline", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: string;
    previewHash?: string;
    operationId?: string;
    revision?: string;
  };
  return { ok: response.ok, status: response.status, payload };
}

export function AdminOpsReadbackStrip() {
  const queryClient = useQueryClient();
  const [confirmationText, setConfirmationText] = useState("");
  const [liveConfirmationText, setLiveConfirmationText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const pipelineQuery = useQuery({
    queryKey: ["admin-pipeline-status"],
    queryFn: async () => {
      const response = await fetch("/api/admin/pipeline", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("pipeline-status-failed");
      return (await response.json()) as PipelineStatusResponse;
    },
    staleTime: 15_000,
    retry: false,
  });

  const evaluationsQuery = useQuery({
    queryKey: ["admin-evaluations"],
    queryFn: async () => {
      const response = await fetch("/api/admin/evaluations", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("evaluations-failed");
      return (await response.json()) as EvaluationListResponse;
    },
    staleTime: 15_000,
    retry: false,
  });

  const jobPosition = pipelineQuery.isError
    ? OPS_READBACK_MISSING
    : formatPipelineJobPosition(pipelineQuery.data);
  const previewHash = formatHostedApplyPreviewHash(null);
  const reviewCount = evaluationsQuery.isError
    ? OPS_READBACK_MISSING
    : evaluationsQuery.data
      ? String(countHumanVideoReviewQueue(evaluationsQuery.data.records ?? []))
      : OPS_READBACK_MISSING;

  const startCrawl = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const correlationId = crypto.randomUUID();
      const idempotencyKey = `ops-${crypto.randomUUID()}`;
      const previewRequest = {
        phase: "preview",
        action: "enqueue",
        target: "tzuyang",
        profile: "heavy_local",
        dryRun: false,
        correlationId,
        idempotencyKey,
      };
      const preview = await postPipeline(previewRequest);
      if (!preview.ok || !preview.payload.previewHash || !preview.payload.operationId) {
        setMessage(String(preview.payload.error ?? "pipeline_write_failed"));
        return;
      }
      const expectedHash = buildPipelinePreviewHash({
        action: "enqueue",
        target: "tzuyang",
        profile: "heavy_local",
        dryRun: false,
      });
      if (expectedHash !== preview.payload.previewHash) {
        setMessage("pipeline_preview_stale");
        return;
      }
      const result = await postPipeline({
        phase: "apply",
        action: "enqueue",
        target: "tzuyang",
        profile: "heavy_local",
        dryRun: false,
        confirmationText,
        liveConfirmationText,
        previewHash: preview.payload.previewHash,
        operationId: preview.payload.operationId,
        revision: preview.payload.revision,
        correlationId,
        idempotencyKey,
      });
      await queryClient.invalidateQueries({ queryKey: ["admin-pipeline-status"] });
      if (!result.ok) {
        setMessage(String(result.payload.error ?? "pipeline_write_failed"));
        return;
      }
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "pipeline_write_failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section
      data-admin-ops-readback-strip="true"
      className="mb-3 space-y-2 rounded-xl border border-border bg-card p-3"
    >
      <div className="flex flex-wrap gap-3 text-xs">
        <span data-admin-ops-job-position="true">작업 위치: {jobPosition}</span>
        <span data-admin-ops-hosted-preview-hash="true">미리보기 지문: {previewHash}</span>
        <span data-admin-ops-human-review-count="true">승인 대기: {reviewCount}</span>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="space-y-1 text-[11px]">
          <span>확인</span>
          <input
            value={confirmationText}
            onChange={(event) => setConfirmationText(event.target.value)}
            className="block rounded border px-2 py-1"
            data-admin-ops-crawl-confirmation="true"
          />
        </label>
        <label className="space-y-1 text-[11px]">
          <span>실제 시작 확인</span>
          <input
            value={liveConfirmationText}
            onChange={(event) => setLiveConfirmationText(event.target.value)}
            className="block rounded border px-2 py-1"
            data-admin-ops-crawl-live-confirmation="true"
          />
        </label>
        <button
          type="button"
          data-admin-ops-crawl-start="true"
          disabled={
            busy ||
            confirmationText !== PIPELINE_CONTROL_CONFIRMATION_TEXT ||
            liveConfirmationText !== PIPELINE_LIVE_ENQUEUE_CONFIRMATION
          }
          className="rounded border px-3 py-1 text-xs"
          onClick={() => void startCrawl()}
        >
          수집 시작
        </button>
        <button
          type="button"
          data-admin-ops-hosted-apply="true"
          disabled
          title="운영자 문으로만"
          aria-disabled="true"
          className="rounded border px-3 py-1 text-xs opacity-60"
        >
          실제 반영
        </button>
      </div>
      {HOSTED_APPLY_BFF_AVAILABLE ? null : (
        <p data-admin-ops-hosted-apply-missing="true" className="text-[11px] text-muted-foreground">
          실제 반영: {OPS_READBACK_MISSING}
        </p>
      )}
      {message ? (
        <p data-admin-ops-message="true" className="text-[11px] text-muted-foreground">
          {message}
        </p>
      ) : null}
    </section>
  );
}
