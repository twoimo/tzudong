// 관련 리뷰 조회의 후보 스캔 순서(주소 게이트 우선)와 할당 제거 전후 비교 벤치마크.
// 실행: bun apps/web/performance/review-lookup-address-gate-20260921/benchmark-review-lookup-address-gate.mjs
//
// 측정 항목
// - 같은 입력에 대한 처리 시간(중앙값, p95)
// - 후보 방문 수와 이름 호환 검사 수(알고리즘 연산량의 결정적 대리 지표)
// - 최적화 이전 구현과 현재 구현의 결과 동등성(전수 비교)
import {
    getReviewLookupPerfCounters,
    resetReviewLookupPerfCounters,
    selectRelatedRestaurantReviewIds,
} from '../../lib/restaurant-review-lookup';

// ---- 최적화 이전 알고리즘(정규화 캐시 적용 상태의 원본 스캔 순서) ----
function oldNormalizeReviewLookupName(name) {
    return (name || '').replace(/\s+/g, '').replace(/[^\w가-힣]/g, '').toLowerCase();
}

function oldNormalizeAddress(address) {
    return (address || '')
        .replace(/지하\s*\d+\s*층/g, '')
        .replace(/지상\s*\d+\s*층/g, '')
        .replace(/\d+\s*층/g, '')
        .replace(/\d+\s*호/g, '')
        .replace(/\s+/g, '')
        .replace(/[^\w가-힣]/g, '')
        .toLowerCase();
}

function oldCollectLookupNames(restaurant) {
    return [...new Set([
        restaurant.name,
        restaurant.approved_name,
        restaurant.naver_name,
        restaurant.origin_name,
        restaurant.google_name,
    ].map((name) => name?.trim()).filter((name) => Boolean(name)))];
}

function oldCollectAddresses(restaurants) {
    const addresses = new Set();
    restaurants.forEach((restaurant) => {
        const road = oldNormalizeAddress(restaurant.road_address);
        const jibun = oldNormalizeAddress(restaurant.jibun_address);
        if (road) addresses.add(road);
        if (jibun) addresses.add(jibun);
    });
    return addresses;
}

function oldAreNamesCompatible(sourceName, candidateName) {
    if (sourceName === candidateName) return true;
    const normalizedSource = oldNormalizeReviewLookupName(sourceName);
    const normalizedCandidate = oldNormalizeReviewLookupName(candidateName);
    if (!normalizedSource || !normalizedCandidate) return false;
    if (normalizedSource === normalizedCandidate) return true;
    const shorter = normalizedSource.length <= normalizedCandidate.length ? normalizedSource : normalizedCandidate;
    const longer = normalizedSource.length > normalizedCandidate.length ? normalizedSource : normalizedCandidate;
    return shorter.length >= 3 && longer.includes(shorter);
}

function oldCollectDirectIds(restaurant) {
    const ids = new Set([restaurant.id]);
    restaurant.mergedRestaurants?.forEach((merged) => { if (merged.id) ids.add(merged.id); });
    return [...ids];
}

// 이름 게이트를 먼저 평가하고 주소 집합을 배열로 펼쳐 검사하던 원본 스캔.
function selectRelatedRestaurantReviewIdsOld(restaurant, candidates) {
    if (!restaurant) return [];
    const ids = new Set(oldCollectDirectIds(restaurant));
    if (!Array.isArray(candidates) || candidates.length === 0) return [...ids];

    const lookupNames = oldCollectLookupNames(restaurant);
    const lookupAddresses = oldCollectAddresses([restaurant, ...(restaurant.mergedRestaurants || [])]);

    candidates.forEach((candidate) => {
        if (!candidate || !candidate.id) return;
        const candidateNames = oldCollectLookupNames(candidate);
        counters.oldCandidateVisits += 1;
        counters.oldNameGates += 1;
        if (lookupNames.length > 0 && candidateNames.length > 0 &&
            !lookupNames.some((lookupName) => candidateNames.some((candidateName) => oldAreNamesCompatible(lookupName, candidateName)))) {
            return;
        }
        const candidateAddresses = oldCollectAddresses([candidate]);
        const hasAddressMatch = lookupAddresses.size === 0
            ? candidateAddresses.size === 0
            : [...candidateAddresses].some((address) => lookupAddresses.has(address));
        if (hasAddressMatch) ids.add(candidate.id);
    });

    return [...ids];
}

const counters = { oldCandidateVisits: 0, oldNameGates: 0 };

// ---- 결정적 워크로드 생성 ----
function createRandom(seed) {
    let state = seed >>> 0;
    return () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
}

const NAME_STEMS = ['정원분식', '스시린', '1500회전초밥', '귀일만두', '명동 얼큰수제비', '북창동순두부', '을지면옥', '하동관', '오다리집', '대성집'];
const BRANCHES = ['', ' 강남본점', ' 불당본점', ' 용산점', ' 서면점', ' 판교점'];
const ROAD_POOL = Array.from({ length: 40 }, (_, index) => `서울특별시 강남구 테스트로${index + 1}길 ${10 + index}`);
const JIBUN_POOL = Array.from({ length: 40 }, (_, index) => `서울특별시 강남구 테스트동 ${index + 1}-${index % 9 + 1}`);

