import { isAdminEvaluationRecordReadyForApproval } from "@/lib/admin/evaluation-records";

export const HOSTED_APPLY_BFF_AVAILABLE = false;
export const OPS_READBACK_MISSING = "아직 없음";

type PipelineJobLike = {
  status?: string | null;
  target?: string | null;
  adapter_index?: number | null;
};

type PipelineStatusLike = {
  jobs?: PipelineJobLike[] | null;
};

const ACTIVE_JOB_STATUSES = new Set(["Queued", "Fetching", "Inserting"]);

export function formatPipelineJobPosition(payload: PipelineStatusLike | null | undefined): string {
  const jobs = payload?.jobs ?? [];
  const active = jobs.find((job) => ACTIVE_JOB_STATUSES.has(String(job.status ?? "")));
  const job = active ?? jobs[0];
  if (!job) return OPS_READBACK_MISSING;
  const status = String(job.status ?? "").trim();
  const target = String(job.target ?? "").trim();
  const step = typeof job.adapter_index === "number" ? job.adapter_index : null;
  if (!status && !target && step == null) return OPS_READBACK_MISSING;
  return [target || null, status || null, step == null ? null : `step ${step}`]
    .filter(Boolean)
    .join(" / ");
}

export function formatHostedApplyPreviewHash(hash: string | null | undefined): string {
  if (!HOSTED_APPLY_BFF_AVAILABLE) return OPS_READBACK_MISSING;
  const value = hash?.trim() ?? "";
  return /^[a-f0-9]{64}$/.test(value) ? value : OPS_READBACK_MISSING;
}

export function countHumanVideoReviewQueue(
  records: Array<Parameters<typeof isAdminEvaluationRecordReadyForApproval>[0]>,
): number {
  return records.filter(isAdminEvaluationRecordReadyForApproval).length;
}
