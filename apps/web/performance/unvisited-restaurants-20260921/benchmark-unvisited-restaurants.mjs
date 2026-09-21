// 미방문 맛집 훅의 렌더당 재계산 비용 비교 벤치마크.
// 실행: bun apps/web/performance/unvisited-restaurants-20260921/benchmark-unvisited-restaurants.mjs
//
// 비교 대상(세 가지 모두 같은 결과를 내야 한다)
// - V0: 최적화 이전. 매 렌더마다 병합 + 두 번의 filter 순회(맛집당 방문 판정 2회)
// - V1: 병합만 useMemo, 순회는 1회로 축소(이번 작업의 중간 상태)
// - V2: 병합과 방문 판정 파생값을 모두 useMemo로 고정(현재 구현)
//
// 측정 항목
// - 결과 동등성(미방문 목록 id 순서와 방문 수)
// - 40회 재렌더에 걸린 전체 시간(중앙값)
// - 병합 호출 수와 방문 판정 호출 수(알고리즘 연산량의 결정적 대리 지표)
import { hasRelatedVerifiedUserReview } from '../../lib/restaurant-visit-matching';
import { mergeRestaurants } from '../../hooks/use-restaurants';

const RENDER_COUNT = 40;
const ROW_COUNT = 1200;
const DUPLICATE_EVERY = 7;
const REVIEW_COUNT = 40;
const REPETITIONS = 21;
// 표본 하나를 짧게 재면 타이머 분해능 때문에 상대 노이즈가 커진다. 표본마다 같은 작업을 여러 번 돌리고
// 다시 렌더 세트 하나의 시간으로 나눠 보고한다.
const SAMPLE_LOOPS = 5;

// 보고서가 스스로 밝히는 절대/상대/노이즈 예산입니다.
export const UNVISITED_RESTAURANTS_BUDGETS = Object.freeze({
    absolute: Object.freeze({
        rendersTotalMedianMsMax: 100,
        rule: `입력이 그대로인 ${RENDER_COUNT}회 재렌더의 총 시간 중앙값이 100ms 이하여야 합니다.`,
    }),
    relative: Object.freeze({
        minMedianSpeedup: 5,
        rule: '가장 느린 변형 대비 중앙값 5배 이상 빨라져야 개선으로 인정합니다.',
    }),
    noise: Object.freeze({
        madRelativeMax: 0.15,
        repetitions: REPETITIONS,
        rule: '각 변형의 반복 표본 MAD/중앙값이 15% 이내이고, 중앙값 개선폭이 양쪽 상대 노이즈 합보다 클 때만 개선으로 인정합니다.',
    }),
});

function makeRow(index, overrides = {}) {
    const name = `쯔동분식 ${index}`;
    const address = `서울 중구 쯔동로 ${index}`;
    return {
        id: `restaurant-${index}`,
        name,
        approved_name: name,
        origin_name: null,
        naver_name: null,
        google_name: null,
        phone: null,
        categories: ['분식'],
        status: 'approved',
        source_type: 'youtube',
        youtube_link: `https://www.youtube.com/watch?v=${index}`,
        youtube_meta: null,
        evaluation_results: null,
        reasoning_basis: null,
        tzuyang_review: null,
        trace_id: null,
        origin_address: address,
        road_address: address,
        jibun_address: address,
        english_address: null,
        address_elements: null,
        geocoding_success: true,
        geocoding_false_stage: null,
        is_missing: false,
        is_not_selected: false,
        lat: 37.5 + index * 0.0001,
        lng: 127 + index * 0.0001,
        review_count: index % 23,
        created_by: null,
        updated_by_admin_id: null,
        db_error_message: null,
        db_error_details: null,
        search_count: 0,
        weekly_search_count: 0,
        trace_id_name_source: null,
        channel_name: null,
        description_map_url: null,
        recollect_version: null,
        created_at: '2026-01-01T00:00:00.000Z',
        updated_at: '2026-01-01T00:00:00.000Z',
        ...overrides,
    };
}

function buildRows() {
    const rows = [];
    for (let index = 0; index < ROW_COUNT; index += 1) {
        rows.push(makeRow(index));
        if (index % DUPLICATE_EVERY === 0) {
            // 같은 이름·주소의 삭제된 중복 레코드. 병합 그룹을 만들어 병합 비용을 현실적으로 만든다.
            rows.push(makeRow(index, {
                id: `restaurant-${index}-duplicate`,
                status: 'deleted',
                created_at: '2025-12-31T00:00:00.000Z',
            }));
        }
    }
    return rows;
}

