import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OVERSEAS_REGIONS } from '../constants/overseas-regions';
import type { Restaurant } from '../types/restaurant';
import {
  filterHomeMapRestaurantsByMode,
  getOverseasCountryKeywords,
  isOverseasCoordinate,
  resolveHomeMapAddressText,
} from '../lib/home-map-mode-filter';

type FixtureRow = {
  id: string;
  road_address?: string | null;
  jibun_address?: string | null;
  english_address?: string | null;
  lat?: number | string | null;
  lng?: number | string | null;
};

const asRestaurant = (row: FixtureRow) => row as unknown as Restaurant;
const asRestaurants = (rows: FixtureRow[]) => rows.map(asRestaurant);

// ---- 최적화 이전 구현(컴포넌트 안에 있던 원본) 동결 ----
const KOREA_BOUNDS = { minLat: 33, maxLat: 39, minLng: 124, maxLng: 132 } as const;
const OVERSEAS_KEYWORDS = Object.values(OVERSEAS_REGIONS).flatMap((config) =>
  config.keywords.map((keyword) => keyword.toLowerCase()),
);

const oldAddressText = (row: FixtureRow) =>
  [row.road_address || '', row.jibun_address || '', row.english_address || ''].join(' ').toLowerCase();

const oldIsOverseasByCoordinate = (row: FixtureRow) => {
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return (
    lat < KOREA_BOUNDS.minLat ||
    lat > KOREA_BOUNDS.maxLat ||
    lng < KOREA_BOUNDS.minLng ||
    lng > KOREA_BOUNDS.maxLng
  );
};

const oldFilter = (
  rows: FixtureRow[],
  mapMode: 'domestic' | 'overseas',
  countryKeywords: string[] | null,
) =>
  rows.filter((row) => {
    const addressText = oldAddressText(row);
    const hasOverseasKeyword = OVERSEAS_KEYWORDS.some((keyword) => addressText.includes(keyword));
    const isOverseasCoord = oldIsOverseasByCoordinate(row);
    if (mapMode === 'domestic') return !hasOverseasKeyword && !isOverseasCoord;
    if (countryKeywords?.length) return countryKeywords.some((keyword) => addressText.includes(keyword));
    return hasOverseasKeyword || isOverseasCoord;
  });

const createRandom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const OVERSEAS_SAMPLES = ['Bangkok', '오사카', 'Los Angeles', 'budapest', 'AICHI', 'Sydney'];
const DOMESTIC_SAMPLES = ['서울 강남구 테헤란로', '부산 해운대구', '경기 성남시 분당구', '제주 서귀포시'];

const buildFixture = (size: number, seed: number): FixtureRow[] => {
  const random = createRandom(seed);
  const rows: FixtureRow[] = [];

  for (let index = 0; index < size; index += 1) {
    const shape = index % 10;
    const isOverseasAddress = shape === 1 || shape === 4 || shape === 7;
    const address = isOverseasAddress
      ? OVERSEAS_SAMPLES[index % OVERSEAS_SAMPLES.length]!
      : DOMESTIC_SAMPLES[index % DOMESTIC_SAMPLES.length]!;

    const row: FixtureRow = {
      id: 'row-' + index,
      road_address: shape === 5 ? null : address,
      jibun_address: shape === 6 ? undefined : address,
      english_address: shape === 3 ? '' : address,
      lat: 37.5 + random() * 0.5,
      lng: 127.0 + random() * 0.5,
    };

    if (shape === 0) {
      row.lat = 33;
      row.lng = 124;
    }
    if (shape === 2) {
      row.lat = 35.6812;
      row.lng = 139.7671;
    }
    if (shape === 8) {
      row.lat = 'not-a-number';
      row.lng = null;
    }
    if (shape === 9) {
      row.lat = undefined;
      row.lng = undefined;
    }

    rows.push(row);
  }

  return rows;
};

