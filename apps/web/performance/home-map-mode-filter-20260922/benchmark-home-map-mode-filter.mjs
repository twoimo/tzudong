// 홈 지도 국내/해외 모드 목록 필터(getRestaurantListByMode) 최적화 전후 비교 벤치마크.
// 실행: bun apps/web/performance/home-map-mode-filter-20260922/benchmark-home-map-mode-filter.mjs
//
// 측정 항목
// - 모드별(국내 / 해외 / 해외+국가 키워드) 목록 1회 처리 시간(중앙값, p95)
// - 결과 동등성(유지되는 id 순서와 객체 정체성)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { OVERSEAS_REGIONS } from '../../constants/overseas-regions';
import {
  filterHomeMapRestaurantsByMode,
  getOverseasCountryKeywords,
} from '../../lib/home-map-mode-filter';

const KOREA_BOUNDS = { minLat: 33, maxLat: 39, minLng: 124, maxLng: 132 };
const OVERSEAS_KEYWORDS = Object.values(OVERSEAS_REGIONS).flatMap((config) =>
  config.keywords.map((keyword) => keyword.toLowerCase()),
);

// ---- 최적화 이전 구현(컴포넌트 안에 있던 원본) 동결 ----
const oldAddressText = (restaurant) =>
  ((restaurant.road_address || '') + ' ' + (restaurant.jibun_address || '') + ' ' + (restaurant.english_address || '')).toLowerCase();

const oldIsOverseasByCoordinate = (restaurant) => {
  const lat = Number(restaurant.lat);
  const lng = Number(restaurant.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return (
    lat < KOREA_BOUNDS.minLat ||
    lat > KOREA_BOUNDS.maxLat ||
    lng < KOREA_BOUNDS.minLng ||
    lng > KOREA_BOUNDS.maxLng
  );
};

const oldFilter = (restaurants, mapMode, countryKeywords) =>
  restaurants.filter((restaurant) => {
    const addressText = oldAddressText(restaurant);
    const hasOverseasKeyword = OVERSEAS_KEYWORDS.some((keyword) => addressText.includes(keyword));
    const isOverseasCoord = oldIsOverseasByCoordinate(restaurant);

    if (mapMode === 'domestic') {
      return !hasOverseasKeyword && !isOverseasCoord;
    }

    if (countryKeywords && countryKeywords.length) {
      return countryKeywords.some((keyword) => addressText.includes(keyword));
    }

    return hasOverseasKeyword || isOverseasCoord;
  });

// ---- 재현 가능한 입력 데이터 ----
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const KOREAN_DISTRICTS = ['강남구', '서초구', '마포구', '송파구', '용산구', '분당구', '수영구', '해운대구'];
const KOREAN_ROADS = ['테헤란로', '강남대로', '양재천로', '월드컵로', '한강대로', '중앙로', '번영로', '센텀중앙로'];
const OVERSEAS_ROWS = [
  { road: 'Bangkok Sukhumvit Road 11', jibun: '방콕 수쿰빗 11', english: 'Sukhumvit Bangkok', lat: 13.74, lng: 100.56 },
  { road: '오사카 심사이바시 1-1', jibun: '오사카 주오구', english: 'Osaka Chuo-ku', lat: 34.69, lng: 135.5 },
  { road: 'Tokyo Shibuya 2-1', jibun: '도쿄 시부야', english: 'Shibuya Tokyo', lat: 35.66, lng: 139.7 },
  { road: 'Paris Rue de Rivoli 5', jibun: '파리 리볼리', english: 'Rivoli Paris', lat: 48.86, lng: 2.35 },
  { road: 'New York 5th Avenue 100', jibun: '뉴욕 5번가', english: '5th Avenue New York', lat: 40.75, lng: -73.98 },
];

function buildFixture(size, seed) {
  const random = createRandom(seed);
  const rows = [];

  for (let index = 0; index < size; index += 1) {
    const district = KOREAN_DISTRICTS[index % KOREAN_DISTRICTS.length];
    const road = KOREAN_ROADS[index % KOREAN_ROADS.length];
    const overseas = index % 5 === 2 && random() < 0.8;

    if (overseas) {
      const row = OVERSEAS_ROWS[Math.floor(random() * OVERSEAS_ROWS.length)];
      rows.push({
        id: 'row-' + index,
        road_address: row.road,
        jibun_address: row.jibun,
        english_address: row.english,
        lat: row.lat,
        lng: row.lng,
      });
      continue;
    }

    rows.push({
      id: 'row-' + index,
      road_address: '서울 ' + district + ' ' + road + ' ' + (10 + (index % 900)),
      jibun_address: '서울 ' + district + ' ' + (index % 900) + '-' + (index % 20),
      english_address: road + ' ' + district,
      lat: 37.4 + (index % 500) / 1000,
      lng: 126.9 + (index % 500) / 1000,
    });
  }

  return rows;
}

const PROFILES = [
  { id: 'domestic', mode: 'domestic', country: null },
  { id: 'overseas-plain', mode: 'overseas', country: null },
  { id: 'overseas-country', mode: 'overseas', country: '태국(방콕)' },
];

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const madRelative = (values, med) => median(values.map((value) => Math.abs(value - med))) / med;

const percentile = (values, ratio) => {
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(ratio * sorted.length) - 1));
  return sorted[index];
};

