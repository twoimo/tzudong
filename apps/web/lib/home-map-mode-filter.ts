import { OVERSEAS_REGIONS } from '@/constants/overseas-regions';
import type { Restaurant } from '@/types/restaurant';

/**
 * 홈 지도의 국내/해외 모드 분류에 쓰는 순수 헬퍼.
 *
 * 이전 구현(컴포넌트 내부)은 목록을 만들 때마다
 * - 식당마다 주소 문자열을 다시 만들고(3개 필드 결합 + toLowerCase)
 * - 식당마다 해외 키워드 35개를 각각 String.includes 로 훑었습니다.
 * 지도 이동/스와이프 목록 갱신마다 전체 목록에 반복되므로 비용이 N x K 로 커집니다.
 *
 * 여기서는 (1) 주소 문자열과 두 판정(좌표/키워드)을 식당 객체 단위로 검증 캐시하고,
 * (2) 키워드 검사를 첫 글자 버킷 스캔으로 바꿉니다. 같은 식당 객체가 지도 이동마다
 * 다시 들어오므로, 원본 필드가 그대로면 캐시가 그대로 재사용되어 행당 비용이
 * 문자열 생성 + 키워드 스캔에서 필드 비교 몇 번으로 줄어듭니다. 반환 순서, 유지되는
 * 객체 정체성, 각 모드의 판정 결과는 이전 구현과 동일합니다.
 */

export type HomeMapMode = 'domestic' | 'overseas';

export const KOREA_BOUNDS = {
    minLat: 33,
    maxLat: 39,
    minLng: 124,
    maxLng: 132,
} as const;

const OVERSEAS_KEYWORDS: readonly string[] = Object.values(OVERSEAS_REGIONS).flatMap(config =>
    config.keywords.map((keyword) => keyword.toLowerCase())
);

/** 키워드를 첫 글자로 묶은 표. 후보 위치에서만 소량을 비교하기 위해 씁니다. */
const buildKeywordBuckets = (keywords: readonly string[]) => {
    const buckets = new Map<string, string[]>();

    for (const keyword of keywords) {
        const first = keyword.charAt(0);
        if (!first) continue;

        const bucket = buckets.get(first);
        if (bucket) bucket.push(keyword);
        else buckets.set(first, [keyword]);
    }

    return buckets;
};

// 모듈 로드 시 한 번만 만듭니다. 호출 경로에서 다시 만들면 키워드 수만큼
// Map 을 채우게 되어 제거하려던 비용이 그대로 돌아옵니다.
const OVERSEAS_KEYWORD_BUCKETS = buildKeywordBuckets(OVERSEAS_KEYWORDS);

const textContainsAnyKeyword = (text: string, buckets: ReadonlyMap<string, readonly string[]>) => {
    if (!buckets.size) return false;

    for (let index = 0; index < text.length; index += 1) {
        const bucket = buckets.get(text.charAt(index));
        if (!bucket) continue;

        for (const keyword of bucket) {
            if (text.startsWith(keyword, index)) return true;
        }
    }

    return false;
};

type RestaurantDerivedEntry = Readonly<{
    road: string;
    jibun: string;
    english: string;
    lat: number;
    lng: number;
    text: string;
    hasOverseasKeyword: boolean;
    overseasByCoordinate: boolean;
}>;

const derivedCache = new WeakMap<Restaurant, RestaurantDerivedEntry>();

/** 국가 이름 -> 소문자 키워드 배열. 같은 국가는 같은 배열 정체성을 공유합니다. */
const countryKeywordCache = new Map<string, string[]>();

const keywordBucketsCache = new WeakMap<readonly string[], ReadonlyMap<string, readonly string[]>>();

const countryMatchCache = new WeakMap<
    readonly string[],
    WeakMap<RestaurantDerivedEntry, boolean>
>();

/**
 * 한 식당에서 뽑아내는 값(주소 문자열, 해외 키워드 보유, 좌표상 해외)을 한 번에
 * 계산해 캐시합니다. 캐시 키는 계산에 실제로 쓰는 원본 필드의 값이므로, 객체를
 * 제자리에서 수정하더라도 결과가 달라지지 않습니다.
 */
