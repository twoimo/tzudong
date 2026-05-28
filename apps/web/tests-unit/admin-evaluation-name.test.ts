import { describe, expect, test } from 'bun:test';

import {
  getAdminEvaluationApprovalName,
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

  test('skips stale top-level naver_name and uses compatible matched provider name', () => {
    expect(
      getRuleBasedPassedNaverName({
        origin_name: '제기식당',
        naver_name: '소문난냉면',
        evaluation_results: {
          location_match_TF: {
            eval_value: true,
            matched_provider: 'naver',
            matched_name: '제기식당',
          },
        },
      }),
    ).toBe('제기식당');
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
        naver_name: '원본상호 본점',
        evaluation_results: {
          location_match_TF: {
            eval_value: true,
          },
        },
      }),
    ).toBe('원본상호 본점');
  });

  test('ignores an address-only provider name mismatch', () => {
    expect(
      getAdminEvaluationDisplayName({
        origin_name: '제기식당',
        naver_name: '소문난냉면',
        evaluation_results: {
          location_match_TF: {
            eval_value: true,
            naver_name: '소문난냉면',
          },
        },
      }),
    ).toBe('제기식당');
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


describe('getAdminEvaluationApprovalName', () => {
  test('keeps the admin-edited name when stale provider names still exist', () => {
    expect(
      getAdminEvaluationApprovalName({
        approved_name: '관리자가수정한맛집',
        restaurant_name: '관리자가수정한맛집',
        name: '관리자가수정한맛집',
        naver_name: '이전네이버후보명',
        google_name: '이전구글후보명',
        evaluation_results: {
          location_match_TF: {
            eval_value: true,
            naver_name: '이전네이버후보명',
          },
        },
      }),
    ).toBe('관리자가수정한맛집');
  });

  test('uses the passed provider name when there is no admin edit', () => {
    expect(
      getAdminEvaluationApprovalName({
        origin_name: '원본상호',
        naver_name: '원본상호 본점',
        evaluation_results: {
          location_match_TF: {
            eval_value: true,
          },
        },
      }),
    ).toBe('원본상호 본점');
  });
});
