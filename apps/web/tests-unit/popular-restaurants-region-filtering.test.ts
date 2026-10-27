import { describe, expect, test } from 'bun:test';

import {
  buildRestaurantRegionAddressOrFilter,
  excludeRestaurantsAlreadyShown,
  getRestaurantRegionAddressKeywords,
  latestRestaurantSortTime,
  matchesRestaurantAddressContext,
} from '@/lib/popular-restaurants';
import type { Restaurant } from '@/types/restaurant';

function restaurantWithAddress(
  address: Partial<
    Pick<Restaurant, 'road_address' | 'jibun_address' | 'english_address'>
  >,
): Restaurant {
  return {
    id: 'restaurant-id',
    approved_name: '테스트 맛집',
    name: '테스트 맛집',
    status: 'approved',
    weekly_search_count: 1,
    ...address,
  } as Restaurant;
}

describe('popular restaurant region filtering', () => {
  test('matches modern and legacy province names for domestic filters', () => {
    expect(getRestaurantRegionAddressKeywords('강원특별자치도')).toEqual([
      '강원특별자치도',
      '강원도',
      '강원',
    ]);

    expect(
      matchesRestaurantAddressContext(
        restaurantWithAddress({ road_address: '강원도 강릉시 경강로' }),
        '강원특별자치도',
        true,
      ),
    ).toBe(true);
    expect(
      matchesRestaurantAddressContext(
        restaurantWithAddress({ jibun_address: '전라북도 전주시 완산구' }),
        '전북특별자치도',
        true,
      ),
    ).toBe(true);
  });

  test('keeps island filters visible even when the address uses county names', () => {
    expect(
      matchesRestaurantAddressContext(
        restaurantWithAddress({ road_address: '경상북도 울릉군 울릉읍' }),
        '울릉도',
        true,
      ),
    ).toBe(true);
    expect(
      matchesRestaurantAddressContext(
        restaurantWithAddress({ road_address: '경상남도 통영시 욕지면' }),
        '욕지도',
        true,
      ),
    ).toBe(true);
  });

  test('builds a Supabase OR filter before query limits are applied', () => {
    expect(buildRestaurantRegionAddressOrFilter('서울특별시')).toBe(
      [
        'road_address.ilike.%서울특별시%',
        'jibun_address.ilike.%서울특별시%',
        'english_address.ilike.%서울특별시%',
        'road_address.ilike.%서울시%',
        'jibun_address.ilike.%서울시%',
        'english_address.ilike.%서울시%',
        'road_address.ilike.%서울%',
        'jibun_address.ilike.%서울%',
        'english_address.ilike.%서울%',
      ].join(','),
    );

    expect(buildRestaurantRegionAddressOrFilter(null)).toBeNull();
  });

  test.each([
    ['일본(오사카)', '일본 Osaka, Chuo Ward, Dotonbori', '일본 〒064-0805 Hokkaido, Sapporo, Chuo Ward, Minami 5 Jonishi'],
    ['일본(삿포로)', '일본 〒064-0805 Hokkaido, Sapporo, Chuo Ward, Minami 5 Jonishi', '일본 Osaka, Chuo Ward, Dotonbori'],
    ['미국(LA)', '미국 Los Angeles, California', '미국 Times Building, 250 W 41st St, New York, NY 10036'],
    ['미국(뉴욕)', '미국 Times Building, 250 W 41st St, New York, NY 10036', '미국 Los Angeles, California'],
    ['인도네시아(자카르타)', '인도네시아 Jakarta Pusat', '인도네시아 Ubud, Bali'],
    ['인도네시아(발리)', '인도네시아 Ubud, Bali', '인도네시아 Jakarta Pusat'],
  ])('keeps %s within its city across all address fields', (region, matchingAddress, otherCityAddress) => {
    for (const field of ['road_address', 'jibun_address', 'english_address'] as const) {
      expect(
        matchesRestaurantAddressContext(
          restaurantWithAddress({ [field]: matchingAddress }),
          region,
          false,
        ),
      ).toBe(true);
      expect(
        matchesRestaurantAddressContext(
          restaurantWithAddress({ [field]: otherCityAddress }),
          region,
          false,
        ),
      ).toBe(false);
    }
  });

  test.each(['osaka', 'OSAKA', 'oSaKa'])('matches %s address casing like the server city filter', (city) => {
    for (const field of ['road_address', 'jibun_address', 'english_address'] as const) {
      expect(
        matchesRestaurantAddressContext(
          restaurantWithAddress({ [field]: '일본 ' + city + ', Chuo Ward' }),
          '일본(오사카)',
          false,
        ),
      ).toBe(true);
      expect(
        matchesRestaurantAddressContext(
          restaurantWithAddress({ [field]: '일본 sApPoRo, Hokkaido' }),
          '일본(오사카)',
          false,
        ),
      ).toBe(false);
    }
  });

  test('normalizes an exact overseas city without adding the generic country', () => {
    expect(getRestaurantRegionAddressKeywords(' 일본(오사카) ')).toEqual([
      'Osaka',
      '오사카',
    ]);
  });

  test.each(['%', '*'] as const)('builds city-only server OR clauses with %s wildcards', (wildcard) => {
    const filter = buildRestaurantRegionAddressOrFilter('일본(오사카)', wildcard);

    expect(filter).toBe([
      `road_address.ilike.${wildcard}Osaka${wildcard}`,
      `jibun_address.ilike.${wildcard}Osaka${wildcard}`,
      `english_address.ilike.${wildcard}Osaka${wildcard}`,
      `road_address.ilike.${wildcard}오사카${wildcard}`,
      `jibun_address.ilike.${wildcard}오사카${wildcard}`,
      `english_address.ilike.${wildcard}오사카${wildcard}`,
    ].join(','));
    expect(filter).not.toContain('일본');
  });

  test('keeps a country-only selection broad enough for Osaka and Sapporo', () => {
    const osaka = restaurantWithAddress({ road_address: '일본 Osaka, Chuo Ward, Dotonbori' });
    const sapporo = restaurantWithAddress({ english_address: '일본 〒064-0805 Hokkaido, Sapporo, Chuo Ward, Minami 5 Jonishi' });
    const newYork = restaurantWithAddress({ jibun_address: '미국 New York, NY 10036' });

    expect(matchesRestaurantAddressContext(osaka, '일본', false)).toBe(true);
    expect(matchesRestaurantAddressContext(sapporo, '일본', false)).toBe(true);
    expect(matchesRestaurantAddressContext(newYork, '일본', false)).toBe(false);
    expect(buildRestaurantRegionAddressOrFilter('일본')).toContain('road_address.ilike.%일본%');
    expect(buildRestaurantRegionAddressOrFilter('일본')).toContain('english_address.ilike.%Osaka%');
    expect(buildRestaurantRegionAddressOrFilter('일본')).toContain('english_address.ilike.%Sapporo%');
  });

  test.each([null, undefined])('preserves unselected %s and the domestic-only guard', (region) => {
    const domestic = restaurantWithAddress({ road_address: '서울특별시 중구 세종대로 110' });
    const overseas = restaurantWithAddress({ english_address: '일본 Osaka, Chuo Ward, Dotonbori' });

    expect(buildRestaurantRegionAddressOrFilter(region)).toBeNull();
    expect(matchesRestaurantAddressContext(overseas, region, false)).toBe(true);
    expect(matchesRestaurantAddressContext(overseas, region, true)).toBe(false);
    expect(matchesRestaurantAddressContext(domestic, region, true)).toBe(true);
  });

  test('keeps latest restaurants visible when they already appear in the popular list', () => {
    const garden = restaurantWithAddress({ road_address: '서울특별시 중구 세종대로 110' });
    const myeongdong = {
      ...restaurantWithAddress({ road_address: '서울특별시 중구 을지로 30' }),
      id: 'restaurant-id-2',
    };

    expect(excludeRestaurantsAlreadyShown([garden, myeongdong], new Set([garden.id, myeongdong.id]))).toEqual([
      garden,
      myeongdong,
    ]);
    expect(excludeRestaurantsAlreadyShown([garden, myeongdong, garden], new Set([garden.id]))).toEqual([
      myeongdong,
    ]);
  });
});