describe('home map mode filter', () => {
  test('이전 구현과 같은 목록을 같은 순서와 같은 객체 정체성으로 돌려준다', () => {
    const rows = buildFixture(400, 20260921);
    const restaurants = asRestaurants(rows);
    const indexById = new Map(rows.map((row, index) => [row.id, index]));

    const cases: { mode: 'domestic' | 'overseas'; keywords: string[] | null }[] = [
      { mode: 'domestic', keywords: null },
      { mode: 'overseas', keywords: null },
      { mode: 'overseas', keywords: [] },
      ...Object.keys(OVERSEAS_REGIONS).map((country) => ({
        mode: 'overseas' as const,
        keywords: getOverseasCountryKeywords(country),
      })),
    ];

    for (const { mode, keywords } of cases) {
      const expected = oldFilter(rows, mode, keywords);
      const actual = filterHomeMapRestaurantsByMode(restaurants, mode, keywords);

      expect(actual.map((restaurant) => restaurant.id)).toEqual(expected.map((row) => row.id));
      expect(actual).not.toBe(restaurants);
      expect(
        actual.every(
          (restaurant, index) =>
            restaurant === restaurants[indexById.get(expected[index]!.id)!],
        ),
      ).toBe(true);
    }
  });

  test('빈 목록과 빈 주소는 안전하게 처리한다', () => {
    expect(filterHomeMapRestaurantsByMode([], 'domestic', null)).toEqual([]);
    expect(filterHomeMapRestaurantsByMode([], 'overseas', null)).toEqual([]);

    const blank = asRestaurants([
      { id: 'blank', road_address: null, jibun_address: undefined, english_address: '' },
    ]);

    expect(resolveHomeMapAddressText(blank[0]!)).toBe('  ');
    expect(filterHomeMapRestaurantsByMode(blank, 'domestic', null)).toHaveLength(1);
    expect(filterHomeMapRestaurantsByMode(blank, 'overseas', null)).toHaveLength(0);
  });

  test('주소 키워드 판정은 대소문자를 구분하지 않는다', () => {
    const upper = asRestaurants([
      { id: 'upper', road_address: 'BANGKOK SUKHUMVIT', lat: 13.7, lng: 100.5 },
    ]);

    expect(resolveHomeMapAddressText(upper[0]!)).toBe('bangkok sukhumvit  ');
    expect(filterHomeMapRestaurantsByMode(upper, 'overseas', null)).toHaveLength(1);
    expect(filterHomeMapRestaurantsByMode(upper, 'domestic', null)).toHaveLength(0);
    expect(filterHomeMapRestaurantsByMode(upper, 'overseas', getOverseasCountryKeywords('태국(방콕)'))).toHaveLength(1);
  });

  test('주소에 해외 키워드가 있으면 국내 좌표여도 국내 목록에서 빠진다', () => {
    const rows = asRestaurants([
      { id: 'korean-name-overseas', road_address: '서울 오사카식당', lat: 37.5, lng: 127.0 },
      { id: 'plain', road_address: '서울 강남구', lat: 37.5, lng: 127.0 },
    ]);

    expect(filterHomeMapRestaurantsByMode(rows, 'domestic', null).map((row) => row.id)).toEqual(['plain']);
    expect(filterHomeMapRestaurantsByMode(rows, 'overseas', null).map((row) => row.id)).toEqual(['korean-name-overseas']);
  });

  test('좌표 판정은 경계값과 숫자가 아닌 값을 이전 구현과 같게 본다', () => {
    const cases: { row: FixtureRow; overseas: boolean }[] = [
      { row: { id: 'min', lat: 33, lng: 124 }, overseas: false },
      { row: { id: 'max', lat: 39, lng: 132 }, overseas: false },
      { row: { id: 'below', lat: 32.999, lng: 127 }, overseas: true },
      { row: { id: 'above', lat: 39.001, lng: 127 }, overseas: true },
      { row: { id: 'west', lat: 37.5, lng: 123.999 }, overseas: true },
      { row: { id: 'east', lat: 37.5, lng: 132.001 }, overseas: true },
      { row: { id: 'nan', lat: Number.NaN, lng: 127 }, overseas: false },
      { row: { id: 'text', lat: 'not-a-number', lng: 127 }, overseas: false },
      { row: { id: 'missing', lat: undefined, lng: undefined }, overseas: false },
      // Number(null) === 0 이므로 좌표가 null 인 행은 이전 구현에서도 해외로 분류됩니다.
      // 동작을 바꾸지 않는다는 원칙에 따라 그대로 고정합니다.
      { row: { id: 'null', lat: null, lng: null }, overseas: true },
      { row: { id: 'string-number', lat: '35.68', lng: '139.69' }, overseas: true },
    ];

    for (const { row, overseas } of cases) {
      expect(isOverseasCoordinate(asRestaurant(row))).toBe(overseas);
      expect(oldIsOverseasByCoordinate(row)).toBe(overseas);
    }
  });

  test('국가 키워드는 알려진 국가에서만 만들어진다', () => {
    expect(getOverseasCountryKeywords(null)).toBeNull();
    expect(getOverseasCountryKeywords(undefined)).toBeNull();
    expect(getOverseasCountryKeywords('')).toBeNull();
    expect(getOverseasCountryKeywords('존재하지않는나라')).toBeNull();
    expect(getOverseasCountryKeywords('태국(방콕)')).toEqual(['bangkok', '방콕']);
    expect(getOverseasCountryKeywords('일본(오사카)')).toEqual(['osaka', '오사카']);
  });

  test('주소 문자열 캐시는 같은 객체를 제자리에서 고쳐도 새 값을 반영한다', () => {
    const row: FixtureRow = { id: 'mutating', road_address: '서울', jibun_address: '서울', english_address: '' };
    const restaurant = asRestaurant(row);

    expect(resolveHomeMapAddressText(restaurant)).toBe('서울 서울 ');
    row.road_address = 'Bangkok';
    expect(resolveHomeMapAddressText(restaurant)).toBe('bangkok 서울 ');
    expect(filterHomeMapRestaurantsByMode([restaurant], 'domestic', null)).toHaveLength(0);
    expect(filterHomeMapRestaurantsByMode([restaurant], 'overseas', null)).toHaveLength(1);
  });

  test('모드 분류는 컴포넌트 밖 헬퍼를 쓰고 식당별 키워드 includes 루프를 남기지 않는다', () => {
    const component = readFileSync(
      join(import.meta.dir, '..', 'components', 'home', 'home-map-container.tsx'),
      'utf8',
    );

    expect(component).toContain("from '@/lib/home-map-mode-filter'");
    expect(component).toContain('filterHomeMapRestaurantsByMode');
    expect(component).toContain('getOverseasCountryKeywords');
    expect(component).not.toContain('OVERSEAS_KEYWORDS');
    expect(component).not.toContain('getRestaurantAddressText');
    expect(component).not.toContain('isOverseasByCoordinate');
  });
});