function buildReviews(rows) {
    const reviews = [];
    for (let index = 0; index < REVIEW_COUNT; index += 1) {
        const source = rows[index * 3];
        if (!source) continue;
        // 3건 중 2건은 이름·주소가 일치하는 후보를 함께 주고, 1건은 후보 없이 id만 준다.
        const candidate = index % 3 === 2
            ? null
            : {
                id: source.id,
                name: source.approved_name,
                approved_name: source.approved_name,
                road_address: source.road_address,
                jibun_address: source.jibun_address,
            };
        reviews.push({
            restaurant_id: source.id,
            is_verified: true,
            restaurant: candidate,
        });
    }
    return reviews;
}

function createMemoCell() {
    let hasValue = false;
    let value;
    let deps = [];
    return {
        read(compute, nextDeps, counters) {
            const hit = hasValue
                && deps.length === nextDeps.length
                && nextDeps.every((dep, index) => Object.is(dep, deps[index]));
            if (hit) {
                counters.memoHits += 1;
                return value;
            }
            counters.memoMisses += 1;
            value = compute();
            deps = nextDeps;
            hasValue = true;
            return value;
        },
    };
}

function createCounters() {
    return { mergeCalls: 0, reviewChecks: 0, memoHits: 0, memoMisses: 0 };
}

// V0: 최적화 이전 구현(맛집당 방문 판정 2회, 병합은 매 렌더 실행).
function deriveV0(state, rows, reviews) {
    const visitedRestaurantIds = new Set(reviews.map((review) => review.restaurant_id));
    const reviewedRestaurantCandidates = reviews
        .map((review) => review.restaurant)
        .filter(Boolean);

    state.counters.mergeCalls += 1;
    const mergedRestaurants = mergeRestaurants(rows);

    const isVisited = (restaurant) => {
        state.counters.reviewChecks += 1;
        return hasRelatedVerifiedUserReview({
            restaurant,
            reviewedRestaurantIds: visitedRestaurantIds,
            reviewedRestaurants: reviewedRestaurantCandidates,
        });
    };

    const unvisitedRestaurants = mergedRestaurants.filter((restaurant) => !isVisited(restaurant));
    const visitedCount = mergedRestaurants.filter(isVisited).length;
    return { unvisitedRestaurants, visitedCount };
}

// V1: 병합만 메모, 순회는 1회.
function deriveV1(state, rows, reviews) {
    const mergedRestaurants = state.mergeCell.read(
        () => {
            state.counters.mergeCalls += 1;
            return mergeRestaurants(rows);
        },
        [rows],
        state.counters,
    );

    const reviewedRestaurantIds = new Set(reviews.map((review) => review.restaurant_id));
    const reviewedRestaurantCandidates = reviews
        .map((review) => review.restaurant)
        .filter(Boolean);

    const unvisitedRestaurants = [];
    let visitedCount = 0;
    for (const restaurant of mergedRestaurants) {
        state.counters.reviewChecks += 1;
        if (hasRelatedVerifiedUserReview({
            restaurant,
            reviewedRestaurantIds,
            reviewedRestaurants: reviewedRestaurantCandidates,
        })) {
            visitedCount += 1;
        } else {
            unvisitedRestaurants.push(restaurant);
        }
    }
    return { unvisitedRestaurants, visitedCount };
}

// V2: 병합과 방문 판정 파생값을 모두 메모(현재 구현).
function deriveV2(state, rows, reviews) {
    const mergedRestaurants = state.mergeCell.read(
        () => {
            state.counters.mergeCalls += 1;
            return mergeRestaurants(rows);
        },
        [rows],
        state.counters,
    );

    return state.derivedCell.read(
        () => {
            const reviewedRestaurantIds = new Set(reviews.map((review) => review.restaurant_id));
            const reviewedRestaurantCandidates = reviews
                .map((review) => review.restaurant)
                .filter(Boolean);

            const unvisitedRestaurants = [];
            let visitedCount = 0;
            for (const restaurant of mergedRestaurants) {
                state.counters.reviewChecks += 1;
                if (hasRelatedVerifiedUserReview({
                    restaurant,
                    reviewedRestaurantIds,
                    reviewedRestaurants: reviewedRestaurantCandidates,
                })) {
                    visitedCount += 1;
                } else {
                    unvisitedRestaurants.push(restaurant);
                }
            }
            return { unvisitedRestaurants, visitedCount };
        },
        [mergedRestaurants, reviews],
        state.counters,
    );
}

function createState(derive) {
    return {
        counters: createCounters(),
        mergeCell: createMemoCell(),
        derivedCell: createMemoCell(),
        derive,
    };
}

