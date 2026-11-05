import type { EvaluationRecord } from '@/types/evaluation';
import { getAddressConsistencyStatus } from '@/lib/admin-address-consistency';
import { getEvaluationCompletenessIssues } from '@/lib/admin-evaluation-completeness';
import { isRecord } from './normalize-evaluation-record';
import { getRecordApprovalEligibility } from './evaluation-approval-eligibility';

/** Read-only list projection. Every action fetches the complete current row. */
export function summarizeEvaluationRecord(raw: Record<string, unknown>, record: EvaluationRecord) {
  // Raw evidence still contains bases, pending reasons and provider flags here.
  // Never strip read_summary to pretend that an incomplete input is full detail.
  const approvalEligibility = getRecordApprovalEligibility(raw);
  const result = { ...raw };
  for (const key of ['reasoning_basis', 'tzuyang_review', 'db_error_details']) delete result[key];
  if (isRecord(raw.evaluation_results)) {
    result.evaluation_results = Object.fromEntries(Object.entries(raw.evaluation_results).map(([key, value]) => {
      if (!isRecord(value)) return [key, value];
      const metric = { ...value };
      // Preserve invalid-type markers: the existing parser must still reject them.
      if (typeof metric.eval_basis === 'string') delete metric.eval_basis;
      if (key === 'location_match_TF') { delete metric.evidence_summary; delete metric.falseMessage; }
      return [key, metric];
    }));
  }
  return { ...result, approval_eligibility: approvalEligibility, read_summary: {
    address_consistency: getAddressConsistencyStatus(record),
    evaluation_issues: approvalEligibility.state === 'unknown' ? [] : getEvaluationCompletenessIssues(record),
  } };
}
