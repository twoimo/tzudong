"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  PIPELINE_CONTROL_CONFIRMATION_TEXT,
  PIPELINE_LIVE_ENQUEUE_CONFIRMATION,
  type PipelineListJob,
  type PipelineRunAction,
  buildPipelinePreviewHash,
} from "@/lib/admin/pipeline-control";

type PipelineStatusResponse = {
  targets?: Array<{ id: string; status?: string }>;
  jobs?: PipelineListJob[];
  hardware?: string;
  dataEnv?: string;
  failures?: Array<{ target?: string; error_code?: string }>;
};

const PAUSE_FROM = new Set(["Queued", "Fetching", "Inserting"]);
const RESUME_FROM = new Set(["Paused"]);
const CANCEL_FROM = new Set(["Queued", "Fetching", "Inserting", "Paused"]);

function newIdempotencyKey() {
  return `pipe-${crypto.randomUUID()}`;
}

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
    accepted?: boolean;
  };
  return { ok: response.ok, status: response.status, payload };
}

export function AdminPipelineDashboard() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["admin-pipeline-status"],
    queryFn: async (): Promise<PipelineStatusResponse> => {
      const response = await fetch("/api/admin/pipeline", {
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("pipeline-status-failed");
      return (await response.json()) as PipelineStatusResponse;
    },
    staleTime: 15_000,
  });

  const [confirmationText, setConfirmationText] = useState("");
  const [liveConfirmationText, setLiveConfirmationText] = useState("");
  const [enqueueTarget, setEnqueueTarget] = useState("tzuyang");
  const [enqueueProfile, setEnqueueProfile] = useState<"heavy_local" | "lite_gha">(
    "heavy_local",
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin-pipeline-status"] });
  };

  const submit = async (input: {
    action: PipelineRunAction;
    target: string;
    profile: "heavy_local" | "lite_gha";
    runId?: string;
    live?: boolean;
  }) => {
    setBusy(true);
    setMessage(null);
    try {
      const dryRun = input.action === "enqueue" ? !input.live : true;
      const previewHash = buildPipelinePreviewHash({
        action: input.action,
        target: input.target,
        profile: input.profile,
        runId: input.runId,
        dryRun,
      });
      const body: Record<string, unknown> = {
        action: input.action,
        target: input.target,
        profile: input.profile,
        confirmationText,
        previewHash,
        correlationId: crypto.randomUUID(),
        idempotencyKey: newIdempotencyKey(),
      };
      if (input.runId) body.runId = input.runId;
      if (input.action === "enqueue") {
        body.dryRun = dryRun;
        if (input.live) body.liveConfirmationText = liveConfirmationText;
      }
      const result = await postPipeline(body);
      await refresh();
      if (result.status === 409) {
        setMessage("state already changed, refreshed");
        return;
      }
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

  const jobs = query.data?.jobs ?? [];
  const targets = query.data?.targets ?? [];

  return (
    <section
      data-admin-pipeline-dashboard="true"
      className="flex min-h-[220px] flex-col gap-3 border border-border bg-card p-4"
    >
      <header>
        <h2 className="text-sm font-semibold">크롤러 파이프라인</h2>
        <p className="text-xs text-muted-foreground">
          control-plane 상태. Grafana iframe은 CSP/auth gate 전까지 금지.
        </p>
      </header>
      <div className="flex flex-wrap gap-2 text-[11px]">
        <span data-admin-pipeline-hardware={query.data?.hardware ?? "unknown"}>
          hardware: {query.data?.hardware ?? "unknown"}
        </span>
        <span data-admin-pipeline-data-env={query.data?.dataEnv ?? "unknown"}>
          data: {query.data?.dataEnv ?? "unknown"}
        </span>
      </div>
      <ul className="space-y-1 text-xs">
        {targets.map((target) => (
          <li key={target.id} data-admin-pipeline-target={target.id}>
            {target.id}: {target.status ?? "Idle"}
          </li>
        ))}
      </ul>
      <ul data-admin-pipeline-jobs="true" className="space-y-2 text-xs">
        {jobs.map((job) => (
          <li
            key={job.id}
            data-admin-pipeline-job={job.id}
            className="flex flex-wrap items-center gap-2 border border-border px-2 py-1"
          >
            <span>
              {job.id} {job.target}/{job.profile} {job.status}
              {job.error_code ? ` ${job.error_code}` : ""}
              {job.dry_run ? " dry" : " live"} #{job.adapter_index ?? 0}
            </span>
            {PAUSE_FROM.has(job.status) ? (
              <button
                type="button"
                data-admin-pipeline-pause="true"
                disabled={busy}
                className="rounded border px-2 py-0.5"
                onClick={() =>
                  void submit({
                    action: "pause",
                    target: job.target,
                    profile: job.profile as "heavy_local" | "lite_gha",
                    runId: job.id,
                  })
                }
              >
                pause
              </button>
            ) : null}
            {RESUME_FROM.has(job.status) ? (
              <button
                type="button"
                data-admin-pipeline-resume="true"
                disabled={busy}
                className="rounded border px-2 py-0.5"
                onClick={() =>
                  void submit({
                    action: "resume",
                    target: job.target,
                    profile: job.profile as "heavy_local" | "lite_gha",
                    runId: job.id,
                  })
                }
              >
                resume
              </button>
            ) : null}
            {CANCEL_FROM.has(job.status) ? (
              <button
                type="button"
                data-admin-pipeline-cancel="true"
                disabled={busy}
                className="rounded border px-2 py-0.5"
                onClick={() =>
                  void submit({
                    action: "cancel",
                    target: job.target,
                    profile: job.profile as "heavy_local" | "lite_gha",
                    runId: job.id,
                  })
                }
              >
                cancel
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-2 text-xs">
        <label className="flex flex-wrap items-center gap-2">
          target
          <select
            value={enqueueTarget}
            onChange={(event) => setEnqueueTarget(event.target.value)}
            className="rounded border px-1 py-0.5"
          >
            {targets.map((target) => (
              <option key={target.id} value={target.id}>
                {target.id}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-wrap items-center gap-2">
          profile
          <select
            value={enqueueProfile}
            onChange={(event) =>
              setEnqueueProfile(event.target.value as "heavy_local" | "lite_gha")
            }
            className="rounded border px-1 py-0.5"
          >
            <option value="heavy_local">heavy_local</option>
            <option value="lite_gha">lite_gha</option>
          </select>
        </label>
        <label className="block space-y-1">
          <span>확인 문구</span>
          <input
            value={confirmationText}
            onChange={(event) => setConfirmationText(event.target.value)}
            className="w-full rounded border p-2"
          />
        </label>
        <label className="block space-y-1">
          <span>live enqueue 확인 ({PIPELINE_LIVE_ENQUEUE_CONFIRMATION})</span>
          <input
            value={liveConfirmationText}
            onChange={(event) => setLiveConfirmationText(event.target.value)}
            className="w-full rounded border p-2"
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-admin-pipeline-enqueue="true"
            disabled={busy || confirmationText !== PIPELINE_CONTROL_CONFIRMATION_TEXT}
            className="rounded border px-2 py-1"
            onClick={() =>
              void submit({
                action: "enqueue",
                target: enqueueTarget,
                profile: enqueueProfile,
              })
            }
          >
            enqueue dry-run
          </button>
          <button
            type="button"
            data-admin-pipeline-enqueue-live="true"
            disabled={
              busy ||
              confirmationText !== PIPELINE_CONTROL_CONFIRMATION_TEXT ||
              liveConfirmationText !== PIPELINE_LIVE_ENQUEUE_CONFIRMATION
            }
            className="rounded border px-2 py-1"
            onClick={() =>
              void submit({
                action: "enqueue",
                target: enqueueTarget,
                profile: enqueueProfile,
                live: true,
              })
            }
          >
            enqueue live
          </button>
        </div>
      </div>
      {message ? <p className="text-xs text-muted-foreground">{message}</p> : null}
      <div data-admin-pipeline-failures="true" className="text-xs">
        {query.isError
          ? "상태를 불러올 수 없음"
          : (query.data?.failures ?? []).length === 0
            ? "최근 실패 없음"
            : (query.data?.failures ?? [])
                .map((row) => `${row.target ?? ""} ${row.error_code ?? "failed"}`.trim())
                .join(", ")}
      </div>
    </section>
  );
}
