import { describe, expect, test } from 'bun:test';

import {
  buildRestaurantRegionAddressOrFilter,
  excludeRestaurantsAlreadyShown,
  getRestaurantRegionAddressKeywords,
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
