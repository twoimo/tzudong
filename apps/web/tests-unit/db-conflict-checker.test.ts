import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';

const queryState: {
  rows: unknown[] | null;
  selectError: unknown;
  updateError: null | { message: string };
} = {
  rows: [],
  selectError: null,
  updateError: null,
};

const calls = {
  from: [] as string[],
  select: [] as string[],
  neq: [] as Array<[string, unknown]>,
  eq: [] as Array<[string, unknown]>,
  update: [] as Array<Record<string, unknown>>,
};

function makeQuery() {
  let operation: 'select' | 'update' = 'select';
  const query = {
    select(columns: string) {
      operation = 'select';
      calls.select.push(columns);
      return query;
    },
    neq(column: string, value: unknown) {
      calls.neq.push([column, value]);
      return query;
    },
    eq(column: string, value: unknown) {
      calls.eq.push([column, value]);
      return query;
    },
    update(payload: Record<string, unknown>) {
      operation = 'update';
      calls.update.push(payload);
      return query;
    },
    then(resolve: (value: unknown) => void) {
      resolve(operation === 'update'
        ? { data: [], error: queryState.updateError }
        : { data: queryState.rows, error: queryState.selectError });
    },
  };
  return query;
}

const from = mock((table: string) => {
  calls.from.push(table);
  return makeQuery();
});

mock.module('@/integrations/supabase/client', () => ({
  supabase: { from },
}));

mock.module('@/lib/debug-log', () => ({
  debugLog: () => undefined,
}));

mock.module('@/lib/dashboard/helpers', () => ({
  extractVideoIdFromYoutubeLink: (value?: string | null) => {
    if (!value) return null;
    try {
      const url = new URL(value);
      if (url.hostname === 'youtu.be') return url.pathname.slice(1) || null;
      if (url.pathname.startsWith('/shorts/')) return url.pathname.slice('/shorts/'.length) || null;
      return url.searchParams.get('v');
    } catch {
      return null;
    }
  },
}));

const {
  checkDbConflict,
  checkRestaurantDuplicate,
  mergeRestaurantData,
} = await import('../lib/db-conflict-checker.ts?unit-contract');

const consoleError = spyOn(console, 'error').mockImplementation(() => undefined);

beforeEach(() => {
  queryState.rows = [];
  queryState.selectError = null;
  queryState.updateError = null;
  calls.from.length = 0;
  calls.select.length = 0;
  calls.neq.length = 0;
  calls.eq.length = 0;
  calls.update.length = 0;
  from.mockClear();
  consoleError.mockClear();
});

afterAll(() => {
  consoleError.mockRestore();
  mock.restore();
});

