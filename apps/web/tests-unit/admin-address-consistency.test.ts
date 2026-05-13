import { describe, expect, test } from 'bun:test';

import {
  explainAddressConsistency,
  getAddressConsistencyLabel,
  getAddressConsistencyReviewQueueInfo,
  isGeocodeRecoveredReviewQueue,
} from '@/lib/admin-address-consistency';

describe('admin address consistency explanations', () => {
  test('labels staged geocoding failures as False with stage-specific reason', () => {
    const explanation = explainAddressConsistency({
      geocoding_success: false,
      geocoding_false_stage: 2,
      status: 'pending',
      origin_address: { address: '경기도 안양시' },
      evaluation_results: {
        location_match_TF: {
          eval_value: false,
          falseMessage: '2단계 실패: 20m 이내 후보 없음',
        },
      },
    });

    expect(getAddressConsistencyLabel({ geocoding_success: false, geocoding_false_stage: 2 })).toBe('False');
    expect(explanation.headline).toContain('불일치');
    expect(explanation.reason).toBe('2단계 실패: 20m 이내 후보 없음');
    expect(explanation.evidence).toContain('원본 주소: 경기도 안양시');
  });

  test('labels null-stage geocoding failures as Failed with system-level explanation', () => {
    const explanation = explainAddressConsistency({
      geocoding_success: false,
      geocoding_false_stage: null,
      status: 'pending',
      origin_address: null,
      db_error_message: 'provider timeout',
    });

    expect(getAddressConsistencyLabel({ geocoding_success: false, geocoding_false_stage: null })).toBe('Failed');
    expect(explanation.headline).toContain('실패');
    expect(explanation.reason).toContain('시스템 오류 원문은 내부 데이터에 보존되어 있습니다.');
    expect(explanation.reason).not.toContain('provider timeout');
    expect(explanation.evidence).toContain('원본 주소: 없음');
  });

  test('uses structured pending reason when no false message exists', () => {
    const explanation = explainAddressConsistency({
      geocoding_success: false,
      geocoding_false_stage: 1,
      status: 'pending',
      evaluation_results: {
        location_match_TF: {
          eval_value: false,
          pending_reason: 'multi_candidate',
          match_status: 'pending',
        },
      },
    });

    expect(explanation.reason).toBe('복수 후보가 남아 단일 주소로 확정할 수 없습니다.');
    expect(explanation.evidence).toContain('매칭 상태: 검토 필요');
  });

  test('treats missing and not-selected records as not applicable', () => {
    expect(getAddressConsistencyLabel({ geocoding_success: false, geocoding_false_stage: null, is_missing: true })).toBe('-');
    expect(getAddressConsistencyLabel({ geocoding_success: false, geocoding_false_stage: null, status: 'missing' })).toBe('-');
    expect(getAddressConsistencyLabel({ geocoding_success: false, geocoding_false_stage: 0, is_not_selected: true })).toBe('-');
  });

  test('keeps structured evidence in item-5-friendly Korean summaries', () => {
    const explanation = explainAddressConsistency({
      geocoding_success: false,
      geocoding_false_stage: 1,
      status: 'pending',
      evaluation_results: {
        location_match_TF: {
          eval_value: false,
          evidence_summary: ['Naver candidate mismatched district'],
          evidence_families: ['provider_candidate', 'source_geo'],
          second_pass: { attempted: true, provider: 'google', timed_out: true, duration_ms: 1200 },
        },
      },
    });

    expect(explanation.evidence).toContain('검증 근거: 원문 근거 1건은 내부 데이터에 보존되어 있습니다.');
    expect(explanation.evidence).toContain('증거 유형: 지도 후보 검색 결과, 원본 좌표/주소 비교');
    expect(explanation.evidence).toContain('재검증 결과: 시도됨, 공급자 구글, 시간 초과, 1200ms');
  });


  test('does not expose English-only raw failure messages in item 5', () => {
    const explanation = explainAddressConsistency({
      geocoding_success: false,
      geocoding_false_stage: 2,
      status: 'pending',
      evaluation_results: {
        location_match_TF: {
          eval_value: false,
          falseMessage: 'stage two failed: no candidate within 20m',
        },
      },
    });

    expect(explanation.reason).toBe('규칙 판정 원문은 내부 데이터에 보존되어 있습니다.');
    expect(explanation.reason).not.toContain('stage two failed');
  });


  test('detects geocode-recovered review queue metadata for admin filtering', () => {
    const record = {
      db_error_details: {
        address_consistency_review: {
          queue: 'geocode_recovered_review',
          reason_ko: '주소 지오코딩은 회복됐지만 지도 상호 후보가 없습니다.',
        },
      },
    };

    expect(isGeocodeRecoveredReviewQueue(record)).toBe(true);
    expect(getAddressConsistencyReviewQueueInfo(record)).toEqual({
      queue: 'geocode_recovered_review',
      label: '지도후보 부족',
      reason: '주소 지오코딩은 회복됐지만 지도 상호 후보가 없습니다.',
    });
  });

});
