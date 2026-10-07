import { describe, expect, test } from 'bun:test';
import { buildEvaluationConflictInfo, getEvaluationConflictTargetId, normalizeEvaluationRecord, parseDbConflictInfo } from '../lib/admin/normalize-evaluation-record';
const sourceId = '11111111-1111-4111-8111-111111111111', targetId = '22222222-2222-4222-8222-222222222222';
const incoming = { name: '새 후보', phone: null, category: '한식', origin_address: '합성동 1', origin_lat: 37.5, origin_lng: 127,
  reasoning_basis: '영상 근거', tzuyang_review: '유지할 원본 리뷰', naver_address_info: null };
const legacy = { existing_restaurant: { id: targetId, name: '예전 이름', jibun_address: '예전 주소', phone: null,
  category: ['한식'], youtube_links: ['https://www.youtube.com/watch?v=ABCDEFGHIJK'], created_at: '2026-10-01T00:00:00Z' }, new_restaurant: incoming };
const row = { id: sourceId, name: 'DB 원본', status: 'pending', updated_at: '2026-10-05T00:00:00Z', created_at: '2026-10-01T00:00:00Z', categories: ['고기'], tzuyang_review: 'DB 리뷰', youtube_link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' };
describe('evaluation conflict normalization', () => {
  test('legacy known fields and incoming meaning survive normalization without unknown diagnostics', () => {
    const conflict = parseDbConflictInfo({ ...legacy, diagnostic: 'RAW_PROVIDER_ERROR', existing_restaurant: { ...legacy.existing_restaurant, secret: 'DROP' } });
    expect(conflict).toEqual(legacy);
    expect(normalizeEvaluationRecord({ ...row, db_conflict_info: legacy })?.db_conflict_info).toEqual(legacy);
  });
  test('malformed identities, data and self-targets cannot become mutation targets', () => {
    for (const id of ['', '/unexpected', sourceId]) {
      const source = normalizeEvaluationRecord({ ...row, db_conflict_info: { ...legacy, existing_restaurant: { ...legacy.existing_restaurant, id } } })!;
      expect(getEvaluationConflictTargetId(source)).toBeNull();
    }
    expect(parseDbConflictInfo({ ...legacy, new_restaurant: { ...incoming, origin_lat: Infinity } })).toBeNull();
    expect(parseDbConflictInfo({ ...legacy, new_restaurant: { ...incoming, naver_address_info: {} } })).toBeNull();
    expect(getEvaluationConflictTargetId(normalizeEvaluationRecord({ ...row, db_error_details: { conflicting_restaurant: { id: '/arbitrary', name: '대상', jibun_address: '주소' } } })!)).toBeNull();
  });
  test('current duplicate detail resolves only the exact fresh target and retains all videos/categories', () => {
    const source = normalizeEvaluationRecord({ ...row, db_error_details: { error_type: 'duplicate', conflicting_restaurant: { id: targetId, name: '낡은 이름', jibun_address: '낡은 주소' } } })!;
    const target = normalizeEvaluationRecord({ ...row, id: targetId, name: '최신 이름', status: 'approved', categories: ['한식', '고기'], youtube_links: ['first', 'second'] })!;
    expect(getEvaluationConflictTargetId(source)).toBe(targetId);
    expect(buildEvaluationConflictInfo(source, target)).toMatchObject({ existing_restaurant: { id: targetId, name: '최신 이름', category: ['한식', '고기'], youtube_links: ['first', 'second'] }, new_restaurant: { tzuyang_review: 'DB 리뷰' } });
    expect(buildEvaluationConflictInfo(source, { ...target, id: sourceId })).toBeNull();
    expect(buildEvaluationConflictInfo(source, { ...target, status: 'deleted' })).toBeNull();
    expect(buildEvaluationConflictInfo(source, { ...target, updated_at: '' })).toBeNull();
    expect(buildEvaluationConflictInfo(source, { ...target, read_summary: { address_consistency: 'unknown', evaluation_issues: [] } })).toBeNull();
  });
  test('refreshes stale target information while preserving original incoming legacy evidence', () => {
    const source = normalizeEvaluationRecord({ ...row, db_conflict_info: legacy })!;
    const target = normalizeEvaluationRecord({ ...row, id: targetId, name: '최신 대상' })!;
    expect(buildEvaluationConflictInfo(source, target)?.new_restaurant).toEqual(incoming);
    expect(buildEvaluationConflictInfo(source, target)?.existing_restaurant.name).toBe('최신 대상');
  });
});
