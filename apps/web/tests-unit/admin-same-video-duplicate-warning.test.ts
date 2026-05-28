import { describe, expect, test } from 'bun:test';

import {
  findSameVideoDuplicateWarningCandidates,
  formatSameVideoDuplicateWarning,
} from '@/lib/admin-same-video-duplicate-warning';

const baseRow = (overrides = {}) => ({
  id: 'target',
  origin_name: '만나떡볶이',
  approved_name: null,
  naver_name: null,
  google_name: null,
  phone: '02-123-4567',
  status: 'pending',
  road_address: '서울 중구 세종대로 1',
  jibun_address: '서울 중구 태평로1가 1',
  youtube_link: 'https://www.youtube.com/watch?v=AwD_Nh-HwZU',
  updated_by_admin_id: null,
  lat: 37.1,
  lng: 127.1,
  ...overrides,
});

describe('same-video duplicate warning candidates', () => {
  test('warns for same-video exact identity candidates', () => {
    const candidates = findSameVideoDuplicateWarningCandidates(baseRow(), [
      baseRow({ id: 'other', origin_name: '만나 떡볶이', status: 'approved', updated_by_admin_id: 'admin-1' }),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].rule).toBe('exact_identity');
    expect(candidates[0].adminTouched).toBe(true);
  });

  test('does not warn across different videos or deleted rows', () => {
    const candidates = findSameVideoDuplicateWarningCandidates(baseRow(), [
      baseRow({ id: 'other-video', youtube_link: 'https://www.youtube.com/watch?v=RaEdXdld830' }),
      baseRow({ id: 'deleted', status: 'deleted' }),
    ]);

    expect(candidates).toHaveLength(0);
  });

  test('formats an operator-facing concise warning', () => {
    const message = formatSameVideoDuplicateWarning([
      { id: 'other', name: '만나떡볶이', status: 'approved', address: '서울', adminTouched: true, rule: 'exact_identity', confidence: 1 },
    ]);

    expect(message).toContain('같은 영상에서 중복 후보 1건');
    expect(message).toContain('승인/삭제/수정 전');
  });
});