describe('db conflict checker', () => {
  test('detects a duplicate by normalized address and similar name', async () => {
    queryState.rows = [{
      id: 'restaurant-1',
      name: '을지면옥',
      jibun_address: '서울 중구 을지로 10 2층 201호',
      road_address: '서울 중구 을지로 10',
      status: 'approved',
      youtube_link: null,
    }];

    const result = await checkRestaurantDuplicate('을지면옥', '서울 중구 을지로 10');

    expect(result.isDuplicate).toBe(true);
    expect(result.similarityScore).toBe(1);
    expect(result.matchedRestaurant).toMatchObject({
      id: 'restaurant-1',
      name: '을지면옥',
      jibun_address: '서울 중구 을지로 10 2층 201호',
    });
    expect(calls.neq).toContainEqual(['status', 'deleted']);
  });

  test('detects a same-video duplicate before address matching', async () => {
    queryState.rows = [{
      id: 'restaurant-video',
      name: '원조국밥',
      jibun_address: '부산 중구 다른길 99',
      road_address: null,
      status: 'approved',
      youtube_link: 'https://youtu.be/video-123',
    }];

    const result = await checkRestaurantDuplicate(
      '원조국밥',
      '서울 중구 을지로 10',
      undefined,
      'https://www.youtube.com/watch?v=video-123',
    );

    expect(result.isDuplicate).toBe(true);
    expect(result.matchedRestaurant?.id).toBe('restaurant-video');
    expect(result.reason).toContain('같은 YouTube 영상');
  });

  test('returns no duplicate for empty or missing candidate data', async () => {
    queryState.rows = null;
    await expect(checkRestaurantDuplicate('', '')).resolves.toEqual({
      isDuplicate: false,
      similarityScore: 0,
    });

    queryState.rows = [{
      id: 'missing-address',
      name: '',
      jibun_address: null,
      road_address: null,
      status: 'approved',
      youtube_link: null,
    }];
    await expect(checkRestaurantDuplicate('아무집', '서울 중구 10')).resolves.toEqual({
      isDuplicate: false,
      similarityScore: 0,
    });
  });

  test('excludes the edited record and propagates Supabase read errors', async () => {
    const denied = { message: 'permission denied' };
    queryState.selectError = denied;

    await expect(checkRestaurantDuplicate('식당', '주소', 'self-id')).rejects.toBe(denied);
    expect(calls.neq).toEqual([
      ['status', 'deleted'],
      ['id', 'self-id'],
    ]);
  });

  test('classifies same-address same-video different-name conflicts first', async () => {
    queryState.rows = [
      {
        id: 'name-mismatch',
        name: '기존식당',
        jibun_address: '서울 중구 세종대로 1 3층',
        youtube_link: 'https://youtu.be/a',
      },
      {
        id: 'merge-candidate',
        name: '새식당',
        jibun_address: '서울 중구 세종대로 1',
        youtube_link: 'https://youtu.be/b',
      },
    ];

    const result = await checkDbConflict({
      jibunAddress: ' 서울 중구 세종대로 1 ',
      restaurantName: ' 새식당 ',
      youtubeLink: ' https://youtu.be/a ',
    });

    expect(result.hasConflict).toBe(true);
    expect(result.conflictType).toBe('name_mismatch');
    expect(result.conflictingRestaurants?.map((row) => row.id)).toEqual(['name-mismatch']);
    expect(calls.eq).toContainEqual(['status', 'approved']);
  });

  test('classifies merge-needed records and ignores rows with missing addresses', async () => {
    queryState.rows = [
      {
        id: 'missing-address',
        name: '새식당',
        jibun_address: null,
        youtube_link: 'https://youtu.be/other',
      },
      {
        id: 'merge-candidate',
        name: '새식당',
        jibun_address: '서울 중구 세종대로 1 101호',
        youtube_link: 'https://youtu.be/other',
      },
    ];

    const result = await checkDbConflict({
      jibunAddress: '서울 중구 세종대로 1',
      restaurantName: '새식당',
      youtubeLink: 'https://youtu.be/current',
      excludeRestaurantId: 'self-id',
    });

    expect(result).toMatchObject({ hasConflict: true, conflictType: 'merge_needed' });
    expect(result.conflictingRestaurants?.map((row) => row.id)).toEqual(['merge-candidate']);
    expect(calls.eq).toContainEqual(['status', 'approved']);
    expect(calls.neq).toContainEqual(['id', 'self-id']);
  });

  test('returns no conflict for no matching rows and propagates conflict-read errors', async () => {
    queryState.rows = [];
    await expect(checkDbConflict({
      jibunAddress: '서울 중구 1',
      restaurantName: '새식당',
      youtubeLink: 'https://youtu.be/current',
    })).resolves.toEqual({ hasConflict: false });

    const denied = { message: 'row-level security denied' };
    queryState.selectError = denied;
    await expect(checkDbConflict({
      jibunAddress: '서울 중구 1',
      restaurantName: '새식당',
      youtubeLink: 'https://youtu.be/current',
    })).rejects.toBe(denied);
  });

  test('merges only missing scalar values, adds a unique category, and applies the optimistic-lock predicates', async () => {
    const result = await mergeRestaurantData({
      existingRestaurant: {
        id: 'existing-id',
        youtube_link: 'https://youtu.be/existing',
        youtube_meta: { title: 'existing' },
        tzuyang_review: null,
        categories: '한식',
        updated_at: '2026-09-20T01:02:03.000Z',
      },
      newYoutubeLink: 'https://youtu.be/new',
      newYoutubeMeta: { title: 'new' },
      newTzuyangReview: '새 리뷰',
      newCategory: '분식',
    });

    expect(result).toEqual({ success: true });
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0]).toMatchObject({
      youtube_link: 'https://youtu.be/existing',
      youtube_meta: { title: 'existing' },
      tzuyang_review: '새 리뷰',
      categories: ['한식', '분식'],
    });
    expect(typeof calls.update[0].updated_at).toBe('string');
    expect(calls.eq).toEqual([
      ['id', 'existing-id'],
      ['updated_at', '2026-09-20T01:02:03.000Z'],
    ]);
  });

  test('maps optimistic-lock-looking update errors separately from generic update failures', async () => {
    const base = {
      existingRestaurant: {
        id: 'existing-id',
        youtube_link: null,
        youtube_meta: null,
        tzuyang_review: null,
        categories: [] as string[],
        updated_at: '2026-09-20T01:02:03.000Z',
      },
      newYoutubeLink: 'https://youtu.be/new',
    };

    queryState.updateError = { message: 'updated_at condition failed' };
    await expect(mergeRestaurantData(base)).resolves.toEqual({
      success: false,
      error: '다른 관리자가 수정했습니다. 새로고침 후 다시 시도하세요.',
    });

    queryState.updateError = { message: 'permission denied' };
    await expect(mergeRestaurantData(base)).resolves.toEqual({
      success: false,
      error: '병합 처리에 실패했습니다.',
    });
  });
});
