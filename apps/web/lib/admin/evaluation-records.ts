import {
  GEO_TRUE_UNCONFIRMED_MAP_REASONS,
  UNCONFIRMED_MAP_REASONS,
  hasUnconfirmedPublicMapLocation,
} from '@/lib/admin-address-consistency';
import type { EvaluationRecord } from '@/types/evaluation';

export const ADMIN_EVALUATION_RECORD_SELECT = [
  'id',
  'name:approved_name',
  'approved_name',
  'phone',
  'categories',
  'status',
  'source_type',
  'youtube_meta',
  'evaluation_results',
  'reasoning_basis',
  'tzuyang_review',
  'trace_id',
  'origin_address',
  'road_address',
  'jibun_address',
  'english_address',
  'address_elements',
  'geocoding_success',
  'geocoding_false_stage',
  'is_missing',
  'is_not_selected',
  'lat',
  'lng',
  'youtube_link',
  'review_count',
  'created_by',
  'updated_by_admin_id',
  'db_error_message',
  'db_error_details',
  'search_count',
  'weekly_search_count',
  'origin_name',
  'naver_name',
  'google_name',
  'trace_id_name_source',
  'channel_name',
  'description_map_url',
  'recollect_version',
  'created_at',
  'updated_at',
].join(', ');

type AdminEvaluationRecordClassifierInput = Pick<
  EvaluationRecord,
  'status' | 'is_missing' | 'is_not_selected' | 'geocoding_success' | 'evaluation_results'
>;

export function isAdminEvaluationRecordMissing(record: AdminEvaluationRecordClassifierInput): boolean {
  return record.is_missing === true || record.status === 'missing' || record.status === 'geocoding_failed';
}

export function isAdminEvaluationRecordNotSelected(record: AdminEvaluationRecordClassifierInput): boolean {
  return record.is_not_selected === true || record.status === 'not_selected';
}
export function isAdminEvaluationRecordUnconfirmedMapLocation(
  record: AdminEvaluationRecordClassifierInput,
): boolean {
  if (record.status === 'deleted' || record.status === 'approved') return false;
  if (record.is_missing === true || record.is_not_selected === true) return false;
  const reason = record.evaluation_results?.location_match_TF?.pending_reason;
  if (typeof reason === 'string' && GEO_TRUE_UNCONFIRMED_MAP_REASONS.has(reason)) return true;
  return hasUnconfirmedPublicMapLocation(record);
}

export function isAdminEvaluationRecordReadyForApproval(record: AdminEvaluationRecordClassifierInput): boolean {
  const evaluationResults = record.evaluation_results;
  const pendingReason = evaluationResults?.location_match_TF?.pending_reason;
  const blockedPendingReason = typeof pendingReason === 'string'
    && (UNCONFIRMED_MAP_REASONS.has(pendingReason) || GEO_TRUE_UNCONFIRMED_MAP_REASONS.has(pendingReason));

  return (
    evaluationResults?.visit_authenticity?.eval_value === 1 &&
    evaluationResults?.rb_inference_score?.eval_value === 1 &&
    evaluationResults?.rb_grounding_TF?.eval_value === true &&
    evaluationResults?.review_faithfulness_score?.eval_value === 1 &&
    record.geocoding_success === true &&
    evaluationResults?.category_validity_TF?.eval_value === true &&
    evaluationResults?.category_TF?.eval_value === true &&
    (record.status === 'pending' || record.status === 'hold') &&
    !blockedPendingReason
  );
}