// 개선 후 구현은 호출 1회가 타이머 분해능보다 짧습니다. 구현마다 반복 횟수를 따로
// 보정해 표본을 같은 측정 창에 넣고, 표본을 반복 횟수로 나눠 호출 1회 시간을
// 비교합니다. 반복 횟수는 구현별로 다르지만 비교 지표는 호출 1회 시간입니다.
//
// 측정 창이 짧으면 타이머 양자화가 상대 MAD 를 부풀려 노이즈 예산을 넘깁니다.
// 창을 12ms 로 두고, 보정도 1회 호출이 아니라 64회 묶음을 재서 호출 1회 시간을
// 추정합니다(1회 측정은 분해능 이하라 추정 자체가 노이즈가 됩니다).
const MEASUREMENT_TARGET_MS = 12;
const MEASUREMENT_MAX_ITERATIONS = 4096;

const measureOnce = (run, repetitions) => {
  const samples = [];
  for (let index = 0; index < repetitions; index += 1) {
    const startedAt = performance.now();
    run();
    samples.push(performance.now() - startedAt);
  }
  return samples;
};

const calibrateIterations = (run) => {
  for (let index = 0; index < 64; index += 1) run();
  const probeIterations = 64;
  const probe = median(measureOnce(() => {
    for (let inner = 0; inner < probeIterations; inner += 1) run();
  }, 5)) / probeIterations;
  if (!(probe > 0)) return MEASUREMENT_MAX_ITERATIONS;
  return Math.max(1, Math.min(MEASUREMENT_MAX_ITERATIONS, Math.round(MEASUREMENT_TARGET_MS / probe)));
};

const measure = (run, iterations, repetitions) => {
  for (let index = 0; index < 5; index += 1) run();
  const samples = measureOnce(() => {
    for (let inner = 0; inner < iterations; inner += 1) run();
  }, repetitions).map((value) => value / iterations);
  const med = median(samples);
  return { medianMs: med, p95Ms: percentile(samples, 0.95), madRelative: madRelative(samples, med) };
};

const BUDGETS = {
  absolute: {
    listP95MsMax: 16,
    rule: '목록 1회 필터 p95는 한 프레임(16ms) 이하여야 합니다.',
  },
  relative: {
    minMedianSpeedup: 2,
    rule: '중앙값 기준 2배 이상 빨라져야 개선으로 인정합니다.',
  },
  noise: {
    madRelativeMax: 0.15,
    repetitions: 21,
    rule: '각 구현의 반복 표본 MAD/중앙값이 15% 이내이고, 중앙값 개선폭이 양쪽 상대 노이즈 합보다 클 때만 개선으로 인정합니다.',
  },
};

const REPETITIONS = BUDGETS.noise.repetitions;
const SIZES = [300, 1000, 2000, 4000];
const MEASUREMENTS = [];

let equivalence = 'identical';
let mismatches = 0;

