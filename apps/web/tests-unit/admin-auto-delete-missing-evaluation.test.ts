import { describe, expect, test } from 'bun:test';

import {
  MISSING_EVALUATION_AUTO_DELETE_MESSAGE,
  getMissingEvaluationAutoDeleteReason,
  shouldAutoDeleteMissingEvaluationRecord,
} from '@/lib/admin-auto-delete-missing-evaluation';

const baseRecord = (overrides = {}) => ({
  id: 'missing-1',
  status: 'pending',
  is_missing: false,
  is_not_selected: false,
  approved_name: null,
  naver_name: null,
  google_name: null,
  road_address: null,
  jibun_address: null,
  lat: null,
  lng: null,
  db_error_message: null,
  evaluation_results: {
    location_match_TF: {
      eval_value: false,
      match_status: 'failed',
      falseMessage: '네이버 지도 검색 결과 없음',
    },
  },
  ...overrides,
});

describe('admin missing evaluation auto delete rule', () => {
  test('auto-deletes explicit missing rows from active review queues', () => {
    const record = baseRecord({ status: 'missing', is_missing: true });

    expect(shouldAutoDeleteMissingEvaluationRecord(record)).toBe(true);
    expect(getMissingEvaluationAutoDeleteReason(record)).toContain('missing');
    expect(MISSING_EVALUATION_AUTO_DELETE_MESSAGE).toContain('자동 삭제');
  });

  test('auto-deletes provider no-result rows only when there is no usable candidate', () => {
    expect(shouldAutoDeleteMissingEvaluationRecord(baseRecord())).toBe(true);
    expect(shouldAutoDeleteMissingEvaluationRecord(baseRecord({ naver_name: '진주식당' }))).toBe(false);
    expect(shouldAutoDeleteMissingEvaluationRecord(baseRecord({ road_address: '서울 중구 세종대로 1' }))).toBe(false);
  });

  test('never auto-deletes approved, rejected, deleted, or conflict rows', () => {
    for (const status of ['approved', 'rejected', 'deleted', 'db_conflict'] as const) {
      expect(shouldAutoDeleteMissingEvaluationRecord(baseRecord({ status, is_missing: true }))).toBe(false);
    }
  });
});