function buildWorkload({ sources, candidates, seed }) {
    const random = createRandom(seed);
    const pick = (list) => list[Math.floor(random() * list.length)];

    const candidateRows = Array.from({ length: candidates }, (_, index) => {
        const addressIndex = Math.floor(random() * ROAD_POOL.length);
        const name = `${pick(NAME_STEMS)}${pick(BRANCHES)}`;
        return {
            id: `cand-${index}`,
            name,
            approved_name: random() < 0.7 ? name : null,
            naver_name: random() < 0.3 ? `${name} 네이버` : null,
            origin_name: null,
            google_name: null,
            road_address: ROAD_POOL[addressIndex],
            jibun_address: random() < 0.8 ? JIBUN_POOL[addressIndex] : null,
        };
    });

    const sourceRows = Array.from({ length: sources }, (_, index) => {
        // 70%는 같은 주소를 쓰는 후보에서 파생(중복 리뷰 병합 대상), 30%는 주소가 겹치지 않는다.
        const derived = random() < 0.7;
        const addressIndex = derived
            ? ROAD_POOL.indexOf(candidateRows[Math.floor(random() * candidateRows.length)].road_address)
            : 39;
        const baseName = derived ? pick(NAME_STEMS) : `신규가게${index}`;
        const merged = random() < 0.25
            ? [{ id: `merged-${index}`, road_address: ROAD_POOL[addressIndex], jibun_address: JIBUN_POOL[addressIndex] }]
            : [];
        return {
            id: `source-${index}`,
            name: `${baseName}${pick(BRANCHES)}`,
            approved_name: `${baseName}${pick(BRANCHES)}`,
            naver_name: null,
            origin_name: null,
            google_name: null,
            road_address: ROAD_POOL[addressIndex],
            jibun_address: random() < 0.9 ? JIBUN_POOL[addressIndex] : null,
            mergedRestaurants: merged,
        };
    });

    return { sourceRows, candidateRows };
}

function measure(workload, run) {
    const samples = [];
    let resultCount = 0;
    for (let repetition = 0; repetition < 5; repetition += 1) {
        const startedAt = performance.now();
        workload.sourceRows.forEach((source) => {
            resultCount += run(source, workload.candidateRows).length;
        });
        samples.push(performance.now() - startedAt);
    }
    samples.sort((left, right) => left - right);
    return {
        medianMs: Number(samples[Math.floor(samples.length / 2)].toFixed(2)),
        p95Ms: Number(samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)].toFixed(2)),
        resultCount,
    };
}

const workload = buildWorkload({ sources: 400, candidates: 1200, seed: 20260921 });

// 결과 동등성 전수 비교(성능 측정 전에 먼저 확인한다).
let mismatches = 0;
for (const source of workload.sourceRows) {
    const before = selectRelatedRestaurantReviewIdsOld(source, workload.candidateRows);
    const after = selectRelatedRestaurantReviewIds(source, workload.candidateRows);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
        mismatches += 1;
        if (mismatches <= 3) {
            console.error('[mismatch]', source.id, before, after);
        }
    }
}

counters.oldCandidateVisits = 0;
counters.oldNameGates = 0;
const beforeCold = measure(workload, selectRelatedRestaurantReviewIdsOld);
const oldCounters = { ...counters };

resetReviewLookupPerfCounters();
const afterCold = measure(workload, selectRelatedRestaurantReviewIds);
const newCounters = getReviewLookupPerfCounters();

resetReviewLookupPerfCounters();
const afterWarm = measure(workload, selectRelatedRestaurantReviewIds);

const report = {
    generatedAt: new Date().toISOString(),
    workload: {
        sourceRestaurants: workload.sourceRows.length,
        candidates: workload.candidateRows.length,
        candidateVisitsPerSweep: workload.sourceRows.length * workload.candidateRows.length,
        repetitions: 5,
    },
    equivalence: mismatches === 0 ? 'identical' : `mismatch-${mismatches}`,
    resultCount: beforeCold.resultCount,
    old: {
        label: 'before-name-gate-first',
        medianMs: beforeCold.medianMs,
        p95Ms: beforeCold.p95Ms,
        candidateVisitsPerSweep: Math.round(oldCounters.oldCandidateVisits / 5),
        nameGatesPerSweep: Math.round(oldCounters.oldNameGates / 5),
    },
    new: {
        label: 'after-address-gate-first',
        medianMs: afterCold.medianMs,
        p95Ms: afterCold.p95Ms,
        candidateVisitsPerSweep: Math.round(newCounters.candidateVisits / 5),
        nameGatesPerSweep: Math.round(newCounters.nameGates / 5),
        allocationFreeAddressGate: true,
    },
    newWarm: {
        label: 'after-warm-cache',
        medianMs: afterWarm.medianMs,
        p95Ms: afterWarm.p95Ms,
    },
};

report.ratio = {
    candidateVisitsReducedBy: report.old.candidateVisitsPerSweep / Math.max(1, report.new.candidateVisitsPerSweep),
    nameGatesReducedBy: report.old.nameGatesPerSweep / Math.max(1, report.new.nameGatesPerSweep),
    speedupByMedian: Number((report.old.medianMs / Math.max(0.01, report.new.medianMs)).toFixed(2)),
    speedupByP95: Number((report.old.p95Ms / Math.max(0.01, report.new.p95Ms)).toFixed(2)),
};

console.log(JSON.stringify(report, null, 2));
if (mismatches !== 0) process.exit(1);
