import { describe, expect, test } from 'bun:test';
import { buildCanonicalAdminHrefFromSearchParams, buildCanonicalAdminModuleHref, getAdminModuleIdFromSearchParams, getRestaurantManagementView } from '@/lib/admin/admin-module-routing';
import { normalizeAdminSidebarOrder } from '@/lib/admin/sidebar-order';

describe('integrated restaurant management', () => {
  test('old history links open the refresh tab and preserve existing filters', () => {
    const input = new URLSearchParams('module=restaurant-refresh-history&video_id=ABCDEFGHIJK&reason=changed');
    expect(getAdminModuleIdFromSearchParams(input)).toBe('restaurants');
    expect(getRestaurantManagementView(input)).toBe('refresh');
    expect(buildCanonicalAdminHrefFromSearchParams(input)).toBe('/admin?module=restaurants&video_id=ABCDEFGHIJK&reason=changed&restaurantView=refresh');
    expect(buildCanonicalAdminModuleHref('restaurant-refresh-history')).toBe('/admin?module=restaurants&restaurantView=refresh');
  });
  test('refresh selection survives canonicalization and unrelated pages do not inherit it', () => {
    const input = new URLSearchParams('module=restaurants&restaurantView=refresh');
    expect(buildCanonicalAdminHrefFromSearchParams(input)).toBe('/admin?module=restaurants&restaurantView=refresh');
    expect(getRestaurantManagementView(new URLSearchParams('module=restaurants'))).toBe('review');
    expect(buildCanonicalAdminHrefFromSearchParams(new URLSearchParams('module=users&restaurantView=refresh'))).toBe('/admin?module=users');
  });
  test('old saved sidebar slots remove only the merged entry and preserve the remaining order', () => {
    const result = normalizeAdminSidebarOrder({ sections:['검수','홈','운영','실험실'], items:{검수:['reviews','restaurant-refresh-history','restaurants','submissions']} });
    expect(result.items.검수).toEqual(['reviews','restaurants','submissions']);
    expect(result.sections[0]).toBe('검수');
    expect(Object.values(result.items).flat()).not.toContain('restaurant-refresh-history');
  });
});
