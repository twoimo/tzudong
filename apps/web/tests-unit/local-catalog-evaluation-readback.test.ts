import { expect, test } from 'bun:test';
import type { EvaluationRecord } from '../types/evaluation';
import { applyCatalogReadback } from '../lib/admin/local-catalog-evaluation-readback';

const original = {
  id: 'fixture', name: '기존 이름', approved_name: '기존 이름', status: 'pending',
  categories: ['한식'], phone: null, lat: 37, lng: 127,
  road_address: '기존 주소', jibun_address: null, english_address: null, address_elements: {},
  youtube_link: 'old-video', youtube_links: ['old-video'], youtube_meta: { title: 'old' },
  restaurant_info: { name: '기존 이름', category: '한식', tzuyang_review: '기존 리뷰' },
} as EvaluationRecord;

test('verified field readback updates display aliases without changing approval or source objects', () => {
  const result = applyCatalogReadback(original, { approved_name: '새 이름', categories: ['양식'], tzuyang_review: '새 리뷰' });
  expect(result.name).toBe('새 이름');
  expect(result.approved_name).toBe('새 이름');
  expect(result.restaurant_info?.name).toBe('새 이름');
  expect(result.restaurant_info?.tzuyang_review).toBe('새 리뷰');
  expect(result.status).toBe('pending');
  expect(result.phone).toBeNull();
  expect(result.youtube_meta).toBe(original.youtube_meta);
  expect(original.restaurant_info?.tzuyang_review).toBe('기존 리뷰');
  expect(original.categories).toEqual(['한식']);
});

test('location and video readback replaces stale display data without inventing metadata', () => {
  const result = applyCatalogReadback(original, { lat: 38, lng: 128, road_address: '새 주소', youtube_link: 'new-video' });
  expect(result.restaurant_info?.naver_address_info?.x).toBe('128');
  expect(result.restaurant_info?.naver_address_info?.road_address).toBe('새 주소');
  expect(result.youtube_links).toEqual(['new-video']);
  expect(result.youtube_meta).toBeNull();
  expect(result.name).toBe(original.name);
  expect(original.lat).toBe(37);
});
