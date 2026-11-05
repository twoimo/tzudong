import type { EvaluationRecord } from '@/types/evaluation';
import {
  getEvaluationCompletenessIssues,
  type EvaluationCompletenessIssue,
} from '@/lib/admin-evaluation-completeness';
import {
  getRecordApprovalEligibility,
  type ApprovalEligibility,
  type ApprovalEligibilityReason,
} from './evaluation-approval-eligibility';

export const EVALUATION_RECOVERY_TASK_CODES = [
  'source_recover',
  'location_recover',
  'evaluation_recheck',
  'manual_identity_review',
  'protected',
] as const;

export type EvaluationRecoveryTaskCode = typeof EVALUATION_RECOVERY_TASK_CODES[number];

export type EvaluationRecoveryPlan = {
  taskCodes: EvaluationRecoveryTaskCode[];
  approvalEligibility: ApprovalEligibility;
  completenessIssues: EvaluationCompletenessIssue[];
  sourceBinding: {
    id: string;
    status: EvaluationRecord['status'];
    updated_at: string;
    trace_id: string | null;
    youtube_link: string | null;
    channel_name: string | null;
    recollect_version: Record<string, number> | null;
  };
  automaticCleanup: false;
};

const RECOVERY_STATUSES = new Set<EvaluationRecord['status']>([
  'pending', 'hold', 'missing', 'geocoding_failed', 'db_conflict', 'address_review_geocode_recovered',
]);

function recollectVersion(value: EvaluationRecord['recollect_version']): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([, version]) => !Number.isSafeInteger(version) || (version as number) < 0)) return null;
  return Object.fromEntries(entries) as Record<string, number>;
}

/** Read-only work plan, never approval, a source fingerprint or cleanup authority.
 * Summary DTOs retain their existing detail/approval limits. The server must
 * re-read the row and bind its SHA/current version before preview or apply.
 */
export function getEvaluationRecoveryPlan(record: EvaluationRecord): EvaluationRecoveryPlan {
  const approvalEligibility = getRecordApprovalEligibility(record);
  const completenessIssues = getEvaluationCompletenessIssues(record).map(issue => ({ ...issue }));
  const sourceBinding: EvaluationRecoveryPlan['sourceBinding'] = {
    id: record.id,
    status: record.status,
    updated_at: record.updated_at,
    trace_id: record.trace_id ?? null,
    youtube_link: record.youtube_link || null,
    channel_name: record.channel_name ?? null,
    recollect_version: recollectVersion(record.recollect_version),
  };
  const plan = (taskCodes: EvaluationRecoveryTaskCode[]): EvaluationRecoveryPlan => ({
    taskCodes, approvalEligibility, completenessIssues, sourceBinding, automaticCleanup: false,
  });

  if (!RECOVERY_STATUSES.has(record.status) || record.is_not_selected
    || record.created_by || record.updated_by_admin_id
    || ['admin', 'manual', 'user'].includes(record.source_type ?? '')
    || approvalEligibility.reasons.includes('STATUS_UNKNOWN')) return plan(['protected']);

  const reasons = new Set<ApprovalEligibilityReason>(approvalEligibility.reasons);
  const has = (...codes: ApprovalEligibilityReason[]) => codes.some(code => reasons.has(code));
  const tasks = new Set<EvaluationRecoveryTaskCode>();
  if (approvalEligibility.state === 'unknown' || record.is_missing || record.status === 'missing'
    || !sourceBinding.id || !Number.isFinite(Date.parse(sourceBinding.updated_at))
    || !sourceBinding.trace_id?.trim() || !record.origin_name?.trim() || !sourceBinding.youtube_link
    || (record.recollect_version != null && sourceBinding.recollect_version === null)
    || has('SOURCE_INCOMPLETE', 'CANONICAL_YOUTUBE_URL_REQUIRED')) tasks.add('source_recover');

  if (record.status === 'geocoding_failed' || record.geocoding_success !== true || has(
    'LOCATION_REQUIRES_REVIEW', 'LOCATION_EVIDENCE_INCOMPLETE', 'INDEPENDENT_LOCATION_EVIDENCE_REQUIRED',
  )) tasks.add('location_recover');

  if (completenessIssues.length > 0 || has(
    'MISSING_EVALUATION', 'MISSING_BASIS', 'EVALUATION_FAILED', 'CATEGORIES_INVALID',
  )) tasks.add('evaluation_recheck');

  if (record.status === 'db_conflict' || record.status === 'address_review_geocode_recovered' || has(
    'NAME_REQUIRES_REVIEW', 'NAME_TOO_LONG', 'DATABASE_OR_IDENTITY_CONFLICT', 'LOCATION_IDENTITY_MISMATCH',
  )) tasks.add('manual_identity_review');

  return plan(EVALUATION_RECOVERY_TASK_CODES.filter(code => tasks.has(code)));
}
