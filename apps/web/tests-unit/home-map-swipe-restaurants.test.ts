import { describe, expect, test } from 'bun:test';
import {
  dedupeHomeMapRestaurants,
  hasSameSwipeCoordinates,
  isSameRestaurantForSwipe,
} from '../lib/home-map-swipe-restaurants';
import type { Restaurant } from '../types/restaurant';

const makeRestaurant = (overrides: Partial<Restaurant> & { id: string }): Restaurant => ({
  name: '맛집',
  lat: 37.5,
  lng: 127.0,
  ...overrides,
} as Restaurant);

// O(n^2) pairwise 구현(추출 전 원본을 동결한 사본). 결과 동등성을 증명하는 기준입니다.
const referenceIsSameRestaurantForSwipe = (a: Restaurant, b: Restaurant) => {
  if (a.id === b.id) return true;

  if (a.mergedRestaurants?.some((restaurant) => restaurant.id === b.id)) return true;
  if (b.mergedRestaurants?.some((restaurant) => restaurant.id === a.id)) return true;

  if (a.name === b.name && a.lat && a.lng && b.lat && b.lng) {
    const aLat = Number(a.lat);
    const aLng = Number(a.lng);
    const bLat = Number(b.lat);
    const bLng = Number(b.lng);

    if (
      Number.isFinite(aLat) &&
      Number.isFinite(aLng) &&
      Number.isFinite(bLat) &&
      Number.isFinite(bLng) &&
      Math.abs(aLat - bLat) < 0.0001 &&
      Math.abs(aLng - bLng) < 0.0001
    ) {
      return true;
    }
  }

  return false;
};

const referenceDedupe = (restaurants: Restaurant[]) => {
  const unique: Restaurant[] = [];
  for (const restaurant of restaurants) {
    if (!restaurant) continue;
    if (unique.some((existing) => referenceIsSameRestaurantForSwipe(existing, restaurant))) continue;
    unique.push(restaurant);
  }
  return unique;
};

const createRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const buildFixture = (size: number, seed: number) => {
  const random = createRandom(seed);
  const rows: Restaurant[] = [];
  for (let index = 0; index < size; index += 1) {
    const group = Math.floor(index / 3);
    const duplicateId = index % 3 !== 0 && random() < 0.5;
    const id = duplicateId ? `row-${index - 1}` : `row-${index}`;
    const sameNameCluster = random() < 0.35;
    rows.push(makeRestaurant({
      id,
      name: sameNameCluster ? `동일이름 ${group}` : `맛집 ${index}`,
      lat: sameNameCluster ? 37.5 + (group % 40) / 1000 : 37.5 + random(),
      lng: sameNameCluster ? 127.0 + (group % 40) / 1000 : 127.0 + random(),
      mergedRestaurants: index % 5 === 0
        ? [makeRestaurant({ id: `row-${index + 1}` }), makeRestaurant({ id: `row-${index + 3}` })]
        : undefined,
    }));
  }
  return rows;
};

