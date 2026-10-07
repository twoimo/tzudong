import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { submissionApprovalInput, submissionEditInput } from '../lib/admin/evaluation-record-actions';
import { parseRecordActionRequest, type RecordActionReceipt, type RecordActionRequest } from '../lib/admin/record-action-contract';
import { isRecordActionCancelled, recordActionErrorMessage, recordActionMediaNotice, type RecordActionInput } from '../lib/admin/record-action-client';
import type { SubmissionRecord } from '../components/admin/SubmissionDetailView';
const id = '11111111-1111-4111-8111-111111111111', itemId = '22222222-2222-4222-8222-222222222222', item2 = '33333333-3333-4333-8333-333333333333';
const submission: SubmissionRecord = { id, user_id: id, submission_type: 'new', status: 'pending', restaurant_name: '합성 맛집', restaurant_address: '서울 합성로', restaurant_phone: null, restaurant_categories: ['한식'], admin_notes: null, rejection_reason: null, resolved_by_admin_id: null, reviewed_at: null, created_at: '', updated_at: '', items: [itemId, item2].map(item => ({ id: item, submission_id: id, item_status: 'pending', youtube_link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', tzuyang_review: '근거', target_restaurant_id: null, rejection_reason: null, created_at: '' })) };
const approval = () => ({ submission: structuredClone(submission), approvalData: { lat: '37.5', lng: '127', jibun_address: '서울 합성동', road_address: '서울 합성로', english_address: '', address_elements: {} }, forceApprove: true, editableData: { name: '편집한 맛집', address: '서울 합성로', phone: '02-123-4567', categories: ['한식'] }, adminNote: 'submission-approval-state:v1\nbrowser-local-search-evidence:not-backend-truth', itemDecisions: { [itemId]: { approved: true, rejectionReason: '', youtube_link: 'https://youtu.be/dQw4w9WgXcQ', tzuyang_review: '입력 근거', metaData: { title: '합성 영상', publishedAt: '2026-10-01', duration: 12, is_shorts: false, ads_info: { is_ads: false, what_ads: null } } } } });
const edit = { restaurant_name: '수정 이름', address: '주소', phone: '02-123-4567', categories: ['한식'], youtube_link: 'https://youtu.be/dQw4w9WgXcQ', description: '수정 근거' };

describe('evaluation page guarded action payloads', () => {
  test('submission decisions cover every pending item atomically and preserve force/evidence provenance', () => {
    const value = submissionApprovalInput(approval());
    const payload = value.payload as { note: string; items: Array<{ id: string; decision: string; changes?: Record<string, unknown>; reason?: string }> };
    expect(value.action).toBe('submission.approve'); expect(value.targetIds).toEqual([id]);
    expect(payload.items.map(row => [row.id, row.decision])).toEqual([[itemId, 'approve'], [item2, 'reject']]);
    expect(payload.items[0].changes).toMatchObject({ approved_name: '편집한 맛집', phone: '02-123-4567', geocoding_success: true, lat: 37.5, lng: 127, youtube_link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' });
    expect(payload.items[1].reason).toBeTruthy(); expect(payload.note).toContain('forceApprove=true'); expect(payload.note).toContain('browser-local-search-evidence:not-backend-truth');
    expect(payload.items[0].changes).not.toHaveProperty('evaluation_results'); expect(payload.items[0].changes).not.toHaveProperty('status');
  });
  test('missing/NaN/out-of-range coordinates, evidence, unknown category and duplicate pending IDs fail closed', () => {
    for (const coords of ['', 'NaN', '91', 'Infinity']) { const value = approval(); value.approvalData.lat = coords; expect(() => submissionApprovalInput(value)).toThrow(); }
    const duplicate = approval(); duplicate.submission.items[1].id = itemId; expect(() => submissionApprovalInput(duplicate)).toThrow();
    const category = approval(); category.editableData.categories = ['unsupported']; expect(() => submissionApprovalInput(category)).toThrow();
    const evidence = approval(); evidence.itemDecisions[itemId].tzuyang_review = ' '; expect(() => submissionApprovalInput(evidence)).toThrow();
    const nonpending = approval(); nonpending.submission.items.forEach(item => { item.item_status = 'approved'; }); expect(() => submissionApprovalInput(nonpending)).toThrow();
  });
  test('submission edits use parent identity and only the intended pending item; recommendations cannot become restaurant edits', () => {
    const value = submissionEditInput(submission, edit);
    expect(value).toMatchObject({ action: 'submission.edit', targetIds: [id], payload: { changes: { restaurant_name: '수정 이름', restaurant_phone: '02-123-4567' }, itemChanges: [{ id: itemId, youtube_link: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', tzuyang_review: '수정 근거' }] } });
    expect(() => submissionEditInput({ ...submission, submission_type: 'recommend' }, edit)).toThrow();
    const changed = structuredClone(submission); changed.items[0].item_status = 'approved'; expect(() => submissionEditInput(changed, edit)).toThrow();
    const recommend = approval(); recommend.submission.submission_type = 'recommend'; recommend.approvalData.lat = '';
    expect(submissionApprovalInput(recommend)).toMatchObject({ action: 'recommendation.approve', targetIds: [id] });
  });
});

const page = readFileSync(new URL('../app/admin/evaluations/page.tsx', import.meta.url), 'utf8');
const block = page.slice(page.indexOf('  const notifyRecordActionError ='), page.indexOf('  const initialContentLoading'));
const mutationNames = ['approveReviewMutation', 'rejectReviewMutation', 'deleteReviewMutation', 'approveSubmissionMutation', 'rejectSubmissionMutation', 'deleteSubmissionMutation', 'updateSubmissionMutation'];
test('actual page mutation callbacks all validate guarded requests and shared applied callback refreshes each read model', async () => {
  const requests: RecordActionRequest[] = [], invalidations: unknown[] = [], notices: unknown[] = [];
  let refresh = 0, pendingRefresh = 0, publicRefresh = 0;
  const receipt: RecordActionReceipt = { operationId: id, action: 'restaurant.delete', state: 'applied', targetIds: [id], auditId: itemId, previewHash: 'a'.repeat(64), expiresAt: '2026-10-05T12:00:00Z', readback: [], mediaCleanupPending: false };
  const dependencies = {
    toast: (notice: unknown) => notices.push(notice), isRecordActionCancelled, recordActionErrorMessage, recordActionMediaNotice, submissionApprovalInput, submissionEditInput,
    queryClient: { invalidateQueries: async (query: unknown) => { invalidations.push(query); } }, invalidateAdminPendingCounts: () => { pendingRefresh++; },
    invalidateRestaurantDiscoveryQueries: async () => { publicRefresh++; }, refreshRecordViews: async () => { refresh++; }, showSubmissionView: false, reviewsData: [],
    setEditingSubmission: () => {}, setSubmissionDraft: () => {}, useMutation: (config: unknown) => config,
    useRecordAction: () => ({ run: async (input: RecordActionInput) => { const parsed = parseRecordActionRequest({ ...input, phase: 'preview', operationId: id }); if (!parsed) throw Error('invalid'); requests.push(parsed); return receipt; } }),
    createSubmissionApprovedNotification: async () => {}, createSubmissionRejectedNotification: async () => {}, createReviewApprovedNotification: async () => {}, createReviewRejectedNotification: async () => {},
  };
  const code = new Bun.Transpiler({ loader: 'tsx' }).transformSync(`const {${Object.keys(dependencies).join(',')}} = deps; ${block}; return {${mutationNames.join(',')},onRecordApplied};`);
  const handlers = new Function('deps', code)(dependencies) as Record<string, { mutationFn: (input: unknown) => Promise<unknown> }> & { onRecordApplied: (receipt: RecordActionReceipt) => Promise<void> };
  for (const [name, value] of [
    ['approveReviewMutation', { reviewId: id, adminNote: '' }], ['rejectReviewMutation', { reviewId: id, adminNote: '거부 사유' }], ['deleteReviewMutation', id],
    ['approveSubmissionMutation', approval()], ['rejectSubmissionMutation', { submission, reason: '반려' }], ['deleteSubmissionMutation', submission],
    ['updateSubmissionMutation', { submission, updatedData: edit }], ['rejectSubmissionMutation', { submission: { ...submission, submission_type: 'recommend' }, reason: '반려' }],
  ] as const) await handlers[name].mutationFn(value);
  expect(requests.map(request => request.action)).toEqual(['review.approve', 'review.reject', 'review.delete', 'submission.approve', 'submission.reject', 'submission.delete', 'submission.edit', 'recommendation.reject']);
  await handlers.onRecordApplied(receipt);
  expect(invalidations).toEqual([]);
  expect([refresh, pendingRefresh, publicRefresh]).toEqual([1, 1, 1]); expect(notices).toHaveLength(1);
  await handlers.onRecordApplied({ ...receipt, action: 'review.delete', mediaCleanupUnmanaged: true });
  const unmanagedNotice = notices.at(-1) as { title: string; description: string };
  expect(unmanagedNotice.title).toBe('변경 확인 완료');
  expect(unmanagedNotice.description).toContain('자동 삭제 대상에서 제외');
  expect(unmanagedNotice.description).not.toContain('정리가 아직 완료되지');
  await handlers.onRecordApplied({ ...receipt, action: 'review.delete', mediaCleanupPending: true });
  expect((notices.at(-1) as { description: string }).description).toContain('사진 정리가 아직 완료되지');
  expect((notices.at(-1) as { description: string }).description).not.toContain('삭제 대상에서 제외');
  expect(block).not.toMatch(/\.update[<(]|\.delete\(|\.storage|callSubmissionApprovalRpc|assertLegacyBrowserAdminMutationEnabled/);
  const restaurants = page.slice(page.indexOf('  const handleApprove ='), page.indexOf('  // 제보 데이터 쿼리'));
  expect(restaurants).not.toMatch(/\.update[<(]|\.delete\(|assertLegacyBrowserAdminMutationEnabled/);
});
