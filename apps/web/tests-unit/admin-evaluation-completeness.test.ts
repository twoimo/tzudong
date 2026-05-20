import { describe, expect, test } from 'bun:test';

import {
  EVALUATION_BASIS_RERUN_NEEDED_TEXT,
  getEvaluationBasisOrRerunText,
  getEvaluationCompletenessIssues,
  getEvaluationRerunSummary,
  needsEvaluationRerun,
} from '@/lib/admin-evaluation-completeness';
import type { EvaluationRecord } from '@/types/evaluation';

const baseRecord = (overrides: Partial<EvaluationRecord> = {}): EvaluationRecord => ({
  id: 'restaurant-1',
  name: '테스트 식당',
  restaurant_name: '테스트 식당',
  approved_name: '테스트 식당',
  phone: null,
  categories: ['한식'],
  lat: null,
  lng: null,
  road_address: null,
  jibun_address: null,
  english_address: null,
  address_elements: {},
  origin_address: {},
  youtube_links: null,
  youtube_link: null,
  youtube_meta: null,
  unique_id: null,
  trace_id: null,
  tzuyang_reviews: [],
  reasoning_basis: null,
  evaluation_results: null,
  source_type: null,
  geocoding_success: true,
  geocoding_false_stage: null,
  status: 'pending',
  is_missing: false,
  is_not_selected: false,
  review_count: 0,
  created_by: null,
  created_at: '2026-05-15T00:00:00Z',
  updated_at: '2026-05-15T00:00:00Z',
  ...overrides,
} as EvaluationRecord);

describe('admin evaluation completeness', () => {
  test('marks active rows with missing metric values as evaluator rerun candidates', () => {
    const record = baseRecord({
      evaluation_results: {
        visit_authenticity: null,
        rb_inference_score: { name: '테스트 식당', eval_value: 1, eval_basis: '-' },
        rb_grounding_TF: { name: '테스트 식당', eval_value: true, eval_basis: '영상 근거 확인' },
        review_faithfulness_score: { name: '테스트 식당', eval_value: 1, eval_basis: '리뷰 근거 확인' },
        category_validity_TF: null,
        category_TF: { name: '테스트 식당', eval_value: true, category_revision: null },
        location_match_TF: null,
      },
    });

    expect(needsEvaluationRerun(record)).toBe(true);
    expect(getEvaluationCompletenessIssues(record).map((issue) => issue.label)).toEqual([
      '방문여부',
      '추론합리',
      '카테고리 유효',
    ]);
    expect(getEvaluationRerunSummary(record)).toContain('값 없음: 방문여부, 카테고리 유효');
    expect(getEvaluationRerunSummary(record)).toContain('근거 없음: 방문여부, 추론합리');
  });

  test('does not mark deleted, missing, or not-selected rows for evaluator rerun', () => {
    expect(needsEvaluationRerun(baseRecord({ status: 'deleted' }))).toBe(false);
    expect(needsEvaluationRerun(baseRecord({ status: 'missing', is_missing: false }))).toBe(false);
    expect(needsEvaluationRerun(baseRecord({ is_missing: true }))).toBe(false);
    expect(needsEvaluationRerun(baseRecord({ status: 'not_selected', is_not_selected: true }))).toBe(false);
  });

  test('uses rerun copy instead of generic empty-basis fallback', () => {
    expect(getEvaluationBasisOrRerunText('근거 내용 없음')).toBe(EVALUATION_BASIS_RERUN_NEEDED_TEXT);
    expect(getEvaluationBasisOrRerunText('-')).toBe(EVALUATION_BASIS_RERUN_NEEDED_TEXT);
    expect(getEvaluationBasisOrRerunText('영상 근거 확인')).toBe('영상 근거 확인');
  });
});
