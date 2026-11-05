import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { buildHomeReturnHref } from '../lib/home-return-href';

const restaurantId = '00000000-0000-4000-8000-000000000001';
describe('Mypage returns to the visible public restaurant selection', () => {
  test.each(['domestic', 'overseas'] as const)('preserves %s detail and zoom', mapMode => {
    const href = buildHomeReturnHref({ restaurantId, mapMode, focusZoom: 14 });
    const url = new URL(href, 'https://fixture.invalid');
    expect(url.pathname).toBe('/');
    expect([...url.searchParams.entries()]).toEqual([['restaurant', restaurantId], ['mapMode', mapMode], ['z', '14']]);
  });
  test.each([null, NaN, Infinity, -Infinity])('omits nonfinite or absent zoom %s', focusZoom => {
    expect(new URL(buildHomeReturnHref({restaurantId, mapMode:'domestic', focusZoom}), 'https://fixture.invalid').searchParams.has('z')).toBe(false);
  });
  test.each([null, '', 'https://untrusted.invalid', '//untrusted.invalid', '../mypage', 'id&lat=1', 'not-a-uuid'])('falls back safely for %s', id => {
    expect(buildHomeReturnHref({restaurantId:id, mapMode:'domestic', focusZoom:null})).toBe('/');
  });
  test('rebuilds from selected business fields without forwarding unknown fields or a list restore key', () => {
    const target = {restaurantId, mapMode:'overseas' as const, focusZoom:null, restore:'old-list-entry', search:'private', lat:1, lng:2, draft:'private'};
    const url = new URL(buildHomeReturnHref(target), 'https://fixture.invalid');
    expect([...url.searchParams.keys()]).toEqual(['restaurant','mapMode']);
  });
  test('falls back for an invalid runtime map mode', () => {
    expect(buildHomeReturnHref({restaurantId, mapMode:'invalid' as 'domestic', focusZoom:null})).toBe('/');
  });
  test('both visible Mypage return links use the shared account-scoped target', () => {
    const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
    for (const path of ['app/mypage/mypage-layout-content.tsx','components/mypage/MyPageSidebar.tsx']) {
      expect(source(path)).toContain('useHomeReturnHref(user?.id ?? null)');
      expect(source(path)).toContain('<Link href={homeReturnHref}');
    }
    const home = source('app/home-client.tsx');
    expect(home).toContain('useRememberHomeReturnHref(user?.id ?? null');
    expect(home).toContain('restaurantId: visibleDetailRestaurant?.id ?? null');
  });
});
