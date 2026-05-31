import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = (relativePath: string) =>
  readFileSync(join(import.meta.dir, '..', relativePath), 'utf8');

describe('restaurant search global scope source contract', () => {
  test('direct search ignores selected region while popular suggestions can remain regional', () => {
    const searchSource = source('components/search/RestaurantSearch.tsx');

    expect(searchSource).toContain('selectedRegion,');
    expect(searchSource).toContain('getPopularRestaurantsQueryKey({');
    expect(searchSource).toContain('지역 필터는 인기 검색/목록 패널에만 적용하고, 직접 검색은 항상 전체 지역에서 찾는다.');
    expect(searchSource).toContain('지역 필터가 켜져 있어도 검색창 직접 검색은 전체 지역을 대상으로 한다.');
    expect(searchSource).not.toContain('address.includes(selectedRegion)');
    expect(searchSource).not.toContain('// 지역 필터 적용 (선택된 지역/국가로 필터링)');
  });
});