describe('home map swipe restaurant dedupe', () => {
  test('matches the pairwise reference over randomized fixtures', () => {
    for (const seed of [11, 20260921, 7777, 424242]) {
      const rows = buildFixture(400, seed);
      const optimized = dedupeHomeMapRestaurants(rows);
      const reference = referenceDedupe(rows);

      expect(optimized.map((row) => row.id)).toEqual(reference.map((row) => row.id));
      expect(optimized.every((row, index) => row === reference[index])).toBe(true);
    }
  });

  test('matches the reference when merged ids point backwards and forwards', () => {
    const rows = [
      makeRestaurant({ id: 'a', name: 'A', lat: 37.1, lng: 127.1, mergedRestaurants: [makeRestaurant({ id: 'b', name: 'B', lat: 37.2, lng: 127.2 })] }),
      makeRestaurant({ id: 'b', name: 'B', lat: 37.2, lng: 127.2 }),
      makeRestaurant({ id: 'c', name: 'C', lat: 37.3, lng: 127.3 }),
      makeRestaurant({ id: 'd', name: 'D', lat: 37.4, lng: 127.4, mergedRestaurants: [makeRestaurant({ id: 'c', name: 'C', lat: 37.3, lng: 127.3 })] }),
      makeRestaurant({ id: 'e', name: 'E', lat: 37.5, lng: 127.5, mergedRestaurants: [makeRestaurant({ id: 'a', name: 'A', lat: 37.1, lng: 127.1 })] }),
    ];

    expect(dedupeHomeMapRestaurants(rows).map((row) => row.id)).toEqual(['a', 'c']);
    expect(dedupeHomeMapRestaurants(rows).map((row) => row.id))
      .toEqual(referenceDedupe(rows).map((row) => row.id));
  });

  test('treats the same id as a duplicate and keeps the first occurrence', () => {
    const first = makeRestaurant({ id: 'same' });
    const second = makeRestaurant({ id: 'same' });
    const unique = dedupeHomeMapRestaurants([first, second]);

    expect(unique).toEqual([first]);
  });

  test('drops a later restaurant that shares name and coordinates', () => {
    const rows = [
      makeRestaurant({ id: 'one', name: '같은집', lat: 37.5, lng: 127.0 }),
      makeRestaurant({ id: 'two', name: '같은집', lat: 37.50009, lng: 127.0 }),
    ];

    expect(dedupeHomeMapRestaurants(rows).map((row) => row.id)).toEqual(['one']);
  });

  test('keeps restaurants with the same name but coordinates past the tolerance', () => {
    const rows = [
      makeRestaurant({ id: 'one', name: '같은집', lat: 37.5, lng: 127.0 }),
      makeRestaurant({ id: 'two', name: '같은집', lat: 37.5001, lng: 127.0 }),
      makeRestaurant({ id: 'three', name: '다른집', lat: 37.5, lng: 127.0 }),
    ];

    expect(dedupeHomeMapRestaurants(rows).map((row) => row.id)).toEqual(['one', 'two', 'three']);
  });

  test('treats null, zero, and non-numeric coordinates as not comparable', () => {
    const rows = [
      makeRestaurant({ id: 'null-lat', name: '좌표없음', lat: null, lng: null }),
      makeRestaurant({ id: 'null-lat-2', name: '좌표없음', lat: null, lng: null }),
      makeRestaurant({ id: 'zero', name: '영점', lat: 0, lng: 0 }),
      makeRestaurant({ id: 'zero-2', name: '영점', lat: 0, lng: 0 }),
    ];

    expect(dedupeHomeMapRestaurants(rows).map((row) => row.id))
      .toEqual(['null-lat', 'null-lat-2', 'zero', 'zero-2']);
  });

  test('maps an empty list, a single row, and falsy rows without throwing', () => {
    expect(dedupeHomeMapRestaurants([])).toEqual([]);
    const only = makeRestaurant({ id: 'only' });
    expect(dedupeHomeMapRestaurants([only])).toEqual([only]);
    expect(dedupeHomeMapRestaurants([null as unknown as Restaurant, only]).map((row) => row.id))
      .toEqual(['only']);
  });

  test('isSameRestaurantForSwipe keeps the pairwise contract', () => {
    const base = makeRestaurant({ id: 'base', name: '이름', lat: 37.5, lng: 127.0 });

    expect(isSameRestaurantForSwipe(base, base)).toBe(true);
    expect(isSameRestaurantForSwipe(base, makeRestaurant({ id: 'x', name: '이름', lat: 37.50009, lng: 127.0 }))).toBe(true);
    expect(isSameRestaurantForSwipe(base, makeRestaurant({ id: 'y', name: '이름', lat: 38.5, lng: 127.0 }))).toBe(false);
    expect(isSameRestaurantForSwipe(base, makeRestaurant({ id: 'z', name: '다른이름', lat: 37.5, lng: 127.0 }))).toBe(false);
    expect(isSameRestaurantForSwipe(
      makeRestaurant({ id: 'owner', mergedRestaurants: [makeRestaurant({ id: 'merged' })] }),
      makeRestaurant({ id: 'merged', name: '무관', lat: 1, lng: 1 }),
    )).toBe(true);
  });

  test('hasSameSwipeCoordinates is false when either coordinate is missing', () => {
    const full = makeRestaurant({ id: 'full', lat: 37.5, lng: 127.0 });

    expect(hasSameSwipeCoordinates(full, makeRestaurant({ id: 'a', lat: null, lng: 127.0 }))).toBe(false);
    expect(hasSameSwipeCoordinates(full, makeRestaurant({ id: 'b', lat: 37.5, lng: null }))).toBe(false);
    expect(hasSameSwipeCoordinates(full, full)).toBe(true);
  });
});
