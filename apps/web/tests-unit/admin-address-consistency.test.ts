import { describe, expect, test } from 'bun:test';

import {
  explainAddressConsistency,
  getAddressConsistencyAhpSummary,
  getAddressConsistencyLabel,
  getAddressConsistencyDisplayLabel,
  getAddressConsistencyOperatorGuidance,
  getAddressConsistencyReviewQueueInfo,
  getAddressConsistencyTriageSignals,
  canApproveAddressConsistencyRecord,
  getAddressConsistencyStatus,
  hasUnconfirmedPublicMapLocation,
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
    expect(getAddressConsistencyDisplayLabel({ geocoding_success: true })).toBe('일치');
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
    expect(getAddressConsistencyLabel({ geocoding_success: false, geocoding_false_stage: 2, status: 'deleted' })).toBe('-');
    expect(getAddressConsistencyDisplayLabel({ geocoding_success: false, geocoding_false_stage: 2, status: 'deleted' })).toBe('-');
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
      label: '검토',
      reason: '주소 지오코딩은 회복됐지만 지도 상호 후보가 없습니다.',
    });
  });
  test('keeps unconfirmed youtube-inferred coordinates off the public map approval path', () => {
    const record = {
      status: 'pending',
      geocoding_success: true,
      evaluation_results: {
        location_match_TF: {
          pending_reason: 'ambiguous_chain',
          eval_value: false,
        },
      },
    } as const;
    expect(hasUnconfirmedPublicMapLocation(record)).toBe(true);
    expect(getAddressConsistencyStatus(record)).toBe('review');
    expect(canApproveAddressConsistencyRecord(record)).toBe(false);
  });
  test('blocks geo-true insufficient_evidence from public-map approval', () => {
    const record = {
      status: 'pending',
      geocoding_success: true,
      evaluation_results: {
        location_match_TF: {
          pending_reason: 'insufficient_evidence',
          eval_value: false,
        },
      },
    } as const;
    expect(hasUnconfirmedPublicMapLocation(record)).toBe(true);
    expect(getAddressConsistencyStatus(record)).toBe('review');
    expect(canApproveAddressConsistencyRecord(record)).toBe(false);
    expect(explainAddressConsistency(record)).toMatchObject({
      label: '검토',
      headline: '검토 · 좌표는 있지만 영상에서 같은 가게로 확정할 근거가 부족합니다.',
      reason: '후보를 확정할 독립 근거가 부족합니다.',
    });
    expect(explainAddressConsistency(record).headline).not.toContain('회복');
    expect(getAddressConsistencyOperatorGuidance(record)).toMatchObject({
      label: '검토',
      tone: 'warning',
      possibleCause: expect.stringContaining('좌표는 있지만'),
    });
  });

  test('does not treat geo-false insufficient_evidence as an unconfirmed public pin', () => {
    const record = {
      status: 'pending',
      geocoding_success: false,
      geocoding_false_stage: 2,
      evaluation_results: {
        location_match_TF: {
          pending_reason: 'insufficient_evidence',
          eval_value: false,
        },
      },
    } as const;
    expect(hasUnconfirmedPublicMapLocation(record)).toBe(false);
    expect(getAddressConsistencyStatus(record)).toBe('false');
    expect(canApproveAddressConsistencyRecord(record)).toBe(false);
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
      label: '검토',
      tone: 'info',
    });
  });

  test('labels geocode-recovered review queue as additional review instead of hard mismatch', () => {
    const record = {
      geocoding_success: false,
      geocoding_false_stage: 2,
      status: 'pending',
      origin_address: { address: '서울 동작구 사당로 293' },
      db_error_details: {
        address_consistency_review: {
          queue: 'geocode_recovered_review',
          reason_ko: '주소 지오코딩은 회복됐지만 지도 상호 후보가 없습니다.',
        },
      },
      evaluation_results: {
        location_match_TF: {
          eval_value: false,
          falseMessage: 'Naver 실패 (2단계 실패: 20m 이내 후보 없음)',
          pending_reason: 'insufficient_evidence',
        },
      },
    } as const;

    expect(getAddressConsistencyLabel(record)).toBe('Review');
    expect(getAddressConsistencyDisplayLabel(record)).toBe('검토');
    expect(explainAddressConsistency(record)).toMatchObject({
      label: '검토',
      headline: expect.stringContaining('검토'),
      reason: '주소 지오코딩은 회복됐지만 지도 상호 후보가 없습니다.',
    });
  });

  test('separates high-evidence mismatch rows as promotion candidates without auto-approval', () => {
    const record = {
      geocoding_success: false,
      geocoding_false_stage: 2,
      status: 'pending',
      origin_name: '제기식당',
      naver_name: '제기식당',
      origin_address: { address: '서울 동대문구 제기동 123' },
      road_address: '서울 동대문구 제기동 123',
      youtube_meta: {
        title: '제기동 노포 맛집 방문',
        publishedAt: '2024-03-01',
      },
      reasoning_basis: '영상 제목과 자막 모두 제기식당 방문 근거를 제공합니다.',
      description_map_url: 'https://map.example/place/1',
      trace_id_name_source: 'youtube_title',
      db_error_details: {
        address_consistency_review: {
          ahp_score: 98.6,
          ahp_label: '정정 승인 후보',
          evidence_families: ['provider_candidate', 'source_geo', 'cross_provider'],
        },
      },
      evaluation_results: {
        location_match_TF: {
          eval_value: false,
          pending_reason: 'insufficient_evidence',
          evidence_families: ['provider_candidate', 'source_geo'],
        },
      },
    } as const;

    expect(getAddressConsistencyLabel(record)).toBe('Candidate');
    expect(getAddressConsistencyDisplayLabel(record)).toBe('검토');
    expect(canApproveAddressConsistencyRecord(record)).toBe(false);
    expect(getAddressConsistencyOperatorGuidance(record)).toMatchObject({
      label: '검토',
      tone: 'info',
    });
    expect(explainAddressConsistency(record)).toMatchObject({
      label: '검토',
      headline: expect.stringContaining('자동 일치 처리하지 않고'),
      reason: expect.stringContaining('AHP 98.6점'),
    });
    expect(explainAddressConsistency(record).evidence).toEqual(expect.arrayContaining([
      '영상 제목: 제기동 노포 맛집 방문',
      '영상 게시일: 2024-03-01',
      '영상 설명 지도 URL: https://map.example/place/1',
      '이름 출처: youtube_title',
      '원본명: 제기식당',
    ]));
    expect(getAddressConsistencyTriageSignals(record).map((signal) => signal.kind)).toContain('promotion_candidate');
  });

  test('surfaces collected business state, alias, name conflict, and duplicate signals', () => {
    const record = {
      geocoding_success: false,
      geocoding_false_stage: 2,
      status: 'db_conflict',
      origin_name: '진주식당((구) 진주집)',
      naver_name: '만나손칼국수',
      youtube_meta: {
        title: '진주식당 구상호 진주집 방문',
        publishedAt: '2023-01-01',
      },
      reasoning_basis: '현재는 폐업 또는 이전 가능성이 있고 구상호가 언급됩니다.',
      trace_id_name_source: 'caption_old_name',
      db_error_details: {
        error_type: 'duplicate',
        similarity_score: 0.91,
        conflicting_restaurant: {
          id: 'r1',
          name: '진주식당',
          jibun_address: '서울 중구 예시로 1',
        },
      },
      evaluation_results: {
        location_match_TF: {
          eval_value: false,
          falseMessage: '후보 상호가 영상 언급명과 다릅니다.',
        },
      },
    } as const;

    expect(getAddressConsistencyDisplayLabel(record)).toBe('불일치');
    expect(getAddressConsistencyTriageSignals(record).map((signal) => signal.kind)).toEqual(expect.arrayContaining([
      'business_state_risk',
      'legacy_alias_risk',
      'name_conflict_risk',
      'duplicate_risk',
    ]));
    expect(explainAddressConsistency(record).evidence).toEqual(expect.arrayContaining([
      '영상 제목: 진주식당 구상호 진주집 방문',
      '이름 출처: caption_old_name',
      '원본명: 진주식당((구) 진주집)',
    ]));
  });

  test('summarizes optional AHP 98+ review metadata with guarded redaction', () => {
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
      suggestedAction: '영상 제목·발행일, 원본명, 후보 주소, 지도 URL/추론 근거를 한 번 더 대조한 뒤 수정 승인으로 전환하세요.',
      hardGate: '사람 확인 후 정정 승인',
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
