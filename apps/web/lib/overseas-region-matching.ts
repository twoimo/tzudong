import { OVERSEAS_REGIONS } from '@/constants/overseas-regions';
import type { Restaurant } from '@/types/restaurant';

const ADDRESS_FIELDS = ['road_address', 'jibun_address', 'english_address'] as const;

/**
 * PostgREST parses ilike operands in the filter query string. An operand that
 * contains reserved characters such as ( ) or , must be wrapped in double
 * quotes, otherwise the filter silently matches nothing. Region labels like
 * "호주(시드니)" used to return 0 approved rows for Australia, Spain and
 * Hong Kong because their address filters were left unquoted.
 * Escaping follows the PostgREST grammar: backslash and double quote are
 * backslash-escaped, and the whole operand is wrapped in double quotes.
 */
export function quotePostgrestValue(value: string): string {
    // Escape backslash and double quote, then wrap the operand in double quotes.
    const escaped = value.replace(/[\\\"]/g, (character) => '\\' + character);
    return `"${escaped}"`;
}

function uniqueTerms(terms: string[]) {
    return Array.from(new Set(terms.map((term) => term.trim()).filter(Boolean)));
}

export function getOverseasSearchTermsForCountry(country: string | null | undefined) {
    if (!country) return [];

    const configs = Object.values(OVERSEAS_REGIONS).filter((config) => {
        return config.country === country || config.label === country || config.label.startsWith(`${country}(`);
    });

    if (configs.length === 0) return [];

    return uniqueTerms([
        country,
        ...configs.flatMap((config) => [config.country, config.label, ...config.keywords]),
    ]);
}

export function restaurantMatchesOverseasCountry(restaurant: Pick<Restaurant, 'road_address' | 'jibun_address' | 'english_address'>, country: string) {
    const terms = getOverseasSearchTermsForCountry(country);
    if (terms.length === 0) return false;

    const addressText = [
        restaurant.road_address,
        restaurant.jibun_address,
        restaurant.english_address,
    ].filter(Boolean).join(' ');

    return terms.some((term) => addressText.includes(term));
}

export function buildOverseasCountryAddressOrFilter(country: string | null | undefined, wildcard: '%' | '*' = '%') {
    const terms = getOverseasSearchTermsForCountry(country);
    if (terms.length === 0) return null;

    return terms
        .flatMap((term) => ADDRESS_FIELDS.map((field) => `${field}.ilike.${quotePostgrestValue(`${wildcard}${term}${wildcard}`)}`))
        .join(',');
}

/**
 * 특정 해외 지역 라벨(예: '일본(삿포로)')의 키워드만으로 주소 필드 OR 필터를 만듭니다.
 * OverseasMap의 마커 조건과 지역 개수 집계 조건을 동일하게 유지하기 위함입니다.
 */
export function buildOverseasRegionAddressOrFilter(region: string | null | undefined, wildcard: '%' | '*' = '%') {
    if (!region) return null;
    const config = OVERSEAS_REGIONS[region as keyof typeof OVERSEAS_REGIONS];
    if (!config || config.keywords.length === 0) return null;

    return uniqueTerms(config.keywords)
        .flatMap((keyword) =>
            ADDRESS_FIELDS.map((field) => field + '.ilike.' + quotePostgrestValue(wildcard + keyword + wildcard)),
        )
        .join(',');
}