for (const size of SIZES) {
  const rows = buildFixture(size, 20260922 + size);

  for (const profile of PROFILES) {
    const keywords = getOverseasCountryKeywords(profile.country);
    const beforeRows = oldFilter(rows, profile.mode, keywords);
    const afterRows = filterHomeMapRestaurantsByMode(rows, profile.mode, keywords);
    const sameOrder =
      beforeRows.length === afterRows.length &&
      beforeRows.every((row, index) => row === afterRows[index]);

    if (!sameOrder) {
      equivalence = 'divergent';
      mismatches += 1;
    }

    const beforeIterations = calibrateIterations(() => oldFilter(rows, profile.mode, keywords));
    const afterIterations = calibrateIterations(() => filterHomeMapRestaurantsByMode(rows, profile.mode, keywords));
    const before = measure(() => oldFilter(rows, profile.mode, keywords), beforeIterations, REPETITIONS);
    const after = measure(() => filterHomeMapRestaurantsByMode(rows, profile.mode, keywords), afterIterations, REPETITIONS);

    MEASUREMENTS.push({
      size,
      profile: profile.id,
      keptCount: afterRows.length,
      beforeIterations,
      afterIterations,
      beforeMedianMs: Number(before.medianMs.toFixed(3)),
      beforeP95Ms: Number(before.p95Ms.toFixed(3)),
      beforeMadRelative: Number(before.madRelative.toFixed(4)),
      afterMedianMs: Number(after.medianMs.toFixed(3)),
      afterP95Ms: Number(after.p95Ms.toFixed(3)),
      afterMadRelative: Number(after.madRelative.toFixed(4)),
      speedupByMedian: Number((before.medianMs / after.medianMs).toFixed(2)),
      speedupByP95: Number((before.p95Ms / after.p95Ms).toFixed(2)),
    });
  }
}

const worstSpeedup = Math.min(...MEASUREMENTS.map((entry) => entry.speedupByMedian));
const absoluteBudgetMet = MEASUREMENTS.every((entry) => entry.afterP95Ms <= BUDGETS.absolute.listP95MsMax);
const relativeBudgetMet = MEASUREMENTS.every((entry) => entry.speedupByMedian >= BUDGETS.relative.minMedianSpeedup);
const noiseWithinBudget = MEASUREMENTS.every(
  (entry) => entry.beforeMadRelative <= BUDGETS.noise.madRelativeMax && entry.afterMadRelative <= BUDGETS.noise.madRelativeMax,
);
const combinedRelativeNoise = Number(
  Math.max(...MEASUREMENTS.map((entry) => entry.beforeMadRelative + entry.afterMadRelative)).toFixed(4),
);
const deltaExceedsNoise = worstSpeedup - 1 > combinedRelativeNoise;

const report = {
  generatedAt: new Date().toISOString(),
  baselineSource: {
    file: 'apps/web/performance/home-map-mode-filter-20260922/benchmark-home-map-mode-filter.mjs',
    note: '이전 경로는 근사가 아니라 추출 직전 구현(getRestaurantListByMode)을 이 스크립트 안에 동결한 사본입니다.',
  },
  workload: {
    sizes: SIZES,
    profiles: PROFILES.map((profile) => profile.id),
    overseasRatioTarget: 0.16,
    repetitions: REPETITIONS,
    measurementTargetMs: MEASUREMENT_TARGET_MS,
    iterationRule: '구현마다 반복 횟수를 보정해 표본을 약 12ms 창에 넣고, 표본을 반복 횟수로 나눠 호출 1회 시간을 비교합니다.',
  },
  equivalence,
  mismatches,
  budgets: BUDGETS,
  measurements: MEASUREMENTS,
  acceptance: {
    absoluteBudgetMet,
    relativeBudgetMet,
    noiseWithinBudget,
    combinedRelativeNoise,
    worstSpeedupByMedian: Number(worstSpeedup.toFixed(2)),
    deltaExceedsNoise,
    accepted: absoluteBudgetMet && relativeBudgetMet && noiseWithinBudget && deltaExceedsNoise && equivalence === 'identical',
  },
  ratio: {
    worstProfile: MEASUREMENTS.reduce((worst, entry) => (entry.speedupByMedian < worst.speedupByMedian ? entry : worst), MEASUREMENTS[0]),
    largestSizeSpeedups: MEASUREMENTS.filter((entry) => entry.size === SIZES[SIZES.length - 1]).map((entry) => ({
      profile: entry.profile,
      speedupByMedian: entry.speedupByMedian,
      speedupByP95: entry.speedupByP95,
    })),
  },
};

const outputPath = join(dirname(fileURLToPath(import.meta.url)), 'benchmark.json');
writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report, null, 2) + '\n');
