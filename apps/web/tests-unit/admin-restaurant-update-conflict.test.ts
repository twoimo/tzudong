import { beforeEach, describe, expect, mock, test } from 'bun:test';

const queryState: { rows: unknown[]; error: unknown } = {
  rows: [],
  error: null,
};

const makeQuery = () => ({
  select: mock(function () { return this; }),
  neq: mock(function () { return this; }),
  then(resolve: (value: unknown) => void) {
    resolve({ data: queryState.rows, error: queryState.error });
  },
});

const from = mock(() => makeQuery());

mock.module('@/integrations/supabase/client', () => ({
  supabase: { from },
}));

const loadModule = () => import('../lib/admin-restaurant-update-conflict');

describe('admin restaurant update identity conflicts', () => {
  beforeEach(() => {
    from.mockClear();
    queryState.rows = [];
    queryState.error = null;
  });

  test('detects a same-video active identity that would trigger the DB unique index', async () => {
    queryState.rows = [
      {
        id: 'approved-row',
        approved_name: '춘천냉면',
        origin_name: '청량리할머니냉면',
        naver_name: '할머니냉면',
        google_name: null,
        status: 'approved',
        road_address: '서울특별시 동대문구 왕산로37길 50',
        jibun_address: '서울특별시 동대문구 청량리동 733',
        youtube_link: 'https://www.youtube.com/watch?v=GQyNACahbyM',
        updated_at: '2026-05-01T00:00:00Z',
      },
    ];

    const { findActiveRestaurantIdentityConflict } = await loadModule();
    const conflict = await findActiveRestaurantIdentityConflict({
      restaurantId: 'pending-row',
      restaurantName: '춘천냉면',
      youtubeLink: 'https://www.youtube.com/watch?v=GQyNACahbyM',
    });

    expect(conflict?.id).toBe('approved-row');
    expect(conflict?.name).toBe('춘천냉면');
  });

  test('formats Supabase 409 unique-index errors as actionable admin guidance', async () => {
    const {
      formatActiveRestaurantIdentityConflictMessage,
      isActiveRestaurantIdentityConflictError,
    } = await loadModule();

    const error = {
      code: '23505',
      status: 409,
      message: 'duplicate key value violates unique constraint "idx_restaurants_active_video_identity"',
    };

    expect(isActiveRestaurantIdentityConflictError(error)).toBe(true);
    expect(formatActiveRestaurantIdentityConflictMessage({
      restaurantName: '춘천냉면',
      conflict: {
        id: 'approved-row',
        name: '춘천냉면',
        status: 'approved',
        road_address: '서울특별시 동대문구 왕산로37길 50',
        jibun_address: null,
        youtube_link: 'https://www.youtube.com/watch?v=GQyNACahbyM',
        updated_at: '2026-05-01T00:00:00Z',
      },
    })).toContain('기존 레코드를 병합/삭제 처리');
  });
});
