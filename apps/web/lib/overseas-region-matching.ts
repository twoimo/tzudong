import { OVERSEAS_REGIONS } from '@/constants/overseas-regions';
import type { Restaurant } from '@/types/restaurant';

const ADDRESS_FIELDS = ['road_address', 'jibun_address', 'english_address'] as const;

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
        .flatMap((term) => ADDRESS_FIELDS.map((field) => `${field}.ilike.${wildcard}${term}${wildcard}`))
        .join(',');
}