const resolveRestaurantDerived = (restaurant: Restaurant): RestaurantDerivedEntry => {
    const road = restaurant.road_address || '';
    const jibun = restaurant.jibun_address || '';
    const english = restaurant.english_address || '';
    const lat = Number(restaurant.lat);
    const lng = Number(restaurant.lng);

    const cached = derivedCache.get(restaurant);
    if (
        cached
        && cached.road === road
        && cached.jibun === jibun
        && cached.english === english
        && Object.is(cached.lat, lat)
        && Object.is(cached.lng, lng)
    ) {
        return cached;
    }

    const text = [road, jibun, english].join(' ').toLowerCase();
    const entry: RestaurantDerivedEntry = {
        road,
        jibun,
        english,
        lat,
        lng,
        text,
        hasOverseasKeyword: textContainsAnyKeyword(text, OVERSEAS_KEYWORD_BUCKETS),
        overseasByCoordinate: Number.isFinite(lat) && Number.isFinite(lng)
            && (
                lat < KOREA_BOUNDS.minLat
                || lat > KOREA_BOUNDS.maxLat
                || lng < KOREA_BOUNDS.minLng
                || lng > KOREA_BOUNDS.maxLng
            ),
    };
    derivedCache.set(restaurant, entry);
    return entry;
};

/**
 * 이전 구현과 같은 문자열(road, jibun, english 를 공백으로 이어 붙인 뒤 소문자화)을
 * 돌려줍니다.
 */
export const resolveHomeMapAddressText = (restaurant: Restaurant) =>
    resolveRestaurantDerived(restaurant).text;

export const isOverseasCoordinate = (restaurant: Restaurant) =>
    resolveRestaurantDerived(restaurant).overseasByCoordinate;

export const getOverseasCountryKeywords = (country: string | null | undefined): string[] | null => {
    if (!country || !(country in OVERSEAS_REGIONS)) {
        return null;
    }

    const cached = countryKeywordCache.get(country);
    if (cached) return cached;

    const keywords = OVERSEAS_REGIONS[country as keyof typeof OVERSEAS_REGIONS]
        .keywords
        .map((keyword) => keyword.toLowerCase());
    countryKeywordCache.set(country, keywords);
    return keywords;
};

/**
 * 같은 국가 키워드 배열에 대한 버킷/판정 결과를 재사용합니다. 키를 배열 정체성으로
 * 잡았으므로, 호출자가 매번 새 배열을 넘기면 캐시가 쌓이지 않고 그냥 다시 계산합니다.
 */
const resolveKeywordBuckets = (keywords: readonly string[]) => {
    const cached = keywordBucketsCache.get(keywords);
    if (cached) return cached;

    const buckets = buildKeywordBuckets(keywords);
    keywordBucketsCache.set(keywords, buckets);
    return buckets;
};

const restaurantMatchesCountryKeywords = (
    derived: RestaurantDerivedEntry,
    keywords: readonly string[],
    buckets: ReadonlyMap<string, readonly string[]>,
) => {
    let matched = countryMatchCache.get(keywords);
    if (!matched) {
        matched = new WeakMap();
        countryMatchCache.set(keywords, matched);
    }

    // 파생 항목은 원본 필드가 바뀔 때만 새 객체가 되므로, 제자리 수정도 자동으로
    // 무효화됩니다.
    const cached = matched.get(derived);
    if (cached !== undefined) return cached;

    const result = textContainsAnyKeyword(derived.text, buckets);
    matched.set(derived, result);
    return result;
};

/**
 * 이전 컴포넌트의 getRestaurantListByMode 와 같은 목록을 같은 순서로 돌려줍니다.
 *
 * 이전 구현은 모든 분기에서 주소 키워드 검사와 좌표 검사를 모두 계산했지만
 * 두 값 모두 부작용이 없어, 분기가 실제로 쓰는 것만 계산해도 결과는 같습니다.
 * 해외 국가가 선택된 경우 좌표 검사는 원래도 사용되지 않았습니다.
 */
export const filterHomeMapRestaurantsByMode = (
    restaurants: readonly Restaurant[],
    mode: HomeMapMode,
    countryKeywords: readonly string[] | null,
) => {
    if (!restaurants.length) return [] as Restaurant[];

    const countryBuckets = mode === 'overseas' && countryKeywords && countryKeywords.length
        ? resolveKeywordBuckets(countryKeywords)
        : null;

    const kept: Restaurant[] = [];
    for (let index = 0; index < restaurants.length; index += 1) {
        const restaurant = restaurants[index];
        if (!restaurant) continue;

        const derived = resolveRestaurantDerived(restaurant);

        if (countryBuckets) {
            if (restaurantMatchesCountryKeywords(derived, countryKeywords!, countryBuckets)) {
                kept.push(restaurant);
            }
            continue;
        }

        if (mode === 'domestic') {
            if (!derived.overseasByCoordinate && !derived.hasOverseasKeyword) kept.push(restaurant);
            continue;
        }

        if (derived.overseasByCoordinate || derived.hasOverseasKeyword) kept.push(restaurant);
    }

    return kept;
};
