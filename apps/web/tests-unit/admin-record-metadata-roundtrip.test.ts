import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseYoutubeMeta } from '../lib/admin/normalize-evaluation-record';
import { submissionApprovalInput } from '../lib/admin/evaluation-record-actions';
import type { SubmissionRecord } from '../components/admin/SubmissionDetailView';

test('actual PG17 composed canonical metadata normalizes and reenters the guarded DTO without text loss', () => {
  const proof = JSON.parse(readFileSync(new URL('../performance/record-review-fixes-20261009/metadata-roundtrip.json', import.meta.url), 'utf8'));
  const source = readFileSync(new URL('../../../backend/supabase/migrations/20261004190259_admin_record_guarded_actions.sql', import.meta.url));
  expect(createHash('sha256').update(source).digest('hex')).toBe(proof.sourceSha256);
  const meta = parseYoutubeMeta(proof.meta);
  expect(meta).toEqual({ title: 'synthetic video', publishedAt: '2026-10-01', duration: 42, is_shorts: false, ads_info: { is_ads: true, what_ads: 'A, B' } });
  const id = '11111111-1111-4111-8111-111111111111';
  const item = '22222222-2222-4222-8222-222222222222';
  const submission = { id, submission_type: 'new', items: [{ id: item, item_status: 'pending', youtube_link: 'https://www.youtube.com/watch?v=ABCDEFGHIJK' }] } as SubmissionRecord;
  const result = submissionApprovalInput({ submission, approvalData: { lat: '37.5', lng: '127', jibun_address: 'synthetic avenue', road_address: 'synthetic avenue', english_address: '', address_elements: {} }, editableData: { name: 'Synthetic', address: 'synthetic avenue', phone: '', categories: ['한식'] }, forceApprove: false, itemDecisions: { [item]: { approved: true, rejectionReason: '', tzuyang_review: 'synthetic evidence', metaData: meta! } } });
  expect(result.payload).toMatchObject({ items: [{ changes: { youtube_meta: { title: meta!.title, published_at: meta!.publishedAt, duration: 42, is_shorts: false, is_ads: true, what_ads: ['A, B'] } } }] });
});
