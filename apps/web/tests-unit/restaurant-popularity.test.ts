import { expect, test } from 'bun:test';
import { getPopularityDescription, getRestaurantPopularity, rankPopularRestaurants } from '../lib/restaurant-popularity';
import type { Restaurant } from '../types/restaurant';

function row(id: string, meta: Record<string, unknown> = {}, search = 0): Restaurant {
  return { id, youtube_link: 'https://www.youtube.com/watch?v=abcdefghijk', youtube_meta: meta, weekly_search_count: search } as Restaurant;
}
test('likes, comments and searches each contribute, even without views', () => {
  for (const metric of ['viewCount', 'likeCount', 'commentCount']) {
    expect(getRestaurantPopularity(row(metric, { [metric]: '100' })).score).toBeGreaterThan(0);
    expect(getRestaurantPopularity(row(metric, { [metric]: '100' })).basis).toBe('engagement');
  }
  expect(getRestaurantPopularity(row('search', {}, 10)).basis).toBe('search');
  const views = row('views', { viewCount: 100000 });
  const engaged = row('engaged', { viewCount: 100000, likeCount: 1000, commentCount: 100 });
  expect(rankPopularRestaurants([views, engaged])[0].id).toBe('engaged');
});
test('invalid metrics do not create a popularity signal', () => {
  const result = getRestaurantPopularity(row('bad', { viewCount: 'NaN', likeCount: -2, commentCount: Infinity }));
  expect(result.score).toBe(0);
  expect(result.basis).toBe('fallback');
  expect(getPopularityDescription(result)).toContain('통계 수집 전 추천');
});
test('duplicate URLs and records do not inflate engagement or appearances', () => {
  const original = row('a', { viewCount: 1000, likeCount: 20 }, 5);
  const duplicate = { ...original, id: 'b', youtube_link: 'https://youtu.be/abcdefghijk' };
  const merged = { ...original, mergedRestaurants: [original, original, duplicate] };
  const result = getRestaurantPopularity(merged);
  expect(result.appearances).toBe(1);
  expect(result.views).toBe(1000);
  expect(result.searches).toBe(10);
  expect(result.likes).toBe(20);
});
test('missing statistics use repeat appearances then video date, never import date', () => {
  const older = row('older', { publishedAt: '2025-01-01' });
  const newer = row('newer', { publishedAt: '2026-01-01' });
  const repeated = { ...older, id: 'repeat', mergedRestaurants: [older, { ...older, id: 'other', youtube_link: 'https://youtu.be/lmnopqrstuv' }] };
  expect(rankPopularRestaurants([newer, older, repeated]).map(r => r.id)).toEqual(['repeat', 'newer', 'older']);
  expect(getPopularityDescription(getRestaurantPopularity(repeated))).toContain('2회 등장');
});
test('real engagement precedes missing statistics and ties remain deterministic', () => {
  const source = [row('b'), row('a'), row('actual', { commentCount: 1 })];
  expect(rankPopularRestaurants(source).map(r => r.id)).toEqual(['actual', 'a', 'b']);
  expect(source.map(r => r.id)).toEqual(['b', 'a', 'actual']);
});
