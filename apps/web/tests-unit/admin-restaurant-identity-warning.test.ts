import { describe, expect, test } from 'bun:test';

import {
  findRestaurantIdentityWarnings,
  formatRestaurantIdentityWarning,
  hasBlockingRestaurantIdentityWarning,
} from '@/lib/admin-restaurant-identity-warning';

const base = (overrides = {}) => ({
  id: 'target',
  origin_name: '진주식당',
  naver_name: '만나손칼국수',
  status: 'pending',
  youtube_link: 'https://www.youtube.com/watch?v=CPWwPVs5Ib4',
  evaluation_results: {
    location_match_TF: { eval_value: true },
    visit_authenticity: { eval_value: 0, eval_basis: '영상은 진주식당을 방문했고 만나손칼국수는 언급되지 않음' },
    rb_inference_score: { eval_value: 0, eval_basis: '결과 이름을 만나손칼국수로 특정하는 것은 비약' },
  },
  ...overrides,
});

describe('restaurant identity warnings', () => {
  test('blocks provider candidates whose name contradicts the video-mentioned restaurant', () => {
    const warnings = findRestaurantIdentityWarnings(base());

    expect(warnings.map((warning) => warning.rule)).toContain('provider_name_mismatch');
    expect(warnings.map((warning) => warning.rule)).toContain('contradictory_visit_evidence');
    expect(hasBlockingRestaurantIdentityWarning(warnings)).toBe(true);
    expect(formatRestaurantIdentityWarning(warnings)).toContain('승인 차단');
  });

  test('warns when a branch/location token is stripped from an otherwise compatible name', () => {
    const warnings = findRestaurantIdentityWarnings(base({
      origin_name: '정원분식 웨이브파크점',
      naver_name: '정원분식',
      youtube_link: 'https://www.youtube.com/watch?v=G3pQQeL47wI',
      evaluation_results: { location_match_TF: { eval_value: true } },
    }));

    expect(warnings).toHaveLength(1);
    expect(warnings[0].rule).toBe('missing_branch_context');
    expect(warnings[0].severity).toBe('warn');
  });

  test('warns active rows that match an already deleted same-video identity tombstone', () => {
    const warnings = findRestaurantIdentityWarnings(base(), [
      base({ id: 'deleted', status: 'deleted', naver_name: '만나손칼국수' }),
    ]);

    expect(warnings.map((warning) => warning.rule)).toContain('deleted_same_video_identity');
    expect(warnings.find((warning) => warning.rule === 'deleted_same_video_identity')?.severity).toBe('warn');
  });

  test('allows manual approval name override when it matches the source identity', () => {
    const warnings = findRestaurantIdentityWarnings(base(), [], { approvedNameOverride: '진주식당' });

    expect(warnings.some((warning) => warning.rule === 'provider_name_mismatch')).toBe(false);
    expect(warnings.some((warning) => warning.rule === 'contradictory_visit_evidence')).toBe(false);
  });
});