function runVariant(state, rows, reviews, renders) {
    let last = null;
    for (let render = 0; render < renders; render += 1) {
        last = state.derive(state, rows, reviews);
    }
    return last;
}

function summarize(result) {
    const ids = result.unvisitedRestaurants.map((restaurant) => restaurant.id);
    return {
        visitedCount: result.visitedCount,
        unvisitedCount: ids.length,
        fingerprint: `${ids.length}:${ids.join('|')}`,
    };
}

function fingerprintHash(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}

function p95(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return sorted[index];
}

const rows = buildRows();
const reviews = buildReviews(rows);

const variants = [
    { id: 'V0-original', derive: deriveV0 },
    { id: 'V1-memo-merge', derive: deriveV1 },
    { id: 'V2-memo-derived', derive: deriveV2 },
];

function madRelative(values) {
    const center = median(values);
    if (center === 0) return 0;
    return median(values.map((value) => Math.abs(value - center))) / center;
}

const equivalence = [];
const measurements = [];

for (const variant of variants) {
    const state = createState(variant.derive);
    const first = runVariant(state, rows, reviews, RENDER_COUNT);
    const summary = summarize(first);
    equivalence.push({
        id: variant.id,
        visitedCount: summary.visitedCount,
        unvisitedCount: summary.unvisitedCount,
        fingerprint: fingerprintHash(summary.fingerprint),
        mergeCalls: state.counters.mergeCalls,
        reviewChecks: state.counters.reviewChecks,
        memoHits: state.counters.memoHits,
        memoMisses: state.counters.memoMisses,
    });

    const samples = [];
    for (let repetition = 0; repetition < REPETITIONS; repetition += 1) {
        const startedAt = performance.now();
        for (let loop = 0; loop < SAMPLE_LOOPS; loop += 1) {
            const runState = createState(variant.derive);
            runVariant(runState, rows, reviews, RENDER_COUNT);
        }
        samples.push((performance.now() - startedAt) / SAMPLE_LOOPS);
    }
    measurements.push({
        id: variant.id,
        medianMs: Number(median(samples).toFixed(3)),
        p95Ms: Number(p95(samples).toFixed(3)),
        madRelative: Number(madRelative(samples).toFixed(4)),
    });
}

const reference = equivalence[0];
const allEqual = equivalence.every((entry) =>
    entry.fingerprint === reference.fingerprint
    && entry.visitedCount === reference.visitedCount
    && entry.unvisitedCount === reference.unvisitedCount);

const baseline = measurements[0];
const candidate = measurements[2];
const budgets = UNVISITED_RESTAURANTS_BUDGETS;
const medianSpeedup = Number((baseline.medianMs / candidate.medianMs).toFixed(2));
const p95Speedup = Number((baseline.p95Ms / candidate.p95Ms).toFixed(2));
const combinedRelativeNoise = Number((baseline.madRelative + candidate.madRelative).toFixed(4));
const relativeImprovement = Number((medianSpeedup - 1).toFixed(4));
const noiseWithinBudget = measurements.every((entry) => entry.madRelative <= budgets.noise.madRelativeMax);

const report = {
    generatedAt: new Date().toISOString(),
    workload: {
        rows: rows.length,
        reviews: reviews.length,
        mergedRestaurants: reference.unvisitedCount + reference.visitedCount,
        renders: RENDER_COUNT,
        repetitions: REPETITIONS,
    },
    equivalence: allEqual ? 'identical' : 'mismatch',
    equivalenceDetail: equivalence,
    budgets,
    measurements,
    acceptance: {
        absoluteBudgetMet: candidate.medianMs <= budgets.absolute.rendersTotalMedianMsMax,
        relativeBudgetMet: medianSpeedup >= budgets.relative.minMedianSpeedup,
        noiseWithinBudget,
        combinedRelativeNoise,
        relativeImprovement,
        deltaExceedsNoise: relativeImprovement > combinedRelativeNoise,
        accepted: allEqual
            && noiseWithinBudget
            && relativeImprovement > combinedRelativeNoise
            && candidate.medianMs <= budgets.absolute.rendersTotalMedianMsMax
            && medianSpeedup >= budgets.relative.minMedianSpeedup,
    },
    ratio: {
        speedupByMedian: medianSpeedup,
        speedupByP95: p95Speedup,
        mergeCallReduction: Number((equivalence[0].mergeCalls / equivalence[2].mergeCalls).toFixed(2)),
        reviewCheckReduction: Number((equivalence[0].reviewChecks / equivalence[2].reviewChecks).toFixed(2)),
    },
};

console.log(JSON.stringify(report, null, 2));
