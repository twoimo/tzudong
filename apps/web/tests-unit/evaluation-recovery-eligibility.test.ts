import { describe, expect, test } from 'bun:test';
import type { EvaluationRecord } from '@/types/evaluation';
import { getEvaluationCompletenessIssues } from '@/lib/admin-evaluation-completeness';
import { getRecordApprovalEligibility } from '@/lib/admin/evaluation-approval-eligibility';
import { normalizeEvaluationRecord } from '@/lib/admin/normalize-evaluation-record';
import { summarizeEvaluationRecord } from '@/lib/admin/evaluation-summary';
import { getEvaluationRecoveryPlan } from '@/lib/admin/evaluation-recovery-eligibility';

// Synthetic rows exercise the same raw -> normalized -> summary transports as the UI.
function rawRow() {
  const name = 'Fixture 식당';
  return {
    id: '00000000-0000-4000-8000-000000000001', name, status: 'hold',
    source_type: 'geminiCLI', created_by: null as string | null, updated_by_admin_id: null as string | null,
    created_at: '2026-10-25T00:00:00Z', updated_at: '2026-10-25T00:00:00Z',
    origin_name: name, approved_name: null, naver_name: name, google_name: null,
    is_missing: false, is_not_selected: false, db_error_message: null, db_error_details: null,
    lat: 37, lng: 127, jibun_address: 'Fixture 지번', road_address: null, geocoding_success: true,
    categories: ['한식'], tzuyang_review: 'Fixture review', reasoning_basis: 'Fixture extraction basis',
    trace_id: 'fixture-trace', channel_name: 'tzuyang', recollect_version: { meta: 1, transcript: 2 },
    youtube_link: 'https://www.youtube.com/watch?v=abcdefgh_-1',
    evaluation_results: {
      visit_authenticity: { name, eval_value: 1, eval_basis: 'Fixture visit basis' },
      rb_inference_score: { name, eval_value: 1, eval_basis: 'Fixture identity basis' },
      rb_grounding_TF: { name, eval_value: true, eval_basis: 'Fixture grounding basis' },
      review_faithfulness_score: { name, eval_value: 1, eval_basis: 'Fixture review basis' },
      category_TF: { name, eval_value: true, category_revision: null },
      category_validity_TF: { name, eval_value: true },
      location_match_TF: {
        origin_name: name, matched_name: name, eval_value: true, match_status: 'matched',
        evidence_families: ['provider_candidate', 'source_geo'], pending_reason: null, falseMessage: null,
      },
    },
  };
}

function record(raw: object = rawRow()): EvaluationRecord {
  const normalized = normalizeEvaluationRecord(raw);
  if (!normalized) throw new Error('Invalid synthetic fixture');
  return normalized;
}

