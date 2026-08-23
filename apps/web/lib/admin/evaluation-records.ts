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

export function getAdminEvaluationPublishedAtMs(record: {
  youtube_meta?: { publishedAt?: string | null } | null;
  created_at?: string | null;
}): number {
  const publishedAt = record.youtube_meta?.publishedAt;
  if (typeof publishedAt === 'string' && publishedAt.trim()) {
    const publishedMs = Date.parse(publishedAt);
    if (Number.isFinite(publishedMs)) return publishedMs;
  }

  const createdAt = record.created_at;
  if (typeof createdAt === 'string' && createdAt.trim()) {
    const createdMs = Date.parse(createdAt);
    if (Number.isFinite(createdMs)) return createdMs;
  }

  return 0;
}

export function compareAdminEvaluationRecordsByPublishedAtDesc(
  left: { id?: string; youtube_meta?: { publishedAt?: string | null } | null; created_at?: string | null },
  right: { id?: string; youtube_meta?: { publishedAt?: string | null } | null; created_at?: string | null },
): number {
  const publishedDelta = getAdminEvaluationPublishedAtMs(right) - getAdminEvaluationPublishedAtMs(left);
  if (publishedDelta !== 0) return publishedDelta;
  return String(right.id ?? '').localeCompare(String(left.id ?? ''));
}

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

export function isAdminEvaluationRecordReadyForApproval(record: AdminEvaluationRecordClassifierInput): boolean {
  const evaluationResults = record.evaluation_results;

  return (
    evaluationResults?.visit_authenticity?.eval_value === 1 &&
    evaluationResults?.rb_inference_score?.eval_value === 1 &&
    evaluationResults?.rb_grounding_TF?.eval_value === true &&
    evaluationResults?.review_faithfulness_score?.eval_value === 1 &&
    record.geocoding_success === true &&
    evaluationResults?.category_validity_TF?.eval_value === true &&
    evaluationResults?.category_TF?.eval_value === true &&
    (record.status === 'pending' || record.status === 'hold')
  );
}
