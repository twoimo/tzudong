import { isRecord } from './normalize-evaluation-record';
import type { EvaluationQuery, EvaluationFilters } from './evaluation-query';

const filterKeys = new Set(['status', 'visit_authenticity', 'rb_inference_score', 'rb_grounding_TF', 'review_faithfulness_score', 'geocoding_success', 'category_validity_TF', 'category_TF']);

export function parseEvaluationPageQuery(params: URLSearchParams) {
  const limit = Number(params.get('limit') ?? '50');
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('EVALUATION_QUERY_INVALID');
  const encoded = params.get('filters') ?? '{}';
  if (encoded.length > 4096) throw new Error('EVALUATION_QUERY_INVALID');
  let filters: unknown;
  try { filters = JSON.parse(encoded); } catch { throw new Error('EVALUATION_QUERY_INVALID'); }
  if (!isRecord(filters) || Object.entries(filters).some(([key, value]) => !filterKeys.has(key) || typeof value !== 'string')) throw new Error('EVALUATION_QUERY_INVALID');
  const query: EvaluationQuery = {
    searchQuery: params.get('q') ?? '',
    evalFilters: filters as EvaluationFilters,
    deepLinkFilter: { videoId: params.get('videoId') ?? '', issue: params.get('issue') ?? '', reason: params.get('reason') ?? '' },
  };
  if (query.searchQuery.length > 1024) throw new Error('EVALUATION_QUERY_INVALID');
  return { query, limit, cursor: params.get('cursor') };
}
