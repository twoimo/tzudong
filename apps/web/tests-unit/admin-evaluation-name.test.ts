import { describe, expect, test } from 'bun:test';

import {
  getAdminEvaluationDisplayName,
  getRuleBasedPassedNaverName,
} from '@/lib/admin-evaluation-name';

describe('getRuleBasedPassedNaverName', () => {
  test('returns the top-level naver_name when rule-based location match passed', () => {
    expect(
      getRuleBasedPassedNaverName({
        naver_name: '을지로맛집',
        evaluation_results: {
          location_match_TF: {
            eval_value: true,
          },
        },
      }),
    ).toBe('을지로맛집');
  });

  test('falls back to matched naver name when the top-level naver_name is missing', () => {
    expect(
      getRuleBasedPassedNaverName({
        evaluation_results: {
          location_match_TF: {
            eval_value: true,
            matched_provider: 'naver',
            matched_name: '우암국수',
          },
        },
      }),
    ).toBe('우암국수');
  });

  test('ignores naver_name when rule-based location match did not pass', () => {
    expect(
      getRuleBasedPassedNaverName({
        naver_name: '반영되면안됨',
        evaluation_results: {
          location_match_TF: {
            eval_value: false,
          },
        },
      }),
    ).toBeNull();
  });
});

describe('getAdminEvaluationDisplayName', () => {
  test('prefers approved_name over rule-based naver name', () => {
    expect(
      getAdminEvaluationDisplayName({
        approved_name: '관리자확정명',
        naver_name: '네이버후보명',
        evaluation_results: {
          location_match_TF: {
            eval_value: true,
          },
        },
      }),
    ).toBe('관리자확정명');
  });

  test('uses the rule-based naver name before the origin name', () => {
    expect(
      getAdminEvaluationDisplayName({
        origin_name: '원본상호',
        naver_name: '네이버상호',
        evaluation_results: {
          location_match_TF: {
            eval_value: true,
          },
        },
      }),
    ).toBe('네이버상호');
  });

  test('falls back to the current record name when no approved or passed naver name exists', () => {
    expect(
      getAdminEvaluationDisplayName({
        restaurant_name: '현재표시명',
        origin_name: '원본상호',
      }),
    ).toBe('현재표시명');
  });

  test('accepts nullable database fields and falls back to the next non-empty name', () => {
    expect(
      getAdminEvaluationDisplayName({
        approved_name: null,
        restaurant_name: null,
        name: null,
        origin_name: '원본상호',
        naver_name: null,
        evaluation_results: null,
      }),
    ).toBe('원본상호');
  });
});
