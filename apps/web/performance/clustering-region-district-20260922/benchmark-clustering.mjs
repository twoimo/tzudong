// 행정구역/자치구 클러스터링(clustering.ts) 최적화 전후 비교 벤치마크.
// 실행: bun apps/web/performance/clustering-region-district-20260922/benchmark-clustering.mjs
//
// 측정 항목
// - 지도 화면이 실제로 한 번에 호출하는 3개 호출 묶음(effectRun): getRegionalClusters 1회 +
//   getSeoulDistrictClusters(minClusterSize=1) 1회 + getSeoulDistrictClusters(minClusterSize=3) 1회
// - 개별 호출 시간(중앙값, p95)
// - 결과 동등성(클러스터 순서, id 순서, 카테고리 순서, 중심 좌표)
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  REGIONAL_CENTERS,
  SEOUL_DISTRICT_CENTERS,
  getDistance,
  getRegionalClusters,
  getSeoulDistrictClusters,
} from '../../lib/clustering';

// ---- 최적화 이전 구현 동결 (커밋 9894d594 의 lib/clustering.ts 사본) ----
const oldExtractRegionFromAddress = (restaurant) => {
  const address = restaurant.road_address || restaurant.jibun_address || '';

  for (const region of Object.keys(REGIONAL_CENTERS)) {
    if (address.includes(region)) {
      return region;
    }
  }

  const shortNames = {
    "서울": "서울특별시",
    "부산": "부산광역시",
    "대구": "대구광역시",
    "인천": "인천광역시",
    "광주": "광주광역시",
    "대전": "대전광역시",
    "울산": "울산광역시",
    "세종": "세종특별자치시",
    "경기": "경기도",
    "충북": "충청북도",
    "충남": "충청남도",
    "전남": "전라남도",
    "경북": "경상북도",
    "경남": "경상남도",
    "전북": "전북특별자치도",
    "강원": "강원특별자치도",
    "제주": "제주특별자치도",
    "울릉": "울릉도",
  };

  for (const [short, full] of Object.entries(shortNames)) {
    if (address.startsWith(short)) {
      return full;
    }
  }

  return null;
};

const oldFindNearestRegion = (lat, lng) => {
  let nearestRegion = "서울특별시";
  let minDistance = Infinity;

  for (const [region, center] of Object.entries(REGIONAL_CENTERS)) {
    const distance = getDistance(lat, lng, center.lat, center.lng);
    if (distance < minDistance) {
      minDistance = distance;
      nearestRegion = region;
    }
  }

  return nearestRegion;
};

