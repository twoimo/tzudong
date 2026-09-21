import { describe, expect, test } from 'bun:test';
import {
  getLocationMatchFalseMessage,
  hasLaajMetrics,
  hasRuleMetrics,
  toNotSelectionReason,
} from '@/lib/dashboard/classifiers';

describe('dashboard evaluation classifiers', () => {
  test('detects rule metrics only from object fields', () => {
    expect(hasRuleMetrics({ category_validity_TF: { eval_value: true } })).toBe(true);
    expect(hasRuleMetrics({ location_match_TF: { eval_value: false } })).toBe(true);

    for (const value of [null, undefined, 'text', 7, [], {}, { category_validity_TF: true }, { location_match_TF: [] }]) {
      expect(hasRuleMetrics(value)).toBe(false);
    }
  });

  test('detects laaj metrics across every supported field', () => {
    for (const field of [
      'visit_authenticity',
      'rb_inference_score',
      'rb_grounding_TF',
      'review_faithfulness_score',
      'category_TF',
    ]) {
      expect(hasLaajMetrics({ [field]: { eval_value: 1 } })).toBe(true);
    }

    for (const value of [null, undefined, 'text', [], {}, { visit_authenticity: 'yes' }]) {
      expect(hasLaajMetrics(value)).toBe(false);
    }
  });

  test('returns no false message when location match passed or is absent', () => {
    expect(getLocationMatchFalseMessage(null)).toBeNull();
    expect(getLocationMatchFalseMessage({})).toBeNull();
    expect(getLocationMatchFalseMessage({ location_match_TF: { eval_value: true } })).toBeNull();
    expect(getLocationMatchFalseMessage({ location_match_TF: 'failed' })).toBeNull();
    expect(getLocationMatchFalseMessage({ location_match_TF: [] })).toBeNull();
  });

  test('falls back to the pending reason and then to a generic message', () => {
    expect(getLocationMatchFalseMessage({
      location_match_TF: { eval_value: false, falseMessage: '  주소가 다릅니다  ' },
    })).toBe('  주소가 다릅니다  ');

    expect(getLocationMatchFalseMessage({
      location_match_TF: { eval_value: false, falseMessage: '   ', pending_reason: 'geocode_pending' },
    })).toBe('location_match pending (geocode_pending)');

    expect(getLocationMatchFalseMessage({
      location_match_TF: { eval_value: false, falseMessage: '   ', pending_reason: '  ' },
    })).toBe('location_match 실패(사유 없음)');

    expect(getLocationMatchFalseMessage({ location_match_TF: { eval_value: false } }))
      .toBe('location_match 실패(사유 없음)');
  });

  test('labels not-selected evaluations by the first matching cause', () => {
    expect(toNotSelectionReason({ is_not_selected: undefined })).toBe('평가 미대상(기타)');
    expect(toNotSelectionReason({ is_not_selected: false })).toBe('평가 미대상(기타)');
    expect(toNotSelectionReason({ is_not_selected: true })).toBe('평가 미대상(기타)');
    expect(toNotSelectionReason({ is_not_selected: true, is_missing: true })).toBe('평가 미대상(missing target)');
    expect(toNotSelectionReason({ is_not_selected: true, geocoding_false_stage: 0 }))
      .toBe('평가 미대상(address null 등)');
    expect(toNotSelectionReason({ is_not_selected: true, geocoding_false_stage: 1 }))
      .toBe('평가 미대상(지오코딩 1단계 실패)');
    expect(toNotSelectionReason({ is_not_selected: true, geocoding_false_stage: 2 }))
      .toBe('평가 미대상(지오코딩 2단계 실패)');
    expect(toNotSelectionReason({ is_not_selected: true, geocoding_success: false }))
      .toBe('평가 미대상(지오코딩 실패)');
    expect(toNotSelectionReason({ is_not_selected: true, geocoding_false_stage: 3 })).toBe('평가 미대상(기타)');
    expect(toNotSelectionReason({
      is_not_selected: true,
      is_missing: true,
      geocoding_false_stage: 2,
      geocoding_success: false,
    })).toBe('평가 미대상(missing target)');
  });
});