describe('latest restaurant recency', () => {
  test('orders by the YouTube publish time instead of the row insert time', () => {
    const olderVideoInsertedLater = restaurantWithAddress({});
    olderVideoInsertedLater.created_at = '2026-08-23T16:39:25.083Z';
    olderVideoInsertedLater.youtube_meta = { publishedAt: '2026-07-17T13:05:57Z' };

    const newerVideo = restaurantWithAddress({});
    newerVideo.created_at = '2026-08-06T00:00:00.000Z';
    newerVideo.youtube_meta = { publishedAt: '2026-08-20T13:15:44Z' };

    const undated = restaurantWithAddress({});
    undated.created_at = '2026-09-01T00:00:00.000Z';
    undated.youtube_meta = null;

    const latestOrder = [olderVideoInsertedLater, newerVideo, undated].sort(
      (a, b) => latestRestaurantSortTime(b, 'latest') - latestRestaurantSortTime(a, 'latest'),
    );
    expect(latestOrder.map((restaurant) => restaurant.youtube_meta?.publishedAt ?? 'undated')).toEqual([
      '2026-08-20T13:15:44Z',
      '2026-07-17T13:05:57Z',
      'undated',
    ]);

    const oldestOrder = [olderVideoInsertedLater, newerVideo, undated].sort(
      (a, b) => latestRestaurantSortTime(a, 'oldest') - latestRestaurantSortTime(b, 'oldest'),
    );
    expect(oldestOrder.map((restaurant) => restaurant.youtube_meta?.publishedAt ?? 'undated')).toEqual([
      '2026-07-17T13:05:57Z',
      '2026-08-20T13:15:44Z',
      'undated',
    ]);
  });
});