const oldGetRegionalClusters = (restaurants) => {
  const regionMap = new Map();

  for (const region of Object.keys(REGIONAL_CENTERS)) {
    regionMap.set(region, { restaurantIds: [], categories: new Map() });
  }

  restaurants.forEach((restaurant) => {
    if (!restaurant.lat || !restaurant.lng) return;

    let region = oldExtractRegionFromAddress(restaurant);

    if (!region) {
      region = oldFindNearestRegion(restaurant.lat, restaurant.lng);
    }

    const group = regionMap.get(region);
    if (group) {
      group.restaurantIds.push(restaurant.id);

      const category = Array.isArray(restaurant.categories)
        ? restaurant.categories[0]
        : (restaurant.category || '기타');
      if (category) {
        const count = group.categories.get(category) || 0;
        group.categories.set(category, count + 1);
      }
    }
  });

  const clusters = [];

  for (const [region, group] of regionMap.entries()) {
    if (group.restaurantIds.length > 0) {
      clusters.push({
        region,
        center: REGIONAL_CENTERS[region],
        count: group.restaurantIds.length,
        restaurantIds: group.restaurantIds,
        categories: Array.from(group.categories.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(entry => entry[0]),
      });
    }
  }

  return clusters;
};

const oldGetSeoulDistrictClusters = (restaurants, minClusterSize = 1) => {
  const districtMap = new Map();

  const districtNames = Object.keys(SEOUL_DISTRICT_CENTERS);
  const districtEntries = Object.entries(SEOUL_DISTRICT_CENTERS);

  for (const district of districtNames) {
    districtMap.set(district, { restaurantIds: [], categories: new Map(), positions: [] });
  }

  restaurants.forEach((restaurant) => {
    if (!restaurant.lat || !restaurant.lng) return;

    const address = restaurant.road_address || restaurant.jibun_address || '';
    if (!address.includes('서울')) return;

    let district = null;
    for (const d of districtNames) {
      if (address.includes(d)) {
        district = d;
        break;
      }
    }

    if (!district) {
      let minDistance = Infinity;
      for (const [d, center] of districtEntries) {
        const distance = getDistance(restaurant.lat, restaurant.lng, center.lat, center.lng);
        if (distance < minDistance) {
          minDistance = distance;
          district = d;
        }
      }
    }

    if (district) {
      const group = districtMap.get(district);
      if (group) {
        group.restaurantIds.push(restaurant.id);
        group.positions.push({ lat: restaurant.lat, lng: restaurant.lng });
        const category = Array.isArray(restaurant.categories)
          ? restaurant.categories[0]
          : (restaurant.category || '기타');
        if (category) {
          const count = group.categories.get(category) || 0;
          group.categories.set(category, count + 1);
        }
      }
    }
  });

  const clusters = [];
  const individualRestaurantIds = [];

  for (const [district, group] of districtMap.entries()) {
    if (group.restaurantIds.length >= minClusterSize) {
      const centerLat = group.positions.reduce((sum, p) => sum + p.lat, 0) / group.positions.length;
      const centerLng = group.positions.reduce((sum, p) => sum + p.lng, 0) / group.positions.length;

      clusters.push({
        region: district,
        center: { lat: centerLat, lng: centerLng },
        count: group.restaurantIds.length,
        restaurantIds: group.restaurantIds,
        categories: Array.from(group.categories.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(entry => entry[0]),
      });
    } else if (group.restaurantIds.length > 0) {
      individualRestaurantIds.push(...group.restaurantIds);
    }
  }

  return { clusters, individualRestaurantIds };
};

// ---- 재현 가능한 입력 데이터 ----
function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const SEOUL_DISTRICTS = Object.keys(SEOUL_DISTRICT_CENTERS);
const KOREAN_CATEGORIES = ['한식', '분식', '고기', '카페·디저트', '중식', '일식', '양식'];
const OUTSIDE_ROWS = [
  { road: '경기도 성남시 분당구 판교역로 1', jibun: '경기 성남시 분당구 백현동 1', lat: 37.39, lng: 127.11 },
  { road: '부산광역시 해운대구 센텀중앙로 1', jibun: '부산 해운대구 우동 1', lat: 35.17, lng: 129.13 },
  { road: '강원특별자치도 춘천시 중앙로 1', jibun: '강원 춘천시 중앙로 1', lat: 37.88, lng: 127.72 },
  { road: '제주특별자치도 제주시 중문로 1', jibun: '제주 서귀포시 중문동 1', lat: 33.25, lng: 126.41 },
  { road: '대구광역시 중구 동성로 1', jibun: '대구 중구 동성로 1', lat: 35.87, lng: 128.6 },
  { road: '전북특별자치도 전주시 완산구 1', jibun: '전북 전주시 완산구 1', lat: 35.81, lng: 127.11 },
];

function buildFixture(size, seed) {
  const random = createRandom(seed);
  const rows = [];

  for (let index = 0; index < size; index += 1) {
    const shape = index % 20;

    // 좌표 없음
    if (shape === 17) {
      rows.push({ id: 'row-' + index, road_address: '서울 강남구 테헤란로 1', jibun_address: null, lat: null, lng: null, categories: ['한식'], review_count: 3 });
      continue;
    }
    // 주소 없음 (좌표만)
    if (shape === 18) {
      rows.push({ id: 'row-' + index, road_address: null, jibun_address: null, lat: 37.5 + random() / 100, lng: 127.0 + random() / 100, categories: ['분식'], review_count: 1 });
      continue;
    }
    // 서울 밖
    if (shape === 19 || shape === 11) {
      const row = OUTSIDE_ROWS[Math.floor(random() * OUTSIDE_ROWS.length)];
      rows.push({ id: 'row-' + index, road_address: row.road, jibun_address: row.jibun, lat: row.lat, lng: row.lng, categories: [KOREAN_CATEGORIES[index % KOREAN_CATEGORIES.length]], review_count: index % 7 });
      continue;
    }

    const district = SEOUL_DISTRICTS[index % SEOUL_DISTRICTS.length];
    const center = SEOUL_DISTRICT_CENTERS[district];
    rows.push({
      id: 'row-' + index,
      road_address: '서울 ' + district + ' ' + (index % 400) + '로 ' + (1 + (index % 200)),
      jibun_address: '서울 ' + district + ' ' + (index % 400) + '-' + (index % 30),
      lat: center.lat + (random() - 0.5) / 40,
      lng: center.lng + (random() - 0.5) / 40,
      categories: [KOREAN_CATEGORIES[index % KOREAN_CATEGORIES.length]],
      review_count: index % 11,
    });
  }

  return rows;
}

const oldEffectRun = (rows) => ({
  regional: oldGetRegionalClusters(rows),
  seoulAll: oldGetSeoulDistrictClusters(rows, 1),
  seoulFiltered: oldGetSeoulDistrictClusters(rows, 3),
});

const newEffectRun = (rows) => ({
  regional: getRegionalClusters(rows),
  seoulAll: getSeoulDistrictClusters(rows, 1),
  seoulFiltered: getSeoulDistrictClusters(rows, 3),
});

// 지도 화면은 displayRestaurants = restaurants.filter(...) 를 넘기므로 식당 객체
// 정체성은 유지됩니다(웜 경로). 목록을 새로 받아오면 객체가 새로 생깁니다(콜드 경로).
// 콜드 경로는 매 표본마다 얕은 복사로 새 객체를 만들어 캐시 미스 상황을 재현합니다.
const copyRows = (rows) => rows.map((row) => ({ ...row }));

// ---- 결과 동등성 판정 ----
const round = (value) => (Number.isFinite(value) ? Math.round(value * 1e12) / 1e12 : value);
const fingerprintCluster = (cluster) => [
  cluster.region,
  round(cluster.center.lat),
  round(cluster.center.lng),
  cluster.count,
  cluster.restaurantIds.join('|'),
  cluster.categories.join('|'),
];
const fingerprintRegional = (clusters) => clusters.map(fingerprintCluster);
const fingerprintSeoul = (result) => [result.clusters.map(fingerprintCluster), result.individualRestaurantIds];

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

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

// 콜드 경로 전용. 입력 준비(식당 객체 복사)는 타이머 밖에서 하므로 표본에는
// 클러스터링 시간만 들어갑니다. 반복 묶음 보정 없이 호출 1회를 그대로 잽니다.
//
// 콜드 표본은 매번 수천 개 객체를 새로 만들기 때문에 GC 상태에 민감합니다. 두 구현을
// 번갈아 재서 같은 GC 상태를 공유하게 하고(교차 측정), 표본 수를 늘려 중앙값을 씁니다.
const measureColdPair = (prepare, implementationA, implementationB, repetitions) => {
  for (let index = 0; index < 5; index += 1) {
    implementationA(prepare());
    implementationB(prepare());
  }

  const samplesA = [];
  const samplesB = [];

  for (let index = 0; index < repetitions; index += 1) {
    const inputA = prepare();
    const startedA = performance.now();
    implementationA(inputA);
    samplesA.push(performance.now() - startedA);

    const inputB = prepare();
    const startedB = performance.now();
    implementationB(inputB);
    samplesB.push(performance.now() - startedB);
  }

  const medA = median(samplesA);
  const medB = median(samplesB);
  return {
    a: { medianMs: medA, p95Ms: percentile(samplesA, 0.95), madRelative: madRelative(samplesA, medA) },
    b: { medianMs: medB, p95Ms: percentile(samplesB, 0.95), madRelative: madRelative(samplesB, medB) },
  };
};

const BUDGETS = {
  absolute: {
    effectRunP95MsMax: 16,
    rule: '지도 1회 갱신(3개 호출 묶음) p95는 한 프레임(16ms) 이하여야 합니다.',
  },
  relative: {
    warmBundleMinMedianSpeedup: 2,
    coldBundleMinMedianSpeedup: 1.3,
    rule: '실제 호출 경로(effect-run = 지도 갱신 3개 호출 묶음)는 웜(같은 목록/같은 객체) 중앙값 2배 이상, 콜드(목록 재조회) 1.3배 이상 빨라져야 합니다. 콜드 묶음은 캐시 미스라서 목록 파생 항목 생성, 항목-목록 일치 검증, 25개 구 초기화 같은 호출당 고정 비용을 그대로 내므로 웜보다 배수가 낮고, 공유 머신 부하에 따라 1.3~2.3배로 흔들립니다.',
  },
  noRegression: {
    rule: '개별 호출은 어느 크기/모드에서도 중앙값이 (1 - 양쪽 상대 MAD) 보다 느려지면 안 됩니다. 즉 측정 잡음보다 큰 역행만 실패로 봅니다. 앱 호출 경로가 아닌 단독 콜드 호출(diagnostic)은 JIT 승격에 따라 0.5x~1.1x 로 갈려 판정에서 제외합니다.',
  },
  noise: {
    madRelativeMax: 0.15,
    repetitions: 21,
    rule: '웜 표본(결론의 주 근거, 반복 묶음 보정으로 지터를 평균화)의 MAD/중앙값은 15% 이내여야 하고, 번들 개선폭은 그 표본 자체의 잡음 합보다 커야 합니다. 콜드 표본은 매 표본마다 식당 객체를 새로 만들어 GC 지터가 지배하므로(중앙값 MAD 15~40%) 예산에서 제외하되 표에는 그대로 남깁니다.',
  },
};

const REPETITIONS = BUDGETS.noise.repetitions;
const COLD_REPETITIONS = 101;
const SIZES = [300, 1000, 2000, 4000];

// 대조군: 같은 구현을 자기 자신과 비교합니다. 코드가 동일하므로 배수는 1.00 이어야
// 하고, 1.00 에서 벗어난 만큼이 측정 하네스 자체의 편향입니다.
const CONTROL_TARGETS = [
  { id: 'control-seoul-min1', implementation: (rows) => oldGetSeoulDistrictClusters(rows, 1) },
  { id: 'control-regional', implementation: (rows) => oldGetRegionalClusters(rows) },
];
const CONTROLS = [];
const TARGETS = [
  { id: 'effect-run', old: oldEffectRun, next: newEffectRun },
  { id: 'regional', old: oldGetRegionalClusters, next: getRegionalClusters },
  // 앱은 같은 목록으로 getRegionalClusters 를 먼저 부른 뒤 자치구 클러스터링을 부릅니다
  // (NaverMapView 지도 갱신 1회 = 3개 호출 묶음). 실제 단발 경로도 이 순서입니다.
  {
    id: 'seoul-min1-after-regional',
    old: (rows) => { oldGetRegionalClusters(rows); return oldGetSeoulDistrictClusters(rows, 1); },
    next: (rows) => { getRegionalClusters(rows); return getSeoulDistrictClusters(rows, 1); },
  },
  {
    id: 'seoul-min3-after-regional',
    old: (rows) => { oldGetRegionalClusters(rows); return oldGetSeoulDistrictClusters(rows, 3); },
    next: (rows) => { getRegionalClusters(rows); return getSeoulDistrictClusters(rows, 3); },
  },
  // 진단용(게이트 제외). 자치구 클러스터링만 단독으로 부르는 형태로 앱 호출 경로에는
  // 없습니다. 0.1~0.5ms 규모라 JIT 승격 상태에 따라 배수가 0.5x~1.1x 로 갈려서
  // 역행 판정 근거로 쓸 수 없습니다(같은 코드가 실행마다 뒤집힘).
  {
    id: 'seoul-min1',
    diagnostic: true,
    old: (rows) => oldGetSeoulDistrictClusters(rows, 1),
    next: (rows) => getSeoulDistrictClusters(rows, 1),
  },
  {
    id: 'seoul-min3',
    diagnostic: true,
    old: (rows) => oldGetSeoulDistrictClusters(rows, 3),
    next: (rows) => getSeoulDistrictClusters(rows, 3),
  },
];
const MODES = [
  { id: 'cold', rule: '매 표본마다 식당 객체를 새로 만들어 캐시 미스 재현(목록 재조회). 복사는 타이머 밖에서 수행' },
  { id: 'warm', rule: '같은 목록/같은 식당 객체 재호출(지도 상호작용, 목록 재필터)' },
];
const MEASUREMENTS = [];

let equivalence = 'identical';
let mismatches = 0;

for (const size of SIZES) {
  const rows = buildFixture(size, 20260922 + size);

  const oldResult = oldEffectRun(rows);
  const newResult = newEffectRun(rows);
  const coldRows = copyRows(rows);
  const oldColdResult = oldEffectRun(coldRows);
  const newColdResult = newEffectRun(copyRows(rows));
  const equal =
    sameJson(fingerprintRegional(oldResult.regional), fingerprintRegional(newResult.regional)) &&
    sameJson(fingerprintSeoul(oldResult.seoulAll), fingerprintSeoul(newResult.seoulAll)) &&
    sameJson(fingerprintSeoul(oldResult.seoulFiltered), fingerprintSeoul(newResult.seoulFiltered)) &&
    sameJson(fingerprintRegional(oldColdResult.regional), fingerprintRegional(newColdResult.regional)) &&
    sameJson(fingerprintSeoul(oldColdResult.seoulAll), fingerprintSeoul(newColdResult.seoulAll)) &&
    sameJson(fingerprintSeoul(oldColdResult.seoulFiltered), fingerprintSeoul(newColdResult.seoulFiltered));

  if (!equal) {
    equivalence = 'divergent';
    mismatches += 1;
  }

  for (const mode of MODES) {
    for (const target of TARGETS) {
      let before;
      let after;
      let beforeIterations = 1;
      let afterIterations = 1;

      if (mode.id === 'cold') {
        const prepare = () => copyRows(rows);
        const paired = measureColdPair(prepare, target.old, target.next, COLD_REPETITIONS);
        before = paired.a;
        after = paired.b;
      } else {
        beforeIterations = calibrateIterations(() => target.old(rows));
        afterIterations = calibrateIterations(() => target.next(rows));
        before = measure(() => target.old(rows), beforeIterations, REPETITIONS);
        after = measure(() => target.next(rows), afterIterations, REPETITIONS);
      }

      MEASUREMENTS.push({
        size,
        mode: mode.id,
        target: target.id,
        diagnostic: Boolean(target.diagnostic),
        beforeIterations,
        afterIterations,
        beforeMedianMs: Number(before.medianMs.toFixed(4)),
        beforeP95Ms: Number(before.p95Ms.toFixed(4)),
        beforeMadRelative: Number(before.madRelative.toFixed(4)),
        afterMedianMs: Number(after.medianMs.toFixed(4)),
        afterP95Ms: Number(after.p95Ms.toFixed(4)),
        afterMadRelative: Number(after.madRelative.toFixed(4)),
        speedupByMedian: Number((before.medianMs / after.medianMs).toFixed(2)),
        speedupByP95: Number((before.p95Ms / after.p95Ms).toFixed(2)),
      });
    }

    for (const control of CONTROL_TARGETS) {
      let first;
      let second;

      if (mode.id === 'cold') {
        const prepare = () => copyRows(rows);
        const paired = measureColdPair(prepare, control.implementation, control.implementation, COLD_REPETITIONS);
        first = paired.a;
        second = paired.b;
      } else {
        const iterations = calibrateIterations(() => control.implementation(rows));
        first = measure(() => control.implementation(rows), iterations, REPETITIONS);
        second = measure(() => control.implementation(rows), iterations, REPETITIONS);
      }

      CONTROLS.push({
        size,
        mode: mode.id,
        target: control.id,
        firstMedianMs: Number(first.medianMs.toFixed(4)),
        secondMedianMs: Number(second.medianMs.toFixed(4)),
        ratio: Number((first.medianMs / second.medianMs).toFixed(2)),
        combinedMadRelative: Number((first.madRelative + second.madRelative).toFixed(4)),
      });
    }
  }
}

const GATED = MEASUREMENTS.filter((entry) => !entry.diagnostic);
const DIAGNOSTICS = MEASUREMENTS.filter((entry) => entry.diagnostic);
const effectRuns = GATED.filter((entry) => entry.target === 'effect-run');
const worstSpeedup = Math.min(...GATED.map((entry) => entry.speedupByMedian));
const absoluteBudgetMet = effectRuns.every((entry) => entry.afterP95Ms <= BUDGETS.absolute.effectRunP95MsMax);
const relativeBudgetMet = effectRuns.every((entry) => (
  entry.mode === 'cold'
    ? entry.speedupByMedian >= BUDGETS.relative.coldBundleMinMedianSpeedup
    : entry.speedupByMedian >= BUDGETS.relative.warmBundleMinMedianSpeedup
));
const noRegressionMet = GATED.every(
  (entry) => entry.speedupByMedian >= 1 - (entry.beforeMadRelative + entry.afterMadRelative),
);
// 잡음 예산은 웜 표본에만 적용합니다. 콜드 표본은 매 표본마다 식당 객체를 새로 만들어
// GC 지터가 지배하고(중앙값 MAD 15~40%), 그 수치는 표에 그대로 남깁니다.
const noiseBudgetTargets = GATED.filter((entry) => entry.mode === 'warm');
const noiseWithinBudget = noiseBudgetTargets.every(
  (entry) => entry.beforeMadRelative <= BUDGETS.noise.madRelativeMax && entry.afterMadRelative <= BUDGETS.noise.madRelativeMax,
);
const combinedRelativeNoise = Number(
  Math.max(...noiseBudgetTargets.map((entry) => entry.beforeMadRelative + entry.afterMadRelative)).toFixed(4),
);
// 개선폭이 그 표본 자체의 잡음보다 큰지(표본별로) 확인합니다.
const deltaExceedsNoise = effectRuns.every(
  (entry) => entry.speedupByMedian - 1 > entry.beforeMadRelative + entry.afterMadRelative,
);

const report = {
  generatedAt: new Date().toISOString(),
  baselineSource: {
    file: 'apps/web/performance/clustering-region-district-20260922/benchmark-clustering.mjs',
    note: '이전 경로는 근사가 아니라 최적화 직전 구현(getRegionalClusters / getSeoulDistrictClusters / extractRegionFromAddress / findNearestRegion)을 이 스크립트 안에 동결한 사본입니다.',
  },
  workload: {
    sizes: SIZES,
    targets: TARGETS.map((target) => target.id),
    modes: MODES,
    repetitions: REPETITIONS,
    coldRepetitions: COLD_REPETITIONS,
    measurementTargetMs: MEASUREMENT_TARGET_MS,
    iterationRule: '구현마다 반복 횟수를 보정해 표본을 약 12ms 창에 넣고, 표본을 반복 횟수로 나눠 호출 1회 시간을 비교합니다.',
    coldRule: '콜드 표본은 식당 객체 복사를 타이머 밖에서 하고 클러스터링 호출 1회만 잽니다(반복 묶음 보정 없음).',
  },
  equivalence,
  mismatches,
  controls: CONTROLS,
  budgets: BUDGETS,
  measurements: MEASUREMENTS,
  acceptance: {
    absoluteBudgetMet,
    relativeBudgetMet,
    noRegressionMet,
    noiseWithinBudget,
    combinedRelativeNoise,
    worstSpeedupByMedian: Number(worstSpeedup.toFixed(2)),
    deltaExceedsNoise,
    accepted: absoluteBudgetMet && relativeBudgetMet && noRegressionMet && noiseWithinBudget && deltaExceedsNoise && equivalence === 'identical',
  },
  diagnostics: {
    note: '\ub2e8\ub3c5 \ucf5c\ub4dc \ud638\ucd9c\uc740 \uc571 \ud638\ucd9c \uacbd\ub85c\uac00 \uc544\ub2c8\uba70(\ud56d\uc0c1 regional \uc774 \uba3c\uc800), 0.1~0.5ms \uad6c\uac04\uc5d0\uc11c JIT \uc2b9\uaca9 \uc0c1\ud0dc\uc5d0 \ub530\ub77c 0.5x~1.1x \ub85c \uac08\ub9bd\ub2c8\ub2e4. \uc5ed\ud589 \ud310\uc815\uc5d0\uc11c \uc81c\uc678.',
    entries: DIAGNOSTICS.map((entry) => ({
      size: entry.size,
      mode: entry.mode,
      target: entry.target,
      beforeMedianMs: entry.beforeMedianMs,
      afterMedianMs: entry.afterMedianMs,
      speedupByMedian: entry.speedupByMedian,
    })),
  },
  ratio: {
    worstTarget: GATED.reduce((worst, entry) => (entry.speedupByMedian < worst.speedupByMedian ? entry : worst), GATED[0]),
    largestSizeSpeedups: GATED.filter((entry) => entry.size === SIZES[SIZES.length - 1]).map((entry) => ({
      mode: entry.mode,
      target: entry.target,
      beforeMedianMs: entry.beforeMedianMs,
      afterMedianMs: entry.afterMedianMs,
      speedupByMedian: entry.speedupByMedian,
      speedupByP95: entry.speedupByP95,
    })),
    perModeWorstSpeedup: MODES.map((mode) => ({
      mode: mode.id,
      worstSpeedupByMedian: Number(Math.min(
        ...GATED.filter((entry) => entry.mode === mode.id).map((entry) => entry.speedupByMedian),
      ).toFixed(2)),
    })),
  },
};

const outputPath = join(dirname(fileURLToPath(import.meta.url)), 'benchmark.json');
writeFileSync(outputPath, JSON.stringify(report, null, 2) + '\n');
process.stdout.write(JSON.stringify(report.acceptance) + '\n');
process.stdout.write(JSON.stringify(report.ratio.largestSizeSpeedups) + '\n');
process.stdout.write('equivalence=' + equivalence + ' mismatches=' + mismatches + '\n');
