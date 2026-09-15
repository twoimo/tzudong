import { describe, expect, test } from 'bun:test';
import { buildOverseasCountryAddressOrFilter, restaurantMatchesOverseasCountry, findOverseasRegionForRestaurant } from '../lib/overseas-region-matching';

describe('overseas address filter grammar', () => {
    test('detail restoration resolves the city from any business address', () => {
        expect(findOverseasRegionForRestaurant({ road_address: 'Esenler/İstanbul', english_address: 'Turkey', jibun_address: null })).toBe('튀르키예(이스탄불)');
        expect(findOverseasRegionForRestaurant({ road_address: '서울 강남구', english_address: null, jibun_address: null })).toBeNull();
    });
    test('city selection excludes other cities in the same country', () => {
        const address = { road_address: '일본 Sapporo Hokkaido', jibun_address: null, english_address: null };
        expect(restaurantMatchesOverseasCountry(address, '일본(삿포로)')).toBe(true);
        expect(restaurantMatchesOverseasCountry(address, '일본(오사카)')).toBe(false);
        expect(restaurantMatchesOverseasCountry(address, '일본')).toBe(true);
    });

    test.each([
        ['튀르키예(이스탄불)', 'Esenler/İstanbul, 튀르키예'],
        ['태국(방콕)', 'Convent Rd, Krung Thep Maha Nakhon 10500 태국'],
    ])('matches stored local city spelling for %s', (country, road_address) => {
        expect(restaurantMatchesOverseasCountry({ road_address, jibun_address: null, english_address: null }, country)).toBe(true);
    });
    test.each(['헝가리(부다페스트)', '일본(삿포로)'])('quotes reserved parentheses in %s', (country) => {
        const filter = buildOverseasCountryAddressOrFilter(country)!;
        expect(filter).toContain(`road_address.ilike."%${country}%"`);
        expect(filter).not.toContain(`ilike.%${country}%`);
        const query = new URLSearchParams({ or: `(${filter})` });
        expect(new URLSearchParams(query.toString()).get('or')).toBe(`(${filter})`);
    });

    test('preserves wildcard choice and rejects unknown regions', () => {
        expect(buildOverseasCountryAddressOrFilter('일본(삿포로)', '*')).toContain('english_address.ilike."*Sapporo*"');
        expect(buildOverseasCountryAddressOrFilter('unknown')).toBeNull();
        expect(buildOverseasCountryAddressOrFilter(null)).toBeNull();
    });
});
