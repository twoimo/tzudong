import { describe, expect, test } from 'bun:test';

import { adminEvaluationGapLabel, compareAdminEvaluationsByLatestDesc } from '@/lib/admin/evaluation-records';
import type { EvaluationRecord } from '@/types/evaluation';

function record(
  id: string,
  publishedAt: string | null,
  createdAt: string,
): EvaluationRecord {
  return {
    id,
    created_at: createdAt,
    youtube_meta: publishedAt
      ? {
          title: id,
          publishedAt,
          is_shorts: false,
          duration: 1,
          ads_info: { is_ads: false, what_ads: null },
        }
      : null,
  } as EvaluationRecord;
}

describe('admin evaluation latest order', () => {
  test('sorts by the visible date descending, using the video date before the insert time', () => {
    const olderVideoInsertedLater = record('later-insert', '2026-07-17T13:05:57Z', '2026-08-23T16:39:25Z');
    const newerVideo = record('newer-video', '2026-08-20T13:15:44Z', '2026-08-06T00:00:00Z');
    const undated = record('undated', null, '2026-09-01T00:00:00Z');

    const ordered = [olderVideoInsertedLater, undated, newerVideo].sort(compareAdminEvaluationsByLatestDesc);

    expect(ordered.map((item) => item.id)).toEqual(['undated', 'newer-video', 'later-insert']);
  });
});

describe('admin evaluation gap labels', () => {
  test('names why a row has no review scores', () => {
    expect(adminEvaluationGapLabel('shorts:is_shorts_le_180')).toBe('쇼츠');
    expect(adminEvaluationGapLabel('not_selected:no_named_restaurant_target')).toBe('맛집명 없음');
    expect(adminEvaluationGapLabel('맛집 검색 결과 없음으로 관리자 검수 자동 삭제')).toBe('검색 결과 없음');
    expect(adminEvaluationGapLabel(null)).toBeNull();
  });
});
