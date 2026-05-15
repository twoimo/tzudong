import { describe, expect, test } from 'bun:test';

import {
  explainAddressConsistency,
  getAddressConsistencyAhpSummary,
  getAddressConsistencyLabel,
  getAddressConsistencyDisplayLabel,
  getAddressConsistencyOperatorGuidance,
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
    expect(getAddressConsistencyDisplayLabel({ geocoding_success: false, geocoding_false_stage: 2 })).toBe('불일치');
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
    expect(getAddressConsistencyDisplayLabel({ geocoding_success: false, geocoding_false_stage: null })).toBe('실패');
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

    expect(explanation.reason).toBe('추가 검토 사유가 남아 단일 주소로 확정할 수 없습니다.');
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
    expect(explanation.evidence).toContain('증거 유형: 외부 주소 검색 결과, 원본 좌표/주소 비교');
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
      label: '추가 확인',
      reason: '주소 지오코딩은 회복됐지만 지도 상호 후보가 없습니다.',
    });
  });

  test('gives operators root-cause guidance for staged mismatch rows', () => {
    expect(getAddressConsistencyOperatorGuidance({
      geocoding_success: false,
      geocoding_false_stage: 1,
      status: 'pending',
    })).toMatchObject({
      label: '불일치',
      tone: 'warning',
    });

    expect(getAddressConsistencyOperatorGuidance({
      geocoding_success: false,
      geocoding_false_stage: 2,
      status: 'pending',
    })).toMatchObject({
      label: '불일치',
      tone: 'warning',
    });
  });

  test('separates geocode-recovered queues and admin-touched rows for manual review', () => {
    expect(getAddressConsistencyOperatorGuidance({
      geocoding_success: false,
      geocoding_false_stage: 2,
      status: 'pending',
      updated_by_admin_id: 'admin-1',
    })).toMatchObject({
      label: '수정됨',
      tone: 'info',
    });

    expect(getAddressConsistencyOperatorGuidance({
      geocoding_success: false,
      geocoding_false_stage: 2,
      status: 'pending',
      db_error_details: {
        address_consistency_review: {
          queue: 'geocode_recovered_review',
        },
      },
    })).toMatchObject({
      label: '불일치',
      tone: 'warning',
    });
  });

  test('summarizes optional AHP 98+ review metadata with guarded fallback', () => {
    expect(getAddressConsistencyAhpSummary({
      geocoding_success: false,
      geocoding_false_stage: 2,
      status: 'pending',
      db_error_details: {
        address_consistency_review: {
          ahp_score: 98.4,
          ahp_label: '정정 승인 후보',
          top_failing_criterion: 'address_coordinate',
          evidence_families: ['provider_candidate', 'source_geo'],
          suggested_action: '후보 주소를 비교한 뒤 guarded apply 하세요.',
        },
      },
    })).toEqual({
      score: 98.4,
      label: '정정 승인 후보',
      topFailingCriterion: '주소·좌표 정합',
      evidenceFamilies: ['주소 후보', '원본 주소·좌표'],
      suggestedAction: '후보 주소와 원본 주소를 나란히 비교하고, 같은 가게로 볼 근거가 부족하면 보류하세요.',
      hardGate: '사람 확인 후 적용',
    });

    expect(getAddressConsistencyAhpSummary({
      geocoding_success: false,
      geocoding_false_stage: 2,
      status: 'pending',
    })).toMatchObject({
      score: null,
      label: 'AHP 미산정',
      hardGate: '사람 확인 후 적용',
    });
  });

  test('keeps unknown AHP metadata operator-safe instead of leaking raw slugs', () => {
    expect(getAddressConsistencyAhpSummary({
      geocoding_success: false,
      geocoding_false_stage: 1,
      status: 'pending',
      db_error_details: {
        address_consistency_review: {
          ahp_score: 120,
          ahp_label: 'raw_pipeline_ready',
          top_failing_criterion: 'llm_internal_signal',
          evidence_families: ['provider_candidate', 'raw_pipeline_slug'],
          suggested_action: 'auto approve with pipeline script',
        },
      },
    })).toMatchObject({
      score: 100,
      label: '정정 승인 후보',
      topFailingCriterion: '기타 운영 기준',
      evidenceFamilies: ['주소 후보', '기타 운영 근거'],
      suggestedAction: '상호에서 지점/괄호/특수문자를 줄이고 주소의 시군구·건물번호를 기준으로 다시 확인하세요.',
    });
  });

});