describe('evaluation recovery work planner', () => {
  test('a grounded row needs no recovery and retains final server validation', () => {
    const row = record();
    const plan = getEvaluationRecoveryPlan(row);
    expect(plan.taskCodes).toEqual([]);
    expect(plan.approvalEligibility).toEqual(getRecordApprovalEligibility(row));
    expect(plan.approvalEligibility.state).toBe('local_checks_passed');
    expect(plan.approvalEligibility.requiresFinalServerValidation).toBe(true);
    expect(plan.automaticCleanup).toBe(false);
  });

  test('geocoding failure still requires location recovery when all six metrics pass', () => {
    const raw = { ...rawRow(), geocoding_success: false };
    const row = record(raw);
    const before = structuredClone(row);
    const plan = getEvaluationRecoveryPlan(row);
    expect(plan.taskCodes).toEqual(['location_recover']);
    expect(plan.completenessIssues).toEqual([]);
    expect(plan.approvalEligibility.reasons).toContain('LOCATION_REQUIRES_REVIEW');
    expect(plan.automaticCleanup).toBe(false);
    expect(row).toEqual(before);
    expect(row.status).toBe('hold');
  });

  test('missing category metrics add evaluation work even if the four core metrics pass', () => {
    const raw = rawRow();
    const row = record({ ...raw, geocoding_success: false, evaluation_results: {
      ...raw.evaluation_results, category_TF: null, category_validity_TF: null,
    } });
    expect(getEvaluationRecoveryPlan(row).taskCodes).toEqual(['location_recover', 'evaluation_recheck']);
    expect(getEvaluationRecoveryPlan(row).completenessIssues.map(issue => issue.key))
      .toEqual(['category_validity_TF', 'category_TF']);
  });

  test.each(['timeout', 'rate_limited', 'insufficient_evidence', null])(
    'provider failure %s is location work, never cleanup', pending_reason => {
      const raw = rawRow();
      const row = record({ ...raw, geocoding_success: false, evaluation_results: {
        ...raw.evaluation_results, location_match_TF: {
          ...raw.evaluation_results.location_match_TF, eval_value: false,
          match_status: 'failed', evidence_families: [], pending_reason, falseMessage: '검색 결과 없음',
        },
      } });
      const plan = getEvaluationRecoveryPlan(row);
      expect(plan.taskCodes).toEqual(['location_recover']);
      expect(plan.automaticCleanup).toBe(false);
    },
  );

  test.each(['pending', 'hold', 'missing', 'geocoding_failed'])('missing flag on %s requests recovery', status => {
    const plan = getEvaluationRecoveryPlan(record({ ...rawRow(), status, is_missing: true }));
    expect(plan.taskCodes).toContain('source_recover');
    expect(plan.automaticCleanup).toBe(false);
  });

  test('a stored provider failure is work for review rather than terminal deletion', () => {
    const plan = getEvaluationRecoveryPlan(record({
      ...rawRow(), geocoding_success: false, db_error_message: 'source_unavailable',
    }));
    expect(plan.taskCodes).toEqual(['location_recover', 'manual_identity_review']);
    expect(plan.automaticCleanup).toBe(false);
    expect(getEvaluationRecoveryPlan(record({ ...rawRow(), status: 'geocoding_failed' })).taskCodes)
      .toContain('location_recover');
  });

  test.each(['approved', 'rejected', 'deleted', 'not_selected', 'future-status'])(
    'terminal or unknown status %s is protected', status => {
      const plan = getEvaluationRecoveryPlan(record({ ...rawRow(), status, is_missing: true }));
      expect(plan.taskCodes).toEqual(['protected']);
      expect(plan.automaticCleanup).toBe(false);
    },
  );

  test('admin/user ownership and explicit authorship stay protected', () => {
    for (const changes of [
      { updated_by_admin_id: 'fixture-admin' }, { created_by: 'fixture-user' },
      { source_type: 'admin' }, { source_type: 'manual' }, { source_type: 'user' }, { is_not_selected: true },
    ]) {
      expect(getEvaluationRecoveryPlan(record({ ...rawRow(), ...changes })).taskCodes).toEqual(['protected']);
    }
  });

  test('name/location identity conflicts require manual review without changing the name', () => {
    const raw = rawRow();
    const row = record({ ...raw, naver_name: 'Fixture 다른 지점', evaluation_results: {
      ...raw.evaluation_results, location_match_TF: { ...raw.evaluation_results.location_match_TF, origin_name: '다른 원본' },
    } });
    expect(getEvaluationRecoveryPlan(row).taskCodes).toEqual(['manual_identity_review']);
    expect(row.origin_name).toBe(raw.origin_name);
    expect(getEvaluationRecoveryPlan(record({ ...raw, status: 'db_conflict' })).taskCodes).toContain('manual_identity_review');
  });

  test('missing/failed grounding and invalid categories require evaluation, not fabricated evidence', () => {
    const raw = rawRow();
    for (const evaluation_results of [
      { ...raw.evaluation_results, rb_grounding_TF: null },
      { ...raw.evaluation_results, review_faithfulness_score: { ...raw.evaluation_results.review_faithfulness_score, eval_value: 0 } },
      { ...raw.evaluation_results, rb_inference_score: { ...raw.evaluation_results.rb_inference_score, eval_basis: '-' } },
      { ...raw.evaluation_results, category_TF: { ...raw.evaluation_results.category_TF, eval_value: false } },
    ]) {
      const row = record({ ...raw, evaluation_results });
      const plan = getEvaluationRecoveryPlan(row);
      expect(plan.taskCodes).toEqual(['evaluation_recheck']);
      expect(plan.completenessIssues).toEqual(getEvaluationCompletenessIssues(row));
      expect(plan.automaticCleanup).toBe(false);
    }
    expect(getEvaluationRecoveryPlan(record({ ...raw, categories: ['invalid'] })).taskCodes).toEqual(['evaluation_recheck']);
  });

  test('source gaps and malformed existing versions request source recovery', () => {
    for (const changes of [
      { trace_id: null }, { origin_name: null }, { youtube_link: '' }, { tzuyang_review: '' },
      { id: '' }, { updated_at: '' }, { updated_at: 'not-a-time' }, { recollect_version: { meta: -1 } },
    ]) expect(getEvaluationRecoveryPlan(record({ ...rawRow(), ...changes })).taskCodes).toContain('source_recover');
  });

  test('bindings preserve exact source references without including raw review or provider errors', () => {
    const row = record();
    const plan = getEvaluationRecoveryPlan(row);
    expect(plan.sourceBinding).toEqual({
      id: row.id, status: 'hold', updated_at: row.updated_at, trace_id: row.trace_id,
      youtube_link: row.youtube_link, channel_name: row.channel_name, recollect_version: { meta: 1, transcript: 2 },
    });
    expect(plan.sourceBinding.recollect_version).not.toBe(row.recollect_version);
    const binding = structuredClone(plan.sourceBinding);
    plan.sourceBinding.recollect_version!.meta = 99;
    expect(row.recollect_version?.meta).toBe(1);
    for (const changes of [{ trace_id: 'new-trace' }, { updated_at: '2026-11-04T00:00:00Z' }, { recollect_version: { meta: 2 } }]) {
      expect(getEvaluationRecoveryPlan(record({ ...rawRow(), ...changes })).sourceBinding).not.toEqual(binding);
    }
    expect(JSON.stringify(plan)).not.toContain('Fixture review');
  });

  test('paged summaries use existing approval/completeness evidence; absent detail is not success', () => {
    const raw = rawRow();
    const full = record(raw);
    const summary = record(summarizeEvaluationRecord(raw, full));
    expect(getEvaluationRecoveryPlan(summary).taskCodes).toEqual([]);
    const unknown = { ...summary, approval_eligibility: undefined };
    const plan = getEvaluationRecoveryPlan(unknown);
    expect(plan.approvalEligibility.state).toBe('unknown');
    expect(plan.taskCodes).toContain('source_recover');
    expect(plan.automaticCleanup).toBe(false);
  });
});
